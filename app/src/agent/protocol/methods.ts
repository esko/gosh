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
  'browser.navigate',
  'browser.back',
  'browser.forward',
  'browser.reload',
  'browser.waitFor',
  'browser.snapshot',
  'browser.query',
  'browser.click',
  'browser.type',
  'browser.press',
  'browser.getUrl',
  'browser.getTitle',
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
  'pane.split': { tabId?: string; paneId?: string; direction: 'vertical' | 'horizontal'; surface?: 'terminal' | 'browser' };
  'pane.focus': { paneId: string };
  'pane.resize': { paneId: string; direction: 'left' | 'right' | 'up' | 'down'; amount?: number };
  'pane.zoom': { paneId: string; zoomed?: boolean };
  'pane.close': { paneId: string };
  'terminal.send': { paneId: string; data: string };
  'terminal.read': { paneId: string; maxBytes?: number; lastLines?: number };
  'terminal.run': { paneId: string; command: string; timeoutMs?: number; maxOutputBytes?: number };
  'pane.diagnostics': { paneId: string };
  'browser.navigate': { tabId?: string; paneId?: string; url: string };
  'browser.back': { tabId?: string; paneId?: string };
  'browser.forward': { tabId?: string; paneId?: string };
  'browser.reload': { tabId?: string; paneId?: string };
  'browser.waitFor': {
    tabId?: string;
    paneId?: string;
    selector?: string;
    text?: string;
    loadState?: 'load' | 'idle';
    timeoutMs?: number;
    pollIntervalMs?: number;
  };
  'browser.snapshot': { tabId?: string; paneId?: string; maxNodes?: number; maxBytes?: number };
  'browser.query': { tabId?: string; paneId?: string; role?: string; name?: string; text?: string; selector?: string };
  'browser.click': { tabId?: string; paneId?: string; ref: string };
  'browser.type': { tabId?: string; paneId?: string; ref: string; text: string; clear?: boolean };
  'browser.press': { tabId?: string; paneId?: string; ref: string; key: string };
  'browser.getUrl': { tabId?: string; paneId?: string };
  'browser.getTitle': { tabId?: string; paneId?: string };
  'events.subscribe': { types?: string[] };
};
