import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { RepositorySetupService } from '../packages/git-server/dist/repositorySetupService.js';
import { ProjectStore } from '../packages/git-server/dist/projectStore.js';
import { setupGitRepository } from '../packages/git-core/dist/index.js';
import { gitRemoteAddressIssue } from '../packages/shared/src/repositorySetup.ts';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: undefined, GIT_WORK_TREE: undefined } })).stdout.trim();
async function until(read, done, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for setup evidence');
}
const finished = job => !['running', 'cancelling'].includes(job.status);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-repository-setup-'));
  const source = join(root, 'source'); const data = join(root, 'data');
  await mkdir(source); await git(source, 'init', '--initial-branch=main');
  await git(source, 'config', 'user.name', 'Setup Test'); await git(source, 'config', 'user.email', 'setup@astragit.invalid'); await git(source, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(source, 'readme.txt'), 'source data\n'); await git(source, 'add', '.'); await git(source, 'commit', '-m', 'base');
  const server = await startGitServer({ dataDirectory: data, projectRoot: root, apiToken: 'setup-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const complete = id => until(() => client.loadRepositorySetup(id), finished);
  return { root, source, data, server, client, complete };
}

test('setup address validation rejects credentials, control characters and executable transport helpers', () => {
  for (const value of ['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'ssh://git@example.invalid/path/repo', '/tmp/local source', 'file:///tmp/local-source']) assert.equal(gitRemoteAddressIssue(value), null, value);
  for (const value of ['ext::sh -c echo', '-u', 'https://host/repo\n--upload-pack=bad', 'ssh://-bad/repo']) assert.equal(gitRemoteAddressIssue(value), 'invalid', value);
  for (const value of ['https://user:password@host/repo', 'https://token@host/repo', 'https://host/repo?token=value']) assert.equal(gitRemoteAddressIssue(value), 'credentials', value);
});

test('HTTP clone supports selected branch and shallow history, opens a real workbench and never replays an existing job', async t => {
  const f = await fixture(t);
  await git(f.source, 'switch', '-c', 'feature/setup'); await writeFile(join(f.source, 'readme.txt'), 'feature data\n'); await git(f.source, 'add', '.'); await git(f.source, 'commit', '-m', 'feature');
  const input = { requestId: randomUUID(), kind: 'clone', localPath: join(f.root, 'cloned repository'), source: `file://${f.source}`, branch: 'feature/setup', depth: 1, name: 'Cloned fixture' };
  const started = await f.client.startRepositorySetup(input); assert.equal(started.id, input.requestId);
  const job = await f.complete(started.id); assert.equal(job.status, 'completed'); assert.ok(job.projectId);
  assert.equal(await git(job.localPath, 'branch', '--show-current'), 'feature/setup'); assert.equal(await git(job.localPath, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(await readFile(join(job.localPath, 'readme.txt'), 'utf8'), 'feature data\n');
  assert.equal((await f.client.loadProjectGitWorkbench(job.projectId)).repositories[0].snapshot.branch, 'feature/setup');
  assert.equal((await f.client.startRepositorySetup(input)).status, 'completed');
  assert.equal((await f.client.loadProjects()).filter(project => project.localPath === job.localPath).length, 1);
  await assert.rejects(() => f.client.startRepositorySetup({ ...input, branch: 'main' }), error => error.error === 'ASTRAGIT_REPOSITORY_SETUP_CONFLICT');
});

test('initializing retains source files without staging/committing and refuses to reinitialize an existing repository', async t => {
  const f = await fixture(t); const destination = join(f.root, 'existing code'); await mkdir(destination); await writeFile(join(destination, 'keep.txt'), 'must survive\n');
  const input = { requestId: randomUUID(), kind: 'init', localPath: destination, branch: 'feature/start' };
  await f.client.startRepositorySetup(input); const job = await f.complete(input.requestId); assert.equal(job.status, 'completed');
  assert.equal(await git(destination, 'branch', '--show-current'), 'feature/start'); assert.equal(await git(destination, 'status', '--porcelain'), '?? keep.txt');
  await assert.rejects(() => git(destination, 'rev-parse', '--verify', 'HEAD'));
  const config = await readFile(join(destination, '.git/config'), 'utf8');
  const duplicate = { ...input, requestId: randomUUID(), branch: 'changed' }; await f.client.startRepositorySetup(duplicate);
  const refused = await f.complete(duplicate.requestId); assert.equal(refused.status, 'failed'); assert.equal(refused.error.code, 'ASTRAGIT_REPOSITORY_ALREADY_INITIALIZED');
  assert.equal(await readFile(join(destination, '.git/config'), 'utf8'), config); assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'must survive\n');
});

test('clone refuses nonempty targets and invalid options before changing destination files', async t => {
  const f = await fixture(t); const destination = join(f.root, 'keep'); await mkdir(destination); await writeFile(join(destination, 'important.txt'), 'keep');
  const input = { requestId: randomUUID(), kind: 'clone', source: f.source, localPath: destination };
  await f.client.startRepositorySetup(input); const refused = await f.complete(input.requestId);
  assert.equal(refused.error.code, 'ASTRAGIT_CLONE_DESTINATION_NOT_EMPTY'); assert.equal(await readFile(join(destination, 'important.txt'), 'utf8'), 'keep');
  const invalid = { ...input, requestId: randomUUID(), localPath: join(f.root, 'invalid'), source: 'https://token:password@host/repo' };
  await f.client.startRepositorySetup(invalid); assert.equal((await f.complete(invalid.requestId)).error.code, 'ASTRAGIT_GIT_REMOTE_CREDENTIALS_IN_URL');
  await assert.rejects(() => readFile(join(invalid.localPath, '.git/config')));
});

test('cancelling a real pending Git HTTP clone stops it, retains the job and does not replay on reconnect', async t => {
  const f = await fixture(t); let requests = 0;
  const remote = createServer(() => { requests += 1; });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  t.after(async () => { remote.closeAllConnections(); await new Promise(resolve => remote.close(resolve)); });
  const input = { requestId: randomUUID(), kind: 'clone', source: `http://127.0.0.1:${remote.address().port}/repo.git`, localPath: join(f.root, 'pending') };
  await f.client.startRepositorySetup(input); await until(async () => requests, count => count > 0);
  assert.equal(f.server.hasActiveRepositorySetup(), true);
  assert.equal((await f.client.startRepositorySetup(input)).id, input.requestId);
  const other = { ...input, requestId: randomUUID() }; await f.client.startRepositorySetup(other);
  assert.equal((await f.complete(other.requestId)).error.code, 'ASTRAGIT_BUSY');
  await f.client.cancelRepositorySetup(input.requestId); const stopped = await f.complete(input.requestId);
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.projectId, undefined);
  await until(async () => f.server.hasActiveRepositorySetup(), value => value === false);
  assert.equal((await f.client.startRepositorySetup(input)).status, 'cancelled'); assert.equal(requests, 1);
});

test('a previous running job becomes unconfirmed after restart and is never automatically restarted', async t => {
  const f = await fixture(t); const isolatedData = join(f.root, 'recovery-data'); await mkdir(isolatedData);
  const id = randomUUID(); const destination = join(f.root, 'incomplete'); await mkdir(destination); await writeFile(join(destination, 'partial.txt'), 'preserve');
  await writeFile(join(isolatedData, 'repository-setup-jobs.json'), JSON.stringify([{ id, kind: 'clone', localPath: destination, status: 'running', output: '', startedAt: new Date().toISOString(), fingerprint: 'a'.repeat(64) }]));
  const service = new RepositorySetupService(isolatedData, new ProjectStore(isolatedData)); t.after(() => service.close());
  assert.equal(service.get(id).status, 'interrupted'); assert.equal(service.get(id).error.code, 'ASTRAGIT_REPOSITORY_SETUP_INTERRUPTED');
  assert.equal(await readFile(join(destination, 'partial.txt'), 'utf8'), 'preserve'); assert.equal(new ProjectStore(isolatedData).list().length, 0);
});

test('pruning recent setup logs retains old job identities so a delayed request cannot run Git again', async t => {
  const f = await fixture(t); const data = join(f.root, 'history-data'); await mkdir(data);
  const old = { requestId: randomUUID(), kind: 'init', localPath: join(f.root, 'previously-deleted-destination'), name: '', source: '', branch: '', recursive: false };
  const fingerprint = createHash('sha256').update(JSON.stringify(old)).digest('hex');
  const record = { id: old.requestId, kind: 'init', localPath: old.localPath, status: 'completed', output: 'old output', startedAt: new Date().toISOString(), projectId: 'previous-project', fingerprint };
  const previous = Array.from({ length: 99 }, () => ({ ...record, id: randomUUID() }));
  await writeFile(join(data, 'repository-setup-jobs.json'), JSON.stringify([...previous, record]));
  const service = new RepositorySetupService(data, new ProjectStore(data)); t.after(() => service.close());
  const next = { requestId: randomUUID(), kind: 'init', localPath: join(f.root, 'new-setup') }; service.start(next);
  await until(async () => service.get(next.requestId), finished);
  assert.equal(service.list().length, 100); assert.ok(!service.list().some(job => job.id === old.requestId));
  assert.equal(service.start(old).projectId, 'previous-project'); assert.equal(service.get(old.requestId).output, '');
  await assert.rejects(() => readFile(join(old.localPath, '.git/config')));
  await service.close();
  const reopened = new RepositorySetupService(data, new ProjectStore(data)); t.after(() => reopened.close());
  assert.equal(reopened.start(old).status, 'completed'); assert.equal(reopened.isBusy(), false);
});

test('setup clears inherited Git destination variables so initialization cannot target another repository', async t => {
  const f = await fixture(t); const before = await git(f.source, 'rev-parse', 'HEAD');
  const original = process.env.GIT_DIR; process.env.GIT_DIR = join(f.source, '.git');
  t.after(() => { if (original === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = original; });
  const destination = join(f.root, 'clean destination');
  await setupGitRepository({ requestId: randomUUID(), kind: 'init', localPath: destination, branch: 'new-main' });
  assert.equal(await git(destination, 'branch', '--show-current'), 'new-main'); assert.equal(await git(f.source, 'rev-parse', 'HEAD'), before);
});
