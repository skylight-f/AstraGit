import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readlink, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const maximumTextBytes = 2 * 1024 * 1024;
type Runner = (args: string[], index?: string) => Promise<{ stdout: string; stderr: string }>;
export interface ProjectGitConflictIndexStage { stage: 1 | 2 | 3; mode: string; oid: string }
export interface ProjectGitConflictFile {
  path: string;
  fingerprint: string;
  kind: 'text' | 'binary' | 'gitlink' | 'symlink' | 'too_large' | 'unsupported';
  editable: boolean;
  unsupportedReason: string | null;
  base: string | null;
  /** Git index stage 2；变基时不应推断它是变基前的用户分支。 */
  current: string | null;
  /** Git index stage 3。 */
  incoming: string | null;
  worktree: string | null;
  worktreeExists: boolean;
  indexStages: ProjectGitConflictIndexStage[];
  canAcceptCurrent: boolean;
  canAcceptIncoming: boolean;
  markerSize: number;
}
export interface SaveProjectGitConflictInput {
  path: string;
  expectedFingerprint: string;
  content?: string;
  acceptSide?: 'current' | 'incoming';
  /** false 只保存工作区；true 才将结果暂存。 */
  markResolved: boolean;
}
export interface ProjectGitConflictWriteResult {
  path: string;
  remainingConflictFiles: string[];
  conflict: ProjectGitConflictFile | null;
}
interface Runtime { run: Runner; signal?: AbortSignal; hasConflictMarkers: (content: string, markerSize: number) => boolean }
interface WorktreeFile {
  exists: boolean;
  text: string | null;
  kind: 'text' | 'binary' | 'symlink' | 'too_large' | 'unsupported';
  identity: string;
  mode: number;
}

function conflictError(code: string, message: string): Error & { code: string; operationStage: string; operationStatus: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code, operationStage: 'preflight', operationStatus: 'failed_before_write' });
}
function safePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0') || value.includes('\\') || isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw conflictError('ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE', '冲突文件路径无效，不能读取或写入仓库以外的位置。');
  return value;
}
function textFromBytes(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}

