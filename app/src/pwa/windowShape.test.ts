import { describe, expect, it } from 'vitest';
import { WINDOW_CORNER_RADIUS, roundedWindowShapeRects } from './windowShape';

describe('roundedWindowShapeRects', () => {
  it('returns empty for undersized windows (Blink minimum)', () => {
    expect(roundedWindowShapeRects(9, 100)).toEqual([]);
    expect(roundedWindowShapeRects(100, 9)).toEqual([]);
  });

  it('returns a single full rect when radius is 0', () => {
    expect(roundedWindowShapeRects(200, 100, 0)).toEqual([
      { x: 0, y: 0, width: 200, height: 100 },
    ]);
  });

  it('covers the full height and keeps a large middle band', () => {
    const rects = roundedWindowShapeRects(400, 300, WINDOW_CORNER_RADIUS);
    expect(rects.length).toBeGreaterThan(1);
    const covered = rects.reduce((sum, r) => sum + r.height, 0);
    expect(covered).toBe(300);
    const middle = rects.find((r) => r.x === 0 && r.width === 400);
    expect(middle).toBeDefined();
    expect(middle!.height).toBeGreaterThanOrEqual(300 - 2 * WINDOW_CORNER_RADIUS);
    expect(middle!.height).toBeGreaterThanOrEqual(10);
  });

  it('insets top and bottom rows and stays symmetric', () => {
    const rects = roundedWindowShapeRects(200, 200, 12);
    const top = rects[0]!;
    const bottom = rects.at(-1)!;
    expect(top.y).toBe(0);
    expect(top.x).toBeGreaterThan(0);
    expect(top.width).toBeLessThan(200);
    expect(bottom.x).toBe(top.x);
    expect(bottom.width).toBe(top.width);
    expect(bottom.y + bottom.height).toBe(200);
  });

  it('leaves a safe inner band for inset caption buttons at the top edge', () => {
    // Caption buttons are padded 12px from the right; at y=0 the shape inset is
    // < 12 so a 36px-wide control strip starting at width-48 stays inside.
    const width = 800;
    const rects = roundedWindowShapeRects(width, 600, 12);
    const top = rects[0]!;
    const buttonLeft = width - 12 - 36 * 3;
    expect(top.x).toBeLessThanOrEqual(buttonLeft);
    expect(top.x + top.width).toBeGreaterThanOrEqual(width - 12);
  });

  it('keeps the binary mask inside the true circle (ceil) for a rounder silhouette', () => {
    const r = 12;
    const rects = roundedWindowShapeRects(200, 200, r);
    for (let y = 0; y < r; y += 1) {
      const band = rects.find((rect) => rect.y <= y && y < rect.y + rect.height);
      expect(band).toBeDefined();
      const dy = r - y - 0.5;
      const exactInset = r - Math.sqrt(Math.max(0, r * r - dy * dy));
      // ceil(exact) ≥ exact → mask does not stick stair-steps outside the curve.
      expect(band!.x).toBeGreaterThanOrEqual(Math.floor(exactInset));
    }
  });
});
