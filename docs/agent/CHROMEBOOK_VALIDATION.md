# Chromebook validation checklist

**Status: not validated** — this document is an operator template. Do not mark scenarios pass/fail until exercised on a real Chromebook with the installed IWA. Automated probes here report local script results only; they are not a substitute for on-device acceptance.

Related: [ADR 0013](../adr/0013-agent-control-transport.md) (C2 transport), [PROTOCOL.md](./PROTOCOL.md), [BROWSER.md](./BROWSER.md), [TEST_PLAN.md](../TEST_PLAN.md).

## Run metadata (fill on device)

| Field | Value |
| --- | --- |
| Date | |
| Operator | |
| ChromeOS version | |
| Chrome version | |
| IWA install path | Dev Mode Proxy / signed `.swbn` |
| IWA bundle ID | |
| Repo commit | |
| Gosh IWA version | |
| SSH host | |
| Mosh host | |
| ET / tsshd notes | |

## Prerequisites

1. Install Gosh on the Chromebook ([IWA_DEV_SETUP.md](../IWA_DEV_SETUP.md) or signed bundle).
2. Open at least one **terminal window** (listener binds only while a window is mounted).
3. Enable **Settings → Security → External agent control → On**.
4. Copy the listen port and pairing token into Crostini:

```bash
mkdir -p ~/.config/gosh && chmod 700 ~/.config/gosh
printf '%s' '<port-from-settings>' > ~/.config/gosh/port
printf '%s' '<token-from-settings>' > ~/.config/gosh/token
chmod 600 ~/.config/gosh/port ~/.config/gosh/token
```

5. Clone or sync this repo in Crostini (`npm install` once).

### Harness scripts (repo root)

| Script | npm alias | Purpose |
| --- | --- | --- |
| `scripts/probe-agent-control-transport.mjs` | `npm run probe:agent-control-transport` | Connect, authenticate, `gosh.capabilities`, `workspace.listTabs`, `workspace.listPanes` |
| `scripts/probe-agent-control-negative.mjs` | `npm run probe:agent-control-negative` | Unauthorized RPC, bad token, parse error, oversized frame, 5th-client reject |
| `scripts/verify-agent-control.mjs` | `npm run verify:agent-control` | CDP smoke of `window.__goshAgent` (dev proxy + `--remote-debugging-port=9222` only) |
| `scripts/probe-controlled-frame-screenshot.mjs` | `npm run probe:controlled-frame-screenshot` | CDP screenshot feasibility for browser tabs (ADR 0015) |
| `tools/goshctl` | `npm run goshctl -- …` | Full CLI over loopback transport after credentials are set |

Environment aliases accepted by probes: `GOSH_HOST`, `GOSH_PORT`, `GOSH_TOKEN` (also `GOSH_AGENT_*` / `GOSH_CONTROL_*`).

Quick transport smoke from Crostini:

```bash
npm run probe:agent-control-transport
npm run probe:agent-control-negative
```

Record script exit codes in **Notes** for C2 rows they cover; manual steps still required for suspend/resume, token reset, and UI-driven cases.

---

## Part A — C2 transport matrix (ADR 0013)

| Scenario | Steps | Pass criteria | Result | Notes |
| --- | --- | --- | --- | --- |
| IWA install + Direct Sockets permission | Install IWA; open terminal window; enable agent control in Settings | `TCPServerSocket` available; status pill shows `listening :<port>` on `127.0.0.1` | | |
| Loopback bind | In Settings, note port; from Chrome OS shell: `curl -v telnet://127.0.0.1:<port>` or `nc -v 127.0.0.1 <port>` | TCP connects to `127.0.0.1` only; not reachable from LAN | | |
| Crostini client reachability | From Crostini: `npm run probe:agent-control-transport` with port/token from Settings | Script exits 0; lists ≥1 tab and pane | | |
| penguin → browser loopback | Repeat probe from Crostini without port forwarding | Same RPC path as Chrome OS shell; document any firewall/namespace quirks | | |
| Authenticate + workspace RPC | `npm run goshctl -- capabilities` and `workspace list --json` | JSON results; no `unauthorized` after valid token | | |
| Close terminal window | Close the only terminal window; retry `nc` / probe | Listener stopped; port closed; probe fails to connect | | |
| Settings off | Disable agent control; retry probe | No listener; connection refused / immediate close | | |
| Suspend / resume | Suspend Chromebook with agent control on and a client connected; resume | Listener restarts or fails closed; stale sessions not left authenticated | | |
| Token reset while connected | Keep `goshctl events` or probe client open; reset token in Settings; send RPC | Next RPC returns `unauthorized` (-32002); well-formed reconnect with new token works | | |
| Frame > 1 MiB | `npm run probe:agent-control-negative` (oversized row) or send oversized NDJSON line | `payload-too-large` (-32003); connection stays up for well-formed traffic afterward | | |
| 5th simultaneous client | `npm run probe:agent-control-negative` (max-clients row) or open 5 `nc` sessions | 5th connection closed at accept; no unauthenticated control slot | | |
| Malformed NDJSON | Negative probe parse-error row or send `{not json}\n` | `parse-error` (-32700); server remains usable | | |
| Rate limit (optional) | Burst >30 RPC/s on one connection | Eventually rate-limited with `unauthorized` / rate message per server | | |

