import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { GitHistoryReader } from './gitFileHistory.js';

export type GitArchiveFormat = 'zip' | 'tar' | 'tar.gz';
export interface GitArchiveInput { revision: string; format: GitArchiveFormat; prefix: string }
export interface GitArchivePreview extends GitArchiveInput { commitHash: string; treeHash: string; subject: string; suggestedName: string }
export interface GitArchiveResult extends GitArchivePreview { byteLength: number; sha256: string }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
const failure = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_ARCHIVE_${code}`, operationStage: 'read', ...(cause ? { cause } : {}) });
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export function parseGitArchiveInput(input: unknown): GitArchiveInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('INVALID', '源码存档选项无效。');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['revision', 'format', 'prefix'].includes(key))) throw failure('INVALID', '源码存档含有不支持的选项。');
  const revision = value.revision ?? 'HEAD'; const format = value.format ?? 'zip'; let prefix = value.prefix ?? '';
  if (typeof revision !== 'string' || !revision || revision.length > 4096 || revision.includes('\0') || typeof format !== 'string' || !['zip', 'tar', 'tar.gz'].includes(format) || typeof prefix !== 'string' || prefix.length > 1024 || /[\0\r\n\\]/u.test(prefix) || prefix.startsWith('/') || /^[A-Za-z]:/u.test(prefix) || prefix.split('/').some(part => part === '.' || part === '..')) throw failure('INVALID', '请选择有效修订版本、归档格式和相对目录前缀。');
  if (prefix && !prefix.endsWith('/')) prefix += '/';
  return { revision, format: format as GitArchiveFormat, prefix };
}

export async function readGitArchivePreview(cwd: string, input: unknown, runtime: Runtime = {}): Promise<GitArchivePreview> {
  const options = parseGitArchiveInput(input); const reader = new GitHistoryReader(cwd, runtime);
  try {
    await reader.initialize(); const commitHash = await reader.revision(options.revision);
    if (!commitHash) throw failure('REVISION_INVALID', '仓库尚无提交，无法导出源码存档。');
    const treeHash = (await reader.text(['rev-parse', '--verify', '--end-of-options', `${commitHash}^{tree}`])).trim();
    if (!shaPattern.test(treeHash)) throw failure('READ_FAILED', '无法确认修订版本的文件快照。');
    const subject = (await reader.text(['show', '-s', '--format=%s', commitHash, '--'])).replace(/\r?\n$/u, '');
    const name = basename(cwd).replace(/[\0\r\n/\\]/gu, '-').slice(0, 100) || 'source';
    return { ...options, commitHash, treeHash, subject, suggestedName: `${name}-${commitHash.slice(0, 8)}.${options.format}` };
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (runtime.signal?.aborted || code === 'ASTRAGIT_CANCELLED' || code.startsWith('ASTRAGIT_GIT_ARCHIVE_')) throw error;
    if (code === 'ASTRAGIT_GIT_FILE_HISTORY_REVISION_INVALID') throw failure('REVISION_INVALID', '所选版本不存在或不是提交，请重新选择。', error);
    throw failure('READ_FAILED', '未能读取源码存档的修订版本，请查看 Git 详情。', error);
  }
}

/** Preserve native archive semantics and bytes; backpressure never buffers the whole repository. */
export async function writeGitArchive(cwd: string, input: unknown, destination: Writable, runtime: Runtime = {}): Promise<GitArchiveResult> {
  const preview = await readGitArchivePreview(cwd, input, runtime); const { signal } = runtime;
  signal?.throwIfAborted();
  const child = spawn('git', ['--literal-pathspecs', 'archive', `--format=${preview.format === 'zip' ? 'zip' : 'tar'}`, `--prefix=${preview.prefix}`, preview.commitHash, '--'], {
    cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...process.env, ...runtime.env, GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_NAMESPACE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C',
    },
  });
  let stderr = ''; let stopped: unknown; let byteLength = 0; const digest = createHash('sha256');
  const stop = (error: unknown) => {
    stopped ??= error;
    try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* The child may already be closed. */ }
  };
  const abort = () => stop(Object.assign(new Error('源码存档已取消。'), { code: 'ASTRAGIT_CANCELLED', operationStage: 'read' }));
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) { byteLength += chunk.length; digest.update(chunk); callback(null, chunk); } });
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', error => reject(stopped ?? failure('READ_FAILED', '无法启动源码存档，请检查 Git。', error)));
    child.once('close', code => {
      if (stopped) reject(stopped);
      else if (code !== 0) reject(failure('READ_FAILED', 'Git 未能完整生成源码存档。', Object.assign(new Error(stderr || `git archive exited ${code}`), { exitCode: code, stderr })));
      else resolve();
    });
  });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { if (stderr.length < 65536) stderr += chunk.slice(0, 65536 - stderr.length); });
  child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error); }); child.stdin.end();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(() => stop(failure('TIMEOUT', '源码存档超时，请稍后重试。')), 30 * 60_000);
  // Use Node gzip so a user-defined tar.<format>.command cannot replace the requested format.
  const pumping = preview.format === 'tar.gz' ? pipeline(child.stdout, createGzip(), counter, destination, { signal }) : pipeline(child.stdout, counter, destination, { signal });
  void pumping.catch(stop);
  try {
    const results = await Promise.allSettled([completed, pumping]);
    if (signal?.aborted) throw stopped ?? Object.assign(new Error('源码存档已取消。'), { code: 'ASTRAGIT_CANCELLED' });
    const error = results.find(result => result.status === 'rejected');
    if (error?.status === 'rejected') throw error.reason;
    return { ...preview, byteLength, sha256: digest.digest('hex') };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
