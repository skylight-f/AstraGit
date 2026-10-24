import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitSubmodules, getProjectGitSubmodulePreview } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

const exec = promisify(execFile);
process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
const env = { ...process.env, LC_ALL: 'C' };
const raw = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout;
const git = async (cwd, ...args) => (await raw(cwd, ...args)).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-submodules-')); const cwd = join(root, 'parent'); const source = join(root, 'source');
  const closes = []; t.after(async () => { for (const close of closes) await close(); await rm(root, { recursive: true, force: true }); });
  for (const directory of [cwd, source]) {
    await mkdir(directory); await git(directory, 'init', '--initial-branch=main'); await git(directory, 'config', 'user.name', 'Module Test'); await git(directory, 'config', 'user.email', 'module@astragit.invalid'); await git(directory, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(directory, 'file.txt'), 'base\n'); await git(directory, 'add', '.'); await git(directory, 'commit', '-m', 'base');
  }
  await git(source, 'branch', 'feature/module');
  const preview = change => getProjectGitSubmodulePreview(cwd, change);
  const run = async (change, expected) => executeProjectGitAction(cwd, { type: 'manage_submodule', change, expectedFingerprint: expected ?? (await preview(change)).fingerprint }, undefined, env);
  const add = async (path = 'apps/child', options = {}) => { await run({ operation: 'add', path, url: source, allowLocal: true, ...options }); await git(cwd, 'commit', '-am', 'register module'); return join(cwd, path); };
  return { root, cwd, source, closes, preview, run, add };
}

test('add stages only the gitlink and shared config, keeps unrelated changes and uses command-scoped file transport', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'unrelated parent draft\n');
  const change = { operation: 'add', path: 'apps/child', url: f.source, branch: 'feature/module', allowLocal: true };
  const before = await git(f.cwd, 'config', '--local', '--list'); const preview = await f.preview(change); assert.ok(preview.effects.includes('stage_gitlink_and_gitmodules'));
  await f.run(change, preview.fingerprint); const state = await getProjectGitSubmodules(f.cwd); assert.equal(state.modules.length, 1); const module = state.modules[0];
  assert.equal(module.branch, 'feature/module'); assert.equal(module.recordedSha, await git(f.source, 'rev-parse', 'HEAD')); assert.equal(module.headSha, module.recordedSha); assert.equal(module.initialized, true);
  assert.equal(await git(f.cwd, 'diff', '--cached', '--name-only'), '.gitmodules\napps/child'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'unrelated parent draft\n');
  assert.equal((await git(f.cwd, 'config', '--local', '--list')).includes('protocol.file.allow'), false); assert.ok(before.includes('user.name'));
});

test('adopting and unregistering an existing repository preserves dirty and untracked content and its Git identity', async t => {
  const f = await fixture(t); const child = join(f.cwd, 'existing'); await git(f.cwd, 'clone', f.source, child);
  await writeFile(join(child, 'file.txt'), 'local edit\n'); await writeFile(join(child, 'untracked.txt'), 'do not delete');
  const change = { operation: 'add', path: 'existing', url: f.source, allowLocal: true };
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_ADOPT_REQUIRED');
  await f.run({ ...change, adoptExisting: true }); await git(f.cwd, 'commit', '-am', 'adopt');
  const head = await git(child, 'rev-parse', 'HEAD'); await f.run({ operation: 'remove', path: 'existing', keepFiles: true });
  assert.equal(await git(child, 'rev-parse', 'HEAD'), head); assert.equal(await readFile(join(child, 'file.txt'), 'utf8'), 'local edit\n'); assert.equal(await readFile(join(child, 'untracked.txt'), 'utf8'), 'do not delete');
  assert.deepEqual((await getProjectGitSubmodules(f.cwd)).modules, []); assert.equal(await git(f.cwd, 'ls-files', '--', 'existing'), '');
  assert.equal(await git(f.cwd, 'config', '--file', '.gitmodules', '--list'), '');
});

