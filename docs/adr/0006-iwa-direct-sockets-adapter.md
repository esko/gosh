# ADR 0006: IWA Direct Sockets Adapter

## Status

Accepted

## Decision

IWA and Direct Sockets adaptations live in a thin runtime adapter and Chrome polyfill layer.

## Consequences

- Upstream-shaped UI and emulator modules do not learn app-specific platform details.
- Direct Sockets capability checks and polyfills remain isolated.
- Runtime failures should be reported as platform/adaptation errors, not terminal errors.

