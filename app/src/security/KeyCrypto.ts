/**
 * WebCrypto encryption for SSH private keys at rest (AES-GCM + PBKDF2).
 */

const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 310_000;

export class KeyCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyCryptoError';
  }
}

function requireSubtle(): SubtleCrypto {
  if (!crypto?.subtle) {
    throw new KeyCryptoError('Web Crypto is unavailable in this context.');
  }
  return crypto.subtle;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const saltBytes = Uint8Array.from(salt);
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt private key PEM bytes with a user passphrase.
 * Blob layout: version (1) | salt (16) | iv (12) | ciphertext.
 */
export async function encryptPrivateKey(pemBytes: ArrayBuffer, passphrase: string): Promise<ArrayBuffer> {
  if (!passphrase) {
    throw new KeyCryptoError('Passphrase is required to encrypt the private key.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = await requireSubtle().encrypt({ name: 'AES-GCM', iv: Uint8Array.from(iv) }, key, pemBytes);

  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + ciphertext.byteLength);
  out[0] = FORMAT_VERSION;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_BYTES);
  out.set(new Uint8Array(ciphertext), 1 + SALT_BYTES + IV_BYTES);
  return out.buffer;
}

/** Decrypt a blob produced by {@link encryptPrivateKey}. */
export async function decryptPrivateKey(blob: ArrayBuffer, passphrase: string): Promise<ArrayBuffer> {
  if (!passphrase) {
    throw new KeyCryptoError('Passphrase is required to decrypt the private key.');
  }

  const bytes = new Uint8Array(blob);
  if (bytes.length < 1 + SALT_BYTES + IV_BYTES + 16) {
    throw new KeyCryptoError('Encrypted key data is too short.');
  }
  if (bytes[0] !== FORMAT_VERSION) {
    throw new KeyCryptoError('Unsupported encrypted key format version.');
  }

  const salt = bytes.slice(1, 1 + SALT_BYTES);
  const iv = bytes.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  const ciphertext = bytes.slice(1 + SALT_BYTES + IV_BYTES);

  const key = await deriveKey(passphrase, salt);

  try {
    return await requireSubtle().decrypt({ name: 'AES-GCM', iv: Uint8Array.from(iv) }, key, ciphertext);
  } catch {
    throw new KeyCryptoError('Incorrect passphrase or corrupted key data.');
  }
}

export function isEncryptedPrivateKeyBlob(blob: ArrayBuffer): boolean {
  const bytes = new Uint8Array(blob);
  return bytes.length >= 1 + SALT_BYTES + IV_BYTES + 16 && bytes[0] === FORMAT_VERSION;
}