/** 不沿任一父目录或末端链接读取文件；缺失目录只在显式保存时逐层创建。 */
async function inspectParents(root: string, path: string, create = false): Promise<boolean> {
  let parent = root;
  for (const segment of path.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    let stat = await lstat(parent).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat && create) { await mkdir(parent, { mode: 0o755 }); stat = await lstat(parent); }
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw conflictError('ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE', '冲突文件的父目录包含链接或非目录路径，请在外部处理。');
    const actual = await realpath(parent);
    const fromRoot = relative(root, actual);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw conflictError('ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE', '冲突文件的真实父目录位于仓库之外，请在外部处理。');
  }
  return true;
}
async function worktreeFile(root: string, path: string): Promise<WorktreeFile> {
  if (!(await inspectParents(root, path))) return { exists: false, text: null, kind: 'text', identity: 'missing', mode: 0o644 };
  const absolute = resolve(root, path);
  const stat = await lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return { exists: false, text: null, kind: 'text', identity: 'missing', mode: 0o644 };
  const identity = `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if (stat.isSymbolicLink()) return { exists: true, text: null, kind: 'symlink', identity: `${identity}:${await readlink(absolute)}`, mode: stat.mode };
  if (!stat.isFile()) return { exists: true, text: null, kind: 'unsupported', identity, mode: stat.mode };
  if (stat.size > maximumTextBytes) return { exists: true, text: null, kind: 'too_large', identity, mode: stat.mode };
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件在读取时发生变化，请重新载入。');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件在读取时发生变化，请重新载入。');
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件在读取时发生变化，请重新载入。');
    const text = textFromBytes(bytes);
    return { exists: true, text, kind: text === null ? 'binary' : 'text', identity: `${identity}:${createHash('sha256').update(bytes).digest('hex')}`, mode: stat.mode };
  } finally { await handle.close(); }
}

async function readStages(path: string, run: Runner): Promise<ProjectGitConflictIndexStage[]> {
  const output = (await run(['--literal-pathspecs', 'ls-files', '--unmerged', '--stage', '-z', '--', path])).stdout;
  const stages = output.split('\0').filter(Boolean).map(record => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) ([123])\t([\s\S]+)$/u.exec(record);
    if (!match || match[4] !== path) throw conflictError('ASTRAGIT_GIT_CONFLICT_READ_FAILED', '无法核对 Git 索引中的冲突条目，请刷新后重试。');
    return { mode: match[1]!, oid: match[2]!, stage: Number(match[3]) as 1 | 2 | 3 };
  });
  if (!stages.length) throw conflictError('ASTRAGIT_GIT_CONFLICT_NOT_FOUND', '该文件已不处于未解决冲突状态，请刷新仓库。');
  return stages;
}
async function optionalRef(run: Runner, ref: string): Promise<string> {
  try { return (await run(['rev-parse', '--verify', '--quiet', ref])).stdout.trim(); }
  catch (error) { if ((error as { exitCode?: number }).exitCode === 1) return ''; throw error; }
}
async function markerSize(path: string, run: Runner): Promise<number> {
  const raw = (await run(['--literal-pathspecs', 'check-attr', '-z', 'conflict-marker-size', '--', path])).stdout.split('\0')[2] ?? '';
  const value = Number(raw); return Number.isSafeInteger(value) && value > 0 && value <= 1024 ? value : 7;
}

async function loadConflict(root: string, path: string, runtime: Runtime): Promise<{ file: ProjectGitConflictFile; workspace: WorktreeFile }> {
  runtime.signal?.throwIfAborted();
  const stages = await readStages(path, runtime.run);
  const workspace = await worktreeFile(root, path);
  const [head, mergeHead, rebaseHead, markers] = await Promise.all([optionalRef(runtime.run, 'HEAD'), optionalRef(runtime.run, 'MERGE_HEAD'), optionalRef(runtime.run, 'REBASE_HEAD'), markerSize(path, runtime.run)]);
  let kind: ProjectGitConflictFile['kind'] = stages.some(stage => stage.mode === '160000') ? 'gitlink' : stages.some(stage => stage.mode === '120000') ? 'symlink' : workspace.kind;
  const texts = new Map<number, string | null>();
  if (kind === 'text') {
    for (const stage of stages) {
      const size = Number((await runtime.run(['cat-file', '-s', stage.oid])).stdout.trim());
      if (!Number.isSafeInteger(size) || size < 0) throw conflictError('ASTRAGIT_GIT_CONFLICT_READ_FAILED', '无法读取冲突版本的文件大小。');
      if (size > maximumTextBytes) { kind = 'too_large'; break; }
      const result = await execute('git', ['cat-file', 'blob', stage.oid], { cwd: root, encoding: 'buffer', maxBuffer: maximumTextBytes + 1, timeout: 30_000, signal: runtime.signal, env: { ...process.env, LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } });
      const text = textFromBytes(result.stdout);
      if (text === null) { kind = 'binary'; break; }
      texts.set(stage.stage, text);
    }
  }
  // 同次读取中发生外部索引修改时不返回混合快照。
  if (JSON.stringify(stages) !== JSON.stringify(await readStages(path, runtime.run))) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突索引在读取时发生变化，请重新载入。');
  const editable = kind === 'text';
  const stageContentHashes = [...texts].map(([stage, text]) => [stage, text === null ? null : createHash('sha256').update(text).digest('hex')]);
  const fingerprint = createHash('sha256').update(JSON.stringify({ root, path, stages, stageContentHashes, head, mergeHead, rebaseHead, markers, worktree: workspace.identity })).digest('hex');
  const unsupportedReason = editable ? null : kind === 'gitlink' ? '子模块冲突不能作为文本编辑，请在外部选择并暂存正确的子模块提交。' : kind === 'symlink' ? '符号链接冲突不支持文本编辑，请在外部处理并暂存。' : kind === 'too_large' ? '文件超过内置冲突编辑器的大小限制，请在外部处理并暂存。' : kind === 'binary' ? '二进制或非 UTF-8 文件不能在文本冲突编辑器中保存，请在外部处理并暂存。' : '该路径不是普通文件，不能在文本冲突编辑器中保存。';
  return { file: { path, fingerprint, kind, editable, unsupportedReason, base: texts.get(1) ?? null, current: texts.get(2) ?? null, incoming: texts.get(3) ?? null, worktree: editable ? workspace.text : null, worktreeExists: workspace.exists, indexStages: stages, canAcceptCurrent: editable, canAcceptIncoming: editable, markerSize: markers }, workspace };
}

export async function readProjectConflict(cwd: string, path: string, runtime: Runtime): Promise<ProjectGitConflictFile> {
  const root = await realpath(cwd);
  return (await loadConflict(root, safePath(path), runtime)).file;
}

/** 保存时持有真实 Git 索引锁；暂存只修改锁索引，成功后才替换真实索引。 */
export async function saveProjectConflict(cwd: string, input: SaveProjectGitConflictInput, runtime: Runtime): Promise<ProjectGitConflictWriteResult> {
  const path = safePath(input.path);
  if (!/^[a-f0-9]{64}$/u.test(input.expectedFingerprint) || typeof input.markResolved !== 'boolean' || (input.acceptSide !== undefined && input.acceptSide !== 'current' && input.acceptSide !== 'incoming') || (input.acceptSide === undefined ? typeof input.content !== 'string' : input.content !== undefined)) throw conflictError('ASTRAGIT_GIT_CONFLICT_INPUT_INVALID', '冲突保存参数无效，请重新载入后重试。');
  const root = await realpath(cwd);
  const indexPath = (await runtime.run(['rev-parse', '--path-format=absolute', '--git-path', 'index'])).stdout.trim();
  const lockPath = `${indexPath}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => { if (error.code === 'EEXIST') throw conflictError('ASTRAGIT_GIT_INDEX_LOCKED', '仓库索引被其他 Git 操作锁定，请等待完成后重试。'); throw error; });
  let ownsLock = true; let changed = false; let temporary: string | null = null;
  try {
    const current = await loadConflict(root, path, runtime);
    if (current.file.fingerprint !== input.expectedFingerprint) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件、分支或索引已变化，草稿未写入。请重新载入并核对。');
    if (!current.file.editable) throw conflictError('ASTRAGIT_GIT_CONFLICT_TEXT_UNSUPPORTED', current.file.unsupportedReason!);
    const content = input.acceptSide ? current.file[input.acceptSide] : input.content!;
    if (content !== null && (Buffer.byteLength(content, 'utf8') > maximumTextBytes || content.includes('\0') || Buffer.from(content).toString('utf8') !== content)) throw conflictError('ASTRAGIT_GIT_CONFLICT_CONTENT_INVALID', '冲突结果必须是大小限制内的有效 UTF-8 文本。');
    if (input.markResolved && content !== null && runtime.hasConflictMarkers(content, current.file.markerSize)) throw conflictError('ASTRAGIT_GIT_CONFLICT_MARKERS_REMAIN', '结果中仍存在冲突标记，请处理完所有冲突后再标记已解决。');
    runtime.signal?.throwIfAborted();
    await inspectParents(root, path, content !== null);
    // 父目录和工作区再核对一次，避免读取后被外部编辑器或链接替换。
    if ((await worktreeFile(root, path)).identity !== current.workspace.identity) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件在保存前发生变化，草稿未写入。请重新载入。');
    if (content === null) { await rm(resolve(root, path), { force: true }); changed = true; }
    else {
      temporary = join(dirname(resolve(root, path)), `.astragit-conflict-${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', current.workspace.mode & 0o777);
      try { await file.writeFile(content, 'utf8'); } finally { await file.close(); }
      await inspectParents(root, path);
      if ((await worktreeFile(root, path)).identity !== current.workspace.identity) throw conflictError('ASTRAGIT_GIT_CONFLICT_STALE', '冲突文件在保存前发生变化，草稿未写入。请重新载入。');
      await rename(temporary, resolve(root, path)); temporary = null; changed = true;
    }
    if (input.markResolved) {
      await copyFile(indexPath, lockPath);
      await runtime.run(['--literal-pathspecs', 'add', '-A', '--', path], lockPath);
      await rename(lockPath, indexPath); ownsLock = false;
    }
    const remainingConflictFiles = (await runtime.run(['diff', '--name-only', '--diff-filter=U', '-z'])).stdout.split('\0').filter(Boolean);
    return { path, remainingConflictFiles, conflict: input.markResolved ? null : (await loadConflict(root, path, runtime)).file };
  } catch (error) {
    if (changed && error instanceof Error) Object.assign(error, { operationStage: 'conflict_save', operationStatus: 'unknown_after_write' });
    throw error;
  } finally {
    await lock.close();
    if (ownsLock) await rm(lockPath, { force: true });
    await rm(`${lockPath}.lock`, { force: true });
    if (temporary) await rm(temporary, { force: true });
  }
}
