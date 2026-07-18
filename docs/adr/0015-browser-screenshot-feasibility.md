# ADR 0015: Browser screenshot feasibility (Controlled Frame + CDP)

## Status

**Proposed / pending Chromebook evidence**

Device validation checklist (run on installed IWA with a live browser tab):

- [ ] Enable Chrome remote debugging on the Chromebook (see harness notes below).
- [ ] Install Gosh via **signed `.swbn`** (production-like) and repeat probes.
- [ ] Install Gosh via **Dev Mode Proxy** (`http://127.0.0.1:5173`) and repeat probes.
- [ ] Open a browser tab, navigate to a distinctive page (e.g. `https://example.com`).
- [ ] Run `npm run probe:controlled-frame-screenshot` from Crostini (or SSH port-forward `9222`).
- [ ] Record whether `Page.captureScreenshot` on the **outer IWA page** includes Controlled Frame guest pixels.
- [ ] Record whether `/json/list` or `Target.getTargets` shows a **nested CDP target** for the guest.
- [ ] If a nested target exists, confirm `Page.captureScreenshot` on that target captures guest content.
- [ ] Test **clip / scale** (`clip` rect, `captureBeyondViewport`) for the browser tab chrome vs guest viewport.
- [ ] File results (Chrome version, install path, pass/fail per row) in the GitHub issue for D3.

## Context

Gosh browser tabs embed third-party pages with Chromium **Controlled Frame** inside the installed IWA (ADR 0014). Agent automation today is **semantic**: `browser.snapshot`, `browser.query`, and interaction RPCs return a bounded accessibility-oriented tree, not pixels (see `docs/agent/BROWSER.md` and `docs/agent/PROTOCOL.md`).

Some agent workflows benefit from **visual** context (layout debugging, CAPTCHA-adjacent UIs, verifying rendered state). Before adding a `browser.screenshot` RPC or shipping CDP-dependent tooling in production, we need evidence on:

1. What CDP can see from **outside** the IWA shell vs **inside** the Controlled Frame guest.
2. Whether Dev Mode Proxy and signed-bundle installs behave the same for capture.
3. Whether any **production** (non-CDP) capture path exists for guest content.

Development already uses CDP for terminal echo/split/agent-control harnesses (`scripts/verify-*.mjs`, `npm run dev:chrome`). Those attach to the **outer** page target only.

## Findings (desktop / literature — not yet validated on ChromeOS IWA)

### Outer IWA CDP screenshot vs Controlled Frame content

| Surface | Expected CDP `Page.captureScreenshot` behavior | Confidence |
|---------|-----------------------------------------------|------------|
| Outer IWA shell (caption, address bar, tab strip) | Captured when debugging the IWA page target | High (standard page target) |
| `<controlledframe>` guest document | **Unknown** — may render as a separate surface not composited into the outer page bitmap | Low — needs device proof |
| Terminal Restty canvas in same window | Captured on outer target in dev echo harness | Medium (dev proxy / normal page) |

Controlled Frame guests are **not** ordinary same-origin iframes. Chromium may composite them similarly to `<webview>` / guest views, where the guest is a **separate renderer** and outer `captureScreenshot` shows a placeholder or empty region.

### Is Controlled Frame a separate CDP target?

In generic Chromium, cross-process guests often appear as additional **page** or **iframe** targets in `Target.getTargets` / `/json/list`, sometimes linked via `openerId` or parent target metadata. Controlled Frame is IWA-specific; public docs do not promise a debuggable guest target.

**Working hypothesis (pending device runs):**

- **H1:** Guest is **not** listed — only the IWA outer page is attachable; screenshots are shell-only.
- **H2:** Guest appears as a **child target** — harness can attach and capture guest pixels when debugging is enabled.
- **H3:** Guest appears in target list but **rejects** `Page.captureScreenshot` (permissions / isolation).

`scripts/probe-controlled-frame-screenshot.mjs` automates listing targets and probing H1–H3 when CDP is available.

### Installed IWA vs Dev Mode Proxy

