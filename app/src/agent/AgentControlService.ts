import { buildCapabilities } from './capabilities';
import type { AgentEventBus, AgentEventListener, AgentSubscription } from './AgentEventBus';
import type { WorkspaceRegistry } from './WorkspaceRegistry';
import {
  agentErr,
  agentOk,
  type AgentCapabilities,
  type AgentEvent,
  type AgentResult,
  type PaneDirection,
  type PaneHost,
  type PaneInfo,
  type SplitDirection,
  type TabInfo,
  type WindowInfo,
} from './types';

export type AgentControlServiceOptions = {
  registry: WorkspaceRegistry;
  host?: PaneHost | null;
};

/**
 * Transport-independent product API for agent control.
 * CDP / CLI / MCP adapters must call this service rather than views or Restty.
 */
export class AgentControlService {
  private readonly registry: WorkspaceRegistry;
  private readonly events: AgentEventBus;
  private host: PaneHost | null;

  constructor(options: AgentControlServiceOptions) {
    this.registry = options.registry;
    this.events = options.registry.events;
    this.host = options.host ?? null;
  }

  setPaneHost(host: PaneHost | null): void {
    this.host = host;
  }

  capabilities(): AgentCapabilities {
    return buildCapabilities({ hasPaneHost: this.host !== null });
  }

  listWindows(): AgentResult<WindowInfo[]> {
    return agentOk(this.registry.listWindows());
  }

  listTabs(): AgentResult<TabInfo[]> {
    return agentOk(this.registry.listTabs());
  }

  listPanes(filter?: { tabId?: string }): AgentResult<PaneInfo[]> {
    if (filter?.tabId && !this.registry.getTab(filter.tabId)) {
      return agentErr('not-found', `Unknown tab: ${filter.tabId}`);
    }
    return agentOk(this.registry.listPanes(filter));
  }

  async paneSplit(input: {
    tabId?: string;
    direction: SplitDirection;
  }): Promise<AgentResult<{ paneId: string; tabId: string }>> {
    const host = this.requireHost();
    if (!host.ok) return host;
    const tabId = input.tabId ?? this.registry.getActiveTabId();
    if (!tabId) return agentErr('not-found', 'No active tab');
    if (!this.registry.getTab(tabId)) return agentErr('not-found', `Unknown tab: ${tabId}`);
    if (input.direction !== 'vertical' && input.direction !== 'horizontal') {
      return agentErr('invalid-argument', 'direction must be vertical or horizontal');
    }
    try {
      const { paneId } = await host.value.split(tabId, input.direction);
      return agentOk({ paneId, tabId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneFocus(input: { paneId: string }): AgentResult<{ paneId: string }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      host.value.focus(input.paneId);
      this.registry.setActivePane(input.paneId);
      return agentOk({ paneId: input.paneId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneResize(input: {
    paneId: string;
    direction: PaneDirection;
    amount?: number;
  }): AgentResult<{ paneId: string; resized: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    const dirs: PaneDirection[] = ['left', 'right', 'up', 'down'];
    if (!dirs.includes(input.direction)) {
      return agentErr('invalid-argument', 'direction must be left|right|up|down');
    }
    const amount = input.amount ?? 6;
    if (!Number.isFinite(amount) || amount <= 0) {
      return agentErr('invalid-argument', 'amount must be a positive number');
    }
    try {
      const resized = host.value.resize(input.paneId, input.direction, amount);
      if (resized) {
        this.events.emit('pane.resized', {
          windowId: this.registry.windowId,
          tabId: this.registry.getPane(input.paneId)?.tabId,
          paneId: input.paneId,
        });
      }
      return agentOk({ paneId: input.paneId, resized });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneZoom(input: { paneId: string; zoomed?: boolean }): AgentResult<{ paneId: string; zoomed: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      const ok = host.value.zoom(input.paneId, input.zoomed);
      if (!ok) return agentErr('failed', 'Zoom operation failed');
      const zoomed =
        host.value.isZoomed?.(input.paneId) ??
        this.registry.getPane(input.paneId)?.zoomed ??
        Boolean(input.zoomed);
      this.registry.setPaneZoomed(input.paneId, zoomed);
      return agentOk({ paneId: input.paneId, zoomed });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  paneClose(input: { paneId: string }): AgentResult<{ paneId: string; closed: boolean }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    try {
      const closed = host.value.close(input.paneId);
      if (!closed) return agentErr('failed', 'Close refused (last pane or unknown)');
      // UI onPaneClose updates the registry; keep this idempotent if it raced.
      this.registry.closePane(input.paneId);
      return agentOk({ paneId: input.paneId, closed: true });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  terminalSend(input: { paneId: string; data: string }): AgentResult<{ paneId: string }> {
    const host = this.requireHost();
    if (!host.ok) return host;
    if (!this.registry.getPane(input.paneId)) {
      return agentErr('not-found', `Unknown pane: ${input.paneId}`);
    }
    if (typeof input.data !== 'string') {
      return agentErr('invalid-argument', 'data must be a string');
    }
    try {
      host.value.send(input.paneId, input.data);
      return agentOk({ paneId: input.paneId });
    } catch (err) {
      return agentErr('failed', err instanceof Error ? err.message : String(err));
    }
  }

  terminalRead(): AgentResult<never> {
    return agentErr('unavailable', 'terminalRead is not implemented in this build');
  }

  terminalRun(): AgentResult<never> {
    return agentErr('unavailable', 'terminalRun is not implemented in this build');
  }

  subscribe(listener: AgentEventListener): AgentSubscription {
    return this.events.subscribe(listener);
  }

  /** Test / CDP helper: drain a promise of the next matching event. */
  waitForEvent(type: AgentEvent['type'], timeoutMs = 2000): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.dispose();
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const sub = this.subscribe((event) => {
        if (event.type !== type) return;
        clearTimeout(timer);
        sub.dispose();
        resolve(event);
      });
    });
  }

  private requireHost(): AgentResult<PaneHost> {
    if (!this.host) return agentErr('unavailable', 'Pane host is not wired');
    return agentOk(this.host);
  }
}
