#!/usr/bin/env bash
# Generate Ed25519 signing key for IWA bundles (issue #17).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_DIR="$ROOT/iwa/keys"
mkdir -p "$KEY_DIR"

if [[ -f "$KEY_DIR/encrypted_key.pem" ]]; then
  echo "Key already exists: $KEY_DIR/encrypted_key.pem"
  echo "Run: npx wbn-dump-id -iwa $KEY_DIR/encrypted_key.pem"
  exit 0
fi

openssl genpkey -algorithm Ed25519 -out "$KEY_DIR/private_key.pem"
openssl pkcs8 -in "$KEY_DIR/private_key.pem" -topk8 -out "$KEY_DIR/encrypted_key.pem"
rm -f "$KEY_DIR/private_key.pem"

echo "Created $KEY_DIR/encrypted_key.pem"
echo ""
echo "Web Bundle ID:"
npx --yes wbn-dump-id -iwa "$KEY_DIR/encrypted_key.pem"
echo ""
echo "Update iwa/webbundle.config.ts webBundleId with the value above."
echo "Sign with: WEB_BUNDLE_SIGNING_PASSPHRASE='…' npm run bundle:iwa"
