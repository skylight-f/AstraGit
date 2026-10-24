import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { executeProjectGitAction, getProjectGitStagePreview, getProjectGitLfsState, getProjectGitLfsPreview, parseGitLfsChange } from '../packages/git-core/dist/index.js';

const exec = promisify(execFile);
const lfsPath = process.env.ASTRAGIT_TEST_LFS_PATH;
let nativeAvailable = false;
try { const help = await exec('git', ['lfs', 'track', '-h'], { cwd: tmpdir(), env: { ...process.env, ...(lfsPath ? { PATH: dirname(lfsPath) + ':' + process.env.PATH } : {}), GIT_PAGER: 'cat' } }); nativeAvailable = /--json/u.test(help.stdout + help.stderr); } catch { /* Native tests declare the missing dependency explicitly. */ }
const native = { skip: !nativeAvailable && 'Install Git LFS with JSON query support or set ASTRAGIT_TEST_LFS_PATH for native tests.' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-lfs-')); const cwd = join(root, 'repository'); await mkdir(cwd);
  const global = join(root, 'global.gitconfig'); await writeFile(global, '');
  const saved = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  if (lfsPath) process.env.PATH = dirname(lfsPath) + ':' + saved.PATH;
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const raw = async (directory, ...args) => (await exec('git', args, { cwd: directory, env })).stdout;
  const git = async (...args) => (await raw(cwd, ...args)).trim();
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'LFS Test'); await git('config', 'user.email', 'lfs@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-qm', 'base');
  const preview = change => getProjectGitLfsPreview(cwd, change);
  const run = async (change, expected, signal) => executeProjectGitAction(cwd, { type: 'manage_lfs', change, expectedFingerprint: expected ?? (await preview(change)).fingerprint }, signal, env);
  return { root, cwd, global, env, git, raw, run, preview };
}

test('LFS options reject invalid operations, paths and option combinations', () => {
  for (const input of [null, [], { operation: ['track'] }, { operation: 'track', pattern: '../outside' }, { operation: 'track', pattern: '*.bin', directory: '.git' }, { operation: 'track', pattern: '*.bin', literal: 'yes' }, { operation: 'push', remote: 'origin', include: '*.bin' }, { operation: 'pull', skipHooks: true }]) assert.throws(() => parseGitLfsChange(input), error => error.code?.startsWith('ASTRAGIT_GIT_LFS_'));
});

test('missing native LFS is reported without modifying repository configuration', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const tools = join(f.root, 'git-only'); await mkdir(tools); const executable = (await exec('which', ['git'], { env: f.env })).stdout.trim(); await symlink(executable, join(tools, 'git'));
  const previousPath = process.env.PATH; const previousExec = process.env.GIT_EXEC_PATH; process.env.PATH = tools; process.env.GIT_EXEC_PATH = tools;
  const config = await readFile(join(f.cwd, '.git/config'));
  try {
    assert.equal((await getProjectGitLfsState(f.cwd)).available, false);
    await assert.rejects(() => getProjectGitLfsPreview(f.cwd, { operation: 'install' }), error => error.code === 'ASTRAGIT_GIT_LFS_UNAVAILABLE');
    assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config);
  } finally { process.env.PATH = previousPath; if (previousExec === undefined) delete process.env.GIT_EXEC_PATH; else process.env.GIT_EXEC_PATH = previousExec; }
});

test('LFS initialization configures only the repository and can preserve an existing pre-push hook', native, async t => {
  const f = await fixture(t); const hook = join(f.cwd, '.git/hooks/pre-push'); const custom = '#!/bin/sh\necho own-hook\n'; await writeFile(hook, custom);
  const config = await readFile(join(f.cwd, '.git/config'));
  assert.equal((await getProjectGitLfsState(f.cwd)).requiresInitialization, true); assert.equal((await getProjectGitLfsState(f.cwd)).requiresInitialization, true);
  assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config);
  const index = await readFile(join(f.cwd, '.git/index')); const head = await f.git('rev-parse', 'HEAD');
  const result = await f.run({ operation: 'install', skipHooks: true }); assert.equal(result.outcome, 'completed');
  assert.equal((await getProjectGitLfsState(f.cwd)).configured, true); assert.equal(await readFile(hook, 'utf8'), custom); assert.equal(await readFile(f.global, 'utf8'), '');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), head);
});

