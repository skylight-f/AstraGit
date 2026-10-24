export interface RepositorySetupInput {
  requestId: string;
  kind: 'clone' | 'init';
  localPath: string;
  name?: string;
  source?: string;
  branch?: string;
  recursive?: boolean;
  depth?: number;
}

export interface RepositorySetupJob {
  id: string;
  kind: RepositorySetupInput['kind'];
  localPath: string;
  status: 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  output: string;
  startedAt: string;
  finishedAt?: string;
  projectId?: string;
  error?: { code: string; message: string; details?: string };
}

/** Git supports local paths, HTTP(S), SSH, git:// and scp-style addresses. */
export function gitRemoteAddressIssue(value: string): 'empty' | 'invalid' | 'credentials' | null {
  if (!value.trim()) return 'empty';
  if (value !== value.trim() || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || value.startsWith('-')) return 'invalid';
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value)) return null;
  if (/^(?:[\w.-]+@)?[\w.][\w.-]*:[^:\s][^\s]*$/u.test(value) && !value.includes('://')) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ssh:', 'git:', 'file:'].includes(url.protocol)) return 'invalid';
    if (url.password || (['http:', 'https:'].includes(url.protocol) && url.username) || url.search || url.hash) return 'credentials';
    if (url.protocol !== 'file:' && (!url.hostname || url.hostname.startsWith('-'))) return 'invalid';
    if (url.protocol === 'file:' && url.hostname && url.hostname !== 'localhost') return 'invalid';
    return url.pathname && url.pathname !== '/' ? null : 'invalid';
  } catch { return 'invalid'; }
}
