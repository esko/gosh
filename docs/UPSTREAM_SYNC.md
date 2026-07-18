# Upstream Sync

This repo copies selected Chromium libapps assets into `app/upstream/` so the IWA can serve nassh/wassh runtime files from its own origin.

## Sources

- `upstream/libapps/terminal/`
- `upstream/libapps/nassh/`
- `upstream/libapps/wassh/`
- `upstream/libapps/wasi-js-bindings/`
- `upstream/libapps/ssh_client/` plugin output
- Eternal Terminal protobuf schemas pinned by `scripts/fetch-et-protocol.mjs`

Initialize or refresh the submodule first:

```bash
git submodule update --init --depth 1 upstream/libapps
```

## Generated Assets

`scripts/fetch-upstream-assets.mjs` owns files under `app/upstream/`.

It must copy or generate:

- nassh JavaScript needed by `CommandInstance`
- nassh locales needed at runtime
- wassh JavaScript, including `wassh/js/sockets.js`
- WASI JS bindings
- OpenSSH plugin WASM
- `mosh-client.wasm`
- an asset manifest with source paths and sizes

Run:

```bash
npm run fetch-assets
```

Refresh the ET v6 schemas and their checked-in TypeScript codecs separately:

```bash
npm run fetch:et-protocol
```

The command should be repeatable. It should fail loudly when required upstream inputs are missing or when a documented patch can no longer be applied.

## Local Patch Rules

Do not hand-edit generated upstream files as normal application code. If a copied upstream file must differ:

1. Add a named patch function or transform in `scripts/fetch-upstream-assets.mjs`.
2. Document the reason in this file.
3. Keep the patch as small and searchable as possible.
4. Include a drift check so upstream changes fail the fetch instead of silently producing a broken asset.

Allowed patch reasons:

- IWA/Direct Sockets compatibility.
- Runtime URL adaptation for assets served from `/upstream/`.
- Chrome API polyfills that cannot live outside the copied file.
- Mosh or socket behavior required by upstream nassh/wassh in an IWA.

Forbidden patch reasons:

- Product UI customization.
- Debug shortcuts.
- Profile or settings behavior.
- Terminal emulator behavior.
- Changes that should live in a local adapter module.

## Restty Renderer Patch

Restty is a separately pinned renderer dependency under `vendor/restty/`, not a
copied libapps asset. `scripts/restty-renderer-patches.ts` contains one temporary
Vite transform for Restty 0.1.37. Powerline triangles used endpoint-inclusive
sampling, drawing their final one-pixel row at `cellTop + cellHeight` (outside
the cell) while leaving rounding-dependent gaps between rows. Filled Powerline
half circles (`U+E0B4` and `U+E0B6`) had no procedural cases at all, so they
fell back to font-atlas glyph constraints that could leave a seam against the
adjacent colored cell. The transform samples pixel centers, writes exactly one
row per rounded cell-height pixel, and draws the filled half circles from the
cell boundary. It fails the build if the pinned bundle changes, and should be
removed when the next pinned Restty release includes the upstream corrections.

## Restty Pane DOM Dependency

Restty exposes no public pane resize or maximize API. Keyboard pane **resize**
(`Ctrl+Alt+Arrow`) and **zoom** (`Ctrl+Shift+Z`) therefore depend on Restty's
internal split DOM, but that access is confined to
`app/src/pwa/resttyLayout.ts`. Agent code and the rest of the adapter call the
stable layout surface instead of querying `.pane-split` / flex styles directly.

### Public layout API (`resttyLayout.ts` + `ResttyTerminalAdapter`)

| Method | Purpose |
| --- | --- |
| `getLayoutTree()` | JSON-serializable split/pane tree (ids, orientation, flex %) |
| `resizePaneToward(paneId, direction, amount)` | Nudge the nearest matching split divider |
| `setPaneZoomed(paneId, zoomed)` | Maximize or restore a pane overlay |
| `isPaneZoomed(paneId)` | Whether a specific pane is maximized |

`ResttyTerminalAdapter` still exposes `resizeActivePane` /
`toggleZoomActivePane` for keyboard and context-menu bindings; those delegate to
the methods above.

### Private DOM contract (layout module only)

- Resize reads and writes inline `flex: 0 0 <pct>%` on the two children of each
  `.pane-split` node (`.is-vertical` / `.is-horizontal`), mirroring Restty's
  divider-drag math.
