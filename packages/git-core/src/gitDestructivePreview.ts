import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseGitPorcelainStatus } from './index.js';

export type GitResetMode = 'soft' | 'mixed' | 'hard';
export interface GitWritePreview {
  fingerprint: string;
  mode: GitResetMode;
  headSha: string;
  branch: string;
  detached: boolean;
  targetSha: string;
  targetSubject: string;
  integrationState: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' | null;
  currentIntegrationCommit: string;
  integrationStepFingerprint: string;
  changedFiles: string[];
  changedFileCount: number;
  untrackedObstacles: string[];
  untrackedObstacleCount: number;
  nestedRepositories: Array<{ path: string; effect: 'worktree' | 'directory' }>;
  nestedRepositoryCount: number;
  trackedFileCount: number;
  conflictFileCount: number;
}
type Run = (args: string[]) => Promise<{ stdout: string; stderr: string }>;
type Identity = Pick<GitWritePreview, 'headSha' | 'branch' | 'detached' | 'targetSha' | 'integrationState'>;

const invalidPath = () => Object.assign(new Error('Git 文件路径无效，无法计算重置范围。'), { code: 'ASTRAGIT_GIT_RESET_PATH_INVALID', operationStatus: 'failed_before_write' });
function safePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw invalidPath();
  return path;
}
function treePaths(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of text.split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw invalidPath();
    result.set(safePath(entry.slice(separator + 1)), entry.slice(0, separator).split(' ')[0]!);
  }
  return result;
}
async function info(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Read commands and filesystem inspection only; no reset or temporary index. */
export async function readGitWritePreview(cwd: string, identity: Identity, mode: GitResetMode, run: Run, signal?: AbortSignal, additionalTargets: Array<{ path: string; mode: string }> = []): Promise<GitWritePreview> {
  signal?.throwIfAborted();
  const [index, flags, tree, status, gitDirectory, subject] = await Promise.all([
    run(['ls-files', '--stage', '-z']), run(['ls-files', '-v', '-z']),
    identity.targetSha ? run(['ls-tree', '-r', '-z', identity.targetSha]) : Promise.resolve({ stdout: '', stderr: '' }),
    run(['status', '--porcelain', '-z', '--untracked-files=all']),
    run(['rev-parse', '--absolute-git-dir']), identity.targetSha ? run(['show', '-s', '--format=%s', identity.targetSha]) : Promise.resolve({ stdout: '', stderr: '' }),
  ]);
  const indexPaths = treePaths(index.stdout); const targetPaths = treePaths(tree.stdout);
  for (const entry of additionalTargets) {
    const path = safePath(entry.path);
    if (!/^(?:100644|100755|120000|160000)$/u.test(entry.mode)) throw invalidPath();
    // A non-gitlink representation can replace a directory during replay.
    if (!targetPaths.has(path) || entry.mode !== '160000') targetPaths.set(path, entry.mode);
  }
  const statusFiles = parseGitPorcelainStatus(status.stdout).fileStatuses;
  const hash = createHash('sha256').update(JSON.stringify([identity, mode, index.stdout, flags.stdout, tree.stdout, additionalTargets, statusFiles.filter(file => file.indexStatus !== '?')]));
  const gitRoot = gitDirectory.stdout.replace(/\r?\n$/u, '');
  const signatures = new Map<string, string>(); const recursive = new Set<string>();
  const obstacles = new Set<string>(); const nested = new Map<string, 'worktree' | 'directory'>();
  const tracked = new Set(indexPaths.keys());
  const rememberNested = async (path: string, effect: 'worktree' | 'directory') => {
    if (path.split('/').some(part => part.toLowerCase() === '.git')) return;
    const directory = join(cwd, path);
    const marker = await info(join(directory, '.git'));
    const bare = !marker && await info(join(directory, 'HEAD')) && await info(join(directory, 'objects'));
    if (marker || bare) nested.set(path, nested.get(path) === 'directory' ? 'directory' : effect);
  };
  const capture = async (path: string, absolute: string, descend: boolean, metadata: boolean): Promise<void> => {
    signal?.throwIfAborted();
    const entry = await info(absolute);
    if (!entry) { signatures.set(path, 'missing'); return; }
    const digest = createHash('sha256').update(String(entry.mode));
    if (metadata) digest.update(`\0${entry.dev}:${entry.ino}:${entry.mtimeMs}:${entry.birthtimeMs}`);
    if (entry.isSymbolicLink()) digest.update('symlink\0').update(await readlink(absolute));
    else if (entry.isFile()) {
      digest.update(`file\0${entry.size}\0`);
      for await (const chunk of createReadStream(absolute, { signal })) digest.update(chunk as Buffer);
    } else if (entry.isDirectory()) digest.update('directory');
    else digest.update('special');
    signatures.set(path, digest.digest('hex'));
    if (entry.isDirectory() && descend && !recursive.has(path)) {
      recursive.add(path);
      if (!metadata) await rememberNested(path, 'directory');
      for (const child of (await readdir(absolute)).sort()) await capture(`${path}/${child}`, join(absolute, child), true, metadata);
    }
  };
  // State-file content and identity distinguish subsequent sequencer steps and restarted sessions.
  for (const name of ['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'AUTO_MERGE', 'rebase-merge', 'rebase-apply', 'sequencer']) await capture(`git\0${name}`, join(gitRoot, name), true, true);
  let currentIntegrationCommit = '';
  const markers = identity.integrationState === 'rebase' ? ['REBASE_HEAD', 'rebase-apply/original-commit'] : identity.integrationState === 'cherry_pick' ? ['CHERRY_PICK_HEAD'] : identity.integrationState === 'revert' ? ['REVERT_HEAD'] : [];
  for (const marker of markers) {
    try { const value = (await readFile(join(gitRoot, marker), 'utf8')).trim(); if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) { currentIntegrationCommit = value; break; } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!currentIntegrationCommit && (identity.integrationState === 'cherry_pick' || identity.integrationState === 'revert')) {
    try {
      const todo = await readFile(join(gitRoot, 'sequencer/todo'), 'utf8');
      const abbreviation = /^(?:pick|revert)\s+([a-f0-9]{4,64})\s/mu.exec(todo)?.[1];
      if (abbreviation) currentIntegrationCommit = (await run(['rev-parse', '--verify', '--end-of-options', `${abbreviation}^{commit}`])).stdout.trim();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const stepHash = createHash('sha256').update(JSON.stringify([identity.integrationState, currentIntegrationCommit]));
  for (const path of ['sequencer/todo', 'rebase-merge/git-rebase-todo', 'rebase-merge/done', 'rebase-apply/next']) {
    try { stepHash.update(JSON.stringify([path, await readFile(join(gitRoot, path), 'utf8')])); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (mode === 'hard') {
    // Inspect every tracked path, including assume-unchanged entries. Never follow a
    // symlink ancestor; Git may replace that link, not files outside the worktree.
    for (const path of [...new Set([...indexPaths.keys(), ...targetPaths.keys()])].sort()) {
      const parts = path.split('/'); let prefix = '';
      for (let position = 0; position < parts.length; position += 1) {
        prefix = prefix ? `${prefix}/${parts[position]}` : parts[position]!;
        const absolute = join(cwd, prefix); const entry = await info(absolute);
        const leaf = position === parts.length - 1;
        if (!entry) { signatures.set(prefix, 'missing'); break; }
        if (!leaf && entry.isDirectory()) {
          if (targetPaths.has(path)) await rememberNested(prefix, 'worktree');
          continue;
        }
        const targetFile = targetPaths.has(path) && targetPaths.get(path) !== '160000';
        if (!leaf) {
          if (targetPaths.has(path) && !tracked.has(prefix)) obstacles.add(prefix);
          await capture(prefix, absolute, false, false); break;
        }
        const removeDirectory = entry.isDirectory() && targetFile;
        if ((removeDirectory || !tracked.has(path)) && targetPaths.has(path) && (!entry.isDirectory() || targetFile)) obstacles.add(path);
        await capture(path, absolute, removeDirectory, false);
      }
    }
  }
  for (const [path, signature] of [...signatures].sort(([left], [right]) => left.localeCompare(right))) hash.update(JSON.stringify([path, signature]));
  signal?.throwIfAborted();
  const changedFiles = [...new Set(statusFiles.filter(file => file.indexStatus !== '?').map(file => file.path))].sort();
  const untrackedObstacles = [...obstacles].sort();
  const nestedRepositories = [...nested].sort(([left], [right]) => left.localeCompare(right)).map(([path, effect]) => ({ path, effect }));
  return {
    ...identity, mode, fingerprint: hash.digest('hex'), targetSubject: subject.stdout.trimEnd(), currentIntegrationCommit, integrationStepFingerprint: stepHash.digest('hex'),
    changedFiles: changedFiles.slice(0, 200), changedFileCount: changedFiles.length,
    untrackedObstacles: untrackedObstacles.slice(0, 200), untrackedObstacleCount: untrackedObstacles.length,
    nestedRepositories: nestedRepositories.slice(0, 200), nestedRepositoryCount: nestedRepositories.length,
    trackedFileCount: new Set([...indexPaths.keys(), ...targetPaths.keys()]).size,
    conflictFileCount: parseGitPorcelainStatus(status.stdout).conflictFiles.length,
  };
}
