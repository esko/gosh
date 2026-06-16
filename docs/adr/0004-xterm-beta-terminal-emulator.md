# ADR 0004: xterm Beta Terminal Emulator

## Status

Accepted

## Decision

Use npm xterm.js `6.1.0-beta.287` or a compatible `6.1.0-beta` instead of upstream bundled xterm. A local `TerminalEmulator` owns xterm construction, options, compatibility, and tests.

## Consequences

- hterm UI is not ported.
- xterm beta API drift is handled locally.
- Kitty keyboard support is tested at the emulator boundary.

