import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeProjectGitAction, getProjectGitPatchExport, getProjectGitPatchPreview } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { createPatchFileAccess } from '../apps/desktop/src/main/patchFileAccess.ts';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
async function fixture(t, unborn = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-patch-files-'))); const cwd = join(root, 'source'); await mkdir(cwd); const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const at = (path, ...args) => exec('git', args, { cwd: path, env }).then(result => result.stdout.trim()); const git = (...args) => at(cwd, ...args);
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Patch Test'); await git('config', 'user.email', 'patch@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'text.txt'), 'before\n'); await writeFile(join(cwd, 'binary.bin'), Buffer.from([0, 1, 255])); await writeFile(join(cwd, 'old\t中文.txt'), 'renamed\n');
  if (!unborn) { await git('add', '.'); await git('commit', '-m', 'base'); }
  const clone = async name => { const path = join(root, name); await at(root, 'clone', '--no-hardlinks', cwd, path); return path; };
  const apply = (path, patch, preview) => executeProjectGitAction(path, { type: 'import_patch', patch, expectedFingerprint: preview.fingerprint }, undefined, env);
  return { root, cwd, cleanup, git, at, clone, apply };
}
const input = (artifact, target = 'worktree', extra = {}) => ({ data: artifact.data, encoding: 'base64', target, ...extra });
const objectCount = async f => f.git('count-objects', '-v');

test('binary and rename export previews are read-only and import working contents without staging or moving HEAD', async t => {
  const f = await fixture(t); await f.git('mv', 'old\t中文.txt', 'new\n中文.txt'); await writeFile(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 2, 3])); await f.git('add', '.'); const index = await readFile(join(f.cwd, '.git/index')); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'staged' }); assert.ok(artifact.files.some(file => file.path === 'binary.bin' && file.additions === null)); assert.ok(artifact.affectedPaths.includes('old\t中文.txt')); assert.ok(artifact.affectedPaths.includes('new\n中文.txt')); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  const target = await f.clone('working'); const patch = input(artifact); const beforeIndex = await readFile(join(target, '.git/index')); const head = await f.at(target, 'rev-parse', 'HEAD'); const objects = await f.at(target, 'count-objects', '-v'); const preview = await getProjectGitPatchPreview(target, patch); assert.equal(preview.applicable, true); assert.deepEqual(await readFile(join(target, '.git/index')), beforeIndex); assert.equal(await f.at(target, 'count-objects', '-v'), objects); await f.apply(target, patch, preview);
  assert.deepEqual(await readFile(join(target, 'binary.bin')), Buffer.from([0, 255, 2, 3])); assert.equal(await readFile(join(target, 'new\n中文.txt'), 'utf8'), 'renamed\n'); await assert.rejects(() => lstat(join(target, 'old\t中文.txt')), error => error.code === 'ENOENT'); assert.deepEqual(await readFile(join(target, '.git/index')), beforeIndex); assert.equal(await f.at(target, 'rev-parse', 'HEAD'), head);
});

test('index-only imports retain later disk edits while both-mode imports require matching index and working versions', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'text.txt'), 'after\n'); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['text.txt'] });
  const target = await f.clone('index'); const patch = input(artifact, 'index'); const preview = await getProjectGitPatchPreview(target, patch); await writeFile(join(target, 'text.txt'), 'later local edit\n'); await f.apply(target, patch, preview); assert.equal(await f.at(target, 'show', ':text.txt'), 'after'); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'later local edit\n');
  const both = await f.clone('both'); const bothPatch = input(artifact, 'both'); const bothPreview = await getProjectGitPatchPreview(both, bothPatch); assert.equal(bothPreview.applicable, true); await f.apply(both, bothPatch, bothPreview); assert.equal(await f.at(both, 'show', ':text.txt'), 'after'); assert.equal(await readFile(join(both, 'text.txt'), 'utf8'), 'after\n');
  const dirty = await f.clone('dirty'); await writeFile(join(dirty, 'text.txt'), 'dirty\n'); const rejected = await getProjectGitPatchPreview(dirty, bothPatch); assert.equal(rejected.applicable, false); assert.match(rejected.diagnostics, /does not match index/u); assert.equal(await f.at(dirty, 'show', ':text.txt'), 'before');
});

