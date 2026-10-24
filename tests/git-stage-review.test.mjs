import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitStagePreview, parseGitLargeFileReview, parseGitStagePreviewInput } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { readGitLargeFilePreferences, saveGitLargeFilePreferences } from '../apps/desktop/src/renderer/git/gitLargeFilePreferences.ts';

const exec = promisify(execFile); const MiB = 1024 ** 2;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-stage-review-')); const cwd = join(root, 'repository'); await mkdir(cwd);
  const global = join(root, 'global.gitconfig'); await writeFile(global, '');
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const git = async (...args) => (await exec('git', args, { cwd, env, maxBuffer: 20 * MiB })).stdout.trim();
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'Stage Test'); await git('config', 'user.email', 'stage@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-qm', 'base');
  const preview = (paths, extra = {}) => getProjectGitStagePreview(cwd, { paths, thresholdBytes: MiB, ...extra });
  const stage = (paths, extra = {}) => executeProjectGitAction(cwd, { type: 'stage', paths, ...extra }, undefined, env);
  const reviewed = value => ({ largeFileReview: { thresholdBytes: value.thresholdBytes, expectedFingerprint: value.fingerprint } });
  return { root, cwd, global, env, git, preview, stage, reviewed };
}

test('staging review validates options without coercing unsafe ranges or flags', () => {
  for (const value of [null, [], { skipWarning: 'false' }, { thresholdBytes: 0 }, { thresholdBytes: 1024 ** 3 + 1 }, { expectedFingerprint: 'old' }]) assert.throws(() => parseGitLargeFileReview(value), error => error.code === 'ASTRAGIT_GIT_STAGE_INVALID');
  for (const value of [null, [], { paths: [] }, { paths: ['a'], forceIgnored: 'true' }, { paths: ['a'], thresholdBytes: NaN }]) assert.throws(() => parseGitStagePreviewInput(value), error => error.code === 'ASTRAGIT_GIT_STAGE_INVALID');
  assert.throws(() => parseGitStagePreviewInput({ paths: ['../outside'] })); assert.throws(() => parseGitStagePreviewInput({ paths: ['.git/config'] }));
});

test('small-file staging remains available, and review is read-only even on an unborn branch', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'small.txt'), 'small\n');
  const index = await readFile(join(f.cwd, '.git/index')); const config = await readFile(join(f.cwd, '.git/config')); const before = await f.git('rev-parse', 'HEAD');
  const preview = await f.preview(['small.txt']); assert.deepEqual(preview.largeFiles, []); assert.equal(preview.lfsSetupRequired, false);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.equal(await f.git('rev-parse', 'HEAD'), before);
  await assert.rejects(() => readFile(join(f.cwd, '.git/hooks/pre-push')), error => error.code === 'ENOENT');
  assert.equal((await f.stage(['small.txt'])).outcome, 'completed'); assert.equal(await f.git('show', ':small.txt'), 'small');
  const unborn = join(f.root, 'unborn'); await mkdir(unborn); await exec('git', ['init', '-q', '--initial-branch=main'], { cwd: unborn, env: f.env }); await writeFile(join(unborn, 'file.txt'), 'new\n');
  assert.equal((await getProjectGitStagePreview(unborn, { paths: ['.'] })).headSha, ''); assert.equal((await executeProjectGitAction(unborn, { type: 'stage', paths: ['.'] }, undefined, f.env)).outcome, 'completed');
});

test('large-file staging requires an explicit ordinary-Git confirmation and preserves exact staged bytes', async t => {
  const f = await fixture(t); const bytes = Buffer.alloc(MiB + 7, 0x61); await writeFile(join(f.cwd, 'large.bin'), bytes); const index = await readFile(join(f.cwd, '.git/index'));
  const preview = await f.preview(['large.bin']); assert.deepEqual(preview.largeFiles, [{ path: 'large.bin', byteLength: bytes.length }]);
  await assert.rejects(() => f.stage(['large.bin'], { largeFileReview: { thresholdBytes: MiB } }), error => error.code === 'ASTRAGIT_GIT_STAGE_LARGE_FILES' && error.operationStatus === 'failed_before_write');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  assert.equal((await f.stage(['large.bin'], f.reviewed(preview))).outcome, 'completed');
  assert.equal(await f.git('rev-parse', ':large.bin'), await f.git('hash-object', 'large.bin')); assert.deepEqual(await readFile(join(f.cwd, 'large.bin')), bytes);
  await writeFile(join(f.cwd, 'default.bin'), Buffer.alloc(10 * MiB, 0x62));
  await assert.rejects(() => f.stage(['default.bin']), error => error.code === 'ASTRAGIT_GIT_STAGE_LARGE_FILES');
});

