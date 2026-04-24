import { describe, it, expect } from 'vitest';
import { toBase64, fromBase64 } from '@/lib/crypto';

// Crypto module was reduced to base64 helpers when the master-password flow
// was removed. These are the only crypto-adjacent tests that still matter.
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

  it('handles 32-byte binary data', () => {
    const original = new Uint8Array(32);
    for (let i = 0; i < 32; i++) original[i] = i * 7;
    const roundtripped = fromBase64(toBase64(original));
    expect(Array.from(roundtripped)).toEqual(Array.from(original));
  });
});
