/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  TabPreviewCache,
  clampTabOverviewSelection,
  filterTabOverviewEntries,
  moveTabOverviewSelection,
  patchTabOverviewPreviewImages,
  type TabOverviewEntry,
} from './tabOverview';

const entries: TabOverviewEntry[] = [
  {
    id: 'tab1',
    title: 'prod shell',
    target: 'deploy@prod.example.com',
    protocol: 'ssh',
    kind: 'terminal',
    status: 'connected',
    paneCount: 1,
    active: true,
  },
  {
    id: 'tab2',
    title: 'metrics',
    target: 'ops@metrics.example.com',
    protocol: 'et',
    kind: 'terminal',
    status: 'connected',
    paneCount: 3,
    active: false,
  },
  {
    id: 'tab3',
    title: 'New Tab',
    kind: 'launcher',
    status: 'idle',
    paneCount: 0,
    active: false,
  },
];

describe('tab overview helpers', () => {
  it('filters by title, target, protocol, launcher state, and pane count', () => {
    expect(filterTabOverviewEntries(entries, 'prod')).toEqual([entries[0]]);
    expect(filterTabOverviewEntries(entries, 'metrics et')).toEqual([entries[1]]);
    expect(filterTabOverviewEntries(entries, '3 panes')).toEqual([entries[1]]);
    expect(filterTabOverviewEntries(entries, 'new launcher')).toEqual([entries[2]]);
    expect(filterTabOverviewEntries(entries, 'missing')).toEqual([]);
    expect(filterTabOverviewEntries(entries, '   ')).toEqual(entries);
  });

  it('wraps keyboard selection and clamps stale indices', () => {
    expect(moveTabOverviewSelection(0, 1, 3)).toBe(1);
    expect(moveTabOverviewSelection(0, -1, 3)).toBe(2);
    expect(moveTabOverviewSelection(2, 1, 3)).toBe(0);
    expect(clampTabOverviewSelection(8, 3)).toBe(2);
    expect(clampTabOverviewSelection(Number.NaN, 3)).toBe(0);
    expect(moveTabOverviewSelection(0, 1, 0)).toBe(0);
  });

  it('revokes replaced previews and clears every object URL', () => {
    const revoked: string[] = [];
    let seq = 0;
    const cache = new TabPreviewCache({
      createObjectURL: () => `blob:${++seq}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
    const blob = new Blob(['preview']);

    expect(cache.set('tab1', blob, 10)).toEqual({ url: 'blob:1', updatedAt: 10 });
    expect(cache.set('tab1', blob, 20)).toEqual({ url: 'blob:2', updatedAt: 20 });
    expect(revoked).toEqual(['blob:1']);
    cache.set('tab2', blob, 30);
    cache.clear();
    expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
    expect(cache.get('tab1')).toBeUndefined();
    expect(cache.get('tab2')).toBeUndefined();
  });

  it('patches overview card images in place when preview urls change', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-tab-overview-id="tab1">
        <div class="tab-overview-thumb"><div class="tab-overview-placeholder"><span>No preview yet</span></div></div>
      </div>
      <div data-tab-overview-id="tab2">
        <div class="tab-overview-thumb"><img class="tab-overview-img" src="blob:old" alt=""></div>
      </div>
    `;
    const urls = new Map([['tab1', 'blob:new1'], ['tab2', 'blob:new2']]);
    patchTabOverviewPreviewImages(root, (id) => urls.get(id));
    expect(root.querySelector('[data-tab-overview-id="tab1"] img')?.getAttribute('src')).toBe('blob:new1');
    expect(root.querySelector('[data-tab-overview-id="tab1"] .tab-overview-placeholder')).toBeNull();
    expect(root.querySelector('[data-tab-overview-id="tab2"] img')?.getAttribute('src')).toBe('blob:new2');
  });
});
