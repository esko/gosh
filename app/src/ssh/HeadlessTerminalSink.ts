import type { TerminalSink, TerminalSubscription, TerminalViewport } from '../terminal/TerminalAdapter';
import { DEFAULT_TERMINAL_VIEWPORT } from '../terminal/TerminalAdapter';

/** Tail window for capture-tail scans (large enough for bootstrap tokens). */
export const HEADLESS_CAPTURE_TAIL_BYTES = 1 << 16;

export type HeadlessTerminalSinkMode = 'mute' | 'capture-tail' | 'line-pump';

export type HeadlessTerminalSinkOptions = {
  mode?: HeadlessTerminalSinkMode;
  maxTailBytes?: number;
  viewport?: TerminalViewport;
};

/**
 * TerminalSink for secondary SSH sessions and protocol bootstrap capture.
 * - `mute`: discard remote output (SFTP sidecar host-key traffic).
 * - `capture-tail`: rolling tail window with streaming UTF-8 decode (ET/tsshd).
 * - `line-pump`: emit each write chunk to listeners (exec upload marker scan).
 */
export class HeadlessTerminalSink implements TerminalSink {
  private output = '';
  private readonly decoder = new TextDecoder();
  private readonly outputListeners = new Set<(value: string) => void>();
  private readonly inputListeners = new Set<(data: string) => void>();
  private disposed = false;

  constructor(private readonly options: HeadlessTerminalSinkOptions = {}) {}

  open(): void {}

  write(data: string | Uint8Array): void {
    if (this.disposed) return;
    const mode = this.options.mode ?? 'mute';
    if (mode === 'mute') return;

    const text = typeof data === 'string' ? data : this.decoder.decode(data, { stream: true });
    if (mode === 'line-pump') {
      for (const listener of this.outputListeners) listener(text);
      return;
    }

    this.output += text;
    const max = this.options.maxTailBytes ?? HEADLESS_CAPTURE_TAIL_BYTES;
    if (this.output.length > max) {
      this.output = this.output.slice(-max);
    }
    for (const listener of this.outputListeners) listener(this.output);
  }

  onOutput(listener: (value: string) => void): TerminalSubscription {
    this.outputListeners.add(listener);
    return { dispose: () => this.outputListeners.delete(listener) };
  }

  getOutput(): string {
    return this.output;
  }

  onInput(cb: (data: string) => void): TerminalSubscription {
    this.inputListeners.add(cb);
    return { dispose: () => this.inputListeners.delete(cb) };
  }

  /** Inject keystrokes (host-key responses, exec-upload base64 lines). */
  input(data: string): void {
    for (const listener of this.inputListeners) listener(data);
  }

  onResize(): TerminalSubscription {
    return { dispose: () => undefined };
  }

  focus(): void {}

  getSize(): TerminalViewport {
    return this.options.viewport ?? DEFAULT_TERMINAL_VIEWPORT;
  }

  dispose(): void {
    this.disposed = true;
    this.outputListeners.clear();
    this.inputListeners.clear();
  }
}
