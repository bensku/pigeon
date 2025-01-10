package keygen

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/netip"
	"time"

	"github.com/slackhq/nebula/cert"
)

// Creates a new CA private key and returns it in PEM format
func CreateCaKey() ([]byte, error) {
	curve := cert.Curve_CURVE25519
	_, rawPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return []byte{}, err
	}

	return cert.MarshalSigningPrivateKeyToPEM(curve, rawPriv), nil
}

type CaConfig struct {
	Name           string
	ValidNotBefore time.Time
	ValidNotAfter  time.Time
}

// Creates a CA certificate based on a private key given to it
// Both private key and certificate are/should be in PEM format
func CreateCaCert(pemKey []byte, cf *CaConfig) ([]byte, error) {
	rawPriv, _, curve, err := cert.UnmarshalSigningPrivateKeyFromPEM(pemKey)
	if err != nil {
		return []byte{}, err
	}
	pubKey := rawPriv[32:] // ed25519 public key is the last 32 bytes of the private key

	t := &cert.TBSCertificate{
		Version: cert.Version1,
		Name:    cf.Name,
		// Group, network, etc. restrictions for CAs are not supported!
		Groups:         []string{},
		Networks:       []netip.Prefix{},
		UnsafeNetworks: []netip.Prefix{},
		NotBefore:      cf.ValidNotBefore,
		NotAfter:       cf.ValidNotAfter,
		PublicKey:      pubKey,
		IsCA:           true,
		Curve:          curve,
	}

	c, err := t.Sign(nil, curve, rawPriv)
	if err != nil {
		return []byte{}, err
	}
	data, err := c.MarshalPEM()
	if err != nil {
		return []byte{}, err
	}
	return data, nil
}
