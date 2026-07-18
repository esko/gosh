import { describe, expect, it } from 'vitest';
import {
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
