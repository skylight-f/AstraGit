import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { describeUserFacingError } from '../packages/shared/src/index.ts';
const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
async function fixture(t, diverged = false, conflict = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-merge-options-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Merge Test'); await git('config', 'user.email', 'merge@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base'); await git('switch', '-c', 'topic'); await writeFile(join(cwd, conflict ? 'file.txt' : 'topic.txt'), 'topic\n'); await git('add', '.'); await git('commit', '-m', 'feature subject from topic'); const source = await git('rev-parse', 'HEAD'); await git('switch', 'main');
  if (diverged || conflict) { await writeFile(join(cwd, conflict ? 'file.txt' : 'main.txt'), 'main\n'); await git('add', '.'); await git('commit', '-m', 'main changes'); }
  const head = await git('rev-parse', 'HEAD'); const commands = []; const run = action => executeProjectGitAction(cwd, action, undefined, env, async command => { commands.push(command); });
  const action = { type: 'merge', branchName: 'refs/heads/topic', expectedHeadSha: head, expectedBranch: 'main', expectedSourceHeadSha: source };
  return { root, cwd, git, cleanup, source, head, commands, run, action };
}

test('explicit no-fast-forward creates two-parent merge commits and includes reviewed commit messages', async t => {
  const f = await fixture(t); await f.git('config', 'merge.ff', 'only');
  const result = await f.run({ ...f.action, commitMerge: true, includeMergeLog: true, noFastForward: true }); assert.equal(result.outcome, 'completed'); const parents = (await f.git('show', '-s', '--format=%P', 'HEAD')).split(' '); assert.deepEqual(parents, [f.head, f.source]); assert.match(await f.git('show', '-s', '--format=%B', 'HEAD'), /feature subject from topic/u); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.ok(f.commands.some(command => command.startsWith('git merge ') && command.includes('--no-ff') && command.includes('--log')));
});

