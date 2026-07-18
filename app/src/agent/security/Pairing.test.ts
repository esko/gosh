import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  disablePairing,
  enablePairing,
  generatePairingToken,
  loadPairingState,
  resetPairingToken,
  timingSafeEqual,
  verifyStoredToken,
} from './Pairing';
import { clearAgentControlPairing, resetIndexedDbConnection } from '../../storage/indexedDb';

async function resetDb(): Promise<void> {
  await resetIndexedDbConnection();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('gosh');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(resetDb);
afterEach(resetDb);

describe('Pairing', () => {
  it('generates high-entropy tokens', () => {
    const a = generatePairingToken();
    const b = generatePairingToken();
    expect(a.length).toBeGreaterThan(32);
    expect(a).not.toBe(b);
  });

  it('compares tokens in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('persists enabled pairing owner-only in IndexedDB', async () => {
    expect(await loadPairingState()).toEqual({ enabled: false, token: null, enabledAt: null });
    const enabled = await enablePairing();
    expect(enabled.enabled).toBe(true);
    expect(enabled.token).toBeTruthy();
    expect(await verifyStoredToken(enabled.token!)).toBe(true);
    expect(await verifyStoredToken('wrong')).toBe(false);
    await disablePairing();
    expect(await loadPairingState()).toEqual({ enabled: false, token: null, enabledAt: null });
    await clearAgentControlPairing();
  });

  it('rotates tokens while staying enabled', async () => {
    const first = await enablePairing();
    const second = await resetPairingToken();
    expect(second.enabled).toBe(true);
    expect(second.token).not.toBe(first.token);
    expect(await verifyStoredToken(first.token!)).toBe(false);
    expect(await verifyStoredToken(second.token!)).toBe(true);
  });
});
