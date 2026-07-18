/**
 * Stable layout API over Restty's private pane DOM. All `.pane-split` /
 * `.pane-divider` / inline `flex: 0 0 <pct>%` access for resize and zoom lives
 * here so agent and adapter code never depend on Restty class names directly.
 */

export type PaneDirection = 'left' | 'right' | 'up' | 'down';

export type PaneLayoutNode = {
  kind: 'pane';
  paneId: number;
  flexPct: number;
};

export type SplitLayoutNode = {
  kind: 'split';
  orientation: 'vertical' | 'horizontal';
  children: [LayoutNode, LayoutNode];
};

export type LayoutNode = PaneLayoutNode | SplitLayoutNode;

export type LayoutSyncCallbacks = {
  requestLayoutSync?: () => void;
  syncLayout?: () => void;
};

const MIN_FLEX_PCT = 10;
const DEFAULT_FLEX_PCT = 50;
const DEFAULT_RESIZE_STEP_PCT = 6;

/** Read `<pct>` from inline `flex: 0 0 <pct>%`, else null. */
export function parseFlexPct(el: HTMLElement): number | null {
  const match = /(\d+(?:\.\d+)?)%/.exec(el.style.flex);
  return match ? Number(match[1]) : null;
}

/** Compute the next grow/shrink pair after a resize step (pure math). */
export function nextFlexPair(
  growPct: number,
  otherPct: number,
  stepPct: number,
  minPct = MIN_FLEX_PCT,
): { growPct: number; otherPct: number } {
  const total = growPct + otherPct;
  const nextGrow = Math.min(total - minPct, Math.max(minPct, growPct + stepPct));
  return { growPct: nextGrow, otherPct: total - nextGrow };
}

export function applyFlexPair(
  grow: HTMLElement,
  other: HTMLElement,
  growPct: number,
  otherPct: number,
): void {
  grow.style.flex = `0 0 ${growPct.toFixed(5)}%`;
  other.style.flex = `0 0 ${otherPct.toFixed(5)}%`;
}

/** Non-divider branch children of a `.pane-split` node. */
export function splitBranches(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('pane-divider'),
  );
}

