/**
 * Per-window tab layout persistence (sessionStorage survives reload, not relaunch).
 * Pure helpers for serialize/migrate — views.ts owns DOM/session wiring on restore.
 */

import {
  connectionLayoutKey,
  type LaunchConnectionIntent,
} from '../connections/ConnectionIntent';
import {
  MIXED_LAYOUT_VERSION,
  serializeLayout,
  type MixedLayoutNode,
  type SerializedMixedLayout,
} from '../layout/MixedLayout';

export const TAB_LAYOUT_KEY = 'gosh-tab-layout';
export const SAVED_TAB_LAYOUT_VERSION = 2 as const;

export type SavedTerminalTab = {
  kind: 'terminal';
  spec: LaunchConnectionIntent;
};

export type SavedMixedTab = {
  kind: 'mixed';
  spec: LaunchConnectionIntent;
  layout: SerializedMixedLayout;
  /** leafId → navigated URL when not about:blank */
  browserUrls?: Record<string, string>;
};

export type SavedBrowserTab = {
  kind: 'browser';
  url: string;
  title?: string;
};

export type SavedTabEntry = SavedTerminalTab | SavedMixedTab | SavedBrowserTab;

export type SavedTabLayout = {
  version: typeof SAVED_TAB_LAYOUT_VERSION;
  tabs: SavedTabEntry[];
  activeIndex: number;
  /** Window connection identity when tabs include browser-only entries. */
  connectionKey?: string;
};

/** Legacy shape before mixed-tab support (no version field). */
export type LegacySavedTabLayout = {
  specs: LaunchConnectionIntent[];
  activeIndex: number;
};

export type RestorableSessionSnapshot =
  | {
      kind: 'terminal';
      spec: LaunchConnectionIntent;
      resumeEtSessionId?: string;
    }
  | {
      kind: 'mixed';
      spec: LaunchConnectionIntent;
      resumeEtSessionId?: string;
      mixedLayout: MixedLayoutNode;
      browserUrls?: Record<string, string>;
    }
  | {
      kind: 'browser';
      url: string;
      title?: string;
    };

const CONNECTION_PROTOCOLS = new Set(['ssh', 'mosh', 'et', 'tsshd', 'echo']);

export function isLegacySavedTabLayout(raw: unknown): raw is LegacySavedTabLayout {
  if (!raw || typeof raw !== 'object') return false;
  const record = raw as Record<string, unknown>;
  return (
    record.version === undefined &&
    Array.isArray(record.specs) &&
    record.specs.length > 0
  );
}

export function migrateLegacySavedTabLayout(legacy: LegacySavedTabLayout): SavedTabLayout {
  return {
    version: SAVED_TAB_LAYOUT_VERSION,
    tabs: legacy.specs.map((spec) => ({ kind: 'terminal', spec })),
    activeIndex: clampActiveIndex(legacy.activeIndex, legacy.specs.length),
  };
}

export function buildSavedTabLayout(
  tabs: SavedTabEntry[],
  activeIndex: number,
  connectionKey?: string,
): SavedTabLayout {
  const key = connectionKey?.trim();
  return {
    version: SAVED_TAB_LAYOUT_VERSION,
    tabs,
    activeIndex: clampActiveIndex(activeIndex, tabs.length),
    ...(key ? { connectionKey: key } : {}),
  };
}

export function snapshotToSavedTab(snapshot: RestorableSessionSnapshot): SavedTabEntry {
  if (snapshot.kind === 'browser') {
    const entry: SavedBrowserTab = { kind: 'browser', url: snapshot.url };
    const title = snapshot.title?.trim();
    if (title && title !== 'Browser') entry.title = title;
    return entry;
  }
  const spec = withResumeEtSession(snapshot.spec, snapshot.resumeEtSessionId);
  if (snapshot.kind === 'terminal') {
    return { kind: 'terminal', spec };
  }
  const entry: SavedMixedTab = {
    kind: 'mixed',
    spec,
    layout: serializeLayout(snapshot.mixedLayout),
  };
  const browserUrls = snapshot.browserUrls ? parseBrowserUrls(snapshot.browserUrls) : undefined;
  if (browserUrls) entry.browserUrls = browserUrls;
  return entry;
}

export function buildSavedTabLayoutFromSnapshots(
  snapshots: RestorableSessionSnapshot[],
  activeIndex: number,
  connectionKey?: string,
): SavedTabLayout | null {
  if (snapshots.length === 0) return null;
  return buildSavedTabLayout(snapshots.map(snapshotToSavedTab), activeIndex, connectionKey);
}

