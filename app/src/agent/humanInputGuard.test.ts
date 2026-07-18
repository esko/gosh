import { describe, expect, it } from 'vitest';
import { HUMAN_INPUT_GUARD_MS, HumanInputTracker } from './humanInputGuard';

describe('HumanInputTracker', () => {
  it('blocks within the guard window and clears after it elapses', () => {
    const tracker = new HumanInputTracker();
    tracker.noteHumanInput('pane_a', 1000);
    expect(tracker.isBlocked('pane_a', 1500)).toBe(true);
    expect(tracker.isBlocked('pane_a', 1000 + HUMAN_INPUT_GUARD_MS)).toBe(false);
    expect(tracker.isBlocked('pane_b', 1500)).toBe(false);
  });

  it('forgets a pane when cleared', () => {
    const tracker = new HumanInputTracker();
    tracker.noteHumanInput('pane_a', 1000);
    tracker.clearPane('pane_a');
    expect(tracker.isBlocked('pane_a', 1100)).toBe(false);
  });
});
