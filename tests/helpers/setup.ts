import { vi, beforeEach } from 'vitest';
import { createChromeStorageMock } from './chrome-storage-mock';

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: createChromeStorageMock(),
    },
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      lastError: undefined,
    },
  };
});