test('URL and branch edits retain native staging semantics and sync copies shared URLs without fetching', async t => {
  const f = await fixture(t); const child = await f.add(); const alternate = join(f.root, 'alternate.git'); await git(f.root, 'clone', '--bare', f.source, alternate);
  await f.run({ operation: 'set_url', path: 'apps/child', url: alternate });
  assert.equal(await git(f.cwd, 'config', '--file', '.gitmodules', 'submodule.apps/child.url'), alternate);
  assert.equal(await git(child, 'remote', 'get-url', 'origin'), alternate); assert.equal(await git(f.cwd, 'diff', '--cached', '--name-only'), '');
  await f.run({ operation: 'set_branch', path: 'apps/child', branch: '.' }); assert.equal((await getProjectGitSubmodules(f.cwd)).modules[0].branch, '.');
  await f.run({ operation: 'set_branch', path: 'apps/child', branch: null }); assert.equal((await getProjectGitSubmodules(f.cwd)).modules[0].branch, null);
  await git(f.cwd, 'config', 'submodule.apps/child.url', 'https://example.invalid/unused'); await f.run({ operation: 'sync', path: 'apps/child' });
  assert.equal(await git(f.cwd, 'config', 'submodule.apps/child.url'), alternate); assert.equal(await git(child, 'rev-parse', 'HEAD'), await git(f.source, 'rev-parse', 'HEAD'));
});

test('deinit retains recorded version and object database, update restores it and overrides custom update commands', async t => {
  const f = await fixture(t); const child = await f.add(); const recorded = await git(child, 'rev-parse', 'HEAD');
  await f.run({ operation: 'deinit', path: 'apps/child' }); assert.equal((await getProjectGitSubmodules(f.cwd)).modules[0].initialized, false);
  assert.ok((await git(f.cwd, 'ls-files', '--stage', '--', 'apps/child')).startsWith(`160000 ${recorded}`)); await access(join(f.cwd, '.git/modules/apps/child/objects'));
  await git(f.cwd, 'config', 'submodule.apps/child.update', `!touch '${join(f.root, 'unexpected')}'`);
  await f.run({ operation: 'update', path: 'apps/child', allowLocal: true }); assert.equal(await git(child, 'rev-parse', 'HEAD'), recorded); await assert.rejects(() => access(join(f.root, 'unexpected')));
  await git(child, 'config', 'user.name', 'Module Test'); await git(child, 'config', 'user.email', 'module@astragit.invalid'); await git(child, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(f.source, 'file.txt'), 'remote\n'); await git(f.source, 'commit', '-am', 'remote next');
  await f.run({ operation: 'update', path: 'apps/child', remote: true, allowLocal: true }); assert.equal(await git(child, 'rev-parse', 'HEAD'), await git(f.source, 'rev-parse', 'HEAD')); assert.notEqual(await git(child, 'rev-parse', 'HEAD'), recorded);
});

test('worktree removal refuses dirty, ignored and hidden modifications, then removes only a clean module', async t => {
  const f = await fixture(t); const child = await f.add(); const change = { operation: 'remove', path: 'apps/child', keepFiles: false };
  await writeFile(join(child, '.local-cache'), 'ignored'); await writeFile(join(child, '.gitignore'), '.local-cache\n');
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_DIRTY'); await rm(join(child, '.local-cache')); await rm(join(child, '.gitignore'));
  await git(child, 'update-index', '--assume-unchanged', 'file.txt'); await writeFile(join(child, 'file.txt'), 'hidden\n'); const index = await readFile(join(f.cwd, '.git/modules/apps/child/index'));
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_DIRTY'); assert.deepEqual(await readFile(join(f.cwd, '.git/modules/apps/child/index')), index);
  await writeFile(join(child, 'file.txt'), 'base\n'); await git(child, 'update-index', '--no-assume-unchanged', 'file.txt');
  await f.run(change); await assert.rejects(() => access(child)); await access(join(f.cwd, '.git/modules/apps/child/objects')); assert.equal(await git(f.cwd, 'config', '--file', '.gitmodules', '--list'), '');
});

