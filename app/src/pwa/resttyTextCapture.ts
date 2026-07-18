import type { RenderState, ResttyWasm, ResttyWasmExports } from '@eslzzyl/restty/esm/internal';

export type TerminalPosition = { row: number; col: number };

export type TerminalTextCoordinates = {
  origin: 'viewport' | 'absolute';
  startLine?: number;
  endLine?: number;
};

export type TerminalTextCapture = {
  lines: string[];
  cols: number;
  rows: number;
  cursor?: { row: number; col: number };
  /** Restty does not expose wrap metadata on the public surface; false when unknown. */
  wrapping: boolean | 'unknown';
  coordinates?: TerminalTextCoordinates;
  truncated: boolean;
  truncationReason?: string;
};

export type CellGridInput = Pick<
  RenderState,
  'rows' | 'cols' | 'codepoints' | 'wide' | 'graphemeOffset' | 'graphemeLen' | 'graphemeBuffer' | 'cursor'
>;

const WIDE_TAIL = 2;
const WIDE_WRAP = 3;

/** Read display text for a flat cell index (mirrors Restty runtime-reporting). */
export function cellTextAt(state: CellGridInput, idx: number): string {
  const codepoints = state.codepoints;
  if (!codepoints) return ' ';
  const cp = codepoints[idx];
  if (!cp) return ' ';
  let text = String.fromCodePoint(cp);
  const graphemeLen = state.graphemeLen?.[idx] ?? 0;
  if (graphemeLen > 0 && state.graphemeOffset && state.graphemeBuffer) {
    const offset = state.graphemeOffset[idx] ?? 0;
    const parts = [cp];
    for (let i = 0; i < graphemeLen; i += 1) {
      const extra = state.graphemeBuffer[offset + i];
      if (extra) parts.push(extra);
    }
    text = String.fromCodePoint(...parts);
  }
  return text;
}

function isWideContinuation(wide: Uint8Array | null | undefined, idx: number): boolean {
  const flag = wide?.[idx] ?? 0;
  return flag === WIDE_TAIL || flag === WIDE_WRAP;
}

/** Trim trailing spaces per line, matching Restty selection text extraction. */
export function trimLineEnd(line: string): string {
  return line.replace(/ +$/u, '');
}

export function extractLinesFromRenderState(
  state: CellGridInput,
  options?: { rowStart?: number; rowEnd?: number; colStart?: number; colEnd?: number },
): string[] {
  const rows = state.rows;
  const cols = state.cols;
  if (rows <= 0 || cols <= 0 || !state.codepoints) return [];

  const rowStart = Math.max(0, options?.rowStart ?? 0);
  const rowEnd = Math.min(rows - 1, options?.rowEnd ?? rows - 1);
  const colStart = Math.max(0, options?.colStart ?? 0);
  const colEnd = Math.min(cols - 1, options?.colEnd ?? cols - 1);
  if (rowEnd < rowStart || colEnd < colStart) return [];

  const lines: string[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    let line = '';
    for (let col = colStart; col <= colEnd; col += 1) {
      const idx = row * cols + col;
      if (isWideContinuation(state.wide, idx)) continue;
      line += cellTextAt(state, idx);
    }
    lines.push(trimLineEnd(line));
  }
  return lines;
}

export function resolveCursorPosition(state: CellGridInput): { row: number; col: number } | undefined {
  const cursor = state.cursor;
  if (!cursor || cursor.visible === 0) return undefined;
  const row = Number.isFinite(cursor.row) ? cursor.row : 0;
  const col = Number.isFinite(cursor.col) ? cursor.col : 0;
  if (row < 0 || col < 0 || row >= state.rows || col >= state.cols) return undefined;
  return { row, col };
}

export type ScrollbarSnapshot = {
  total: number;
  offset: number;
  len: number;
};

export function readScrollbar(exports: ResttyWasmExports, handle: number): ScrollbarSnapshot | null {
  if (!exports.restty_scrollbar_total) return null;
  return {
    total: exports.restty_scrollbar_total(handle) || 0,
    offset: exports.restty_scrollbar_offset?.(handle) ?? 0,
    len: exports.restty_scrollbar_len?.(handle) ?? 0,
  };
}

export function readAbsoluteScrollRange(
  exports: ResttyWasmExports,
  handle: number,
): { left: number; right: number } | null {
  if (!exports.restty_debug_scroll_left || !exports.restty_debug_scroll_right) return null;
  return {
    left: exports.restty_debug_scroll_left(handle),
    right: exports.restty_debug_scroll_right(handle),
  };
}

export function captureViewportFromRenderState(state: RenderState): TerminalTextCapture {
  const lines = extractLinesFromRenderState(state);
  return {
    lines,
    cols: state.cols,
    rows: state.rows,
    cursor: resolveCursorPosition(state),
    wrapping: 'unknown',
    coordinates: { origin: 'viewport', startLine: 0, endLine: Math.max(0, lines.length - 1) },
    truncated: false,
  };
}

