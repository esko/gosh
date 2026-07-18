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
| `workspace.listPanes` | `{ tabId?: string }` — each pane includes `surface: "terminal" \| "browser"` |
| `pane.split` | `{ tabId?, paneId?, direction, surface? }` — `surface` (`terminal` \| `browser`) selects the new mixed-tab leaf; defaults to the source leaf surface. Terminal-only tabs ignore `surface` and use Restty splits. |
| `pane.focus` | `{ paneId }` |
| `pane.resize` | `{ paneId, direction, amount? }` |
| `pane.zoom` | `{ paneId, zoomed? }` |
| `pane.close` | `{ paneId }` |
| `terminal.send` | `{ paneId, data }` |
| `terminal.read` | `{ paneId, maxBytes?, lastLines? }` |
| `terminal.run` | `{ paneId, command, timeoutMs?, maxOutputBytes? }` |
| `pane.diagnostics` | `{ paneId }` |
| `browser.navigate` | `{ tabId?, paneId?, url }` — `tabId` or `paneId` required |
| `browser.back` | `{ tabId?, paneId? }` |
| `browser.forward` | `{ tabId?, paneId? }` |
| `browser.reload` | `{ tabId?, paneId? }` |
| `browser.waitFor` | `{ tabId?, paneId?, selector?, text?, loadState?, timeoutMs?, pollIntervalMs? }` |
| `browser.snapshot` | `{ tabId?, paneId?, maxNodes?, maxBytes? }` |
| `browser.query` | `{ tabId?, paneId?, role?, name?, text?, selector? }` |
| `browser.click` | `{ tabId?, paneId?, ref }` |
| `browser.type` | `{ tabId?, paneId?, ref, text, clear? }` |
| `browser.press` | `{ tabId?, paneId?, ref, key }` |
| `browser.getUrl` | `{ tabId?, paneId? }` |
| `browser.getTitle` | `{ tabId?, paneId? }` |
| `browser.handleDialog` | `{ tabId?, paneId?, action: "accept" \| "dismiss", promptText? }` |
| `browser.handleNewWindow` | `{ tabId?, paneId?, action: "deny" \| "open-tab", url? }` |
| `events.subscribe` | `{ types?: string[] }` |

Server push uses the notification `events.push` with `{ subscriptionId, event }`.

## Example request / response

```json
{"jsonrpc":"2.0","method":"workspace.listTabs","id":3}
```

```json
{"jsonrpc":"2.0","result":[{"tabId":"tab_abc","windowId":"win_1","kind":"terminal","title":"local","active":true,"paneCount":1}],"id":3}
```

`workspace.listPanes` example pane shape:

```json
{"paneId":"pane_1","tabId":"tab_mixed","windowId":"win_1","surface":"browser","active":false,"zoomed":false}
```

Application failures map service codes into `error.data.code` (`not-found`, `unavailable`, `invalid-argument`, `failed`) while keeping JSON-RPC `error.code` in the standard / extension ranges.

### `terminal.run`

Runs a shell command in the target pane and waits for an OSC 133 `D` marker on that pane (not prompt text or silence). Requires [shell integration](shell-integration/README.md) on the remote session.

Success result shape:

```json
{
  "command": "echo hello",
  "exitCode": 0,
  "output": "hello",
  "durationMs": 42,
  "completion": "osc133",
  "truncated": false
}
```

`completion` is `osc133` when the matching `D` marker arrived; otherwise `timeout`, `pane-closed`, `disconnected`, or `cancelled`. Concurrent runs on the same pane are rejected with `failed` (no queue). Output is read from Restty text capture between OSC `C` and `D` positions when available; otherwise best-effort viewport capture with `truncated: true`.

Push events `terminal.command.started` and `terminal.command.completed` mirror OSC `C` / `D` per pane when subscribed via `events.subscribe`. `browser.navigated` fires after agent-driven `browser.navigate`, successful `browser.back` / `browser.forward`, or `browser.reload`.

### `browser.*` targeting

Every `browser.*` method accepts **`tabId` or `paneId`** (at least one required). On mixed tabs with multiple browser leaves, pass `paneId` from `workspace.listPanes` to target a specific Controlled Frame. When `paneId` is omitted, the service uses the **focused browser pane** in that tab, or the **first browser pane** if none is focused. Browser-only tabs (`kind: "browser"`) continue to work with `tabId` alone (no registry pane required). If both ids are supplied they must refer to the same tab; mismatches return `invalid-argument`.