test('stale files, staged versions and patch options reject the reviewed write and retain current data', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'text.txt'), 'after\n'); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['text.txt'] }); const target = await f.clone('stale'); const patch = input(artifact); const preview = await getProjectGitPatchPreview(target, patch); await writeFile(join(target, 'text.txt'), 'external\n'); await assert.rejects(() => f.apply(target, patch, preview), error => error.code === 'ASTRAGIT_GIT_PATCH_PREVIEW_CHANGED' && error.operationStatus === 'failed_before_write'); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'external\n');
  await writeFile(join(target, 'text.txt'), 'before\n'); const fresh = await getProjectGitPatchPreview(target, patch); await writeFile(join(target, 'unrelated.txt'), 'stage'); await f.at(target, 'add', 'unrelated.txt'); await assert.rejects(() => f.apply(target, patch, fresh), error => error.code === 'ASTRAGIT_GIT_PATCH_PREVIEW_CHANGED');
  const current = await getProjectGitPatchPreview(target, patch); await assert.rejects(() => f.apply(target, { ...patch, target: 'index' }, current), error => error.code === 'ASTRAGIT_GIT_PATCH_PREVIEW_CHANGED'); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'before\n');
});

test('plain unified patches support strip zero and reverse without discarding unrelated files', async t => {
  const f = await fixture(t); const patch = { data: '--- text.txt\n+++ text.txt\n@@ -1 +1 @@\n-before\n+after\n', encoding: 'utf8', target: 'worktree', strip: 0 }; const before = await objectCount(f); const preview = await getProjectGitPatchPreview(f.cwd, patch); assert.equal(preview.applicable, true); assert.equal(await objectCount(f), before); await f.apply(f.cwd, patch, preview); assert.equal(await readFile(join(f.cwd, 'text.txt'), 'utf8'), 'after\n'); const reverse = { ...patch, reverse: true }; await f.apply(f.cwd, reverse, await getProjectGitPatchPreview(f.cwd, reverse)); assert.equal(await readFile(join(f.cwd, 'text.txt'), 'utf8'), 'before\n'); assert.deepEqual(await readFile(join(f.cwd, 'binary.bin')), Buffer.from([0, 1, 255]));
});

test('exporting only a renamed destination includes its original removal without unrelated changes', async t => {
  const f = await fixture(t); await f.git('mv', 'old\t中文.txt', 'new\n中文.txt'); await writeFile(join(f.cwd, 'text.txt'), 'unrelated\n'); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['new\n中文.txt'] }); assert.deepEqual(artifact.affectedPaths, ['new\n中文.txt', 'old\t中文.txt'].sort()); const target = await f.clone('rename'); const patch = input(artifact); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.equal(await readFile(join(target, 'new\n中文.txt'), 'utf8'), 'renamed\n'); await assert.rejects(() => lstat(join(target, 'old\t中文.txt')), error => error.code === 'ENOENT'); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'before\n');
});

test('staged and unstaged exports keep their distinct versions and apply in order', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'text.txt'), 'staged\n'); await f.git('add', 'text.txt'); await writeFile(join(f.cwd, 'text.txt'), 'working\n'); const staged = await getProjectGitPatchExport(f.cwd, { scope: 'staged', paths: ['text.txt'] }); const unstaged = await getProjectGitPatchExport(f.cwd, { scope: 'unstaged', paths: ['text.txt'] }); const target = await f.clone('two-versions'); let patch = input(staged, 'both'); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.equal(await f.at(target, 'show', ':text.txt'), 'staged'); patch = input(unstaged); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'working\n'); assert.equal(await f.at(target, 'show', ':text.txt'), 'staged');
});

test('unborn and explicitly included untracked files export without creating commits or rewriting the index', async t => {
  const f = await fixture(t, true); await f.git('add', 'text.txt'); await writeFile(join(f.cwd, 'text.txt'), 'current unborn\n'); const before = await readFile(join(f.cwd, '.git/index')); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', includeUntracked: true }); assert.ok(artifact.files.some(file => file.path === 'binary.bin')); const reverse = input(artifact, 'worktree', { reverse: true }); assert.equal((await getProjectGitPatchPreview(f.cwd, reverse)).applicable, true); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before); await assert.rejects(() => f.git('rev-parse', '--verify', 'HEAD')); const without = await getProjectGitPatchExport(f.cwd, { scope: 'worktree' }); assert.deepEqual(without.affectedPaths, ['text.txt']);
});

test('non-UTF8 patch content survives export/import as raw bytes and user diff prefixes do not alter portable paths', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'text.txt'), Buffer.from([98, 101, 102, 111, 114, 101, 255, 10])); await f.git('config', 'diff.noprefix', 'true'); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['text.txt'] }); const target = await f.clone('non-utf8'); const patch = input(artifact); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.deepEqual(await readFile(join(target, 'text.txt')), Buffer.from([98, 101, 102, 111, 114, 101, 255, 10]));
});

