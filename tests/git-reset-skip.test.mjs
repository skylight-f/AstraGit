import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot, getProjectGitResetPreview, getProjectGitSkipPreview } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { describeUserFacingError } from '../packages/shared/src/index.ts';
import { gitRevisionActionNeedsReview } from '../apps/desktop/src/renderer/git/GitRevisionActionDialog.tsx';
import { gitConflictMessage } from '../apps/desktop/src/renderer/git/gitOperationFeedback.ts';
import { readGitWritePreview } from '../packages/git-core/dist/gitDestructivePreview.js';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout.trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-reset-skip-')); const cwd = join(root, 'local'); await mkdir(cwd);
  const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '--initial-branch=main'); await git(cwd, 'config', 'user.name', 'Revision Test'); await git(cwd, 'config', 'user.email', 'revision@astragit.invalid'); await git(cwd, 'config', 'commit.gpgsign', 'false'); await git(cwd, 'config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'base');
  const base = await git(cwd, 'rev-parse', 'HEAD');
  const commands = [];
  return { root, cwd, base, cleanup, commands, run: action => executeProjectGitAction(cwd, action, undefined, env, async command => { commands.push(command); }), snapshot: () => getProjectGitRepositorySnapshot(cwd) };
}
async function commit(f, path, content, message = content.trim()) {
  await writeFile(join(f.cwd, path), content); await git(f.cwd, 'add', '--', path); await git(f.cwd, 'commit', '-m', message); return git(f.cwd, 'rev-parse', 'HEAD');
}
const resetAction = preview => ({ type: 'reset_revision', targetSha: preview.targetSha, mode: preview.mode, expectedFingerprint: preview.fingerprint });
const skipAction = (preview, kind) => ({ type: 'skip_integration', kind, expectedFingerprint: preview.fingerprint });
const staleReset = error => error.code === 'ASTRAGIT_GIT_RESET_PREVIEW_CHANGED' && error.operationStatus === 'failed_before_write' && gitRevisionActionNeedsReview(error);

test('soft, mixed and hard reset have distinct index/worktree effects and retain unrelated untracked files', async t => {
  for (const mode of ['soft', 'mixed', 'hard']) {
    const f = await fixture(t); await commit(f, 'file.txt', 'committed\n');
    await writeFile(join(f.cwd, 'file.txt'), 'staged\n'); await git(f.cwd, 'add', 'file.txt'); await writeFile(join(f.cwd, 'file.txt'), 'unstaged\n'); await writeFile(join(f.cwd, 'untracked.txt'), 'keep\n');
    const preview = await getProjectGitResetPreview(f.cwd, f.base, mode);
    const result = await f.run(resetAction(preview)); assert.equal(result.outcome, 'completed');
    assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), f.base); assert.equal(await git(f.cwd, 'branch', '--show-current'), 'main');
    assert.equal(await git(f.cwd, 'show', ':file.txt'), mode === 'soft' ? 'staged' : 'base');
    assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), mode === 'hard' ? 'base\n' : 'unstaged\n');
    assert.equal(await readFile(join(f.cwd, 'untracked.txt'), 'utf8'), 'keep\n');
    assert.ok(f.commands.some(command => command.includes('reset') && command.includes('--no-recurse-submodules')));
  }
});

test('reset preview is read-only and stable without Git index refresh writes; aborted preview writes nothing', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'local\n');
  const index = await readFile(join(f.cwd, '.git/index')); const mtime = (await stat(join(f.cwd, '.git/index'))).mtimeMs;
  const first = await getProjectGitResetPreview(f.cwd, 'HEAD', 'hard'); const second = await getProjectGitResetPreview(f.cwd, 'HEAD', 'hard');
  assert.equal(first.fingerprint, second.fingerprint); assert.deepEqual(first.changedFiles, ['file.txt']);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal((await stat(join(f.cwd, '.git/index'))).mtimeMs, mtime);
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => getProjectGitResetPreview(f.cwd, 'HEAD', 'hard', controller.signal));
  assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'local\n'); assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), f.base);
});

