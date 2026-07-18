/**
 * DOM mounting for {@link MixedLayoutNode}. Keeps layout math in MixedLayout.ts.
 */

import { DEFAULT_RESIZE_STEP, resizeLeaf as resizeLayoutLeaf, type MixedLayoutNode, type MixedResizeDirection } from './MixedLayout';

export const MIXED_LAYOUT_ROOT_CLASS = 'mixed-layout-root';
export const MIXED_SPLIT_CLASS = 'mixed-split';
export const MIXED_LEAF_CLASS = 'mixed-leaf';
export const MIXED_DIVIDER_CLASS = 'mixed-split-divider';

const MIN_RATIO = 0.1;

export type MixedLayoutDomMount = {
  rootEl: HTMLElement;
  leafHosts: ReadonlyMap<string, HTMLElement>;
  applyLayout(layout: MixedLayoutNode): void;
  resizeLeaf(leafId: string, direction: MixedResizeDirection, step?: number): boolean;
  setLeafZoomed(leafId: string, zoomed: boolean): boolean;
  isLeafZoomed(leafId: string): boolean;
  hasZoomedLeaf(): boolean;
  clearZoom(): void;
  toggleLeafZoom(leafId: string): boolean;
  dispose(): void;
};

export function mountMixedLayoutDom(
  container: HTMLElement,
  layout: MixedLayoutNode,
  options?: {
    onLayoutChange?: (layout: MixedLayoutNode) => void;
    onLeafFocus?: (leafId: string) => void;
  },
): MixedLayoutDomMount {
  const leafHosts = new Map<string, HTMLElement>();
  let currentLayout = layout;
  let zoomedLeafId: string | null = null;
  let prevRootPosition: string | null = null;

  const rootEl = document.createElement('div');
  rootEl.className = MIXED_LAYOUT_ROOT_CLASS;
  container.replaceChildren(rootEl);

  const clearZoom = (): void => {
    if (zoomedLeafId === null) return;
    const el = leafHosts.get(zoomedLeafId);
    if (el) {
      el.style.position = '';
      el.style.inset = '';
      el.style.zIndex = '';
      el.classList.remove('is-zoomed');
    }
    if (prevRootPosition !== null) {
      rootEl.style.position = prevRootPosition;
      prevRootPosition = null;
    }
    zoomedLeafId = null;
  };

  const applyLeafZoom = (leafId: string): boolean => {
    const el = leafHosts.get(leafId);
    if (!el) return false;
    if (!rootEl.style.position) {
      prevRootPosition = rootEl.style.position;
      rootEl.style.position = 'relative';
    }
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.zIndex = '6';
    el.classList.add('is-zoomed');
    zoomedLeafId = leafId;
    return true;
  };

  const setLeafZoomed = (leafId: string, zoomed: boolean): boolean => {
    if (zoomed) {
      if (zoomedLeafId === leafId) return true;
      if (zoomedLeafId !== null) clearZoom();
      return applyLeafZoom(leafId);
    }
    if (zoomedLeafId === leafId) {
      clearZoom();
      return true;
    }
    return zoomedLeafId === null;
  };

  const applyLayout = (next: MixedLayoutNode): void => {
    clearZoom();
    const preserved = preserveLeafChildren(leafHosts);
    currentLayout = next;
    leafHosts.clear();
    renderNode(rootEl, next, leafHosts, preserved, options?.onLeafFocus);
    options?.onLayoutChange?.(next);
  };

  applyLayout(layout);

  return {
    rootEl,
    leafHosts,
    applyLayout,
    setLeafZoomed,
    isLeafZoomed(leafId) {
      return zoomedLeafId === leafId;
    },
    hasZoomedLeaf() {
      return zoomedLeafId !== null;
    },
    clearZoom,
    toggleLeafZoom(leafId) {
      if (zoomedLeafId === leafId) {
        clearZoom();
        return true;
      }
      if (zoomedLeafId !== null) clearZoom();
      return setLeafZoomed(leafId, true);
    },
    resizeLeaf(leafId, direction, step = DEFAULT_RESIZE_STEP) {
      const located = locateLeafSplit(rootEl, leafId);
      if (!located) return false;
      const { splitEl, firstEl, secondEl, childKey } = located;
      const delta = domResizeDelta(splitEl, childKey, direction, step);
      if (delta === 0) return false;
      const firstPct = parsePct(firstEl) ?? 50;
      const secondPct = parsePct(secondEl) ?? 50;
      const total = firstPct + secondPct;
      const nextFirst = clampPct(firstPct + delta * 100, total);
      const nextSecond = total - nextFirst;
      firstEl.style.flex = `0 0 ${nextFirst.toFixed(5)}%`;
      secondEl.style.flex = `0 0 ${nextSecond.toFixed(5)}%`;
      currentLayout = resizeLayoutLeaf(currentLayout, leafId, direction, step);
      options?.onLayoutChange?.(currentLayout);
      return true;
    },
    dispose() {
      clearZoom();
      container.replaceChildren();
      leafHosts.clear();
    },
  };
}

