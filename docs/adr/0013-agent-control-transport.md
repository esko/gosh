# ADR 0013: Agent control transport (interim loopback)

## Status

Accepted (2026-07-19) — **interim** until validated on ChromeOS hardware.

## Context

ADR 0011 defines `AgentControlService`; ADR 0012 defines the NDJSON JSON-RPC wire format. External clients (CLI, MCP adapter) need a network transport that:

- Is **disabled by default** and requires explicit owner opt-in.
- Authenticates every session before workspace RPC.
- Binds **loopback only** in this slice (no LAN / `0.0.0.0`).
- Reuses framing, validation, and dispatch from `app/src/agent/protocol/`.
- Can be exercised in development before a Chromebook is available.

ChromeOS device validation (Crostini reachability, suspend/resume, IWA permission prompts) is **not** available in the current dev environment.

## Decision

### Interim transport: `TCPServerSocket` on loopback

When the installed IWA exposes Chromium **Direct Sockets** `TCPServerSocket`:

1. Listen on **`127.0.0.1`** with an ephemeral port (`localPort: 0`).
2. Speak **NDJSON JSON-RPC** per `docs/agent/PROTOCOL.md`.
3. Require `gosh.authenticate` with a random pairing token before any other method.
4. Enforce **max clients**, **per-connection rate limits**, **1 MiB frame cap**, and **slow-subscriber isolation** for `events.push`.
5. Maintain an in-memory **audit ring** of recent methods (no secrets or terminal payload).

Pairing state (`enabled`, bearer token) is stored owner-only in IndexedDB (`agentControl` store). The listener starts only while a terminal window is mounted and pairing is enabled.

If `TCPServerSocket` is unavailable (plain browser tab, missing permission), enablement is persisted but the server reports `transportAvailable: false` — documented, not silently ignored.

### Threat model (summary)

Full analysis and release gate: [`docs/agent/THREAT_MODEL.md`](../agent/THREAT_MODEL.md).

| Asset | Risk | Mitigation (this slice) |
|-------|------|-------------------------|
| Terminal sessions / pane control | Local process impersonates owner | Loopback bind; random token; disabled by default |
| Pairing token | Leak enables local control | Owner-only storage; reset in Settings; audit log |
| Terminal output via `terminal.read` / `terminal.run` | Sensitive data exfiltration | Auth required; audit omits payloads |
| Denial of service | Many clients or huge frames | Max 4 clients; rate limit; frame cap; drop events for slow subscribers |

**Out of scope:** remote/LAN access, mTLS, Unix domain sockets, CLI/MCP binaries, ChromeOS device-policy integration.

## ChromeOS validation matrix (required before production)

Re-run on a **Chromebook with the signed IWA** before treating this transport as production-ready:

| Scenario | Pass criteria |
|----------|----------------|
| IWA install + Direct Sockets permission | `TCPServerSocket` available; listener binds `127.0.0.1` |
| Crostini / Linux client | `nc` or TS client on `127.0.0.1:<port>` after paste token can `gosh.authenticate` and `workspace.listTabs` |
| penguin container → browser loopback | Same RPC path works from Crostini (document firewall / namespace quirks) |
| Suspend / resume | Listener restarts or fails closed; no stale unauthenticated sessions |
| Close terminal window | Listener stops; port not left open |
| Token reset while connected | Existing client receives `unauthorized` on next RPC |
| Frame > 1 MiB | `payload-too-large`; connection stays up for well-formed traffic |
| 5th simultaneous client | Rejected at accept; no unauthenticated slot |
| Settings off | Listener absent; no background bind |

Record results in the issue tracker and update this ADR status when complete.

**Harness:** on-device operator checklist and Crostini probe scripts live in [`docs/agent/CHROMEBOOK_VALIDATION.md`](../agent/CHROMEBOOK_VALIDATION.md) (`npm run probe:agent-control-transport`, `npm run probe:agent-control-negative`).

## Consequences

- `app/src/agent/server/ControlServer.ts` is the sole RPC entry point over TCP; business logic stays in `AgentControlService`.
- `app/src/agent/security/Pairing.ts` owns token lifecycle; `Permissions.ts` owns transport gates.
- Settings → Security exposes enable, token copy, and reset.
- A small caption/status pill shows when listening / clients connected.
- Production may later add Unix socket, permission prompts, or policy flags — this ADR does not commit to LAN bind.

## Non-goals

- Binding `0.0.0.0` or non-loopback interfaces.
- Shipping CLI or MCP in this slice.
- Replacing `window.__goshAgent` for local CDP smoke tests.
