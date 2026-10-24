import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export interface GitTrackingIdentity { headSha: string; branch: string; detached: boolean }
export interface GitStopTrackingPreview extends GitTrackingIdentity {
  fingerprint: string;
  selection: string[];
  total: number;
  gitlinkCount: number;
  conflictCount: number;
  items: Array<{ path: string; kind: 'file' | 'symlink' | 'gitlink'; conflicted: boolean }>;
}
type Run = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }>;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write', operationStage: 'preflight' });

export function gitFileSelection(paths: string[]): string[] {
  if (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\0') || path.replace(/\/$/u, '').split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw failure('ASTRAGIT_GIT_TRACKING_PATH_INVALID', '请选择仓库内的有效文件或目录。');
  return [...new Set(paths.map(path => path.replace(/\/$/u, '')))].sort();
}

/** Resolve directories through the index, including unchanged tracked entries. */
export async function readStopTracking(cwd: string, identity: GitTrackingIdentity, paths: string[], run: Run) {
  const selection = gitFileSelection(paths);
  const [index, flags] = await Promise.all([run(['ls-files', '--stage', '-z']), run(['ls-files', '-v', '-z'])]);
  const entries = new Map<string, GitStopTrackingPreview['items'][number]>();
  for (const entry of index.stdout.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t'); const [mode, , stage] = entry.slice(0, separator).split(' '); const path = entry.slice(separator + 1);
    if (separator < 0) throw failure('ASTRAGIT_GIT_TRACKING_INDEX_INVALID', '无法读取暂存区条目，请刷新并检查索引。');
    entries.set(path, { path, kind: mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : 'file', conflicted: stage !== '0' });
  }
  const matches = (selected: string, path: string) => path === selected || path.startsWith(`${selected}/`);
  const missing = selection.filter(path => ![...entries.keys()].some(candidate => matches(path, candidate)));
  if (missing.length) throw Object.assign(failure('ASTRAGIT_GIT_STOP_TRACKING_NOT_TRACKED', '所选路径已不在暂存区中，请刷新后重新选择。'), { affectedFiles: missing.slice(0, 200), affectedFileCount: missing.length });
  const items = [...entries.values()].filter(entry => selection.some(path => matches(path, entry.path))).sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = createHash('sha256').update(JSON.stringify([cwd, identity, selection, index.stdout, flags.stdout])).digest('hex');
  const preview: GitStopTrackingPreview = { ...identity, selection, fingerprint, total: items.length, gitlinkCount: items.filter(item => item.kind === 'gitlink').length, conflictCount: items.filter(item => item.conflicted).length, items: items.slice(0, 200) };
  return { preview, paths: items.map(item => item.path) };
}
