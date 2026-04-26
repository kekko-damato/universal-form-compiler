import { readKey, writeKey, removeKey } from './storage';
import type { CanonicalData } from './canonical-schema';

// Passwordless vault. Data is stored as plain JSON in chrome.storage.local.
// Single-user Chrome profile extension; rely on the OS account boundary.

export const VAULT_STORAGE_KEY = 'ufc_vault_v1';

export type Theme = 'light' | 'dark' | 'system';

export interface SecretConfig {
  apiKey: string;
  model: string;
  theme: Theme;
}

export interface DocumentProfile {
  id: string;
  name: string;
  data: CanonicalData;
  createdAt: string;
  updatedAt: string;
}

export interface VaultData {
  version: 1;
  createdAt: string;
  data: {
    secretConfig?: SecretConfig;
    documents?: DocumentProfile[];
    activeDocumentId?: string | null;
    // Legacy single canonical — kept here only so old installs can be migrated
    // on first read; new code path uses `documents`.
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

function genId(): string {
  return (
    'doc_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8)
  );
}

function migrateLegacyCanonical(v: VaultData): VaultData {
  // If old single canonical exists and no documents collection yet, lift it
  // into the new documents array as the first profile.
  if (v.data.canonical && !v.data.documents) {
    const now = new Date().toISOString();
    const doc: DocumentProfile = {
      id: genId(),
      name: 'Profilo principale',
      data: v.data.canonical,
      createdAt: v.createdAt ?? now,
      updatedAt: now,
    };
    v.data.documents = [doc];
    v.data.activeDocumentId = doc.id;
    delete v.data.canonical;
  }
  return v;
}

export async function readAll(): Promise<VaultData> {
  const raw = await readKey<VaultData>(VAULT_STORAGE_KEY);
  if (!raw) return emptyVault();
  return migrateLegacyCanonical(raw);
}

export async function writeAll(data: VaultData): Promise<void> {
  await writeKey(VAULT_STORAGE_KEY, data);
}

/**
 * True when the vault holds at least one document profile. The setup wizard
 * is considered complete once the user has imported their first document.
 */
export async function hasVaultData(): Promise<boolean> {
  const v = await readAll();
  return (v.data.documents?.length ?? 0) > 0;
}

// ---------- Secret config ----------

const DEFAULT_THEME: Theme = 'system';

export async function readSecretConfig(): Promise<SecretConfig | null> {
  const current = await readAll();
  const c = current.data.secretConfig;
  if (!c) return null;
  // Back-fill the theme on configs saved before this field existed.
  return { ...c, theme: c.theme ?? DEFAULT_THEME };
}

export async function writeSecretConfig(config: SecretConfig): Promise<void> {
  const current = await readAll();
  current.data.secretConfig = config;
  await writeAll(current);
}

// ---------- Documents ----------

export async function listDocuments(): Promise<DocumentProfile[]> {
  const v = await readAll();
  return v.data.documents ?? [];
}

export async function getActiveDocumentId(): Promise<string | null> {
  const v = await readAll();
  return v.data.activeDocumentId ?? null;
}

export async function getActiveDocument(): Promise<DocumentProfile | null> {
  const v = await readAll();
  const docs = v.data.documents ?? [];
  if (docs.length === 0) return null;
  const active = docs.find((d) => d.id === v.data.activeDocumentId);
  return active ?? docs[0]!;
}

export async function getDocument(id: string): Promise<DocumentProfile | null> {
  const v = await readAll();
  return v.data.documents?.find((d) => d.id === id) ?? null;
}

export async function createDocument(
  name: string,
  data: CanonicalData,
): Promise<DocumentProfile> {
  const v = await readAll();
  const now = new Date().toISOString();
  const doc: DocumentProfile = {
    id: genId(),
    name: name.trim() || 'Senza nome',
    data,
    createdAt: now,
    updatedAt: now,
  };
  v.data.documents = [...(v.data.documents ?? []), doc];
  // Auto-activate when this is the first document.
  if (!v.data.activeDocumentId) v.data.activeDocumentId = doc.id;
  await writeAll(v);
  return doc;
}

export async function updateDocument(
  id: string,
  patch: { name?: string; data?: CanonicalData },
): Promise<DocumentProfile | null> {
  const v = await readAll();
  const docs = v.data.documents ?? [];
  const idx = docs.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const next: DocumentProfile = {
    ...docs[idx]!,
    ...(patch.name !== undefined ? { name: patch.name.trim() || 'Senza nome' } : {}),
    ...(patch.data !== undefined ? { data: patch.data } : {}),
    updatedAt: new Date().toISOString(),
  };
  docs[idx] = next;
  v.data.documents = docs;
  await writeAll(v);
  return next;
}

export async function deleteDocument(id: string): Promise<void> {
  const v = await readAll();
  const docs = (v.data.documents ?? []).filter((d) => d.id !== id);
  v.data.documents = docs;
  if (v.data.activeDocumentId === id) {
    v.data.activeDocumentId = docs[0]?.id ?? null;
  }
  await writeAll(v);
}

export async function setActiveDocument(id: string): Promise<boolean> {
  const v = await readAll();
  const exists = (v.data.documents ?? []).some((d) => d.id === id);
  if (!exists) return false;
  v.data.activeDocumentId = id;
  await writeAll(v);
  return true;
}

// ---------- Legacy compat for callers that operate on "the canonical data".
// Reads the active document; writes overwrite the active document. ----------

export async function readCanonicalData(): Promise<CanonicalData | null> {
  const active = await getActiveDocument();
  return active?.data ?? null;
}

export async function writeCanonicalData(data: CanonicalData): Promise<void> {
  const v = await readAll();
  const docs = v.data.documents ?? [];
  if (docs.length === 0) {
    // No document yet — create one. Used by the first-time wizard.
    await createDocument('Profilo principale', data);
    return;
  }
  const activeId = v.data.activeDocumentId ?? docs[0]!.id;
  await updateDocument(activeId, { data });
}

export async function resetVault(): Promise<void> {
  await removeKey(VAULT_STORAGE_KEY);
}
