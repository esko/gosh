import type { AuditEntry } from './AuditLog';

export function truncateClientId(clientId: string, maxLen = 12): string {
  if (clientId.length <= maxLen) return clientId;
  return `${clientId.slice(0, maxLen)}…`;
}

export function formatAuditStatus(entry: Pick<AuditEntry, 'ok' | 'errorCode'>): string {
  return entry.ok ? 'ok' : (entry.errorCode ?? 'error');
}

export type AuditLogRow = {
  at: number;
  method: string;
  status: string;
  clientId: string;
};

/** Newest-first rows safe for Settings display (no tokens or payloads). */
export function buildAuditLogRows(entries: readonly AuditEntry[]): AuditLogRow[] {
  return [...entries].reverse().map((entry) => ({
    at: entry.at,
    method: entry.method,
    status: formatAuditStatus(entry),
    clientId: truncateClientId(entry.clientId),
  }));
}
