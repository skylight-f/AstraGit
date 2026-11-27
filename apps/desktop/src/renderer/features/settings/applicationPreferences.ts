export type AppLanguage = 'zh-CN' | 'en-US';
export type LanguagePreference = AppLanguage | 'system';
const key = 'astragit.language.v1';
const autoFetchKey = 'astragit.git.auto-fetch.v1';

export function readAutoFetchPreference(): boolean {
  try { return localStorage.getItem(autoFetchKey) !== 'false'; }
  catch { return true; }
}

export function saveAutoFetchPreference(enabled: boolean): void {
  localStorage.setItem(autoFetchKey, String(enabled));
}

export function readLanguagePreference(): LanguagePreference {
  try { const value = localStorage.getItem(key); return value === 'zh-CN' || value === 'en-US' ? value : 'system'; }
  catch { return 'system'; }
}

export function saveLanguagePreference(value: LanguagePreference): void {
  localStorage.setItem(key, value);
}

export function resolveApplicationLanguage(preference: LanguagePreference, system: AppLanguage): AppLanguage {
  return preference === 'system' ? system : preference;
}