test('LFS track and untrack retain other attributes, index and file bytes without committing', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); await writeFile(join(f.cwd, '.gitattributes'), '# own rule\n*.txt text eol=lf\n');
  const data = Buffer.from([1, 0, 255, 2]); await writeFile(join(f.cwd, 'sample.bin'), data); const index = await readFile(join(f.cwd, '.git/index')); const head = await f.git('rev-parse', 'HEAD');
  await f.run({ operation: 'track', pattern: '*.bin' }); const state = await getProjectGitLfsState(f.cwd);
  assert.ok(state.patterns.some(rule => rule.pattern === '*.bin' && rule.source === '.gitattributes' && rule.tracked));
  assert.match(await readFile(join(f.cwd, '.gitattributes'), 'utf8'), /\*\.txt text eol=lf/u); assert.deepEqual(await readFile(join(f.cwd, 'sample.bin')), data);
  await f.run({ operation: 'untrack', pattern: '*.bin' }); assert.equal((await getProjectGitLfsState(f.cwd)).patterns.length, 0);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), head);
});

test('LFS literal filenames and nested attribute sources are passed to native Git LFS accurately', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); await mkdir(join(f.cwd, 'assets'));
  await f.run({ operation: 'track', directory: 'assets', pattern: 'part [1].bin', literal: true });
  const rules = (await getProjectGitLfsState(f.cwd)).patterns; assert.ok(rules.some(rule => rule.source === 'assets/.gitattributes' && rule.pattern.includes('part')));
  assert.equal(await f.git('check-attr', 'filter', '--', 'assets/part [1].bin'), 'assets/part [1].bin: filter: lfs');
  assert.equal(await f.git('check-attr', 'filter', '--', 'assets/part 1.bin'), 'assets/part 1.bin: filter: unspecified');
  // The API retains native display text and exposes the proper CLI input.
  assert.equal(rules[0].directory, 'assets'); assert.ok(rules[0].inputPattern);
  await f.run({ operation: 'untrack', directory: rules[0].directory, pattern: rules[0].inputPattern }); assert.equal((await getProjectGitLfsState(f.cwd)).patterns.length, 0);
});

test('LFS rule removal preserves unrelated attributes, CRLF and the index', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' });
  await writeFile(join(f.cwd, '.gitattributes'), '# own comment\r\n*.txt text eol=lf\r\n*.bin filter=lfs diff=lfs merge=lfs -text custom=kept\r\n');
  const index = await readFile(join(f.cwd, '.git/index')); await f.run({ operation: 'untrack', pattern: '*.bin' });
  assert.equal(await readFile(join(f.cwd, '.gitattributes'), 'utf8'), '# own comment\r\n*.txt text eol=lf\r\n*.bin custom=kept\r\n');
  assert.equal(await f.git('check-attr', 'filter', 'custom', '--', 'sample.bin'), 'sample.bin: filter: unspecified\nsample.bin: custom: kept');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('LFS rejects stale attributes, Git configuration and HEAD before updating rules', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); const change = { operation: 'track', pattern: '*.bin' };
  let preview = await f.preview(change); await writeFile(join(f.cwd, '.gitattributes'), '*.txt text\n');
  await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_LFS_CHANGED'); assert.equal(await readFile(join(f.cwd, '.gitattributes'), 'utf8'), '*.txt text\n');
  preview = await f.preview(change); await f.git('config', 'lfs.fetchinclude', '*.png'); await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_LFS_CHANGED');
  preview = await f.preview(change); await f.git('commit', '--allow-empty', '-qm', 'head moved'); await assert.rejects(() => f.run(change, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_LFS_CHANGED');
});

test('LFS refuses symlink attribute files and directory ancestors without changing their targets', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); const outside = join(f.root, 'outside'); await mkdir(outside); const attrs = join(outside, '.gitattributes'); await writeFile(attrs, 'own bytes\n');
  await symlink(attrs, join(f.cwd, '.gitattributes')); await assert.rejects(() => f.preview({ operation: 'track', pattern: '*.bin' }), error => error.code === 'ASTRAGIT_GIT_LFS_PATH');
  await rm(join(f.cwd, '.gitattributes')); await symlink(outside, join(f.cwd, 'linked')); await assert.rejects(() => f.preview({ operation: 'track', pattern: '*.bin', directory: 'linked' }), error => error.code === 'ASTRAGIT_GIT_LFS_PATH');
  assert.equal(await readFile(attrs, 'utf8'), 'own bytes\n');
});

test('LFS hook rejection reports partial configuration instead of claiming rollback or replacing the hook', native, async t => {
  const f = await fixture(t); const hook = join(f.cwd, '.git/hooks/pre-push'); const own = '#!/bin/sh\necho custom\n'; await writeFile(hook, own);
  await assert.rejects(() => f.run({ operation: 'install' }), error => error.code === 'ASTRAGIT_GIT_LFS_OUTCOME_UNKNOWN' && error.operationStatus === 'unknown_after_write');
  assert.equal(await readFile(hook, 'utf8'), own); assert.equal((await getProjectGitLfsState(f.cwd)).configured, true); assert.equal(await readFile(f.global, 'utf8'), '');
});