test('a file changed between status reading and disk inspection cannot be discarded using an incomplete preview', async t => {
  const f = await fixture(t); const clean = await getProjectGitResetPreview(f.cwd, 'HEAD', 'hard');
  const identity = { headSha: clean.headSha, branch: clean.branch, detached: clean.detached, targetSha: clean.targetSha, integrationState: clean.integrationState };
  const raced = await readGitWritePreview(f.cwd, identity, 'hard', async args => {
    const output = await exec('git', args, { cwd: f.cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0' } });
    if (args[0] === 'status') await writeFile(join(f.cwd, 'file.txt'), 'external change during inspection\n');
    return output;
  });
  assert.equal(raced.changedFileCount, 0); assert.notEqual(raced.fingerprint, (await getProjectGitResetPreview(f.cwd, 'HEAD', 'hard')).fingerprint);
  await assert.rejects(() => f.run(resetAction(raced)), staleReset); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'external change during inspection\n');
});

test('stale HEAD, branch, index, contents, target or mode cannot use an earlier reset confirmation', async t => {
  const f = await fixture(t); const next = await commit(f, 'file.txt', 'next\n');
  let preview = await getProjectGitResetPreview(f.cwd, f.base, 'hard');
  await writeFile(join(f.cwd, 'file.txt'), 'edit\n'); await assert.rejects(() => f.run(resetAction(preview)), staleReset);
  preview = await getProjectGitResetPreview(f.cwd, f.base, 'hard'); await git(f.cwd, 'add', 'file.txt'); await assert.rejects(() => f.run(resetAction(preview)), staleReset);
  preview = await getProjectGitResetPreview(f.cwd, f.base, 'hard'); await git(f.cwd, 'switch', '-c', 'other'); await assert.rejects(() => f.run(resetAction(preview)), staleReset);
  preview = await getProjectGitResetPreview(f.cwd, f.base, 'hard'); await assert.rejects(() => f.run({ ...resetAction(preview), targetSha: next }), staleReset);
  await assert.rejects(() => f.run({ ...resetAction(preview), mode: 'mixed' }), staleReset);
  await assert.rejects(() => f.run({ ...resetAction(preview), expectedFingerprint: '' }), staleReset);
  await commit(f, 'other.txt', 'moved\n'); await assert.rejects(() => f.run(resetAction(preview)), staleReset);
  assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'edit\n'); assert.equal(await git(f.cwd, 'branch', '--show-current'), 'other');
});

test('hard reset lists ignored obstacles and nested Git directories and requires their explicit confirmation', async t => {
  const f = await fixture(t); const target = await commit(f, 'obstacle', 'target file\n'); await git(f.cwd, 'rm', 'obstacle'); await git(f.cwd, 'commit', '-m', 'remove target file');
  await mkdir(join(f.cwd, 'obstacle')); await git(join(f.cwd, 'obstacle'), 'init'); await writeFile(join(f.cwd, 'obstacle', 'unsaved.txt'), 'nested unsaved\n');
  await writeFile(join(f.cwd, '.git/info/exclude'), 'obstacle/\n');
  const preview = await getProjectGitResetPreview(f.cwd, target, 'hard'); assert.deepEqual(preview.untrackedObstacles, ['obstacle']); assert.deepEqual(preview.nestedRepositories, [{ path: 'obstacle', effect: 'directory' }]);
  await assert.rejects(() => f.run(resetAction(preview)), error => error.code === 'ASTRAGIT_GIT_RESET_NESTED_CONFIRMATION_REQUIRED' && error.operationStatus === 'failed_before_write');
  assert.equal(await readFile(join(f.cwd, 'obstacle/unsaved.txt'), 'utf8'), 'nested unsaved\n');
  await f.run({ ...resetAction(preview), discardNestedRepositories: true }); assert.equal(await readFile(join(f.cwd, 'obstacle'), 'utf8'), 'target file\n');
});

