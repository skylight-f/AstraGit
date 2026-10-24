import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitIgnorePreview, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { gitIgnorePatterns } from '../apps/desktop/src/renderer/git/gitIgnorePatterns.ts';
import { gitIgnoreNeedsReview } from '../apps/desktop/src/renderer/git/GitIgnoreDialog.tsx';

const exec = promisify(execFile);
const baseEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-ignore-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const config = join(root, 'global-config'); const globalFile = join(root, 'global rules', 'ignore'); await writeFile(config, '');
  const env = { ...baseEnv, GIT_CONFIG_GLOBAL: config };
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await git('config', '--global', 'core.excludesFile', globalFile); await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Ignore Test'); await git('config', 'user.email', 'ignore@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await writeFile(join(cwd, 'tracked.txt'), 'tracked\n'); await git('add', '.'); await git('commit', '-m', 'base');
  const preview = (scope = 'repository', signal) => getProjectGitIgnorePreview(cwd, scope, signal, env);
  const run = (value, onCommand, signal) => executeProjectGitAction(cwd, value, signal, env, onCommand);
  const action = (value, patterns) => ({ type: 'ignore', scope: value.scope, patterns, expectedFingerprint: value.fingerprint });
  return { root, cwd, cleanup, env, git, config, globalFile, preview, run, action };
}

test('repository ignores append with existing CRLF, preserving old bytes, files and the index', async t => {
  const f = await fixture(t); const path = join(f.cwd, '.gitignore'); const old = Buffer.from('# retain exactly\r\nold-rule\r\n'); await writeFile(path, old); await writeFile(join(f.cwd, 'cache.log'), 'keep file\n'); const index = await readFile(join(f.cwd, '.git/index'));
  const preview = await f.preview(); assert.equal(preview.filePath, path); assert.equal(preview.exists, true); assert.equal((await f.run(f.action(preview, ['/cache.log']))).outcome, 'completed');
  assert.deepEqual(await readFile(path), Buffer.concat([old, Buffer.from('/cache.log\r\n')])); assert.equal(await readFile(join(f.cwd, 'cache.log'), 'utf8'), 'keep file\n'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('check-ignore', '--', 'cache.log'), 'cache.log');
});

test('local ignores change only this repository info/exclude and do not create or stage .gitignore', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'local.tmp'), 'keep\n'); const path = join(f.cwd, '.git/info/exclude'); const old = await readFile(path); const preview = await f.preview('local'); await f.run(f.action(preview, ['*.tmp']));
  assert.ok((await readFile(path)).subarray(0, old.length).equals(old)); await assert.rejects(() => lstat(join(f.cwd, '.gitignore')), error => error.code === 'ENOENT'); assert.equal(await f.git('diff', '--cached', '--name-only'), ''); assert.equal(await f.git('check-ignore', '--', 'local.tmp'), 'local.tmp');
});

test('appending rules keeps an already-staged ignore version separate from the new working copy', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, '.gitignore'), '# staged original\n'); await f.git('add', '.gitignore'); const indexVersion = await f.git('show', ':.gitignore'); await f.run(f.action(await f.preview(), ['*.cache']));
  assert.equal(await f.git('show', ':.gitignore'), indexVersion); assert.equal(await readFile(join(f.cwd, '.gitignore'), 'utf8'), '# staged original\n*.cache\n');
});

test('local ignore follows Git common-directory semantics for linked worktrees', async t => {
  const f = await fixture(t); const linked = join(f.root, 'linked'); await f.git('worktree', 'add', '-b', 'linked-branch', linked); await writeFile(join(linked, 'local.tmp'), 'keep\n');
  const preview = await getProjectGitIgnorePreview(linked, 'local', undefined, f.env); assert.equal(preview.filePath, join(f.cwd, '.git/info/exclude'));
  await executeProjectGitAction(linked, f.action(preview, ['*.tmp']), undefined, f.env); assert.equal((await exec('git', ['check-ignore', '--', 'local.tmp'], { cwd: linked, env: f.env })).stdout.trim(), 'local.tmp'); assert.ok((await readFile(join(f.cwd, '.git/info/exclude'), 'utf8')).endsWith('*.tmp\n'));
});