test('directory and literal special-name selections include all files without treating names as globs', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'assets')); await writeFile(join(f.cwd, 'assets', 'part [1]\n字.bin'), Buffer.alloc(MiB, 0x63)); await writeFile(join(f.cwd, 'assets', 'small.txt'), 'small\n');
  await writeFile(join(f.cwd, 'star*.bin'), Buffer.alloc(MiB, 0x64)); await writeFile(join(f.cwd, 'star-other.bin'), Buffer.alloc(MiB, 0x65));
  const directory = await f.preview(['assets/']); assert.equal(directory.largeFiles[0].path, 'assets/part [1]\n字.bin'); assert.deepEqual(directory.paths, ['assets']);
  await f.stage(['assets/'], f.reviewed(directory)); assert.equal(await f.git('show', ':assets/small.txt'), 'small');
  const literal = await f.preview(['star*.bin']); assert.deepEqual(literal.largeFiles.map(file => file.path), ['star*.bin']); await f.stage(['star*.bin'], f.reviewed(literal));
  assert.equal(await f.git('ls-files', '--', 'star-other.bin'), ''); assert.equal(await f.git('--literal-pathspecs', 'rev-parse', ':star*.bin'), await f.git('--literal-pathspecs', 'hash-object', 'star*.bin'));
});

test('review changes in files, attributes, index, configuration and branch are refused before staging', async t => {
  const f = await fixture(t); const path = join(f.cwd, 'large.bin'); await writeFile(path, Buffer.alloc(MiB, 0x61));
  const changes = [
    () => writeFile(path, Buffer.alloc(MiB + 1, 0x62)),
    () => writeFile(join(f.cwd, '.gitattributes'), '*.bin -filter\n'),
    () => f.git('update-index', '--assume-unchanged', 'base.txt'),
    () => f.git('config', 'core.autocrlf', 'false'),
    () => f.git('branch', '-m', 'renamed'),
    () => f.git('commit', '--allow-empty', '-qm', 'head changed'),
  ];
  for (const change of changes) {
    const preview = await f.preview(['large.bin']); await change(); const index = await readFile(join(f.cwd, '.git/index'));
    await assert.rejects(() => f.stage(['large.bin'], f.reviewed(preview)), error => error.code === 'ASTRAGIT_GIT_STAGE_CHANGED' && error.operationStatus === 'failed_before_write');
    assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('ls-files', '--', 'large.bin'), '');
  }
});

test('confirmation is bound to the exact threshold, selection and force-ignored mode', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'large.bin'), Buffer.alloc(MiB, 0x61)); await writeFile(join(f.cwd, 'small.txt'), 'small');
  const preview = await f.preview(['large.bin']);
  await assert.rejects(() => f.stage(['large.bin', 'small.txt'], f.reviewed(preview)), error => error.code === 'ASTRAGIT_GIT_STAGE_CHANGED');
  await assert.rejects(() => f.stage(['large.bin'], { largeFileReview: { expectedFingerprint: preview.fingerprint, thresholdBytes: 2 * MiB } }), error => error.code === 'ASTRAGIT_GIT_STAGE_CHANGED');
  const forced = await f.preview(['large.bin'], { forceIgnored: true }); await assert.rejects(() => f.stage(['large.bin'], f.reviewed(forced)), error => error.code === 'ASTRAGIT_GIT_STAGE_CHANGED');
});

