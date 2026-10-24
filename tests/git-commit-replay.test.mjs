import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitCommitReplayPreview, getProjectGitRepositorySnapshot, parseGitCommitReplayInput } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.LC_ALL = 'C';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-replay-'))); const cwd = join(root, 'repository'); await mkdir(cwd);
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await exec('git', args, { cwd })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Replay Test'); await git('config', 'user.email', 'replay@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'shared.txt'), 'base\n'); await writeFile(join(cwd, 'local.txt'), 'base local\n'); await git('add', '.'); await git('commit', '-m', 'base'); const base = await git('rev-parse', 'HEAD');
  await git('switch', '-c', 'left'); await writeFile(join(cwd, 'left.txt'), 'left\n'); await git('add', '.'); await git('commit', '-m', 'left'); const left = await git('rev-parse', 'HEAD');
  await git('switch', '-c', 'right', base); await writeFile(join(cwd, 'right.txt'), 'right\n'); await git('add', '.'); await git('commit', '-m', 'right'); const right = await git('rev-parse', 'HEAD');
  await git('switch', 'left'); await git('merge', '--no-ff', 'right', '-m', 'merge source'); const merge = await git('rev-parse', 'HEAD'); await git('switch', 'main');
  return { root, cwd, git, base, left, right, merge };
}
const input = (revision, extra = {}) => ({ kind: 'cherry_pick', revision, commit: false, includeSourceId: false, ...extra });
async function replay(f, options) { const preview = await getProjectGitCommitReplayPreview(f.cwd, options); const { kind, ...rest } = preview.input; return { preview, result: await executeProjectGitAction(f.cwd, { type: kind, ...rest, expectedFingerprint: preview.fingerprint }) }; }

test('merge replay reviews each actual parent without changing the index, refs, objects or local bytes', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'local.txt'), 'staged local\n'); await f.git('add', 'local.txt'); await writeFile(join(f.cwd, 'local.txt'), 'working local\n');
  const index = await readFile(join(f.cwd, '.git/index')); const refs = await f.git('show-ref'); const objects = await f.git('count-objects', '-v');
  const first = await getProjectGitCommitReplayPreview(f.cwd, input(f.merge)); const second = await getProjectGitCommitReplayPreview(f.cwd, input(f.merge, { mainline: 2 }));
  assert.deepEqual(first.parents.map(parent => parent.hash), [f.left, f.right]); assert.equal(first.input.mainline, 1); assert.equal(first.sourceSha, f.merge); assert.equal(second.comparisonParent, f.right);
  assert.deepEqual(first.files.map(file => file.path), ['right.txt']); assert.deepEqual(second.files.map(file => file.path), ['left.txt']); assert.notEqual(first.fingerprint, second.fingerprint); assert.equal(first.stagedFileCount, 1);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('show-ref'), refs); assert.equal(await f.git('count-objects', '-v'), objects); assert.equal(await readFile(join(f.cwd, 'local.txt'), 'utf8'), 'working local\n');
});

test('merge cherry-pick uses the chosen mainline and leaves unrelated staged contents ready for a manual commit', async t => {
  const f = await fixture(t);
  for (const [number, parent, added] of [[1, f.left, 'right.txt'], [2, f.right, 'left.txt']]) {
    await f.git('switch', '-c', `target-${number}`, parent); await writeFile(join(f.cwd, 'local.txt'), `staged ${number}\n`); await f.git('add', 'local.txt');
    const { result } = await replay(f, input(f.merge, number === 1 ? {} : { mainline: number })); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'HEAD'), parent);
    assert.equal(await f.git('show', `:${added}`), added.split('.')[0]); assert.equal(await f.git('show', ':local.txt'), `staged ${number}`); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
    await f.git('commit', '-m', `manual ${number}`);
  }
});

test('automatic cherry-pick creates one commit with the source author and requested source ID', async t => {
  const f = await fixture(t); await f.git('switch', 'right'); await f.git('config', 'user.name', 'Original Author'); await f.git('commit', '--amend', '--no-edit', '--reset-author'); const source = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); await f.git('config', 'user.name', 'Replay Committer');
  const { result } = await replay(f, input(source, { commit: true, includeSourceId: true })); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-list', '--count', 'HEAD'), '2');
  assert.equal(await f.git('show', '-s', '--format=%an'), 'Original Author'); assert.equal(await f.git('show', '-s', '--format=%cn'), 'Replay Committer'); assert.match(await f.git('show', '-s', '--format=%B'), new RegExp(`cherry picked from commit ${source}`, 'u')); assert.equal(await f.git('status', '--porcelain'), '');
});

