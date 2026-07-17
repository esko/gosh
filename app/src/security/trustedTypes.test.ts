import { afterEach, describe, expect, it, vi } from 'vitest';
import { initTrustedTypesPolicy } from './trustedTypes';

type PolicyRules = {
  createScriptURL?: (input: string) => string;
};

afterEach(() => vi.unstubAllGlobals());

describe('Trusted Types policy', () => {
  it('allows only approved same-authority script URLs', () => {
    let rules: PolicyRules | undefined;
    const createPolicy = vi.fn((_name: string, nextRules: PolicyRules) => {
      rules = nextRules;
      return {};
    });
    vi.stubGlobal('location', new URL('isolated-app://gosh/index.html'));
    vi.stubGlobal('trustedTypes', { createPolicy });

    initTrustedTypesPolicy();

    expect(createPolicy).toHaveBeenCalledWith('default', expect.any(Object));
    const createScriptURL = rules?.createScriptURL;
    expect(createScriptURL).toBeTypeOf('function');
    expect(createScriptURL?.('isolated-app://gosh/src/tsshd/tsshdRelayWorker.ts'))
      .toBe('isolated-app://gosh/src/tsshd/tsshdRelayWorker.ts');
    expect(createScriptURL?.('isolated-app://gosh/assets/tsshdRelayWorker-Ab_12.js'))
      .toBe('isolated-app://gosh/assets/tsshdRelayWorker-Ab_12.js');
    expect(createScriptURL?.('isolated-app://gosh/src/et/worker.ts'))
      .toBe('isolated-app://gosh/src/et/worker.ts');
    expect(createScriptURL?.('isolated-app://gosh/assets/worker-CQ6nErjh.js'))
      .toBe('isolated-app://gosh/assets/worker-CQ6nErjh.js');
    expect(createScriptURL?.('isolated-app://gosh/upstream/nassh/js/nassh.js'))
      .toBe('isolated-app://gosh/upstream/nassh/js/nassh.js');
    expect(() => createScriptURL?.('isolated-app://gosh/assets/other-worker.js')).toThrow('Untrusted');
    expect(() => createScriptURL?.('isolated-app://gosh/upstream/nassh/js/nassh.json')).toThrow('Untrusted');
    expect(() => createScriptURL?.('isolated-app://gosh/upstream/nassh/../evil.js')).toThrow('Untrusted');
    expect(() => createScriptURL?.('isolated-app://gosh/upstream/nassh/%2e%2e/evil.js')).toThrow('Untrusted');
    expect(() => createScriptURL?.('isolated-app://attacker/upstream/nassh/js/nassh.js')).toThrow('Untrusted');
    expect(() => createScriptURL?.('isolated-app://attacker/src/tsshd/tsshdRelayWorker.ts')).toThrow('Untrusted');
    expect(() => createScriptURL?.('https://attacker.example/tsshdRelayWorker-Ab_12.js')).toThrow('Untrusted');
  });
});
