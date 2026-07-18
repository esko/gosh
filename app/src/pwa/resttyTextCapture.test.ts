import { describe, expect, it, vi } from 'vitest';
import {
  canCaptureHistoryWithoutScroll,
  captureHistory,
  captureTextRange,
  cellTextAt,
  extractLinesFromRenderState,
  mergeCaptures,
  sliceLastLines,
  trimLineEnd,
  type CellGridInput,
} from './resttyTextCapture';

function grid(overrides: Partial<CellGridInput> & Pick<CellGridInput, 'rows' | 'cols'>): CellGridInput {
  const count = overrides.rows * overrides.cols;
  return {
    codepoints: overrides.codepoints ?? new Uint32Array(count),
    wide: overrides.wide ?? new Uint8Array(count),
    graphemeOffset: overrides.graphemeOffset ?? null,
    graphemeLen: overrides.graphemeLen ?? null,
    graphemeBuffer: overrides.graphemeBuffer ?? null,
    cursor: overrides.cursor ?? null,
    rows: overrides.rows,
    cols: overrides.cols,
  };
}

describe('resttyTextCapture cell extractor', () => {
  it('renders spaces for empty cells and trims line ends', () => {
    const state = grid({
      rows: 1,
      cols: 5,
      codepoints: Uint32Array.from([65, 0, 66, 0, 0]),
    });
    expect(extractLinesFromRenderState(state)).toEqual(['A B']);
    expect(trimLineEnd('hi   ')).toBe('hi');
  });

  it('skips wide-character continuation cells', () => {
    const state = grid({
      rows: 1,
      cols: 4,
      codepoints: Uint32Array.from([0x4e2d, 0, 0, 0]),
      wide: Uint8Array.from([0, 2, 0, 0]),
    });
    expect(cellTextAt(state, 0)).toBe('\u4e2d');
    expect(extractLinesFromRenderState(state)).toEqual(['\u4e2d']);
  });

  it('expands grapheme clusters from the WASM grapheme buffer', () => {
    const state = grid({
      rows: 1,
      cols: 2,
      codepoints: Uint32Array.from([0x1f30d, 0]),
      graphemeLen: Uint32Array.from([2, 0]),
      graphemeOffset: Uint32Array.from([0, 0]),
      graphemeBuffer: Uint32Array.from([0x200d, 0x1f33e]),
    });
    expect(cellTextAt(state, 0)).toBe('🌍‍🌾');
  });

  it('reflects carriage-return progress as the final column state', () => {
    const state = grid({
      rows: 1,
      cols: 5,
      codepoints: Uint32Array.from([65, 66, 67, 68, 69]),
    });
    state.codepoints![2] = 88;
    expect(extractLinesFromRenderState(state)).toEqual(['ABXDE']);
  });

  it('captures a rectangular range', () => {
    const state = grid({
      rows: 2,
      cols: 3,
      codepoints: Uint32Array.from([
        97, 98, 99,
        100, 101, 102,
      ]),
    });
    const capture = captureTextRange(
      {
        wasm: {
          renderUpdate: () => {},
          getRenderState: () => state as never,
          scrollViewport: () => {},
        } as never,
        handle: 1,
        exports: {} as never,
      },
      {
        start: { row: 0, col: 1 },
        end: { row: 1, col: 2 },
      },
    );
    expect(capture.lines).toEqual(['bc', 'ef']);
  });

  it('merges and slices history chunks with truncation metadata', () => {
    const head = sliceLastLines(
      {
        lines: ['one', 'two', 'three'],
        cols: 3,
        rows: 3,
        wrapping: 'unknown',
        truncated: false,
      },
      2,
    );
    expect(head.lines).toEqual(['two', 'three']);
    expect(head.truncated).toBe(true);
    const merged = mergeCaptures(
      { ...head, coordinates: { origin: 'absolute', startLine: 4, endLine: 5 } },
      {
        lines: ['four'],
        cols: 3,
        rows: 1,
        wrapping: 'unknown',
        truncated: false,
        coordinates: { origin: 'absolute', startLine: 6, endLine: 6 },
      },
    );
    expect(merged.lines).toEqual(['two', 'three', 'four']);
    expect(merged.coordinates).toEqual({ origin: 'absolute', startLine: 4, endLine: 6 });
  });
});

function lineGrid(lines: string[]): CellGridInput {
  const rows = lines.length;
  const cols = Math.max(1, ...lines.map((line) => line.length));
  const codepoints = new Uint32Array(rows * cols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const ch = lines[row]![col];
      codepoints[row * cols + col] = ch ? ch.codePointAt(0)! : 0;
    }
  }
  return grid({ rows, cols, codepoints });
}

