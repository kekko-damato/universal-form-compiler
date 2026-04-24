export async function readKey<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function writeKey<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeKey(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
