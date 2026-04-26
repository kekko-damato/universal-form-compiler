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

// chrome.storage.session — transient memory that survives popup closes but is
// cleared when Chrome itself shuts down. Used to keep "compile session" state
// (the most-recent fill result) available across popup re-opens, without
// polluting the persistent vault.

export async function readSessionKey<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.session.get(key);
  return result[key] as T | undefined;
}

export async function writeSessionKey<T>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

export async function removeSessionKey(key: string): Promise<void> {
  await chrome.storage.session.remove(key);
}