test('no-commit with no-fast-forward leaves a staged merge result that can continue through the existing integration flow', async t => {
  const f = await fixture(t); await f.run({ ...f.action, commitMerge: false, includeMergeLog: true, noFastForward: true }); const pending = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal(pending.integrationState, 'merge'); assert.equal(pending.conflictFiles.length, 0); assert.equal(await f.git('rev-parse', 'MERGE_HEAD'), f.source); assert.equal(await f.git('show', ':topic.txt'), 'topic'); assert.match(await readFile(join(f.cwd, '.git/MERGE_MSG'), 'utf8'), /feature subject from topic/u);
  const result = await f.run({ type: 'continue_integration', kind: 'merge' }); assert.equal(result.outcome, 'completed'); assert.equal((await f.git('show', '-s', '--format=%P', 'HEAD')).split(' ').length, 2); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

test('divergent no-commit merges pause without no-fast-forward and can abort without losing the original branch', async t => {
  const f = await fixture(t, true); await writeFile(join(f.cwd, 'untracked.txt'), 'keep\n'); await f.run({ ...f.action, commitMerge: false, includeMergeLog: false, noFastForward: false }); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, 'merge');
  await f.run({ type: 'abort_integration', kind: 'merge' }); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal(await readFile(join(f.cwd, 'untracked.txt'), 'utf8'), 'keep\n'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

test('no-commit cannot pause a fast-forward when a merge commit was not requested', async t => {
  const f = await fixture(t); await f.run({ ...f.action, commitMerge: false, includeMergeLog: false, noFastForward: false }); assert.equal(await f.git('rev-parse', 'HEAD'), f.source); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.equal(await f.git('status', '--porcelain'), '');
});

test('explicit merge message options override local log preferences; legacy calls keep native fast-forward configuration', async t => {
  const f = await fixture(t, true); await f.git('config', 'merge.log', 'true'); await f.git('config', 'merge.ff', 'only');
  await assert.rejects(() => f.run({ type: 'merge', branchName: 'refs/heads/topic' }), error => error.code === 'ASTRAGIT_GIT_MERGE_FF_ONLY' && error.operationStatus === 'failed_before_write' && describeUserFacingError(error).message.includes('仅快进'));
  assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
  await f.run({ ...f.action, commitMerge: true, includeMergeLog: false, noFastForward: false }); assert.doesNotMatch(await f.git('show', '-s', '--format=%B', 'HEAD'), /feature subject from topic/u); assert.equal((await f.git('show', '-s', '--format=%P', 'HEAD')).split(' ').length, 2);
});

test('merge options refuse moved destination branches, heads and sources before issuing a merge command', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'other'); await assert.rejects(() => f.run(f.action), error => error.code === 'ASTRAGIT_GIT_MERGE_TARGET_CHANGED' && error.operationStatus === 'failed_before_write'); await f.git('switch', 'main');
  await f.git('switch', 'topic'); await writeFile(join(f.cwd, 'later'), 'later\n'); await f.git('add', '.'); await f.git('commit', '-m', 'later source'); await f.git('switch', 'main'); await assert.rejects(() => f.run(f.action), error => error.code === 'ASTRAGIT_GIT_MERGE_SOURCE_CHANGED');
  await writeFile(join(f.cwd, 'main-later'), 'main later\n'); await f.git('add', '.'); await f.git('commit', '-m', 'later target'); const newHead = await f.git('rev-parse', 'HEAD'); await assert.rejects(() => f.run(f.action), error => error.code === 'ASTRAGIT_GIT_MERGE_TARGET_CHANGED'); assert.equal(await f.git('rev-parse', 'HEAD'), newHead); assert.equal(f.commands.some(command => command.startsWith('git merge ')), false);
});

test('merge option conflicts preserve the merge state and marked worktree for the existing conflict editor', async t => {
  const f = await fixture(t, true, true); const result = await f.run({ ...f.action, commitMerge: false, includeMergeLog: true, noFastForward: true }); assert.equal(result.outcome, 'conflict'); const snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.integrationState, 'merge'); assert.deepEqual(snapshot.conflictFiles, ['file.txt']); assert.equal(snapshot.headSha, f.head); assert.match(await readFile(join(f.cwd, 'file.txt'), 'utf8'), /<<<<<<< HEAD/u);
});

test('native pre-merge-commit hook rejection is unconfirmed and retains the pending integration instead of pretending it never started', async t => {
  const f = await fixture(t, true); await mkdir(join(f.root, 'hooks')); const hook = join(f.root, 'hooks/pre-merge-commit'); await writeFile(hook, '#!/bin/sh\necho "pre-merge-commit hook failed" >&2\nexit 1\n'); await chmod(hook, 0o755);
  await assert.rejects(() => f.run({ ...f.action, commitMerge: true, noFastForward: true }), error => error.code === 'ASTRAGIT_GIT_HOOK_REJECTED' && error.operationStatus === 'unknown_after_write'); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, 'merge'); assert.equal(await readFile(join(f.cwd, 'topic.txt'), 'utf8'), 'topic\n');
});

test('HTTP merge options and identity checks survive service parsing and preserve operation records', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'merge-options-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Merge options', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { ...f.action, expectedBranch: 'other' }), error => describeUserFacingError(error).message.includes('合入分支'));
  const response = await client.executeProjectGitAction(project.id, repository.id, { ...f.action, commitMerge: false, includeMergeLog: true, noFastForward: true }); assert.equal(response.snapshot.integrationState, 'merge'); assert.equal(response.snapshot.headSha, f.head); assert.match(await readFile(join(f.cwd, '.git/MERGE_MSG'), 'utf8'), /feature subject from topic/u); assert.ok((await client.loadProjectGitOperations(project.id)).items.some(item => item.action === 'merge' && item.status === 'completed' && item.commands.some(command => command.includes('--no-commit') && command.includes('--no-ff') && command.includes('--log'))));
});