test('force staging an ignored directory warns, then stages its original scope without changing ignore rules', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, '.gitignore'), '/cache/\n'); await mkdir(join(f.cwd, 'cache')); await writeFile(join(f.cwd, 'cache', 'large.bin'), Buffer.alloc(MiB, 0x61)); await writeFile(join(f.cwd, 'cache', 'small.txt'), 'small');
  assert.equal((await f.preview(['cache'])).largeFiles.length, 0);
  const preview = await f.preview(['cache'], { forceIgnored: true }); assert.equal(preview.largeFiles.length, 1);
  const action = { type: 'stage_ignored', paths: ['cache'], largeFileReview: { thresholdBytes: MiB } }; const index = await readFile(join(f.cwd, '.git/index'));
  await assert.rejects(() => executeProjectGitAction(f.cwd, action, undefined, f.env), error => error.code === 'ASTRAGIT_GIT_STAGE_LARGE_FILES'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  assert.equal((await executeProjectGitAction(f.cwd, { ...action, ...f.reviewed(preview) }, undefined, f.env)).outcome, 'completed'); assert.equal(await f.git('show', ':cache/small.txt'), 'small'); assert.equal(await readFile(join(f.cwd, '.gitignore'), 'utf8'), '/cache/\n');
});

test('LFS attributes exclude files from the warning and require effective clean/process configuration even if warnings are suppressed', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, '.gitattributes'), '*.bin filter=lfs\n'); await writeFile(join(f.cwd, 'small.bin'), 'small\n'); await writeFile(join(f.cwd, 'large.bin'), Buffer.alloc(MiB, 0x61));
  const preview = await f.preview(['small.bin', 'large.bin']); assert.deepEqual(preview.largeFiles, []); assert.equal(preview.lfsSetupRequired, true); assert.equal(preview.lfsFiles.length, 2);
  await assert.rejects(() => f.stage(['small.bin', 'large.bin'], { largeFileReview: { ...f.reviewed(preview).largeFileReview, skipWarning: true } }), error => error.code === 'ASTRAGIT_GIT_STAGE_LFS_SETUP');
  await f.git('config', 'filter.lfs.clean', 'cat'); const ready = await f.preview(['small.bin']); assert.equal(ready.lfsSetupRequired, false); await f.stage(['small.bin'], f.reviewed(ready)); assert.equal(await f.git('show', ':small.bin'), 'small');
});

test('symlink leaves do not inspect outside large targets, but replaced directory ancestors are refused', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'large.bin'), Buffer.alloc(MiB, 0x61)); await symlink(join(outside, 'large.bin'), join(f.cwd, 'link.bin'));
  const preview = await f.preview(['link.bin']); assert.deepEqual(preview.largeFiles, []); await f.stage(['link.bin'], f.reviewed(preview)); assert.match(await f.git('ls-files', '--stage', '--', 'link.bin'), /^120000 /u);
  await mkdir(join(f.cwd, 'folder')); await writeFile(join(f.cwd, 'folder', 'large.bin'), 'inside'); await f.git('add', 'folder/large.bin'); await rm(join(f.cwd, 'folder'), { recursive: true }); await symlink(outside, join(f.cwd, 'folder'));
  const index = await readFile(join(f.cwd, '.git/index')); await assert.rejects(() => f.preview(['folder']), error => error.code === 'ASTRAGIT_GIT_STAGE_PATH'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal((await readFile(join(outside, 'large.bin'))).length, MiB);
});

test('staging deletions, gitlinks and ignored nested repositories preserves native Git behavior', async t => {
  const f = await fixture(t); await rm(join(f.cwd, 'base.txt')); const deletion = await f.preview(['base.txt']); await f.stage(['base.txt'], f.reviewed(deletion)); assert.equal(await f.git('ls-files', '--', 'base.txt'), '');
  await writeFile(join(f.cwd, '.gitignore'), '/nested/\n'); const nested = join(f.cwd, 'nested'); await mkdir(nested); const run = async (...args) => exec('git', args, { cwd: nested, env: f.env });
  await run('init', '-q', '--initial-branch=main'); await run('config', 'user.name', 'Nested'); await run('config', 'user.email', 'nested@astragit.invalid'); await writeFile(join(nested, 'file.txt'), 'nested'); await run('add', '.'); await run('commit', '-qm', 'nested');
  const preview = await f.preview(['nested'], { forceIgnored: true }); await executeProjectGitAction(f.cwd, { type: 'stage_ignored', paths: ['nested'], ...f.reviewed(preview) }, undefined, f.env); assert.match(await f.git('ls-files', '--stage', '--', 'nested'), /^160000 /u);
});

