import { describe, expect, it } from 'vitest';
import {
  createTwoPaneLayout,
  deserializeLayout,
  findLeaf,
  removeLeaf,
  resizeLeaf,
  serializeLayout,
  splitLeaf,
  swapLeaves,
  walkLeaves,
} from './MixedLayout';

describe('MixedLayout', () => {
  it('creates a two-pane split with distinct leaf ids', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'leaf_term',
      secondLeafId: 'leaf_browser',
    });
    const leaves = walkLeaves(root);
    expect(leaves).toEqual([
      { kind: 'leaf', leafId: 'leaf_term', surface: 'terminal' },
      { kind: 'leaf', leafId: 'leaf_browser', surface: 'browser' },
    ]);
    expect(findLeaf(root, 'leaf_browser')?.surface).toBe('browser');
  });

  it('round-trips through serialize/deserialize', () => {
    const root = createTwoPaneLayout({
      direction: 'horizontal',
      first: 'browser',
      second: 'terminal',
      ratio: 0.4,
      firstLeafId: 'a',
      secondLeafId: 'b',
    });
    const restored = deserializeLayout(serializeLayout(root));
    expect(restored).toEqual(root);
  });

  it('resizes the parent split when a leaf grows right', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.5,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const resized = resizeLeaf(root, 'term', 'right', 0.1);
    expect(resized.kind).toBe('split');
    if (resized.kind === 'split') expect(resized.ratio).toBeCloseTo(0.6);
  });

  it('removes a leaf and collapses to the sibling', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const collapsed = removeLeaf(root, 'browser');
    expect(collapsed).toEqual({ kind: 'leaf', leafId: 'term', surface: 'terminal' });
  });

  it('rejects unknown layout versions', () => {
    expect(() => deserializeLayout({ version: 99, root: { kind: 'leaf', leafId: 'x', surface: 'terminal' } })).toThrow(
      /unsupported mixed layout version/,
    );
  });

  it('splits a single leaf into a parent split with a new sibling', () => {
    const root = { kind: 'leaf' as const, leafId: 'term', surface: 'terminal' as const };
    const result = splitLeaf(root, 'term', 'vertical', 'browser', { newLeafId: 'browser_new' });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.newLeafId).toBe('browser_new');
    expect(result.layout).toEqual({
      kind: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: { kind: 'leaf', leafId: 'term', surface: 'terminal' },
      second: { kind: 'leaf', leafId: 'browser_new', surface: 'browser' },
    });
  });

  it('splits a nested leaf inside an existing split tree', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const result = splitLeaf(root, 'browser', 'horizontal', 'terminal', { newLeafId: 'term2' });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(findLeaf(result.layout, 'term2')?.surface).toBe('terminal');
    expect(findLeaf(result.layout, 'term')?.surface).toBe('terminal');
    expect(findLeaf(result.layout, 'browser')?.surface).toBe('browser');
    expect(walkLeaves(result.layout)).toHaveLength(3);
  });

  it('swaps two leaves in a two-pane layout', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.4,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const swapped = swapLeaves(root, 'term', 'browser');
    expect(swapped).toEqual({
      kind: 'split',
      direction: 'vertical',
      ratio: 0.4,
      first: { kind: 'leaf', leafId: 'browser', surface: 'browser' },
      second: { kind: 'leaf', leafId: 'term', surface: 'terminal' },
    });
  });

  it('swaps nested leaves without changing split ratios', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      ratio: 0.55,
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    const split = splitLeaf(root, 'browser', 'horizontal', 'terminal', { newLeafId: 'term2' });
    expect(split).not.toBeNull();
    if (!split) return;
    const swapped = swapLeaves(split.layout, 'term', 'term2');
    expect(findLeaf(swapped, 'term')?.surface).toBe('terminal');
    expect(findLeaf(swapped, 'term2')?.surface).toBe('terminal');
    expect(findLeaf(swapped, 'browser')?.surface).toBe('browser');
    const leaves = walkLeaves(swapped);
    expect(leaves.map((leaf) => leaf.leafId)).toEqual(['term2', 'browser', 'term']);
  });

  it('returns root unchanged when swapping unknown or identical leaves', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    expect(swapLeaves(root, 'term', 'term')).toBe(root);
    expect(swapLeaves(root, 'term', 'missing')).toBe(root);
  });

  it('returns null when splitting an unknown leaf', () => {
    const root = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'term',
      secondLeafId: 'browser',
    });
    expect(splitLeaf(root, 'missing', 'vertical', 'terminal')).toBeNull();
  });
});
