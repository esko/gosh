import type { Identity } from '../settings/types';

const ENCRYPTED_KEY_FORMAT_VERSION = 1;
const ENCRYPTED_KEY_MIN_BYTES = 1 + 16 + 12 + 16;

function isEncryptedPrivateKeyBlob(blob: ArrayBuffer): boolean {
  const bytes = new Uint8Array(blob);
  return bytes.length >= ENCRYPTED_KEY_MIN_BYTES && bytes[0] === ENCRYPTED_KEY_FORMAT_VERSION;
}

/**
 * Normalize identity rows read from IndexedDB.
 * Preserves WebCrypto-encrypted keys; migrates pre-WebCrypto plaintext PEM stored in encryptedPrivateKey.
 */
export function normalizeIdentity(raw: Identity): Identity {
  if (raw.encryptedPrivateKey && !raw.privateKeyPemBytesDevOnly) {
    if (isEncryptedPrivateKeyBlob(raw.encryptedPrivateKey)) {
      return raw;
    }
    const { encryptedPrivateKey, ...rest } = raw;
    return { ...rest, privateKeyPemBytesDevOnly: encryptedPrivateKey };
  }
  return raw;
}

export function identityExportFlags(identity: Identity) {
  const { encryptedPrivateKey, privateKeyPemBytesDevOnly, ...rest } = identity;
  return {
    ...rest,
    hasEncryptedPrivateKey: Boolean(encryptedPrivateKey),
    hasLegacyPlaintextKey: Boolean(privateKeyPemBytesDevOnly),
  };
}
