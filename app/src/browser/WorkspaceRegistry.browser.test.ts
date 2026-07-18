import { describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from '../agent/WorkspaceRegistry';

describe('WorkspaceRegistry browser tabs', () => {
  it('opens and closes browser tabs with tab.opened/closed events', () => {
    const reg = new WorkspaceRegistry({ windowId: 'win_browser' });
    const types: string[] = [];
    reg.events.subscribe((event) => types.push(event.type));

    const tabId = reg.openTab({ kind: 'browser', title: 'Browser' });
    expect(tabId.startsWith('tab_')).toBe(true);
    expect(reg.listTabs()).toEqual([
      expect.objectContaining({ tabId, kind: 'browser', title: 'Browser', paneCount: 0 }),
    ]);

    expect(reg.closeTab(tabId)).toBe(true);
    expect(reg.listTabs()).toEqual([]);
    expect(types).toEqual(['tab.opened', 'tab.closed']);
  });
});