test('merge revert reverses the chosen parent delta and preserves HEAD when no commit is requested', async t => {
  const f = await fixture(t);
  for (const [number, removed] of [[1, 'right.txt'], [2, 'left.txt']]) {
    await f.git('switch', '-c', `revert-${number}`, f.merge); const { preview, result } = await replay(f, input(f.merge, { kind: 'revert', mainline: number })); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'HEAD'), f.merge); assert.deepEqual(preview.files, [{ path: removed, additions: 0, deletions: 1 }]);
    await assert.rejects(() => readFile(join(f.cwd, removed)), error => error.code === 'ENOENT'); await f.git('commit', '-m', `manual revert ${number}`);
  }
});

test('no-commit cherry-pick conflicts remain editable without fabricating a native Continue/Abort sequence', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'conflicting-source', f.base); await writeFile(join(f.cwd, 'shared.txt'), 'incoming\n'); await f.git('commit', '-am', 'incoming'); const source = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); await writeFile(join(f.cwd, 'shared.txt'), 'current\n'); await f.git('commit', '-am', 'current'); const head = await f.git('rev-parse', 'HEAD');
  const { result } = await replay(f, input(source)); assert.equal(result.outcome, 'conflict'); assert.deepEqual(result.conflictFiles, ['shared.txt']); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
  await assert.rejects(() => readFile(join(f.cwd, '.git/CHERRY_PICK_HEAD')), error => error.code === 'ENOENT'); await assert.rejects(() => readFile(join(f.cwd, '.git/sequencer/todo')), error => error.code === 'ENOENT');
  await writeFile(join(f.cwd, 'shared.txt'), 'resolved manually\n'); await f.git('add', 'shared.txt'); await executeProjectGitAction(f.cwd, { type: 'commit', message: 'manual resolution', selectionMode: 'staged' }); assert.equal(await f.git('show', 'HEAD:shared.txt'), 'resolved manually');
});

test('automatic replay conflicts use native Continue and Abort with correct recovery states', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'conflicting-source', f.base); await writeFile(join(f.cwd, 'shared.txt'), 'incoming\n'); await f.git('commit', '-am', 'incoming'); const source = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); await writeFile(join(f.cwd, 'shared.txt'), 'current\n'); await f.git('commit', '-am', 'current'); const head = await f.git('rev-parse', 'HEAD');
  const first = await replay(f, input(source, { commit: true })); assert.equal(first.result.outcome, 'conflict'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, 'cherry_pick');
  await executeProjectGitAction(f.cwd, { type: 'abort_integration', kind: 'cherry_pick' }); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await readFile(join(f.cwd, 'shared.txt'), 'utf8'), 'current\n');
  await replay(f, input(source, { commit: true })); await writeFile(join(f.cwd, 'shared.txt'), 'resolved automatically\n'); await f.git('add', 'shared.txt'); const continued = await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'cherry_pick' }); assert.equal(continued.outcome, 'completed'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.equal(await f.git('show', 'HEAD:shared.txt'), 'resolved automatically');
});

test('no-commit revert conflicts retain native Abort and Continue creates a reviewed resolution commit', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'shared.txt'), 'source contents\n'); await f.git('commit', '-am', 'source to reverse'); const source = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'shared.txt'), 'later contents\n'); await f.git('commit', '-am', 'later overlapping edit'); const head = await f.git('rev-parse', 'HEAD');
  const options = input(source, { kind: 'revert' });
  assert.equal((await replay(f, options)).result.outcome, 'conflict'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, 'revert'); assert.equal((await readFile(join(f.cwd, '.git/REVERT_HEAD'), 'utf8')).trim(), source);
  await executeProjectGitAction(f.cwd, { type: 'abort_integration', kind: 'revert' }); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('status', '--porcelain'), '');
  await replay(f, options); await writeFile(join(f.cwd, 'shared.txt'), 'reviewed reverse resolution\n'); await f.git('add', 'shared.txt'); await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'revert' }); assert.notEqual(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('show', 'HEAD:shared.txt'), 'reviewed reverse resolution'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

test('invalid options and unspecified or nonexistent merge parents fail before native writes', async t => {
  const f = await fixture(t); const bad = value => assert.throws(() => parseGitCommitReplayInput(value), error => error.code === 'ASTRAGIT_GIT_REPLAY_INVALID');
  for (const value of [null, [], { ...input('HEAD'), commit: null }, { ...input('HEAD'), includeSourceId: null }, input(''), input('HEAD\0'), input('HEAD', { mainline: 0 }), input('HEAD', { mainline: 1.5 }), input('HEAD', { includeSourceId: true }), input('HEAD', { kind: 'revert', commit: true, includeSourceId: true }), { ...input('HEAD'), unexpected: true }]) bad(value);
  const index = await readFile(join(f.cwd, '.git/index')); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'cherry_pick', revision: f.merge }), error => error.code === 'ASTRAGIT_GIT_REPLAY_PARENT_REQUIRED'); await assert.rejects(() => getProjectGitCommitReplayPreview(f.cwd, input(f.merge, { mainline: 3 })), error => error.code === 'ASTRAGIT_GIT_REPLAY_PARENT_INVALID');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), f.base);
});