test('hard preview detects edits hidden by assume-unchanged and preserves filenames with tabs/newlines', async t => {
  const f = await fixture(t); const path = '空 格\t换\n行.txt'; await commit(f, path, 'old\n'); const target = await git(f.cwd, 'rev-parse', 'HEAD'); await commit(f, path, 'new\n');
  await git(f.cwd, 'update-index', '--assume-unchanged', '--', path); await writeFile(join(f.cwd, path), 'hidden1\n');
  const preview = await getProjectGitResetPreview(f.cwd, target, 'hard'); await writeFile(join(f.cwd, path), 'hidden2\n');
  await assert.rejects(() => f.run(resetAction(preview)), staleReset); assert.equal(await readFile(join(f.cwd, path), 'utf8'), 'hidden2\n');
  const reviewed = await getProjectGitResetPreview(f.cwd, target, 'hard'); await assert.rejects(() => f.run(resetAction(reviewed)), error => error.code === 'ASTRAGIT_GIT_INDEX_ENTRY_NOT_UPTODATE' && error.operationStatus === 'unknown_after_write' && gitRevisionActionNeedsReview(error));
  assert.equal(await readFile(join(f.cwd, path), 'utf8'), 'hidden2\n');
  await git(f.cwd, 'update-index', '--no-assume-unchanged', '--', path); const fresh = await getProjectGitResetPreview(f.cwd, target, 'hard'); await f.run(resetAction(fresh)); assert.equal(await readFile(join(f.cwd, path), 'utf8'), 'old\n');
});

test('hard reset replaces an obstructing symlink without following it or changing the external files', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'link')); const target = await commit(f, 'link/file.txt', 'tracked\n'); await git(f.cwd, 'rm', '-r', 'link'); await git(f.cwd, 'commit', '-m', 'remove link directory');
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'file.txt'), 'outside\n'); await symlink(outside, join(f.cwd, 'link'));
  const preview = await getProjectGitResetPreview(f.cwd, target, 'hard'); assert.deepEqual(preview.untrackedObstacles, ['link']); assert.equal(preview.nestedRepositoryCount, 0);
  await writeFile(join(outside, 'file.txt'), 'outside later\n'); await f.run(resetAction(preview));
  assert.equal(await readFile(join(f.cwd, 'link/file.txt'), 'utf8'), 'tracked\n'); assert.equal(await readFile(join(outside, 'file.txt'), 'utf8'), 'outside later\n');
});

test('registered submodule worktrees keep their HEAD and dirty contents even with submodule.recurse enabled', async t => {
  const f = await fixture(t); const child = join(f.root, 'child'); await mkdir(child); await git(child, 'init', '--initial-branch=main'); await git(child, 'config', 'user.name', 'Child'); await git(child, 'config', 'user.email', 'child@astragit.invalid'); await git(child, 'config', 'commit.gpgsign', 'false'); await writeFile(join(child, 'child.txt'), 'one\n'); await git(child, 'add', '.'); await git(child, 'commit', '-m', 'one');
  await git(f.cwd, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub'); await git(f.cwd, 'commit', '-m', 'add sub'); const target = await git(f.cwd, 'rev-parse', 'HEAD');
  await git(join(f.cwd, 'sub'), 'config', 'user.name', 'Child'); await git(join(f.cwd, 'sub'), 'config', 'user.email', 'child@astragit.invalid'); await git(join(f.cwd, 'sub'), 'config', 'commit.gpgsign', 'false'); await writeFile(join(f.cwd, 'sub/child.txt'), 'two\n'); await git(join(f.cwd, 'sub'), 'add', '.'); await git(join(f.cwd, 'sub'), 'commit', '-m', 'two'); const childHead = await git(join(f.cwd, 'sub'), 'rev-parse', 'HEAD'); await git(f.cwd, 'add', 'sub'); await git(f.cwd, 'commit', '-m', 'bump sub'); await writeFile(join(f.cwd, 'sub/child.txt'), 'dirty child\n'); await git(f.cwd, 'config', 'submodule.recurse', 'true');
  const preview = await getProjectGitResetPreview(f.cwd, target, 'hard'); assert.equal(preview.nestedRepositoryCount, 0); await f.run(resetAction(preview));
  assert.equal(await git(join(f.cwd, 'sub'), 'rev-parse', 'HEAD'), childHead); assert.equal(await readFile(join(f.cwd, 'sub/child.txt'), 'utf8'), 'dirty child\n'); assert.notEqual(await git(f.cwd, 'rev-parse', ':sub'), childHead);
});

async function startConflict(f, kind, twoConflicts = false) {
  await git(f.cwd, 'switch', '-c', 'feature'); const first = await commit(f, 'file.txt', 'feature first\n'); const second = await commit(f, twoConflicts ? 'file.txt' : 'side.txt', twoConflicts ? 'feature second\n' : 'second kept\n');
  await git(f.cwd, 'switch', 'main'); await commit(f, 'file.txt', 'main current\n');
  if (kind === 'rebase') { await git(f.cwd, 'switch', 'feature'); await assert.rejects(() => git(f.cwd, 'rebase', 'main')); }
  else await assert.rejects(() => git(f.cwd, 'cherry-pick', first, second));
  return { first, second };
}

test('soft reset explains merge restrictions while mixed resets the index and preserves conflict text', async t => {
  const f = await fixture(t); await startConflict(f, 'cherry_pick'); const conflictText = await readFile(join(f.cwd, 'file.txt'), 'utf8');
  const soft = await getProjectGitResetPreview(f.cwd, 'HEAD', 'soft'); await assert.rejects(() => f.run(resetAction(soft)), error => error.code === 'ASTRAGIT_GIT_RESET_SOFT_UNMERGED');
  const mixed = await getProjectGitResetPreview(f.cwd, 'HEAD', 'mixed'); await f.run(resetAction(mixed)); assert.equal(await git(f.cwd, 'ls-files', '-u'), ''); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), conflictText);
});