function scrollbarExports(total: number, len: number, offset = 0) {
  return {
    restty_scrollbar_total: () => total,
    restty_scrollbar_offset: () => offset,
    restty_scrollbar_len: () => len,
    restty_debug_scroll_left: () => 0,
    restty_debug_scroll_right: () => total - 1,
  };
}

describe('captureHistory', () => {
  it('prefers non-scroll capture when the cell grid already covers lastLines', () => {
    const scrollViewport = vi.fn();
    const state = lineGrid(['alpha', 'beta', 'gamma', 'delta']);
    const capture = captureHistory(
      {
        wasm: {
          renderUpdate: vi.fn(),
          getRenderState: () => state as never,
          scrollViewport,
        } as never,
        handle: 1,
        exports: scrollbarExports(100, 24, 76) as never,
      },
      { lastLines: 3 },
    );
    expect(scrollViewport).not.toHaveBeenCalled();
    expect(capture.lines).toEqual(['beta', 'gamma', 'delta']);
    expect(capture.truncated).toBe(true);
  });

  it('prefers non-scroll capture when state.rows covers scrollbar.total', () => {
    const scrollViewport = vi.fn();
    const state = lineGrid(['one', 'two', 'three']);
    const capture = captureHistory(
      {
        wasm: {
          renderUpdate: vi.fn(),
          getRenderState: () => state as never,
          scrollViewport,
        } as never,
        handle: 1,
        exports: scrollbarExports(3, 1, 2) as never,
      },
      { lastLines: 10 },
    );
    expect(scrollViewport).not.toHaveBeenCalled();
    expect(capture.lines).toEqual(['one', 'two', 'three']);
    expect(capture.truncated).toBe(false);
  });

  it('falls back to scroll-windowing when the buffer is viewport-sized', () => {
    const scrollViewport = vi.fn();
    let offset = 0;
    const viewportLines = ['scroll-a', 'scroll-b'];
    const state = lineGrid(viewportLines);
    const capture = captureHistory(
      {
        wasm: {
          renderUpdate: vi.fn(),
          getRenderState: () => state as never,
          scrollViewport: (_handle: number, delta: number) => {
            scrollViewport(delta);
            offset += delta;
          },
        } as never,
        handle: 1,
        exports: {
          ...scrollbarExports(6, 2, 0),
          restty_scrollbar_offset: () => offset,
        } as never,
      },
      { lastLines: 4 },
    );
    expect(scrollViewport).toHaveBeenCalled();
    expect(capture.lines.length).toBeGreaterThan(0);
  });

  it('invokes suppressCanvasDuringScroll only for scroll fallback', () => {
    const suppressCanvasDuringScroll = vi.fn(() => vi.fn());
    const scrollViewport = vi.fn();
    const fullState = lineGrid(['a', 'b', 'c', 'd']);
    captureHistory(
      {
        wasm: {
          renderUpdate: vi.fn(),
          getRenderState: () => fullState as never,
          scrollViewport,
        } as never,
        handle: 1,
        exports: scrollbarExports(100, 24) as never,
        suppressCanvasDuringScroll,
      },
      { lastLines: 2 },
    );
    expect(suppressCanvasDuringScroll).not.toHaveBeenCalled();
    expect(scrollViewport).not.toHaveBeenCalled();

    let offset = 0;
    const viewportState = lineGrid(['x', 'y']);
    captureHistory(
      {
        wasm: {
          renderUpdate: vi.fn(),
          getRenderState: () => viewportState as never,
          scrollViewport: (_handle: number, delta: number) => {
            scrollViewport(delta);
            offset += delta;
          },
        } as never,
        handle: 1,
        exports: {
          ...scrollbarExports(8, 2, 0),
          restty_scrollbar_offset: () => offset,
        } as never,
        suppressCanvasDuringScroll,
      },
      { lastLines: 5 },
    );
    expect(suppressCanvasDuringScroll).toHaveBeenCalledTimes(1);
  });
});

describe('canCaptureHistoryWithoutScroll', () => {
  it('requires scrolling only when history exceeds a viewport-sized buffer', () => {
    const scrollbar = { total: 100, offset: 76, len: 24 };
    expect(canCaptureHistoryWithoutScroll({ rows: 50 }, scrollbar, 40)).toBe(true);
    expect(canCaptureHistoryWithoutScroll({ rows: 100 }, scrollbar, 80)).toBe(true);
    expect(canCaptureHistoryWithoutScroll({ rows: 24 }, scrollbar, 80)).toBe(false);
  });
});
