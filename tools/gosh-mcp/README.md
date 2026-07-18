# gosh-mcp

Thin [Model Context Protocol](https://modelcontextprotocol.io/) stdio server that translates MCP tool calls into the Gosh agent control JSON-RPC protocol (`docs/agent/PROTOCOL.md`). No workspace or terminal business logic lives here — only schema mapping and transport.

## Prerequisites

1. Gosh IWA running with **External agent control** enabled (Settings → Security).
2. Pairing token and loopback port from the Gosh settings UI (`127.0.0.1:<port>`).

## Install

```bash
cd tools/gosh-mcp
npm install
npm run build
```

## Environment

| Variable | Alias | Description |
|----------|-------|-------------|
| `GOSH_AGENT_PORT` | `GOSH_CONTROL_PORT` | Loopback TCP port from Gosh settings |
| `GOSH_AGENT_TOKEN` | `GOSH_CONTROL_TOKEN` | Pairing bearer token |
| `GOSH_AGENT_HOST` | `GOSH_CONTROL_HOST` | Default `127.0.0.1` |

## MCP tools

| MCP tool | Protocol method |
|----------|-----------------|
| `gosh_list_workspaces` | `workspace.listTabs` |
| `gosh_list_panes` | `workspace.listPanes` |
| `gosh_terminal_read` | `terminal.read` |
| `gosh_terminal_send` | `terminal.send` |
| `gosh_terminal_run` | `terminal.run` |
| `gosh_pane_split` | `pane.split` |
| `gosh_pane_resize` | `pane.resize` |
| `gosh_pane_focus` | `pane.focus` |
| `gosh_pane_zoom` | `pane.zoom` |
| `gosh_pane_close` | `pane.close` |

Tool results use MCP `structuredContent` with the JSON-RPC `result` payload.

## Claude Code MCP config

Add to `~/.claude/settings.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "gosh": {
      "command": "node",
      "args": ["/absolute/path/to/gosh/tools/gosh-mcp/dist/index.js"],
      "env": {
        "GOSH_AGENT_PORT": "38475",
        "GOSH_AGENT_TOKEN": "paste-pairing-token-from-gosh-settings"
      }
    }
  }
}
```

After building, you can also use the package bin:

```json
{
  "mcpServers": {
    "gosh": {
      "command": "node",
      "args": ["/absolute/path/to/gosh/tools/gosh-mcp/node_modules/.bin/gosh-mcp"],
      "env": {
        "GOSH_AGENT_PORT": "38475",
        "GOSH_AGENT_TOKEN": "paste-pairing-token-from-gosh-settings"
      }
    }
  }
}
```

Restart Claude Code after changing MCP settings.

## Development

```bash
npm test
npm run typecheck
```

## Protocol flow

1. MCP client invokes a `gosh_*` tool.
2. `gosh-mcp` maps arguments to JSON-RPC params and sends NDJSON over TCP to `127.0.0.1`.
3. On connect, the client authenticates with `gosh.authenticate`.
4. MCP cancellation (`AbortSignal`) rejects in-flight control requests on the adapter side.
