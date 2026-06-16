# ADR 0005: Mosh Via Nassh

## Status

Accepted

## Decision

Implement Mosh through nassh's existing mosh command path and wassh UDP socket support.

## Consequences

- No custom Mosh protocol implementation.
- `mosh-client.wasm` is a required upstream asset.
- Mosh availability is gated on `UDPSocket`, remote `mosh-server`, and network UDP.

