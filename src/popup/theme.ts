import type { Theme, GetSettingsRequest, GetSettingsResponse } from '@/types/messages';

// Resolve "system" to either "dark" or "light" using the OS preference,
// then write the result onto <html data-theme="...">. CSS handles the rest.
export function applyTheme(theme: Theme): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

export async function loadAndApplyTheme(): Promise<Theme> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'settings/get',
    } as GetSettingsRequest)) as GetSettingsResponse;
    applyTheme(res.theme);
    return res.theme;
  } catch {
    applyTheme('system');
    return 'system';
  }
}
