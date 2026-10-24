import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gitFileSelection } from './gitFileTracking.js';

export interface GitIgnoreMatch { source: string; line: number; pattern: string }
export interface GitIgnoredItem { path: string; directory: boolean; rule: GitIgnoreMatch }
export interface GitIgnoredQuery { prefix?: string; search?: string; offset?: number; limit?: number; expectedFingerprint?: string }
export interface GitIgnoredPage { prefix: string; items: GitIgnoredItem[]; total: number; offset: number; nextOffset: number; hasMore: boolean; fingerprint: string }
type Run = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }>;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write', operationStage: 'preflight' });
const normalize = (path: string) => path.replace(/\/$/u, '');

export async function gitIgnoreMatches(paths: string[], run: Run): Promise<Map<string, GitIgnoreMatch>> {
  const matches = new Map<string, GitIgnoreMatch>(); if (!paths.length) return matches;
  let stdout: string;
  try { stdout = (await run(['check-ignore', '--no-index', '--verbose', '-z', '--stdin'], paths.join('\0') + '\0')).stdout; }
  catch (error) { if ((error as { exitCode?: number }).exitCode !== 1) throw error; stdout = (error as { stdout?: string }).stdout ?? ''; }
  const fields = stdout.split('\0'); if (fields.at(-1) === '') fields.pop();
  if (fields.length % 4 !== 0) throw failure('ASTRAGIT_GIT_IGNORED_LIST_INVALID', 'Git 返回了无法解析的忽略规则信息。');
  for (let index = 0; index < fields.length; index += 4) {
    const [source, lineText, pattern, path] = fields.slice(index, index + 4) as [string, string, string, string];
    const line = Number(lineText);
    if (!source || !Number.isSafeInteger(line) || line < 1 || pattern.startsWith('!')) continue;
    matches.set(normalize(path), { source, line, pattern });
  }
  return matches;
}

async function requireDirectory(cwd: string, path: string) {
  for (const part of path.split('/').map((_part, index, parts) => parts.slice(0, index + 1).join('/'))) {
    const info = await lstat(join(cwd, part)).catch(error => {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '所选目录已不存在，请返回上级并刷新。');
      throw error;
    });
    if (!info.isDirectory() || info.isSymbolicLink()) throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '所选目录已变化，请返回上级并刷新。');
  }
}

export async function readIgnoredFiles(cwd: string, query: GitIgnoredQuery, run: Run, signal?: AbortSignal): Promise<GitIgnoredPage> {
  const prefix = query.prefix ? gitFileSelection([query.prefix])[0]! : '';
  const offset = query.offset ?? 0; const limit = query.limit ?? 100; const search = query.search ?? '';
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || search.length > 500 || search.includes('\0')) throw failure('ASTRAGIT_GIT_IGNORED_QUERY_INVALID', '忽略文件查询范围无效。');
  signal?.throwIfAborted();
  let candidates: string[];
  if (!prefix) {
    // `ls-files --directory` skips nested ignore files inside untracked folders.
    // Matching status reports those leaves while keeping explicitly ignored dirs collapsed.
    const rows = (await run(['status', '--porcelain=v1', '--ignored=matching', '--untracked-files=normal', '--ignore-submodules=all', '-z'])).stdout.split('\0').filter(Boolean);
    candidates = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      if (row.startsWith('!! ')) candidates.push(row.slice(3));
      // A rename/copy has a second NUL-delimited path, which is not a status row.
      if (/[RC]/u.test(row.slice(0, 2))) index++;
    }
  }
  else {
    await requireDirectory(cwd, prefix);
    const tracked = new Set((await run(['ls-files', '--cached', '-z'])).stdout.split('\0').filter(Boolean));
    if (tracked.has(prefix) || !(await gitIgnoreMatches([prefix + '/'], run)).has(prefix)) throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '此目录已不属于忽略范围，请返回上级并刷新。');
    candidates = (await readdir(join(cwd, prefix), { withFileTypes: true })).filter(entry => entry.name.toLowerCase() !== '.git').map(entry => `${prefix}/${entry.name}${entry.isDirectory() && !entry.isSymbolicLink() ? '/' : ''}`).filter(path => !tracked.has(normalize(path)));
  }
  candidates = [...new Set(candidates)].filter(path => path.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort();
  const fingerprint = createHash('sha256').update(JSON.stringify([cwd, prefix, search, candidates])).digest('hex');
  if (query.expectedFingerprint && query.expectedFingerprint !== fingerprint) throw failure('ASTRAGIT_GIT_IGNORED_LIST_CHANGED', '忽略文件清单已变化，请重新载入后继续。');
  const page = candidates.slice(offset, offset + limit); const rules = await gitIgnoreMatches(page, run);
  if (page.some(path => !rules.has(normalize(path)))) throw failure('ASTRAGIT_GIT_IGNORED_LIST_CHANGED', '读取期间忽略规则已变化，请重新载入后继续。');
  signal?.throwIfAborted();
  const nextOffset = Math.min(candidates.length, offset + limit);
  return { prefix, items: page.flatMap(path => { const rule = rules.get(normalize(path)); return rule ? [{ path, directory: path.endsWith('/'), rule }] : []; }), total: candidates.length, offset, nextOffset, hasMore: nextOffset < candidates.length, fingerprint };
}

/** Validate every selected item before running the explicit native force-add. */
export async function requireIgnoredSelection(cwd: string, paths: string[], run: Run): Promise<string[]> {
  const selection = gitFileSelection(paths);
  const tracked = new Set((await run(['ls-files', '--cached', '-z'])).stdout.split('\0').filter(Boolean));
  if (selection.some(path => tracked.has(path))) throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '所选项已经跟踪，请刷新后重新选择。');
  for (const path of selection) {
    const parent = path.split('/').slice(0, -1).join('/');
    if (parent) await requireDirectory(cwd, parent);
    try { await lstat(join(cwd, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '所选忽略项已不存在，请刷新后重新选择。'); throw error; }
  }
  const matches = await gitIgnoreMatches(selection, run);
  if (selection.some(path => !matches.has(path))) throw failure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '所选项已不在忽略范围内，本次未强制暂存，请刷新后重新选择。');
  return selection;
}
