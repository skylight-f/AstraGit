import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { decodeGitQuotedPath } from './gitQuotedPath.js';
import { gitDiffReader, gitDisplayDiffOptions, gitDisplayDiffMetadataOptions, readGitDiffMetadata, readGitDisplayDiff, unavailableGitDiff } from './gitDiffReader.js';
import type { GitDiffSummary, GitRecentCommit } from './index.js';

export interface GitTrackedFileQuery { ref?: string; search?: string; offset?: number; limit?: number; expectedFingerprint?: string }
export interface GitTrackedFilePage { revision: string; paths: string[]; total: number; nextOffset: number | null; fingerprint: string }
export interface GitFileHistoryQuery { path: string; ref?: string; offset?: number; limit?: number; followRenames?: boolean }
export interface GitFileHistoryEntry extends GitRecentCommit { path: string; previousPath?: string; changeType: string }
export interface GitFileHistoryPage { path: string; historyPath: string; revision: string; items: GitFileHistoryEntry[]; nextOffset: number | null; unavailableReason?: 'no_commits' }
export interface GitFileRevisionQuery { path: string; ref?: string; workingTree?: boolean; withBlame?: boolean; includeDiff?: boolean; previousPath?: string; expectedFingerprint?: string }
export interface GitFileOriginLine { commitHash: string; shortHash: string; author: string; authorTime: number; subject: string; line: number; originalLine: number; filename: string; content: string }
export interface GitFileRevision {
  path: string; revision: string; workingTree: boolean; content: string | null; byteLength: number; fingerprint: string;
  lines: GitFileOriginLine[]; diff?: GitDiffSummary;
  unavailableReason?: 'missing' | 'directory' | 'symlink' | 'submodule' | 'binary' | 'too_large' | 'too_many_lines' | 'uncommitted_file' | 'no_commits';
}
interface Runtime { signal?: AbortSignal; env?: NodeJS.ProcessEnv; parseDiff(text: string): GitDiffSummary }
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const maximumTextBytes = 4 * 1024 * 1024;
const failure = (code: string, message: string, details?: string) => Object.assign(new Error(message), { code, operationStage: 'read', ...(details ? { details } : {}) });
const invalid = () => failure('ASTRAGIT_GIT_FILE_HISTORY_INVALID', '文件历史参数无效，请重新选择仓库内的文件和版本。');
function pathValue(path: string) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw invalid();
  return path;
}
function paging(value: { offset?: number; limit?: number }) {
  const offset = value.offset ?? 0; const limit = value.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid();
  return { offset, limit };
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function queryValues(query: { ref?: string; expectedFingerprint?: string; search?: string; followRenames?: boolean; workingTree?: boolean; withBlame?: boolean; includeDiff?: boolean }) {
  if ((query.ref !== undefined && typeof query.ref !== 'string') || (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 16_384)) || (query.expectedFingerprint !== undefined && (typeof query.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(query.expectedFingerprint)))) throw invalid();
  for (const flag of [query.followRenames, query.workingTree, query.withBlame, query.includeDiff]) if (flag !== undefined && typeof flag !== 'boolean') throw invalid();
}

/** All new history reads share cancellation, fixed locale and literal pathspecs.
 * Streaming consumers retain one token and one page, even after long rename chains.
 */