export function firstConnectionSpec(layout: SavedTabLayout): LaunchConnectionIntent | null {
  for (const tab of layout.tabs) {
    if (tab.kind === 'terminal' || tab.kind === 'mixed') return tab.spec;
  }
  return null;
}

export function firstTabSpec(layout: SavedTabLayout): LaunchConnectionIntent {
  const spec = firstConnectionSpec(layout);
  if (!spec) throw new Error('layout has no connection spec');
  return spec;
}

/** Connection identity for restore: stored key or first terminal/mixed tab spec. */
export function layoutConnectionKey(layout: SavedTabLayout): string {
  if (layout.connectionKey) return layout.connectionKey;
  const spec = firstConnectionSpec(layout);
  return spec ? connectionLayoutKey(spec) : '';
}

export function normalizeSavedTabLayout(raw: unknown): SavedTabLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (record.version === SAVED_TAB_LAYOUT_VERSION) {
    if (!Array.isArray(record.tabs) || record.tabs.length === 0) return null;
    const tabs = record.tabs
      .map((entry) => parseSavedTabEntry(entry))
      .filter((entry): entry is SavedTabEntry => entry !== null);
    if (tabs.length === 0) return null;
    const activeIndex =
      typeof record.activeIndex === 'number' ? record.activeIndex : 0;
    const connectionKey =
      typeof record.connectionKey === 'string' ? record.connectionKey.trim() : undefined;
    return buildSavedTabLayout(tabs, activeIndex, connectionKey);
  }

  if (isLegacySavedTabLayout(raw)) {
    return migrateLegacySavedTabLayout(raw);
  }

  return null;
}

export function parseSavedTabLayout(raw: string | null): SavedTabLayout | null {
  if (!raw) return null;
  try {
    return normalizeSavedTabLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeSavedTabLayout(layout: SavedTabLayout): string {
  return JSON.stringify(layout);
}

function parseSavedTabEntry(raw: unknown): SavedTabEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (record.kind === 'browser') {
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!url || url === 'about:blank') return null;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    return title ? { kind: 'browser', url, title } : { kind: 'browser', url };
  }

  const spec = parseConnectionSpec(record.spec);
  if (!spec) return null;

  if (record.kind === 'terminal') {
    return { kind: 'terminal', spec };
  }

  if (record.kind === 'mixed') {
    const layout = parseSerializedMixedLayout(record.layout);
    if (!layout) return null;
    const browserUrls = parseBrowserUrls(record.browserUrls);
    return browserUrls
      ? { kind: 'mixed', spec, layout, browserUrls }
      : { kind: 'mixed', spec, layout };
  }

  return null;
}

function parseConnectionSpec(raw: unknown): LaunchConnectionIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as LaunchConnectionIntent;
  if (typeof record.hostname !== 'string' || !record.hostname.trim()) return null;
  if (!CONNECTION_PROTOCOLS.has(record.protocol)) return null;
  if (!Array.isArray(record.args)) return null;
  return { ...record, hostname: record.hostname.trim() };
}

function parseSerializedMixedLayout(raw: unknown): SerializedMixedLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as SerializedMixedLayout;
  if (record.version !== MIXED_LAYOUT_VERSION) return null;
  if (!record.root || typeof record.root !== 'object') return null;
  return { version: MIXED_LAYOUT_VERSION, root: record.root };
}

function parseBrowserUrls(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const urls: Record<string, string> = {};
  for (const [leafId, url] of Object.entries(raw)) {
    if (typeof leafId !== 'string' || !leafId) continue;
    if (typeof url !== 'string' || !url || url === 'about:blank') continue;
    urls[leafId] = url;
  }
  return Object.keys(urls).length > 0 ? urls : undefined;
}

function withResumeEtSession(
  spec: LaunchConnectionIntent,
  resumeEtSessionId: string | undefined,
): LaunchConnectionIntent {
  return resumeEtSessionId ? { ...spec, etSessionId: resumeEtSessionId } : { ...spec };
}

function clampActiveIndex(activeIndex: number, tabCount: number): number {
  if (tabCount <= 0) return 0;
  if (!Number.isFinite(activeIndex)) return 0;
  return Math.max(0, Math.min(activeIndex, tabCount - 1));
}