test('review fingerprints reject changed options, index, local content, configuration and target HEAD', async t => {
  for (const change of ['options', 'index', 'worktree', 'configuration', 'head']) {
    const f = await fixture(t); const preview = await getProjectGitCommitReplayPreview(f.cwd, input(f.right));
    if (change === 'index') { await writeFile(join(f.cwd, 'local.txt'), 'staged\n'); await f.git('add', 'local.txt'); }
    if (change === 'worktree') await writeFile(join(f.cwd, 'right.txt'), 'untracked overlap\n');
    if (change === 'configuration') await f.git('config', 'commit.cleanup', 'verbatim');
    if (change === 'head') await f.git('commit', '--allow-empty', '-m', 'head changed');
    const head = await f.git('rev-parse', 'HEAD'); const index = await readFile(join(f.cwd, '.git/index'));
    await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'cherry_pick', revision: preview.sourceSha, commit: change === 'options', includeSourceId: false, expectedFingerprint: preview.fingerprint }), error => error.code === 'ASTRAGIT_GIT_REPLAY_PREVIEW_CHANGED', change);
    assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  }
});

test('root commits can be applied to an unborn branch using the same fixed preview', async t => {
  const f = await fixture(t); await f.git('switch', '--orphan', 'empty-target'); const preview = await getProjectGitCommitReplayPreview(f.cwd, input(f.base)); assert.deepEqual(preview.parents, []); assert.equal(preview.comparisonParent, null); assert.equal(preview.headSha, '');
  const { kind, ...rest } = preview.input; const result = await executeProjectGitAction(f.cwd, { type: kind, ...rest, expectedFingerprint: preview.fingerprint }); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('show', ':shared.txt'), 'base'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).headSha, '');
});

test('HTTP previews are owned read queries; durable replay is applied once across server restart', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'replay-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Replay', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const preview = await client.previewRepositoryGitReplay(project.id, repository.id, input(f.right, { commit: true })); assert.equal(preview.sourceSha, f.right); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
  await assert.rejects(() => client.previewRepositoryGitReplay(project.id, 'another-repository', input(f.right)), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND');
  const headers = { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }; const route = `/api/projects/${project.id}/git/workbench/repositories/${repository.id}/`;
  const invalid = await fetch(server.baseUrl + route + 'replay-preview', { method: 'POST', headers, body: JSON.stringify({ ...input(f.right), expectedFingerprint: 'untrusted' }) }); assert.equal(invalid.status, 400);
  const { kind, ...rest } = preview.input; const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: { type: kind, ...rest, expectedFingerprint: preview.fingerprint } });
  const send = async () => { const response = await fetch(server.baseUrl + route + 'actions', { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); const head = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'local.txt'), 'later stage\n'); await f.git('add', 'local.txt'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  assert.deepEqual(await send(), first); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('show', ':local.txt'), 'later stage'); assert.equal((await client.loadProjectGitOperations(project.id)).items.filter(item => item.action === 'cherry_pick').length, 1);
});

test('legacy action envelopes with omitted replay options keep automatic commits and durable replay compatibility', async t => {
  const f = await fixture(t); const data = join(f.root, 'legacy-data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'legacy-replay-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); t.after(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Legacy replay', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: { type: 'cherry_pick', revision: f.right } });
  const send = async payload => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(payload) }); return { status: response.status, value: await response.json() }; };
  const first = await send(body); assert.equal(first.status, 200); assert.equal(await f.git('rev-list', '--count', 'HEAD'), '2'); assert.equal(await f.git('status', '--porcelain'), ''); const picked = await f.git('rev-parse', 'HEAD'); await server.close(); server = await startGitServer(options); assert.deepEqual(await send(body), first); assert.equal(await f.git('rev-parse', 'HEAD'), picked);
  const reverse = await send({ type: 'revert', revision: picked }); assert.equal(reverse.status, 200); assert.equal(await f.git('rev-list', '--count', 'HEAD'), '3'); assert.equal(await f.git('diff', f.base, 'HEAD', '--name-only'), ''); assert.equal(await f.git('status', '--porcelain'), '');
});