test('cancelled stage preview reports a before-write result and leaves the index intact', async t => {
  const f = await fixture(t); const index = await readFile(join(f.cwd, '.git/index')); const controller = new AbortController(); controller.abort();
  await assert.rejects(() => getProjectGitStagePreview(f.cwd, { paths: ['.'] }, controller.signal), error => error.operationStatus === 'failed_before_write'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('HTTP stage preview is read-only and a reviewed durable action replays without staging newer file bytes', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'large.bin'), Buffer.alloc(MiB, 0x61)); const data = join(f.root, 'data');
  const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'stage-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'Stage', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const index = await readFile(join(f.cwd, '.git/index')); const preview = await client.previewProjectGitStage(project.id, repository.id, { paths: ['large.bin'], thresholdBytes: MiB }); assert.equal(preview.largeFiles.length, 1); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  await assert.rejects(() => client.previewProjectGitStage(project.id, repository.id, { paths: ['large.bin'], thresholdBytes: 0 }), error => error.error === 'ASTRAGIT_GIT_STAGE_INVALID');
  const envelope = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: { type: 'stage', paths: ['large.bin'], ...f.reviewed(preview) } });
  const send = async () => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(envelope) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); const staged = await f.git('rev-parse', ':large.bin'); await writeFile(join(f.cwd, 'large.bin'), Buffer.alloc(MiB, 0x62));
  await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  assert.deepEqual(await send(), first); assert.equal(await f.git('rev-parse', ':large.bin'), staged); assert.notEqual(staged, await f.git('hash-object', 'large.bin'));
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'stage', paths: ['large.bin'], largeFileReview: { skipWarning: 'true' } }), error => error.error === 'ASTRAGIT_GIT_STAGE_INVALID');
});

test('large-file preferences persist valid values, reject corrupt data and retain session-only choices on storage failure', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); let stored = null; let unavailable = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { if (unavailable) throw new Error('storage unavailable'); return stored; }, setItem: (_, value) => { if (unavailable) throw new Error('storage unavailable'); stored = value; } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  assert.deepEqual(readGitLargeFilePreferences(), { enabled: true, thresholdMiB: 10 }); stored = '{invalid'; assert.equal(readGitLargeFilePreferences().thresholdMiB, 10); stored = JSON.stringify({ enabled: true, thresholdMiB: 0 }); assert.equal(readGitLargeFilePreferences().thresholdMiB, 10);
  assert.equal(saveGitLargeFilePreferences({ enabled: false, thresholdMiB: 25 }), true); assert.deepEqual(JSON.parse(stored), { enabled: false, thresholdMiB: 25 });
  stored = JSON.stringify({ enabled: true, thresholdMiB: 100 }); assert.equal(readGitLargeFilePreferences().thresholdMiB, 100); assert.throws(() => saveGitLargeFilePreferences({ enabled: true, thresholdMiB: 2048 }));
  unavailable = true; assert.equal(saveGitLargeFilePreferences({ enabled: false, thresholdMiB: 50 }), false); assert.deepEqual(readGitLargeFilePreferences(), { enabled: false, thresholdMiB: 50 });
});


test('suppressing the advisory permits ordinary staging at the configured threshold without an LFS rule', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'large.bin'), Buffer.alloc(MiB + 1, 0x61));
  assert.equal((await f.preview(['large.bin'])).largeFiles.length, 1);
  assert.equal((await f.stage(['large.bin'], { largeFileReview: { thresholdBytes: MiB, skipWarning: true } })).outcome, 'completed');
  assert.equal(await f.git('rev-parse', ':large.bin'), await f.git('hash-object', 'large.bin'));
  await assert.rejects(() => readFile(join(f.cwd, '.gitattributes')), error => error.code === 'ENOENT');
});
