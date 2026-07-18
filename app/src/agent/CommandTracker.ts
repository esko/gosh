import type { AgentEventBus } from './AgentEventBus';
import type { TerminalPosition } from './types';

export type Osc133Phase = 'A' | 'B' | 'C' | 'D';

export type Osc133FeedEvent = {
  phase: Osc133Phase;
  exitCode?: number;
  position?: TerminalPosition;
  atMs?: number;
};

export type CommandRecord = {
  id: string;
  paneId: string;
  command?: string;
  promptStart?: TerminalPosition;
  inputStart?: TerminalPosition;
  outputStart?: TerminalPosition;
  completedAt?: TerminalPosition;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
};

type ArmedRun = {
  id: string;
  command: string;
  armedAt: number;
  baselineDCount: number;
  resolve: (record: CommandRecord) => void;
  reject: (err: Error & { reason: string }) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type PaneTrackerState = {
  current: CommandRecord | null;
  last: CommandRecord | null;
  dCount: number;
  armedRun: ArmedRun | null;
};

function cloneRecord(record: CommandRecord): CommandRecord {
  return { ...record };
}

/**
 * Per-pane OSC 133 command lifecycle tracker.
 *
 * Scrollback discard is not observable from Restty today; when a pane is
 * invalidated (reconnect, explicit invalidate) positional ranges are cleared
 * and in-flight runs fail safely. Missing ranges never throw — callers fall
 * back to best-effort capture.
 */
export class CommandTracker {
  private readonly panes = new Map<string, PaneTrackerState>();
  private idCounter = 0;

  constructor(
    private readonly events: AgentEventBus,
    private readonly windowId: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  noteOsc133(paneId: string, event: Osc133FeedEvent): CommandRecord | null {
    const atMs = event.atMs ?? this.now();
    const state = this.paneState(paneId);

    switch (event.phase) {
      case 'A': {
        const rec = state.current ?? this.startRecord(paneId);
        if (event.position) rec.promptStart = event.position;
        state.current = rec;
        return cloneRecord(rec);
      }
      case 'B': {
        const rec = state.current ?? this.startRecord(paneId);
        if (event.position) rec.inputStart = event.position;
        state.current = rec;
        return cloneRecord(rec);
      }
      case 'C': {
        const rec = this.startRecord(paneId, {
          command: state.armedRun?.command,
          outputStart: event.position,
          startedAt: atMs,
        });
        state.current = rec;
        this.events.emit('terminal.command.started', {
          windowId: this.windowId,
          paneId,
          commandId: rec.id,
        });
        return cloneRecord(rec);
      }
      case 'D': {
        const rec = state.current ?? this.startRecord(paneId);
        if (event.position) rec.completedAt = event.position;
        rec.exitCode = event.exitCode;
        rec.finishedAt = atMs;
        state.dCount += 1;
        state.last = rec;
        state.current = null;
        this.events.emit('terminal.command.completed', {
          windowId: this.windowId,
          paneId,
          commandId: rec.id,
          exitCode: rec.exitCode ?? null,
        });
        if (state.armedRun && state.dCount > state.armedRun.baselineDCount) {
          rec.command = state.armedRun.command;
          this.finishArmedRun(state, rec);
        }
        return cloneRecord(rec);
      }
      default:
        return null;
    }
  }

  /** Arm a pane for the next OSC 133 D marker after `send` (one run per pane). */
  beginRun(
    paneId: string,
    command: string,
    signal?: AbortSignal,
  ): { runId: string; completion: Promise<CommandRecord> } {
    const state = this.paneState(paneId);
    if (state.armedRun) {
      throw Object.assign(new Error('Concurrent terminalRun on pane'), { reason: 'conflict' });
    }
    const runId = this.nextId('run');
    const completion = new Promise<CommandRecord>((resolve, reject) => {
      const armed: ArmedRun = {
        id: runId,
        command,
        armedAt: this.now(),
        baselineDCount: state.dCount,
        resolve,
        reject,
        signal,
      };
      const onAbort = () => {
        if (state.armedRun !== armed) return;
        state.armedRun = null;
        reject(Object.assign(new Error('cancelled'), { reason: 'cancelled' }));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      armed.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
      state.armedRun = armed;
    });
    return { runId, completion };
  }

  hasArmedRun(paneId: string): boolean {
    return Boolean(this.panes.get(paneId)?.armedRun);
  }

  invalidatePane(paneId: string, reason: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    if (state.current) this.clearPositions(state.current);
    if (state.last) this.clearPositions(state.last);
    state.current = null;
    if (state.armedRun) {
      const armed = state.armedRun;
      state.armedRun = null;
      if (armed.signal && armed.onAbort) armed.signal.removeEventListener('abort', armed.onAbort);
      armed.reject(Object.assign(new Error(reason), { reason }));
    }
    this.panes.delete(paneId);
  }

  getCurrentCommand(paneId: string): CommandRecord | null {
    const current = this.panes.get(paneId)?.current;
    return current ? cloneRecord(current) : null;
  }

  getLastCommand(paneId: string): CommandRecord | null {
    const last = this.panes.get(paneId)?.last;
    return last ? cloneRecord(last) : null;
  }

  private finishArmedRun(state: PaneTrackerState, record: CommandRecord): void {
    const armed = state.armedRun;
    if (!armed) return;
    state.armedRun = null;
    if (armed.signal && armed.onAbort) armed.signal.removeEventListener('abort', armed.onAbort);
    armed.resolve(cloneRecord(record));
  }

  private paneState(paneId: string): PaneTrackerState {
    let state = this.panes.get(paneId);
    if (!state) {
      state = { current: null, last: null, dCount: 0, armedRun: null };
      this.panes.set(paneId, state);
    }
    return state;
  }

  private startRecord(paneId: string, partial?: Partial<CommandRecord>): CommandRecord {
    return {
      id: this.nextId('cmd'),
      paneId,
      ...partial,
    };
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter}`;
  }

  private clearPositions(record: CommandRecord): void {
    delete record.promptStart;
    delete record.inputStart;
    delete record.outputStart;
    delete record.completedAt;
  }
}
