package main

import (
	"encoding/json"
	"os"

	"github.com/bensku/pigeon/nebula-cert-manager/keygen"
)

func main() {
	mode := os.Getenv("MANAGER_MODE")
	target := os.Getenv("MANAGER_TARGET")
	if mode == "ca" {
		if target == "key" {
			// Create new CA key
			key, err := keygen.CreateCaKey()
			if err != nil {
				panic(err)
			}
			os.Stdout.Write(key)
		} else if target == "cert" {
			// Create new CA certificate from previously created key
			key := os.Getenv("CA_KEY")
			config := keygen.CaConfig{}
			err := json.Unmarshal([]byte(os.Getenv("CA_CONFIG")), &config)
			if err != nil {
				panic(err)
			}
			cert, err := keygen.CreateCaCert([]byte(key), &config)
			if err != nil {
				panic(err)
			}
			os.Stdout.Write(cert)
		}
	} else if mode == "host" {
		caCert := os.Getenv("CA_CERT")
		caKey := os.Getenv("CA_KEY")
		if target == "key" {
			// Create new host key
			key, err := keygen.CreateHostKey([]byte(caKey))
			if err != nil {
				panic(err)
			}
			os.Stdout.Write(key)
		} else if target == "cert" {
			// Create and sign a host certificate for previously created host key
			hostKey := os.Getenv("HOST_KEY")
			config := keygen.CertConfig{}
			err := json.Unmarshal([]byte(os.Getenv("CERT_CONFIG")), &config)
			if err != nil {
				panic(err)
			}
			cert, err := keygen.SignCertificate([]byte(caCert), []byte(caKey), []byte(hostKey), &config)
			if err != nil {
				panic(err)
			}
			os.Stdout.Write(cert)
		}
	} else {
		panic("Invalid mode")
	}
}
