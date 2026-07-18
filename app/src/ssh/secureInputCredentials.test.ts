import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLoginPasswordPrompt, resolveSecureInputWithSavedPassword } from './secureInputCredentials';

const ensureVaultUnlocked = vi.fn();
const loadPassword = vi.fn();
const savePassword = vi.fn();
const forgetPassword = vi.fn();
const canSavePassword = vi.fn();
const showSecureInputPrompt = vi.fn();
const isLocked = vi.fn();

vi.mock('./vaultUnlock', () => ({
  ensureVaultUnlocked: (...args: unknown[]) => ensureVaultUnlocked(...args),
}));
vi.mock('../security/savedPasswords', () => ({
  canSavePassword: (...args: unknown[]) => canSavePassword(...args),
  loadPassword: (...args: unknown[]) => loadPassword(...args),
  savePassword: (...args: unknown[]) => savePassword(...args),
  forgetPassword: (...args: unknown[]) => forgetPassword(...args),
}));
vi.mock('./SecureInputPrompt', () => ({
  showSecureInputPrompt: (...args: unknown[]) => showSecureInputPrompt(...args),
}));
vi.mock('../security/credentialVault', () => ({
  credentialVault: {
    isLocked: (...args: unknown[]) => isLocked(...args),
  },
}));

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

describe('resolveSecureInputWithSavedPassword', () => {
  const target = { username: 'user', host: 'host.example', port: 22 };

  beforeEach(() => {
    ensureVaultUnlocked.mockReset();
    loadPassword.mockReset();
    savePassword.mockReset();
    forgetPassword.mockReset();
    canSavePassword.mockReset();
    showSecureInputPrompt.mockReset();
    isLocked.mockReset();
    canSavePassword.mockReturnValue(true);
    ensureVaultUnlocked.mockResolvedValue('ready');
    loadPassword.mockResolvedValue(null);
    savePassword.mockResolvedValue(undefined);
    forgetPassword.mockResolvedValue(undefined);
    isLocked.mockResolvedValue(false);
  });

  it('returns a saved password without showing the modal', async () => {
    loadPassword.mockResolvedValue('hunter2');
    const state = { loginPasswordProvided: false };
    await expect(
      resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, state),
    ).resolves.toEqual({ status: 'ok', value: 'hunter2' });
    expect(state.loginPasswordProvided).toBe(true);
    expect(showSecureInputPrompt).not.toHaveBeenCalled();
  });

  it('forgets a rejected saved password then prompts the user', async () => {
    showSecureInputPrompt.mockResolvedValue({ value: 'newpass', save: true });
    const state = { loginPasswordProvided: true };
    await expect(
      resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, state),
    ).resolves.toEqual({ status: 'ok', value: 'newpass' });
    expect(forgetPassword).toHaveBeenCalledWith(target);
    expect(savePassword).toHaveBeenCalledWith(target, 'newpass');
  });

  it('propagates vault / password cancel as cancelled', async () => {
    ensureVaultUnlocked.mockResolvedValue('cancelled');
    await expect(
      resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, {
        loginPasswordProvided: false,
      }),
    ).resolves.toEqual({ status: 'cancelled', reason: 'user' });
  });

  describe('silent mode', () => {
    it('auto-fills a saved password without any prompt', async () => {
      loadPassword.mockResolvedValue('hunter2');
      const state = { loginPasswordProvided: false };
      await expect(
        resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, state, {
          mode: 'silent',
        }),
      ).resolves.toEqual({ status: 'ok', value: 'hunter2' });
      expect(showSecureInputPrompt).not.toHaveBeenCalled();
      expect(ensureVaultUnlocked).not.toHaveBeenCalled();
    });

    it('fails closed when the vault is locked', async () => {
      isLocked.mockResolvedValue(true);
      await expect(
        resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, {
          loginPasswordProvided: false,
        }, { mode: 'silent' }),
      ).resolves.toEqual({ status: 'cancelled', reason: 'unavailable' });
      expect(loadPassword).not.toHaveBeenCalled();
      expect(showSecureInputPrompt).not.toHaveBeenCalled();
    });

    it('fails closed when no password is saved', async () => {
      await expect(
        resolveSecureInputWithSavedPassword("user@host's password: ", 128, false, target, {
          loginPasswordProvided: false,
        }, { mode: 'silent' }),
      ).resolves.toEqual({ status: 'cancelled', reason: 'unavailable' });
      expect(showSecureInputPrompt).not.toHaveBeenCalled();
    });
  });
});
