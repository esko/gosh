import { describe, expect, it } from 'vitest';
import { mixedSplitAllowedForKeyboard, resolveMixedSplitTarget } from './mixedSession';

describe('resolveMixedSplitTarget', () => {
  const panes = [
    { paneId: 'p1', tabId: 'tab_a', active: true, surface: 'terminal' as const },
    { paneId: 'p2', tabId: 'tab_a', surface: 'browser' as const },
    { paneId: 'p3', tabId: 'tab_b', active: true, surface: 'browser' as const },
  ];

  it('returns the active pane and its surface by default', () => {
    expect(resolveMixedSplitTarget('tab_a', panes)).toEqual({ paneId: 'p1', surface: 'terminal' });
  });

  it('honors an explicit surface override', () => {
    expect(resolveMixedSplitTarget('tab_a', panes, 'browser')).toEqual({ paneId: 'p1', surface: 'browser' });
  });

  it('returns null when the tab has no active pane', () => {
    expect(resolveMixedSplitTarget('tab_missing', panes)).toBeNull();
  });
});

describe('mixedSplitAllowedForKeyboard', () => {
  it('allows keyboard split when a terminal leaf is focused', () => {
    expect(mixedSplitAllowedForKeyboard({ surface: 'terminal' })).toBe(true);
  });

  it('blocks keyboard split when a browser leaf is focused', () => {
    expect(mixedSplitAllowedForKeyboard({ surface: 'browser' })).toBe(false);
  });

  it('allows palette-driven splits that name a surface', () => {
    expect(mixedSplitAllowedForKeyboard({ surface: 'browser' }, 'browser')).toBe(true);
  });
});
