import { describe, it, expect, beforeEach } from 'vitest';
import {
  VAULT_STORAGE_KEY,
  hasVaultData,
  readAll,
  writeAll,
  writeSecretConfig,
  readSecretConfig,
  writeCanonicalData,
  readCanonicalData,
  resetVault,
  type SecretConfig,
  type VaultData,
} from '@/lib/vault';
import type { CanonicalData } from '@/lib/canonical-schema';
import { clearAll, readKey } from '@/lib/storage';

describe('vault (passwordless)', () => {
  beforeEach(async () => {
    await clearAll();
  });

  describe('empty state', () => {
    it('hasVaultData is false before anything is written', async () => {
      expect(await hasVaultData()).toBe(false);
    });

    it('readAll returns an empty VaultData shell when storage is empty', async () => {
      const v = await readAll();
      expect(v.version).toBe(1);
      expect(v.data).toEqual({});
      expect(typeof v.createdAt).toBe('string');
    });

    it('readSecretConfig returns null before first write', async () => {
      expect(await readSecretConfig()).toBeNull();
    });

    it('readCanonicalData returns null before first write', async () => {
      expect(await readCanonicalData()).toBeNull();
    });
  });

  describe('secretConfig roundtrip', () => {
    it('stores and reads apiKey + model', async () => {
      const cfg: SecretConfig = { apiKey: 'sk-test-abc', model: 'gpt-4o-mini', theme: 'system' };
      await writeSecretConfig(cfg);
      expect(await readSecretConfig()).toEqual(cfg);
    });

    it('overwrites previous secret config', async () => {
      await writeSecretConfig({ apiKey: 'sk-1', model: 'gpt-4o-mini', theme: 'system' });
      await writeSecretConfig({ apiKey: 'sk-2', model: 'gpt-4o', theme: 'dark' });
      expect(await readSecretConfig()).toEqual({
        apiKey: 'sk-2',
        model: 'gpt-4o',
        theme: 'dark',
      });
    });

    it('setting a secret config alone does NOT flip hasVaultData to true', async () => {
      await writeSecretConfig({ apiKey: 'sk-1', model: 'gpt-4o-mini', theme: 'system' });
      expect(await hasVaultData()).toBe(false);
    });
  });

  describe('canonical data roundtrip', () => {
    const sample: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: { email: 'antonio@example.com' },
    };

    it('stores and reads CanonicalData', async () => {
      await writeCanonicalData(sample);
      expect(await readCanonicalData()).toEqual(sample);
    });

    it('hasVaultData flips to true after writing canonical data', async () => {
      expect(await hasVaultData()).toBe(false);
      await writeCanonicalData(sample);
      expect(await hasVaultData()).toBe(true);
    });

    it('does not clobber a previously-stored secretConfig', async () => {
      await writeSecretConfig({ apiKey: 'sk-keep', model: 'gpt-4o-mini', theme: 'system' });
      await writeCanonicalData(sample);
      expect(await readSecretConfig()).toEqual({
        apiKey: 'sk-keep',
        model: 'gpt-4o-mini',
        theme: 'system',
      });
    });
  });

  describe('writeAll / readAll', () => {
    it('writes and reads a full vault blob', async () => {
      const v: VaultData = {
        version: 1,
        createdAt: '2026-04-24T00:00:00.000Z',
        data: {
          secretConfig: { apiKey: 'sk-x', model: 'gpt-4o-mini', theme: 'system' },
        },
      };
      await writeAll(v);
      expect(await readAll()).toEqual(v);
    });

    it('stores data as plain JSON in chrome.storage.local (no encryption)', async () => {
      const cfg: SecretConfig = { apiKey: 'sk-plain', model: 'gpt-4o-mini', theme: 'system' };
      await writeSecretConfig(cfg);
      const raw = await readKey<VaultData>(VAULT_STORAGE_KEY);
      // Direct readable access — no ciphertext field, etc.
      expect(raw?.data?.secretConfig?.apiKey).toBe('sk-plain');
    });
  });

  describe('resetVault', () => {
    it('removes the storage key', async () => {
      await writeCanonicalData({
        version: 1,
        person: { first_name: 'A', last_name: 'B' },
        contact: { email: 'a@b.co' },
      });
      expect(await hasVaultData()).toBe(true);
      await resetVault();
      expect(await hasVaultData()).toBe(false);
      expect(await readSecretConfig()).toBeNull();
      expect(await readCanonicalData()).toBeNull();
    });
  });
});
