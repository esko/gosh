# Browser tabs (Controlled Frame)

Gosh browser tabs embed third-party web content with the Chromium **Controlled Frame** API inside the installed IWA. They are **not** implemented with a normal `<iframe>`.

## Opening a browser tab

- **Tab strip:** click the **⌄** menu on the new-tab control → **New browser tab**
- **Command palette:** `Ctrl+Shift+P` → **New browser tab**

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

`workspace.listTabs` reports `kind: "browser"` for these tabs. When the browser host is wired, agents can drive navigation and structured page interaction through JSON-RPC (`browser.*` methods) or the in-process `AgentControlService` API.

### Navigation

| RPC | Service | Notes |
|-----|---------|-------|
| `browser.navigate` | `browserNavigate` | `{ tabId, url }` |
| `browser.back` | `browserBack` | Returns `{ moved }` |
| `browser.forward` | `browserForward` | Returns `{ moved }` |
| `browser.reload` | `browserReload` | |
| `browser.getUrl` | `browserGetUrl` | |
| `browser.getTitle` | `browserGetTitle` | |

### Snapshot and interaction

| RPC | Service | Notes |
|-----|---------|-------|
| `browser.snapshot` | `browserSnapshot` | Bounded semantic tree with temporary `ref` ids |
| `browser.query` | `browserQuery` | Filter by `role`, `name`, `text`, or `selector` |
| `browser.waitFor` | `browserWaitFor` | `selector`, `text`, or `loadState` (`load` / `idle`) |
| `browser.click` | `browserClick` | `{ tabId, ref }` |
| `browser.type` | `browserType` | `{ tabId, ref, text, clear? }` — clears by default |
| `browser.press` | `browserPress` | `{ tabId, ref, key }` |

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

## Security notes

- Production path uses Controlled Frame only (no CDP requirement).
- Agents cannot inject arbitrary scripts; only whitelisted snapshot/query/wait/interaction helpers run in the guest.
- Snapshot output is size-bounded to reduce exfiltration risk from large pages.
- Secret inputs never leave the guest with real values in agent-visible payloads.

## Known limitations

- No mixed terminal/browser splits (D4)
- Browser tabs are not restored from `sessionStorage` tab layout
- No `newwindow` / `dialog` automation yet
- Dev vite server lacks a real `<controlledframe>` element
- Enterprise-managed IWA install required on ChromeOS today
- Some sites may still block automation or embedding at the network layer
- Query `selector` uses standard DOM selectors only (no shadow-piercing)

See [ADR 0014](../adr/0014-controlled-frame-browser-tabs.md) and [PROTOCOL.md](./PROTOCOL.md).
