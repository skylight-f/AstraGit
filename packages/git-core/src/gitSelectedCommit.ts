import { copyFile, mkdtemp, open, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSelectedCommitFingerprint, type GitCommitSelectionMode } from './gitCommitSelectionContext.js';

type Output = { stdout: string; stderr: string };
type Runner = (args: string[], options?: { index?: string; input?: string }) => Promise<Output>;

/** 冻结所选内容后提交；成功时只更新真实索引中的所选路径。 */
export async function commitSelectedPaths(cwd: string, input: {
  paths: string[]; selected: string[]; mode: GitCommitSelectionMode; message: string;
  headSha: string; expectedFingerprint?: string;
}, run: Runner): Promise<Output> {
  const indexPath = (await run(['rev-parse', '--path-format=absolute', '--git-path', 'index'])).stdout.trim();
  const directory = await mkdtemp(join(tmpdir(), 'astragit-selected-commit-'));
  const index = join(directory, 'commit-index');
  const lockPath = `${indexPath}.lock`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let ownsLock = false;
  try {
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error('仓库索引已被锁定，请确认其他 Git 操作已结束后再重试。'), { code: 'ASTRAGIT_GIT_INDEX_LOCKED', operationStage: 'preflight', operationStatus: 'failed_before_write' });
      throw error;
    }
    ownsLock = true;
    const before = await readSelectedCommitFingerprint(cwd, input.selected, input.mode);
    if (input.expectedFingerprint && before !== input.expectedFingerprint) throw Object.assign(new Error('所选内容已变化，请刷新后重新确认提交。'), { code: 'ASTRAGIT_GIT_SELECTION_CHANGED' });
    await run(['read-tree', ...(input.headSha ? [input.headSha] : ['--empty'])], { index });
    if (input.mode === 'worktree') {
      await run(['--literal-pathspecs', 'add', '-A', '--', ...input.paths], { index });
    } else {
      const entries = (await run(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...input.paths])).stdout;
      await run(['--literal-pathspecs', 'update-index', '--force-remove', '--', ...input.paths], { index });
      if (entries) await run(['update-index', '-z', '--index-info'], { index, input: entries });
    }
    if (before !== await readSelectedCommitFingerprint(cwd, input.selected, input.mode)) throw Object.assign(new Error('准备提交期间所选内容已变化，请重新确认。'), { code: 'ASTRAGIT_GIT_SELECTION_CHANGED' });
    // 保留用户提交 hooks，但拒绝 hook 将未勾选路径加入临时提交索引。
    const originalHooks = (await run(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])).stdout.trim();
    const hooks = join(directory, 'hooks');
    const { mkdir } = await import('node:fs/promises'); await mkdir(hooks);
    const guard = join(directory, 'guard.cjs');
    await writeFile(guard, `const { spawnSync } = require('node:child_process');
const config = ${JSON.stringify({ cwd, hooks: originalHooks, paths: input.paths, head: input.headSha })};
const name = process.argv[2];
const hook = spawnSync('git', ['-c', 'core.hooksPath=' + config.hooks, 'hook', 'run', '--ignore-missing', name, '--', ...process.argv.slice(3)], { cwd: config.cwd, stdio: 'inherit' });
if (hook.error || hook.status !== 0) { process.stderr.write('ASTRAGIT_GIT_HOOK_REJECTED: ' + name + ' hook failed\\n'); process.exit(hook.status || 1); }
const diff = spawnSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z', ...(config.head ? [config.head] : [])], { cwd: config.cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (diff.error || diff.status !== 0) process.exit(1);
const allowed = new Set(config.paths);
if (diff.stdout.split('\\0').filter(Boolean).some(path => !allowed.has(path))) { process.stderr.write('ASTRAGIT_GIT_HOOK_SELECTION_CHANGED: 提交 hook 暂存了未勾选的文件，已阻止本次提交；请调整 hook 或重新选择范围。\\n'); process.exit(1); }
`, { mode: 0o600 });
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) await writeFile(join(hooks, name), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(guard)} ${quote(name)} "$@"\n`, { mode: 0o700 });
    for (const name of ['post-commit', 'post-rewrite']) await symlink(join(originalHooks, name), join(hooks, name));
    const output = await run(['-c', `core.hooksPath=${hooks}`, 'commit', '-m', input.message], { index });
    // 保留未勾选的索引条目；工作区在冻结之后产生的修改继续留在工作区。
    try {
      await copyFile(indexPath, lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await copyFile(index, lockPath);
    }
    const head = (await run(['rev-parse', '--verify', 'HEAD'])).stdout.trim();
    const entries = (await run(['--literal-pathspecs', 'ls-tree', '-r', '-z', head, '--', ...input.paths])).stdout
      .split('\0').filter(Boolean).map(record => record.replace(/^(\d+) (?:blob|commit) ([0-9a-f]+)\t/u, '$1 $2\t')).join('\0');
    await run(['--literal-pathspecs', 'update-index', '--force-remove', '--', ...input.paths], { index: lockPath });
    if (entries) await run(['update-index', '-z', '--index-info'], { index: lockPath, input: `${entries}\0` });
    await rename(lockPath, indexPath);
    ownsLock = false;
    return output;
  } finally {
    if (lock) await lock.close();
    if (ownsLock) {
      await rm(lockPath, { force: true });
      await rm(`${lockPath}.lock`, { force: true });
    }
    await rm(directory, { recursive: true, force: true });
  }
}
