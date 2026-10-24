import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import type { GitRepositoryContext, GitStatusSummary, GitWorktreeEntry } from './index.js';

type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const failure = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message), { code, operationStage: 'read', ...(cause ? { cause } : {}) });
const removeOutputNewline = (text: string) => text.replace(/\r?\n$/u, '');

function stateFailure(error: unknown, runtime: Runtime) {
  if (runtime.signal?.aborted || (error as { code?: string }).code === 'ASTRAGIT_CANCELLED') return error;
  const value = error as { code?: string; details?: string; stderr?: string; message?: string };
  if (value.code?.startsWith('ASTRAGIT_GIT_STATE_') || value.code === 'ASTRAGIT_GIT_INDEX_CORRUPT') return error;
  const detail = value.stderr ?? value.details ?? value.message ?? '';
  if (/index file (?:smaller than expected|corrupt)|(?:bad|invalid) (?:index|signature)|index.*signature/u.test(detail)) return failure('ASTRAGIT_GIT_INDEX_CORRUPT', '无法读取 Git 暂存区，索引可能已损坏。请保留工作区文件并检查 Git 详情。', error);
  if (value.code === 'ASTRAGIT_GIT_FILE_HISTORY_TOO_LARGE') return failure('ASTRAGIT_GIT_STATE_TOO_LARGE', 'Git 状态或引用清单超过读取范围，未返回不完整的仓库状态。', error);
  if (value.code === 'ASTRAGIT_GIT_FILE_HISTORY_TIMEOUT') return failure('ASTRAGIT_GIT_STATE_TIMEOUT', '读取 Git 仓库状态超时，请重新载入。', error);
  if (value.code === 'EACCES' || value.code === 'EPERM' || /Permission denied|Operation not permitted/u.test(detail)) return failure('ASTRAGIT_GIT_STATE_ACCESS_DENIED', '无法访问仓库目录或 Git 元数据，请检查访问权限。', error);
  if (/detected dubious ownership in repository/u.test(detail)) return failure('ASTRAGIT_GIT_STATE_OWNERSHIP', 'Git 拒绝读取此仓库的所有权，请先核对目录归属与 Git 详情。', error);
  if (value.code === 'ENOENT') return failure('ASTRAGIT_GIT_EXECUTABLE_MISSING', '找不到 Git 程序，请检查安装和程序路径。', error);
  return failure('ASTRAGIT_GIT_STATE_READ_FAILED', '无法完整读取仓库状态、分支或引用，请重新载入并检查 Git 详情。', error);
}

function decode(bytes: Buffer) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) { throw failure('ASTRAGIT_GIT_STATE_ENCODING', '仓库路径、引用或提交元数据不是有效 UTF-8，无法完整显示。', error); }
}

async function text(reader: GitHistoryReader, args: string[], missingExit = false) {
  try { return decode(await reader.run(args)); }
  catch (error) {
    if (missingExit && (error as { exitCode?: number }).exitCode === 1) return '';
    throw stateFailure(error, reader.runtime);
  }
}

/** False is reserved for an existing ordinary folder or a bare repository. */
async function repositoryReader(cwd: string, runtime: Runtime) {
  runtime.signal?.throwIfAborted();
  let directory: string;
  try {
    directory = await realpath(cwd);
    if (!(await lstat(directory)).isDirectory()) throw failure('ASTRAGIT_GIT_STATE_LOCATION', '所选仓库位置不是目录，请重新选择。');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') throw failure('ASTRAGIT_GIT_STATE_LOCATION', '仓库目录已移动或不存在，请重新选择实际目录。', error);
    throw stateFailure(error, runtime);
  }
  let reader = new GitHistoryReader(directory, runtime);
  let root: string;
  try { root = removeOutputNewline(decode(await reader.run(['rev-parse', '--show-toplevel']))); }
  catch (error) {
    const candidate = error as { exitCode?: number; stderr?: string };
    if (candidate.exitCode === 128 && /^fatal: (?:not a git repository \(or any of the parent directories\)|this operation must be run in a work tree)/mu.test(candidate.stderr ?? '')) return null;
    throw stateFailure(error, runtime);
  }
  if (!isAbsolute(root)) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git 未返回完整的仓库根目录。');
  reader = new GitHistoryReader(root, runtime);
  return reader;
}

