import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitStopTrackingPreview, getProjectGitIgnoredFiles, getProjectGitFileLocation } from '../packages/git-core/dist/index.js';
import { gitTrackingNeedsReview } from '../apps/desktop/src/renderer/git/GitStopTrackingDialog.tsx';
import { createRepositoryFileLauncher } from '../apps/desktop/src/main/repositoryFileLauncher.ts';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { describeUserFacingError } from '../packages/shared/src/index.ts';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const nativeGit = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout;
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-tracking-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = async (...args) => (await nativeGit(cwd, ...args)).trim();
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Tracking Test'); await git('config', 'user.email', 'tracking@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  await mkdir(join(cwd, 'folder')); await writeFile(join(cwd, 'folder/one.txt'), 'base one\n'); await writeFile(join(cwd, 'folder/two.txt'), 'base two\n'); await writeFile(join(cwd, 'keep.txt'), 'keep\n'); await git('add', '.'); await git('commit', '-m', 'base');
  const run = (action, onCommand, signal) => executeProjectGitAction(cwd, action, signal, env, onCommand);
  const stop = async (paths, force = false) => { const preview = await getProjectGitStopTrackingPreview(cwd, paths); return run({ type: 'stop_tracking', paths, force, expectedFingerprint: preview.fingerprint }); };
  const rules = async value => writeFile(join(cwd, '.gitignore'), value);
  const ignored = query => getProjectGitIgnoredFiles(cwd, query);
  return { root, cwd, git, cleanup, run, stop, rules, ignored };
}

test('stopping tracking a directory includes unchanged index entries and preserves current disk versions', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'folder/one.txt'), 'local one\n');
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['folder/']); assert.deepEqual(preview.selection, ['folder']); assert.equal(preview.total, 2); assert.deepEqual(preview.items.map(item => item.path), ['folder/one.txt', 'folder/two.txt']);
  const result = await f.run({ type: 'stop_tracking', paths: ['folder'], expectedFingerprint: preview.fingerprint }); assert.equal(result.outcome, 'completed');
  assert.equal(await f.git('ls-files'), 'keep.txt'); assert.equal(await readFile(join(f.cwd, 'folder/one.txt'), 'utf8'), 'local one\n'); assert.equal(await readFile(join(f.cwd, 'folder/two.txt'), 'utf8'), 'base two\n'); assert.equal(await f.git('diff', '--cached', '--name-status'), 'D\tfolder/one.txt\nD\tfolder/two.txt'); await assert.rejects(() => lstat(join(f.cwd, '.gitignore')), e => e.code === 'ENOENT');
});

test('native staged-version protection is atomic for a batch; only explicit force discards index versions', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'folder/one.txt'), 'staged one\n'); await f.git('add', 'folder/one.txt'); await writeFile(join(f.cwd, 'folder/one.txt'), 'later disk one\n'); const index = await readFile(join(f.cwd, '.git/index')); const head = await f.git('rev-parse', 'HEAD');
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['folder']); const action = { type: 'stop_tracking', paths: ['folder'], expectedFingerprint: preview.fingerprint };
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_STAGED' && error.operationStatus === 'failed_before_write' && !gitTrackingNeedsReview(error));
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('show', ':folder/one.txt'), 'staged one');
  await f.run({ ...action, force: true }); assert.equal(await readFile(join(f.cwd, 'folder/one.txt'), 'utf8'), 'later disk one\n'); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('ls-files'), 'keep.txt');
});

