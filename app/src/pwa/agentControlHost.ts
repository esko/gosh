/**
 * Wires WorkspaceRegistry + AgentControlService to the live tab/pane UI.
 * Kept out of views.ts so the control plane stays testable without DOM.
 */

import {
  AgentControlService,
  WorkspaceRegistry,
  buildPaneDiagnostics,
  type BrowserHost,
  type PaneDirection,
  type PaneHost,
  type SplitDirection,
  type TerminalPosition,
} from '../agent';
import type { ControlledFrameController, ControlledFrameNavState } from '../browser/ControlledFrameController';
import type { MixedLayoutDomMount } from '../layout/mixedLayoutDom';
import type { ResttyTerminalAdapter } from './resttyAdapter';
import type { TerminalSubscription } from '../terminal/TerminalAdapter';

export type MixedLeafRef = {
  leafId: string;
  surface: 'terminal' | 'browser';
  terminal?: ResttyTerminalAdapter | null;
  browser?: ControlledFrameController | null;
};

export type AgentSessionRef = {
  id: string;
  kind: 'launcher' | 'terminal' | 'browser' | 'mixed';
  terminal?: ResttyTerminalAdapter | null;
  browser?: ControlledFrameController | null;
  mixedLeaves?: Map<string, MixedLeafRef>;
  mixedMount?: MixedLayoutDomMount | null;
  panes: Map<number, { sink: { insertText(data: string): void } }>;
};

export type AgentSessionLookup = {
  findByTabId(tabId: string): AgentSessionRef | undefined;
  sleep(ms: number): Promise<void>;
  closeMixedPane?: (tabId: string, paneId: string) => boolean;
  focusMixedPane?: (tabId: string, paneId: string) => void;
  resizeMixedPane?: (tabId: string, paneId: string, direction: PaneDirection, amount: number) => boolean;
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
  registry?.closeWindow();
  registry = null;
  service = null;
  if (typeof window !== 'undefined') {
    const win = window as unknown as { __goshAgent?: AgentControlService };
    delete win.__goshAgent;
  }
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

  const requirePane = (paneId: string) => {
    const pane = reg.getPane(paneId);
    if (!pane) throw new Error(`Unknown pane: ${paneId}`);
    return pane;
  };

  const terminalForPane = (session: AgentSessionRef, pane: ReturnType<typeof requirePane>): ResttyTerminalAdapter => {
    if (pane.surface !== 'terminal' || pane.resttyPaneId === undefined) {
      throw new Error(`Pane is not a terminal surface: ${pane.paneId}`);
    }
    if (session.kind === 'mixed') {
      for (const leaf of session.mixedLeaves?.values() ?? []) {
        if (leaf.surface === 'terminal' && leaf.terminal) return leaf.terminal;
      }
      throw new Error(`Mixed tab has no terminal leaf: ${session.id}`);
    }
    if (!session.terminal) throw new Error(`Tab has no terminal: ${session.id}`);
    return session.terminal;
  };


  return {
    async split(tabId: string, direction: SplitDirection) {
      const session = requireSession(tabId);
      if (session.kind === 'mixed') {
        throw new Error('Mixed tabs do not support Restty pane.split yet');
      }
      const terminal = session.terminal;
      if (!terminal) throw new Error(`Tab has no terminal: ${tabId}`);
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
      const session = requireSession(pane.tabId);
      if (session.kind === 'mixed') {
        lookup.focusMixedPane?.(pane.tabId, paneId);
        reg.setActivePane(paneId);
        return;
      }
      const terminal = terminalForPane(session, pane);
      terminal.focusPane(pane.resttyPaneId!);
      reg.setActivePane(paneId);
    },

    resize(paneId: string, direction: PaneDirection, amount: number) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      if (session.kind === 'mixed') {
        return lookup.resizeMixedPane?.(pane.tabId, paneId, direction, amount) ?? false;
      }
      const terminal = terminalForPane(session, pane);
      terminal.focusPane(pane.resttyPaneId!);
      return terminal.resizePaneToward(pane.resttyPaneId!, direction, amount);
    },

    zoom(paneId: string, zoomed?: boolean) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      if (session.kind === 'mixed') {
        return false;
      }
      const terminal = terminalForPane(session, pane);
      terminal.focusPane(pane.resttyPaneId!);
      const currently = terminal.isPaneZoomed(pane.resttyPaneId!);
      if (zoomed === undefined) {
        const ok = terminal.setPaneZoomed(pane.resttyPaneId!, !currently);
        reg.setPaneZoomed(paneId, terminal.isPaneZoomed(pane.resttyPaneId!));
        return ok;
      }
      const ok = terminal.setPaneZoomed(pane.resttyPaneId!, zoomed);
      reg.setPaneZoomed(paneId, terminal.isPaneZoomed(pane.resttyPaneId!));
      return ok;
    },

    close(paneId: string) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      if (session.kind === 'mixed') {
        return lookup.closeMixedPane?.(pane.tabId, paneId) ?? false;
      }
      const terminal = terminalForPane(session, pane);
      return terminal.closePaneById(pane.resttyPaneId!);
    },

    send(paneId: string, data: string) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      const conn = session.panes.get(pane.resttyPaneId!);
      if (!conn) throw new Error(`Pane transport missing: ${paneId}`);
      conn.sink.insertText(data);
    },

    paneDiagnostics(paneId: string) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      if (pane.surface !== 'terminal') return null;
      const terminal = terminalForPane(session, pane);
      const osc = terminal.getOsc133State(pane.resttyPaneId!);
      if (!osc) return null;
      return buildPaneDiagnostics(osc);
    },

    readViewport(paneId: string) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      const terminal = terminalForPane(session, pane);
      return terminal.captureViewportText(pane.resttyPaneId!);
    },

    readHistory(paneId: string, opts: { lastLines: number }) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      const terminal = terminalForPane(session, pane);
      return terminal.captureHistoryText(pane.resttyPaneId!, opts);
    },

    readRange(paneId: string, opts: { start: TerminalPosition; end: TerminalPosition }) {
      const pane = requirePane(paneId);
      const session = requireSession(pane.tabId);
      const terminal = terminalForPane(session, pane);
      return terminal.captureTextRange(pane.resttyPaneId!, opts);
    },

    isZoomed(paneId: string) {
      const pane = requirePane(paneId);
      const session = lookup.findByTabId(pane.tabId);
      if (session?.kind === 'mixed') return false;
      return session?.terminal?.isPaneZoomed(pane.resttyPaneId!) ?? reg.getPane(paneId)?.zoomed ?? false;
    },
  };
}

