import { describe, expect, it } from 'vitest';
import {
  CONNECT_RETRY_ATTEMPTS,
  CONNECT_RETRY_BASE_DELAY_MS,
  connectRetryDelayMs,
  isTransientConnectError,
  panesToResume,
  shouldResumePane,
} from './sessionLifecycle';

describe('isTransientConnectError', () => {
  it('accepts common post-login / network settle failures', () => {
    expect(isTransientConnectError('Connection timed out')).toBe(true);
    expect(isTransientConnectError('Network is unreachable')).toBe(true);
    expect(isTransientConnectError('Connection refused')).toBe(true);
    expect(isTransientConnectError("Hostname couldn't be resolved")).toBe(true);
    expect(isTransientConnectError('Failed to connect to host')).toBe(true);
    expect(isTransientConnectError('Direct Sockets (TCPSocket) is unavailable. Install Gosh with Direct Sockets permission.')).toBe(true);
  });

  it('rejects auth and permanent failures', () => {
    expect(isTransientConnectError(undefined)).toBe(false);
    expect(isTransientConnectError('')).toBe(false);
    expect(isTransientConnectError('Permission denied (publickey)')).toBe(false);
    expect(isTransientConnectError('Host key verification failed')).toBe(false);
    expect(isTransientConnectError('MissingUpstreamAssetsError: upstream wassh assets not loaded')).toBe(false);
  });
});

describe('connectRetryDelayMs', () => {
  it('scales from the base delay', () => {
    expect(CONNECT_RETRY_ATTEMPTS).toBe(3);
    expect(connectRetryDelayMs(0)).toBe(CONNECT_RETRY_BASE_DELAY_MS);
    expect(connectRetryDelayMs(1)).toBe(CONNECT_RETRY_BASE_DELAY_MS * 2);
    expect(connectRetryDelayMs(2)).toBe(CONNECT_RETRY_BASE_DELAY_MS * 3);
  });
});

describe('shouldResumePane', () => {
  it('reconnects errored or transport-disconnected panes after restore', () => {
    expect(shouldResumePane('error', false)).toBe(true);
    expect(shouldResumePane('disconnected', false)).toBe(true);
    expect(shouldResumePane('idle', false)).toBe(true);
    expect(shouldResumePane('disconnecting', false)).toBe(true);
  });

  it('skips clean exits and already-live panes', () => {
    expect(shouldResumePane('disconnected', true)).toBe(false);
    expect(shouldResumePane('error', true)).toBe(false);
    expect(shouldResumePane('connected', false)).toBe(false);
    expect(shouldResumePane('connecting', false)).toBe(false);
  });
});

describe('panesToResume', () => {
  it('keeps only panes that should reconnect after BFCache/freeze restore', () => {
    const panes = [
      { id: 1, status: 'disconnected' as const, cleanExit: false },
      { id: 2, status: 'error' as const, cleanExit: false },
      { id: 3, status: 'disconnected' as const, cleanExit: true },
      { id: 4, status: 'connected' as const, cleanExit: false },
    ];
    expect(panesToResume(panes).map((pane) => pane.id)).toEqual([1, 2]);
  });
});
