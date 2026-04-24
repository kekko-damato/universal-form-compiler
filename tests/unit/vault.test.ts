import { describe, it, expect, beforeEach } from 'vitest';
import type { VaultData } from '@/lib/vault';
import { createVault, hasVault, readVaultBlob, VAULT_STORAGE_KEY } from '@/lib/vault';
import { openVault, VaultLockedError, WrongPasswordError } from '@/lib/vault';
import { writeVaultData } from '@/lib/vault';
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
