# Gosh browser client fork

This directory vendors the client code from `github.com/trzsz/tsshd` v0.1.8 so
the browser relay can be built reproducibly without depending on an untracked
binary.

The Gosh-specific changes are deliberately limited to the browser client:

- inject a `PacketConn` factory so KCP and QUIC can use an IWA `UDPSocket`;
- provide JavaScript/WASM stubs for Unix-only terminal helpers;
- expose the TSSHD client through a worker-safe `syscall/js` bridge;
- keep 64-bit protocol identifiers as decimal strings across JavaScript;
- serialize stdin through a single input pump (no per-keystroke goroutines); and
- enable `SetKeepPendingInput` so heartbeat timeouts on slow links do not
  discard keypresses.

Run `npm run build:tsshd-wasm` from the repository root. The script compiles
`cmd/browser` with the repository's installed Go toolchain and writes the WASM
module plus its matching `wasm_exec.js` runtime to
`app/src/tsshd/runtime/`.

The upstream license is preserved in `LICENSE`.