export function mergeCaptures(head: TerminalTextCapture, tail: TerminalTextCapture): TerminalTextCapture {
  return {
    ...tail,
    lines: [...head.lines, ...tail.lines],
    coordinates: head.coordinates?.origin === 'absolute' && tail.coordinates
      ? {
          origin: 'absolute',
          startLine: head.coordinates.startLine,
          endLine: tail.coordinates.endLine,
        }
      : { origin: 'viewport', startLine: 0, endLine: head.lines.length + tail.lines.length - 1 },
    truncated: head.truncated || tail.truncated,
    truncationReason: head.truncationReason ?? tail.truncationReason,
  };
}

export function sliceLastLines(capture: TerminalTextCapture, lastLines: number): TerminalTextCapture {
  if (lastLines <= 0 || capture.lines.length <= lastLines) return capture;
  const start = capture.lines.length - lastLines;
  return {
    ...capture,
    lines: capture.lines.slice(start),
    truncated: true,
    truncationReason: `Clipped to last ${lastLines} lines of captured buffer`,
    coordinates: capture.coordinates
      ? {
          ...capture.coordinates,
          startLine: (capture.coordinates.startLine ?? 0) + start,
        }
      : undefined,
  };
}

export type PaneCaptureRuntime = {
  wasm: ResttyWasm;
  handle: number;
  exports: ResttyWasmExports;
  /** Optional host hook to hide the live canvas during scroll-windowed history capture. */
  suppressCanvasDuringScroll?: () => () => void;
};

/** True when a single `getRenderState` read covers the requested history without scrolling. */
export function canCaptureHistoryWithoutScroll(
  state: Pick<RenderState, 'rows'>,
  scrollbar: ScrollbarSnapshot | null,
  lastLines: number,
): boolean {
  if (!scrollbar || scrollbar.total <= 0) return true;

  const viewportRows = scrollbar.len > 0 ? scrollbar.len : state.rows;
  if (viewportRows <= 0) return true;

  const historyLines = Math.max(0, scrollbar.total - viewportRows);
  if (historyLines === 0 || lastLines <= viewportRows) return true;

  return state.rows >= lastLines || state.rows >= scrollbar.total;
}

export function isViewportSizedRenderState(
  state: Pick<RenderState, 'rows'>,
  scrollbar: ScrollbarSnapshot | null,
): boolean {
  if (!scrollbar || scrollbar.len <= 0) return false;
  return state.rows <= scrollbar.len + 1;
}

function captureFromRenderState(
  state: RenderState,
  runtime: PaneCaptureRuntime,
  lastLines: number,
): TerminalTextCapture {
  const lines = extractLinesFromRenderState(state);
  const capture: TerminalTextCapture = {
    lines,
    cols: state.cols,
    rows: state.rows,
    cursor: resolveCursorPosition(state),
    wrapping: 'unknown',
    coordinates: { origin: 'viewport', startLine: 0, endLine: Math.max(0, lines.length - 1) },
    truncated: false,
  };
  const absolute = readAbsoluteScrollRange(runtime.exports, runtime.handle);
  if (absolute) {
    capture.coordinates = {
      origin: 'absolute',
      startLine: absolute.left,
      endLine: absolute.right,
    };
  }
  return sliceLastLines(capture, lastLines);
}

export function freshRenderState(runtime: PaneCaptureRuntime): RenderState | null {
  runtime.wasm.renderUpdate(runtime.handle);
  return runtime.wasm.getRenderState(runtime.handle);
}

export function captureViewport(runtime: PaneCaptureRuntime): TerminalTextCapture {
  const state = freshRenderState(runtime);
  if (!state) {
    return {
      lines: [],
      cols: 0,
      rows: 0,
      wrapping: 'unknown',
      truncated: true,
      truncationReason: 'WASM render state unavailable',
    };
  }
  const capture = captureViewportFromRenderState(state);
  const absolute = readAbsoluteScrollRange(runtime.exports, runtime.handle);
  if (absolute) {
    capture.coordinates = {
      origin: 'absolute',
      startLine: absolute.left,
      endLine: absolute.right,
    };
  }
  return capture;
}

export function captureTextRange(
  runtime: PaneCaptureRuntime,
  opts: { start: TerminalPosition; end: TerminalPosition },
): TerminalTextCapture {
  const state = freshRenderState(runtime);
  if (!state) {
    return {
      lines: [],
      cols: 0,
      rows: 0,
      wrapping: 'unknown',
      truncated: true,
      truncationReason: 'WASM render state unavailable',
    };
  }
  const start = normalizeRangeEndpoint(state.rows, state.cols, opts.start);
  const end = normalizeRangeEndpoint(state.rows, state.cols, opts.end);
  const rowStart = Math.min(start.row, end.row);
  const rowEnd = Math.max(start.row, end.row);
  const colStart = rowStart === rowEnd ? Math.min(start.col, end.col) : rowStart === start.row ? start.col : end.col;
  const colEnd = rowStart === rowEnd ? Math.max(start.col, end.col) : rowEnd === end.row ? end.col : state.cols - 1;

  const lines = extractLinesFromRenderState(state, { rowStart, rowEnd, colStart, colEnd });
  return {
    lines,
    cols: state.cols,
    rows: state.rows,
    cursor: resolveCursorPosition(state),
    wrapping: 'unknown',
    coordinates: { origin: 'viewport', startLine: rowStart, endLine: rowEnd },
    truncated: false,
  };
}

