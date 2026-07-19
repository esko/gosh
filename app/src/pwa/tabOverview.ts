import type { TerminalTransportStatus } from './types';

export type TabOverviewEntry = {
  id: string;
  title: string;
  target?: string;
  protocol?: string;
  kind: 'launcher' | 'terminal' | 'browser' | 'mixed';
  status: TerminalTransportStatus;
  paneCount: number;
  active: boolean;
  previewUrl?: string;
};

export type TabPreview = {
  url: string;
  updatedAt: number;
};

type ObjectUrlApi = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};

/** Poll interval while the Exposé / tab-overview overlay is open. */
export const LIVE_TAB_PREVIEW_MS = 700;

function entrySearchText(entry: TabOverviewEntry): string {
  return [
    entry.title,
    entry.target,
    entry.protocol,
    entry.kind === 'launcher' ? 'new tab launcher' : entry.kind === 'browser' ? 'browser web' : entry.kind === 'mixed' ? 'mixed terminal browser' : undefined,
    entry.status,
    entry.paneCount > 1 ? `${entry.paneCount} panes splits` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterTabOverviewEntries(
  entries: TabOverviewEntry[],
  query: string,
): TabOverviewEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = entrySearchText(entry);
    return terms.every((term) => haystack.includes(term));
  });
}

export function clampTabOverviewSelection(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(count - 1, Math.trunc(index)));
}

export function moveTabOverviewSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  const current = clampTabOverviewSelection(index, count);
  const step = Math.trunc(delta);
  return (current + step + count) % count;
}

export class TabPreviewCache {
  private readonly previews = new Map<string, TabPreview>();

  constructor(private readonly objectUrls: ObjectUrlApi = URL) {}

  get(tabId: string): TabPreview | undefined {
    return this.previews.get(tabId);
  }

  set(tabId: string, blob: Blob, updatedAt = Date.now()): TabPreview {
    this.revoke(tabId);
    const preview = { url: this.objectUrls.createObjectURL(blob), updatedAt };
    this.previews.set(tabId, preview);
    return preview;
  }

  revoke(tabId: string): void {
    const existing = this.previews.get(tabId);
    if (!existing) return;
    this.objectUrls.revokeObjectURL(existing.url);
    this.previews.delete(tabId);
  }

  clear(): void {
    for (const tabId of [...this.previews.keys()]) this.revoke(tabId);
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Update card preview images in place when blob URLs change (live Exposé). */
export function patchTabOverviewPreviewImages(
  root: ParentNode,
  getPreviewUrl: (tabId: string) => string | undefined,
): void {
  for (const card of root.querySelectorAll<HTMLElement>('[data-tab-overview-id]')) {
    const tabId = card.dataset.tabOverviewId;
    if (!tabId) continue;
    const thumb = card.querySelector('.tab-overview-thumb');
    if (!thumb) continue;
    const url = getPreviewUrl(tabId);
    let img = thumb.querySelector<HTMLImageElement>('img.tab-overview-img');
    if (!url) {
      if (img) {
        img.remove();
        if (!thumb.querySelector('.tab-overview-placeholder')) {
          const placeholder = document.createElement('div');
          placeholder.className = 'tab-overview-placeholder';
          placeholder.innerHTML = '<span>No preview yet</span>';
          thumb.prepend(placeholder);
        }
      }
      continue;
    }
    thumb.querySelector('.tab-overview-placeholder')?.remove();
    if (!img) {
      const holder = document.createElement('div');
      holder.innerHTML = `<img class="tab-overview-img" alt="" src="${escapeAttr(url)}">`;
      img = holder.firstElementChild as HTMLImageElement;
      thumb.prepend(img);
    } else if (img.getAttribute('src') !== url) {
      img.setAttribute('src', url);
    }
  }
}
