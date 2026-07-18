import { buildAuditLogRows } from '../agent/security/auditLogFormat';
import type { AuditEntry } from '../agent/security/AuditLog';
import { escapeHTML, formatTime } from './dom';

export function renderAgentAuditLogMarkup(entries: readonly AuditEntry[]): string {
  const rows = buildAuditLogRows(entries);
  if (rows.length === 0) {
    return '<p class="set-hint agent-audit-empty">No control actions recorded yet.</p>';
  }
  const items = rows
    .map(
      (row) =>
        `<li class="agent-audit-entry">
          <span class="agent-audit-time">${escapeHTML(formatTime(row.at))}</span>
          <code class="agent-audit-method">${escapeHTML(row.method)}</code>
          <span class="agent-audit-status${row.status === 'ok' ? ' is-ok' : ' is-err'}">${escapeHTML(row.status)}</span>
          <span class="agent-audit-client">${escapeHTML(row.clientId)}</span>
        </li>`,
    )
    .join('');
  return `<ul class="agent-audit-log" aria-label="Recent external control actions">${items}</ul>`;
}
