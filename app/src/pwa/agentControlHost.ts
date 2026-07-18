/**
 * Wires WorkspaceRegistry + AgentControlService to the live tab/pane UI.
 * Kept out of views.ts so the control plane stays testable without DOM.
 */

import {
  AgentControlService,
  WorkspaceRegistry,
  buildPaneDiagnostics,
  type PaneDirection,
  type PaneHost,
  type SplitDirection,
  type TerminalPosition,
} from '../agent';
import type { ResttyTerminalAdapter } from './resttyAdapter';

export type AgentSessionRef = {
  id: string;
  kind: 'launcher' | 'terminal';
  terminal?: ResttyTerminalAdapter | null;
  panes: Map<number, { sink: { insertText(data: string): void } }>;
};

export type AgentSessionLookup = {
  findByTabId(tabId: string): AgentSessionRef | undefined;
  sleep(ms: number): Promise<void>;
};

let registry: WorkspaceRegistry | null = null;
let service: AgentControlService | null = null;

export function getWorkspaceRegistry(): WorkspaceRegistry {
  if (!registry) registry = new WorkspaceRegistry();
  return registry;
}

export function getAgentControlService(): AgentControlService {
  if (!service) {
    service = new AgentControlService({ registry: getWorkspaceRegistry(), host: null });
  }
  return service;
}

/** Reset singletons (unit tests / terminal route remount). */
export function resetAgentControl(): void {
  registry = null;
  service = null;
  const win = window as unknown as { __goshAgent?: AgentControlService };
  delete win.__goshAgent;
}

/** @deprecated Use {@link resetAgentControl}. */
export function resetAgentControlForTests(): void {
  resetAgentControl();
}

export function createPaneHost(lookup: AgentSessionLookup): PaneHost {
  const reg = getWorkspaceRegistry();

  const requireSession = (tabId: string): AgentSessionRef => {
    const session = lookup.findByTabId(tabId);
    if (!session) throw new Error(`Unknown tab: ${tabId}`);
    return session;
  };

  const requireTerminal = (tabId: string): ResttyTerminalAdapter => {
    const session = requireSession(tabId);
    if (!session.terminal) throw new Error(`Tab has no terminal: ${tabId}`);
    return session.terminal;
  };

  const requirePane = (paneId: string) => {
    const pane = reg.getPane(paneId);
    if (!pane) throw new Error(`Unknown pane: ${paneId}`);
    return pane;
  };

  return {
    async split(tabId: string, direction: SplitDirection) {
      const terminal = requireTerminal(tabId);
      const before = new Set(reg.listPanes({ tabId }).map((p) => p.paneId));
      terminal.split(direction);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const added = reg.listPanes({ tabId }).find((p) => !before.has(p.paneId));
        if (added) return { paneId: added.paneId };
        await lookup.sleep(20);
      }
      throw new Error('Split did not produce a new pane');
    },

    focus(paneId: string) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      terminal.focusPane(pane.resttyPaneId);
      reg.setActivePane(paneId);
    },

    resize(paneId: string, direction: PaneDirection, amount: number) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      terminal.focusPane(pane.resttyPaneId);
      return terminal.resizePaneToward(pane.resttyPaneId, direction, amount);
    },

    zoom(paneId: string, zoomed?: boolean) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      terminal.focusPane(pane.resttyPaneId);
      const currently = terminal.isPaneZoomed(pane.resttyPaneId);
      if (zoomed === undefined) {
        const ok = terminal.setPaneZoomed(pane.resttyPaneId, !currently);
        reg.setPaneZoomed(paneId, terminal.isPaneZoomed(pane.resttyPaneId));
        return ok;
      }
      const ok = terminal.setPaneZoomed(pane.resttyPaneId, zoomed);
      reg.setPaneZoomed(paneId, terminal.isPaneZoomed(pane.resttyPaneId));
      return ok;
    },

    close(paneId: string) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      return terminal.closePaneById(pane.resttyPaneId);
    },

    send(paneId: string, data: string) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      const conn = session.panes.get(pane.resttyPaneId);
      if (!conn) throw new Error(`Pane transport missing: ${paneId}`);
      conn.sink.insertText(data);
    },

    paneDiagnostics(paneId: string) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      const osc = terminal.getOsc133State(pane.resttyPaneId);
      if (!osc) return null;
      return buildPaneDiagnostics(osc);
    },

    readViewport(paneId: string) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      return terminal.captureViewportText(pane.resttyPaneId);
    },

    readHistory(paneId: string, opts: { lastLines: number }) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      return terminal.captureHistoryText(pane.resttyPaneId, opts);
    },

    readRange(paneId: string, opts: { start: TerminalPosition; end: TerminalPosition }) {
      const pane = requirePane(paneId);
      const terminal = requireTerminal(pane.tabId);
      return terminal.captureTextRange(pane.resttyPaneId, opts);
    },

    isZoomed(paneId: string) {
      const pane = requirePane(paneId);
      const session = lookup.findByTabId(pane.tabId);
      return session?.terminal?.isPaneZoomed(pane.resttyPaneId) ?? reg.getPane(paneId)?.zoomed ?? false;
    },
  };
}

/** Install PaneHost + expose development CDP hook. */
export function installAgentControl(lookup: AgentSessionLookup): AgentControlService {
  const agent = getAgentControlService();
  agent.setPaneHost(createPaneHost(lookup));
  const win = window as unknown as { __goshAgent?: AgentControlService };
  win.__goshAgent = agent;
  return agent;
}