function normalizeRangeEndpoint(rows: number, cols: number, pos: TerminalPosition): TerminalPosition {
  return {
    row: Math.max(0, Math.min(rows - 1, Math.floor(pos.row))),
    col: Math.max(0, Math.min(cols - 1, Math.floor(pos.col))),
  };
}

function captureHistoryByScrolling(
  runtime: PaneCaptureRuntime,
  opts: { lastLines: number },
  scrollbar: ScrollbarSnapshot,
): TerminalTextCapture {
  const lastLines = Math.max(1, Math.floor(opts.lastLines));
  const savedOffset = scrollbar.offset;
  const viewportRows = scrollbar.len > 0 ? scrollbar.len : runtime.wasm.getRenderState(runtime.handle)?.rows ?? 0;
  if (viewportRows <= 0) {
    const state = freshRenderState(runtime);
    if (!state) {
      return {
        lines: [],
        cols: 0,
        rows: 0,
        wrapping: 'unknown',
        truncated: true,
        truncationReason: 'WASM render state unavailable',
      };
    }
    return captureFromRenderState(state, runtime, lastLines);
  }

  const linesNeeded = Math.min(lastLines, scrollbar.total);
  const collected: string[] = [];
  let truncated = false;
  let truncationReason: string | undefined;
  const restoreCanvas = runtime.suppressCanvasDuringScroll?.();

  try {
    const maxOffset = Math.max(0, scrollbar.total - viewportRows);
    let offset = maxOffset;
    while (collected.length < linesNeeded && offset >= 0) {
      const delta = offset - (readScrollbar(runtime.exports, runtime.handle)?.offset ?? 0);
      if (delta !== 0) {
        runtime.wasm.scrollViewport(runtime.handle, delta);
        runtime.wasm.renderUpdate(runtime.handle);
      }
      const state = runtime.wasm.getRenderState(runtime.handle);
      if (!state) break;
      const chunk = extractLinesFromRenderState(state);
      for (let i = chunk.length - 1; i >= 0 && collected.length < linesNeeded; i -= 1) {
        collected.unshift(chunk[i]!);
      }
      if (offset === 0) break;
      const step = Math.max(1, viewportRows - 1);
      offset = Math.max(0, offset - step);
    }
    if (collected.length < linesNeeded) {
      truncated = true;
      truncationReason = 'Scrollback buffer did not yield the requested line count';
    }
  } finally {
    restoreCanvas?.();
    const current = readScrollbar(runtime.exports, runtime.handle)?.offset ?? 0;
    const restore = savedOffset - current;
    if (restore !== 0) {
      runtime.wasm.scrollViewport(runtime.handle, restore);
      runtime.wasm.renderUpdate(runtime.handle);
    }
  }

  const state = runtime.wasm.getRenderState(runtime.handle);
  const sliced = collected.slice(Math.max(0, collected.length - lastLines));
  const absolute = readAbsoluteScrollRange(runtime.exports, runtime.handle);
  return {
    lines: sliced,
    cols: state?.cols ?? 0,
    rows: state?.rows ?? 0,
    cursor: state ? resolveCursorPosition(state) : undefined,
    wrapping: 'unknown',
    coordinates: absolute
      ? { origin: 'absolute', startLine: absolute.left, endLine: absolute.right }
      : { origin: 'viewport', startLine: 0, endLine: Math.max(0, sliced.length - 1) },
    truncated,
    truncationReason,
  };
}

export function captureHistory(
  runtime: PaneCaptureRuntime,
  opts: { lastLines: number },
): TerminalTextCapture {
  const lastLines = Math.max(1, Math.floor(opts.lastLines));
  const scrollbar = readScrollbar(runtime.exports, runtime.handle);
  const state = freshRenderState(runtime);
  if (!state) {
    return {
      lines: [],
      cols: 0,
      rows: 0,
      wrapping: 'unknown',
      truncated: true,
      truncationReason: 'WASM render state unavailable',
    };
  }

  if (canCaptureHistoryWithoutScroll(state, scrollbar, lastLines)) {
    return captureFromRenderState(state, runtime, lastLines);
  }

  if (scrollbar && isViewportSizedRenderState(state, scrollbar)) {
    return captureHistoryByScrolling(runtime, opts, scrollbar);
  }

  return captureFromRenderState(state, runtime, lastLines);
}

export function captureToPlainText(capture: TerminalTextCapture, maxBytes?: number): { text: string; truncated: boolean } {
  let text = capture.lines.join('\n');
  if (maxBytes === undefined || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { text, truncated: capture.truncated };
  }
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return { text, truncated: capture.truncated };
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo), truncated: true };
}
