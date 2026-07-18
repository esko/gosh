/**
 * Shared secureInput handling for interactive SSH and the image-paste SFTP
 * sidecar: unlock the vault, auto-fill a saved login password when present,
 * and optionally persist a newly typed one.
 */

import { credentialVault } from '../security/credentialVault';
import {
  canSavePassword,
  forgetPassword,
  loadPassword,
  savePassword,
  type CredentialTarget,
} from '../security/savedPasswords';
import { showSecureInputPrompt } from './SecureInputPrompt';
import { ensureVaultUnlocked } from './vaultUnlock';

export type SecureInputCredentialState = {
  /** True after a saved or typed login password was supplied this connection. */
  loginPasswordProvided: boolean;
};

export type SecureInputCredentialResult =
  | { status: 'ok'; value: string }
  | { status: 'cancelled'; reason?: 'user' | 'unavailable' };

export type SecureInputCredentialOptions = {
  /**
   * `interactive` (default): vault unlock + password modal as needed.
   * `silent`: only auto-fill an already-unlocked saved password; never show UI.
   */
  mode?: 'interactive' | 'silent';
};

/**
 * True when a masked secureInput prompt is the SSH login password (the only
 * prompt eligible for saving/auto-fill). Echoed responses are excluded, as are
 * the common one-time / 2FA prompts that also mask input — those are entered
 * fresh each connect and must never be stored.
 */
export function isLoginPasswordPrompt(message: string, echo: boolean): boolean {
  if (echo) return false;
  if (!/password/i.test(message)) return false;
  return !/verification|one[-\s]?time|\botp\b|token|authenticator|\bcode\b/i.test(message);
}

/**
 * Resolve a nassh `secureInput` request for a login-password-capable target.
 * Callers must handle host-key prompts before invoking this.
 */
export async function resolveSecureInputWithSavedPassword(
  message: string,
  bufLen: number,
  echo: boolean,
  target: CredentialTarget,
  state: SecureInputCredentialState,
  options: SecureInputCredentialOptions = {},
): Promise<SecureInputCredentialResult> {
  const mode = options.mode ?? 'interactive';
  const eligible = isLoginPasswordPrompt(message, echo) && canSavePassword(target);

  if (mode === 'silent') {
    if (!eligible || state.loginPasswordProvided) {
      if (eligible && state.loginPasswordProvided) await forgetPassword(target);
      return { status: 'cancelled', reason: 'unavailable' };
    }
    if (await credentialVault.isLocked()) {
      return { status: 'cancelled', reason: 'unavailable' };
    }
    const saved = await loadPassword(target).catch(() => null);
    if (!saved) return { status: 'cancelled', reason: 'unavailable' };
    state.loginPasswordProvided = true;
    return { status: 'ok', value: saved.slice(0, bufLen) };
  }

  let vaultReady = false;
  if (eligible) {
    const unlock = await ensureVaultUnlocked();
    if (unlock === 'cancelled') return { status: 'cancelled', reason: 'user' };
    vaultReady = unlock === 'ready';
  }

  if (eligible && vaultReady && !state.loginPasswordProvided) {
    const saved = await loadPassword(target).catch(() => null);
    if (saved) {
      state.loginPasswordProvided = true;
      return { status: 'ok', value: saved.slice(0, bufLen) };
    }
  } else if (eligible && vaultReady && state.loginPasswordProvided) {
    await forgetPassword(target);
  }

  const offerSave = eligible && vaultReady;
  const { value, save } = await showSecureInputPrompt(message, bufLen, echo, { offerSave });
  if (value === null) return { status: 'cancelled', reason: 'user' };
  if (offerSave) {
    state.loginPasswordProvided = true;
    if (save) await savePassword(target, value).catch(() => undefined);
    else await forgetPassword(target);
  }
  return { status: 'ok', value: value.slice(0, bufLen) };
}

export const SAVED_CREDENTIALS_UNAVAILABLE_MESSAGE =
  'Image upload needs key-based auth or a saved password (unlock the vault if it is locked).';
