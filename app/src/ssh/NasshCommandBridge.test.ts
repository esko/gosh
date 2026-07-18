import { describe, expect, it, vi } from 'vitest';
import type { SessionStatusMeta } from '../settings/types';
import {
  composeSshArgstr,
  isLoginPasswordPrompt,
  NASSH_ENVIRONMENT,
  NasshCommandBridge,
  TRUECOLOR_EXPORT,
  TRUECOLOR_LOGIN_SHELL,
  withTruecolorRemoteCommand,
} from './NasshCommandBridge';

describe('composeSshArgstr', () => {
  it('returns trimmed extra args when there is no remote command', () => {
    expect(composeSshArgstr(undefined, undefined)).toBe('');
    expect(composeSshArgstr('  -o Foo=bar ', '')).toBe('-o Foo=bar');
  });

  it('appends the remote command after a -- separator so ssh runs it', () => {
    expect(composeSshArgstr(undefined, 'etterminal')).toBe('-- etterminal');
    expect(composeSshArgstr('-o Foo=bar', "env PATH=/bin sh -c 'exec etterminal'")).toBe(
      "-o Foo=bar -- env PATH=/bin sh -c 'exec etterminal'",
    );
  });
});

describe('withTruecolorRemoteCommand', () => {
  it('opens a login shell that exports COLORTERM when no command is given', () => {
    expect(withTruecolorRemoteCommand(undefined)).toBe(TRUECOLOR_LOGIN_SHELL);
    expect(withTruecolorRemoteCommand('')).toBe(TRUECOLOR_LOGIN_SHELL);
    expect(TRUECOLOR_LOGIN_SHELL).toContain(TRUECOLOR_EXPORT);
  });

  it('prefixes COLORTERM onto an existing remote command', () => {
    expect(withTruecolorRemoteCommand('etterminal --foo')).toBe(
      `${TRUECOLOR_EXPORT}; etterminal --foo`,
    );
  });

  it('does not double-export when COLORTERM is already set in the command', () => {
    expect(withTruecolorRemoteCommand('COLORTERM=truecolor etterminal')).toBe(
      'COLORTERM=truecolor etterminal',
    );
    expect(withTruecolorRemoteCommand('export COLORTERM=24bit; exec bash -l')).toBe(
      'export COLORTERM=24bit; exec bash -l',
    );
  });
});
describe('isLoginPasswordPrompt', () => {
  it('treats masked password prompts as the savable login password', () => {
    expect(isLoginPasswordPrompt("user@host's password: ", false)).toBe(true);
    expect(isLoginPasswordPrompt('Password:', false)).toBe(true);
  });

  it('never offers to save echoed responses', () => {
    expect(isLoginPasswordPrompt("user@host's password: ", true)).toBe(false);
  });

  it('excludes one-time / 2FA prompts that also mask input', () => {
    expect(isLoginPasswordPrompt('Verification code: ', false)).toBe(false);
    expect(isLoginPasswordPrompt('One-time password: ', false)).toBe(false);
    expect(isLoginPasswordPrompt('Enter your OTP: ', false)).toBe(false);
    expect(isLoginPasswordPrompt('Authenticator token: ', false)).toBe(false);
  });

  it('ignores non-password prompts', () => {
    expect(isLoginPasswordPrompt('Are you sure you want to continue connecting?', false)).toBe(false);
  });
});

type ExitHarness = {
  handleExit(code: number, source: 'nassh' | 'nassh-exit' | 'wassh'): void;
  cancelSecureInput(instance: { terminateProgram_(): void }): string;
  authCancelled: boolean;
  hasExited: boolean;
  ioShim: { dispose(): void } | null;
  resizeSubscription: { dispose(): void } | null;
  hostKeyGuard: { reset(): void } | null;
  commandInstance: unknown;
};

describe('NasshCommandBridge environment', () => {
  it('advertises UTF-8 locale and truecolor to the remote session', () => {
    expect(NASSH_ENVIRONMENT).toMatchObject({
      LANG: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
    });
  });
});

describe('NasshCommandBridge exit lifecycle', () => {
  it('reports a transport exit once and releases terminal subscriptions', () => {
    const statuses: Array<{ status: string; error?: string; meta?: SessionStatusMeta }> = [];
    const bridge = new NasshCommandBridge({
      host: 'host',
      port: 22,
      username: 'user',
      onStatus: (status, error, meta) => statuses.push({ status, error, meta }),
    });
    const harness = bridge as unknown as ExitHarness;
    const disposeIo = vi.fn();
    const disposeResize = vi.fn();
    const resetGuard = vi.fn();
    harness.ioShim = { dispose: disposeIo };
    harness.resizeSubscription = { dispose: disposeResize };
    harness.hostKeyGuard = { reset: resetGuard };

    harness.handleExit(255, 'nassh-exit');
    harness.handleExit(255, 'wassh');

    expect(statuses).toEqual([
      { status: 'disconnected', error: 'SSH exited with status 255', meta: { disconnectReason: 'transport' } },
    ]);
    expect(disposeIo).toHaveBeenCalledOnce();
    expect(disposeResize).toHaveBeenCalledOnce();
    expect(resetGuard).toHaveBeenCalledOnce();
  });

  it('marks a zero exit as a clean normal exit', () => {
    const onStatus = vi.fn();
    const bridge = new NasshCommandBridge({ host: 'host', port: 22, username: 'user', onStatus });
    (bridge as unknown as ExitHarness).handleExit(0, 'wassh');
    expect(onStatus).toHaveBeenCalledWith('disconnected', undefined, { disconnectReason: 'normal-exit' });
  });

  it('cancelSecureInput tears down once and suppresses a later transport exit status', () => {
    const onStatus = vi.fn();
    const bridge = new NasshCommandBridge({ host: 'host', port: 22, username: 'user', onStatus });
    const harness = bridge as unknown as ExitHarness;
    const terminate = vi.fn();
    const disposeIo = vi.fn();
    const resetGuard = vi.fn();
    harness.ioShim = { dispose: disposeIo };
    harness.hostKeyGuard = { reset: resetGuard };
    harness.commandInstance = { terminateProgram_: terminate };

    expect(harness.cancelSecureInput({ terminateProgram_: terminate })).toBe('');
    expect(harness.authCancelled).toBe(true);
    expect(harness.hasExited).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
    expect(disposeIo).toHaveBeenCalledOnce();
    expect(resetGuard).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith('disconnected', undefined, { disconnectReason: 'user' });

    // Plugin exit after cancel must not overwrite the user-disconnect status.
    harness.handleExit(255, 'wassh');
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});
