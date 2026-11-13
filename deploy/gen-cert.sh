#!/usr/bin/env bash
# Make a self-signed certificate for nginx (certs/server.crt + certs/server.key). Never overwrites existing files.
# Browsers will warn once ("not secure") — fine for testing; use a real certificate for the public.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
if [[ -e certs/server.crt && -e certs/server.key ]]; then echo "certs/ already has server.crt and server.key; not touching them"; exit 0; fi
if [[ -e certs/server.crt || -e certs/server.key ]]; then echo "certs/ has only one of server.crt / server.key: fix or move it first" >&2; exit 1; fi
name="${1:-localhost}"
if [[ "$name" =~ ^[0-9.]+$ || "$name" == *:* ]]; then san="IP:${name}"; else san="DNS:${name}"; fi
openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=${name}" \
  -addext "subjectAltName=${san},DNS:localhost,IP:127.0.0.1" \
  -keyout certs/server.key -out certs/server.crt
chmod 600 certs/server.key
echo "made certs/server.crt for ${name}"