test('unsafe and symbolic ancestor patch paths never write outside the repository; index-only mode stays independent', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'dir')); await writeFile(join(f.cwd, 'dir/file.txt'), 'old\n'); await f.git('add', '.'); await f.git('commit', '-m', 'directory'); await writeFile(join(f.cwd, 'dir/file.txt'), 'new\n'); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['dir/file.txt'] }); const target = await f.clone('links'); const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'file.txt'), 'outside\n'); await rm(join(target, 'dir'), { recursive: true }); await symlink(outside, join(target, 'dir'));
  await assert.rejects(() => getProjectGitPatchPreview(target, input(artifact)), error => error.code === 'ASTRAGIT_GIT_PATCH_PATH_INVALID'); const patch = input(artifact, 'index'); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.equal(await f.at(target, 'show', ':dir/file.txt'), 'new'); assert.equal(await readFile(join(outside, 'file.txt'), 'utf8'), 'outside\n');
  const staged = await getProjectGitPatchExport(target, { scope: 'staged', paths: ['dir/file.txt'] }); assert.ok(Buffer.from(staged.data, 'base64').toString().includes('+new\n')); assert.ok(!Buffer.from(staged.data, 'base64').toString().includes('outside'));
  for (const path of ['../outside/file.txt', '.git/config']) { const data = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`; await assert.rejects(() => getProjectGitPatchPreview(target, { data, encoding: 'utf8', target: 'worktree' }), error => error.code === 'ASTRAGIT_GIT_PATCH_PATH_INVALID' || error.code === 'ASTRAGIT_GIT_PATCH_READ_FAILED'); }
});

test('selected revisions and ranges export fixed commits even after the current worktree changes', async t => {
  const f = await fixture(t); const base = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'text.txt'), 'committed\n'); await f.git('add', '.'); await f.git('commit', '-m', 'change'); const revision = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'text.txt'), 'later\n');
  for (const query of [{ scope: 'commit', revision }, { scope: 'range', baseRef: base, targetRef: revision }]) { const artifact = await getProjectGitPatchExport(f.cwd, query); const target = await f.clone(query.scope); await f.at(target, 'checkout', '--detach', base); const patch = input(artifact); await f.apply(target, patch, await getProjectGitPatchPreview(target, patch)); assert.equal(await readFile(join(target, 'text.txt'), 'utf8'), 'committed\n'); }
});

test('native file access preserves binary bytes, verifies reviewed data, and cancellation creates no file', async t => {
  const f = await fixture(t); const source = join(f.root, 'patch.bin'); const destination = join(f.root, 'saved.patch'); const bytes = Buffer.from([0, 255, 65, 10]); await writeFile(source, bytes); const sha256 = createHash('sha256').update(bytes).digest('hex'); let saveCalls = 0;
  const access = createPatchFileAccess({ chooseOpen: async () => source, chooseSave: async () => { saveCalls++; return destination; } }); const read = await access.read(); assert.equal(read.ok, true); assert.deepEqual(Buffer.from(read.data, 'base64'), bytes); assert.equal((await access.save({ data: read.data, sha256: '0'.repeat(64), suggestedName: 'file.patch' })).ok, false); assert.equal(saveCalls, 0); assert.equal((await access.save({ data: read.data, sha256, suggestedName: 'file.patch' })).ok, true); assert.deepEqual(await readFile(destination), bytes);
  const canceled = createPatchFileAccess({ chooseOpen: async () => null, chooseSave: async () => null }); assert.equal((await canceled.read()).canceled, true); assert.equal((await canceled.save({ data: read.data, sha256, suggestedName: 'file.patch' })).canceled, true); assert.equal(saveCalls, 1);
});

test('HTTP previews and large imports use the addressed repository and durable receipts without reapplying', async t => {
  const f = await fixture(t); const large = 'data'.repeat(280_000) + '\n'; await writeFile(join(f.cwd, 'large.txt'), large); const artifact = await getProjectGitPatchExport(f.cwd, { scope: 'worktree', paths: ['large.txt'], includeUntracked: true }); const target = await f.clone('http'); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'patch-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); f.cleanup.push(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Patch', localPath: target }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const patch = input(artifact); const preview = await client.previewRepositoryGitPatch(project.id, repository.id, patch); assert.equal(preview.applicable, true); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
  await assert.rejects(() => client.previewRepositoryGitPatch(project.id, 'wrong', patch), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND'); const action = { type: 'import_patch', patch, expectedFingerprint: preview.fingerprint }; const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = async () => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/patch-import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); assert.equal(await readFile(join(target, 'large.txt'), 'utf8'), large); await writeFile(join(target, 'large.txt'), 'later user contents\n'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const replay = await send(); assert.equal(replay.status, 200); assert.deepEqual(replay.value, first.value); assert.equal(await readFile(join(target, 'large.txt'), 'utf8'), 'later user contents\n'); assert.equal((await client.loadProjectGitOperations(project.id)).items.filter(item => item.action === 'import_patch').length, 1);
});
