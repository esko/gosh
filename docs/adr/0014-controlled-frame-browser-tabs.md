# ADR 0014: Controlled Frame browser tabs

## Status

Accepted (D1)

## Context

Gosh needs an in-app browser surface for agent workflows and future mixed layouts. Standard `<iframe>` embedding is blocked by many sites (`X-Frame-Options`, CSP `frame-ancestors`) and does not expose the navigation/control surface we need.

Chromium provides the **Controlled Frame** API exclusively to **Isolated Web Apps (IWAs)**. Gosh already ships as an IWA with custom caption tabs (ADR 0008).

## Decision

1. Add a third tab kind, `browser`, alongside `launcher` and `terminal`, registered in `WorkspaceRegistry` with opaque `tabId`s and `tab.opened` / `tab.closed` events.
2. Implement embedding with `<controlledframe>` in `app/src/browser/` — **not** a production `<iframe>`.
3. Enable the feature in both manifests via `permissions_policy.controlled-frame: ["self"]` and mirror it in dev `Permissions-Policy` headers.
4. Use per-tab persistent storage partitions (`persist:gosh-browser:<tabId>`).
5. Deny embedded `permissionrequest` events by default; document the allow-list path for later slices.
6. Expose minimal agent seams (`browserNavigate`, `browserGetUrl`, `browserGetTitle`) through `AgentControlService` + `BrowserHost`.

## Consequences

- Browser tabs work only in the installed IWA on ChromeOS (or IWA dev install), not in a normal dev browser session.
- Terminal tabs, SSH/Mosh/ET/tsshd transports, and launcher behavior remain unchanged.
- Mixed terminal/browser splits are explicitly deferred to D4.
- Additional automation (RPC methods, `newwindow`, script injection) can build on the controller seam in D2+.

## References

- [Controlled Frame (Chrome IWA docs)](https://developer.chrome.com/docs/iwa/controlled-frame)
- [WICG controlled-frame explainer](https://github.com/WICG/controlled-frame)
- `docs/agent/BROWSER.md`
