import { describe, it, expect } from 'vitest';
import { readKey, writeKey, removeKey, clearAll } from '@/lib/storage';

describe('storage wrapper', () => {
  it('returns undefined for missing key', async () => {
    const val = await readKey<string>('missing');
    expect(val).toBeUndefined();
  });

  it('writes and reads a string value', async () => {
    await writeKey('foo', 'bar');
    expect(await readKey<string>('foo')).toBe('bar');
  });

  it('writes and reads a structured value', async () => {
    const payload = { a: 1, b: [2, 3], c: { d: 'x' } };
    await writeKey('complex', payload);
    expect(await readKey('complex')).toEqual(payload);
  });

  it('removes a key', async () => {
    await writeKey('gone', 'soon');
    await removeKey('gone');
    expect(await readKey('gone')).toBeUndefined();
  });

  it('clears all keys', async () => {
    await writeKey('a', 1);
    await writeKey('b', 2);
    await clearAll();
    expect(await readKey('a')).toBeUndefined();
    expect(await readKey('b')).toBeUndefined();
  });
});
