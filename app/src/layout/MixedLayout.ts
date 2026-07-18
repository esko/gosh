/**
 * Serializable split tree for Gosh-owned mixed terminal/browser layouts (ADR 0016).
 * Public types contain no DOM references.
 */

export type SurfaceKind = 'terminal' | 'browser';
export type MixedSplitDirection = 'vertical' | 'horizontal';
export type MixedResizeDirection = 'left' | 'right' | 'up' | 'down';

export type MixedLayoutLeaf = {
  kind: 'leaf';
  leafId: string;
  surface: SurfaceKind;
};

export type MixedLayoutSplit = {
  kind: 'split';
  direction: MixedSplitDirection;
  /** Fraction of the split axis allocated to `first` (0–1). */
  ratio: number;
  first: MixedLayoutNode;
  second: MixedLayoutNode;
};

export type MixedLayoutNode = MixedLayoutLeaf | MixedLayoutSplit;

export const MIXED_LAYOUT_VERSION = 1 as const;

export type SerializedMixedLayout = {
  version: typeof MIXED_LAYOUT_VERSION;
  root: MixedLayoutNode;
};

const MIN_RATIO = 0.1;
const DEFAULT_RATIO = 0.5;
export const DEFAULT_RESIZE_STEP = 0.06;

export function newLeafId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `leaf_${crypto.randomUUID()}`;
  }
  return `leaf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLeaf(surface: SurfaceKind, leafId = newLeafId()): MixedLayoutLeaf {
  return { kind: 'leaf', leafId, surface };
}

/** Two-leaf split with fresh leaf ids — common bootstrap for the D4 slice. */
export function createTwoPaneLayout(input: {
  direction: MixedSplitDirection;
  first: SurfaceKind;
  second: SurfaceKind;
  ratio?: number;
  firstLeafId?: string;
  secondLeafId?: string;
}): MixedLayoutSplit {
  return {
    kind: 'split',
    direction: input.direction,
    ratio: clampRatio(input.ratio ?? DEFAULT_RATIO),
    first: createLeaf(input.first, input.firstLeafId),
    second: createLeaf(input.second, input.secondLeafId),
  };
}

export function walkLeaves(root: MixedLayoutNode): MixedLayoutLeaf[] {
  if (root.kind === 'leaf') return [root];
  return [...walkLeaves(root.first), ...walkLeaves(root.second)];
}

export function findLeaf(root: MixedLayoutNode, leafId: string): MixedLayoutLeaf | null {
  return walkLeaves(root).find((leaf) => leaf.leafId === leafId) ?? null;
}

export function serializeLayout(root: MixedLayoutNode): SerializedMixedLayout {
  return { version: MIXED_LAYOUT_VERSION, root: cloneNode(root) };
}

export function deserializeLayout(input: unknown): MixedLayoutNode {
  if (!input || typeof input !== 'object') {
    throw new Error('layout must be an object');
  }
  const record = input as SerializedMixedLayout;
  if (record.version !== MIXED_LAYOUT_VERSION) {
    throw new Error(`unsupported mixed layout version: ${String(record.version)}`);
  }
  return validateNode(record.root);
}

export function resizeLeaf(
  root: MixedLayoutNode,
  leafId: string,
  direction: MixedResizeDirection,
  step = DEFAULT_RESIZE_STEP,
): MixedLayoutNode {
  const located = locateLeafParent(root, leafId);
  if (!located) return root;
  const { parent, childKey } = located;
  const delta = resizeDelta(parent.direction, childKey, direction, step);
  if (delta === 0) return root;
  const nextRatio = clampRatio(parent.ratio + delta);
  if (nextRatio === parent.ratio) return root;
  return replaceNode(root, parent, { ...parent, ratio: nextRatio });
}

export type SplitLeafResult = {
  layout: MixedLayoutNode;
  newLeafId: string;
};

/** Replace a leaf with a split containing the original leaf and a new sibling. */
export function splitLeaf(
  root: MixedLayoutNode,
  leafId: string,
  direction: MixedSplitDirection,
  newSurface: SurfaceKind,
  options?: { ratio?: number; newLeafId?: string },
): SplitLeafResult | null {
  const source = findLeaf(root, leafId);
  if (!source) return null;
  const siblingLeafId = options?.newLeafId ?? newLeafId();
  const split: MixedLayoutSplit = {
    kind: 'split',
    direction,
    ratio: clampRatio(options?.ratio ?? DEFAULT_RATIO),
    first: { ...source },
    second: createLeaf(newSurface, siblingLeafId),
  };
  return { layout: replaceLeaf(root, leafId, split), newLeafId: siblingLeafId };
}

/** Exchange two leaves in-place; leaf ids and surfaces move with each leaf. */
export function swapLeaves(root: MixedLayoutNode, leafIdA: string, leafIdB: string): MixedLayoutNode {
  if (leafIdA === leafIdB) return root;
  const leafA = findLeaf(root, leafIdA);
  const leafB = findLeaf(root, leafIdB);
  if (!leafA || !leafB) return root;
  const tempLeafId = `__swap_${leafIdA}__${leafIdB}`;
  let next = replaceLeaf(root, leafIdA, { ...leafB, leafId: tempLeafId });
  next = replaceLeaf(next, leafIdB, { ...leafA });
  return replaceLeaf(next, tempLeafId, { ...leafB });
}

export function removeLeaf(root: MixedLayoutNode, leafId: string): MixedLayoutNode | null {
  if (root.kind === 'leaf') {
    return root.leafId === leafId ? null : root;
  }
  const first = removeLeaf(root.first, leafId);
  const second = removeLeaf(root.second, leafId);
  if (!first) return second;
  if (!second) return first;
  return { ...root, first, second };
}

function validateNode(node: unknown): MixedLayoutNode {
  if (!node || typeof node !== 'object') throw new Error('invalid layout node');
  const record = node as MixedLayoutNode;
  if (record.kind === 'leaf') {
    if (typeof record.leafId !== 'string' || !record.leafId) throw new Error('leafId required');
    if (record.surface !== 'terminal' && record.surface !== 'browser') {
      throw new Error('surface must be terminal or browser');
    }
    return { kind: 'leaf', leafId: record.leafId, surface: record.surface };
  }
  if (record.kind === 'split') {
    if (record.direction !== 'vertical' && record.direction !== 'horizontal') {
      throw new Error('split direction must be vertical or horizontal');
    }
    if (typeof record.ratio !== 'number' || !Number.isFinite(record.ratio)) {
      throw new Error('split ratio must be a number');
    }
    return {
      kind: 'split',
      direction: record.direction,
      ratio: clampRatio(record.ratio),
      first: validateNode(record.first),
      second: validateNode(record.second),
    };
  }
  throw new Error('unknown layout node kind');
}

function cloneNode(node: MixedLayoutNode): MixedLayoutNode {
  if (node.kind === 'leaf') return { ...node };
  return { ...node, first: cloneNode(node.first), second: cloneNode(node.second) };
}

function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}

type LocatedParent = { parent: MixedLayoutSplit; childKey: 'first' | 'second' };

function locateLeafParent(
  node: MixedLayoutNode,
  leafId: string,
  parent?: LocatedParent,
): LocatedParent | null {
  if (node.kind === 'leaf') {
    return node.leafId === leafId ? parent ?? null : null;
  }
  return (
    locateLeafParent(node.first, leafId, { parent: node, childKey: 'first' }) ??
    locateLeafParent(node.second, leafId, { parent: node, childKey: 'second' })
  );
}

function resizeDelta(
  splitDirection: MixedSplitDirection,
  childKey: 'first' | 'second',
  direction: MixedResizeDirection,
  step: number,
): number {
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

function replaceNode(root: MixedLayoutNode, target: MixedLayoutSplit, replacement: MixedLayoutSplit): MixedLayoutNode {
  if (root === target) return replacement;
  if (root.kind === 'leaf') return root;
  return {
    ...root,
    first: replaceNode(root.first, target, replacement),
    second: replaceNode(root.second, target, replacement),
  };
}

function replaceLeaf(root: MixedLayoutNode, leafId: string, replacement: MixedLayoutNode): MixedLayoutNode {
  if (root.kind === 'leaf') {
    return root.leafId === leafId ? replacement : root;
  }
  return {
    ...root,
    first: replaceLeaf(root.first, leafId, replacement),
    second: replaceLeaf(root.second, leafId, replacement),
  };
}
