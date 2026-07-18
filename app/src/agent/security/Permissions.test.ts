import { describe, expect, it } from 'vitest';
import { ControlPermissions } from './Permissions';

describe('ControlPermissions', () => {
  it('rejects wrong tokens and enforces client and rate limits', () => {
    const permissions = new ControlPermissions({ token: 'secret-token', maxClients: 1, maxRequestsPerSecond: 2, now: () => 1000 });
    expect(permissions.verifyToken('secret-token')).toBe(true);
    expect(permissions.verifyToken('nope')).toBe(false);
    expect(permissions.canAcceptClient(0)).toBe(true);
    expect(permissions.canAcceptClient(1)).toBe(false);
    expect(permissions.allowRequest('a')).toBe(true);
    expect(permissions.allowRequest('a')).toBe(true);
    expect(permissions.allowRequest('a')).toBe(false);
    permissions.clearClient('a');
    expect(permissions.allowRequest('a')).toBe(true);
  });
});