test('stop-tracking confirmation binds index flags, versions, selection, repository and branch identities', async t => {
  const f = await fixture(t); const other = join(f.root, 'other'); await exec('git', ['clone', '--local', f.cwd, other], { env });
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['folder']); const action = { type: 'stop_tracking', paths: ['folder'], expectedFingerprint: preview.fingerprint };
  await assert.rejects(() => executeProjectGitAction(other, action, undefined, env), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_CHANGED');
  await assert.rejects(() => f.run({ ...action, paths: ['folder/one.txt'] }), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_CHANGED');
  await f.git('update-index', '--assume-unchanged', 'folder/one.txt'); await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_CHANGED' && gitTrackingNeedsReview(error)); await f.git('update-index', '--no-assume-unchanged', 'folder/one.txt');
  await f.git('switch', '-c', 'other'); await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_CHANGED'); await f.git('switch', 'main');
  await writeFile(join(f.cwd, 'folder/new.txt'), 'new\n'); await f.git('add', 'folder/new.txt'); await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_CHANGED'); assert.ok((await f.git('ls-files')).includes('folder/one.txt'));
});

test('new files in an unborn index, missing files and literal special names can stop tracking without a commit', async t => {
  const f = await fixture(t); const unborn = join(f.root, 'unborn'); await mkdir(unborn); await nativeGit(unborn, 'init', '--initial-branch=main'); await writeFile(join(unborn, 'first'), 'first\n'); await nativeGit(unborn, 'add', 'first'); const preview = await getProjectGitStopTrackingPreview(unborn, ['first']); assert.equal(preview.headSha, ''); await executeProjectGitAction(unborn, { type: 'stop_tracking', paths: ['first'], expectedFingerprint: preview.fingerprint }, undefined, env); assert.equal((await nativeGit(unborn, 'ls-files')).trim(), ''); assert.equal(await readFile(join(unborn, 'first'), 'utf8'), 'first\n');
  const paths = ['star*.txt', 'starX.txt', 'bracket[ab].txt', '空 格\t换\n行.txt', '--option.txt']; for (const path of paths) await writeFile(join(f.cwd, path), 'literal\n'); await f.git('--literal-pathspecs', 'add', '--', ...paths); await f.git('commit', '-m', 'special names');
  await rm(join(f.cwd, 'folder/one.txt')); await f.stop(['folder/one.txt', 'star*.txt', 'bracket[ab].txt', '空 格\t换\n行.txt', '--option.txt']);
  const remaining = (await nativeGit(f.cwd, 'ls-files', '-z')).split('\0'); assert.ok(remaining.includes('starX.txt')); assert.ok(!remaining.includes('star*.txt')); assert.equal(await readFile(join(f.cwd, 'star*.txt'), 'utf8'), 'literal\n'); await assert.rejects(() => lstat(join(f.cwd, 'folder/one.txt')), e => e.code === 'ENOENT');
});

test('submodule references and symlinks stop tracking while directories, registration and link targets stay intact', async t => {
  const f = await fixture(t); const child = join(f.root, 'child'); await mkdir(child); await nativeGit(child, 'init'); await nativeGit(child, 'config', 'user.name', 'Child'); await nativeGit(child, 'config', 'user.email', 'child@invalid'); await writeFile(join(child, 'content'), 'child\n'); await nativeGit(child, 'add', '.'); await nativeGit(child, '-c', 'commit.gpgsign=false', 'commit', '-m', 'child');
  await f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub'); await symlink('../outside', join(f.cwd, 'link')); await writeFile(join(f.root, 'outside'), 'external\n'); await f.git('add', 'link'); await f.git('commit', '-m', 'gitlink and symlink'); const modules = await readFile(join(f.cwd, '.gitmodules'));
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['sub', 'link']); assert.equal(preview.gitlinkCount, 1); assert.equal(preview.items.find(item => item.path === 'link').kind, 'symlink'); await f.run({ type: 'stop_tracking', paths: ['sub', 'link'], expectedFingerprint: preview.fingerprint });
  assert.deepEqual(await readFile(join(f.cwd, '.gitmodules')), modules); assert.equal(await readFile(join(f.cwd, 'sub/content'), 'utf8'), 'child\n'); assert.equal((await lstat(join(f.cwd, 'link'))).isSymbolicLink(), true); assert.equal(await readFile(join(f.root, 'outside'), 'utf8'), 'external\n');
});