class Reader {
  constructor(readonly cwd: string, readonly runtime: Pick<Runtime, 'signal' | 'env'>, private readonly indexFile?: string) {}
  async run(args: string[], input?: string | Uint8Array, consume?: (bytes: Buffer) => void, maximum = 32 * 1024 * 1024, allowedExitCodes: readonly number[] = [0]): Promise<Buffer> {
    const { signal } = this.runtime; signal?.throwIfAborted();
    return new Promise((success, reject) => {
      const child = spawn('git', ['-c', 'core.quotePath=false', '-c', 'i18n.logOutputEncoding=UTF-8', '--literal-pathspecs', ...args], { cwd: this.cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: {
        ...process.env, ...this.runtime.env, GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: this.indexFile, GIT_NAMESPACE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C',
      } });
      const buffers: Buffer[] = []; let size = 0; let stderr = ''; let stopped: unknown;
      const stop = (error: unknown) => { stopped ??= error; try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already closed. */ } };
      const abort = () => stop(failure('ASTRAGIT_CANCELLED', '文件历史读取已取消。'));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const timer = setTimeout(() => stop(failure('ASTRAGIT_GIT_FILE_HISTORY_TIMEOUT', '读取文件历史超时，请缩小版本范围或稍后重试。')), 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (stopped) return;
        try { if (consume) consume(chunk); else { size += chunk.length; if (size > maximum) throw failure('ASTRAGIT_GIT_FILE_HISTORY_TOO_LARGE', '所选历史或文本过大，请缩小范围或使用外部工具查看。'); buffers.push(chunk); } }
        catch (error) { stop(error); }
      });
      child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length); });
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error); }); child.stdin.end(input);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.on('error', error => { cleanup(); reject(stopped ?? error); });
      child.on('close', code => { cleanup(); if (stopped) reject(stopped); else if (!allowedExitCodes.includes(code ?? -1)) reject(Object.assign(failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', '无法读取文件历史或归属，请查看 Git 详情。', stderr), { exitCode: code, stderr })); else success(Buffer.concat(buffers)); });
    });
  }
  async text(args: string[], input?: string | Uint8Array) { return (await this.run(args, input)).toString('utf8'); }
  async initialize() {
    const root = (await this.text(['rev-parse', '--show-toplevel'])).replace(/\r?\n$/u, '');
    if (await realpath(root) !== await realpath(this.cwd)) throw failure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选位置不是该 Git 仓库的根目录，请刷新仓库列表。');
  }
  async revision(ref = 'HEAD'): Promise<string> {
    if (!ref || ref.length > 4096 || ref.includes('\0')) throw invalid();
    try { const sha = (await this.text(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim(); if (!shaPattern.test(sha)) throw invalid(); return sha; }
    catch (error) { if ((error as { exitCode?: number }).exitCode === 1) { if (ref === 'HEAD') return ''; throw failure('ASTRAGIT_GIT_FILE_HISTORY_REVISION_INVALID', '所选版本不存在或不是提交，请重新选择。'); } throw error; }
  }
}

export { Reader as GitHistoryReader, nulConsumer as gitHistoryFieldConsumer };

function nulConsumer(accept: (field: string) => void) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); let pending = '';
  const push = (text: string) => {
    pending += text; let position: number;
    while ((position = pending.indexOf('\0')) >= 0) { const field = pending.slice(0, position); pending = pending.slice(position + 1); accept(field); }
    if (Buffer.byteLength(pending) > 2 * 1024 * 1024) throw failure('ASTRAGIT_GIT_FILE_HISTORY_TOO_LARGE', '某条提交元数据过大，无法完整读取该范围。');
  };
  const decode = (bytes?: Buffer) => { try { push(bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode()); } catch (error) { if (error instanceof TypeError) throw failure('ASTRAGIT_GIT_FILE_HISTORY_ENCODING', '该文件名或提交元数据不是有效的 UTF-8，无法在内置历史中显示。'); throw error; } };
  return { consume: (bytes: Buffer) => decode(bytes), finish: () => { decode(); if (pending.trim()) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', 'Git 返回了不完整的文件历史。'); } };
}

export async function readTrackedFiles(cwd: string, query: GitTrackedFileQuery, runtime: Runtime): Promise<GitTrackedFilePage> {
  queryValues(query);
  const { offset, limit } = paging(query); if (offset && !query.expectedFingerprint) throw invalid();
  const reader = new Reader(cwd, runtime); await reader.initialize(); const revision = await reader.revision(query.ref ?? 'HEAD');
  const search = query.search?.toLocaleLowerCase() ?? ''; let total = 0; const paths: string[] = [];
  const hash = createHash('sha256').update(JSON.stringify([await realpath(cwd), query.ref ? revision : 'index', revision, search]));
  const parser = nulConsumer(path => { if (!path) return; pathValue(path); hash.update(path + '\0'); if (!path.toLocaleLowerCase().includes(search)) return; if (total >= offset && paths.length < limit) paths.push(path); total++; });
  if (query.ref && revision) await reader.run(['ls-tree', '-r', '-z', '--name-only', '--full-tree', revision], undefined, parser.consume);
  else if (!query.ref) await reader.run(['ls-files', '-z', '--cached', '--deduplicate'], undefined, parser.consume);
  parser.finish();
  if (!query.ref && revision !== await reader.revision()) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '读取期间当前提交已变化，请重新载入文件列表。');
  const fingerprint = hash.digest('hex');
  if (query.expectedFingerprint && query.expectedFingerprint !== fingerprint) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '文件列表或筛选条件已变化，请从第一页重新读取。');
  return { revision, paths, total, nextOffset: offset + paths.length < total ? offset + paths.length : null, fingerprint };
}

