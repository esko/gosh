import { describe, expect, it } from 'vitest';
import { AgentEventBus } from './AgentEventBus';
import { CommandTracker } from './CommandTracker';

describe('CommandTracker', () => {
  const windowId = 'win_test';
  let now = 1000;

  function createTracker() {
    const events = new AgentEventBus();
    const tracker = new CommandTracker(events, windowId, () => now);
    return { tracker, events };
  }

  function feed(
    tracker: CommandTracker,
    paneId: string,
    phases: Array<{ phase: 'A' | 'B' | 'C' | 'D'; exitCode?: number; pos?: { row: number; col: number } }>,
  ) {
    for (const step of phases) {
      tracker.noteOsc133(paneId, {
        phase: step.phase,
        exitCode: step.exitCode,
        position: step.pos,
        atMs: now,
      });
      now += 1;
    }
  }

  it('tracks independent command lifecycles per pane', () => {
    const { tracker, events } = createTracker();
    const started: string[] = [];
    const completed: string[] = [];
    events.subscribe((event) => {
      if (event.type === 'terminal.command.started') started.push(event.paneId ?? '');
      if (event.type === 'terminal.command.completed') completed.push(event.paneId ?? '');
    });

    feed(tracker, 'pane_a', [
      { phase: 'A', pos: { row: 0, col: 0 } },
      { phase: 'B', pos: { row: 0, col: 2 } },
      { phase: 'C', pos: { row: 1, col: 0 } },
      { phase: 'D', exitCode: 0, pos: { row: 3, col: 0 } },
    ]);
    feed(tracker, 'pane_b', [
      { phase: 'C', pos: { row: 2, col: 0 } },
      { phase: 'D', exitCode: 127, pos: { row: 4, col: 0 } },
    ]);

    const lastA = tracker.getLastCommand('pane_a');
    expect(lastA?.exitCode).toBe(0);
    expect(lastA?.outputStart).toEqual({ row: 1, col: 0 });
    expect(lastA?.completedAt).toEqual({ row: 3, col: 0 });

    const lastB = tracker.getLastCommand('pane_b');
    expect(lastB?.exitCode).toBe(127);
    expect(lastB?.paneId).toBe('pane_b');

    expect(started).toEqual(['pane_a', 'pane_b']);
    expect(completed).toEqual(['pane_a', 'pane_b']);
    expect(tracker.getCurrentCommand('pane_a')).toBeNull();
  });

  it('resolves beginRun on the next D marker for that pane only', async () => {
    const { tracker } = createTracker();
    feed(tracker, 'pane_a', [{ phase: 'D', exitCode: 0 }]);

    const { completion } = tracker.beginRun('pane_a', 'echo hi');
    tracker.noteOsc133('pane_a', { phase: 'C', atMs: now });
    now += 1;
    tracker.noteOsc133('pane_a', { phase: 'D', exitCode: 0, atMs: now });

    const record = await completion;
    expect(record.command).toBe('echo hi');
    expect(record.exitCode).toBe(0);
  });

  it('ignores stale D markers that arrived before beginRun', async () => {
    const { tracker } = createTracker();
    const { completion } = tracker.beginRun('pane_a', 'true');
    tracker.noteOsc133('pane_a', { phase: 'D', exitCode: 1, atMs: now });
    const record = await completion;
    expect(record.exitCode).toBe(1);
    expect(record.command).toBe('true');
  });

  it('rejects concurrent beginRun on the same pane', () => {
    const { tracker } = createTracker();
    tracker.beginRun('pane_a', 'one');
    expect(() => tracker.beginRun('pane_a', 'two')).toThrow(/Concurrent/);
  });

  it('invalidates positions and rejects armed runs without throwing', async () => {
    const { tracker } = createTracker();
    const { completion } = tracker.beginRun('pane_a', 'ls');
    tracker.invalidatePane('pane_a', 'reconnect');
    await expect(completion).rejects.toMatchObject({ reason: 'reconnect' });
    expect(() => tracker.getLastCommand('pane_a')).not.toThrow();
    expect(tracker.getLastCommand('pane_a')).toBeNull();
  });

  it('supports cancellation via AbortSignal', async () => {
    const { tracker } = createTracker();
    const controller = new AbortController();
    const { completion } = tracker.beginRun('pane_a', 'sleep 9', controller.signal);
    controller.abort();
    await expect(completion).rejects.toMatchObject({ reason: 'cancelled' });
  });
});
