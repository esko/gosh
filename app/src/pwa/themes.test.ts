import { describe, expect, it } from 'vitest';
import { getThemePalette, THEME_PRESETS } from './themes';

describe('theme presets', () => {
  it('keeps the imported legacy-PWA preset set valid', () => {
    expect(THEME_PRESETS.size).toBeGreaterThanOrEqual(6);
    for (const palette of THEME_PRESETS.values()) {
      expect(palette.background).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette.foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(palette.cursor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('falls back to dark for unknown presets', () => {
    expect(getThemePalette({ preset: 'missing' }).name).toBe('Dark');
  });
});