test('global ignore uses the explicit Git global configuration without changing it or repository files', async t => {
  const f = await fixture(t); const config = await readFile(f.config); await writeFile(join(f.cwd, 'global.tmp'), 'global\n'); const preview = await f.preview('global'); assert.equal(preview.filePath, f.globalFile); assert.equal(preview.exists, false); await f.run(f.action(preview, ['*.tmp']));
  assert.deepEqual(await readFile(f.config), config); assert.equal(await f.git('check-ignore', '--', 'global.tmp'), 'global.tmp'); assert.equal(await readFile(f.globalFile, 'utf8'), '*.tmp\n'); await assert.rejects(() => lstat(join(f.cwd, '.gitignore')), error => error.code === 'ENOENT');
  const other = join(f.root, 'other'); await mkdir(other); await exec('git', ['init'], { cwd: other, env: f.env }); await writeFile(join(other, 'other.tmp'), 'other\n'); assert.equal((await exec('git', ['check-ignore', '--', 'other.tmp'], { cwd: other, env: f.env })).stdout.trim(), 'other.tmp');
});

test('global symlink targets are displayed, appended in place and kept linked', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'global rules')); const target = join(f.root, 'actual-ignore'); await writeFile(target, '# existing\n'); await symlink('../actual-ignore', f.globalFile); const preview = await f.preview('global'); assert.equal(preview.configuredPath, f.globalFile); assert.equal(preview.filePath, target);
  await f.run(f.action(preview, ['*.cache'])); assert.equal((await lstat(f.globalFile)).isSymbolicLink(), true); assert.equal(await readFile(target, 'utf8'), '# existing\n*.cache\n');
});

test('stale rules, scope, global destination and replayed confirmations cannot append', async t => {
  const f = await fixture(t); const initial = await f.preview(); await writeFile(join(f.cwd, '.gitignore'), '# external\n');
  await assert.rejects(() => f.run(f.action(initial, ['*.log'])), error => error.code === 'ASTRAGIT_GIT_IGNORE_CHANGED' && error.operationStatus === 'failed_before_write' && gitIgnoreNeedsReview(error));
  const current = await f.preview(); await assert.rejects(() => f.run({ ...f.action(current, ['*.log']), scope: 'local' }), error => error.code === 'ASTRAGIT_GIT_IGNORE_CHANGED');
  await f.run(f.action(current, ['*.log'])); const saved = await readFile(join(f.cwd, '.gitignore')); await assert.rejects(() => f.run(f.action(current, ['*.log'])), error => error.code === 'ASTRAGIT_GIT_IGNORE_CHANGED'); assert.deepEqual(await readFile(join(f.cwd, '.gitignore')), saved);
  const global = await f.preview('global'); await f.git('config', '--global', 'core.excludesFile', join(f.root, 'different-ignore')); await assert.rejects(() => f.run(f.action(global, ['*.log'])), error => error.code === 'ASTRAGIT_GIT_IGNORE_CHANGED'); await assert.rejects(() => lstat(f.globalFile), error => error.code === 'ENOENT');
});

test('repository symlinks, nonfiles and malformed patterns are rejected without modifying destinations', async t => {
  const f = await fixture(t); const path = join(f.cwd, '.gitignore'); const external = join(f.root, 'external'); await writeFile(external, '# untouched\n'); await symlink(external, path); await assert.rejects(() => f.preview(), error => error.code === 'ASTRAGIT_GIT_IGNORE_FILE_INVALID'); assert.equal(await readFile(external, 'utf8'), '# untouched\n');
  await rm(path); await mkdir(path); await assert.rejects(() => f.preview(), error => error.code === 'ASTRAGIT_GIT_IGNORE_FILE_INVALID'); await rm(path, { recursive: true }); const preview = await f.preview();
  for (const patterns of [[], ['x\ny'], ['x\0y'], Array.from({ length: 201 }, () => '*.tmp'), ['x'.repeat(65537)]]) await assert.rejects(() => f.run(f.action(preview, patterns)), error => error.code === 'ASTRAGIT_GIT_IGNORE_INVALID');
  await assert.rejects(() => lstat(path), error => error.code === 'ENOENT');
});

