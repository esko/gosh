import { describe, expect, it } from 'vitest';
import { buildAuditLogRows, formatAuditStatus, truncateClientId } from './auditLogFormat';
import type { AuditEntry } from './AuditLog';

describe('truncateClientId', () => {
  it('leaves short ids unchanged', () => {
    expect(truncateClientId('client_1')).toBe('client_1');
  });

  it('truncates long ids with an ellipsis', () => {
    expect(truncateClientId('client_abcdefghijklmnop', 8)).toBe('client_a…');
  });
});

describe('formatAuditStatus', () => {
  it('returns ok for successful entries', () => {
    expect(formatAuditStatus({ ok: true })).toBe('ok');
  });

  it('returns the error code for failures', () => {
    expect(formatAuditStatus({ ok: false, errorCode: 'unauthorized' })).toBe('unauthorized');
  });

  it('falls back when error code is missing', () => {
    expect(formatAuditStatus({ ok: false })).toBe('error');
  });
});

describe('buildAuditLogRows', () => {
  const entries: AuditEntry[] = [
    { at: 1000, method: 'gosh.authenticate', clientId: 'client_1', ok: true },
    { at: 2000, method: 'workspace.listTabs', clientId: 'client_abcdefghijklmnop', ok: false, errorCode: 'invalid-request' },
  ];

  it('orders newest first and formats display fields', () => {
    expect(buildAuditLogRows(entries)).toEqual([
      {
        at: 2000,
        method: 'workspace.listTabs',
        status: 'invalid-request',
        clientId: 'client_abcde…',
      },
      {
        at: 1000,
        method: 'gosh.authenticate',
        status: 'ok',
        clientId: 'client_1',
      },
    ]);
  });
});
