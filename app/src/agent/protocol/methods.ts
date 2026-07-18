/**
 * JSON-RPC method names for the Gosh agent control plane.
 * Names match AgentControlService entry points; adapters map params/results later.
 */

export const AGENT_PROTOCOL_VERSION = 1;

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
  'pane.diagnostics',
  'events.subscribe',
] as const;

export type AgentMethodName = (typeof AGENT_METHODS)[number];

const METHOD_SET = new Set<string>(AGENT_METHODS);

export function isAgentMethodName(method: string): method is AgentMethodName {
  return METHOD_SET.has(method);
}

/** Server → client event push (notification, not a client-callable method). */
export const AGENT_EVENT_NOTIFICATION = 'events.push' as const;

export type AgentRpcParams = {
  'gosh.capabilities': { protocolVersion?: number };
  'workspace.listWindows': Record<string, never>;
  'workspace.listTabs': Record<string, never>;
  'workspace.listPanes': { tabId?: string };
  'pane.split': { tabId?: string; direction: 'vertical' | 'horizontal' };
  'pane.focus': { paneId: string };
  'pane.resize': { paneId: string; direction: 'left' | 'right' | 'up' | 'down'; amount?: number };
  'pane.zoom': { paneId: string; zoomed?: boolean };
  'pane.close': { paneId: string };
  'terminal.send': { paneId: string; data: string };
  'terminal.read': { paneId: string; maxBytes?: number };
  'terminal.run': { paneId: string; command: string; timeoutMs?: number };
  'pane.diagnostics': { paneId: string };
  'events.subscribe': { types?: string[] };
};
