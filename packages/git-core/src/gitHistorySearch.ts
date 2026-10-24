import { realpath } from 'node:fs/promises';
import { GitHistoryReader, gitHistoryFieldConsumer } from './gitFileHistory.js';
import type { GitRecentCommit } from './index.js';

export type GitHistorySearchField = 'all' | 'message' | 'author' | 'hash';
export interface GitHistorySearchQuery { ref?: string; search?: string; field?: GitHistorySearchField; order?: 'topo' | 'date'; cursor?: string; limit?: number }
export interface GitHistorySearchCommit extends GitRecentCommit { searchMatch?: { field: Exclude<GitHistorySearchField, 'all'>; excerpt: string } }
export interface GitHistorySearchPage { commits: GitHistorySearchCommit[]; hasMore: boolean; nextCursor: string | null; scopeId: string }
export interface GitHistorySearchScope { root: string; revisions: string[]; replacements: string }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const fail = (code: string, message: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_HISTORY_QUERY_${code}`, operationStage: 'read' });
export function validateHistorySearch(query: GitHistorySearchQuery) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || (query.ref !== undefined && (typeof query.ref !== 'string' || !query.ref || query.ref.length > 4096 || query.ref.includes('\0'))) || (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 4096 || query.search.includes('\0'))) || (query.field !== undefined && !['all', 'message', 'author', 'hash'].includes(query.field)) || (query.order !== undefined && !['topo', 'date'].includes(query.order)) || (query.cursor !== undefined && (typeof query.cursor !== 'string' || !/^[0-9a-f-]{36}:\d{1,10}$/u.test(query.cursor))) || (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200))) throw fail('INVALID', '历史搜索范围或参数无效，请重新选择。');
  return { ref: query.ref, search: query.search?.trim().toLocaleLowerCase() ?? '', field: query.field ?? 'all', order: query.order ?? 'topo', limit: query.limit ?? 200 };
}

export async function captureHistorySearchScope(cwd: string, ref: string | undefined, runtime: Runtime): Promise<GitHistorySearchScope> {
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const replacements = await reader.text(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/replace']);
  if (ref !== undefined) { const revision = await reader.revision(ref); return { root: await realpath(cwd), revisions: revision ? [revision] : [], replacements }; }
  // Do not include refs/stash, notes or replacement refs in ordinary repository history.
  const rows = await reader.text(['for-each-ref', '--format=%(refname) %(objecttype) %(objectname) %(*objecttype) %(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  const revisions = new Set<string>();
  for (const line of rows.split('\n').filter(Boolean)) {
    const [name, type, object, peeledType, peeledObject] = line.split(' ');
    if (type === 'commit' && sha.test(object ?? '')) revisions.add(object!);
    else if (peeledType === 'commit' && sha.test(peeledObject ?? '')) revisions.add(peeledObject!);
    else if (type === 'tag' && peeledType === 'tag') {
      try { revisions.add(await reader.revision(name)); }
      catch (error) { if ((error as { code?: string }).code !== 'ASTRAGIT_GIT_FILE_HISTORY_REVISION_INVALID') throw error; }
    }
  }
  const head = await reader.revision(); if (head) revisions.add(head);
  return { root: await realpath(cwd), revisions: [...revisions].sort(), replacements };
}

/** Search immutable roots, stream all metadata, and stop after one extra match. */
export async function searchHistoryScope(cwd: string, scope: GitHistorySearchScope, query: GitHistorySearchQuery, offset: number, runtime: Runtime): Promise<{ commits: GitHistorySearchCommit[]; hasMore: boolean }> {
  const settings = validateHistorySearch(query);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_000 || scope.root !== await realpath(cwd) || scope.revisions.some(item => !sha.test(item))) throw fail('INVALID', '历史范围或分页位置无效。');
  if (!scope.revisions.length) return { commits: [], hasMore: false };
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const checkReplacements = async () => { if (scope.replacements !== await reader.text(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/replace'])) throw fail('CHANGED', 'Git 替代对象已变化，请重新载入历史范围。'); };
  await checkReplacements();
  const commits: GitHistorySearchCommit[] = []; const fields: string[] = []; let matched = 0; let retained = 0;
  const complete = Symbol('history-page-complete');
  const parser = gitHistoryFieldConsumer(field => {
    if (!fields.length && !field) return;
    fields.push(field);
    if (fields.length !== 6) return;
    const [hash, parents, author, authoredAt, subject, message] = fields as [string, string, string, string, string, string]; fields.length = 0;
    if (!sha.test(hash) || parents.split(' ').filter(Boolean).some(parent => !sha.test(parent))) throw fail('FAILED', 'Git 返回的历史记录不完整。');
    const candidates = [['message', message], ['author', author], ['hash', hash]] as const;
    const match = settings.search ? candidates.find(([kind, value]) => (settings.field === 'all' || settings.field === kind) && value.toLocaleLowerCase().includes(settings.search)) : undefined;
    if (settings.search && !match) return;
    if (settings.search && matched++ < offset) return;
    if (commits.length === settings.limit) throw complete;
    const position = match ? match[1].toLocaleLowerCase().indexOf(settings.search) : 0;
    const excerpt = match ? `${position > 50 ? '…' : ''}${match[1].slice(Math.max(0, position - 50), Math.max(0, position - 50) + 200).replace(/\s+/gu, ' ')}` : '';
    const commit: GitHistorySearchCommit = { hash, shortHash: hash.slice(0, 8), parentHashes: parents.split(' ').filter(Boolean), author, authoredAt, subject, ...(match ? { searchMatch: { field: match[0], excerpt } } : {}) };
    retained += Buffer.byteLength(JSON.stringify(commit)); if (retained > 8 * 1024 * 1024) throw fail('TOO_LARGE', '本页提交元数据过大，请缩小范围。');
    commits.push(commit);
  });
  let hasMore = false;
  try {
    await reader.run(['log', '-z', settings.order === 'date' ? '--date-order' : '--topo-order', '--no-show-signature', '--no-notes', '--no-patch', '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%B%x00', ...(!settings.search ? [`--skip=${offset}`, `--max-count=${settings.limit + 1}`] : []), '--stdin'], scope.revisions.join('\n') + '\n', parser.consume);
    parser.finish(); if (fields.length) throw fail('FAILED', 'Git 返回了不完整的历史记录。');
  } catch (error) {
    if (error === complete) hasMore = true; else throw error;
  }
  await checkReplacements();
  return { commits, hasMore };
}
