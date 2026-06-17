import { FitAddon, Terminal, init } from 'ghostty-web';
import type { TerminalAdapter, TerminalSubscription } from '../terminal/TerminalAdapter';
import { getThemePalette } from './themes';
import type { PwaTerminalSettings } from './types';
import { terminalFontFamily } from './settings';

let ghosttyReady: Promise<void> | null = null;

export function ensureGhosttyReady(): Promise<void> {
  ghosttyReady ??= init();
  return ghosttyReady;
}

export class GhosttyTerminalAdapter implements TerminalAdapter {
  private readonly terminal: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly inputListeners = new Set<(data: string) => void>();
  private readonly resizeListeners = new Set<(cols: number, rows: number) => void>();
  private resizeObserver: ResizeObserver | null = null;

  constructor(settings: PwaTerminalSettings) {
    this.terminal = new Terminal({
      cols: 100,
      rows: 30,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      fontFamily: terminalFontFamily(settings),
      fontSize: settings.fontSize,
      scrollback: settings.scrollback,
      theme: getThemePalette(settings.theme),
    });
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.onData((data: string) => {
      for (const listener of this.inputListeners) listener(data);
    });
    this.terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      for (const listener of this.resizeListeners) listener(cols, rows);
    });
  }

  open(el: HTMLElement): void {
    this.terminal.open(el);
    this.fit();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(el);
    this.terminal.focus();
  }

  write(data: string | Uint8Array): void {
    this.terminal.write(data);
  }

  onInput(cb: (data: string) => void): TerminalSubscription {
    this.inputListeners.add(cb);
    return { dispose: () => this.inputListeners.delete(cb) };
  }

  onResize(cb: (cols: number, rows: number) => void): TerminalSubscription {
    this.resizeListeners.add(cb);
    return { dispose: () => this.resizeListeners.delete(cb) };
  }

  focus(): void {
    this.terminal.focus();
  }

  fit(): void {
    this.fitAddon.fit();
  }

  getSize(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  updateSettings(settings: PwaTerminalSettings): void {
    this.terminal.options.fontFamily = terminalFontFamily(settings);
    this.terminal.options.fontSize = settings.fontSize;
    this.terminal.options.cursorBlink = settings.cursorBlink;
    this.terminal.options.cursorStyle = settings.cursorStyle;
    this.terminal.options.scrollback = settings.scrollback;
    this.terminal.options.theme = getThemePalette(settings.theme);
    this.fit();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.inputListeners.clear();
    this.resizeListeners.clear();
    this.terminal.dispose();
  }
}