---

## Part B — E3 installed-IWA E2E matrix

Manual acceptance for transports, layout, lifecycle, and agent control on device. Use real hosts where noted.

| Scenario | Steps | Pass criteria | Result | Notes |
| --- | --- | --- | --- | --- |
| SSH session | Launch profile to Linux/macOS host via Direct Sockets SSH | Interactive shell; resize works; known-host prompt clear | | |
| Mosh session | Launch Mosh profile when `UDPSocket` available | `mosh-client.wasm` loads; interactive shell over UDP | | |
| ET session | Launch ET profile; detach and resume | ET worker attaches; resume restores session; lock contention handled | | |
| tsshd (WASM) session | Connect via tsshd transport if enabled in build | WASM sshd reaches shell; documented limitations only | | |
| Multi-tab | Open ≥2 caption tabs with different profiles/intents | Each tab independent; switching preserves sessions | | |
| Nested splits | Split pane vertically then horizontally | Each pane owns its transport; focus/resize per pane | | |
| Suspend / resume (sessions) | Suspend device with active SSH/Mosh tab; resume | Sessions reconnect or show clear recoverable error; no zombie panes | | |
| Reconnect | Kill remote sshd or drop network briefly; use in-app reconnect | Only affected pane/tab recovers; others unaffected | | |
| Concurrent agents | Enable agent control; connect two Crostini clients (`goshctl workspace list`) | Both authenticated; split/focus from either works; max 4 clients enforced | | |
| Browser tab + navigation | New browser tab; navigate to `https://example.com`; `goshctl` or MCP `browser.getUrl` | `kind: "browser"` tab; URL/title match; back/forward/reload work | | |
| Browser snapshot (semantic) | `browser.snapshot` on open browser tab | Bounded node tree with refs; secret fields redacted | | |
| Pairing revoke | Reset token or disable agent control while client connected | Clients get `unauthorized`; re-enable issues new token | | |
| Malformed traffic (transport) | Run `npm run probe:agent-control-negative` | All automated negative rows pass on device | | |
| IWA restart with stale clients | Connect agent client; force-quit IWA from launcher; relaunch | Old TCP sessions dead; new listener/port after reopen; old token invalid if rotated | | |
| Agent pane split via RPC | `goshctl pane split --pane <id> --right` | New pane appears in UI; distinct `paneId` | | |
| Agent terminal.run | `goshctl terminal run --pane <id> -- echo hello` (shell integration on host) | Output contains `hello`; exit code 0 | | |
| CDP agent smoke (dev only) | Dev Mode Proxy + `npm run dev:chrome`; `npm run verify:agent-control` | In-process `__goshAgent` checks pass (not a production transport test) | | |
| Controlled Frame screenshot probe | Open browser tab; `npm run probe:controlled-frame-screenshot` with CDP enabled | Record outer/nested capture outcome per ADR 0015 | | |

---

## After validation

1. Fill **Result** (`pass` / `fail` / `skip`) and **Notes** for every row exercised.
2. Update this document **Status** line at the top when C2 + E3 are complete.
3. Update [ADR 0013](../adr/0013-agent-control-transport.md) status when the C2 matrix is fully green.
4. File evidence (versions, failures, screenshots) in the GitHub issue tracker.

Do not commit filled pass/fail results from a device run unless the maintainer requests a documentation update with real evidence.
