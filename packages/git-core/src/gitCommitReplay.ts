import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import { getProjectGitCommitDetail, getProjectGitRevisionsDiff, parseGitPorcelainStatus, type GitRepositoryContext } from './index.js';

export interface GitCommitReplayInput {
  kind: 'cherry_pick' | 'revert';
  revision: string;
  mainline?: number;
  commit: boolean;
  includeSourceId: boolean;
}
export interface GitCommitReplayPreview {
  input: GitCommitReplayInput;
  sourceSha: string;
  sourceSubject: string;
  parents: Array<{ number: number; hash: string; subject: string }>;
  comparisonParent: string | null;
  headSha: string;
  branch: string;
  detached: boolean;
  fingerprint: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  fileCount: number;
  localChanges: string[];
  localChangeCount: number;
  stagedFileCount: number;
}
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; includeAllFiles?: boolean };
const failure = (code: string, message: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_REPLAY_${code}`, operationStage: 'preflight', operationStatus: 'failed_before_write' });

export function parseGitCommitReplayInput(input: unknown): GitCommitReplayInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('INVALID', '提交整合选项无效。');
  const value = input as Record<string, unknown>;
  const { kind, revision, mainline } = value; const commit = value.commit === undefined ? true : value.commit; const includeSourceId = value.includeSourceId === undefined ? false : value.includeSourceId;
  if (Object.keys(value).some(key => !['kind', 'revision', 'mainline', 'commit', 'includeSourceId'].includes(key)) || (kind !== 'cherry_pick' && kind !== 'revert') || typeof revision !== 'string' || !revision || revision.length > 4096 || revision.includes('\0') || typeof commit !== 'boolean' || typeof includeSourceId !== 'boolean' || (mainline !== undefined && (!Number.isSafeInteger(mainline) || (mainline as number) < 1)) || (includeSourceId && (kind !== 'cherry_pick' || !commit))) throw failure('INVALID', '请核对提交版本、父级来源和提交选项。');
  return { kind, revision, ...(mainline !== undefined ? { mainline: mainline as number } : {}), commit, includeSourceId };
}

function safePath(path: string) {
  const normalized = path.replace(/\/$/u, '');
  if (!normalized || isAbsolute(normalized) || normalized.includes('\0') || normalized.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw failure('INVALID', '整合文件清单含有无效路径。');
  return normalized;
}

/** Read only the replay's affected files and existing tracked edits; never follow symlink ancestors. */
async function fileIdentity(cwd: string, path: string, signal?: AbortSignal) {
  const parts = safePath(path).split('/'); const hash = createHash('sha256'); let relative = '';
  for (const [index, part] of parts.entries()) {
    signal?.throwIfAborted(); relative = relative ? `${relative}/${part}` : part; const absolute = join(cwd, relative);
    const before = await lstat(absolute).catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; });
    hash.update(JSON.stringify([relative, before ? [before.dev, before.ino, before.mode, before.size, before.mtimeMs, before.ctimeMs] : null]));
    if (!before) break;
    if (before.isSymbolicLink()) hash.update(await readlink(absolute));
    if (index < parts.length - 1 && before.isDirectory()) continue;
    if (before.isFile()) for await (const chunk of createReadStream(absolute, { signal })) hash.update(chunk as Buffer);
    const after = await lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!after || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure('PREVIEW_CHANGED', '读取期间文件已变化，请重新核对整合范围。');
    break;
  }
  return hash.digest('hex');
}

export async function readGitCommitReplayPreview(cwd: string, input: unknown, context: GitRepositoryContext, integrationState: string | null, runtime: Runtime): Promise<GitCommitReplayPreview> {
  const options = parseGitCommitReplayInput(input); const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  if (integrationState) throw failure('IN_PROGRESS', '当前提交整合尚未结束，请先继续或终止现有整合。');
  const [detail, index, flags, status, config, gitDirectory, replacements] = await Promise.all([
    getProjectGitCommitDetail(cwd, options.revision), reader.text(['ls-files', '--stage', '-z']), reader.text(['ls-files', '-v', '-z']),
    reader.text(['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none']),
    reader.text(['config', '--null', '--show-origin', '--show-scope', '--list']), reader.text(['rev-parse', '--absolute-git-dir']), reader.text(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/replace']),
  ]);
  const local = parseGitPorcelainStatus(status);
  if (local.conflictFiles.length) throw Object.assign(failure('CONFLICTED', '当前已有未解决冲突，请先处理冲突再开始拣选或反向提交。'), { affectedFiles: local.conflictFiles.slice(0, 200), affectedFileCount: local.conflictFiles.length });
  if (options.commit && local.fileStatuses.some(file => file.indexStatus !== ' ' && file.indexStatus !== '?')) throw failure('INDEX_DIRTY', '立即提交要求暂存区与当前提交一致。请先提交或贮藏现有暂存内容，或选择不立即提交。');
  const parentNumber = options.mainline ?? (detail.parentHashes.length > 1 ? 1 : undefined);
  if (parentNumber !== undefined && parentNumber > detail.parentHashes.length) throw failure('PARENT_INVALID', '所选父级不属于该提交，请重新核对来源。');
  const parent = detail.parentHashes[(parentNumber ?? 1) - 1] ?? null;
  const normalized: GitCommitReplayInput = { kind: options.kind, revision: detail.commit.hash, ...(parentNumber !== undefined ? { mainline: parentNumber } : {}), commit: options.commit, includeSourceId: options.includeSourceId };
  const files = parent && parent !== detail.parentHashes[0] ? (await getProjectGitRevisionsDiff(cwd, [parent, detail.commit.hash], runtime.signal)).files : detail.files;
  const parents: GitCommitReplayPreview['parents'] = new Array(detail.parentHashes.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, parents.length) }, async () => {
    while (next < parents.length) { const position = next++; const hash = detail.parentHashes[position]!; parents[position] = { number: position + 1, hash, subject: (await reader.text(['show', '-s', '--format=%s', hash, '--'])).replace(/\r?\n$/u, '') }; }
  }));
  const fingerprint = createHash('sha256').update(JSON.stringify([cwd, gitDirectory, context.headSha, context.branch, context.detached, normalized, detail.parentHashes, index, flags, status, config, replacements]));
  const paths = [...new Set([...files.flatMap(file => [file.path, ...('originalPath' in file && typeof file.originalPath === 'string' ? [file.originalPath] : [])]), ...local.fileStatuses.filter(file => file.indexStatus !== '?').flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])])])].sort();
  for (const path of paths) fingerprint.update(JSON.stringify([path, await fileIdentity(cwd, path, runtime.signal)]));
  const [head, branch, currentReplacements] = await Promise.all([reader.text(['rev-parse', '--verify', '--quiet', 'HEAD']).catch(error => { if (error.exitCode === 1 && !context.headSha) return ''; throw error; }), reader.text(['symbolic-ref', '--quiet', 'HEAD']).catch(error => { if (error.exitCode === 1 && context.detached) return ''; throw error; }), reader.text(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/replace'])]);
  if (replacements !== currentReplacements || head.trim() !== context.headSha || (context.detached ? branch !== '' : branch.replace(/\r?\n$/u, '') !== `refs/heads/${context.branch}`)) throw failure('PREVIEW_CHANGED', '当前分支、提交或替代对象在读取期间变化，请重新核对。');
  const changed = [...new Set(local.fileStatuses.map(file => file.path))].sort();
  return {
    input: normalized, sourceSha: detail.commit.hash, sourceSubject: detail.commit.subject, parents, comparisonParent: parent,
    headSha: context.headSha, branch: context.branch, detached: context.detached, fingerprint: fingerprint.digest('hex'),
    files: (runtime.includeAllFiles ? files : files.slice(0, 200)).map(file => ({ path: file.path, additions: options.kind === 'revert' ? file.deletions : file.additions, deletions: options.kind === 'revert' ? file.additions : file.deletions })), fileCount: files.length,
    localChanges: changed.slice(0, 200), localChangeCount: changed.length, stagedFileCount: local.fileStatuses.filter(file => file.indexStatus !== ' ' && file.indexStatus !== '?').length,
  };
}

export function gitCommitReplayArguments(preview: GitCommitReplayPreview, explicitMainline?: number): string[] {
  if (preview.parents.length > 1 && explicitMainline === undefined) throw failure('PARENT_REQUIRED', '该提交有多个父级，请明确选择拣选或反向提交的来源。');
  const options = preview.input;
  return [options.kind === 'cherry_pick' ? 'cherry-pick' : 'revert', ...(options.commit ? ['--no-edit'] : ['--no-commit']), ...(options.mainline !== undefined ? ['--mainline', String(options.mainline)] : []), ...(options.includeSourceId ? ['-x'] : []), options.revision];
}

export function gitCommitReplayFailure(code: string, message: string) { return failure(code, message); }
