import { describe, it, expect, beforeEach } from 'vitest';
import type { VaultData, SecretConfig } from '@/lib/vault';
import { createVault, hasVault, readVaultBlob, VAULT_STORAGE_KEY } from '@/lib/vault';
import { openVault, VaultLockedError, WrongPasswordError } from '@/lib/vault';
import { writeVaultData } from '@/lib/vault';
import { deleteVault } from '@/lib/vault';
import {
  writeSecretConfig,
  readSecretConfig,
  writeCanonicalData,
  readCanonicalData,
} from '@/lib/vault';
import type { CanonicalData } from '@/lib/canonical-schema';
import { clearAll, readKey } from '@/lib/storage';

describe('vault: createVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('writes an encrypted blob under the vault key', async () => {
    await createVault('my master password 1234');
    const raw = await readKey<unknown>(VAULT_STORAGE_KEY);
    expect(raw).toBeDefined();
  });

  it('blob has required fields (v, kdf, kdfParams, salt, iv, ciphertext)', async () => {
    await createVault('pw1234567890abc');
    const blob = await readVaultBlob();
    expect(blob).not.toBeNull();
    expect(blob!.v).toBe(1);
    expect(blob!.kdf).toBe('pbkdf2');
    expect(typeof blob!.kdfParams.iterations).toBe('number');
    expect(typeof blob!.salt).toBe('string');
    expect(typeof blob!.iv).toBe('string');
    expect(typeof blob!.ciphertext).toBe('string');
  });

  it('hasVault() reflects presence', async () => {
    expect(await hasVault()).toBe(false);
    await createVault('pw1234567890abc');
    expect(await hasVault()).toBe(true);
  });

  it('createVault throws if password too short', async () => {
    await expect(createVault('short')).rejects.toThrow(/at least 12/i);
  });

  it('createVault throws if vault already exists', async () => {
    await createVault('pw1234567890abc');
    await expect(createVault('pw1234567890abc')).rejects.toThrow(/already exists/i);
  });
});

describe('vault: openVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('decrypts vault with correct password and returns VaultData', async () => {
    await createVault('correct password here');
    const data = await openVault('correct password here');
    expect(data.version).toBe(1);
    expect(data.data).toEqual({});
    expect(typeof data.createdAt).toBe('string');
  });

  it('throws WrongPasswordError on incorrect password', async () => {
    await createVault('correct password here');
    await expect(openVault('wrong password yes')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('throws VaultLockedError when no vault exists', async () => {
    await expect(openVault('any password')).rejects.toBeInstanceOf(
      VaultLockedError,
    );
  });
});

describe('vault: writeVaultData', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('updates vault data and roundtrips via openVault', async () => {
    await createVault('my strong pw 123');
    const first = await openVault('my strong pw 123');
    expect(first.data).toEqual({});

    const updated: VaultData = {
      ...first,
      data: { foo: 'bar', n: 42 },
    };
    await writeVaultData(updated, 'my strong pw 123');

    const reopened = await openVault('my strong pw 123');
    expect(reopened.data).toEqual({ foo: 'bar', n: 42 });
  });

  it('writeVaultData with wrong password throws', async () => {
    await createVault('my strong pw 123');
    const d = await openVault('my strong pw 123');
    await expect(
      writeVaultData(d, 'different password!'),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('vault: deleteVault', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('requires correct password and removes storage key', async () => {
    await createVault('pw very long here');
    expect(await hasVault()).toBe(true);

    await deleteVault('pw very long here');
    expect(await hasVault()).toBe(false);
  });

  it('wrong password throws and does not delete', async () => {
    await createVault('pw very long here');
    await expect(deleteVault('wrong pw is wrong')).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(await hasVault()).toBe(true);
  });
});

describe('vault: secret config', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('stores and reads apiKey + model', async () => {
    await createVault('my strong pw 123');
    const cfg: SecretConfig = { apiKey: 'sk-test-abc', model: 'gpt-4o-mini' };
    await writeSecretConfig(cfg, 'my strong pw 123');
    const read = await readSecretConfig('my strong pw 123');
    expect(read).toEqual({ apiKey: 'sk-test-abc', model: 'gpt-4o-mini' });
  });

  it('readSecretConfig returns null before first write', async () => {
    await createVault('my strong pw 123');
    const cfg = await readSecretConfig('my strong pw 123');
    expect(cfg).toBeNull();
  });
});

describe('vault: canonical data', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('stores and reads CanonicalData', async () => {
    await createVault('my strong pw 123');
    const data: CanonicalData = {
      version: 1,
      person: { first_name: 'Antonio', last_name: 'Rossi' },
      contact: { email: 'antonio@example.com' },
    };
    await writeCanonicalData(data, 'my strong pw 123');
    const read = await readCanonicalData('my strong pw 123');
    expect(read).toEqual(data);
  });

  it('readCanonicalData returns null before first write', async () => {
    await createVault('my strong pw 123');
    expect(await readCanonicalData('my strong pw 123')).toBeNull();
  });
});