test('reset retains detached state and can set an unborn branch to an existing reviewed commit', async t => {
  const f = await fixture(t); await commit(f, 'file.txt', 'latest\n'); await git(f.cwd, 'checkout', '--detach');
  const preview = await getProjectGitResetPreview(f.cwd, f.base, 'mixed'); assert.equal(preview.detached, true); await f.run(resetAction(preview)); assert.equal(await git(f.cwd, 'branch', '--show-current'), '');
  await git(f.cwd, 'checkout', '--orphan', 'new-root'); const unborn = await getProjectGitResetPreview(f.cwd, f.base, 'mixed'); assert.equal(unborn.headSha, ''); await f.run(resetAction(unborn)); assert.equal(await git(f.cwd, 'branch', '--show-current'), 'new-root'); assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), f.base);
});

test('skipping cherry-pick and rebase discards one step and still applies the remaining independent commit', async t => {
  for (const kind of ['cherry_pick', 'rebase']) {
    const f = await fixture(t); const { first } = await startConflict(f, kind); const preview = await getProjectGitSkipPreview(f.cwd, kind); assert.equal(preview.currentIntegrationCommit, first);
    const result = await f.run(skipAction(preview, kind)); assert.equal(result.outcome, 'completed'); assert.equal((await f.snapshot()).integrationState, null); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'main current\n'); assert.equal(await readFile(join(f.cwd, 'side.txt'), 'utf8'), 'second kept\n');
  }
});

test('skipping a revert continues the remaining revert sequence rather than aborting it', async t => {
  const f = await fixture(t); const first = await commit(f, 'file.txt', 'first\n'); const second = await commit(f, 'side.txt', 'remove by revert\n'); await commit(f, 'file.txt', 'later\n');
  await assert.rejects(() => git(f.cwd, 'revert', '--no-edit', first, second)); const preview = await getProjectGitSkipPreview(f.cwd, 'revert'); assert.equal(preview.currentIntegrationCommit, first);
  assert.equal((await f.run(skipAction(preview, 'revert'))).outcome, 'completed'); assert.equal((await f.snapshot()).integrationState, null); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'later\n'); await assert.rejects(() => readFile(join(f.cwd, 'side.txt')), error => error.code === 'ENOENT');
});

