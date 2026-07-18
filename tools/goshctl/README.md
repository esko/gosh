# goshctl

Thin Node CLI for the Gosh agent control server (ADR 0013). It speaks NDJSON JSON-RPC over loopback TCP and reuses wire types from `app/src/agent/protocol/`.

## Prerequisites

1. In Gosh: **Settings → Security → External agent control → On**
2. Note the listen address (`127.0.0.1:<port>`) and copy the pairing token
3. Export credentials or write owner-only config files:

```bash
mkdir -p ~/.config/gosh
chmod 700 ~/.config/gosh
printf '%s' '<token-from-settings>' > ~/.config/gosh/token
chmod 600 ~/.config/gosh/token
printf '%s' '<port-from-settings>' > ~/.config/gosh/port
chmod 600 ~/.config/gosh/port
```

Environment overrides:

| Variable | Default / source |
|----------|------------------|
| `GOSH_HOST` | `127.0.0.1` |
| `GOSH_PORT` | `~/.config/gosh/port` (required if unset) |
| `GOSH_TOKEN` | `~/.config/gosh/token` (required if unset) |

The control server binds an **ephemeral** loopback port while a terminal window is open (see `docs/agent/PROTOCOL.md`). There is no fixed default port.

## Run

From the repo root:

```bash
npm run goshctl -- capabilities
node --experimental-strip-types tools/goshctl/src/main.ts workspace list --json
```

## Examples

```bash
export GOSH_TOKEN='…' GOSH_PORT='54321'

goshctl capabilities
goshctl workspace list --json
goshctl pane list --json
goshctl terminal read --pane pane_abc
goshctl terminal send --pane pane_abc -- 'ls -la\n'
printf 'date\n' | goshctl terminal send --pane pane_abc --stdin
goshctl terminal run --pane pane_abc -- echo hello
goshctl pane split --pane pane_abc --right
goshctl pane resize --pane pane_abc --right --amount 8
goshctl pane focus --pane pane_abc
goshctl pane zoom --pane pane_abc
goshctl pane close --pane pane_abc
goshctl events --json
```

`terminal run` passes the argv after `--` as a single command string to the protocol (no `sh -c`).

## Output and exit codes

- Structured commands print JSON to stdout; errors print to stderr.
- `terminal read` prints captured text by default (`--json` for the full RPC result).
- `terminal run` prints command output by default and exits with the remote `exitCode` on RPC success.
- Exit `1` — usage, connection, or protocol failure
- Exit `2` — JSON-RPC error from the server

## Tests

```bash
npm run test:goshctl
```