test('frozen confirmation refuses child byte changes, parent index changes and changed options', async t => {
  const f = await fixture(t); const child = await f.add(); const change = { operation: 'set_branch', path: 'apps/child', branch: 'main' }; const preview = await f.preview(change);
  await writeFile(join(child, 'file.txt'), 'after preview\n'); await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CHANGED');
  await writeFile(join(child, 'file.txt'), 'base\n'); const next = await f.preview(change); await writeFile(join(f.cwd, 'new.txt'), 'new'); await git(f.cwd, 'add', 'new.txt');
  await assert.rejects(() => f.run(change, next.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CHANGED');
  const current = await f.preview(change); await assert.rejects(() => f.run({ ...change, branch: null }, current.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CHANGED');
});

test('shared unstaged edits are not swept into add or remove and partial writes report uncertainty', async t => {
  const f = await fixture(t); const child = await f.add(); const change = { operation: 'remove', path: 'apps/child', keepFiles: true };
  const original = await readFile(join(f.cwd, '.gitmodules')); await writeFile(join(f.cwd, '.gitmodules'), Buffer.concat([original, Buffer.from('\n# user draft\n')]));
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CONFIG_DIRTY'); assert.ok((await git(f.cwd, 'ls-files', '--', 'apps/child')).length);
  await writeFile(join(f.cwd, '.gitmodules'), original); const preview = await f.preview(change); await writeFile(join(f.cwd, '.gitmodules.lock'), 'other process');
  await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_OUTCOME_UNKNOWN' && error.operationStatus === 'unknown_after_write' && error.details.includes('completedCommands'));
  assert.equal(await git(f.cwd, 'ls-files', '--', 'apps/child'), ''); assert.equal(await readFile(join(child, 'file.txt'), 'utf8'), 'base\n');
});

test('literal special paths roundtrip while unsafe, overlapping and symlink paths are refused', async t => {
  const f = await fixture(t); const path = 'space dir/child\n[?]'; await f.add(path); assert.equal((await getProjectGitSubmodules(f.cwd)).modules[0].path, path);
  await f.run({ operation: 'remove', path, keepFiles: true }); assert.equal(await git(join(f.cwd, path), 'rev-parse', 'HEAD'), await git(f.source, 'rev-parse', 'HEAD'));
  for (const invalid of ['../outside', '/tmp/outside', '.git/config', 'a/.GiT/objects', 'a/../b', 'C:\\outside']) await assert.rejects(() => f.preview({ operation: 'add', path: invalid, url: f.source }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_PATH');
  await symlink(f.source, join(f.cwd, 'linked')); await assert.rejects(() => f.preview({ operation: 'add', path: 'linked/child', url: f.source }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_PATH');
  await f.add('actual'); await assert.rejects(() => f.preview({ operation: 'add', path: 'actual/nested', url: f.source }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_PATH');
});

test('HTTP preview is read-only and durable mutation replay after server restart never clones twice', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'submodule-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  let server = await startGitServer(options); f.closes.push(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Modules', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  assert.deepEqual((await client.loadRepositoryGitSubmodules(project.id, repository.id)).modules, []);
  const change = { operation: 'add', path: 'child', url: f.source, allowLocal: true }; const preview = await client.previewRepositoryGitSubmodule(project.id, repository.id, change);
  await assert.rejects(() => access(join(f.cwd, 'child'))); const action = { type: 'manage_submodule', change, expectedFingerprint: preview.fingerprint }; const request = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = () => fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/actions`, { method: 'POST', headers: { 'x-astragit-api-token': server.apiToken, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const first = await send(); assert.equal(first.status, 200); const result = await first.json(); assert.equal(result.result.outcome, 'completed');
  await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const replay = await send(); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), result); assert.equal((await client.loadRepositoryGitSubmodules(project.id, repository.id)).modules.length, 1);
});


test('the same child commit on a different branch invalidates preview, as does an adopted repository new empty commit', async t => {
  const f = await fixture(t); const child = await f.add(); const change = { operation: 'update', path: 'apps/child', strategy: 'merge' }; const preview = await f.preview(change);
  await git(child, 'switch', '-c', 'other-branch');
  await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CHANGED');
  const existing = join(f.cwd, 'existing'); await git(f.cwd, 'clone', f.source, existing); const adopt = { operation: 'add', path: 'existing', url: f.source, adoptExisting: true }; const initial = await f.preview(adopt); assert.equal(initial.existingHeadSha, await git(existing, 'rev-parse', 'HEAD'));
  await git(existing, 'config', 'user.name', 'Test'); await git(existing, 'config', 'user.email', 'test@astragit.invalid'); await git(existing, 'config', 'commit.gpgsign', 'false'); await git(existing, 'commit', '--allow-empty', '-m', 'same tree, new identity');
  await assert.rejects(() => f.run(adopt, initial.fingerprint), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CHANGED');
});

test('absorbing embedded Git metadata enables deinit without losing objects or worktree edits', async t => {
  const f = await fixture(t); const child = join(f.cwd, 'existing'); await git(f.cwd, 'clone', f.source, child); await f.run({ operation: 'add', path: 'existing', url: f.source, adoptExisting: true }); await git(f.cwd, 'commit', '-am', 'adopt');
  await assert.rejects(() => f.preview({ operation: 'deinit', path: 'existing' }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_BLOCKED');
  await writeFile(join(child, 'file.txt'), 'retained during absorption\n'); const head = await git(child, 'rev-parse', 'HEAD');
  await f.run({ operation: 'absorb', path: 'existing' }); assert.equal(await readFile(join(child, 'file.txt'), 'utf8'), 'retained during absorption\n'); assert.match(await readFile(join(child, '.git'), 'utf8'), /^gitdir:/u); assert.equal(await git(child, 'rev-parse', 'HEAD'), head);
  await writeFile(join(child, 'file.txt'), 'base\n'); await f.run({ operation: 'deinit', path: 'existing' }); await access(join(f.cwd, '.git/modules/existing/objects'));
});

test('nested ignored files block removal, and clean nested modules preserve their object databases', async t => {
  const f = await fixture(t); const child = await f.add(); await git(child, 'config', 'user.name', 'Nested Test'); await git(child, 'config', 'user.email', 'nested@astragit.invalid'); await git(child, 'config', 'commit.gpgsign', 'false');
  await git(child, '-c', 'protocol.file.allow=always', 'submodule', 'add', f.source, 'nested'); await git(child, 'commit', '-am', 'nested module'); await git(f.cwd, 'add', 'apps/child'); await git(f.cwd, 'commit', '-m', 'update gitlink');
  const nested = join(child, 'nested'); await git(nested, 'config', 'core.excludesFile', join(f.root, 'ignore')); await writeFile(join(f.root, 'ignore'), 'cache.tmp\n'); await writeFile(join(nested, 'cache.tmp'), 'nested cache');
  const change = { operation: 'remove', path: 'apps/child', keepFiles: false };
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_DIRTY'); assert.equal(await readFile(join(nested, 'cache.tmp'), 'utf8'), 'nested cache');
  await rm(join(nested, 'cache.tmp')); await f.run(change); await access(join(f.cwd, '.git/modules/apps/child/modules/nested/objects'));
});

test('cancelling an in-flight clone reports uncertain state without retrying or claiming rollback', async t => {
  const f = await fixture(t); const script = join(f.root, 'ssh-helper'); const marker = join(f.root, 'ssh-started');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(script, `#!/bin/sh\necho started > ${quote(marker)}\nsleep 20\nexit 1\n`, { mode: 0o755 });
  const change = { operation: 'add', path: 'cancelled', url: 'ssh://example.invalid/repository.git' }; const preview = await f.preview(change); const controller = new AbortController();
  const pending = executeProjectGitAction(f.cwd, { type: 'manage_submodule', change, expectedFingerprint: preview.fingerprint }, controller.signal, { ...env, GIT_SSH_COMMAND: quote(script), GIT_SSH_VARIANT: 'ssh' }).then(value => ({ value }), error => ({ error }));
  let started = false; for (let attempt = 0; attempt < 250; attempt += 1) { try { await access(marker); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); } }
  controller.abort(); const result = await pending; assert.equal(started, true); assert.equal(result.error?.code, 'ASTRAGIT_GIT_SUBMODULE_OUTCOME_UNKNOWN'); assert.equal(result.error?.operationStatus, 'unknown_after_write'); assert.equal(await git(f.cwd, 'ls-files', '--', 'cancelled'), '');
});


test('malformed shared names, duplicate paths and invalid typed options fail before any Git write', async t => {
  const f = await fixture(t); await f.add(); const before = await git(f.cwd, 'ls-files', '--stage');
  await git(f.cwd, 'config', '--file', '.gitmodules', 'submodule.duplicate.path', 'apps/child'); await assert.rejects(() => getProjectGitSubmodules(f.cwd), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CONFIG');
  await git(f.cwd, 'config', '--file', '.gitmodules', '--remove-section', 'submodule.duplicate'); await git(f.cwd, 'config', '--file', '.gitmodules', 'submodule.bad\tname.path', 'another');
  await assert.rejects(() => getProjectGitSubmodules(f.cwd), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_CONFIG');
  assert.equal(await git(f.cwd, 'ls-files', '--stage'), before);
  await assert.rejects(() => f.preview({ operation: 'update', path: 'apps/child', recursive: 'false' }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_INVALID');
  await assert.rejects(() => f.preview({ operation: ['update'], path: 'apps/child' }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_INVALID');
  await assert.rejects(() => f.preview({ operation: 'update', strategy: ['checkout'], path: 'apps/child' }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_INVALID');
});


test('updating a healthy module during unrelated parent conflicts preserves integration and reports the update itself completed', async t => {
  const f = await fixture(t); const child = await f.add(); await git(f.cwd, 'switch', '-c', 'incoming'); await writeFile(join(f.cwd, 'file.txt'), 'incoming\n'); await git(f.cwd, 'commit', '-am', 'incoming');
  await git(f.cwd, 'switch', 'main'); await writeFile(join(f.cwd, 'file.txt'), 'current\n'); await git(f.cwd, 'commit', '-am', 'current'); await assert.rejects(() => git(f.cwd, 'merge', 'incoming'));
  const mergeHead = await readFile(join(f.cwd, '.git/MERGE_HEAD')); const status = await raw(f.cwd, 'status', '--porcelain=v1', '-z'); const childHead = await git(child, 'rev-parse', 'HEAD');
  const result = await f.run({ operation: 'update', path: 'apps/child' }); assert.equal(result.outcome, 'completed'); assert.deepEqual(result.conflictFiles, ['file.txt']);
  assert.equal(await git(child, 'rev-parse', 'HEAD'), childHead); assert.deepEqual(await readFile(join(f.cwd, '.git/MERGE_HEAD')), mergeHead); assert.equal(await raw(f.cwd, 'status', '--porcelain=v1', '-z'), status);
  const legacy = await executeProjectGitAction(f.cwd, { type: 'submodule_update', path: 'apps/child' }, undefined, env); assert.equal(legacy.outcome, 'completed'); assert.deepEqual(legacy.conflictFiles, ['file.txt']);
  await assert.rejects(() => f.preview({ operation: 'remove', path: 'apps/child', keepFiles: true }), error => error.code === 'ASTRAGIT_GIT_SUBMODULE_BLOCKED');
});
