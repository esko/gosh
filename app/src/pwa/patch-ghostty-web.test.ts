import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('ghostty-web patch check', () => {
  it('is npm-compatible and idempotent for the pinned package', () => {
    const output = execFileSync(process.execPath, ['scripts/patch-ghostty-web.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output).toContain('patch check passed');
  });
});
