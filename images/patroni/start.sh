#!/bin/bash
set -euo pipefail

chown postgres:postgres /data

exec su -c "PATH=$PATH /usr/local/bin/patroni /etc/patroni.yml" postgres
