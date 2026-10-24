export interface GitLargeFilePreferences { enabled: boolean; thresholdMiB: number }
const key = 'astragit.git.large-file-warning.v1';
const defaults: GitLargeFilePreferences = { enabled: true, thresholdMiB: 10 };
let sessionPreference: GitLargeFilePreferences | undefined;

function valid(value: unknown): value is GitLargeFilePreferences {
  if (!value || typeof value !== 'object') return false;
  const item = value as GitLargeFilePreferences;
  return typeof item.enabled === 'boolean' && Number.isSafeInteger(item.thresholdMiB) && item.thresholdMiB >= 1 && item.thresholdMiB <= 1024;
}
export function readGitLargeFilePreferences(): GitLargeFilePreferences {
  if (sessionPreference) return { ...sessionPreference };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (valid(saved)) return { enabled: saved.enabled, thresholdMiB: saved.thresholdMiB };
  } catch { /* Missing or unavailable preferences use the application default. */ }
  return { ...defaults };
}
/** A storage failure still changes this session; callers must not claim it persisted. */
export function saveGitLargeFilePreferences(value: GitLargeFilePreferences): boolean {
  if (!valid(value)) throw new Error('Invalid large-file warning preferences.');
  try { localStorage.setItem(key, JSON.stringify(value)); sessionPreference = undefined; return true; }
  catch { sessionPreference = { ...value }; return false; }
}
