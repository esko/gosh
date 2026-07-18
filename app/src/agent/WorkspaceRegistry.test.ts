import { describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from './WorkspaceRegistry';

describe('WorkspaceRegistry', () => {
  it('creates a tab, registers panes, and lists opaque ids', () => {
    const reg = new WorkspaceRegistry({ windowId: 'win_test' });
    const tabId = reg.openTab({ kind: 'terminal', title: 'echo@local' });
    const paneA = reg.openPane({ tabId, resttyPaneId: 1 });
    const paneB = reg.openPane({ tabId, resttyPaneId: 2 });

    expect(paneA).not.toBe(paneB);
    expect(paneA.startsWith('pane_')).toBe(true);
    expect(reg.listTabs()).toEqual([
      expect.objectContaining({ tabId, windowId: 'win_test', kind: 'terminal', paneCount: 2 }),
    ]);
    const panes = reg.listPanes({ tabId });
    expect(panes.map((p) => p.paneId).sort()).toEqual([paneA, paneB].sort());
    expect(panes.every((p) => typeof p.paneId === 'string' && !('resttyPaneId' in p))).toBe(true);
    expect(reg.resttyPaneId(paneA)).toBe(1);
    expect(reg.paneIdForRestty(tabId, 2)).toBe(paneB);
  });

  it('keeps pane ids stable while alive and emits one close event', () => {
    const reg = new WorkspaceRegistry({ windowId: 'win_test' });
    const tabId = reg.openTab({ kind: 'terminal', title: 't' });
    const paneId = reg.openPane({ tabId, resttyPaneId: 7 });
    expect(reg.openPane({ tabId, resttyPaneId: 7 })).toBe(paneId);

    const closed: string[] = [];
    reg.events.subscribe((e) => {
      if (e.type === 'pane.closed') closed.push(e.paneId ?? '');
    });
    expect(reg.closePane(paneId)).toBe(true);
    expect(reg.closePane(paneId)).toBe(false);
    expect(closed).toEqual([paneId]);
    expect(reg.listPanes({ tabId })).toEqual([]);
  });

  it('closing a tab removes its panes and emits tab.closed', () => {
    const reg = new WorkspaceRegistry();
    const tabId = reg.openTab({ kind: 'terminal', title: 't' });
    reg.openPane({ tabId, resttyPaneId: 1 });
    reg.openPane({ tabId, resttyPaneId: 2 });

    const types: string[] = [];
    reg.events.subscribe((e) => types.push(e.type));
    expect(reg.closeTab(tabId)).toBe(true);
    expect(reg.listTabs()).toEqual([]);
    expect(reg.listPanes()).toEqual([]);
    expect(types.filter((t) => t === 'pane.closed')).toHaveLength(2);
    expect(types.filter((t) => t === 'tab.closed')).toEqual(['tab.closed']);
  });
});
