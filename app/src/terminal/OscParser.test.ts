import { describe, expect, it } from 'vitest';
import {
  OscParser,
  OSC_PARSER_MAX_CARRY,
  applyOsc133Event,
  createOsc133State,
} from './OscParser';

describe('OscParser', () => {
  it('parses OSC 0/2 title with BEL and ST terminators', () => {
    const bel = new OscParser();
    expect(bel.ingest('\x1b]0;hello\x07')).toEqual([{ type: 'title', value: 'hello' }]);

    const st = new OscParser();
    expect(st.ingest('\x1b]2;world\x1b\\')).toEqual([{ type: 'title', value: 'world' }]);
  });

  it('parses OSC 7 cwd from file:// URIs', () => {
    const parser = new OscParser();
    expect(parser.ingest('\x1b]7;file://myhost/home/user/proj\x07')).toEqual([
      { type: 'cwd', path: '/home/user/proj' },
    ]);
  });

  it('decodes cwd path segments across chunk boundaries', () => {
    const parser = new OscParser();
    const seq = '\x1b]7;file://host/var/log\x07';
    const mid = Math.floor(seq.length / 2);
    expect(parser.ingest(seq.slice(0, mid))).toEqual([]);
    expect(parser.ingest(seq.slice(mid))).toEqual([{ type: 'cwd', path: '/var/log' }]);
  });

  it('handles sequences split across arbitrary chunk boundaries', () => {
    const parser = new OscParser();
    const seq = 'prompt\x1b]0;split title\x07done';
    const events = [];
    for (const ch of seq) events.push(...parser.ingest(ch));
    expect(events).toEqual([{ type: 'title', value: 'split title' }]);
  });

  it('parses OSC 133 A/B/C/D markers', () => {
    const parser = new OscParser();
    expect(parser.ingest('\x1b]133;A\x07')).toEqual([{ type: 'osc133', phase: 'A' }]);
    expect(parser.ingest('\x1b]133;B\x1b\\')).toEqual([{ type: 'osc133', phase: 'B' }]);
    expect(parser.ingest('\x1b]133;C\x07')).toEqual([{ type: 'osc133', phase: 'C' }]);
    expect(parser.ingest('\x1b]133;D\x07')).toEqual([{ type: 'osc133', phase: 'D' }]);
  });

  it('parses OSC 133 D exit codes', () => {
    const parser = new OscParser();
    expect(parser.ingest('\x1b]133;D;0\x07')).toEqual([{ type: 'osc133', phase: 'D', exitCode: 0 }]);
    expect(parser.ingest('\x1b]133;D;127\x1b\\')).toEqual([
      { type: 'osc133', phase: 'D', exitCode: 127 },
    ]);
  });

  it('ignores unknown OSC commands without emitting events', () => {
    const parser = new OscParser();
    expect(parser.ingest('\x1b]8;;https://x.example\x07')).toEqual([]);
    expect(parser.ingest('\x1b]52;c;\x07')).toEqual([]);
  });

  it('treats nested-looking ESC inside OSC body as payload until terminator', () => {
    const parser = new OscParser();
    const seq = '\x1b]0;has \x1b]not a title\x07';
    expect(parser.ingest(seq)).toEqual([{ type: 'title', value: 'has \x1b]not a title' }]);
  });

  it('drops oversized unterminated sequences and resets carry', () => {
    const parser = new OscParser();
    const huge = '\x1b]' + 'x'.repeat(OSC_PARSER_MAX_CARRY + 1);
    expect(parser.ingest(huge)).toEqual([]);
    expect(parser.ingest('\x1b]0;ok\x07')).toEqual([{ type: 'title', value: 'ok' }]);
  });

  it('resets and accepts new sequences after overflow', () => {
    const parser = new OscParser();
    parser.ingest('\x1b]' + 'a'.repeat(OSC_PARSER_MAX_CARRY));
    parser.reset();
    expect(parser.ingest('\x1b]2;fresh\x07')).toEqual([{ type: 'title', value: 'fresh' }]);
  });

  it('applyOsc133Event tracks command lifecycle', () => {
    const state = createOsc133State();
    applyOsc133Event(state, { type: 'osc133', phase: 'A' }, 100);
    expect(state).toEqual({
      phase: 'A',
      commandRunning: false,
      exitCode: null,
      lastMarkerAt: 100,
    });

    applyOsc133Event(state, { type: 'osc133', phase: 'C' }, 200);
    expect(state.commandRunning).toBe(true);

    applyOsc133Event(state, { type: 'osc133', phase: 'D', exitCode: 42 }, 300);
    expect(state).toEqual({
      phase: 'D',
      commandRunning: false,
      exitCode: 42,
      lastMarkerAt: 300,
    });
  });
});
