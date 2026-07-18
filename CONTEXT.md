# Domain Context

## Product hierarchy

- A **terminal window** is one unframed IWA window with custom caption controls.
- A terminal window contains one or more app-rendered **tabs**.
- A tab contains one or more Restty-native **pane sessions**.
- Each pane session owns exactly one **transport** and may own one Eternal Terminal **resume identity**.

## Connection language

A **connection intent** is the reusable, normalized description used to open a
pane session. It identifies an SSH, Mosh, or Eternal Terminal destination and
its profile, identity, settings, and startup-command references. A resume
identity is runtime state owned by one ET pane session; it is not shared by a
tab or window.

Restty is the sole product renderer. A transport writes to a narrow
`TerminalSink`; renderer layout, focus, appearance, titles, tabs, and splits do
not belong in the transport boundary.

Multiple terminal windows remain valid. Native platform tabs are not part of
the product architecture.

## Agent control plane

The **agent control plane** is the in-process `AgentControlService` that
enumerates and drives windows, tabs, and panes for automation (CDP today;
authenticated external protocol / CLI / MCP later). Public identities are
opaque `windowId`, `tabId`, and `paneId` values owned by `WorkspaceRegistry`.
Restty's numeric pane ids stay an internal map and must not appear in agent
APIs. Adapters call the same service; they do not own session business logic.
See [ADR 0011](docs/adr/0011-agent-control-plane.md).
_Avoid_: scraping the terminal canvas, treating raw PTY logs as screen state

**OSC 133** shell-integration markers (prompt/command boundaries) are parsed per
pane in `OscParser` / `ResttyTerminalAdapter.getOsc133State()` for upcoming
`terminal.run` / `CommandTracker` work — not authoritative screen capture.

## Secondary sessions and paste

A **secondary session** is a short-lived SSH connection that reuses a pane
session's connection intent for a non-PTY purpose (remote image paste upload,
protocol bootstrap). It is not a pane session and does not own a transport.
_Avoid_: sidecar connection, helper SSH, background SSH

**Remote image paste** uploads clipboard image bytes to the remote filesystem
and inserts a shell-quoted path into the focused pane. It is distinct from
local Kitty paste, which renders media only in Restty and never crosses the
transport.
_Avoid_: image upload, path paste (ambiguous with local Kitty paste)

**Auth prompt policy** is whether a connection attempt may show password or
vault UI (`interactive`) or may only consume credentials already available
without prompting (`silent`). Pane sessions are interactive; secondary
sessions used for remote image paste are silent.
_Avoid_: auth mode, headless auth
