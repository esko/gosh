import { AgentEventBus } from './AgentEventBus';
import type { PaneInfo, PaneSurfaceKind, TabInfo, TabKind, WindowInfo } from './types';

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type TabRecord = {
  tabId: string;
  windowId: string;
  kind: TabKind;
  title: string;
};

type PaneRecord = {
  paneId: string;
  tabId: string;
  windowId: string;
  surface: PaneSurfaceKind;
  resttyPaneId?: number;
  leafId?: string;
  zoomed: boolean;
};

/**
 * UI-independent window/tab/pane model with opaque stable ids.
 * Restty numeric pane ids and mixed leaf ids stay internal.
 */
export class WorkspaceRegistry {
  readonly events: AgentEventBus;
  readonly windowId: string;

  private activeTabId: string | null = null;
  private readonly tabs = new Map<string, TabRecord>();
  private readonly panes = new Map<string, PaneRecord>();
  /** `${tabId}:${resttyPaneId}` → opaque paneId */
  private readonly resttyIndex = new Map<string, string>();
  /** `${tabId}:${leafId}` → opaque paneId */
  private readonly leafIndex = new Map<string, string>();
  private readonly activePaneByTab = new Map<string, string>();

  constructor(options?: { windowId?: string; events?: AgentEventBus }) {
    this.windowId = options?.windowId ?? newId('win');
    this.events = options?.events ?? new AgentEventBus();
  }

  listWindows(): WindowInfo[] {
    return [{ windowId: this.windowId, activeTabId: this.activeTabId }];
  }

