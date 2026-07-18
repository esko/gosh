/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createTwoPaneLayout } from './MixedLayout';
import { mountMixedLayoutDom } from './mixedLayoutDom';

function splitChildFlex(root: HTMLElement): [string, string] {
  const split = root.querySelector('.mixed-split')!;
  const children = Array.from(split.children).filter((child) =>
    child.classList.contains('mixed-split-child'),
  ) as HTMLElement[];
  return [children[0].style.flex, children[1].style.flex];
}

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
