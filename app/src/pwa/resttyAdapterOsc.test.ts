import { describe, expect, it } from 'vitest';
import { ResttyTerminalAdapter } from './resttyAdapter';

describe('ResttyTerminalAdapter OSC capture', () => {
  const makeAdapter = () => {
    const adapter = new ResttyTerminalAdapter();
    const bridge = adapter.registerPane(0);
    adapter.focusPane(0);
    return { adapter, bridge };
  };

  it('updates title and cwd from OSC 0/7 sequences', () => {
    const { adapter, bridge } = makeAdapter();
    const titles: string[] = [];
    adapter.onTitle((t) => titles.push(t));

    adapter.captureOsc(bridge, '\x1b]0;my session\x07');
    expect(titles).toEqual(['my session']);

    adapter.captureOsc(bridge, '\x1b]7;file://host/home/user\x1b\\');
    expect(adapter.getCwd()).toBe('/home/user');
  });

  it('keeps title/cwd when sequences span writes', () => {
    const { adapter, bridge } = makeAdapter();
    const titles: string[] = [];
    adapter.onTitle((t) => titles.push(t));
    const seq = '\x1b]2;split\x07';
    const mid = 4;
    adapter.captureOsc(bridge, seq.slice(0, mid));
    adapter.captureOsc(bridge, seq.slice(mid));
    expect(titles).toEqual(['split']);
  });

  it('tracks OSC 133 markers per pane', () => {
    const { adapter, bridge } = makeAdapter();
    adapter.captureOsc(bridge, '\x1b]133;A\x07');
    adapter.captureOsc(bridge, '\x1b]133;C\x07');
    adapter.captureOsc(bridge, '\x1b]133;D;0\x07');

    const osc = adapter.getOsc133State();
    expect(osc?.phase).toBe('D');
    expect(osc?.commandRunning).toBe(false);
    expect(osc?.exitCode).toBe(0);
    expect(osc?.lastMarkerAt).toBeTypeOf('number');
  });

  it('resets OSC carry and 133 state on pane reconnect', () => {
    const { adapter, bridge } = makeAdapter();
    adapter.captureOsc(bridge, '\x1b]133;C');
    bridge.connect({ callbacks: { onData: () => {} } });
    expect(adapter.getOsc133State()).toEqual({
      phase: null,
      commandRunning: false,
      exitCode: null,
      lastMarkerAt: null,
    });
    expect(adapter.captureOsc(bridge, 'plain')).toBeUndefined();
  });
});
