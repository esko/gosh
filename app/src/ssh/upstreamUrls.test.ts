import { describe, expect, it } from 'vitest';
import { normalizeModuleId } from './upstreamUrls';

describe('upstream module allowlist', () => {
  it('allows the hterm locale bootstrap module', () => {
    expect(normalizeModuleId('hterm/js/hterm.js')).toBe('hterm/js/hterm.js');
    expect(normalizeModuleId('/hterm/js/hterm.js')).toBe('hterm/js/hterm.js');
  });

  it('rejects unlisted upstream modules', () => {
    expect(() => normalizeModuleId('hterm/js/other.js')).toThrow('Unknown upstream module');
  });
});