test('skip can pause at the next conflict, explains that new step, and rejects replay of the previous confirmation', async t => {
  const f = await fixture(t); const { second } = await startConflict(f, 'cherry_pick', true); const preview = await getProjectGitSkipPreview(f.cwd, 'cherry_pick'); const action = skipAction(preview, 'cherry_pick');
  const result = await f.run(action); assert.equal(result.outcome, 'conflict'); const next = await getProjectGitSkipPreview(f.cwd, 'cherry_pick'); assert.equal(next.currentIntegrationCommit, second); assert.notEqual(next.fingerprint, preview.fingerprint);
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_PREVIEW_CHANGED' && error.operationStatus === 'failed_before_write' && gitRevisionActionNeedsReview(error));
  const message = gitConflictMessage(action, result, await f.snapshot(), true); assert.match(message, /已跳过当前提交/u); assert.match(message, /新的冲突/u); assert.doesNotMatch(message, /合并已暂停/u);
});

test('skip refuses a changed kind, modified resolution or missing integration without resetting anything', async t => {
  const f = await fixture(t); await assert.rejects(() => getProjectGitSkipPreview(f.cwd, 'rebase'), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_CHANGED');
  await startConflict(f, 'cherry_pick'); const preview = await getProjectGitSkipPreview(f.cwd, 'cherry_pick'); await writeFile(join(f.cwd, 'file.txt'), 'manual resolution\n');
  await assert.rejects(() => f.run(skipAction(preview, 'cherry_pick')), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_PREVIEW_CHANGED'); await assert.rejects(() => f.run(skipAction(preview, 'rebase')), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_CHANGED'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'manual resolution\n');
  assert.equal(gitRevisionActionNeedsReview({ code: 'ASTRAGIT_CANCELLED', operationStatus: 'unknown_after_write' }), true); assert.match(describeUserFacingError({ code: 'ASTRAGIT_GIT_RESET_PREVIEW_CHANGED' }).message, /未执行重置/u);
});

test('an index lock during skip is a failure and is never reported as a new conflict from the old UU index', async t => {
  const f = await fixture(t); await startConflict(f, 'cherry_pick'); const preview = await getProjectGitSkipPreview(f.cwd, 'cherry_pick'); const contents = await readFile(join(f.cwd, 'file.txt'), 'utf8');
  await writeFile(join(f.cwd, '.git/index.lock'), 'owned by another operation\n');
  await assert.rejects(() => f.run(skipAction(preview, 'cherry_pick')), error => error.code === 'ASTRAGIT_GIT_INDEX_LOCKED');
  assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), contents); assert.equal((await getProjectGitSkipPreview(f.cwd, 'cherry_pick')).currentIntegrationCommit, preview.currentIntegrationCommit);
});

test('an interactive rebase with repeated picks distinguishes the next step even when its SHA is identical', async t => {
  const f = await fixture(t); await git(f.cwd, 'switch', '-c', 'feature'); const target = await commit(f, 'file.txt', 'incoming\n'); await git(f.cwd, 'switch', 'main'); await commit(f, 'file.txt', 'current\n');
  const editor = join(f.root, 'duplicate-first-pick'); await writeFile(editor, '#!/bin/sh\ncp "$1" "$1.copy"\n{ head -n 1 "$1.copy"; cat "$1.copy"; } > "$1"\nrm "$1.copy"\n', { mode: 0o755 }); await git(f.cwd, 'switch', 'feature');
  await assert.rejects(() => exec('git', ['rebase', '-i', 'main'], { cwd: f.cwd, env: { ...env, GIT_SEQUENCE_EDITOR: editor } })); const preview = await getProjectGitSkipPreview(f.cwd, 'rebase'); assert.equal(preview.currentIntegrationCommit, target);
  assert.equal((await f.run(skipAction(preview, 'rebase'))).outcome, 'conflict'); const next = await getProjectGitSkipPreview(f.cwd, 'rebase'); assert.equal(next.currentIntegrationCommit, preview.currentIntegrationCommit); assert.notEqual(next.integrationStepFingerprint, preview.integrationStepFingerprint);
});

