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
