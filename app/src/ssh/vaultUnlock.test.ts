import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isLocked = vi.fn();
const unlock = vi.fn();
const showSecureInputPrompt = vi.fn();

vi.mock('../security/credentialVault', () => ({
  credentialVault: {
    isLocked: () => isLocked(),
    unlock: (value: string) => unlock(value),
  },
}));

vi.mock('./SecureInputPrompt', () => ({
  showSecureInputPrompt: (...args: unknown[]) => showSecureInputPrompt(...args),
}));

describe('ensureVaultUnlocked', () => {
  beforeEach(() => {
    isLocked.mockReset();
    unlock.mockReset();
    showSecureInputPrompt.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns ready without prompting when the vault is already unlocked', async () => {
    isLocked.mockResolvedValue(false);
    const { ensureVaultUnlocked } = await import('./vaultUnlock');
    await expect(ensureVaultUnlocked()).resolves.toBe('ready');
    expect(showSecureInputPrompt).not.toHaveBeenCalled();
  });

  it('returns cancelled when the master-password modal is dismissed', async () => {
    isLocked.mockResolvedValue(true);
    showSecureInputPrompt.mockResolvedValue({ value: null, save: false });
    const { ensureVaultUnlocked } = await import('./vaultUnlock');
    await expect(ensureVaultUnlocked()).resolves.toBe('cancelled');
    expect(unlock).not.toHaveBeenCalled();
  });

  it('returns ready after a correct master password', async () => {
    isLocked.mockResolvedValue(true);
    showSecureInputPrompt.mockResolvedValue({ value: 'secret', save: false });
    unlock.mockResolvedValue(true);
    const { ensureVaultUnlocked } = await import('./vaultUnlock');
    await expect(ensureVaultUnlocked()).resolves.toBe('ready');
  });

  it('returns failed after exhausting incorrect attempts', async () => {
    isLocked.mockResolvedValue(true);
    showSecureInputPrompt.mockResolvedValue({ value: 'wrong', save: false });
    unlock.mockResolvedValue(false);
    const { ensureVaultUnlocked } = await import('./vaultUnlock');
    await expect(ensureVaultUnlocked()).resolves.toBe('failed');
    expect(showSecureInputPrompt).toHaveBeenCalledTimes(3);
  });
});