test('conflicted index paths are counted once and an explicit forced stop retains the marked worktree', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'topic'); await writeFile(join(f.cwd, 'keep.txt'), 'topic\n'); await f.git('commit', '-am', 'topic'); await f.git('switch', 'main'); await writeFile(join(f.cwd, 'keep.txt'), 'main\n'); await f.git('commit', '-am', 'main'); await assert.rejects(() => f.git('merge', 'topic')); const marked = await readFile(join(f.cwd, 'keep.txt'));
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['keep.txt']); assert.equal(preview.conflictCount, 1); assert.equal(preview.total, 1); await f.run({ type: 'stop_tracking', paths: ['keep.txt'], force: true, expectedFingerprint: preview.fingerprint }); assert.deepEqual(await readFile(join(f.cwd, 'keep.txt')), marked); assert.equal(await f.git('ls-files', '-u'), '');
});

test('tracking rejects invalid and no-longer-tracked scopes before changing the index', async t => {
  const f = await fixture(t); const index = await readFile(join(f.cwd, '.git/index'));
  for (const paths of [[], [''], ['../escape'], ['/etc/passwd'], ['.git/config'], ['folder//one.txt'], ['folder/../keep.txt'], ['bad\0name']]) await assert.rejects(() => getProjectGitStopTrackingPreview(f.cwd, paths), error => error.code === 'ASTRAGIT_GIT_TRACKING_PATH_INVALID');
  await assert.rejects(() => getProjectGitStopTrackingPreview(f.cwd, ['keep.txt', 'not-tracked']), error => error.code === 'ASTRAGIT_GIT_STOP_TRACKING_NOT_TRACKED' && error.affectedFileCount === 1 && error.affectedFiles[0] === 'not-tracked'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('ignored browsing collapses directories then drills one level without following symlinks or showing tracked leaves', async t => {
  const f = await fixture(t); await f.rules('cache/\nfolder/\n'); await mkdir(join(f.cwd, 'cache/sub'), { recursive: true }); await writeFile(join(f.cwd, 'cache/sub/a.txt'), 'a\n'); await writeFile(join(f.cwd, 'cache/top.txt'), 'top\n'); await writeFile(join(f.cwd, 'folder/ignored.txt'), 'ignored\n');
  const root = await f.ignored(); assert.ok(root.items.some(item => item.path === 'cache/' && item.directory && item.rule.pattern === 'cache/')); assert.ok(!root.items.some(item => item.path.startsWith('cache/sub/')));
  const children = await f.ignored({ prefix: 'cache/' }); assert.deepEqual(children.items.map(item => item.path), ['cache/sub/', 'cache/top.txt']); assert.deepEqual((await f.ignored({ prefix: 'cache/sub' })).items.map(item => item.path), ['cache/sub/a.txt']);
  const trackedMixed = await f.ignored({ prefix: 'folder' }); assert.deepEqual(trackedMixed.items.map(item => item.path), ['folder/ignored.txt']);
  await symlink(f.root, join(f.cwd, 'cache/outside')); const link = (await f.ignored({ prefix: 'cache' })).items.find(item => item.path === 'cache/outside'); assert.equal(link.directory, false); await assert.rejects(() => f.ignored({ prefix: 'cache/outside' }), error => error.code === 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED');
});

test('ignored rules come from native precedence, negation, nested files, info/exclude and external excludes files', async t => {
  const f = await fixture(t); const global = join(f.root, 'global rules'); await writeFile(global, '# global\n*.global\n'); await f.git('config', 'core.excludesFile', global); await writeFile(join(f.cwd, '.git/info/exclude'), '# local\n*.local\n'); await f.rules('*.tmp\n!kept.tmp\n');
  await mkdir(join(f.cwd, 'nested')); await writeFile(join(f.cwd, 'nested/.gitignore'), '# nested\n*.tmp\n');
  for (const path of ['global.global', 'private.local', 'root.tmp', 'kept.tmp', 'nested/child.tmp']) await writeFile(join(f.cwd, path), 'contents\n');
  const page = await f.ignored(); const byPath = new Map(page.items.map(item => [item.path, item])); assert.ok(!byPath.has('kept.tmp')); assert.equal(byPath.get('root.tmp').rule.source, '.gitignore'); assert.equal(byPath.get('root.tmp').rule.line, 1); assert.equal(byPath.get('nested/child.tmp').rule.source, 'nested/.gitignore'); assert.equal(byPath.get('nested/child.tmp').rule.line, 2); assert.equal(byPath.get('private.local').rule.source, '.git/info/exclude'); assert.equal(byPath.get('global.global').rule.source, global);
});

test('ignored pagination and scope search are explicit and reject a changed path list before appending pages', async t => {
  const f = await fixture(t); await f.rules('*.tmp\n'); for (const path of ['a.tmp', 'b.tmp', 'c.tmp', '空\n白.tmp']) await writeFile(join(f.cwd, path), path);
  const first = await f.ignored({ limit: 2 }); assert.equal(first.total, 4); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 2); const second = await f.ignored({ limit: 2, offset: 2, expectedFingerprint: first.fingerprint }); assert.equal(second.hasMore, false); assert.equal(new Set([...first.items, ...second.items].map(item => item.path)).size, 4);
  const filtered = await f.ignored({ search: 'B.TMP' }); assert.equal(filtered.total, 1); assert.equal(filtered.items[0].path, 'b.tmp');
  await writeFile(join(f.cwd, 'new.tmp'), 'new\n'); await assert.rejects(() => f.ignored({ offset: 2, expectedFingerprint: first.fingerprint }), error => error.code === 'ASTRAGIT_GIT_IGNORED_LIST_CHANGED' && gitTrackingNeedsReview(error));
  for (const query of [{ limit: 201 }, { offset: -1 }, { prefix: '../escape' }, { search: 'x\0' }, { prefix: 'cache/missing' }]) await assert.rejects(() => f.ignored(query));
});

test('explicit force stage handles literal ignored files but rejects a batch when any item is stale or already tracked', async t => {
  const f = await fixture(t); await f.rules('*.tmp\n'); for (const path of ['star*.tmp', 'starX.tmp', '空\n白.tmp']) await writeFile(join(f.cwd, path), 'ignored\n'); const before = await readFile(join(f.cwd, '.git/index'));
  await assert.rejects(() => f.run({ type: 'stage_ignored', paths: ['star*.tmp', 'keep.txt'] }), error => error.code === 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED' && error.operationStatus === 'failed_before_write'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before);
  await assert.rejects(() => f.run({ type: 'stage_ignored', paths: ['star*.tmp', 'missing.tmp'] }), error => error.code === 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before);
  const result = await f.run({ type: 'stage_ignored', paths: ['star*.tmp', '空\n白.tmp'] }); assert.equal(result.outcome, 'completed'); const tracked = (await nativeGit(f.cwd, 'ls-files', '-z')).split('\0'); assert.ok(tracked.includes('star*.tmp')); assert.ok(!tracked.includes('starX.tmp')); assert.ok(tracked.includes('空\n白.tmp')); assert.equal(await readFile(join(f.cwd, '.gitignore'), 'utf8'), '*.tmp\n'); assert.equal(await readFile(join(f.cwd, 'star*.tmp'), 'utf8'), 'ignored\n');
  await f.rules(''); await assert.rejects(() => f.run({ type: 'stage_ignored', paths: ['starX.tmp'] }), error => error.code === 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED');
});

test('explicit ignored-directory staging preserves native tracked-child and embedded-repository behavior', async t => {
  const f = await fixture(t); await f.rules('folder/\ncache/\n'); await writeFile(join(f.cwd, 'folder/one.txt'), 'tracked change\n'); await writeFile(join(f.cwd, 'folder/new.txt'), 'new\n'); await f.run({ type: 'stage_ignored', paths: ['folder/'] }); assert.equal(await f.git('show', ':folder/one.txt'), 'tracked change'); assert.equal(await f.git('show', ':folder/new.txt'), 'new');
  await mkdir(join(f.cwd, 'cache')); await nativeGit(join(f.cwd, 'cache'), 'init'); await nativeGit(join(f.cwd, 'cache'), 'config', 'user.name', 'Embedded'); await nativeGit(join(f.cwd, 'cache'), 'config', 'user.email', 'embedded@invalid'); await writeFile(join(f.cwd, 'cache/file'), 'embedded\n'); await nativeGit(join(f.cwd, 'cache'), 'add', '.'); await nativeGit(join(f.cwd, 'cache'), '-c', 'commit.gpgsign=false', 'commit', '-m', 'embedded');
  await f.run({ type: 'stage_ignored', paths: ['cache'] }); assert.match(await f.git('ls-files', '--stage', 'cache'), /^160000 /u); assert.ok((await lstat(join(f.cwd, 'cache/.git'))).isDirectory());
});

test('rule editing resolves the matching source again; desktop bridge never accepts a caller supplied source path', async t => {
  const f = await fixture(t); await f.rules('*.tmp\n'); await writeFile(join(f.cwd, 'one.tmp'), 'ignored\n'); const calls = [];
  const launch = createRepositoryFileLauncher({ resolve: (_project, _repository, path, intent) => getProjectGitFileLocation(f.cwd, path, intent), open: async () => '', reveal: () => {}, openText: async path => { calls.push(path); } }); const request = { projectId: 'p', repositoryId: 'r', path: 'one.tmp', intent: 'edit-ignore-rule' };
  assert.equal((await launch(request)).ok, true); assert.deepEqual(calls, [join(f.cwd, '.gitignore')]); assert.equal((await launch({ ...request, path: '/etc/passwd' })).ok, false);
  const external = join(f.root, 'global-ignore'); await writeFile(external, '*.tmp\n'); await f.git('config', 'core.excludesFile', external); await f.rules(''); assert.equal((await launch(request)).ok, true); assert.deepEqual(calls, [join(f.cwd, '.gitignore'), external]); await writeFile(external, ''); assert.equal((await launch(request)).ok, false); assert.equal(calls.length, 2);
});

test('symlink ancestor requests and pre-cancelled queries do not touch outside files or stage anything', async t => {
  const f = await fixture(t); await f.rules('cache/\n'); const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'one.tmp'), 'external\n'); await symlink(outside, join(f.cwd, 'cache')); const before = await readFile(join(f.cwd, '.git/index'));
  await assert.rejects(() => f.run({ type: 'stage_ignored', paths: ['cache/one.tmp'] }), error => error.code === 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED'); await assert.rejects(() => getProjectGitFileLocation(f.cwd, 'cache/one.tmp', 'open')); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before); assert.equal(await readFile(join(outside, 'one.tmp'), 'utf8'), 'external\n');
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => getProjectGitIgnoredFiles(f.cwd, {}, controller.signal)); await assert.rejects(() => getProjectGitStopTrackingPreview(f.cwd, ['keep.txt'], controller.signal));
});

test('HTTP previews, ignored queries and writes preserve repository ownership and action records', async t => {
  const f = await fixture(t); await f.rules('*.tmp\n'); await writeFile(join(f.cwd, 'one.tmp'), 'ignored\n'); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'tracking-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Tracking', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const page = await client.loadProjectGitIgnoredFiles(project.id, repository.id, {}); assert.ok(page.items.some(item => item.path === 'one.tmp'));
  await client.executeProjectGitAction(project.id, repository.id, { type: 'stage_ignored', paths: ['one.tmp'] }); const preview = await client.loadProjectGitStopTrackingPreview(project.id, repository.id, ['folder']); assert.equal(preview.total, 2); await client.executeProjectGitAction(project.id, repository.id, { type: 'stop_tracking', paths: ['folder'], expectedFingerprint: preview.fingerprint });
  await assert.rejects(() => client.loadProjectGitStopTrackingPreview(project.id, repository.id, ['missing']), error => error.status === 409 && error.affectedFiles[0] === 'missing' && error.affectedFileCount === 1 && describeUserFacingError(error).message.includes('索引'));
  await assert.rejects(() => client.loadProjectGitIgnoredFiles(project.id, 'wrong-repository', {})); await assert.rejects(() => client.loadProjectGitStopTrackingPreview('wrong-project', repository.id, ['keep.txt'])); const history = await client.loadProjectGitOperations(project.id); assert.ok(history.items.some(item => item.action === 'stop_tracking' && item.status === 'completed')); assert.ok(history.items.some(item => item.action === 'stage_ignored' && item.status === 'completed'));
});

test('ignored porcelain parsing cannot mistake the old path of a rename for an ignored status row', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, '!! phantom.tmp'), 'tracked\n'); await f.git('add', '--', '!! phantom.tmp'); await f.git('commit', '-m', 'status-looking filename'); await f.git('mv', '--', '!! phantom.tmp', 'renamed.txt'); await f.rules('*.tmp\n'); await writeFile(join(f.cwd, 'real.tmp'), 'ignored\n'); const index = await readFile(join(f.cwd, '.git/index'));
  const page = await f.ignored(); assert.deepEqual(page.items.map(item => item.path), ['real.tmp']); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('large stop-tracking previews retain the full directory scope beyond the visible 200 rows', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'many')); for (let i = 0; i < 205; i++) await writeFile(join(f.cwd, 'many', `entry-${String(i).padStart(3, '0')}`), `${i}\n`); await f.git('add', 'many');
  const preview = await getProjectGitStopTrackingPreview(f.cwd, ['many']); assert.equal(preview.total, 205); assert.equal(preview.items.length, 200); await f.run({ type: 'stop_tracking', paths: ['many'], expectedFingerprint: preview.fingerprint }); assert.equal(await f.git('ls-files', 'many'), ''); assert.equal(await readFile(join(f.cwd, 'many/entry-204'), 'utf8'), '204\n');
});

