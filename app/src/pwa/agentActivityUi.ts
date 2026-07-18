/**
 * Per-pane agent activity chrome (typing / terminal.run) — distinct from the
 * window-level external-control indicator in agentControlServerHost.
 */

import type { AgentControlService } from '../agent/AgentControlService';
import {
  EMPTY_AGENT_PANE_ACTIVITY,
  isAgentPaneActive,
  reduceAgentPaneActivity,
  type AgentActivityAction,
  type AgentPaneActivityState,
} from '../agent/agentActivityPulse';
import { getWorkspaceRegistry } from './agentControlHost';
import type { AgentSessionLookup } from './agentControlHost';
import type { ResttyTerminalAdapter } from './resttyAdapter';

export function mountAgentPaneActivity(options: {
  lookup: AgentSessionLookup;
  getService: () => AgentControlService;
}): () => void {
  const reg = getWorkspaceRegistry();
  const paneState = new Map<string, AgentPaneActivityState>();
  const timers = new Map<string, number>();

  const findTerminal = (opaquePaneId: string): ResttyTerminalAdapter | null => {
    const pane = reg.getPane(opaquePaneId);
    if (!pane) return null;
    const session = options.lookup.findByTabId(pane.tabId);
    if (!session) return null;
    if (session.terminal) return session.terminal;
    if (session.kind === 'mixed' && pane.surface === 'terminal') {
      for (const leaf of session.mixedLeaves?.values() ?? []) {
        if (leaf.surface === 'terminal' && leaf.terminal) return leaf.terminal;
      }
    }
    return null;
  };

  const applyPaneDom = (opaquePaneId: string, active: boolean): void => {
    const pane = reg.getPane(opaquePaneId);
    if (!pane || pane.resttyPaneId === undefined) return;
    findTerminal(opaquePaneId)?.setAgentPaneActive(pane.resttyPaneId, active);
  };

  const applyTabDom = (tabId: string, active: boolean): void => {
    const tab = document.querySelector<HTMLElement>(`.term-tab[data-id="${tabId}"]`);
    if (!tab) return;
    tab.classList.toggle('term-tab-agent-activity', active);
    tab.dataset.agentActive = active ? 'true' : 'false';
  };

  const refreshTab = (tabId: string, nowMs = Date.now()): void => {
    let anyActive = false;
    for (const [opaquePaneId, state] of paneState) {
      const pane = reg.getPane(opaquePaneId);
      if (!pane || pane.tabId !== tabId) continue;
      if (isAgentPaneActive(state, nowMs)) {
        anyActive = true;
        break;
      }
    }
    applyTabDom(tabId, anyActive);
  };

  const clearTimer = (opaquePaneId: string): void => {
    const handle = timers.get(opaquePaneId);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(opaquePaneId);
    }
  };

  const refreshPane = (opaquePaneId: string, nowMs = Date.now()): void => {
    const state = paneState.get(opaquePaneId) ?? EMPTY_AGENT_PANE_ACTIVITY;
    const active = isAgentPaneActive(state, nowMs);
    applyPaneDom(opaquePaneId, active);

    const pane = reg.getPane(opaquePaneId);
    if (pane) refreshTab(pane.tabId, nowMs);

    clearTimer(opaquePaneId);
    if (!active) {
      paneState.delete(opaquePaneId);
      return;
    }
    if (!state.runPending && state.pulseUntilMs > nowMs) {
      const delay = state.pulseUntilMs - nowMs + 16;
      timers.set(
        opaquePaneId,
        window.setTimeout(() => refreshPane(opaquePaneId), delay),
      );
    }
  };

  const onActivity = (input: { paneId: string; action: AgentActivityAction }): void => {
    const nowMs = Date.now();
    const prev = paneState.get(input.paneId) ?? EMPTY_AGENT_PANE_ACTIVITY;
    paneState.set(input.paneId, reduceAgentPaneActivity(prev, input.action, nowMs));
    refreshPane(input.paneId, nowMs);
  };

  const service = options.getService();
  service.setActivityListener(onActivity);

  return () => {
    service.setActivityListener(null);
    for (const handle of timers.values()) clearTimeout(handle);
    timers.clear();
    const touchedTabs = new Set<string>();
    for (const opaquePaneId of paneState.keys()) {
      const pane = reg.getPane(opaquePaneId);
      if (pane) touchedTabs.add(pane.tabId);
      applyPaneDom(opaquePaneId, false);
    }
    paneState.clear();
    for (const tabId of touchedTabs) applyTabDom(tabId, false);
  };
}
