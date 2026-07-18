// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyFlexPair,
  buildLayoutTree,
  nextFlexPair,
  parseFlexPct,
  resizePaneTowardInDom,
  ResttyLayoutController,
  type LayoutNode,
} from './resttyLayout';

function pane(id: number, flex = '50'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pane';
  el.dataset.paneId = `${id}`;
  el.style.flex = `0 0 ${flex}%`;
  return el;
}

function divider(orientation: 'vertical' | 'horizontal'): HTMLElement {
  const el = document.createElement('div');
  el.className = `pane-divider ${orientation === 'vertical' ? 'is-vertical' : 'is-horizontal'}`;
  return el;
}

function split(
  orientation: 'vertical' | 'horizontal',
  first: HTMLElement,
  second: HTMLElement,
): HTMLElement {
  const el = document.createElement('div');
  el.className = `pane-split ${orientation === 'vertical' ? 'is-vertical' : 'is-horizontal'}`;
  el.append(first, divider(orientation), second);
  return el;
}

describe('resttyLayout flex helpers', () => {
  it('parses inline flex percentages', () => {
    const el = document.createElement('div');
    el.style.flex = '0 0 37.50000%';
    expect(parseFlexPct(el)).toBe(37.5);
    expect(parseFlexPct(document.createElement('div'))).toBeNull();
  });

  it('clamps resize steps to a minimum branch size', () => {
    expect(nextFlexPair(50, 50, 6)).toEqual({ growPct: 56, otherPct: 44 });
    expect(nextFlexPair(92, 8, 6)).toEqual({ growPct: 90, otherPct: 10 });
    expect(nextFlexPair(12, 88, -6)).toEqual({ growPct: 10, otherPct: 90 });
  });

  it('writes paired flex values', () => {
    const grow = document.createElement('div');
    const other = document.createElement('div');
    applyFlexPair(grow, other, 33.33333, 66.66667);
    expect(grow.style.flex).toBe('0 0 33.33333%');
    expect(other.style.flex).toBe('0 0 66.66667%');
  });
});

describe('resttyLayout tree serialization', () => {
  it('serializes a single pane', () => {
    const root = document.createElement('div');
    root.append(pane(1, '100'));
    expect(buildLayoutTree(root)).toEqual({
      kind: 'pane',
      paneId: 1,
      flexPct: 100,
    } satisfies LayoutNode);
  });

  it('serializes nested three-level splits', () => {
    const root = document.createElement('div');
    const left = pane(1, '40');
    const rightStack = split('horizontal', pane(2, '60'), pane(3, '40'));
    root.append(split('vertical', left, rightStack));
    expect(buildLayoutTree(root)).toEqual({
      kind: 'split',
      orientation: 'vertical',
      children: [
        { kind: 'pane', paneId: 1, flexPct: 40 },
        {
          kind: 'split',
          orientation: 'horizontal',
          children: [
            { kind: 'pane', paneId: 2, flexPct: 60 },
            { kind: 'pane', paneId: 3, flexPct: 40 },
          ],
        },
      ],
    } satisfies LayoutNode);
  });
});

describe('resttyLayout resize', () => {
  it('resizes through a nested split toward the correct divider', () => {
    const root = document.createElement('div');
    const left = pane(1, '50');
    const rightStack = split('horizontal', pane(2, '50'), pane(3, '50'));
    root.append(split('vertical', left, rightStack));

    const ok = resizePaneTowardInDom(root, 2, 'down', 10);
    expect(ok).toBe(true);
    const tree = buildLayoutTree(root);
    expect(tree).toEqual({
      kind: 'split',
      orientation: 'vertical',
      children: [
        { kind: 'pane', paneId: 1, flexPct: 50 },
        {
          kind: 'split',
          orientation: 'horizontal',
          children: [
            { kind: 'pane', paneId: 2, flexPct: 60 },
            { kind: 'pane', paneId: 3, flexPct: 40 },
          ],
        },
      ],
    } satisfies LayoutNode);
  });

  it('returns false when no matching split exists', () => {
    const root = document.createElement('div');
    root.append(pane(1));
    expect(resizePaneTowardInDom(root, 1, 'left')).toBe(false);
  });
});

describe('ResttyLayoutController zoom', () => {
  it('overlays and restores a pane', () => {
    const root = document.createElement('div');
    root.append(pane(1));
    const layout = new ResttyLayoutController(() => root);

    expect(layout.setPaneZoomed(1, true)).toBe(true);
    const el = layout.getPaneElement(1)!;
    expect(el.style.position).toBe('absolute');
    expect(root.style.position).toBe('relative');
    expect(layout.isPaneZoomed(1)).toBe(true);

    expect(layout.setPaneZoomed(1, false)).toBe(true);
    expect(el.style.position).toBe('');
    expect(layout.isPaneZoomed(1)).toBe(false);
  });
});
