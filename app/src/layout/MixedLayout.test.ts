import { describe, expect, it } from 'vitest';
import {
  createTwoPaneLayout,
  deserializeLayout,
  findLeaf,
  removeLeaf,
  resizeLeaf,
  serializeLayout,
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
});
