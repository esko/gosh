# ADR 0011: Agent control plane

## Status

Accepted (2026-07-19).

## Context

Gosh needs a first-class way for coding agents to enumerate windows, tabs, and
panes, drive splits/focus/resize/zoom/close, send terminal input, and (later)
read authoritative terminal state and run shell commands. Those capabilities
must be reachable from development CDP, an authenticated external protocol, a
CLI, and a thin MCP adapter — without each adapter inventing its own session
model.

Today tabs and panes live as module globals in `app/src/pwa/views.ts`
(`sessions`, Restty numeric pane ids). CDP smoke tests reach
`window.__resttyAdapter` directly. That couples automation to UI and Restty
internals and cannot grow into a secure external control surface.

## Decision

- The product API is an in-process, transport-independent
  `AgentControlService` under `app/src/agent/`.
- UI, CDP (`window.__goshAgent` in development), TCP/JSON-RPC, CLI, and MCP
  call that same service. MCP stays an adapter with no workspace/terminal
  business logic.
- `WorkspaceRegistry` owns window/tab/pane lifecycle with opaque stable ids
  (`windowId`, `tabId`, `paneId`). Restty numeric pane ids are an internal
  map only and never appear in public return types.
- Imperative pane ops go through an injected `PaneHost` seam implemented by
  the UI/adapter layer, so the registry stays free of DOM and Restty objects.
- Development exposes `window.__goshAgent`. Production external control is
  deferred: disabled by default, authenticated, and covered by a later
  transport ADR.
- Structured errors use stable codes (`not-found`, `unavailable`,
  `invalid-argument`, `failed`). `capabilities()` reports implemented vs
  unavailable methods accurately.

## Non-goals (this ADR / foundation slice)

- Networking, pairing, CLI, or MCP servers.
- Controlled Frame browser tabs or browser automation.
- Authoritative terminal text capture or `terminal.run` / OSC 133.
- Public Restty layout/text APIs (tracked separately; resize/zoom may still
  use existing adapter methods that encapsulate private DOM).

## Consequences

- `views.ts` registers tabs and panes with the registry but keeps DOM,
  transports, and auth UI privately.
- CDP tests should prefer `__goshAgent` for control-plane assertions; raw
  `__resttyAdapter` remains a renderer debug hook.
- Later slices (layout API, text capture, protocol, browser) extend the same
  service and capability flags without inventing parallel session models.
