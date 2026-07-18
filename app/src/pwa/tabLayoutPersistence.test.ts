import { describe, expect, it } from 'vitest';
import { createTwoPaneLayout, serializeLayout } from '../layout/MixedLayout';
import type { LaunchConnectionIntent } from '../connections/ConnectionIntent';
import {
  buildSavedTabLayout,
  buildSavedTabLayoutFromSnapshots,
  firstTabSpec,
  isLegacySavedTabLayout,
  migrateLegacySavedTabLayout,
  normalizeSavedTabLayout,
  parseSavedTabLayout,
  serializeSavedTabLayout,
  snapshotToSavedTab,
  type SavedTabLayout,
} from './tabLayoutPersistence';

const sshSpec = (host: string): LaunchConnectionIntent => ({
  protocol: 'ssh',
  hostname: host,
  args: [],
});

describe('tabLayoutPersistence', () => {
  it('detects legacy layouts without a version field', () => {
    const legacy = { specs: [sshSpec('one')], activeIndex: 0 };
    expect(isLegacySavedTabLayout(legacy)).toBe(true);
    expect(isLegacySavedTabLayout({ version: 2, tabs: [], activeIndex: 0 })).toBe(false);
  });

  it('migrates legacy terminal-only layouts to version 2', () => {
    const legacy = { specs: [sshSpec('a'), sshSpec('b')], activeIndex: 1 };
    const migrated = migrateLegacySavedTabLayout(legacy);
    expect(migrated).toEqual({
      version: 2,
      tabs: [
        { kind: 'terminal', spec: sshSpec('a') },
        { kind: 'terminal', spec: sshSpec('b') },
      ],
      activeIndex: 1,
    });
  });

  it('round-trips version 2 layouts with terminal and mixed tabs', () => {
    const layout = createTwoPaneLayout({
      direction: 'vertical',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 'leaf_term',
      secondLeafId: 'leaf_browser',
    });
    const saved: SavedTabLayout = buildSavedTabLayout(
      [
        { kind: 'terminal', spec: sshSpec('host-a') },
        {
          kind: 'mixed',
          spec: { ...sshSpec('host-b'), etSessionId: 'et-1' },
          layout: serializeLayout(layout),
          browserUrls: { leaf_browser: 'https://example.com/docs' },
        },
      ],
      1,
    );
    const json = serializeSavedTabLayout(saved);
    const parsed = parseSavedTabLayout(json);
    expect(parsed).toEqual(saved);
    expect(firstTabSpec(parsed!)).toEqual(sshSpec('host-a'));
  });

  it('builds saved layout from session snapshots', () => {
    const mixedLayout = createTwoPaneLayout({
      direction: 'horizontal',
      first: 'terminal',
      second: 'browser',
      firstLeafId: 't1',
      secondLeafId: 'b1',
    });
    const layout = buildSavedTabLayoutFromSnapshots(
      [
        { kind: 'terminal', spec: sshSpec('one'), resumeEtSessionId: 'et-old' },
        {
          kind: 'mixed',
          spec: sshSpec('two'),
          mixedLayout,
          browserUrls: { b1: 'https://gosh.dev' },
        },
      ],
      0,
    );
    expect(layout?.tabs[0]).toEqual({
      kind: 'terminal',
      spec: { ...sshSpec('one'), etSessionId: 'et-old' },
    });
    expect(layout?.tabs[1]?.kind).toBe('mixed');
    if (layout?.tabs[1]?.kind === 'mixed') {
      expect(layout.tabs[1].browserUrls).toEqual({ b1: 'https://gosh.dev' });
      expect(layout.tabs[1].layout.version).toBe(1);
    }
  });

  it('normalizes legacy JSON and clamps active index', () => {
    const parsed = normalizeSavedTabLayout({
      specs: [sshSpec('only')],
      activeIndex: 99,
    });
    expect(parsed?.activeIndex).toBe(0);
    expect(parsed?.tabs).toHaveLength(1);
  });

  it('rejects invalid or empty payloads', () => {
    expect(parseSavedTabLayout(null)).toBeNull();
    expect(parseSavedTabLayout('not json')).toBeNull();
    expect(normalizeSavedTabLayout({ version: 2, tabs: [], activeIndex: 0 })).toBeNull();
    expect(
      normalizeSavedTabLayout({
        version: 2,
        tabs: [{ kind: 'mixed', spec: { protocol: 'ssh', hostname: 'x', args: [] }, layout: { version: 9, root: {} } }],
        activeIndex: 0,
      }),
    ).toBeNull();
  });

  it('snapshotToSavedTab omits blank browser URLs', () => {
    const tab = snapshotToSavedTab({
      kind: 'mixed',
      spec: sshSpec('host'),
      mixedLayout: createTwoPaneLayout({
        direction: 'vertical',
        first: 'terminal',
        second: 'browser',
        firstLeafId: 't',
        secondLeafId: 'b',
      }),
      browserUrls: { b: 'about:blank' },
    });
    expect(tab.kind).toBe('mixed');
    if (tab.kind === 'mixed') {
      expect(tab.browserUrls).toBeUndefined();
    }
  });
});
