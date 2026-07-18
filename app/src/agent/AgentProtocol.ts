/**
 * Shared method names and request/response shapes for the in-process agent
 * API (v0). External JSON-RPC adapters will reuse these names later.
 */

export const AGENT_PROTOCOL_VERSION = 0;

export const AGENT_METHODS = [
  'gosh.capabilities',
  'workspace.listWindows',
  'workspace.listTabs',
  'workspace.listPanes',
  'pane.split',
  'pane.focus',
  'pane.resize',
  'pane.zoom',
  'pane.close',
  'terminal.send',
  'terminal.read',
  'terminal.run',
  'events.subscribe',
] as const;

export type AgentMethodName = (typeof AGENT_METHODS)[number];
