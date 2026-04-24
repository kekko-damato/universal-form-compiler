export function createChromeStorageMock() {
  const store = new Map<string, unknown>();

  return {
    get: async (
      keys: string | string[] | null,
    ): Promise<Record<string, unknown>> => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        if (store.has(k)) result[k] = store.get(k);
      }
      return result;
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    },
    remove: async (keys: string | string[]): Promise<void> => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) store.delete(k);
    },
    clear: async (): Promise<void> => {
      store.clear();
    },
  };
}
