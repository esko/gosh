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

Cookies, `localStorage`, and related state are isolated per tab and survive relaunch. Partitions are cleared when the tab is closed and the Controlled Frame is disposed (D2 may add explicit wipe controls).

## Permission requests

Embedded pages may request powerful capabilities (geolocation, camera, notifications, etc.). Gosh **denies by default** via `permissionrequest` handlers in `app/src/browser/policies.ts`. The IWA must already hold a manifest permission before an embed can be allowed later.

## Agent control

`workspace.listTabs` reports `kind: "browser"` for these tabs. When the browser host is wired:

- `browserNavigate({ tabId, url })`
- `browserGetUrl({ tabId })`
- `browserGetTitle({ tabId })`

Full RPC exposure is follow-up work (D2); the in-process `AgentControlService` API is live when the terminal window mounts.

## Known limitations (D1)

- No mixed terminal/browser splits (D4)
- Browser tabs are not restored from `sessionStorage` tab layout
- No `newwindow` / `dialog` automation yet
- Dev vite server lacks a real `<controlledframe>` element
- Enterprise-managed IWA install required on ChromeOS today
- Some sites may still block automation or embedding at the network layer

See [ADR 0014](../adr/0014-controlled-frame-browser-tabs.md).
