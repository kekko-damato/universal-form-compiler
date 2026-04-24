export interface DeriveKeyOptions {
  iterations?: number;
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-512';
}

const DEFAULT_ITERATIONS = 600_000;

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  opts: DeriveKeyOptions = {},
): Promise<CryptoKey> {
  const { iterations = DEFAULT_ITERATIONS, hash = 'SHA-256' } = opts;

  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedBlob {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource),
  );
  return { iv, ciphertext };
}

export async function decrypt(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.iv as BufferSource },
    key,
    blob.ciphertext as BufferSource,
  );
  return new Uint8Array(result);
}
