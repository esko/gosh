/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createTwoPaneLayout, walkLeaves } from './MixedLayout';
import { mountMixedLayoutDom } from './mixedLayoutDom';

if (typeof DragEvent === 'undefined') {
  class DragEventPolyfill extends Event {
    dataTransfer: DataTransfer | null;

    constructor(type: string, init?: DragEventInit) {
      super(type, init);
      this.dataTransfer = init?.dataTransfer ?? null;
    }
  }
  globalThis.DragEvent = DragEventPolyfill as typeof DragEvent;
}

function createDataTransferMock(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'none',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
    clearData() {
      data.clear();
    },
    setDragImage() {},
  } as DataTransfer;
}

function splitChildFlex(root: HTMLElement): [string, string] {
  const split = root.querySelector('.mixed-split')!;
  const children = Array.from(split.children).filter((child) =>
    child.classList.contains('mixed-split-child'),
  ) as HTMLElement[];
  return [children[0].style.flex, children[1].style.flex];
}

describe('mixedLayoutDom drag reorder', () => {
  it('swaps leaves when dropping one leaf onto another', () => {
    const container = document.createElement('div');
    const layout = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.4,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const changes: string[][] = [];
    const mount = mountMixedLayoutDom(container, layout, {
      onLayoutChange: (next) => {
        changes.push(walkLeaves(next).map((leaf) => leaf.leafId));
      },
    });

    const sourceHandle = mount.rootEl.querySelector<HTMLElement>(
      '[data-mixed-leaf-id="term"] .mixed-leaf-drag-handle',
    )!;
    const targetLeaf = mount.rootEl.querySelector<HTMLElement>('[data-mixed-leaf-id="browser"]')!;
    const dataTransfer = createDataTransferMock();

    sourceHandle.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
    );
    targetLeaf.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
    );
    targetLeaf.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
    );

    expect(changes.at(-1)).toEqual(['browser', 'term']);
    const firstLeaf = mount.rootEl.querySelector<HTMLElement>('.mixed-split-child [data-mixed-leaf-id]');
    expect(firstLeaf?.dataset.mixedLeafId).toBe('browser');
  });

  it('omits drag handles when only one leaf exists', () => {
    const container = document.createElement('div');
    const layout = { kind: 'leaf' as const, leafId: 'solo', surface: 'terminal' as const };
    const mount = mountMixedLayoutDom(container, layout);
    expect(mount.rootEl.querySelector('.mixed-leaf-drag-handle')).toBeNull();
  });
});

describe('mixedLayoutDom zoom', () => {
  it('overlays a leaf and restores split ratios on toggle', () => {
    const container = document.createElement('div');
    const layout = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.4,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const mount = mountMixedLayoutDom(container, layout);
    const before = splitChildFlex(mount.rootEl);

    expect(mount.setLeafZoomed('term', true)).toBe(true);
    const termHost = mount.leafHosts.get('term')!;
    expect(termHost.style.position).toBe('absolute');
    expect(mount.isLeafZoomed('term')).toBe(true);

    expect(mount.setLeafZoomed('term', false)).toBe(true);
    expect(termHost.style.position).toBe('');
    expect(mount.isLeafZoomed('term')).toBe(false);
    expect(splitChildFlex(mount.rootEl)).toEqual(before);
  });

  it('toggleLeafZoom switches between zoomed and restored layout', () => {
    const container = document.createElement('div');
    const layout = createTwoPaneLayout({
      direction: 'horizontal',
      first: 'terminal',
      second: 'browser',
      ratio: 0.35,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const mount = mountMixedLayoutDom(container, layout);
    const before = splitChildFlex(mount.rootEl);

    expect(mount.toggleLeafZoom('browser')).toBe(true);
    expect(mount.hasZoomedLeaf()).toBe(true);

    expect(mount.toggleLeafZoom('browser')).toBe(true);
    expect(mount.hasZoomedLeaf()).toBe(false);
    expect(splitChildFlex(mount.rootEl)).toEqual(before);
  });

  it('clears zoom before applyLayout', () => {
    const container = document.createElement('div');
    const layout = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.62,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const mount = mountMixedLayoutDom(container, layout);

    mount.setLeafZoomed('term', true);
    expect(mount.hasZoomedLeaf()).toBe(true);
    mount.applyLayout(layout);
    expect(mount.hasZoomedLeaf()).toBe(false);
  });
});