- Zoom overlays `.pane[data-pane-id]` with `position:absolute; inset:0`, which
  assumes `.pane-split` ancestors are unpositioned so the overlay anchors to
  the terminal root.

Pane focus/navigation uses Restty's public `setActivePane(id, { focus })` and is
not at risk.

### Drift check

`app/src/pwa/resttyLayout.drift.test.ts` reads `vendor/restty/dist/restty.esm.js`
and fails the build if the pane DOM markers above disappear. When bumping
`vendor/restty/`, also smoke-test directional focus, resize, and zoom with at
least three split panes.

## Refresh Procedure

1. Update `upstream/libapps` to the chosen commit.
2. Read relevant upstream changelog or source changes.
3. Run `npm run fetch-assets`.
4. Inspect `git diff -- app/upstream scripts/fetch-upstream-assets.mjs`.
5. Run `npm run typecheck`.
6. Run `npm run build`.
7. Smoke SSH in an installed IWA.
8. Smoke Mosh when UDP and `mosh-server` are available.
9. Update `docs/TEST_PLAN.md` with exact versions, commands, and results.

## Current Patch Ledger

Keep this ledger current as generated patches are added:

| Patch | Owner | Reason | Drift check |
| --- | --- | --- | --- |
| wassh Direct Sockets adaptation | `scripts/fetch-upstream-assets.mjs` | IWA socket compatibility | fetch script should verify expected socket symbols before patching |
| wassh TTY pixel dimensions | `scripts/fetch-upstream-assets.mjs` | Populate `TIOCGWINSZ` pixels for terminal image clients such as `kitten icat` | exact upstream zero-pixel block must match before replacement |
| nassh locale/bootstrap adaptation | `scripts/fetch-upstream-assets.mjs` and `app/src/ssh/` | Runtime messages without extension packaging | typecheck and SSH smoke |
| nassh Trusted Types policy skip | `scripts/fetch-upstream-assets.mjs` | CSP allowlists only `default`; upstream `createPolicy('nassh')` blocks SSH Worker startup | exact upstream `sanitizeScriptUrl` body must match before replacement |
| nassh Mosh COLORTERM export | `scripts/fetch-upstream-assets.mjs` | sshd often rejects `SendEnv COLORTERM`; export before `mosh-server` so truecolor apps work | exact mosh `remoteCommand` printf/exec lines must match before replacement |
| Restty pane resize/zoom DOM access | `app/src/pwa/resttyLayout.ts` | No public Restty resize/maximize API; drives `.pane-split` inline `flex` and a `.pane` overlay | `app/src/pwa/resttyLayout.drift.test.ts` + manual resize/zoom smoke with 3+ panes |
| Restty WASM text capture | `app/src/pwa/resttyPaneWasmRegistry.ts`, `app/src/pwa/resttyTextCapture.ts` | No public pane text API; agents read `RenderState` cell buffers via patched `ResttyWasm.create` + `restty_scrollbar_*` / `restty_debug_scroll_*` exports | `app/src/pwa/resttyTextCapture.test.ts` + agent `terminalRead` unit tests |

### Restty WASM text capture (agent `terminalRead`)

Restty exposes selection copy and render buffers internally, but no supported
`getPaneText()` API. Gosh captures authoritative terminal text from the same
WASM cell grids Restty uses for rendering:

- `ResttyTerminalAdapter.captureViewportText` / `captureHistoryText` /
  `captureTextRange` read `ResttyWasm.getRenderState(handle)` after
  `renderUpdate`.
- `resttyPaneWasmRegistry.ts` patches `ResttyWasm.prototype.create` once per tab
  to record per-pane handles during pane init (set via `beginPaneInit` in
  `appOptions`).
- History uses `restty_scrollbar_total`, `restty_scrollbar_offset`, and
  `restty_scroll_viewport` with explicit `truncated` metadata when the request
  exceeds available scrollback. Absolute line hints come from
  `restty_debug_scroll_left` / `restty_debug_scroll_right` when present.
- `captureHistory` prefers a single `getRenderState` read via the cell ABI
  (`restty_rows` / `restty_cell_*`) when the returned grid already covers the
  requested `lastLines` or full `scrollbar.total`, avoiding viewport scroll and
  live-terminal flicker. Scroll-windowing is only used when the buffer is
  viewport-sized (`state.rows` ≈ `scrollbar.len`) and older history is required.

**Not used:** `termDebugEl` `<pre>` scraping, PTY logs, OCR, or a second VT.

**Follow-up gaps:** public Restty text API; wrap-line metadata; alternate-screen
detection.