| Install mode | Origin | CDP in daily use | Screenshot relevance |
|--------------|--------|------------------|----------------------|
| **Dev Mode Proxy** | `isolated-app://…` proxying live Vite | Owner may enable `--remote-debugging-port` on dev Chrome | Good for harness development; Controlled Frame requires this install path anyway |
| **Signed `.swbn`** | `isolated-app://<webBundleId>/…` | Same — only when remote debugging enabled | Production-like; validate H1–H3 here before any product commitment |
| Plain `npm run dev` browser tab | `http://127.0.0.1:5173` | CDP works but **no** `<controlledframe>` | Not valid for CF screenshot spikes |

Dev Mode Proxy and signed installs should share Controlled Frame APIs, but **debugging attach points and compositing** may differ by Chrome version. Treat both checklist rows as mandatory.

### Scale, clipping, and viewport

CDP `Page.captureScreenshot` options relevant to browser tabs:

- **`clip`** — device-pixel rect relative to the **attached target’s** layout viewport. Useful to crop to the `.browser-frame-host` region if the outer capture includes chrome UI.
- **`captureBeyondViewport`** — tall pages; guest may still be viewport-limited inside the frame.
- **`fromSurface` / scale** — device scale factor on ChromeOS may produce large PNGs; agent payloads need byte caps if screenshots ship later.

Even if outer capture works, agents likely need **guest-local** coordinates. Without a guest target or CF API, clipping to guest bounds from the outer DOM may capture the wrong layer.

### Production non-CDP capture options

| Approach | Guest pixels? | Notes |
|----------|---------------|-------|
| `browser.snapshot` (current) | No — semantic tree | Primary automation path; no CDP |
| `html2canvas` / DOM-to-image on outer document | Unlikely | Does not cross Controlled Frame boundary |
| `canvas` / `drawImage` on terminal panes | N/A for browser tabs | Launcher host screenshots use terminal canvas readback only |
| `chrome.tabs.captureVisibleTab` | N/A | Extension API — not available to IWAs |
| Controlled Frame `executeScript` + canvas | Theoretical | No supported readback API documented; would be fragile and site-dependent |
| Future Chromium / CF API | Unknown | Track WICG / Chrome IWA release notes |

**No production-ready guest screenshot path is identified today.**

## Decision (interim)

1. **Do not** add `browser.screenshot` RPC or CDP-dependent production features until Chromebook checklist items are complete.
2. **Keep semantic automation primary** — `browser.snapshot` and interaction methods remain the supported agent surface if screenshots are unavailable or debug-only.
3. **Use** `scripts/probe-controlled-frame-screenshot.mjs` for repeatable CDP probes during device validation.
4. **Revisit** this ADR after evidence: accept a constrained screenshot RPC, document debug-only limitations, or explicitly reject visual capture for Controlled Frame.

## Consequences

- Agents must not depend on pixels for browser tabs in production builds.
- CDP screenshot harnesses are **spike / QA tools only**, aligned with ADR 0011’s dev CDP hooks — not an owner-facing feature.
- If H1 holds, visual browser context requires new platform APIs or remains out of scope.
- If H2 holds, any screenshot RPC must gate on debug builds or explicit owner opt-in with clear security review.

## Harness

```bash
# Dev machine or Crostini with port 9222 reachable
npm run probe:controlled-frame-screenshot

# Optional
CHROME_DEBUG_PORT=9222 GOSH_IWA_URL_MATCH=example.com npm run probe:controlled-frame-screenshot
```

Prerequisites:

- Chromium with `--remote-debugging-port=9222` (see `npm run dev:chrome` for local dev).
- Installed IWA with an open **browser** tab (not required for skeleton listing, required for meaningful capture tests).

## References

- [ADR 0014: Controlled Frame browser tabs](./0014-controlled-frame-browser-tabs.md)
- [ADR 0011: Agent control plane](./0011-agent-control-plane.md)
- `docs/agent/BROWSER.md`
- `scripts/probe-controlled-frame-screenshot.mjs`
- [Controlled Frame (Chrome IWA docs)](https://developer.chrome.com/docs/iwa/controlled-frame)
- [Chrome DevTools Protocol — Page.captureScreenshot](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot)
