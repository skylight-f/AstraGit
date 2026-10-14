import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot, parseGitUnifiedDiff, readSelectedGitCommitChanges, validateProjectGitPushTarget } from '../packages/git-core/dist/index.js';
import { buildSourceCommitUnits, defaultSourcePushTarget } from '../apps/desktop/src/renderer/git/sourceGitState.ts';
import { pushSourceResult, runSourceBatch, validateSourceReview } from '../apps/desktop/src/renderer/git/sourceGitBatch.ts';

const exec = promisify(execFile);
const gitAt = cwd => async (...args) => (await exec('git', args, { cwd })).stdout.trim();
async function init(path) {
  await mkdir(path, { recursive: true }); const git = gitAt(path);
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'AstraGit Acceptance'); await git('config', 'user.email', 'acceptance@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(path, 'selected.txt'), 'base\n'); await writeFile(join(path, 'other.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'test: baseline'); return git;
}
test('a project commits child before parent, preserves unchecked staging, and retries failed pushes without recommitting', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-batch-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project'); const parentGit = await init(project); const source = join(root, 'module-source'); await init(source);
  await parentGit('-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'lib'); await parentGit('commit', '-am', 'test: add module');
  const childPath = join(project, 'lib'); const childGit = gitAt(childPath);
  await childGit('config', 'user.name', 'AstraGit Acceptance'); await childGit('config', 'user.email', 'acceptance@astragit.invalid'); await childGit('config', 'commit.gpgsign', 'false');
  const nestedPath = join(project, 'nested'); const nestedGit = await init(nestedPath);
  const records = [{ id: 'parent', name: 'parent', path: project, relativePath: '.' }, { id: 'child', name: 'child', path: childPath, relativePath: 'lib', isSubmodule: true }, { id: 'nested', name: 'nested', path: nestedPath, relativePath: 'nested' }];
  for (const record of records) {
    const remote = join(root, `${record.id}.git`); await exec('git', ['init', '--bare', remote]); await gitAt(record.path)('remote', 'remove', 'origin').catch(() => undefined); await gitAt(record.path)('remote', 'add', 'origin', remote); await gitAt(record.path)('push', '-u', 'origin', 'main');
    await writeFile(join(record.path, 'selected.txt'), `${record.id} changed\n`);
  }
  await parentGit('config', '-f', '.gitmodules', 'submodule.lib.url', join(root, 'child.git'));
  await parentGit('add', '.gitmodules'); await parentGit('commit', '-m', 'test: map module publication URL'); await parentGit('push', 'origin', 'main');
  await writeFile(join(project, 'other.txt'), 'keep parent staged\n'); await parentGit('add', 'other.txt');
  const snapshot = async () => ({ projectId: 'project', projectName: 'project', refreshedAt: new Date().toISOString(), repositories: await Promise.all(records.map(async record => ({ ...record, snapshot: await getProjectGitRepositorySnapshot(record.path) }))) });
  const actions = [];
  const client = {
    loadProjectGitWorkbench: snapshot,
    previewGitCommitSelection: async (_id, selection, mode) => ({ projectId: 'project', selectionMode: mode, repositories: await Promise.all(selection.map(async target => {
      const record = records.find(record => record.id === target.repositoryId); const changes = await readSelectedGitCommitChanges(record.path, target.paths, mode); const repository = await getProjectGitRepositorySnapshot(record.path);
      return { ...target, name: record.name, fingerprint: changes.fingerprint, headSha: changes.head, branch: repository.branch, detached: repository.detached, diff: { files: changes.files, diffText: changes.diff, fileDiffs: parseGitUnifiedDiff(changes.diff), isRepository: true } };
    })) }),
    validateGitPushTargets: async (_id, targets) => { for (const target of targets) await validateProjectGitPushTarget(records.find(record => record.id === target.repositoryId).path, target.remote, target.sourceBranch, target.targetBranch); return { ok: true }; },
    executeProjectGitAction: async (_id, id, action) => { actions.push(`${action.type}:${id}`); const record = records.find(record => record.id === id); return { result: await executeProjectGitAction(record.path, action) }; },
  };
  const initial = await snapshot();
  const units = buildSourceCommitUnits(initial.repositories, { child: ['selected.txt'], parent: ['selected.txt'], nested: ['selected.txt'] }, 'worktree', true);
  assert.deepEqual(units.map(unit => unit.repository.id), ['child', 'parent', 'nested']);
  assert.deepEqual(units.find(unit => unit.repository.id === 'parent').dependsOn, ['child']);
  assert.deepEqual(units.find(unit => unit.repository.id === 'nested').dependsOn, []);
  const rows = [];
  for (const unit of units) {
    const value = unit.ordinaryPaths.length ? (await client.previewGitCommitSelection('project', [{ repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths }], 'worktree')).repositories[0] : null;
    const push = defaultSourcePushTarget(unit.repository);
    rows.push({ repositoryId: unit.repository.id, repositoryName: unit.repository.name, relativePath: unit.repository.relativePath, branch: unit.repository.snapshot.branch, expectedHead: unit.repository.snapshot.headSha, paths: unit.paths, ordinaryPaths: unit.ordinaryPaths, gitlinks: unit.gitlinks, dependsOn: unit.dependsOn, mode: 'worktree', fingerprint: value?.fingerprint, message: 'feat: selected project batch', remote: push.remote, targetBranch: push.branch, remotes: ['origin'], detached: false, status: 'queued' });
  }
  await validateSourceReview(client, 'project', rows, true);
  const hook = join(root, 'child.git/hooks/pre-receive'); await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
  let results = [];
  await runSourceBatch({ client, projectId: 'project', rows, push: true, stopped: () => false, onResults: value => { results = value; }, onActive: () => {}, onCommitted: () => {} });
  assert.deepEqual(actions.filter(action => action.startsWith('commit:')), ['commit:child', 'commit:parent', 'commit:nested']);
  assert.equal(results.find(row => row.repositoryId === 'child').status, 'push_failed'); assert.equal(results.find(row => row.repositoryId === 'parent').status, 'push_blocked'); assert.equal(results.find(row => row.repositoryId === 'nested').status, 'done');
  const heads = await Promise.all([parentGit('rev-parse', 'HEAD'), childGit('rev-parse', 'HEAD'), nestedGit('rev-parse', 'HEAD')]);
  assert.equal((await parentGit('ls-tree', 'HEAD', 'lib')).split(/\s+/u)[2], heads[1]); assert.equal(await parentGit('diff', '--cached', '--name-only'), 'other.txt'); assert.match(await readFile(join(project, 'other.txt'), 'utf8'), /keep parent staged/u);
  await rm(hook);
  for (const id of ['child', 'parent']) await pushSourceResult(client, 'project', results.find(row => row.repositoryId === id));
  assert.deepEqual(await Promise.all([parentGit('rev-parse', 'HEAD'), childGit('rev-parse', 'HEAD'), nestedGit('rev-parse', 'HEAD')]), heads);
  assert.equal(actions.filter(action => action.startsWith('commit:')).length, 3);
  assert.equal((await exec('git', ['--git-dir', join(root, 'parent.git'), 'rev-parse', 'main'])).stdout.trim(), heads[0]);
  const clone = join(root, 'recursive-clone');
  await exec('git', ['-c', 'protocol.file.allow=always', 'clone', '--recurse-submodules', '--branch', 'main', join(root, 'parent.git'), clone]);
  assert.equal(await gitAt(join(clone, 'lib'))('rev-parse', 'HEAD'), heads[1]);
  // 暂存的父引用保持原 SHA，但子仓库推送失败时不能提前公开父引用。
  await childGit('commit', '--allow-empty', '-m', 'test: pending module commit');
  const stagedReference = await childGit('rev-parse', 'HEAD');
  await parentGit('add', 'lib');
  await writeFile(join(childPath, 'selected.txt'), 'second staged module change\n'); await childGit('add', 'selected.txt');
  const stagedUnits = buildSourceCommitUnits((await snapshot()).repositories, { parent: ['lib'], child: ['selected.txt'] }, 'staged', false);
  assert.deepEqual(stagedUnits.map(unit => unit.repository.id), ['child', 'parent']);
  const stagedRows = [];
  for (const unit of stagedUnits) {
    const preview = (await client.previewGitCommitSelection('project', [{ repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.paths }], 'staged')).repositories[0];
    stagedRows.push({ ...rows.find(row => row.repositoryId === unit.repository.id), paths: unit.paths, ordinaryPaths: unit.ordinaryPaths, gitlinks: unit.gitlinks, dependsOn: unit.dependsOn, mode: 'staged', expectedHead: preview.headSha, fingerprint: preview.fingerprint });
  }
  await validateSourceReview(client, 'project', stagedRows, true);
  await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
  await runSourceBatch({ client, projectId: 'project', rows: stagedRows, push: true, stopped: () => false, onResults: value => { results = value; }, onActive: () => {}, onCommitted: () => {} });
  assert.equal(results.find(row => row.repositoryId === 'parent').status, 'push_blocked');
  assert.equal((await parentGit('ls-tree', 'HEAD', 'lib')).split(/\s+/u)[2], stagedReference);
  assert.notEqual(await childGit('rev-parse', 'HEAD'), stagedReference);
  assert.equal(await parentGit('diff', '--cached', '--name-only'), 'other.txt');
});
