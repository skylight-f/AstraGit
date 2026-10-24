import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { getProjectGitFileLocation } from '../packages/git-core/dist/index.js';
import { createRepositoryFileLauncher } from '../apps/desktop/src/main/repositoryFileLauncher.ts';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { describeUserFacingError } from '../packages/shared/src/index.ts';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout.trim();
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-file-actions-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '--initial-branch=main'); await git(cwd, 'config', 'user.name', 'File Test'); await git(cwd, 'config', 'user.email', 'files@astragit.invalid'); await git(cwd, 'config', 'commit.gpgsign', 'false');
  await mkdir(join(cwd, 'folder')); await writeFile(join(cwd, 'folder/file.txt'), 'tracked\n'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'base');
  return { root, cwd, cleanup };
}

test('external file resolution handles tracked, untracked, directory and repository targets without changing files or index', async t => {
  const f = await fixture(t); const path = '空 格\t换\n行.txt'; await writeFile(join(f.cwd, path), 'untracked\n'); const index = await readFile(join(f.cwd, '.git/index'));
  for (const [path, isDirectory] of [['folder/file.txt', false], ['folder', true], ['', true]]) assert.deepEqual(await getProjectGitFileLocation(f.cwd, path, 'open'), { path: join(f.cwd, path), isDirectory, missingFile: false });
  assert.equal((await getProjectGitFileLocation(f.cwd, path, 'open')).path, join(f.cwd, path)); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await readFile(join(f.cwd, path), 'utf8'), 'untracked\n');
});

test('missing or staged-deleted files reveal an existing parent, while external opening explains that the file is missing', async t => {
  const f = await fixture(t); await git(f.cwd, 'rm', 'folder/file.txt');
  const location = await getProjectGitFileLocation(f.cwd, 'folder/file.txt', 'reveal'); assert.equal(location.missingFile, true); assert.equal(location.path, f.cwd);
  await assert.rejects(() => getProjectGitFileLocation(f.cwd, 'folder/file.txt', 'open'), error => error.code === 'ASTRAGIT_GIT_FILE_MISSING' && /Finder/u.test(describeUserFacingError(error).message));
  await writeFile(join(f.cwd, 'folder'), 'obstructing file\n'); assert.equal((await getProjectGitFileLocation(f.cwd, 'folder/file.txt', 'reveal')).path, f.cwd);
});

test('file resolution allows existing ignored files but rejects forged, metadata, traversal and symlink-ancestor paths', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, '.git/info/exclude'), 'ignored.txt\n'); await writeFile(join(f.cwd, 'ignored.txt'), 'ignored\n');
  assert.equal((await getProjectGitFileLocation(f.cwd, 'ignored.txt', 'open')).path, join(f.cwd, 'ignored.txt'));
  for (const path of ['../outside', '/etc/passwd', '.git/config', 'folder/../folder/file.txt', 'folder//file.txt', 'made-up.txt']) await assert.rejects(() => getProjectGitFileLocation(f.cwd, path, 'open'));
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'file.txt'), 'external\n'); await rm(join(f.cwd, 'folder'), { recursive: true }); await symlink(outside, join(f.cwd, 'folder'));
  await assert.rejects(() => getProjectGitFileLocation(f.cwd, 'folder/file.txt', 'open'), error => error.code === 'ASTRAGIT_GIT_PATH_INVALID'); assert.equal(await readFile(join(outside, 'file.txt'), 'utf8'), 'external\n');
  // A selected symlink itself can be revealed; no fabricated child path is allowed.
  assert.equal((await getProjectGitFileLocation(f.cwd, 'folder', 'reveal')).path, join(f.cwd, 'folder'));
});

test('desktop launch bridge invokes only the resolved target and returns structured OS errors', async t => {
  const f = await fixture(t); const calls = []; const launch = createRepositoryFileLauncher({ resolve: (_project, _repository, path, intent) => getProjectGitFileLocation(f.cwd, path, intent), open: async path => { calls.push(['open', path]); return ''; }, reveal: path => { calls.push(['reveal', path]); } });
  const request = { projectId: 'project', repositoryId: 'repo', path: 'folder/file.txt', intent: 'open' };
  assert.equal((await launch(request)).ok, true); assert.equal((await launch({ ...request, intent: 'reveal' })).ok, true); assert.deepEqual(calls, [['open', join(f.cwd, request.path)], ['reveal', join(f.cwd, request.path)]]);
  for (const input of [null, { ...request, intent: 'execute' }, { ...request, path: '../outside' }]) assert.equal((await launch(input)).ok, false); assert.equal(calls.length, 2);
  const denied = createRepositoryFileLauncher({ resolve: async () => ({ path: '/resolved/file', isDirectory: false, missingFile: false }), open: async () => 'No application can open this document', reveal: () => {} });
  const result = await denied(request); assert.equal(result.ok, false); assert.equal(result.error.code, 'ASTRAGIT_GIT_FILE_OPEN_FAILED'); assert.match(result.error.message, /No application/u);
});

test('desktop repository IDs are resolved through the live project service before any OS action', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'file-actions-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Files', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  assert.equal((await server.resolveGitFileLocation(project.id, repository.id, 'folder/file.txt', 'reveal')).path, join(f.cwd, 'folder/file.txt'));
  await assert.rejects(() => server.resolveGitFileLocation(project.id, 'wrong-repository', 'folder/file.txt', 'open')); await assert.rejects(() => server.resolveGitFileLocation('wrong-project', repository.id, '', 'reveal'));
});
