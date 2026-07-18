/**
 * Mixed tab layout helpers — keeps Gosh-owned split layout wiring out of views.ts bulk.
 */

import type { ControlledFrameController } from '../browser/ControlledFrameController';
import { mountBrowserSession } from '../browser/BrowserSession';
import { createBrowserAgentStateHook } from './agentControlHost';
import {
  createTwoPaneLayout,
  removeLeaf,
  splitLeaf,
  walkLeaves,
  type MixedLayoutNode,
  type MixedResizeDirection,
  type MixedSplitDirection,
  type SurfaceKind,
} from '../layout/MixedLayout';
import { mountMixedLayoutDom, type MixedLayoutDomMount } from '../layout/mixedLayoutDom';
import type { WorkspaceRegistry } from '../agent/WorkspaceRegistry';
import type { ResttyTerminalAdapter } from './resttyAdapter';
import type { TerminalSubscription } from '../terminal/TerminalAdapter';

export type MixedLeafState = {
  leafId: string;
  surface: 'terminal' | 'browser';
  terminal?: ResttyTerminalAdapter;
  browser?: ControlledFrameController | null;
  browserDispose?: () => void;
  titleSub?: TerminalSubscription | null;
};

export function createMixedLayout(
  tabId: string,
  direction: MixedSplitDirection = 'vertical',
): { layout: MixedLayoutNode; terminalLeafId: string; browserLeafId: string } {
  const terminalLeafId = `leaf_${tabId}_term`;
  const browserLeafId = `leaf_${tabId}_browser`;
  const layout = createTwoPaneLayout({
    direction,
    first: 'terminal',
    second: 'browser',
    firstLeafId: terminalLeafId,
    secondLeafId: browserLeafId,
  });
  return { layout, terminalLeafId, browserLeafId };
}

export function mountMixedLayout(
  container: HTMLElement,
  layout: MixedLayoutNode,
  onLayoutChange: (layout: MixedLayoutNode) => void,
  onLeafFocus: (leafId: string) => void,
): MixedLayoutDomMount {
  return mountMixedLayoutDom(container, layout, { onLayoutChange, onLeafFocus });
}

export function attachMixedBrowserLeaf(
  registry: WorkspaceRegistry,
  tabId: string,
  leaves: Map<string, MixedLeafState>,
  leafId: string,
  hostEl: HTMLElement,
  initialUrl?: string,
): void {
  const paneId = registry.openPane({ tabId, surface: 'browser', leafId });
  const leafContainer = document.createElement('div');
  leafContainer.className = 'term-browser mixed-browser-leaf';
  hostEl.append(leafContainer);
  const handle = mountBrowserSession({
    tabId,
    container: leafContainer,
    initialUrl,
    onAgentNavState: createBrowserAgentStateHook(tabId, paneId),
  });
  leaves.set(leafId, {
    leafId,
    surface: 'browser',
    browser: handle.controller,
    browserDispose: handle.dispose,
  });
}

export function disposeMixedLeaf(leaves: Map<string, MixedLeafState>, leafId: string): void {
  const leaf = leaves.get(leafId);
  if (!leaf) return;
  leaf.titleSub?.dispose();
  leaf.browserDispose?.();
  leaves.delete(leafId);
}

export function collapseMixedLayout(
  mount: MixedLayoutDomMount,
  layout: MixedLayoutNode,
  leafId: string,
): MixedLayoutNode | null {
  const next = removeLeaf(layout, leafId);
  if (!next) return null;
  mount.applyLayout(next);
  return next;
}

export function terminalLeafId(layout: MixedLayoutNode): string | undefined {
  return walkLeaves(layout).find((leaf) => leaf.surface === 'terminal')?.leafId;
}

export function browserLeafId(layout: MixedLayoutNode): string | undefined {
  return walkLeaves(layout).find((leaf) => leaf.surface === 'browser')?.leafId;
}

export function resizeMixedLeaf(
  mount: MixedLayoutDomMount,
  layout: MixedLayoutNode,
  leafId: string,
  direction: MixedResizeDirection,
  step?: number,
): boolean {
  void layout;
  return mount.resizeLeaf(leafId, direction, step);
}

export function zoomMixedLeaf(
  mount: MixedLayoutDomMount,
  leafId: string,
  zoomed?: boolean,
): boolean {
  if (zoomed === undefined) return mount.toggleLeafZoom(leafId);
  return mount.setLeafZoomed(leafId, zoomed);
}

export function isMixedLeafZoomed(mount: MixedLayoutDomMount, leafId: string): boolean {
  return mount.isLeafZoomed(leafId);
}

export function splitMixedLayoutLeaf(
  layout: MixedLayoutNode,
  leafId: string,
  direction: MixedSplitDirection,
  newSurface: SurfaceKind,
): { layout: MixedLayoutNode; newLeafId: string } | null {
  return splitLeaf(layout, leafId, direction, newSurface);
}

export function focusMixedLeafDom(container: HTMLElement, leaf: MixedLeafState): void {
  if (leaf.surface === 'terminal') {
    leaf.terminal?.focus();
    return;
  }
  container.querySelector<HTMLInputElement>('[data-browser-url]')?.focus();
}
