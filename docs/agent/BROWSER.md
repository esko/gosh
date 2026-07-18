# Browser tabs (Controlled Frame)

Gosh browser tabs embed third-party web content with the Chromium **Controlled Frame** API inside the installed IWA. They are **not** implemented with a normal `<iframe>`.

## Opening a browser tab

- **Tab strip:** click the **⌄** menu on the new-tab control → **New browser tab**, **New mixed tab (side by side)**, or **New mixed tab (stacked)** (terminal + browser split; requires a connected spec on an existing terminal tab)
- **Command palette:** `Ctrl+Shift+P` → **New browser tab**, **New mixed tab (side by side)**, **New mixed tab (stacked)**, **Split browser beside terminal**, or **Split browser below terminal** (convert active terminal tab). On a mixed tab: **Split terminal right/down** or **Split browser right/down**.

The address bar supports back, forward, reload, and stop. Enter a URL or hostname to navigate.

## Requirements

- Installed **Isolated Web App** on ChromeOS (or Chromium with IWA dev install)
- Manifest `permissions_policy` includes `"controlled-frame": ["self"]` (see `app/public/manifest.webmanifest`)
- Controlled Frame is **not** available in a plain `npm run dev` browser tab; the UI shows an explanatory placeholder instead

## Storage partitions

Each browser tab uses a dedicated persistent partition:

```
persist:gosh-browser:<opaqueTabId>
```

Cookies, `localStorage`, and related state are isolated per tab and survive relaunch. Partitions are cleared when the tab is closed and the Controlled Frame is disposed.

## Permission requests

Embedded pages may request powerful capabilities (geolocation, camera, notifications, etc.). Gosh **denies by default** via `permissionrequest` handlers in `app/src/browser/policies.ts`. The IWA must already hold a manifest permission before an embed can be allowed later.

## Agent control

`workspace.listTabs` reports `kind: "browser"` for browser-only tabs and `kind: "mixed"` for terminal+browser split tabs. `workspace.listPanes` includes `surface: "terminal" | "browser"` per pane. On mixed tabs, `pane.split` accepts optional `paneId` (source leaf; defaults to active pane) and `surface` (`terminal` | `browser`; defaults to the source leaf surface) to grow the Gosh-owned layout tree.

Every `browser.*` RPC accepts **`tabId` or `paneId`** (at least one). Use `paneId` to target a specific browser leaf when a mixed tab has more than one. Omit `paneId` to use the focused browser pane, or the first browser pane when none is focused. Browser-only tabs still work with `tabId` alone.

### Navigation

| RPC | Service | Notes |
|-----|---------|-------|
| `browser.navigate` | `browserNavigate` | `{ tabId?, paneId?, url }` |
| `browser.back` | `browserBack` | `{ tabId?, paneId? }` — returns `{ moved }` |
| `browser.forward` | `browserForward` | `{ tabId?, paneId? }` — returns `{ moved }` |
| `browser.reload` | `browserReload` | `{ tabId?, paneId? }` |
| `browser.getUrl` | `browserGetUrl` | `{ tabId?, paneId? }` |
| `browser.getTitle` | `browserGetTitle` | `{ tabId?, paneId? }` |

### Snapshot and interaction

| RPC | Service | Notes |
|-----|---------|-------|
| `browser.snapshot` | `browserSnapshot` | `{ tabId?, paneId?, maxNodes?, maxBytes? }` |
| `browser.query` | `browserQuery` | `{ tabId?, paneId?, role?, name?, text?, selector? }` |
| `browser.waitFor` | `browserWaitFor` | `{ tabId?, paneId?, selector?, text?, loadState? }` |
| `browser.click` | `browserClick` | `{ tabId?, paneId?, ref }` |
| `browser.type` | `browserType` | `{ tabId?, paneId?, ref, text, clear? }` — clears by default |
| `browser.press` | `browserPress` | `{ tabId?, paneId?, ref, key }` |

