#!/bin/bash
set -euo pipefail

# Create CA key and cert
ca_config='{"name": "test CA", "validNotBefore": "2000-01-01T00:00:01Z", "validNotAfter": "2100-01-01T00:00:01Z"}'
ca_key=$(MANAGER_MODE=ca MANAGER_TARGET=key go run main.go)
ca_cert=$(MANAGER_MODE=ca MANAGER_TARGET=cert CA_KEY="$ca_key" CA_CONFIG="$ca_config" go run main.go)

# Use CA to create host key and certificate
cert_config='{"name": "host.test", "network": "10.0.0.1/24", "groups": ["test"], "validNotBefore": "2000-01-01T00:00:01Z", "validNotAfter": "2100-01-01T00:00:01Z"}'
host_key=$(MANAGER_MODE=host MANAGER_TARGET=key CA_KEY="$ca_key" go run main.go)
host_cert=$(MANAGER_MODE=host MANAGER_TARGET=cert CA_KEY="$ca_key" CA_CERT="$ca_cert" HOST_KEY="$host_key" CERT_CONFIG="$cert_config" go run main.go)

mkdir -p tmp
rm -f tmp/*
echo "$ca_key" > tmp/ca.key
echo "$ca_cert" > tmp/ca.crt
echo "$host_key" > tmp/host.key
echo "$host_cert" > tmp/host.crt