test('service shutdown cancels an active ignored-file read and its blocking native Git process', { timeout: 15_000 }, async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'tracking-shutdown-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Read cancellation', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const { chmod } = await import('node:fs/promises'); const marker = join(f.root, 'monitor-pid'); const hook = join(f.root, 'blocking-monitor');
  await writeFile(hook, `#!/bin/sh\nprintf '%s' "$$" > '${marker.replaceAll("'", "'\\''")}'\nwhile :; do sleep 1; done\n`); await chmod(hook, 0o755); await f.git('config', 'core.fsmonitor', hook);
  const controller = new AbortController(); t.after(() => controller.abort()); const pending = client.loadProjectGitIgnoredFiles(project.id, repository.id, {}, controller.signal).then(() => ({ ok: true }), error => ({ error }));
  const deadline = Date.now() + 5_000; let pid;
  f.cleanup.unshift(async () => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  while (Date.now() < deadline) { try { pid = Number(await readFile(marker, 'utf8')); if (pid) break; } catch { /* Wait only for this owned native process to start. */ } await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.ok(pid, 'native fsmonitor hook did not start');
  const closeTimeout = setTimeout(() => controller.abort(), 5_000);
  try { await server.close(); } finally { clearTimeout(closeTimeout); }
  assert.ok((await pending).error, 'the stopped read must not report a successful list');
  let alive = true; const exitedBy = Date.now() + 1_000;
  while (Date.now() < exitedBy) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { alive = false; break; } throw error; } await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(alive, false, 'the native read process must exit with the server'); assert.equal(await readFile(join(f.cwd, 'keep.txt'), 'utf8'), 'keep\n');
});
