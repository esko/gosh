# Gosh Agent Control Protocol

Version **1** — NDJSON-framed [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over a byte stream (TCP or stdio in future slices).

Types and helpers live in `app/src/agent/protocol/`. The wire format is shared by future server and TypeScript clients; `AgentControlService` remains the in-process implementation (see ADR 0011).

## Version negotiation

Clients send `gosh.capabilities` with optional `protocolVersion`. The server responds with `protocolVersion` (currently `1`) and per-method availability from `AgentControlService.capabilities()`.

If the client requests an unsupported major version, the server responds with `invalid-params` and keeps the connection open when possible so the client can downgrade.

## Framing

- One JSON object per line, UTF-8, trailing `\n`.
- Max frame size: **1 MiB** (`DEFAULT_MAX_FRAME_BYTES`). Oversized lines are rejected with `payload-too-large` (-32003).
- Parse failures yield `parse-error` (-32700) with `id: null` when the request id cannot be read.

## Methods

| Method | Params (summary) |
|--------|------------------|
| `gosh.capabilities` | `{ protocolVersion?: number }` |
| `workspace.listWindows` | `{}` |
| `workspace.listTabs` | `{}` |
| `workspace.listPanes` | `{ tabId?: string }` |
| `pane.split` | `{ tabId?, direction }` |
| `pane.focus` | `{ paneId }` |
| `pane.resize` | `{ paneId, direction, amount? }` |
| `pane.zoom` | `{ paneId, zoomed? }` |
| `pane.close` | `{ paneId }` |
| `terminal.send` | `{ paneId, data }` |
| `terminal.read` | `{ paneId, maxBytes?, lastLines? }` |
| `terminal.run` | `{ paneId, command, timeoutMs? }` (stub) |
| `pane.diagnostics` | `{ paneId }` |
| `events.subscribe` | `{ types?: string[] }` |

Server push uses the notification `events.push` with `{ subscriptionId, event }`.

## Example request / response

```json
{"jsonrpc":"2.0","method":"workspace.listTabs","id":3}
```

```json
{"jsonrpc":"2.0","result":[{"tabId":"tab_abc","windowId":"win_1","kind":"terminal","title":"local","active":true,"paneCount":1}],"id":3}
```

Application failures map service codes into `error.data.code` (`not-found`, `unavailable`, `invalid-argument`, `failed`) while keeping JSON-RPC `error.code` in the standard / extension ranges.

## Cancellation

Future transports may cancel in-flight requests by id. Cancelled work returns `cancelled` (-32001). Clients should stop waiting after receiving the error response or closing the stream.

## Subscriptions

1. Client: `events.subscribe` → `{ subscriptionId }`.
2. Server: `events.push` notifications for matching `AgentEvent` payloads.
3. Unsubscribe is transport-specific (later slice); until then, disconnect ends the subscription.

## Limits

| Limit | Value |
|-------|-------|
| Max frame | 1 MiB |
| Protocol version | 1 |
| Auth | Not on wire in this slice (`unauthorized` reserved) |

Implementations should bound read buffers and reject unterminated lines that exceed the max frame size without waiting for `\n`.
