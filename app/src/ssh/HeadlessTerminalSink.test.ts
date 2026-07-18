import { describe, expect, it, vi } from 'vitest';
import { HeadlessTerminalSink, HEADLESS_CAPTURE_TAIL_BYTES } from './HeadlessTerminalSink';

describe('HeadlessTerminalSink', () => {
  it('discards output in mute mode', () => {
    const sink = new HeadlessTerminalSink({ mode: 'mute' });
    const listener = vi.fn();
    sink.onOutput(listener);
    sink.write('hello');
    expect(listener).not.toHaveBeenCalled();
    expect(sink.getOutput()).toBe('');
  });

  it('keeps a rolling tail in capture-tail mode', () => {
    const sink = new HeadlessTerminalSink({ mode: 'capture-tail', maxTailBytes: 8 });
    const listener = vi.fn();
    sink.onOutput(listener);
    sink.write('abcdefgh');
    sink.write('ij');
    expect(sink.getOutput()).toBe('cdefghij');
    expect(listener).toHaveBeenLastCalledWith('cdefghij');
  });

  it('streams UTF-8 split across writes in capture-tail mode', () => {
    const sink = new HeadlessTerminalSink({ mode: 'capture-tail' });
    const bytes = new TextEncoder().encode('café');
    sink.write(bytes.subarray(0, 4));
    sink.write(bytes.subarray(4));
    expect(sink.getOutput()).toBe('café');
  });

  it('emits each chunk in line-pump mode', () => {
    const sink = new HeadlessTerminalSink({ mode: 'line-pump' });
    const listener = vi.fn();
    sink.onOutput(listener);
    sink.write('line1\n');
    sink.write('line2\n');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'line1\n');
    expect(listener).toHaveBeenNthCalledWith(2, 'line2\n');
    expect(sink.getOutput()).toBe('');
  });

  it('forwards injected input to listeners', () => {
    const sink = new HeadlessTerminalSink();
    const listener = vi.fn();
    sink.onInput(listener);
    sink.input('yes\n');
    expect(listener).toHaveBeenCalledWith('yes\n');
  });

  it('defaults capture-tail window to 64 KiB', () => {
    expect(HEADLESS_CAPTURE_TAIL_BYTES).toBe(65536);
  });
});
