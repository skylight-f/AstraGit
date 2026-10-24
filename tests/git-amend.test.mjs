import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
async function fixture(t, commit = true) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-amend-'));
  const cwd = join(root, 'repository'); await mkdir(cwd);
  await git(cwd, 'init', '--initial-branch=main');
  await git(cwd, 'config', 'user.name', 'Amend Test'); await git(cwd, 'config', 'user.email', 'amend@astragit.invalid'); await git(cwd, 'config', 'commit.gpgsign', 'false');
  if (commit) { await writeFile(join(cwd, 'file.txt'), 'base\n'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'original subject\n\noriginal body'); }
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd };
}
async function reviewed(cwd, message = 'amended subject\n\namended body') {
  const snapshot = await getProjectGitRepositorySnapshot(cwd);
  return { type: 'amend_commit', message, expectedHeadSha: snapshot.headSha, expectedBranch: snapshot.branch, expectedIndexFingerprint: snapshot.indexFingerprint };
}

test('message-only amend replaces the root commit while preserving its tree, author and unstaged files', async t => {
  const { cwd } = await fixture(t); const action = await reviewed(cwd);
  const tree = await git(cwd, 'rev-parse', 'HEAD^{tree}'); const author = await git(cwd, 'show', '-s', '--format=%an <%ae> %aI', 'HEAD');
  await writeFile(join(cwd, 'file.txt'), 'unstaged\n'); await writeFile(join(cwd, 'new.txt'), 'untracked\n');
  const result = await executeProjectGitAction(cwd, action);
  assert.equal(result.outcome, 'completed'); assert.notEqual(result.headSha, action.expectedHeadSha);
  assert.equal(await git(cwd, 'rev-list', '--count', 'HEAD'), '1'); assert.equal(await git(cwd, 'rev-parse', 'HEAD^{tree}'), tree);
  assert.equal(await git(cwd, 'show', '-s', '--format=%an <%ae> %aI', 'HEAD'), author);
  assert.equal(await git(cwd, 'log', '-1', '--format=%B'), action.message);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'unstaged\n'); assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'untracked\n');
});

test('amend commits the reviewed index while keeping later unstaged edits and untracked files', async t => {
  const { cwd } = await fixture(t);
  await writeFile(join(cwd, 'file.txt'), 'staged\n'); await git(cwd, 'add', 'file.txt'); const action = await reviewed(cwd);
  await writeFile(join(cwd, 'file.txt'), 'later unstaged\n'); await writeFile(join(cwd, 'new.txt'), 'untracked\n');
  await executeProjectGitAction(cwd, action);
  assert.equal(await git(cwd, 'show', 'HEAD:file.txt'), 'staged'); assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'later unstaged\n');
  assert.equal(await git(cwd, 'diff', '--cached', '--name-only'), ''); assert.match(await git(cwd, 'status', '--porcelain'), /\?\? new.txt/u);
});

test('amend refuses stale index blobs, heads and branches without changing the reviewed or new state', async t => {
  const { cwd } = await fixture(t);
  await writeFile(join(cwd, 'file.txt'), 'staged A\n'); await git(cwd, 'add', '.'); const action = await reviewed(cwd);
  await writeFile(join(cwd, 'file.txt'), 'staged B\n'); await git(cwd, 'add', '.');
  await assert.rejects(() => executeProjectGitAction(cwd, action), error => error.code === 'ASTRAGIT_GIT_AMEND_STALE' && error.operationStatus === 'failed_before_write');
  assert.equal(await git(cwd, 'rev-parse', 'HEAD'), action.expectedHeadSha); assert.equal(await git(cwd, 'show', ':file.txt'), 'staged B');
  const next = await reviewed(cwd); await git(cwd, 'commit', '-m', 'external commit'); const head = await git(cwd, 'rev-parse', 'HEAD');
  await assert.rejects(() => executeProjectGitAction(cwd, next), error => error.code === 'ASTRAGIT_GIT_AMEND_STALE'); assert.equal(await git(cwd, 'rev-parse', 'HEAD'), head);
  const branchAction = await reviewed(cwd); await git(cwd, 'switch', '-c', 'other');
  await assert.rejects(() => executeProjectGitAction(cwd, branchAction), error => error.code === 'ASTRAGIT_GIT_AMEND_STALE'); assert.equal(await git(cwd, 'branch', '--show-current'), 'other');
});

test('amend refuses unborn heads and active merge state; a rejected hook keeps the original commit and index', async t => {
  const empty = await fixture(t, false);
  const emptyAction = await reviewed(empty.cwd);
  await assert.rejects(() => executeProjectGitAction(empty.cwd, emptyAction), error => error.code === 'ASTRAGIT_GIT_AMEND_HEAD_REQUIRED');
  const { cwd } = await fixture(t); const action = await reviewed(cwd);
  await writeFile(join(cwd, '.git/MERGE_HEAD'), action.expectedHeadSha + '\n');
  await assert.rejects(() => executeProjectGitAction(cwd, action), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_ACTIVE'); await rm(join(cwd, '.git/MERGE_HEAD'));
  await writeFile(join(cwd, 'file.txt'), 'staged\n'); await git(cwd, 'add', '.'); const hookAction = await reviewed(cwd);
  await writeFile(join(cwd, '.git/hooks/pre-commit'), '#!/bin/sh\necho "pre-commit hook failed" >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(() => executeProjectGitAction(cwd, hookAction)); assert.equal(await git(cwd, 'rev-parse', 'HEAD'), action.expectedHeadSha); assert.equal(await git(cwd, 'show', ':file.txt'), 'staged');
});

test('HTTP workbench exposes index identity and records an explicit single-repository amend', async t => {
  const { root, cwd } = await fixture(t); const data = join(root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: root, apiToken: 'amend-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'Amend fixture', localPath: cwd });
  const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; assert.match(repository.snapshot.indexFingerprint, /^[a-f0-9]{64}$/u);
  const detail = await client.loadProjectGitCommit(project.id, repository.id, repository.snapshot.headSha); assert.equal(detail.body, 'original subject\n\noriginal body');
  const action = await reviewed(cwd, '  HTTP amended\n\n# literal comment\n\tkeep trailing\t\n\n');
  const response = await client.executeProjectGitAction(project.id, repository.id, action); assert.equal(response.result.outcome, 'completed');
  const operations = await client.loadProjectGitOperations(project.id); assert.equal(operations.items[0].action, 'amend_commit'); assert.equal(operations.items[0].status, 'completed');
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'amend_commit', message: 'missing guard' }), error => error.error === 'ASTRAGIT_GIT_AMEND_STALE');
  const raw = (await exec('git', ['show', '-s', '--format=%B%x00', 'HEAD'], { cwd })).stdout.split('\0')[0]; assert.equal(raw, action.message); assert.equal((await client.loadProjectGitCommit(project.id, repository.id, response.snapshot.headSha)).fullMessage, action.message);
});
