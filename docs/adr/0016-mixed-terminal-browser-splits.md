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
- `browser.*` RPCs accept `tabId` on `kind: 'browser'` **or** `kind: 'mixed'` tabs (single browser leaf in the D4 slice).
- `pane.focus` / `pane.close` / `pane.resize` route to Gosh layout ops for mixed tabs; `pane.split` remains Restty-only (mixed split expansion is follow-up).

### UI (first slice)

- **New mixed tab:** new-tab menu or command palette → **New mixed tab** (requires an active connection spec) — vertical split, terminal left, browser right.
- **Convert:** command palette → **Split browser beside terminal** on an active terminal tab.
- Divider drag and `Ctrl+Alt+Arrow` resize adjust the Gosh split ratio; `Ctrl+Shift+Arrow` moves focus between leaves; `Ctrl+Shift+W` closes the focused mixed leaf (promotes surviving leaf to a single-kind tab when one remains).

### Serialization and restore

- `MixedLayout` supports `serializeLayout` / `deserializeLayout` (version **1**).
- **Not in this slice:** persisting mixed trees to `sessionStorage` / relaunch restore — documented as follow-up below.

## Consequences

- `views.ts` gains mixed-session lifecycle alongside existing terminal/browser tabs.
- `agentControlHost.ts` implements mixed routing for `PaneHost` and `BrowserHost`.
- CSS for `.mixed-split` / `.mixed-leaf` lives in `app/src/pwa/styles.css`.
- Terminal-only Restty tabs, SSH/Mosh/ET/tsshd transports, and browser automation semantics are preserved.

## Non-goals (this slice)

- Restty custom-pane factory for browser surfaces
- Nested mixed trees deeper than the bootstrap two-leaf split (API supports it; UI does not expose yet)
- `pane.split` adding new browser/terminal leaves via agent RPC
- Mixed-tab `sessionStorage` restore
- Per-browser-leaf `browser.*` targeting when multiple browser leaves exist (single browser leaf assumed)
- Zoom/maximize for mixed leaves

## Follow-up

- Persist and restore mixed layout + leaf surface state across reload
- Agent `pane.split` for mixed trees (new leaf of chosen `surface`)
- Horizontal bootstrap option in UI; drag-reorder leaves
- Multi-browser-leaf tabs with pane-scoped `browser.*` params

## References

- [ADR 0008: In-window tabs and splits](./0008-in-window-tabs-and-splits.md)
- [ADR 0014: Controlled Frame browser tabs](./0014-controlled-frame-browser-tabs.md)
- `app/src/layout/MixedLayout.ts`
- `docs/agent/BROWSER.md`