async function identity(reader: GitHistoryReader) {
  const [symbolic, head] = await Promise.all([
    text(reader, ['symbolic-ref', '--quiet', 'HEAD'], true),
    text(reader, ['rev-parse', '--verify', '--quiet', 'HEAD'], true),
  ]);
  const ref = removeOutputNewline(symbolic);
  if (ref && !ref.startsWith('refs/heads/')) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', '当前 HEAD 没有指向本地分支，请检查 Git 详情。');
  const branch = ref ? ref.slice('refs/heads/'.length) : '';
  const headSha = head.trim();
  if (headSha) {
    if (!shaPattern.test(headSha)) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git 未返回有效的当前提交。');
    await text(reader, ['cat-file', '-e', `${headSha}^{commit}`]);
  } else {
    if (!branch) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', '当前 HEAD 无法解析为提交或尚未创建的本地分支。');
    const path = removeOutputNewline(await text(reader, ['rev-parse', '--git-path', ref]));
    const entry = await lstat(resolve(reader.cwd, path)).catch(error => { if (error.code === 'ENOENT') return null; throw stateFailure(error, reader.runtime); });
    if (entry) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', '当前分支引用存在但无法读取，不能当作尚无提交的新仓库。');
  }
  return { branch: branch || 'detached', detached: !branch, headSha };
}

function worktrees(output: string): GitWorktreeEntry[] {
  if (output && !output.endsWith('\0')) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git worktree 清单不完整，请重新载入。');
  const entries: GitWorktreeEntry[] = []; let current: GitWorktreeEntry | null = null;
  const finish = () => {
    if (!current) return;
    if (!isAbsolute(current.path) || (!current.bare && !shaPattern.test(current.headSha))) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git worktree 身份不完整，请检查工作区元数据。');
    entries.push(current); current = null;
  };
  for (const field of output.split('\0')) {
    if (!field) { finish(); continue; }
    if (field.startsWith('worktree ')) { finish(); current = { path: field.slice(9), headSha: '', branch: null, bare: false, detached: false, locked: false, prunable: false }; }
    else if (!current) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git worktree 记录缺少所属目录。');
    else if (field.startsWith('HEAD ')) current.headSha = field.slice(5);
    else if (field.startsWith('branch refs/heads/')) current.branch = field.slice(18);
    else if (field === 'bare') current.bare = true;
    else if (field === 'detached') current.detached = true;
    else if (field === 'locked' || field.startsWith('locked ')) current.locked = true;
    else if (field === 'prunable' || field.startsWith('prunable ')) current.prunable = true;
  }
  finish();
  return entries;
}

export async function readRepositoryContext(cwd: string, runtime: Runtime): Promise<GitRepositoryContext> {
  const reader = await repositoryReader(cwd, runtime);
  if (!reader) return { isRepository: false, topLevel: '', branch: '', detached: false, headSha: '', localBranches: [], remoteBranches: [], remotes: [], worktrees: [] };
  const [current, local, remote, remotes, worktreeList] = await Promise.all([
    identity(reader),
    text(reader, ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']),
    text(reader, ['for-each-ref', '--format=%(refname:lstrip=2)%09%(symref)', 'refs/remotes']),
    text(reader, ['remote']),
    text(reader, ['worktree', 'list', '--porcelain', '-z']),
  ]);
  return { isRepository: true, topLevel: reader.cwd, ...current,
    localBranches: local.split('\n').filter(Boolean),
    remoteBranches: remote.split('\n').filter(Boolean).flatMap(line => { const [ref, symbolic] = line.split('\t'); return ref && !(symbolic && ref.endsWith('/HEAD')) ? [ref] : []; }),
    remotes: remotes.split('\n').filter(Boolean), worktrees: worktrees(worktreeList),
  };
}

export async function readRepositoryStatus(cwd: string, runtime: Runtime) {
  const reader = await repositoryReader(cwd, runtime);
  if (!reader) return null;
  const current = await identity(reader);
  const [porcelain, remotes, recent] = await Promise.all([
    text(reader, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
    text(reader, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    current.headSha ? text(reader, ['log', '-n', '5', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P', current.headSha]) : Promise.resolve(''),
  ]);
  return { branch: current.branch, porcelain, remoteBranches: remotes.split('\n').filter(Boolean) satisfies GitStatusSummary['remoteBranches'], recent };
}

export async function readRepositoryClean(cwd: string, ignoredPaths: string[], runtime: Runtime): Promise<boolean> {
  const reader = await repositoryReader(cwd, runtime);
  if (!reader) throw failure('ASTRAGIT_GIT_STATE_READ_FAILED', 'Git 工作区已不可用，无法确认是否干净。');
  // Only these internally built exclusion pathspecs enable Git's pathspec syntax.
  const pathspecs = ['.', ...ignoredPaths.map(path => `:(exclude,literal)${path}`)];
  return (await text(reader, ['--no-literal-pathspecs', 'status', '--porcelain=v1', '-z', '-uall', '--ignore-submodules=none', '--', ...pathspecs])).length === 0;
}
