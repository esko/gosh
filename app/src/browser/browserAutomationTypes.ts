/** Structured browser automation types (Controlled Frame; no arbitrary evaluate). */

export const DEFAULT_SNAPSHOT_MAX_NODES = 200;
export const DEFAULT_SNAPSHOT_MAX_BYTES = 256_000;

export type BrowserSnapshotNode = {
  ref: string;
  role: string;
  name?: string;
  text?: string;
  tag?: string;
  href?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
};

export type BrowserSnapshotResult = {
  tabId: string;
  url: string;
  title: string;
  generation: number;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
  byteLength: number;
};

export type BrowserQueryMatch = {
  ref: string;
  role: string;
  name?: string;
  text?: string;
};

export type BrowserQueryResult = {
  tabId: string;
  matches: BrowserQueryMatch[];
};

export type BrowserWaitForState = 'load' | 'idle';

export type BrowserWaitForResult = {
  tabId: string;
  satisfied: boolean;
  reason: 'selector' | 'text' | 'load' | 'idle' | 'timeout';
};

export type BrowserNavigateResult = {
  tabId: string;
  url: string;
};

export type BrowserHistoryResult = {
  tabId: string;
  moved: boolean;
};

export type BrowserReloadResult = {
  tabId: string;
  reloaded: boolean;
};

export type BrowserUrlResult = {
  tabId: string;
  url: string;
};

export type BrowserTitleResult = {
  tabId: string;
  title: string;
};

export type BrowserInteractionResult = {
  tabId: string;
  ref: string;
};
