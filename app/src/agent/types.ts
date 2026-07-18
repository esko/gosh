/** Stable structured error codes for the agent control plane. */
export type AgentErrorCode =
  | 'not-found'
  | 'unavailable'
  | 'invalid-argument'
  | 'failed';

export type AgentError = {
  code: AgentErrorCode;
  message: string;
};

export type AgentResult<T> = { ok: true; value: T } | { ok: false; error: AgentError };

export type PaneDirection = 'left' | 'right' | 'up' | 'down';
export type SplitDirection = 'vertical' | 'horizontal';

export type TabKind = 'launcher' | 'terminal';

export type WindowInfo = {
  windowId: string;
  activeTabId: string | null;
};

export type TabInfo = {
  tabId: string;
  windowId: string;
  kind: TabKind;
  title: string;
  active: boolean;
  paneCount: number;
};

export type PaneInfo = {
  paneId: string;
  tabId: string;
  windowId: string;
  active: boolean;
  zoomed: boolean;
};

export type TerminalPosition = { row: number; col: number };

export type TerminalTextCapture = {
  lines: string[];
  cols: number;
  rows: number;
  cursor?: { row: number; col: number };
  wrapping: boolean | 'unknown';
  coordinates?: {
    origin: 'viewport' | 'absolute';
    startLine?: number;
    endLine?: number;
  };
  truncated: boolean;
  truncationReason?: string;
};

export type TerminalReadResult = {
  paneId: string;
  capture: TerminalTextCapture;
  text: string;
  truncated: boolean;
};

export type AgentEventType =
  | 'tab.opened'
  | 'tab.closed'
  | 'pane.opened'
  | 'pane.closed'
  | 'pane.focused'
  | 'pane.resized';

export type AgentEvent = {
  seq: number;
  type: AgentEventType;
  at: number;
  windowId: string;
  tabId?: string;
  paneId?: string;
};

export type AgentCapabilityMethod =
  | 'capabilities'
  | 'listWindows'
  | 'listTabs'
  | 'listPanes'
  | 'paneSplit'
  | 'paneFocus'
  | 'paneResize'
  | 'paneZoom'
  | 'paneClose'
  | 'terminalSend'
  | 'terminalRead'
  | 'terminalRun'
  | 'subscribe';

export type AgentCapabilities = {
  methods: Record<AgentCapabilityMethod, { available: boolean; reason?: string }>;
};

/**
 * Imperative seam implemented by the UI/adapter layer. The registry and
 * AgentControlService never import views or Restty types.
 */
export type PaneHost = {
  split(tabId: string, direction: SplitDirection): Promise<{ paneId: string }>;
  focus(paneId: string): void;
  resize(paneId: string, direction: PaneDirection, amount: number): boolean;
  zoom(paneId: string, zoomed?: boolean): boolean;
  close(paneId: string): boolean;
  send(paneId: string, data: string): void;
  readViewport(paneId: string): TerminalTextCapture;
  readHistory(paneId: string, opts: { lastLines: number }): TerminalTextCapture;
  readRange(
    paneId: string,
    opts: { start: TerminalPosition; end: TerminalPosition },
  ): TerminalTextCapture;
  isZoomed?(paneId: string): boolean;
};

export function agentOk<T>(value: T): AgentResult<T> {
  return { ok: true, value };
}

export function agentErr(code: AgentErrorCode, message: string): AgentResult<never> {
  return { ok: false, error: { code, message } };
}
