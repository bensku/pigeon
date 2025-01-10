package keygen

import (
	"crypto/rand"
	"io"
	"net/netip"
	"time"

	"github.com/slackhq/nebula/cert"
	"golang.org/x/crypto/curve25519"
)

type CertConfig struct {
	Hostname       string
	Network        netip.Prefix
	Groups         []string
	ValidNotBefore time.Time
	ValidNotAfter  time.Time
}

func CreateHostKey(caKeyPem []byte) ([]byte, error) {
	_, _, curve, err := cert.UnmarshalSigningPrivateKeyFromPEM(caKeyPem)
	if err != nil {
		return []byte{}, err
	}

	privkey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, privkey); err != nil {
		panic(err)
	}

	return cert.MarshalPrivateKeyToPEM(curve, privkey), nil
}

func SignCertificate(caCertPem []byte, caKeyPem []byte, hostKeyPem []byte, cf *CertConfig) ([]byte, error) {
	caCert, _, err := cert.UnmarshalCertificateFromPEM(caCertPem)
	if err != nil {
		return []byte{}, err
	}
	caKey, _, _, err := cert.UnmarshalSigningPrivateKeyFromPEM(caKeyPem)
	if err != nil {
		return []byte{}, err
	}
	hostKey, _, curve, err := cert.UnmarshalPrivateKeyFromPEM(hostKeyPem)
	if err != nil {
		return []byte{}, err
	}

	pubKey, err := curve25519.X25519(hostKey, curve25519.Basepoint)
	if err != nil {
		return []byte{}, err
	}

	t := &cert.TBSCertificate{
		Version:        cert.Version1,
		Name:           cf.Hostname,
		Groups:         cf.Groups,
		Networks:       []netip.Prefix{cf.Network},
		UnsafeNetworks: []netip.Prefix{}, // Not supported yet
		NotBefore:      cf.ValidNotBefore,
		NotAfter:       cf.ValidNotAfter,
		PublicKey:      pubKey,
		IsCA:           false,
		Curve:          curve,
	}

	c, err := t.Sign(caCert, curve, caKey)
	if err != nil {
		return []byte{}, err
	}
	data, err := c.MarshalPEM()
	return data, err
}
