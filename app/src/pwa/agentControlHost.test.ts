/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { createPaneHost, getWorkspaceRegistry, resetAgentControl } from './agentControlHost';

describe('createPaneHost mixed split', () => {
  it('routes pane.split to splitMixedPane and returns the new opaque pane id', async () => {
    resetAgentControl();
    const reg = getWorkspaceRegistry();
    const tabId = reg.openTab({ kind: 'mixed', title: 'mixed' });
    const sourcePaneId = reg.openPane({
      tabId,
      surface: 'terminal',
      resttyPaneId: 1,
      leafId: 'leaf_term',
      active: true,
    });
    const newPaneId = 'pane_new_browser';
    const splitMixedPane = vi.fn(async () => {
      reg.openPane({ tabId, surface: 'browser', leafId: 'leaf_browser_new', paneId: newPaneId });
      return newPaneId;
    });
    const host = createPaneHost({
      findByTabId: (id) =>
        id === tabId
          ? {
              id: tabId,
              kind: 'mixed',
              panes: new Map(),
              mixedLeaves: new Map(),
            }
          : undefined,
      sleep: async () => undefined,
      splitMixedPane,
    });

    const result = await host.split(tabId, 'vertical', { paneId: sourcePaneId, surface: 'browser' });
    expect(splitMixedPane).toHaveBeenCalledWith(tabId, sourcePaneId, 'vertical', 'browser');
    expect(result.paneId).toBe(newPaneId);
    expect(reg.listPanes({ tabId }).find((pane) => pane.paneId === newPaneId)?.active).toBe(true);
    resetAgentControl();
  });

  it('routes pane.zoom for mixed tabs through zoomMixedPane', () => {
    resetAgentControl();
    const reg = getWorkspaceRegistry();
    const tabId = reg.openTab({ kind: 'mixed', title: 'mixed' });
    const paneId = reg.openPane({
      tabId,
      surface: 'browser',
      leafId: 'leaf_browser',
      active: true,
    });
    const zoomMixedPane = vi.fn(() => true);
    const host = createPaneHost({
      findByTabId: (id) =>
        id === tabId
          ? {
              id: tabId,
              kind: 'mixed',
              panes: new Map(),
              mixedMount: { isLeafZoomed: () => true } as never,
            }
          : undefined,
      sleep: async () => undefined,
      zoomMixedPane,
    });

    expect(host.zoom(paneId, true)).toBe(true);
    expect(zoomMixedPane).toHaveBeenCalledWith(tabId, paneId, true);
    expect(host.isZoomed?.(paneId)).toBe(true);
    resetAgentControl();
  });

  it('keeps Restty split behavior for terminal-only tabs', async () => {
    resetAgentControl();
    const reg = getWorkspaceRegistry();
    const tabId = reg.openTab({ kind: 'terminal', title: 'term' });
    reg.openPane({ tabId, surface: 'terminal', resttyPaneId: 1, active: true });
    const split = vi.fn(() => {
      reg.openPane({ tabId, surface: 'terminal', resttyPaneId: 2 });
    });
    const host = createPaneHost({
      findByTabId: (id) =>
        id === tabId
          ? {
              id: tabId,
              kind: 'terminal',
              terminal: { split } as never,
              panes: new Map(),
            }
          : undefined,
      sleep: async () => undefined,
      splitMixedPane: vi.fn(async () => 'pane_should_not_be_used'),
    });

    const result = await host.split(tabId, 'horizontal');
    expect(split).toHaveBeenCalledWith('horizontal');
    expect(result.paneId).toBeTruthy();
    resetAgentControl();
  });
});