function browserControllerForTab(session: AgentSessionRef): ControlledFrameController {
  if (session.kind === 'browser') {
    if (!session.browser) throw new Error(`Browser tab is not ready: ${session.id}`);
    return session.browser;
  }
  if (session.kind === 'mixed') {
    for (const leaf of session.mixedLeaves?.values() ?? []) {
      if (leaf.surface === 'browser' && leaf.browser) return leaf.browser;
    }
    throw new Error(`Mixed tab has no browser leaf: ${session.id}`);
  }
  throw new Error(`Tab is not a browser surface: ${session.id}`);
}

export function createBrowserHost(lookup: AgentSessionLookup): BrowserHost {
  const requireBrowserTab = (tabId: string): ControlledFrameController => {
    const session = lookup.findByTabId(tabId);
    if (!session) throw new Error(`Unknown tab: ${tabId}`);
    return browserControllerForTab(session);
  };

  const requireAutomation = (tabId: string) => {
    const controller = requireBrowserTab(tabId);
    if (!controller.automation) {
      throw new Error(`Browser automation is not available for tab: ${tabId}`);
    }
    return controller.automation;
  };

  return {
    navigate(tabId, url) {
      requireBrowserTab(tabId).navigate(url);
    },
    async back(tabId) {
      return requireBrowserTab(tabId).back();
    },
    async forward(tabId) {
      return requireBrowserTab(tabId).forward();
    },
    reload(tabId) {
      requireBrowserTab(tabId).reload();
    },
    async waitFor(tabId, input) {
      return requireAutomation(tabId).waitFor(input);
    },
    async snapshot(tabId, input) {
      return requireAutomation(tabId).snapshot(input);
    },
    async query(tabId, input) {
      return requireAutomation(tabId).query(input);
    },
    async click(tabId, input) {
      await requireAutomation(tabId).click(input.ref);
    },
    async type(tabId, input) {
      await requireAutomation(tabId).type(input.ref, input.text, { clear: input.clear });
    },
    async press(tabId, input) {
      await requireAutomation(tabId).press(input.ref, input.key);
    },
    getUrl(tabId) {
      return requireBrowserTab(tabId).getUrl();
    },
    getTitle(tabId) {
      return requireBrowserTab(tabId).getTitle();
    },
  };
}

/** Install PaneHost + expose development CDP hook. */
export function installAgentControl(lookup: AgentSessionLookup): AgentControlService {
  const agent = getAgentControlService();
  agent.setPaneHost(createPaneHost(lookup));
  agent.setBrowserHost(createBrowserHost(lookup));
  const win = window as unknown as { __goshAgent?: AgentControlService };
  win.__goshAgent = agent;
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => registry?.closeWindow());
  }
  return agent;
}

/** Forward Restty OSC 133 markers into the agent CommandTracker (opaque pane ids). */
export function wireTerminalOsc133(tabId: string, terminal: ResttyTerminalAdapter): TerminalSubscription {
  const agent = getAgentControlService();
  const reg = getWorkspaceRegistry();
  const oscSub = terminal.onOsc133((resttyPaneId, event, position) => {
    const paneId = reg.paneIdForRestty(tabId, resttyPaneId);
    if (!paneId) return;
    agent.noteOsc133(paneId, {
      phase: event.phase,
      exitCode: event.exitCode,
      position,
    });
  });
  const invalidateSub = terminal.onOsc133Invalidated((resttyPaneId) => {
    const paneId = reg.paneIdForRestty(tabId, resttyPaneId);
    if (!paneId) return;
    agent.notePaneInvalidated(paneId, 'reconnect');
  });
  return {
    dispose: () => {
      oscSub.dispose();
      invalidateSub.dispose();
    },
  };
}

export function notifyPaneDisconnected(tabId: string, resttyPaneId: number): void {
  const paneId = getWorkspaceRegistry().paneIdForRestty(tabId, resttyPaneId);
  if (paneId) getAgentControlService().notePaneDisconnected(paneId);
}

/** Forward Controlled Frame navigation failures into the agent event bus. */
export function createBrowserAgentStateHook(tabId: string): (state: ControlledFrameNavState) => void {
  let wasFailed = false;
  return (state) => {
    if (state.failed && !wasFailed && state.failureReason) {
      getAgentControlService().noteBrowserLoadFailed(tabId, state.url, state.failureReason);
    }
    wasFailed = state.failed;
  };
}