/** No --skip: Git may skip rename tracking before applying that limit. */
export async function readFileHistory(cwd: string, query: GitFileHistoryQuery, runtime: Runtime): Promise<GitFileHistoryPage> {
  queryValues(query);
  const path = pathValue(query.path); const { offset, limit } = paging(query); if (offset && !query.ref) throw invalid();
  const reader = new Reader(cwd, runtime); await reader.initialize(); const revision = await reader.revision(query.ref ?? 'HEAD');
  if (!revision) return { path, historyPath: path, revision, items: [], nextOffset: null, unavailableReason: 'no_commits' };
  const beforeIndex = query.ref === undefined ? await reader.text(['ls-files', '--stage', '-z']) : '';
  const historyPath = query.ref === undefined ? await stagedRenameOrigin(reader, path, revision) ?? path : path;
  const items: GitFileHistoryEntry[] = []; let seen = 0; let trace = historyPath; let header: string[] = []; let current: GitRecentCommit | null = null;
  let changes: Array<{ status: string; path: string; originalPath?: string }> = []; let status = ''; let collected: string[] = [];
  const finishCommit = () => {
    if (!current) return;
    const change = changes.find(item => item.path === trace) ?? (changes.length === 0 && current.parentHashes.length > 1 ? { status: 'M', path: trace } : null);
    if (!change) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', '无法对应所选文件的历史路径，未返回不完整记录。');
    if (seen++ >= offset) items.push({ ...current, path: change.path, ...(change.originalPath ? { previousPath: change.originalPath } : {}), changeType: change.status[0]! });
    if (query.followRenames !== false && change.originalPath) trace = change.originalPath;
    current = null; changes = [];
  };
  const parser = nulConsumer(field => {
    if (status) {
      collected.push(pathValue(field));
      if (collected.length === (/^[RC]/u.test(status) ? 2 : 1)) { changes.push({ status, path: collected.at(-1)!, ...(collected.length === 2 ? { originalPath: collected[0]! } : {}) }); status = ''; collected = []; }
      return;
    }
    if (header.length) {
      header.push(field);
      if (header.length === 5) { const [hash, parents, author, authoredAt, subject] = header as [string, string, string, string, string]; current = { hash, shortHash: hash.slice(0, 8), parentHashes: parents.split(' ').filter(Boolean), author, authoredAt, subject }; header = []; }
      return;
    }
    const token = field.replace(/^\n+/u, '');
    if (!token) return;
    if (shaPattern.test(token)) { finishCommit(); header = [token]; return; }
    if (!current || !/^[AMDTRC][0-9]*$/u.test(token)) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', '无法完整解析 Git 文件历史。');
    status = token;
  });
  await reader.run(['log', '-z', ...(query.followRenames === false ? [] : ['--follow']), '--find-renames', '--no-ext-diff', '--no-textconv', '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00', '--name-status', `--max-count=${offset + limit + 1}`, revision, '--', historyPath], undefined, parser.consume);
  parser.finish(); if (status || header.length) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', 'Git 文件历史记录不完整。'); finishCommit();
  if (query.ref === undefined && (revision !== await reader.revision() || beforeIndex !== await reader.text(['ls-files', '--stage', '-z']))) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '读取期间当前提交或文件的暂存路径已变化，请重新载入。');
  return { path, historyPath, revision, items: items.slice(0, limit), nextOffset: items.length > limit ? offset + limit : null };
}

