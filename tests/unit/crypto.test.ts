import { describe, it, expect } from 'vitest';
import { deriveKey, randomBytes, encrypt, decrypt, toBase64, fromBase64, type EncryptedBlob } from '@/lib/crypto';

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

describe('encrypt / decrypt', () => {
  it('encrypts and decrypts plaintext roundtrip', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('hello vault');

    const blob = await encrypt(key, plaintext);
    expect(blob.ciphertext).toBeInstanceOf(Uint8Array);
    expect(blob.iv).toBeInstanceOf(Uint8Array);
    expect(blob.iv.length).toBe(12);

    const decrypted = await decrypt(key, blob);
    expect(new TextDecoder().decode(decrypted)).toBe('hello vault');
  });

  it('different encryptions of same plaintext produce different ciphertexts (random IV)', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('same message');

    const b1 = await encrypt(key, plaintext);
    const b2 = await encrypt(key, plaintext);
    expect(Array.from(b1.iv)).not.toEqual(Array.from(b2.iv));
    expect(Array.from(b1.ciphertext)).not.toEqual(Array.from(b2.ciphertext));
  });

  it('decrypt with wrong key throws', async () => {
    const salt = randomBytes(32);
    const k1 = await deriveKey('right', salt, { iterations: 10_000 });
    const k2 = await deriveKey('wrong', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('secret');

    const blob = await encrypt(k1, plaintext);
    await expect(decrypt(k2, blob)).rejects.toThrow();
  });

  it('decrypt with tampered ciphertext throws', async () => {
    const salt = randomBytes(32);
    const key = await deriveKey('pass', salt, { iterations: 10_000 });
    const plaintext = new TextEncoder().encode('authentic');

    const blob = await encrypt(key, plaintext);
    // Flip a bit in ciphertext
    const tampered: EncryptedBlob = {
      iv: blob.iv,
      ciphertext: new Uint8Array(blob.ciphertext),
    };
    tampered.ciphertext[0]! ^= 0x01;
    await expect(decrypt(key, tampered)).rejects.toThrow();
  });
});

describe('base64 helpers', () => {
  it('roundtrips Uint8Array through base64', () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 128, 64]);
    const encoded = toBase64(original);
    expect(typeof encoded).toBe('string');
    const decoded = fromBase64(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles empty array', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('').length).toBe(0);
  });

  it('handles 32-byte random data', () => {
    const original = randomBytes(32);
    const roundtripped = fromBase64(toBase64(original));
    expect(Array.from(roundtripped)).toEqual(Array.from(original));
  });
});