test('the rebase apply backend also skips one patch and recognizes a conflict in the next patch', async t => {
  for (const twoConflicts of [false, true]) {
    const f = await fixture(t); await git(f.cwd, 'switch', '-c', 'feature'); const first = await commit(f, 'file.txt', 'feature first\n'); const second = await commit(f, twoConflicts ? 'file.txt' : 'side.txt', twoConflicts ? 'feature second\n' : 'second kept\n'); await git(f.cwd, 'switch', 'main'); await commit(f, 'file.txt', 'main current\n'); await git(f.cwd, 'switch', 'feature');
    await assert.rejects(() => git(f.cwd, 'rebase', '--apply', 'main')); const preview = await getProjectGitSkipPreview(f.cwd, 'rebase'); assert.equal(preview.currentIntegrationCommit, first);
    const result = await f.run(skipAction(preview, 'rebase')); assert.equal(result.outcome, twoConflicts ? 'conflict' : 'completed');
    if (twoConflicts) assert.equal((await getProjectGitSkipPreview(f.cwd, 'rebase')).currentIntegrationCommit, second);
    else assert.equal(await readFile(join(f.cwd, 'side.txt'), 'utf8'), 'second kept\n');
  }
});

test('manually committing a resolved cherry-pick or revert step does not hide its unfinished sequence', async t => {
  for (const kind of ['cherry_pick', 'revert']) {
    const f = await fixture(t);
    if (kind === 'cherry_pick') await startConflict(f, kind);
    else { const first = await commit(f, 'file.txt', 'first\n'); const second = await commit(f, 'side.txt', 'second\n'); await commit(f, 'file.txt', 'later\n'); await assert.rejects(() => git(f.cwd, 'revert', '--no-edit', first, second)); }
    await writeFile(join(f.cwd, 'file.txt'), 'manual resolution\n'); await git(f.cwd, 'add', 'file.txt'); await git(f.cwd, 'commit', '-m', 'manually resolve current step');
    assert.equal((await f.snapshot()).integrationState, kind); assert.ok((await getProjectGitSkipPreview(f.cwd, kind)).currentIntegrationCommit);
    assert.equal((await f.run({ type: 'continue_integration', kind })).outcome, 'completed'); assert.equal((await f.snapshot()).integrationState, null); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'manual resolution\n');
    if (kind === 'cherry_pick') assert.equal(await readFile(join(f.cwd, 'side.txt'), 'utf8'), 'second kept\n');
    else await assert.rejects(() => readFile(join(f.cwd, 'side.txt')), error => error.code === 'ENOENT');
  }
});

test('HTTP reset/skip preview and actions use the selected repository, validated inputs and operation ledger', async t => {
  const f = await fixture(t); await commit(f, 'file.txt', 'latest\n'); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'revision-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Revision actions', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const preview = await client.loadProjectGitResetPreview(project.id, repository.id, f.base, 'mixed'); assert.equal((await client.executeProjectGitAction(project.id, repository.id, resetAction(preview))).result.outcome, 'completed');
  const records = await client.loadProjectGitOperations(project.id); assert.ok(records.items.some(item => item.action === 'reset_revision' && item.status === 'completed' && item.commands.some(command => command.includes('--mixed'))));
  await assert.rejects(() => client.loadProjectGitResetPreview(project.id, 'other-repository', f.base, 'hard')); await assert.rejects(() => client.loadProjectGitResetPreview(project.id, repository.id, f.base, 'wrong')); await assert.rejects(() => client.loadProjectGitSkipPreview(project.id, repository.id, 'merge'));
  await git(f.cwd, 'reset', '--hard', f.base); await startConflict(f, 'cherry_pick'); const step = await client.loadProjectGitSkipPreview(project.id, repository.id, 'cherry_pick'); assert.equal((await client.executeProjectGitAction(project.id, repository.id, skipAction(step, 'cherry_pick'))).result.outcome, 'completed');
  assert.ok((await client.loadProjectGitOperations(project.id)).items.some(item => item.action === 'skip_integration' && item.status === 'completed'));
});