### Event stream (`events.push`)

All events share `{ seq, type, at, windowId }` with monotonic `seq`. Optional fields are opaque ids and primitives only (no DOM or transport handles).

| Event | Extra fields |
|-------|----------------|
| `window.opened` | — |
| `window.closed` | — |
| `tab.opened` | `tabId` |
| `tab.closed` | `tabId` |
| `pane.opened` | `tabId`, `paneId` |
| `pane.closed` | `tabId`, `paneId` |
| `pane.focused` | `tabId`, `paneId` |
| `pane.resized` | `tabId`, `paneId` |
| `terminal.command.started` | `tabId`, `paneId`, `commandId` |
| `terminal.command.completed` | `tabId`, `paneId`, `commandId`, `exitCode` |
| `terminal.disconnected` | `tabId`, `paneId` |
| `browser.navigated` | `tabId`, `url`, `paneId?` |
| `browser.load.failed` | `tabId`, `url`, `failureReason`, `paneId?` |
| `browser.dialog` | `tabId`, `paneId?`, `dialogType` (`alert` \| `confirm` \| `prompt`), `message` |
| `browser.newwindow` | `tabId`, `paneId?`, `url`, `name`, `windowOpenDisposition?` |

`window.opened` is emitted when the workspace registry boots (one IWA terminal window). `window.closed` is emitted on teardown (`resetAgentControl` / `pagehide`). `terminal.disconnected` fires when a pane transport disconnects. `browser.load.failed` fires on Controlled Frame `loadabort` or navigation failure. `browser.dialog` and `browser.newwindow` fire when embedded content opens a JavaScript dialog or requests a new window; Gosh **denies by default** (dismiss / discard) after ~30s unless the agent calls `browser.handleDialog` or `browser.handleNewWindow` while a request is pending.

### `browser.snapshot`

Returns a bounded semantic representation of the active browser tab (Controlled Frame). Nodes include temporary `ref` ids (`e1`, `e2`, …), implicit/explicit `role`, accessible `name`, visible `text`, link `href`, and form control state. Password and secret autocomplete fields redact `value` as `[redacted]`. Refs invalidate after navigation; reuse after `browser.back`, `browser.navigate`, or reload yields `invalid-argument`.

There is no `browser.evaluate` method. Snapshot uses internal `executeScript` helpers only (see `docs/agent/BROWSER.md`).

## Cancellation

Future transports may cancel in-flight requests by id. Cancelled work returns `cancelled` (-32001). Clients should stop waiting after receiving the error response or closing the stream.

## Subscriptions

1. Client: `events.subscribe` → `{ subscriptionId }`.
2. Server: `events.push` notifications for matching `AgentEvent` payloads.
3. Unsubscribe is transport-specific (later slice); until then, disconnect ends the subscription.

## Authentication

External control (ADR 0013) requires a pairing handshake before any workspace RPC:

1. Owner enables **External agent control** in Settings → Security (off by default).
2. Gosh generates a random bearer token (owner-only, IndexedDB).
3. Client connects to the loopback listener and sends:

```json
{"jsonrpc":"2.0","method":"gosh.authenticate","params":{"token":"<pairing-token>"},"id":1}
```

4. On success: `{"jsonrpc":"2.0","result":{"ok":true},"id":1}` — subsequent methods are allowed.
5. Missing or wrong token → `unauthorized` (-32002). No workspace method runs unauthenticated.

`gosh.authenticate` is transport-only and is not part of `AgentControlService`.

## Limits

| Limit | Value |
|-------|-------|
| Max frame | 1 MiB |
| Protocol version | 1 |
| Max clients | 4 |
| Request rate | 30/s per connection (token bucket) |
| Bind address | `127.0.0.1` only (interim) |
| Auth | `gosh.authenticate` with pairing token |

Implementations should bound read buffers and reject unterminated lines that exceed the max frame size without waiting for `\n`.

## Device validation

ChromeOS acceptance for the loopback transport (C2) and installed-IWA agent matrix (E3) is tracked in [CHROMEBOOK_VALIDATION.md](./CHROMEBOOK_VALIDATION.md). From Crostini, with port and token from Settings → Security:

```bash
npm run probe:agent-control-transport
npm run probe:agent-control-negative
```

See also `npm run goshctl` and [ADR 0013](../adr/0013-agent-control-transport.md).
