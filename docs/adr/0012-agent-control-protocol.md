# ADR 0012: Agent control wire protocol

## Status

Accepted (2026-07-19).

## Context

ADR 0011 defines the in-process `AgentControlService` API. External clients (CLI, MCP adapter, authenticated TCP) need a stable, versioned wire format that maps onto that service without duplicating workspace or terminal logic.

## Decision

- Use **JSON-RPC 2.0** messages framed as **NDJSON** (one object per line, UTF-8).
- Protocol version **1** (`AGENT_PROTOCOL_VERSION`) is negotiated via `gosh.capabilities`.
- Shared TypeScript types, error codes, framing, and light param validation live under `app/src/agent/protocol/`.
- Method names match `AgentControlService` entry points (`workspace.listTabs`, `pane.split`, etc.).
- Application errors reuse `AgentErrorCode` in `error.data`; protocol errors use JSON-RPC and Gosh extension codes (timeout, cancelled, unauthorized, payload-too-large).

Full wire details: [`docs/agent/PROTOCOL.md`](../agent/PROTOCOL.md).

## Non-goals (this ADR)

- TCP listeners, pairing, authentication, CLI binaries, or MCP servers.
- Mapping validated requests to `AgentControlService` (next transport slice).

## Consequences

- Clients import from `app/src/agent/protocol` or `app/src/agent` re-exports.
- `AgentProtocol.ts` remains a thin compatibility shim over `protocol/methods.ts`.
- Transport implementations must enforce frame size limits and stream NDJSON safely.