function preserveLeafChildren(leafHosts: Map<string, HTMLElement>): Map<string, DocumentFragment> {
  const preserved = new Map<string, DocumentFragment>();
  for (const [leafId, host] of leafHosts) {
    const fragment = document.createDocumentFragment();
    while (host.firstChild) fragment.append(host.firstChild);
    preserved.set(leafId, fragment);
  }
  return preserved;
}

function renderNode(
  parent: HTMLElement,
  node: MixedLayoutNode,
  leafHosts: Map<string, HTMLElement>,
  preserved: Map<string, DocumentFragment>,
  onLeafFocus?: (leafId: string) => void,
): void {
  parent.replaceChildren();
  if (node.kind === 'leaf') {
    const leaf = document.createElement('div');
    leaf.className = MIXED_LEAF_CLASS;
    leaf.dataset.mixedLeafId = node.leafId;
    leaf.dataset.mixedSurface = node.surface;
    leaf.tabIndex = -1;
    leaf.addEventListener('pointerdown', () => onLeafFocus?.(node.leafId));
    const saved = preserved.get(node.leafId);
    if (saved) leaf.append(saved);
    parent.append(leaf);
    leafHosts.set(node.leafId, leaf);
    return;
  }

  const split = document.createElement('div');
  split.className = `${MIXED_SPLIT_CLASS} is-${node.direction}`;
  split.dataset.mixedSplitDirection = node.direction;

  const first = document.createElement('div');
  first.className = 'mixed-split-child';
  const divider = document.createElement('div');
  divider.className = MIXED_DIVIDER_CLASS;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', node.direction === 'vertical' ? 'vertical' : 'horizontal');
  const second = document.createElement('div');
  second.className = 'mixed-split-child';

  const firstPct = node.ratio * 100;
  const secondPct = 100 - firstPct;
  first.style.flex = `0 0 ${firstPct.toFixed(5)}%`;
  second.style.flex = `0 0 ${secondPct.toFixed(5)}%`;

  split.append(first, divider, second);
  parent.append(split);
  renderNode(first, node.first, leafHosts, preserved, onLeafFocus);
  renderNode(second, node.second, leafHosts, preserved, onLeafFocus);
  wireDivider(divider, split, first, second);
}

function wireDivider(divider: HTMLElement, split: HTMLElement, first: HTMLElement, second: HTMLElement): void {
  let dragging = false;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const rect = split.getBoundingClientRect();
    const vertical = split.classList.contains('is-vertical');
    const total = vertical ? rect.width : rect.height;
    if (total <= 0) return;
    const pos = vertical ? event.clientX - rect.left : event.clientY - rect.top;
    const ratio = clampRatio(pos / total);
    const firstPct = ratio * 100;
    const secondPct = 100 - firstPct;
    first.style.flex = `0 0 ${firstPct.toFixed(5)}%`;
    second.style.flex = `0 0 ${secondPct.toFixed(5)}%`;
  };

  const stop = (): void => {
    dragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };

  divider.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    divider.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
}

type LocatedSplit = {
  splitEl: HTMLElement;
  firstEl: HTMLElement;
  secondEl: HTMLElement;
  childKey: 'first' | 'second';
};

function locateLeafSplit(rootEl: HTMLElement, leafId: string): LocatedSplit | null {
  const leafEl = rootEl.querySelector<HTMLElement>(`[data-mixed-leaf-id="${leafId}"]`);
  if (!leafEl) return null;
  const splitEl = leafEl.closest<HTMLElement>(`.${MIXED_SPLIT_CLASS}`);
  if (!splitEl) return null;
  const branches = splitBranches(splitEl);
  if (branches.length !== 2) return null;
  const [firstEl, secondEl] = branches;
  const childKey = firstEl.contains(leafEl) ? 'first' : 'second';
  return { splitEl, firstEl, secondEl, childKey };
}

function splitBranches(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('mixed-split-child'),
  );
}

function parsePct(el: HTMLElement): number | null {
  const match = /(\d+(?:\.\d+)?)%/.exec(el.style.flex);
  return match ? Number(match[1]) : null;
}

function clampPct(value: number, total: number): number {
  const min = total * MIN_RATIO;
  const max = total - min;
  return Math.min(max, Math.max(min, value));
}

function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}

function domResizeDelta(
  splitEl: HTMLElement,
  childKey: 'first' | 'second',
  direction: MixedResizeDirection,
  step: number,
): number {
  const splitDirection = splitEl.classList.contains('is-horizontal') ? 'horizontal' : 'vertical';
  const growsFirst =
    (splitDirection === 'vertical' && childKey === 'first' && direction === 'right') ||
    (splitDirection === 'vertical' && childKey === 'second' && direction === 'left') ||
    (splitDirection === 'horizontal' && childKey === 'first' && direction === 'down') ||
    (splitDirection === 'horizontal' && childKey === 'second' && direction === 'up');
  const shrinksFirst =
    (splitDirection === 'vertical' && childKey === 'first' && direction === 'left') ||
    (splitDirection === 'vertical' && childKey === 'second' && direction === 'right') ||
    (splitDirection === 'horizontal' && childKey === 'first' && direction === 'up') ||
    (splitDirection === 'horizontal' && childKey === 'second' && direction === 'down');
  if (growsFirst) return step;
  if (shrinksFirst) return -step;
  return 0;
}