test('exact-path presets escape special Git wildcards, leading markers and trailing spaces', async t => {
  const f = await fixture(t); const paths = ['!important.txt', '#hash.txt', 'bracket[ab].log', 'question?.log', 'star*.log', 'back\\slash.txt', 'space name.txt '];
  for (const path of [...paths, 'bracketa.log', 'questionX.log', 'starX.log', 'space name.txt']) await writeFile(join(f.cwd, path), 'content\n');
  const patterns = gitIgnorePatterns(paths, 'paths'); assert.ok(patterns); await f.run(f.action(await f.preview(), patterns));
  for (const path of paths) await f.git('check-ignore', '--quiet', '--', path);
  for (const path of ['bracketa.log', 'questionX.log', 'starX.log', 'space name.txt']) await assert.rejects(() => f.git('check-ignore', '--quiet', '--', path));
  assert.equal(gitIgnorePatterns(['line\nbreak.txt'], 'paths'), null); assert.deepEqual(gitIgnorePatterns(['a/one.log', 'b/two.log'], 'extensions'), ['*.log']); assert.deepEqual(gitIgnorePatterns(['a/one.log', 'b/two.log'], 'directories'), ['/a/', '/b/']);
});

test('appending preserves non-UTF8 bytes and a missing final newline, while tracked files stay tracked', async t => {
  const f = await fixture(t); const old = Buffer.from([35, 32, 255, 254]); await writeFile(join(f.cwd, '.gitignore'), old); await writeFile(join(f.cwd, 'tracked.txt'), 'modified tracked\n'); await f.run(f.action(await f.preview(), ['*.txt']));
  assert.deepEqual(await readFile(join(f.cwd, '.gitignore')), Buffer.concat([old, Buffer.from('\n*.txt\n')])); assert.equal(await f.git('ls-files', '--', 'tracked.txt'), 'tracked.txt'); assert.ok((await getProjectGitRepositorySnapshot(f.cwd)).fileStatuses.some(file => file.path === 'tracked.txt' && file.workingTreeStatus === 'M'));
});

test('an external edit before append is retained and produces an unconfirmed outcome rather than overwriting it', async t => {
  const f = await fixture(t); const path = join(f.cwd, '.gitignore'); await writeFile(path, '# original\n'); const preview = await f.preview();
  await assert.rejects(() => f.run(f.action(preview, ['*.log']), async command => { if (command.startsWith('[AstraGit]')) await appendFile(path, '# external after review\n'); }), error => error.code === 'ASTRAGIT_GIT_IGNORE_OUTCOME_UNKNOWN' && error.operationStatus === 'unknown_after_write' && gitIgnoreNeedsReview(error));
  assert.equal(await readFile(path, 'utf8'), '# original\n# external after review\n');
});

test('a cancelled ignore preview or append leaves source files intact and does not pretend rules were saved', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort(); await assert.rejects(() => f.preview('repository', controller.signal));
  const preview = await f.preview(); const cancel = new AbortController(); await assert.rejects(() => f.run(f.action(preview, ['*.tmp']), async command => { if (command.startsWith('[AstraGit]')) cancel.abort(); }, cancel.signal), error => error.code === 'ASTRAGIT_GIT_IGNORE_OUTCOME_UNKNOWN'); await assert.rejects(() => lstat(join(f.cwd, '.gitignore')), error => error.code === 'ENOENT'); assert.equal(await readFile(join(f.cwd, 'tracked.txt'), 'utf8'), 'tracked\n');
});

test('HTTP ignore previews and mutations validate the selected repository and record the append operation', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'ignore-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Ignore', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  await writeFile(join(f.cwd, 'cache.log'), 'keep file\n'); const preview = await client.loadProjectGitIgnorePreview(project.id, repository.id, 'repository'); const result = await client.executeProjectGitAction(project.id, repository.id, f.action(preview, ['/cache.log'])); assert.equal(result.result.outcome, 'completed'); assert.ok(!result.snapshot.fileStatuses.some(file => file.path === 'cache.log'));
  assert.ok((await client.loadProjectGitOperations(project.id)).items.some(item => item.action === 'ignore' && item.status === 'completed' && item.commands.some(command => command.startsWith('[AstraGit]')))); await assert.rejects(() => client.loadProjectGitIgnorePreview(project.id, 'wrong-repo', 'local')); await assert.rejects(() => client.loadProjectGitIgnorePreview(project.id, repository.id, 'wrong-scope'));
});
