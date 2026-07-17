#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="$ROOT/app/src/tsshd/runtime"
mkdir -p "$OUT"

(
  cd "$ROOT/vendor/tsshd-wasm"
  GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o "$OUT/tsshd-client.wasm" ./cmd/browser
)

GOROOT=$(go env GOROOT)
cp "$GOROOT/lib/wasm/wasm_exec.js" "$OUT/wasm_exec.js"
echo "Built $OUT/tsshd-client.wasm"
