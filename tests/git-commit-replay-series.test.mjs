import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitCommitReplayPreview, getProjectGitCommitReplaySeriesPreview, getProjectGitRepositorySnapshot, parseGitCommitReplaySeriesInput } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.LC_ALL = 'C';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-replay-series-'))); const cwd = join(root, 'repository'); await mkdir(cwd); t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await exec('git', args, { cwd })).stdout.trim();
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Series Test'); await git('config', 'user.email', 'series@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'shared.txt'), 'base\n'); await writeFile(join(cwd, 'local.txt'), 'base local\n'); await git('add', '.'); await git('commit', '-m', 'base'); const base = await git('rev-parse', 'HEAD'); await git('switch', '-c', 'source');
  const commit = async (name, contents, message, date) => { await writeFile(join(cwd, name), contents); await git('add', '.'); await exec('git', ['commit', '-m', message], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }); return git('rev-parse', 'HEAD'); };
  const one = await commit('one.txt', 'one\n', 'one selected', '2020-01-04T12:00:00Z'); const omitted = await commit('omitted.txt', 'not selected\n', 'unselected middle', '2020-01-03T12:00:00Z'); const two = await commit('shared.txt', 'incoming\n', 'two overlapping', '2020-01-02T12:00:00Z'); const three = await commit('three.txt', 'three\n', 'three selected', '2020-01-01T12:00:00Z'); await git('switch', 'main');
  return { root, cwd, git, base, one, omitted, two, three };
}
const input = (f, extra = {}) => ({ revisions: [f.three, f.two, f.one], commit: false, includeSourceId: false, ...extra });
async function replay(f, options) { const preview = await getProjectGitCommitReplaySeriesPreview(f.cwd, options); const result = await executeProjectGitAction(f.cwd, { type: 'cherry_pick_series', input: preview.input, expectedFingerprint: preview.fingerprint }); return { preview, result }; }
async function overlapping(f) { await writeFile(join(f.cwd, 'shared.txt'), 'current\n'); await f.git('commit', '-am', 'current target'); return f.git('rev-parse', 'HEAD'); }

test('batch preview orders ancestors first despite reversed timestamps, selects only requested commits and writes no Git state', async t => {
  const f = await fixture(t); const index = await readFile(join(f.cwd, '.git/index')); const refs = await f.git('show-ref'); const objects = await f.git('count-objects', '-v');
  const preview = await getProjectGitCommitReplaySeriesPreview(f.cwd, input(f)); assert.deepEqual(preview.input.revisions, [f.one, f.two, f.three]); assert.deepEqual(preview.commits.map(commit => commit.sha), [f.one, f.two, f.three]); assert.deepEqual(preview.files, ['one.txt', 'shared.txt', 'three.txt']); assert.equal(preview.fileCount, 3);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('show-ref'), refs); assert.equal(await f.git('count-objects', '-v'), objects);
});

test('no-commit batch combines only selected changes and preserves existing staged contents', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'local.txt'), 'previous staged\n'); await f.git('add', 'local.txt');
  const { result } = await replay(f, input(f, { revisions: [f.three, f.one] })); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'HEAD'), f.base); assert.equal(await f.git('show', ':local.txt'), 'previous staged'); assert.equal(await f.git('show', ':one.txt'), 'one'); assert.equal(await f.git('show', ':three.txt'), 'three'); assert.equal(await readFile(join(f.cwd, 'shared.txt'), 'utf8'), 'base\n'); await assert.rejects(() => readFile(join(f.cwd, 'omitted.txt')), error => error.code === 'ENOENT'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

test('automatic batch creates separate commits in previewed order with source IDs and no intermediate unselected commit', async t => {
  const f = await fixture(t); const { result } = await replay(f, input(f, { commit: true, includeSourceId: true })); assert.equal(result.outcome, 'completed'); assert.deepEqual((await f.git('log', '--reverse', '--format=%s', `${f.base}..HEAD`)).split('\n'), ['one selected', 'two overlapping', 'three selected']);
  const messages = await f.git('log', '--format=%B', `${f.base}..HEAD`); for (const sha of [f.one, f.two, f.three]) assert.ok(messages.includes(`cherry picked from commit ${sha}`)); assert.equal(messages.includes(f.omitted), false); assert.equal(await f.git('status', '--porcelain'), '');
});

test('merge batches use the selected shared mainline while mixed ordinary commits reject nonexistent parents', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'left', f.base); await writeFile(join(f.cwd, 'left.txt'), 'left\n'); await f.git('add', '.'); await f.git('commit', '-m', 'left parent'); const left = await f.git('rev-parse', 'HEAD'); await f.git('switch', '-c', 'right', f.base); await writeFile(join(f.cwd, 'right.txt'), 'right\n'); await f.git('add', '.'); await f.git('commit', '-m', 'right parent'); const right = await f.git('rev-parse', 'HEAD');
  await f.git('switch', 'left'); await f.git('merge', '--no-ff', right, '-m', 'left mainline'); const firstMerge = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'right'); await f.git('merge', '--no-ff', left, '-m', 'right mainline'); const secondMerge = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main');
  const { preview, result } = await replay(f, input(f, { revisions: [secondMerge, firstMerge], mainline: 2 })); assert.equal(preview.hasMerges, true); assert.equal(preview.maximumMainline, 2); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'HEAD'), f.base); assert.equal(await f.git('show', ':left.txt'), 'left'); assert.equal(await f.git('show', ':right.txt'), 'right'); await f.git('commit', '-m', 'reviewed both deltas');
  await assert.rejects(() => getProjectGitCommitReplaySeriesPreview(f.cwd, input(f, { revisions: [firstMerge, f.one], mainline: 2 })), error => error.code === 'ASTRAGIT_GIT_REPLAY_PARENT_INVALID');
});