test('LFS push transfers only LFS objects, and fetch/pull restore exact current-version bytes from a real local remote', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); await f.run({ operation: 'track', pattern: '*.bin' });
  const bytes = Buffer.from([0, 1, 255, 13, 10, 3]); await writeFile(join(f.cwd, 'sample.bin'), bytes); await f.git('add', '.'); await f.git('commit', '-qm', 'large object');
  const bare = join(f.root, 'remote.git'); await exec('git', ['init', '--bare', bare], { env: f.env }); await f.git('remote', 'add', 'origin', bare);
  await f.run({ operation: 'push', remote: 'origin' }); await assert.rejects(() => f.raw(bare, 'rev-parse', '--verify', 'refs/heads/main'));
  await f.git('push', '-u', 'origin', 'main'); const clone = join(f.root, 'clone'); await exec('git', ['clone', '--branch', 'main', bare, clone], { env: { ...f.env, GIT_LFS_SKIP_SMUDGE: '1' } });
  assert.match(await readFile(join(clone, 'sample.bin'), 'utf8'), /^version https:\/\/git-lfs.github.com\/spec\/v1/u);
  const run = async operation => {
    const change = operation === 'install' ? { operation } : { operation, remote: 'origin' }; const preview = await getProjectGitLfsPreview(clone, change);
    return executeProjectGitAction(clone, { type: 'manage_lfs', change, expectedFingerprint: preview.fingerprint }, undefined, f.env);
  };
  assert.equal((await getProjectGitLfsState(clone)).requiresInitialization, true); await run('install');
  await run('fetch'); assert.match(await readFile(join(clone, 'sample.bin'), 'utf8'), /^version /u); await run('pull'); assert.deepEqual(await readFile(join(clone, 'sample.bin')), bytes);
  assert.equal(await f.raw(clone, 'status', '--porcelain'), '');
});

test('LFS HTTP queries are read-only and durable commands replay after restart without rewriting changed attributes', native, async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'lfs-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'LFS', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const config = await readFile(join(f.cwd, '.git/config')); assert.equal((await client.loadRepositoryGitLfs(project.id, repository.id)).requiresInitialization, true); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config);
  let change = { operation: 'install', skipHooks: true }; let preview = await client.previewRepositoryGitLfs(project.id, repository.id, change);
  assert.equal((await client.executeProjectGitAction(project.id, repository.id, { type: 'manage_lfs', change, expectedFingerprint: preview.fingerprint })).result.outcome, 'completed');
  change = { operation: 'track', pattern: '*.bin' }; preview = await client.previewRepositoryGitLfs(project.id, repository.id, change);
  const action = { type: 'manage_lfs', change, expectedFingerprint: preview.fingerprint }; const envelope = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = async (body, route = 'lfs') => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  assert.equal((await send(action)).status, 400); assert.equal((await send(envelope, 'actions')).status, 400); const first = await send(envelope); assert.equal(first.status, 200);
  await writeFile(join(f.cwd, '.gitattributes'), '# changed after receipt\n'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  assert.deepEqual(await send(envelope), first); assert.equal(await readFile(join(f.cwd, '.gitattributes'), 'utf8'), '# changed after receipt\n'); assert.equal((await client.loadRepositoryGitLfs(project.id, repository.id)).patterns.length, 0);
  await assert.rejects(() => readFile(join(f.cwd, '.git/hooks/pre-push')), error => error.code === 'ENOENT');
});


test('reviewed staging uses real Git LFS filters and stores a pointer while retaining original worktree bytes', native, async t => {
  const f = await fixture(t); await f.run({ operation: 'install' }); await f.run({ operation: 'track', pattern: '*.bin' });
  const bytes = Buffer.alloc(1024 ** 2 + 5, 0x61); await writeFile(join(f.cwd, 'object.bin'), bytes);
  const preview = await getProjectGitStagePreview(f.cwd, { paths: ['object.bin'], thresholdBytes: 1024 ** 2 });
  assert.deepEqual(preview.largeFiles, []); assert.equal(preview.lfsSetupRequired, false); assert.deepEqual(preview.lfsFiles, ['object.bin']);
  const result = await executeProjectGitAction(f.cwd, { type: 'stage', paths: ['object.bin'], largeFileReview: { thresholdBytes: preview.thresholdBytes, expectedFingerprint: preview.fingerprint } }, undefined, f.env);
  assert.equal(result.outcome, 'completed');
  assert.equal(await f.git('show', ':object.bin'), `version https://git-lfs.github.com/spec/v1\noid sha256:${createHash('sha256').update(bytes).digest('hex')}\nsize ${bytes.length}`);
  assert.deepEqual(await readFile(join(f.cwd, 'object.bin')), bytes);
});
