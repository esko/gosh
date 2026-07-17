/**
 * ChromeOS Window Shape API helpers for unframed IWAs.
 *
 * Unframed windows do not get Ash's default 12px rounded clip. The
 * `chromeos.isolatedWebApp.setShape` API (ChromeStatus 5075144470036480) sets
 * the window mask to the union of rectangles. We approximate a rounded rect as
 * horizontal bands; maximized/fullscreen clears the shape (square).
 *
 * Requires unframed display mode + window-management, and either an allowlisted
 * web bundle id or chrome://flags/#enable-chromeos-isolated-web-app-set-shape.
 */

/** Matches ChromeOS `kRoundedWindowCornerRadius`. */
export const WINDOW_CORNER_RADIUS = 12;

/** Blink rejects shapes where every rect is smaller than this. */
const MIN_SHAPE_SIZE = 10;

export type ShapeRect = { x: number; y: number; width: number; height: number };

type SetShapeFn = (rects: DOMRectReadOnly[]) => Promise<void>;

type ChromeOSWindow = Window & {
  chromeos?: { isolatedWebApp?: { setShape?: SetShapeFn } };
};

export function getWindowSetShape(): SetShapeFn | null {
  const fn = (window as ChromeOSWindow).chromeos?.isolatedWebApp?.setShape;
  return typeof fn === 'function' ? fn.bind((window as ChromeOSWindow).chromeos!.isolatedWebApp!) : null;
}

/** True when the Window Shape API is present (flag/allowlist may still block calls). */
export function isWindowShapeApiAvailable(): boolean {
  return getWindowSetShape() !== null;
}

/**
 * Build a scanline approximation of a rounded rectangle covering `width`×`height`.
 * Adjacent rows with the same inset are merged to keep rect count small.
 *
 * Insets use ceil so the binary OS silhouette hugs the true circle from the
 * inside (rounder than floor, which left stair-steps sticking out). CSS
 * `border-radius` on caption/content still softens the painted edge against
 * the transparent window clear-color.
 */
export function roundedWindowShapeRects(
  width: number,
  height: number,
  radius = WINDOW_CORNER_RADIUS,
): ShapeRect[] {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w < MIN_SHAPE_SIZE || h < MIN_SHAPE_SIZE) return [];

  const r = Math.max(0, Math.min(Math.floor(radius), Math.floor(w / 2), Math.floor(h / 2)));
  if (r === 0) return [{ x: 0, y: 0, width: w, height: h }];

  const insetFor = (y: number): number => {
    if (y < r) {
      const dy = r - y - 0.5;
      return Math.max(0, Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy))));
    }
    if (y >= h - r) {
      const dy = y - (h - r) + 0.5;
      return Math.max(0, Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy))));
    }
    return 0;
  };

  const bands: ShapeRect[] = [];
  let y = 0;
  while (y < h) {
    const inset = insetFor(y);
    let yEnd = y + 1;
    while (yEnd < h && insetFor(yEnd) === inset) yEnd += 1;
    const bandWidth = w - 2 * inset;
    if (bandWidth > 0) {
      bands.push({ x: inset, y, width: bandWidth, height: yEnd - y });
    }
    y = yEnd;
  }
  return bands;
}

function isUnframed(): boolean {
  return window.matchMedia('(display-mode: unframed)').matches;
}

function isSquareDisplayState(): boolean {
  return (
    window.matchMedia('(display-state: maximized)').matches
    || window.matchMedia('(display-state: fullscreen)').matches
  );
}

let syncChain: Promise<void> = Promise.resolve();

/** Apply or clear the rounded window mask for the current display state. */
export function syncWindowShape(): Promise<void> {
  syncChain = syncChain.then(() => applyWindowShape(), () => applyWindowShape());
  return syncChain;
}

async function applyWindowShape(): Promise<void> {
  const setShape = getWindowSetShape();
  if (!setShape || !isUnframed()) return;

  const rects = isSquareDisplayState()
    ? []
    : roundedWindowShapeRects(window.innerWidth, window.innerHeight).map(
      (r) => new DOMRect(r.x, r.y, r.width, r.height),
    );

  try {
    await setShape(rects);
  } catch {
    // Not allowlisted / flag off / not unframed yet — leave the default shape.
  }
}

/** Install resize/display listeners. Safe to call once from installWindowControls. */
export function installWindowShape(): void {
  if (!isWindowShapeApiAvailable()) return;
  void syncWindowShape();
  window.addEventListener('resize', () => { void syncWindowShape(); });
  window.addEventListener('displaystatechange', () => { void syncWindowShape(); });
  for (const query of [
    '(display-mode: unframed)',
    '(display-state: maximized)',
    '(display-state: fullscreen)',
  ]) {
    window.matchMedia(query).addEventListener?.('change', () => { void syncWindowShape(); });
  }
}
