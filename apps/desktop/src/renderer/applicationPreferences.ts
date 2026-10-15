export type AppLanguage = 'zh-CN' | 'en-US';
export type LanguagePreference = AppLanguage | 'system';
const key = 'astragit.language.v1';

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
