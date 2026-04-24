import { describe, it, expect, beforeEach } from 'vitest';
import { createVault, hasVault, readVaultBlob, VAULT_STORAGE_KEY } from '@/lib/vault';
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