There is **no** generic `browser.evaluate` / arbitrary JavaScript RPC. Snapshot and interaction use fixed Controlled Frame `executeScript` helpers in `app/src/browser/browserSnapshotScript.ts` only.

### Snapshot shape

`browser.snapshot` returns:

- `url`, `title`, `generation`
- `nodes[]` with `ref`, `role`, accessible `name`, `text`, link `href`, and input state (`value`, `checked`, `disabled`, `selected`, `expanded`)
- Password / secret field values are always `[redacted]`
- `truncated` + `byteLength` when caps apply (default **200 nodes**, **256 KiB**)

Temporary refs are stamped on elements as `data-gosh-agent-ref` / `data-gosh-agent-gen` and **invalidated on navigation** (`loadstart`, back/forward/reload). Stale refs return `invalid-argument`.

Typical flow:

1. `browser.snapshot` → pick a `ref`
2. `browser.click` / `browser.type` / `browser.press`
3. Re-snapshot after navigation or major DOM changes

### CLI and MCP

Browser RPCs are also exposed through `goshctl` and `gosh-mcp` (thin protocol clients; no extra server logic):

```bash
goshctl browser navigate --tab <tabId> https://example.com
goshctl browser navigate --pane <paneId> https://example.com
goshctl browser snapshot --tab <tabId>
goshctl browser click --pane <paneId> --ref e1
```

MCP tools: `gosh_browser_navigate`, `gosh_browser_snapshot`, `gosh_browser_click`, `gosh_browser_type`, `gosh_browser_get_url`, `gosh_browser_get_title`, and the other `browser.*` methods. See `tools/goshctl/README.md` and `tools/gosh-mcp/README.md`.

## Security notes

- Production path uses Controlled Frame only (no CDP requirement).
- Agents cannot inject arbitrary scripts; only whitelisted snapshot/query/wait/interaction helpers run in the guest.
- Snapshot output is size-bounded to reduce exfiltration risk from large pages.
- Secret inputs never leave the guest with real values in agent-visible payloads.

## Screenshots (feasibility)

Visual capture of Controlled Frame **guest** content is **not** implemented. CDP `Page.captureScreenshot` may only include the outer IWA shell unless Chromium exposes a nested guest target — see [ADR 0015](../adr/0015-browser-screenshot-feasibility.md) and `npm run probe:controlled-frame-screenshot` for the device-validation harness.

Full Chromebook E2E rows (browser navigation, snapshot, agent RPC) are in [CHROMEBOOK_VALIDATION.md](./CHROMEBOOK_VALIDATION.md).

Semantic `browser.snapshot` remains the supported automation path when pixels are unavailable.

## Known limitations

- No `browser.screenshot` RPC; guest pixel capture unproven (ADR 0015)
- Mixed tabs support agent `pane.split` with optional `surface` to add terminal or browser leaves; the same split targets are available from the command palette and terminal context menu. `Ctrl+Shift+E` / `Ctrl+Shift+D` split a new terminal leaf when a terminal leaf is focused. `pane.zoom` toggles maximize for the focused mixed leaf (`Ctrl+Shift+Z` in the UI, same as Restty pane zoom on terminal-only tabs)
- Browser-only and terminal-only tabs are unchanged; mixed tabs are a separate `kind: "mixed"`
- Browser tabs are not restored from `sessionStorage` tab layout
- No `newwindow` / `dialog` automation yet
- Dev vite server lacks a real `<controlledframe>` element
- Enterprise-managed IWA install required on ChromeOS today
- Some sites may still block automation or embedding at the network layer
- Query `selector` uses standard DOM selectors only (no shadow-piercing)

See [ADR 0014](../adr/0014-controlled-frame-browser-tabs.md), [ADR 0016](../adr/0016-mixed-terminal-browser-splits.md), and [PROTOCOL.md](./PROTOCOL.md).
