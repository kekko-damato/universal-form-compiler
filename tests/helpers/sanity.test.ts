import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('vitest runs', () => {
    expect(2 + 2).toBe(4);
  });

  it('chrome.storage mock is available', async () => {
    await chrome.storage.local.set({ foo: 'bar' });
    const result = await chrome.storage.local.get('foo');
    expect(result).toEqual({ foo: 'bar' });
  });
});
