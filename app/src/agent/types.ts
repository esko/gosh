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

export type PaneSurfaceKind = 'terminal' | 'browser';

export type PaneSplitOptions = {
  /** Source pane to split; defaults to the active pane in the tab. */
  paneId?: string;
  /** Surface kind for the new leaf; defaults to the source leaf surface. */
  surface?: PaneSurfaceKind;
};

export type TabKind = 'launcher' | 'terminal' | 'browser' | 'mixed';

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
  surface: PaneSurfaceKind;
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
  | 'pane.resized'
  | 'terminal.command.started'
  | 'terminal.command.completed'
  | 'browser.navigated';

export type AgentEvent = {
  seq: number;
  type: AgentEventType;
  at: number;
  windowId: string;
  tabId?: string;
  paneId?: string;
  commandId?: string;
  exitCode?: number | null;
  url?: string;
};

export type TerminalRunCompletion =
  | 'osc133'
  | 'timeout'
  | 'pane-closed'
  | 'disconnected'
  | 'cancelled';

export type TerminalRunResult = {
  command: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
  completion: TerminalRunCompletion;
  truncated: boolean;
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
  | 'paneDiagnostics'
  | 'browserNavigate'
  | 'browserBack'
  | 'browserForward'
  | 'browserReload'
  | 'browserWaitFor'
  | 'browserSnapshot'
  | 'browserQuery'
  | 'browserClick'
  | 'browserType'
  | 'browserPress'
  | 'browserGetUrl'
  | 'browserGetTitle'
  | 'subscribe';

export type AgentCapabilities = {
  methods: Record<AgentCapabilityMethod, { available: boolean; reason?: string }>;
};

export type PaneOsc133Diagnostics = {
  detected: boolean;
  phase: 'A' | 'B' | 'C' | 'D' | null;
  lastMarkerAt?: number;
  commandRunning: boolean;
  exitCode: number | null;
};

export type PaneDiagnostics = {
  osc133: PaneOsc133Diagnostics;
};

/**
 * Imperative seam implemented by the UI/adapter layer. The registry and
 * AgentControlService never import views or Restty types.
 */
export type PaneHost = {
  split(tabId: string, direction: SplitDirection, options?: PaneSplitOptions): Promise<{ paneId: string }>;
  focus(paneId: string): void;
  resize(paneId: string, direction: PaneDirection, amount: number): boolean;
  zoom(paneId: string, zoomed?: boolean): boolean;
  close(paneId: string): boolean;
  send(paneId: string, data: string): void;
  paneDiagnostics?(paneId: string): PaneDiagnostics | null;
  readViewport(paneId: string): TerminalTextCapture;
  readHistory(paneId: string, opts: { lastLines: number }): TerminalTextCapture;
  readRange(
    paneId: string,
    opts: { start: TerminalPosition; end: TerminalPosition },
  ): TerminalTextCapture;
  isZoomed?(paneId: string): boolean;
};

import type {
  BrowserQueryResult,
  BrowserSnapshotResult,
  BrowserWaitForResult,
  BrowserWaitForState,
} from '../browser/browserAutomationTypes';

/** Imperative seam for browser tabs (Controlled Frame). */
export type BrowserHost = {
  navigate(tabId: string, url: string): void;
  back(tabId: string): Promise<boolean>;
  forward(tabId: string): Promise<boolean>;
  reload(tabId: string): void;
  waitFor(
    tabId: string,
    input: {
      selector?: string;
      text?: string;
      loadState?: BrowserWaitForState;
      timeoutMs?: number;
      pollIntervalMs?: number;
    },
  ): Promise<BrowserWaitForResult>;
  snapshot(tabId: string, input?: { maxNodes?: number; maxBytes?: number }): Promise<BrowserSnapshotResult>;
  query(
    tabId: string,
    input: { role?: string; name?: string; text?: string; selector?: string },
  ): Promise<BrowserQueryResult>;
  click(tabId: string, input: { ref: string }): Promise<void>;
  type(tabId: string, input: { ref: string; text: string; clear?: boolean }): Promise<void>;
  press(tabId: string, input: { ref: string; key: string }): Promise<void>;
  getUrl(tabId: string): string;
  getTitle(tabId: string): string;
};

export function agentOk<T>(value: T): AgentResult<T> {
  return { ok: true, value };
}

export function agentErr(code: AgentErrorCode, message: string): AgentResult<never> {
  return { ok: false, error: { code, message } };
}