  listTabs(): TabInfo[] {
    return [...this.tabs.values()].map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      kind: tab.kind,
      title: tab.title,
      active: tab.tabId === this.activeTabId,
      paneCount: this.paneIdsForTab(tab.tabId).length,
    }));
  }

  listPanes(filter?: { tabId?: string }): PaneInfo[] {
    const activePaneId = this.activeTabId ? this.activePaneByTab.get(this.activeTabId) ?? null : null;
    return [...this.panes.values()]
      .filter((p) => !filter?.tabId || p.tabId === filter.tabId)
      .map((p) => ({
        paneId: p.paneId,
        tabId: p.tabId,
        windowId: p.windowId,
        surface: p.surface,
        active: p.paneId === activePaneId,
        zoomed: p.zoomed,
      }));
  }

  getTab(tabId: string): TabRecord | undefined {
    return this.tabs.get(tabId);
  }

  getPane(paneId: string): PaneRecord | undefined {
    return this.panes.get(paneId);
  }

  /** Resolve opaque pane id → Restty numeric id (internal). */
  resttyPaneId(paneId: string): number | undefined {
    return this.panes.get(paneId)?.resttyPaneId;
  }

  /** Resolve Restty numeric id within a tab → opaque pane id. */
  paneIdForRestty(tabId: string, resttyPaneId: number): string | undefined {
    return this.resttyIndex.get(this.resttyKey(tabId, resttyPaneId));
  }

  /** Resolve mixed leaf id within a tab → opaque pane id. */
  paneIdForLeaf(tabId: string, leafId: string): string | undefined {
    return this.leafIndex.get(this.leafKey(tabId, leafId));
  }

  openTab(input: { kind: TabKind; title: string; tabId?: string }): string {
    const tabId = input.tabId ?? newId('tab');
    if (this.tabs.has(tabId)) {
      throw new Error(`tab already registered: ${tabId}`);
    }
    this.tabs.set(tabId, {
      tabId,
      windowId: this.windowId,
      kind: input.kind,
      title: input.title,
    });
    if (this.activeTabId === null) this.activeTabId = tabId;
    this.events.emit('tab.opened', { windowId: this.windowId, tabId });
    return tabId;
  }

  setTabTitle(tabId: string, title: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) tab.title = title;
  }

  setTabKind(tabId: string, kind: TabKind): void {
    const tab = this.tabs.get(tabId);
    if (tab) tab.kind = kind;
  }

  setActiveTab(tabId: string | null): void {
    if (tabId !== null && !this.tabs.has(tabId)) return;
    this.activeTabId = tabId;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  closeTab(tabId: string): boolean {
    if (!this.tabs.has(tabId)) return false;
    for (const paneId of this.paneIdsForTab(tabId)) {
      this.closePane(paneId);
    }
    this.tabs.delete(tabId);
    this.activePaneByTab.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.keys().next().value ?? null;
    }
    this.events.emit('tab.closed', { windowId: this.windowId, tabId });
    return true;
  }

  openPane(input: {
    tabId: string;
    surface: PaneSurfaceKind;
    resttyPaneId?: number;
    leafId?: string;
    paneId?: string;
    active?: boolean;
  }): string {
    const tab = this.tabs.get(input.tabId);
    if (!tab) throw new Error(`unknown tab: ${input.tabId}`);

    if (input.surface === 'terminal') {
      if (input.resttyPaneId === undefined) throw new Error('resttyPaneId required for terminal panes');
      const key = this.resttyKey(input.tabId, input.resttyPaneId);
      const existing = this.resttyIndex.get(key);
      if (existing) return existing;
    } else {
      if (!input.leafId) throw new Error('leafId required for browser panes');
      const key = this.leafKey(input.tabId, input.leafId);
      const existing = this.leafIndex.get(key);
      if (existing) return existing;
    }

    const paneId = input.paneId ?? newId('pane');
    this.panes.set(paneId, {
      paneId,
      tabId: input.tabId,
      windowId: this.windowId,
      surface: input.surface,
      resttyPaneId: input.resttyPaneId,
      leafId: input.leafId,
      zoomed: false,
    });
    if (input.surface === 'terminal' && input.resttyPaneId !== undefined) {
      this.resttyIndex.set(this.resttyKey(input.tabId, input.resttyPaneId), paneId);
    }
    if (input.surface === 'browser' && input.leafId) {
      this.leafIndex.set(this.leafKey(input.tabId, input.leafId), paneId);
    }
    if (input.active !== false || !this.activePaneByTab.has(input.tabId)) {
      this.activePaneByTab.set(input.tabId, paneId);
    }
    this.events.emit('pane.opened', { windowId: this.windowId, tabId: input.tabId, paneId });
    return paneId;
  }

  setActivePane(paneId: string): boolean {
    const pane = this.panes.get(paneId);
    if (!pane) return false;
    this.activePaneByTab.set(pane.tabId, paneId);
    this.events.emit('pane.focused', { windowId: this.windowId, tabId: pane.tabId, paneId });
    return true;
  }

  setPaneZoomed(paneId: string, zoomed: boolean): boolean {
    const pane = this.panes.get(paneId);
    if (!pane) return false;
    pane.zoomed = zoomed;
    if (zoomed) {
      for (const other of this.panes.values()) {
        if (other.tabId === pane.tabId && other.paneId !== paneId) other.zoomed = false;
      }
    }
    return true;
  }

  closePane(paneId: string): boolean {
    const pane = this.panes.get(paneId);
    if (!pane) return false;
    this.panes.delete(paneId);
    if (pane.resttyPaneId !== undefined) {
      this.resttyIndex.delete(this.resttyKey(pane.tabId, pane.resttyPaneId));
    }
    if (pane.leafId) {
      this.leafIndex.delete(this.leafKey(pane.tabId, pane.leafId));
    }
    if (this.activePaneByTab.get(pane.tabId) === paneId) {
      const next = this.paneIdsForTab(pane.tabId)[0];
      if (next) this.activePaneByTab.set(pane.tabId, next);
      else this.activePaneByTab.delete(pane.tabId);
    }
    this.events.emit('pane.closed', { windowId: this.windowId, tabId: pane.tabId, paneId });
    return true;
  }

  private paneIdsForTab(tabId: string): string[] {
    return [...this.panes.values()].filter((p) => p.tabId === tabId).map((p) => p.paneId);
  }

  private resttyKey(tabId: string, resttyPaneId: number): string {
    return `${tabId}:${resttyPaneId}`;
  }

  private leafKey(tabId: string, leafId: string): string {
    return `${tabId}:${leafId}`;
  }
}
