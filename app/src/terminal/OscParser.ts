/** Default carry cap for incomplete OSC sequences (malformed / unterminated). */
export const OSC_PARSER_MAX_CARRY = 8192;

export type OscTitleEvent = { type: 'title'; value: string };
export type OscCwdEvent = { type: 'cwd'; path: string };
export type Osc133Phase = 'A' | 'B' | 'C' | 'D';
export type Osc133Event = { type: 'osc133'; phase: Osc133Phase; exitCode?: number };

export type OscEvent = OscTitleEvent | OscCwdEvent | Osc133Event;

export type Osc133State = {
  phase: Osc133Phase | null;
  commandRunning: boolean;
  exitCode: number | null;
  /** Epoch ms when any OSC 133 marker was last applied; null before first marker. */
  lastMarkerAt: number | null;
};

export function createOsc133State(): Osc133State {
  return { phase: null, commandRunning: false, exitCode: null, lastMarkerAt: null };
}

/** Apply an OSC 133 marker to pane-local prompt/command tracking state. */
export function applyOsc133Event(state: Osc133State, event: Osc133Event, atMs = Date.now()): void {
  state.phase = event.phase;
  state.lastMarkerAt = atMs;
  switch (event.phase) {
    case 'A':
    case 'B':
      state.commandRunning = false;
      state.exitCode = null;
      break;
    case 'C':
      state.commandRunning = true;
      state.exitCode = null;
      break;
    case 'D':
      state.commandRunning = false;
      state.exitCode = event.exitCode ?? null;
      break;
    default:
      break;
  }
}

type ParseMode = 'ground' | 'osc';

function parseOscBody(body: string): OscEvent[] {
  const events: OscEvent[] = [];
  const semi = body.indexOf(';');
  const command = semi < 0 ? body : body.slice(0, semi);
  const rest = semi < 0 ? '' : body.slice(semi + 1);

  if (command === '0' || command === '2') {
    events.push({ type: 'title', value: rest });
    return events;
  }

  if (command === '7') {
    const filePrefix = 'file://';
    const idx = rest.indexOf(filePrefix);
    if (idx >= 0) {
      const afterScheme = rest.slice(idx + filePrefix.length);
      const slash = afterScheme.indexOf('/');
      const path = slash >= 0 ? afterScheme.slice(slash) : '';
      events.push({ type: 'cwd', path });
    }
    return events;
  }

  if (command === '133' && rest) {
    const phase = rest[0] as Osc133Phase;
    if (phase === 'A' || phase === 'B' || phase === 'C' || phase === 'D') {
      let exitCode: number | undefined;
      if (phase === 'D' && rest.length > 2 && rest[1] === ';') {
        const raw = rest.slice(2);
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) exitCode = parsed;
      }
      events.push({ type: 'osc133', phase, exitCode });
    }
  }

  return events;
}

/**
 * Incremental OSC scanner for PTY output. Scans for `ESC ] … (BEL | ST)` and
 * emits title, cwd, and OSC 133 events without transforming ground text.
 */
export class OscParser {
  private carry = '';
  private mode: ParseMode = 'ground';
  private oscBody = '';

  reset(): void {
    this.carry = '';
    this.mode = 'ground';
    this.oscBody = '';
  }

  /** True when an OSC opener or body is held across writes. */
  hasPending(): boolean {
    return this.carry.length > 0 || this.mode === 'osc';
  }

  ingest(chunk: string): OscEvent[] {
    if (!chunk && !this.carry && this.mode === 'ground') return [];

    const input = this.carry + chunk;
    this.carry = '';
    const events: OscEvent[] = [];
    let i = 0;

    while (i < input.length) {
      if (this.mode === 'ground') {
        const esc = input.indexOf('\x1b', i);
        if (esc < 0) break;
        if (esc + 1 >= input.length) {
          this.carry = input.slice(esc);
          return events;
        }
        if (input[esc + 1] === ']') {
          this.mode = 'osc';
          this.oscBody = '';
          i = esc + 2;
          continue;
        }
        i = esc + 1;
        continue;
      }

      const ch = input[i];
      if (ch === '\x07') {
        events.push(...parseOscBody(this.oscBody));
        this.mode = 'ground';
        this.oscBody = '';
        i += 1;
        continue;
      }
      if (ch === '\\' && input[i - 1] === '\x1b') {
        events.push(...parseOscBody(this.oscBody.slice(0, -1)));
        this.mode = 'ground';
        this.oscBody = '';
        i += 1;
        continue;
      }

      this.oscBody += ch;
      i += 1;

      if (this.oscBody.length > OSC_PARSER_MAX_CARRY) {
        this.reset();
        break;
      }
    }

    if (this.mode === 'osc' && i >= input.length) {
      const pending = this.oscBody;
      if (pending.length > OSC_PARSER_MAX_CARRY) {
        this.reset();
      } else {
        this.carry = '\x1b]' + pending;
        this.oscBody = '';
        this.mode = 'ground';
      }
    }

    return events;
  }
}