export function paneElement(root: HTMLElement, paneId: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.pane[data-pane-id="${paneId}"]`);
}

function serializeLayoutNode(el: HTMLElement): LayoutNode | null {
  if (el.classList.contains('pane') && el.dataset.paneId) {
    const paneId = Number(el.dataset.paneId);
    if (!Number.isFinite(paneId)) return null;
    return {
      kind: 'pane',
      paneId,
      flexPct: parseFlexPct(el) ?? DEFAULT_FLEX_PCT,
    };
  }
  if (el.classList.contains('pane-split')) {
    const orientation = el.classList.contains('is-vertical')
      ? 'vertical'
      : el.classList.contains('is-horizontal')
        ? 'horizontal'
        : null;
    if (!orientation) return null;
    const branches = splitBranches(el);
    if (branches.length !== 2) return null;
    const first = serializeLayoutNode(branches[0]);
    const second = serializeLayoutNode(branches[1]);
    if (!first || !second) return null;
    return { kind: 'split', orientation, children: [first, second] };
  }
  return null;
}

/** Top-level pane or split node inside the terminal root. */
function layoutRootElement(root: HTMLElement): HTMLElement | null {
  for (const child of root.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (
      child.classList.contains('pane-split')
      || (child.classList.contains('pane') && child.dataset.paneId)
    ) {
      return child;
    }
  }
  return null;
}

export function buildLayoutTree(root: HTMLElement | null): LayoutNode | null {
  if (!root) return null;
  const layoutRoot = layoutRootElement(root);
  return layoutRoot ? serializeLayoutNode(layoutRoot) : null;
}

/**
 * Grow/shrink a pane toward a direction by nudging the divider of the nearest
 * matching split ancestor. Returns false when no applicable split exists.
 */
export function resizePaneTowardInDom(
  root: HTMLElement,
  paneId: number,
  direction: PaneDirection,
  amount = DEFAULT_RESIZE_STEP_PCT,
  callbacks: LayoutSyncCallbacks = {},
): boolean {
  const active = paneElement(root, paneId);
  if (!active) return false;
  const wantClass = direction === 'left' || direction === 'right' ? 'is-vertical' : 'is-horizontal';
  const wantFirst = direction === 'right' || direction === 'down';
  let node: HTMLElement = active;
  while (node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    if (parent.classList.contains('pane-split') && parent.classList.contains(wantClass)) {
      const branches = splitBranches(parent);
      if (branches.length === 2) {
        const isFirst = branches[0] === node;
        if (isFirst === wantFirst) {
          const grow = wantFirst ? branches[0] : branches[1];
          const other = wantFirst ? branches[1] : branches[0];
          const gPct = parseFlexPct(grow) ?? DEFAULT_FLEX_PCT;
          const oPct = parseFlexPct(other) ?? DEFAULT_FLEX_PCT;
          const next = nextFlexPair(gPct, oPct, amount);
          applyFlexPair(grow, other, next.growPct, next.otherPct);
          callbacks.requestLayoutSync?.();
          callbacks.syncLayout?.();
          return true;
        }
      }
    }
    node = parent;
  }
  return false;
}

export class ResttyLayoutController {
  private zoomedPaneId: number | null = null;
  private prevRootPosition: string | null = null;

  constructor(
    private readonly getRoot: () => HTMLElement | null,
    private readonly callbacks: LayoutSyncCallbacks = {},
  ) {}

  getPaneElement(paneId: number): HTMLElement | null {
    const root = this.getRoot();
    return root ? paneElement(root, paneId) : null;
  }

  getLayoutTree(): LayoutNode | null {
    return buildLayoutTree(this.getRoot());
  }

  resizePaneToward(paneId: number, direction: PaneDirection, amount: number): boolean {
    const root = this.getRoot();
    if (!root) return false;
    return resizePaneTowardInDom(root, paneId, direction, amount, this.callbacks);
  }

  setPaneZoomed(paneId: number, zoomed: boolean): boolean {
    if (zoomed) {
      if (this.zoomedPaneId === paneId) return true;
      if (this.zoomedPaneId !== null) this.clearZoom();
      return this.applyZoom(paneId);
    }
    if (this.zoomedPaneId === paneId) {
      this.clearZoom();
      return true;
    }
    return this.zoomedPaneId === null;
  }

  isPaneZoomed(paneId: number): boolean {
    return this.zoomedPaneId === paneId;
  }

  /** True when any pane is currently maximized. */
  hasZoomedPane(): boolean {
    return this.zoomedPaneId !== null;
  }

  /** Restore split layout when a zoomed pane closes or splits change. */
  clearZoom(): void {
    if (this.zoomedPaneId === null) return;
    const el = this.getPaneElement(this.zoomedPaneId);
    if (el) {
      el.style.position = '';
      el.style.inset = '';
      el.style.zIndex = '';
    }
    const root = this.getRoot();
    if (this.prevRootPosition !== null && root) {
      root.style.position = this.prevRootPosition;
      this.prevRootPosition = null;
    }
    this.zoomedPaneId = null;
    this.callbacks.requestLayoutSync?.();
    this.callbacks.syncLayout?.();
  }

  zoomedPaneIdOrNull(): number | null {
    return this.zoomedPaneId;
  }

  private applyZoom(paneId: number): boolean {
    const el = this.getPaneElement(paneId);
    const root = this.getRoot();
    if (!el || !root) return false;
    if (!root.style.position) {
      this.prevRootPosition = root.style.position;
      root.style.position = 'relative';
    }
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.zIndex = '6';
    this.zoomedPaneId = paneId;
    this.callbacks.requestLayoutSync?.();
    this.callbacks.syncLayout?.();
    return true;
  }
}
