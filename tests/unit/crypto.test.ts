import { describe, it, expect } from 'vitest';
import { deriveKey, randomBytes } from '@/lib/crypto';

describe('deriveKey', () => {
  it('derives a 256-bit CryptoKey from a password + salt via PBKDF2', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('correct horse battery staple', salt, {
      iterations: 100_000,
    });
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('same password + salt derives the same key material', async () => {
    const salt = randomBytes(32);
    const k1 = await deriveKey('hunter2', salt, { iterations: 10_000 });
    const k2 = await deriveKey('hunter2', salt, { iterations: 10_000 });

    // Keys can't be directly compared, but we can test by encrypting
    // the same plaintext with the same IV and checking ciphertext matches.
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('test');
    const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, plaintext));
    const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, plaintext));
    expect(Array.from(c1)).toEqual(Array.from(c2));
  });

  it('different salts produce different keys', async () => {
    const s1 = randomBytes(32);
    const s2 = randomBytes(32);
    const k1 = await deriveKey('samepw', s1, { iterations: 10_000 });
    const k2 = await deriveKey('samepw', s2, { iterations: 10_000 });
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('test');
    const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, plaintext));
    const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, plaintext));
    expect(Array.from(c1)).not.toEqual(Array.from(c2));
  });
});

describe('randomBytes', () => {
  it('returns a Uint8Array of requested length', () => {
    const r = randomBytes(16);
    expect(r).toBeInstanceOf(Uint8Array);
    expect(r.length).toBe(16);
  });
});