test('batch review retains the complete affected file union beyond the single-dialog display limit', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'large-source', f.base); for (let index = 0; index < 205; index++) await writeFile(join(f.cwd, `many-${index}.txt`), `file ${index}\n`); await f.git('add', '.'); await f.git('commit', '-m', 'many selected files'); const large = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'last.txt'), 'last\n'); await f.git('add', '.'); await f.git('commit', '-m', 'last selected file'); const last = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main');
  const single = await getProjectGitCommitReplayPreview(f.cwd, { kind: 'cherry_pick', revision: large, commit: false, includeSourceId: false }); assert.equal(single.files.length, 200); assert.equal(single.fileCount, 205); const preview = await getProjectGitCommitReplaySeriesPreview(f.cwd, input(f, { revisions: [last, large] })); assert.equal(preview.files.length, 206); assert.equal(preview.fileCount, 206); assert.equal(preview.files.includes('last.txt'), true); assert.equal(await f.git('status', '--porcelain'), '');
});

test('a root and selected descendant can be replayed into an unborn branch with or without automatic commits', async t => {
  for (const commit of [false, true]) {
    const f = await fixture(t); await f.git('switch', '--orphan', 'unborn-target'); const { preview, result } = await replay(f, input(f, { revisions: [f.one, f.base], commit })); assert.equal(preview.headSha, ''); assert.deepEqual(preview.input.revisions, [f.base, f.one]); assert.equal(result.outcome, 'completed'); assert.equal(await readFile(join(f.cwd, 'one.txt'), 'utf8'), 'one\n'); assert.equal(await readFile(join(f.cwd, 'shared.txt'), 'utf8'), 'base\n'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
    if (commit) { assert.equal(await f.git('rev-list', '--count', 'HEAD'), '2'); assert.equal(await f.git('status', '--porcelain'), ''); }
    else { assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).headSha, ''); assert.equal(await f.git('show', ':one.txt'), 'one'); }
  }
});

test('manual batch conflict requires a manual prefix commit before Continue and retains the final staged changes', async t => {
  const f = await fixture(t); const target = await overlapping(f); const { result } = await replay(f, input(f)); assert.equal(result.outcome, 'conflict'); assert.equal(await f.git('rev-parse', 'HEAD'), target); let snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.integrationState, 'cherry_pick'); assert.equal(snapshot.integrationNoCommit, true);
  await writeFile(join(f.cwd, 'shared.txt'), 'resolved\n'); await f.git('add', 'shared.txt'); const index = await readFile(join(f.cwd, '.git/index')); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'cherry_pick' }), error => error.code === 'ASTRAGIT_GIT_REPLAY_MANUAL_COMMIT_REQUIRED' && error.operationStatus === 'failed_before_write'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  await executeProjectGitAction(f.cwd, { type: 'commit', message: 'manual resolved prefix', selectionMode: 'staged' }); const prefix = await f.git('rev-parse', 'HEAD'); snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.integrationState, 'cherry_pick'); assert.equal(snapshot.integrationNoCommit, true);
  const continued = await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'cherry_pick' }); assert.equal(continued.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'HEAD'), prefix); assert.equal(await f.git('show', ':three.txt'), 'three'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.equal(await readFile(join(f.cwd, 'shared.txt'), 'utf8'), 'resolved\n'); await assert.rejects(() => readFile(join(f.cwd, 'omitted.txt')), error => error.code === 'ENOENT');
});