/** A staged rename is not in HEAD yet; attribute its contents against the old path. */
async function stagedRenameOrigin(reader: Reader, path: string, revision: string): Promise<string | null> {
  if (await reader.text(['ls-tree', '-z', revision, '--', path])) return null;
  const fields = (await reader.text(['diff', '--cached', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', revision])).split('\0');
  let index = 0; let origin: string | null = null;
  while (index < fields.length - 1) {
    const status = fields[index++]!;
    if (!/^[AMDTRCU][0-9]*$/u.test(status)) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', '无法完整读取暂存文件路径。');
    const previous = pathValue(fields[index++] ?? '');
    if (/^[RC]/u.test(status)) { const next = pathValue(fields[index++] ?? ''); if (status.startsWith('R') && next === path) origin = previous; }
  }
  return origin;
}

export function parseFileOrigins(text: string): GitFileOriginLine[] {
  const rows = text.split('\n'); const result: GitFileOriginLine[] = []; let index = 0;
  while (index < rows.length) {
    if (index === rows.length - 1 && !rows[index]) break;
    const header = /^([a-f0-9]{40}|[a-f0-9]{64}) (\d+) (\d+)(?: (\d+))?$/u.exec(rows[index++] ?? '');
    if (!header) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', 'Git 归属行不完整，请重新读取。');
    const metadata: Record<string, string> = {};
    while (index < rows.length && !rows[index]!.startsWith('\t')) { const line = rows[index++]!; const separator = line.indexOf(' '); if (separator > 0) metadata[line.slice(0, separator)] = line.slice(separator + 1); }
    const filename = decodeGitQuotedPath(metadata.filename ?? ''); if (!filename || !rows[index]?.startsWith('\t')) throw failure('ASTRAGIT_GIT_FILE_HISTORY_FAILED', 'Git 未返回完整文件归属。');
    result.push({ commitHash: header[1]!, shortHash: header[1]!.slice(0, 8), originalLine: Number(header[2]), line: Number(header[3]), filename: pathValue(filename), author: metadata.author ?? '', authorTime: Number(metadata['author-time'] ?? 0), subject: metadata.summary ?? '', content: rows[index++]!.slice(1) });
  }
  return result;
}

async function workingFile(cwd: string, path: string) {
  const segments = path.split('/');
  for (let index = 0; index < segments.length - 1; index++) {
    let entry; try { entry = await lstat(join(cwd, ...segments.slice(0, index + 1))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: Buffer.alloc(0), kind: 'missing' as const }; throw error; }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw failure('ASTRAGIT_GIT_FILE_HISTORY_INVALID', '文件的上级路径不是仓库内普通目录，无法读取工作区内容。');
  }
  let entry; try { entry = await lstat(join(cwd, path)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: Buffer.alloc(0), kind: 'missing' as const }; throw error; }
  if (entry.isSymbolicLink()) return { bytes: Buffer.from(await readlink(join(cwd, path))), kind: 'symlink' as const };
  if (!entry.isFile()) return { bytes: Buffer.alloc(0), kind: 'directory' as const };
  if (entry.size > maximumTextBytes) return { bytes: Buffer.alloc(0), kind: 'too_large' as const, size: entry.size };
  const handle = await open(join(cwd, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; if (size > maximumTextBytes) return { bytes: Buffer.alloc(0), kind: 'too_large' as const, size }; chunks.push(chunk as Buffer); }
    return { bytes: Buffer.concat(chunks), kind: 'file' as const };
  } finally { await handle.close(); }
}

export async function readFileRevision(cwd: string, query: GitFileRevisionQuery, runtime: Runtime): Promise<GitFileRevision> {
  queryValues(query);
  const path = pathValue(query.path); if (query.previousPath) pathValue(query.previousPath);
  const reader = new Reader(cwd, runtime); await reader.initialize(); const revision = await reader.revision(query.ref ?? 'HEAD');
  const workingTree = query.workingTree === true;
  let bytes: Buffer = Buffer.alloc(0); let byteLength = 0; let unavailableReason: GitFileRevision['unavailableReason']; let beforeIndex = ''; let workingKind = '';
  if (workingTree) {
    if (revision !== await reader.revision()) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '当前提交与所选工作区基点不一致，请重新读取。');
    beforeIndex = await reader.text(['ls-files', '--stage', '-z']);
    const file = await workingFile(cwd, path); bytes = file.bytes; byteLength = file.size ?? bytes.length; workingKind = file.kind;
    if (file.kind !== 'file') unavailableReason = file.kind;
  } else if (!revision) unavailableReason = 'no_commits';
  else {
    const tree = await reader.text(['ls-tree', '-z', revision, '--', path]); const separator = tree.indexOf('\t');
    if (!tree) unavailableReason = 'missing';
    else {
      if (separator < 0 || tree.slice(separator + 1, -1) !== path) throw invalid();
      const [mode, type, sha] = tree.slice(0, separator).split(' ');
      if (type === 'commit') unavailableReason = 'submodule'; else if (type === 'tree') unavailableReason = 'directory';
      else if (type !== 'blob' || !shaPattern.test(sha ?? '')) throw invalid();
      else { byteLength = Number((await reader.text(['cat-file', '-s', sha!])).trim()); if (byteLength > maximumTextBytes) unavailableReason = 'too_large'; else { bytes = await reader.run(['cat-file', 'blob', sha!], undefined, undefined, maximumTextBytes); if (mode === '120000') unavailableReason = 'symlink'; } }
    }
  }
  let content: string | null = null;
  if (!unavailableReason || unavailableReason === 'symlink') {
    try { if (bytes.includes(0)) throw new Error('binary'); content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { unavailableReason = 'binary'; }
    if (content !== null && content.split('\n').length > 100_001) { unavailableReason = 'too_many_lines'; content = null; }
  }
  const fingerprint = digest([await realpath(cwd), path, revision, workingTree, unavailableReason, createHash('sha256').update(bytes).digest('hex'), beforeIndex]);
  if (query.expectedFingerprint && query.expectedFingerprint !== fingerprint) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '文件版本或内容已变化，请重新读取后查看归属。');
  let lines: GitFileOriginLine[] = [];
  if (query.withBlame && !unavailableReason && content !== null) {
    const runBlame = (at: string | null, blamePath: string) => reader.text(['--no-pager', 'blame', '--line-porcelain', '--no-textconv', ...(workingTree ? ['--contents', '-'] : []), ...(at ? [at] : []), '--', blamePath], workingTree ? content! : undefined);
    const atPath = async (blamePath: string) => {
      try { return parseFileOrigins(await runBlame(revision, blamePath)); }
      catch (error) {
        if (!workingTree || !/cannot use --contents with final commit/iu.test((error as { stderr?: string }).stderr ?? '')) throw error;
        if (revision !== await reader.revision()) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '读取期间当前提交已变化，请重新读取。');
        return parseFileOrigins(await runBlame(null, blamePath));
      }
    };
    if (!revision) unavailableReason = 'no_commits';
    else {
      try { lines = await atPath(workingTree ? await stagedRenameOrigin(reader, path, revision) ?? path : path); }
      catch (error) {
        const diagnostic = (error as { stderr?: string }).stderr ?? '';
        if (workingTree && /no such path|no such file/iu.test(diagnostic)) {
          const origin = await stagedRenameOrigin(reader, path, revision);
          if (origin) lines = await atPath(origin); else unavailableReason = 'uncommitted_file';
        }
        else throw error;
      }
    }
    if (unavailableReason === 'no_commits' || unavailableReason === 'uncommitted_file') {
      const hashLength = revision.length || ((await reader.text(['rev-parse', '--show-object-format'])).trim() === 'sha256' ? 64 : 40);
      lines = (content ? content.replace(/\n$/u, '').split('\n') : []).map((line, index) => ({ line: index + 1, originalLine: index + 1, filename: path, content: line, commitHash: '0'.repeat(hashLength), shortHash: '00000000', author: '', authorTime: 0, subject: '' }));
    }
  }
  let diff: GitDiffSummary | undefined;
  if (query.includeDiff) diff = await fileRevisionDiff(cwd, path, revision, workingTree, workingKind, query.previousPath, reader, runtime);
  if (workingTree) {
    const after = await workingFile(cwd, path);
    if (revision !== await reader.revision() || beforeIndex !== await reader.text(['ls-files', '--stage', '-z']) || after.kind !== workingKind || !after.bytes.equals(bytes) || (after.size ?? after.bytes.length) !== byteLength) throw failure('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', '读取期间工作区、暂存区或当前提交已变化，请重新读取。');
  }
  return { path, revision, workingTree, content, byteLength, fingerprint, lines, ...(unavailableReason ? { unavailableReason } : {}), ...(diff ? { diff } : {}) };
}

/** Compare a working file with HEAD independently of the user's staging choices.
 * Only a private temporary index is written; blobs and the real index stay intact.
 */
async function fileRevisionDiff(cwd: string, path: string, revision: string, workingTree: boolean, workingKind: string, previousPath: string | undefined, reader: Reader, runtime: Runtime): Promise<GitDiffSummary> {
  const empty = (): GitDiffSummary => ({ isRepository: true, files: [], diffText: '', fileDiffs: [] });
  const paths = [...new Set([path, ...(previousPath ? [previousPath] : [])])];
  const displayReader = gitDiffReader(cwd, runtime);
  if (!workingTree) {
    if (!revision) return empty();
    const args = ['show', '--format=', '--root', '--diff-merges=first-parent', revision];
    const names = await readGitDiffMetadata(displayReader, [...args, ...gitDisplayDiffMetadataOptions, '--name-only', '-z', '--', ...paths]);
    const diff = await readGitDisplayDiff(displayReader, [...args, ...gitDisplayDiffOptions, '--', ...paths], names.split('\0').filter(Boolean));
    const parents = (await reader.text(['rev-list', '--parents', '-n', '1', revision])).trim().split(/\s+/u).slice(1);
    if (parents.length > 1) diff.comparisonParent = parents[0];
    return diff;
  }
  if (workingKind === 'directory') return unavailableGitDiff([path], 'unsupported_files');
  const atPath = async (name: string) => {
    if (!revision) return null;
    const entry = await reader.text(['ls-tree', '-z', revision, '--', name]);
    if (!entry) return null;
    const separator = entry.indexOf('\t');
    if (separator < 0 || entry.slice(separator + 1, -1) !== name) throw invalid();
    const [mode, type, sha] = entry.slice(0, separator).split(' ');
    if (!shaPattern.test(sha ?? '')) throw invalid();
    return { mode: mode!, type, sha: sha! };
  };
  const base = await atPath(path);
  const origin = !base && revision ? previousPath ?? await stagedRenameOrigin(reader, path, revision) : undefined;
  const old = origin ? await atPath(origin) : null;
  if (!base && !old) {
    if (workingKind === 'missing') return empty();
    return readGitDisplayDiff(displayReader, ['diff', ...gitDisplayDiffOptions, '--no-index', '--', '/dev/null', path], [path], true);
  }
  if ((base ?? old)?.type !== 'blob') return unavailableGitDiff([path], 'unsupported_files');
  const temporary = await mkdtemp(join(tmpdir(), 'astragit-file-revision-'));
  try {
    const isolated = gitDiffReader(cwd, runtime, join(temporary, 'index'));
    await isolated.run(['read-tree', revision]);
    if (!base && old && origin) {
      await isolated.run(['update-index', '--force-remove', '--', origin]);
      await isolated.run(['update-index', '--add', '--cacheinfo', old.mode, old.sha, path]);
      if (!paths.includes(origin)) paths.push(origin);
    }
    const names = await readGitDiffMetadata(isolated, ['diff', ...gitDisplayDiffMetadataOptions, '--name-only', '-z', revision, '--', ...paths]);
    return await readGitDisplayDiff(isolated, ['diff', ...gitDisplayDiffOptions, revision, '--', ...paths], names.split('\0').filter(Boolean));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
