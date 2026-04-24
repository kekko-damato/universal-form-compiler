import {
  deriveKey,
  encrypt,
  randomBytes,
  toBase64,
  fromBase64,
  type EncryptedBlob,
} from './crypto';
import { readKey, writeKey } from './storage';

export const VAULT_STORAGE_KEY = 'ufc_vault_v1';
export const MIN_MASTER_PASSWORD_LENGTH = 12;

const PBKDF2_ITERATIONS = 600_000;

export interface VaultBlob {
  v: 1;
  kdf: 'pbkdf2';
  kdfParams: { iterations: number; hash: 'SHA-256' };
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
}

export interface VaultData {
  version: 1;
  createdAt: string;  // ISO timestamp
  data: Record<string, unknown>; // canonical data added in Phase 1b
}

export async function hasVault(): Promise<boolean> {
  const raw = await readKey<VaultBlob>(VAULT_STORAGE_KEY);
  return raw !== undefined;
}

export async function readVaultBlob(): Promise<VaultBlob | null> {
  const raw = await readKey<VaultBlob>(VAULT_STORAGE_KEY);
  return raw ?? null;
}

export async function createVault(masterPassword: string): Promise<void> {
  if (masterPassword.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(
      `Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`,
    );
  }
  if (await hasVault()) {
    throw new Error('Vault already exists');
  }

  const salt = randomBytes(32);
  const key = await deriveKey(masterPassword, salt, {
    iterations: PBKDF2_ITERATIONS,
    hash: 'SHA-256',
  });

  const initial: VaultData = {
    version: 1,
    createdAt: new Date().toISOString(),
    data: {},
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(initial));
  const encrypted = await encrypt(key, plaintext);

  const blob: VaultBlob = {
    v: 1,
    kdf: 'pbkdf2',
    kdfParams: { iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    salt: toBase64(salt),
    iv: toBase64(encrypted.iv),
    ciphertext: toBase64(encrypted.ciphertext),
  };
  await writeKey(VAULT_STORAGE_KEY, blob);
}
