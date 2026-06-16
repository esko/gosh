/**
 * Resolve private key PEM bytes from stored identities (encrypted or legacy dev).
 */

import { KeyCryptoError, decryptPrivateKey } from '../security/KeyCrypto';
import type { Identity } from '../settings/types';
import {
  cacheIdentityPassphrase,
  clearIdentityPassphrase,
  getCachedIdentityPassphrase,
  promptIdentityPassphrase,
} from './IdentityPassphrase';

export function identityHasPrivateKey(identity: Identity): boolean {
  return Boolean(identity.encryptedPrivateKey || identity.privateKeyPemBytesDevOnly);
}

export function identityUsesStorageEncryption(identity: Identity): boolean {
  return Boolean(identity.encryptedPrivateKey);
}

/**
 * Return PEM bytes for nassh staging. Prompts for passphrase when encrypted and not cached.
 */
export async function resolveIdentityPrivateKeyPem(identity: Identity): Promise<ArrayBuffer | undefined> {
  if (identity.encryptedPrivateKey) {
    let passphrase = getCachedIdentityPassphrase(identity.id);
    if (!passphrase) {
      passphrase = (await promptIdentityPassphrase(identity.label)) ?? undefined;
      if (!passphrase) return undefined;
      cacheIdentityPassphrase(identity.id, passphrase);
    }

    try {
      return await decryptPrivateKey(identity.encryptedPrivateKey, passphrase);
    } catch (error) {
      clearIdentityPassphrase(identity.id);
      if (error instanceof KeyCryptoError) {
        throw error;
      }
      throw new KeyCryptoError('Failed to decrypt identity private key.');
    }
  }

  if (identity.privateKeyPemBytesDevOnly) {
    return identity.privateKeyPemBytesDevOnly;
  }

  return undefined;
}
