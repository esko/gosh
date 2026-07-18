# ADR 0016: Mixed terminal/browser splits (Gosh-owned layout)

## Status

Accepted (2026-07-19). Implements backlog **D4** as a first vertical slice.

## Context

- ADR 0008 keeps **terminal-only** tabs on Restty's native multi-pane manager for performance and mature split behavior.
- ADR 0014 added **browser-only** tabs as Controlled Frame surfaces — never `<iframe>` and never painted into the terminal canvas.
- Agents need opaque pane ids for both surface kinds (`workspace.listPanes`) and a path toward layouts that combine SSH work with embedded web UIs.

Alternatives considered:

1. **Gosh-owned generic split tree** with terminal leaves (single-pane Restty) and browser leaves (Controlled Frame) — **chosen for this slice**.
2. Restty custom-pane factory rendering browser DOM inside the terminal surface — rejected (would fake browser in canvas / break CF isolation).
3. Convert every tab to Gosh-owned splits including terminal-only — rejected for this slice (unnecessary churn vs ADR 0008).

## Decision

### Layout ownership

- Introduce `TabKind: 'mixed'` and a **serializable** split tree in `app/src/layout/MixedLayout.ts` (`leaf` + `split` nodes; no DOM in public types).
- Each **terminal leaf** hosts its own single-pane Restty instance (Restty-internal splits are not the mixed-tab model).
- Each **browser leaf** mounts a real Controlled Frame via `mountBrowserSession` in a normal DOM subtree — never Kitty graphics or terminal canvas embed.
- **Terminal-only tabs** remain unchanged: Restty still owns splits inside those tabs.

### Registry and agent APIs

- `WorkspaceRegistry.openPane` records `surface: 'terminal' | 'browser'`.
- Terminal panes index by `resttyPaneId`; browser panes index by `leafId`.
- `workspace.listPanes` returns `surface` on each `PaneInfo` (opaque ids only; no Restty numeric ids).
- `browser.*` RPCs accept `tabId` on `kind: 'browser'` **or** `kind: 'mixed'` tabs. Optional `paneId` targets a specific browser leaf when multiple exist; otherwise the focused browser pane (or first browser pane) is used.
- `pane.focus` / `pane.close` / `pane.resize` / `pane.split` route to Gosh layout ops for mixed tabs (`pane.split` accepts optional `surface` for the new leaf).

### UI (first slice)

- **New mixed tab:** new-tab menu or command palette → **New mixed tab (side by side)** (vertical split: terminal left, browser right) or **New mixed tab (stacked)** (horizontal split: terminal above browser). Requires an active connection spec.
- **Convert:** command palette → **Split browser beside terminal** (vertical) or **Split browser below terminal** (horizontal) on an active terminal tab.
- Divider drag and `Ctrl+Alt+Arrow` resize adjust the Gosh split ratio; `Ctrl+Shift+Arrow` moves focus between leaves; `Ctrl+Shift+W` closes the focused mixed leaf (promotes surviving leaf to a single-kind tab when one remains).
- **Zoom:** `Ctrl+Shift+Z` toggles maximize for the focused mixed leaf (same binding as Restty pane zoom on terminal-only tabs). Restores prior split ratios on toggle.

### Serialization and restore

- `MixedLayout` supports `serializeLayout` / `deserializeLayout` (version **1**).
- Per-window `sessionStorage` (`gosh-tab-layout`, version **2**) persists terminal, mixed, and browser-only tabs across **reload** (same window), not app relaunch:
  - Terminal tabs: `LaunchConnectionIntent` (+ ET resume id when applicable).
  - Mixed tabs: connection spec, serialized layout tree, and browser leaf URLs when navigated away from `about:blank`.
  - Browser-only tabs: navigated URL and optional page title (`about:blank` tabs are omitted).
  - Active tab index among restorable tabs (launcher tabs remain ephemeral).
  - Optional `connectionKey` stores window connection identity when browser-only tabs are present.
- Legacy versionless `{ specs, activeIndex }` payloads migrate to version 2 on load.

## Consequences

- `views.ts` gains mixed-session lifecycle alongside existing terminal/browser tabs.
- `agentControlHost.ts` implements mixed routing for `PaneHost` and `BrowserHost`.
- CSS for `.mixed-split` / `.mixed-leaf` lives in `app/src/pwa/styles.css`.
- Terminal-only Restty tabs, SSH/Mosh/ET/tsshd transports, and browser automation semantics are preserved.

## Non-goals (this slice)

- Restty custom-pane factory for browser surfaces
- Nested mixed trees deeper than the bootstrap two-leaf split (API supports split expansion; UI shortcuts still target the active leaf only)
- App relaunch / cross-window tab restore (sessionStorage is per-window and cleared on relaunch)

## Follow-up

- Drag-reorder leaves
- Keyboard/UI shortcuts for mixed `pane.split` (agent RPC is implemented)

## References

- [ADR 0008: In-window tabs and splits](./0008-in-window-tabs-and-splits.md)
- [ADR 0014: Controlled Frame browser tabs](./0014-controlled-frame-browser-tabs.md)
- `app/src/layout/MixedLayout.ts`
- `docs/agent/BROWSER.md`