test('automatic batch resumes remaining commits after resolving a middle conflict and Abort restores its starting commit', async t => {
  const f = await fixture(t); const target = await overlapping(f); await replay(f, input(f, { commit: true })); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationNoCommit, false); assert.notEqual(await f.git('rev-parse', 'HEAD'), target);
  await executeProjectGitAction(f.cwd, { type: 'abort_integration', kind: 'cherry_pick' }); assert.equal(await f.git('rev-parse', 'HEAD'), target); assert.equal(await f.git('status', '--porcelain'), ''); await assert.rejects(() => readFile(join(f.cwd, 'one.txt')), error => error.code === 'ENOENT');
  await replay(f, input(f, { commit: true })); await writeFile(join(f.cwd, 'shared.txt'), 'resolved\n'); await f.git('add', 'shared.txt'); await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'cherry_pick' }); assert.equal(await f.git('rev-list', '--count', `${target}..HEAD`), '3'); assert.equal(await f.git('show', 'HEAD:three.txt'), 'three'); assert.equal(await f.git('status', '--porcelain'), '');
});

test('invalid selections, stale local state and staged automatic commits fail before writes', async t => {
  const f = await fixture(t); for (const value of [null, {}, { ...input(f), revisions: [f.one] }, { ...input(f), revisions: [f.one, f.one] }, { ...input(f), revisions: ['main', f.one] }, { ...input(f), commit: null }, { ...input(f), includeSourceId: true }, { ...input(f), extra: true }]) assert.throws(() => parseGitCommitReplaySeriesInput(value), error => error.code === 'ASTRAGIT_GIT_REPLAY_INVALID');
  const preview = await getProjectGitCommitReplaySeriesPreview(f.cwd, input(f)); await writeFile(join(f.cwd, 'local.txt'), 'changed since preview\n'); await f.git('add', 'local.txt'); const index = await readFile(join(f.cwd, '.git/index')); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'cherry_pick_series', input: preview.input, expectedFingerprint: preview.fingerprint }), error => error.code === 'ASTRAGIT_GIT_REPLAY_PREVIEW_CHANGED');
  await assert.rejects(() => getProjectGitCommitReplaySeriesPreview(f.cwd, input(f, { commit: true })), error => error.code === 'ASTRAGIT_GIT_REPLAY_INDEX_DIRTY'); assert.equal(await f.git('rev-parse', 'HEAD'), f.base); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('replacement objects invalidate both single and batch source confirmations even when paths and parents match', async t => {
  const f = await fixture(t); const single = await getProjectGitCommitReplayPreview(f.cwd, { kind: 'cherry_pick', revision: f.one, commit: false, includeSourceId: false }); const series = await getProjectGitCommitReplaySeriesPreview(f.cwd, input(f));
  await f.git('switch', '-c', 'replacement', f.base); await writeFile(join(f.cwd, 'one.txt'), 'replacement bytes\n'); await f.git('add', '.'); await f.git('commit', '-m', 'different source'); const replacement = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); await f.git('replace', f.one, replacement);
  await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'cherry_pick', revision: f.one, commit: false, expectedFingerprint: single.fingerprint }), error => error.code === 'ASTRAGIT_GIT_REPLAY_PREVIEW_CHANGED'); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'cherry_pick_series', input: series.input, expectedFingerprint: series.fingerprint }), error => error.code === 'ASTRAGIT_GIT_REPLAY_PREVIEW_CHANGED'); assert.equal(await f.git('rev-parse', 'HEAD'), f.base);
});

test('HTTP batch previews are read-only and a restarted durable delivery never applies the series twice', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'series-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Series', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const preview = await client.previewRepositoryGitReplaySeries(project.id, repository.id, input(f, { commit: true })); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0); await assert.rejects(() => client.previewRepositoryGitReplaySeries(project.id, 'wrong', input(f)), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND');
  const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: { type: 'cherry_pick_series', input: preview.input, expectedFingerprint: preview.fingerprint } }); const send = async () => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); const head = await f.git('rev-parse', 'HEAD'); await writeFile(join(f.cwd, 'local.txt'), 'later staged\n'); await f.git('add', 'local.txt'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); assert.deepEqual(await send(), first); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('show', ':local.txt'), 'later staged'); assert.equal((await client.loadProjectGitOperations(project.id)).items.filter(item => item.action === 'cherry_pick_series').length, 1);
});
