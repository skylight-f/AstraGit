import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, readSelectedGitCommitChanges } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';

const exec = promisify(execFile);
async function repository(path) {
  await mkdir(path, { recursive: true });
  const git = async (...args) => (await exec('git', args, { cwd: path })).stdout.trim();
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'AstraGit Acceptance');
  await git('config', 'user.email', 'acceptance@astragit.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(path, 'selected.txt'), 'base\n');
  await writeFile(join(path, 'other.txt'), 'base\n');
  await git('add', '.');
  await git('commit', '-m', 'test: baseline');
  return git;
}

test('selected worktree and staged commits preserve the unselected index and newer worktree content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-selection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const mode of ['worktree', 'staged']) {
    const path = join(root, mode);
    const git = await repository(path);
    const head = await git('rev-parse', 'HEAD');
    await writeFile(join(path, 'other.txt'), 'base\nkeep staged\n');
    await writeFile(join(path, 'selected.txt'), 'base\nstaged part\n');
    await git('add', 'other.txt', 'selected.txt');
    await writeFile(join(path, 'selected.txt'), 'base\nstaged part\nnewer worktree\n');
    const indexBefore = await readFile(join(path, '.git/index'));
    const preview = await readSelectedGitCommitChanges(path, ['selected.txt'], mode);
    assert.deepEqual(await readFile(join(path, '.git/index')), indexBefore, 'Reading commit scope must not stage files.');
    assert.equal(preview.diff.includes('+newer worktree'), mode === 'worktree');
    const result = await executeProjectGitAction(path, { type: 'commit', paths: ['selected.txt'], selectionMode: mode, message: `test: ${mode}`, expectedHeadSha: head, expectedBranch: 'main', expectedFingerprint: preview.fingerprint });
    assert.equal(result.outcome, 'completed');
    assert.equal((await git('show', 'HEAD:selected.txt')).includes('newer worktree'), mode === 'worktree');
    assert.equal(await git('diff', '--cached', '--name-only'), 'other.txt');
    assert.match(await git('show', ':other.txt'), /keep staged/u);
    assert.match(await readFile(join(path, 'selected.txt'), 'utf8'), /newer worktree/u);
    assert.equal((await git('diff', '--name-only')).includes('selected.txt'), mode === 'staged');
  }
});

test('stale selection and a failing hook do not commit or change the real staged content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-selection-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = await repository(root);
  await writeFile(join(root, 'other.txt'), 'keep\n');
  await git('add', 'other.txt');
  await writeFile(join(root, 'selected.txt'), 'first change\n');
  const preview = await readSelectedGitCommitChanges(root, ['selected.txt']);
  const head = await git('rev-parse', 'HEAD');
  const cached = await git('diff', '--cached');
  await writeFile(join(root, 'selected.txt'), 'second change\n');
  await assert.rejects(executeProjectGitAction(root, { type: 'commit', message: 'test: stale', paths: ['selected.txt'], expectedFingerprint: preview.fingerprint }), /所选内容已变化/u);
  const hook = join(root, '.git/hooks/pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  await assert.rejects(executeProjectGitAction(root, { type: 'commit', message: 'test: hook failure', paths: ['selected.txt'] }), error => error.code === 'ASTRAGIT_GIT_HOOK_REJECTED' && error.operationStatus === 'unknown_after_write');
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await git('diff', '--cached'), cached);
  assert.equal(await git('diff', '--cached', '--name-only'), 'other.txt');
  await writeFile(hook, '#!/bin/sh\ngit add other.txt\n');
  await assert.rejects(executeProjectGitAction(root, { type: 'commit', message: 'test: hook expands selection', paths: ['selected.txt'] }), error => {
    assert.equal(error.code, 'ASTRAGIT_GIT_HOOK_SELECTION_CHANGED'); assert.equal(error.operationStatus, 'unknown_after_write');
    assert.match(error.message, /未勾选的文件/u); assert.match(error.details, /ASTRAGIT_GIT_HOOK_SELECTION_CHANGED/u); return true;
  });
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await git('diff', '--cached'), cached);
});

test('one project discovers multiple repositories; selection preview rejects another project and commits only checked paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-project-repositories-'));
  let running;
  t.after(async () => { await running?.close(); await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, '一个项目');
  const first = join(workspace, 'apps/frontend');
  const second = join(workspace, 'packages/core');
  const outside = join(root, 'other-project');
  const firstGit = await repository(first);
  await repository(second);
  await repository(outside);
  await writeFile(join(first, 'selected.txt'), 'frontend change\n');
  await writeFile(join(second, 'selected.txt'), 'core change\n');
  const data = join(root, 'data');
  running = await startGitServer({ dataDirectory: data, projectRoot: data, apiToken: 'selection-token', codexNativeEnabled: false, secretStore: createFileSecretStore(join(data, 'secrets.json')) });
  const request = async (path, body, expected = 200) => {
    const response = await fetch(`${running.baseUrl}${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-astragit-api-token': 'selection-token', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const project = await request('/api/projects', { localPath: workspace }, 201);
  const other = await request('/api/projects', { localPath: outside }, 201);
  const snapshot = await request(`/api/projects/${project.id}/git/workbench`);
  assert.equal(snapshot.repositories.length, 2);
  const targets = snapshot.repositories.map(repo => ({ repositoryId: repo.id, relativePath: repo.relativePath, paths: ['selected.txt'] }));
  const preview = await request(`/api/projects/${project.id}/git/commit-selection`, { selection: targets, selectionMode: 'worktree' });
  assert.equal(preview.repositories.length, 2);
  assert.ok(preview.repositories.every(repo => repo.fingerprint && repo.diff.diffText));
  const otherRepo = (await request(`/api/projects/${other.id}/git/workbench`)).repositories[0];
  await request(`/api/projects/${project.id}/git/commit-selection`, { selection: [{ repositoryId: otherRepo.id, relativePath: '.', paths: ['selected.txt'] }] }, 400);
  const before = await firstGit('rev-parse', 'HEAD');
  for (const target of preview.repositories) await request(`/api/projects/${project.id}/git/workbench/repositories/${target.repositoryId}/actions`, { type: 'commit', paths: target.paths, message: 'feat: project repositories', expectedHeadSha: target.headSha, expectedBranch: target.branch, expectedFingerprint: target.fingerprint });
  assert.notEqual(await firstGit('rev-parse', 'HEAD'), before);
  assert.equal((await request(`/api/projects/${project.id}/git/workbench`)).repositories.every(repo => repo.snapshot.clean), true);
});
