/**
 * Interactive unlock for the credential vault, used on the SSH auth path before
 * a saved password is read or written. No-op when the vault is not locked (no
 * master password set, or already unlocked / auto-unlockable via the device key).
 */

import { credentialVault } from '../security/credentialVault';
import { showSecureInputPrompt } from './SecureInputPrompt';

const MAX_ATTEMPTS = 3;

/** Outcome of an interactive vault unlock attempt. */
export type VaultUnlockResult = 'ready' | 'cancelled' | 'failed';

/**
 * Ensure the vault is usable.
 * - `ready`: unlocked (or never locked)
 * - `cancelled`: user dismissed the master-password modal — callers must abort auth
 * - `failed`: wrong master password exhausted — callers may fall back to a plain prompt
 */
export async function ensureVaultUnlocked(): Promise<VaultUnlockResult> {
  if (!(await credentialVault.isLocked())) return 'ready';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const message = attempt === 0
      ? 'Enter your master password to use saved passwords'
      : 'Incorrect master password — try again';
    const { value } = await showSecureInputPrompt(message, 256, false);
    if (value === null) return 'cancelled';
    if (await credentialVault.unlock(value)) return 'ready';
  }
  return 'failed';
}
