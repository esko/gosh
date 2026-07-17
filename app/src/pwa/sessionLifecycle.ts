/**
 * ChromeOS login / BFCache restore helpers.
 *
 * After suspend the network stack (and Direct Sockets) can come back a beat
 * late; cold-start connect and resume reconnect share the same retry policy.
 */

import type { TerminalTransportStatus } from './types';

/** Total connect attempts (initial + retries) on cold start. */
export const CONNECT_RETRY_ATTEMPTS = 3;

/** Base delay before the first retry; subsequent retries multiply by attempt index. */
export const CONNECT_RETRY_BASE_DELAY_MS = 500;

const TRANSIENT_CONNECT_RE =
  /timed?\s*out|timeout|network is unreachable|enetunreach|connection refused|econnrefused|name or service not known|enotfound|dns|couldn.?t be resolved|hostname.*resolv|failed to connect|connection reset|econnreset|temporarily unavailable|try again|direct sockets.*unavailable|socket.*unavailable/i;

/** True when a connect failure is worth retrying after login / network settle. */
export function isTransientConnectError(message: string | undefined | null): boolean {
  if (!message?.trim()) return false;
  return TRANSIENT_CONNECT_RE.test(message);
}

/** Delay before retry `attempt` (0-based index of the failed attempt). */
export function connectRetryDelayMs(attempt: number): number {
  return CONNECT_RETRY_BASE_DELAY_MS * (attempt + 1);
}

/**
 * Whether a pane should be reconnected after BFCache / freeze restore.
 * Clean shell exits stay put so close-on-exit and "keep open" behavior are preserved.
 */
export function shouldResumePane(
  status: TerminalTransportStatus,
  cleanExit: boolean,
): boolean {
  if (cleanExit) return false;
  return status === 'error' || status === 'disconnected' || status === 'idle' || status === 'disconnecting';
}

/** Filter panes that need a reconnect after restore (skips clean exits / live panes). */
export function panesToResume<T extends { status: TerminalTransportStatus; cleanExit: boolean }>(
  panes: Iterable<T>,
): T[] {
  return [...panes].filter((pane) => shouldResumePane(pane.status, pane.cleanExit));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
