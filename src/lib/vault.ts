import { readKey, writeKey, removeKey } from './storage';
import type { CanonicalData } from './canonical-schema';

// Passwordless vault. Data is stored as plain JSON in chrome.storage.local.
// The user explicitly opted out of the encryption / master-password flow —
// this is a single-user Chrome profile extension and the overhead was not
// worth it. If you need privacy, rely on the OS account boundary.

export const VAULT_STORAGE_KEY = 'ufc_vault_v1';

export interface SecretConfig {
  apiKey: string;
  model: string;
}

export interface VaultData {
  version: 1;
  createdAt: string; // ISO timestamp
  data: {
    secretConfig?: SecretConfig;
    canonical?: CanonicalData;
  };
}

function emptyVault(): VaultData {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    data: {},
  };
}

/**
 * True when the vault key has ever been written AND holds canonical data.
 * (Merely having a SecretConfig doesn't count as "has data" — the setup
 * wizard is considered complete once the user has imported personal data.)
 */
export async function hasVaultData(): Promise<boolean> {
  const raw = await readKey<VaultData>(VAULT_STORAGE_KEY);
  return raw?.data?.canonical != null;
}

export async function readAll(): Promise<VaultData> {
  const raw = await readKey<VaultData>(VAULT_STORAGE_KEY);
  return raw ?? emptyVault();
}

export async function writeAll(data: VaultData): Promise<void> {
  await writeKey(VAULT_STORAGE_KEY, data);
}

export async function writeSecretConfig(config: SecretConfig): Promise<void> {
  const current = await readAll();
  current.data.secretConfig = config;
  await writeAll(current);
}

export async function readSecretConfig(): Promise<SecretConfig | null> {
  const current = await readAll();
  return current.data.secretConfig ?? null;
}

export async function writeCanonicalData(data: CanonicalData): Promise<void> {
  const current = await readAll();
  current.data.canonical = data;
  await writeAll(current);
}

export async function readCanonicalData(): Promise<CanonicalData | null> {
  const current = await readAll();
  return current.data.canonical ?? null;
}

export async function resetVault(): Promise<void> {
  await removeKey(VAULT_STORAGE_KEY);
}
