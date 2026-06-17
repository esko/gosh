import { describe, expect, it, vi } from 'vitest';
import { normalizePwaSettings } from './settings';

describe('PWA settings normalization', () => {
  it('clamps numeric settings and rejects unsupported theme values', () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } });

    const settings = normalizePwaSettings({
      fontSize: 99,
      scrollback: 123,
      scrollSensitivity: 0.1,
      cursorBlink: false,
      accent: 'purple',
      density: 'tiny',
      theme: 'unknown',
    });

    expect(settings.fontSize).toBe(22);
    expect(settings.scrollback).toBe(5000);
    expect(settings.scrollSensitivity).toBe(0.5);
    expect(settings.cursorBlink).toBe(false);
    expect(settings.accent).toBe('green');
    expect(settings.density).toBe('comfortable');
    expect(settings.theme).toEqual({ preset: 'dark' });
  });
});
