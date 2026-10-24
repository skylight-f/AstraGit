import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitInteractiveRebasePreview, getProjectGitRepositorySnapshot, getProjectGitSkipPreview, getProjectGitCommitDetail } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { describeUserFacingError } from '../packages/shared/src/index.ts';
const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-interactive-'))); const cwd = join(root, "repository 'quote' $(not-an-executable); end"); await mkdir(cwd);
  const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Rebase Test'); await git('config', 'user.email', 'rebase@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base'); const base = await git('rev-parse', 'HEAD'); const commits = [];
  for (const name of ['A', 'B', 'C']) { await writeFile(join(cwd, options.conflict && name === 'A' ? 'base.txt' : `${name}.txt`), `${name}\n`); await git('add', '.'); await git('commit', '-m', `feature ${name}\n\n# original comment ${name}\nbody ${name}`); commits.push(await git('rev-parse', 'HEAD')); }
  const head = await git('rev-parse', 'HEAD');
  const run = (action, override, onCommand) => executeProjectGitAction(cwd, action, undefined, { ...env, ...override }, onCommand);
  const preview = onto => getProjectGitInteractiveRebasePreview(cwd, base, onto);
  const action = value => ({ type: 'interactive_rebase', baseSha: value.baseSha, ontoSha: value.ontoSha, expectedFingerprint: value.fingerprint, steps: value.commits.map(commit => ({ sha: commit.sha, action: 'pick' })) });
  return { root, cwd, git, run, base, head, commits, preview, action, cleanup };
}

test('interactive preview reads the complete ordered commit messages without changing the index or HEAD', async t => {
  const f = await fixture(t); const index = await readFile(join(f.cwd, '.git/index')); const preview = await f.preview();
  assert.deepEqual(preview.commits.map(commit => commit.sha), f.commits); assert.equal(preview.baseSha, f.base); assert.equal(preview.ontoSha, f.base); assert.equal(preview.changedFileCount, 0); assert.equal(preview.mergeCount, 0); assert.match(preview.commits[0].message, /# original comment A/u); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
});

test('native interactive rebase reorders independent commits and leaves the final tree and other refs intact', async t => {
  const f = await fixture(t); await f.git('branch', 'retained', f.head); const preview = await f.preview(); const action = f.action(preview); action.steps = [action.steps[2], action.steps[0], action.steps[1]];
  const result = await f.run(action); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('branch', '--show-current'), 'main'); assert.equal(await f.git('diff', '--name-only', f.head, 'HEAD'), ''); assert.equal(await f.git('rev-parse', 'retained'), f.head); assert.equal(await f.git('log', '--reverse', '--format=%s', `${f.base}..HEAD`), 'feature C\nfeature A\nfeature B'); await assert.rejects(() => lstat(join(f.cwd, '.git/astragit-interactive-rebase')), error => error.code === 'ENOENT');
});

test('reword followed by squash and fixup preserves the reviewed full group message, including hash lines and shell-like text', async t => {
  const f = await fixture(t); const preview = await f.preview(); const action = f.action(preview); const message = '合并说明\n\n# keep this literal line\nbody $(not-an-executable) `literal`\n';
  action.steps = [{ sha: f.commits[0], action: 'reword', message: 'first rewritten\n\n# first body\n' }, { sha: f.commits[1], action: 'squash' }, { sha: f.commits[2], action: 'fixup' }]; action.groupMessages = { [f.commits[0]]: message };
  await f.run(action); assert.equal(await f.git('rev-list', '--count', `${f.base}..HEAD`), '1'); assert.equal(await f.git('show', '-s', '--format=%B', 'HEAD'), message.trimEnd()); assert.equal(await f.git('show', '-s', '--format=%an', 'HEAD'), 'Rebase Test'); assert.equal(await f.git('diff', '--name-only', f.head, 'HEAD'), '');
});

test('drop removes only the selected commit while all-drop rewinds to the reviewed base', async t => {
  const f = await fixture(t); let preview = await f.preview(); let action = f.action(preview); action.steps[0].action = 'drop'; await f.run(action); assert.equal(await f.git('rev-list', '--count', `${f.base}..HEAD`), '2'); await assert.rejects(() => lstat(join(f.cwd, 'A.txt')), error => error.code === 'ENOENT'); assert.equal(await readFile(join(f.cwd, 'B.txt'), 'utf8'), 'B\n');
  preview = await f.preview(); action = f.action(preview); action.steps = action.steps.map(step => ({ ...step, action: 'drop' })); await f.run(action); assert.equal(await f.git('rev-parse', 'HEAD'), f.base);
});

test('native edit pause exposes a bound amendment step and resumes remaining commits after explicitly amending staged contents', async t => {
  const f = await fixture(t); const preview = await f.preview(); const action = f.action(preview); action.steps[0].action = 'edit'; await f.run(action); let snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.integrationState, 'rebase'); assert.equal(snapshot.rebaseEdit.originalCommitSha, f.commits[0]);
  await assert.rejects(() => f.run({ type: 'amend_commit', message: 'ordinary amendment', expectedHeadSha: snapshot.headSha, expectedBranch: snapshot.branch, expectedIndexFingerprint: snapshot.indexFingerprint }), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_ACTIVE');
  await writeFile(join(f.cwd, 'extra.txt'), 'extra\n'); await f.run({ type: 'stage', paths: ['extra.txt'] }); snapshot = await getProjectGitRepositorySnapshot(f.cwd);
  const amend = { type: 'amend_rebase_step', message: 'edited step\n\n# preserved\n', expectedHeadSha: snapshot.headSha, expectedIndexFingerprint: snapshot.indexFingerprint, expectedStepFingerprint: snapshot.rebaseEdit.fingerprint }; await f.run(amend); await assert.rejects(() => f.run(amend), error => error.code === 'ASTRAGIT_GIT_REBASE_EDIT_CHANGED');
  await f.run({ type: 'continue_integration', kind: 'rebase' }); snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.integrationState, null); assert.equal(snapshot.rebaseEdit, null); assert.equal(snapshot.branch, 'main'); assert.equal(await readFile(join(f.cwd, 'extra.txt'), 'utf8'), 'extra\n'); assert.match(await f.git('log', '--reverse', '--format=%B', `${f.base}..HEAD`), /edited step\n\n# preserved/u);
});

test('conflicts retain the durable plan and a fresh process continues later reword steps without using an inherited editor', async t => {
  const f = await fixture(t, { conflict: true }); await f.git('switch', '-c', 'onto', f.base); await writeFile(join(f.cwd, 'base.txt'), 'onto\n'); await f.git('commit', '-am', 'onto'); const onto = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); const preview = await f.preview(onto); const action = f.action(preview); action.steps[1] = { ...action.steps[1], action: 'reword', message: 'later message\n\n# preserve after restart\n' };
  assert.equal((await f.run(action)).outcome, 'conflict'); assert.deepEqual((await getProjectGitRepositorySnapshot(f.cwd)).conflictFiles, ['base.txt']); await writeFile(join(f.cwd, 'base.txt'), 'resolved\n'); await f.run({ type: 'stage', paths: ['base.txt'] });
  const moduleUrl = new URL('../packages/git-core/dist/index.js', import.meta.url).href; const code = `import {executeProjectGitAction} from ${JSON.stringify(moduleUrl)}; const result=await executeProjectGitAction(${JSON.stringify(f.cwd)}, {type:'continue_integration',kind:'rebase'}); process.stdout.write(JSON.stringify({outcome:result.outcome,branch:result.branch}));`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', code], { cwd: f.cwd, env: { ...env, GIT_EDITOR: '/usr/bin/false' } }); assert.equal(JSON.parse(result.stdout).outcome, 'completed'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).branch, 'main'); assert.match(await f.git('log', '--format=%B', `${onto}..HEAD`), /later message\n\n# preserve after restart/u); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'resolved\n');
});

test('hidden assume-unchanged edits block replay without altering real index flags; unchanged hidden files remain usable', async t => {
  const f = await fixture(t); await f.git('update-index', '--assume-unchanged', 'base.txt'); const index = await readFile(join(f.cwd, '.git/index')); assert.equal((await f.preview()).changedFileCount, 0); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); await writeFile(join(f.cwd, 'base.txt'), 'hidden local\n'); const preview = await f.preview(); assert.ok(preview.changedFiles.includes('base.txt'));
  await assert.rejects(() => f.run(f.action(preview)), error => error.code === 'ASTRAGIT_GIT_REBASE_LOCAL_CHANGES' && error.affectedFiles.includes('base.txt')); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'hidden local\n'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('transient ignored replay paths require explicit confirmation even when absent from the final HEAD and onto trees', async t => {
  const f = await fixture(t); await f.git('reset', '--hard', f.base); await writeFile(join(f.cwd, 'transient.secret'), 'tracked transient\n'); await f.git('add', '.'); await f.git('commit', '-m', 'add transient'); await f.git('rm', 'transient.secret'); await f.git('commit', '-m', 'remove transient'); await writeFile(join(f.cwd, '.git/info/exclude'), 'transient.secret\n'); await writeFile(join(f.cwd, 'transient.secret'), 'personal ignored\n'); const head = await f.git('rev-parse', 'HEAD'); const preview = await f.preview(); assert.ok(preview.untrackedObstacles.includes('transient.secret'));
  await assert.rejects(() => f.run(f.action(preview)), error => error.code === 'ASTRAGIT_GIT_REBASE_OBSTACLES_CONFIRMATION_REQUIRED'); assert.equal(await readFile(join(f.cwd, 'transient.secret'), 'utf8'), 'personal ignored\n'); assert.equal(await f.git('rev-parse', 'HEAD'), head);
  await writeFile(join(f.cwd, 'transient.secret'), 'changed since review\n'); await assert.rejects(() => f.run({ ...f.action(preview), allowOverwriteObstacles: true }), error => error.code === 'ASTRAGIT_GIT_REBASE_PREVIEW_CHANGED'); assert.equal(await readFile(join(f.cwd, 'transient.secret'), 'utf8'), 'changed since review\n');
});

test('duplicate, missing, injected and invalid first-combine instructions never create native rebase state', async t => {
  const f = await fixture(t); const preview = await f.preview(); const action = f.action(preview);
  for (const steps of [[action.steps[0], action.steps[0], action.steps[2]], action.steps.slice(1), [{ ...action.steps[0], action: 'exec' }, ...action.steps.slice(1)], [{ ...action.steps[0], action: 'squash' }, ...action.steps.slice(1)], [{ ...action.steps[0], action: 'reword', message: 'bad\0message' }, ...action.steps.slice(1)]]) await assert.rejects(() => f.run({ ...action, steps }), error => ['ASTRAGIT_GIT_REBASE_PLAN_INVALID', 'ASTRAGIT_GIT_REBASE_FIRST_COMBINED'].includes(error.code));
  assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

test('corrupt recovery data and externally modified todo stop continuation but never prevent aborting the native rebase', async t => {
  const f = await fixture(t); const preview = await f.preview(); const action = f.action(preview); action.steps[0].action = 'edit'; await f.run(action); const id = (await readFile(join(f.cwd, '.git/rebase-merge/astragit-plan-id'), 'utf8')).trim(); await writeFile(join(f.cwd, '.git/astragit-interactive-rebase', id, 'manifest.json'), '{broken');
  await assert.rejects(() => f.run({ type: 'continue_integration', kind: 'rebase' }), error => error.code === 'ASTRAGIT_GIT_REBASE_RECOVERY_INVALID'); await f.run({ type: 'abort_integration', kind: 'rebase' }); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
  const fresh = await f.preview(); const again = f.action(fresh); again.steps[0].action = 'edit'; await f.run(again); await writeFile(join(f.cwd, '.git/rebase-merge/git-rebase-todo'), `pick ${f.commits[2]}\npick ${f.commits[1]}\n`); await assert.rejects(() => f.run({ type: 'continue_integration', kind: 'rebase' }), error => error.code === 'ASTRAGIT_GIT_REBASE_PLAN_CHANGED'); await f.run({ type: 'abort_integration', kind: 'rebase' }); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
});


test('fixup keeps the anchor message while empty reword messages remain empty', async t => {
  const f = await fixture(t); let preview = await f.preview(); let action = f.action(preview); action.steps[1].action = 'fixup'; await f.run(action); assert.equal(await f.git('rev-list', '--count', `${f.base}..HEAD`), '2'); assert.match(await f.git('show', '-s', '--format=%B', 'HEAD~1'), /feature A/u); assert.doesNotMatch(await f.git('show', '-s', '--format=%B', 'HEAD~1'), /feature B/u);
  preview = await f.preview(); action = f.action(preview); action.steps[0] = { ...action.steps[0], action: 'reword', message: '' }; await f.run(action); assert.equal(await f.git('show', '-s', '--format=%B', 'HEAD~1'), '');
});

test('skipping a conflicting replay keeps the durable plan for later reword steps', async t => {
  const f = await fixture(t, { conflict: true }); await f.git('switch', '-c', 'onto', f.base); await writeFile(join(f.cwd, 'base.txt'), 'onto\n'); await f.git('commit', '-am', 'onto'); const onto = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main'); const preview = await f.preview(onto); const action = f.action(preview); action.steps[1] = { ...action.steps[1], action: 'reword', message: 'after skip\n\n# preserved\n' }; assert.equal((await f.run(action)).outcome, 'conflict');
  const skip = await getProjectGitSkipPreview(f.cwd, 'rebase'); await f.run({ type: 'skip_integration', kind: 'rebase', expectedFingerprint: skip.fingerprint }); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.equal(await f.git('log', '--reverse', '--format=%s', `${onto}..HEAD`), 'after skip\nfeature C'); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'onto\n');
});

test('flattening merge nodes requires explicit review and does not silently preserve merge-only changes', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'side', f.base); await writeFile(join(f.cwd, 'side.txt'), 'side\n'); await f.git('add', '.'); await f.git('commit', '-m', 'side'); await f.git('switch', 'main'); await f.git('merge', '--no-commit', '--no-ff', 'side'); await writeFile(join(f.cwd, 'merge-only.txt'), 'merge resolution\n'); await f.git('add', '.'); await f.git('commit', '-m', 'merge plus manual changes'); const original = await f.git('rev-parse', 'HEAD'); const preview = await f.preview(); assert.equal(preview.mergeCount, 1); assert.equal(preview.commits.length, 4);
  await assert.rejects(() => f.run(f.action(preview)), error => error.code === 'ASTRAGIT_GIT_REBASE_MERGES_CONFIRMATION_REQUIRED'); assert.equal(await f.git('rev-parse', 'HEAD'), original); await f.run({ ...f.action(preview), allowFlattenMerges: true }); assert.equal(await f.git('rev-list', '--count', '--merges', `${f.base}..HEAD`), '0'); await assert.rejects(() => lstat(join(f.cwd, 'merge-only.txt')), error => error.code === 'ENOENT'); assert.equal(await readFile(join(f.cwd, 'side.txt'), 'utf8'), 'side\n');
});

test('linked worktrees and detached HEAD use the actual native metadata and restore detached state', async t => {
  const f = await fixture(t); const linked = join(f.root, 'linked'); await f.git('worktree', 'add', '--detach', linked, f.head); const preview = await getProjectGitInteractiveRebasePreview(linked, f.base); assert.equal(preview.detached, true); const action = f.action(preview); action.steps[0].action = 'edit'; await executeProjectGitAction(linked, action, undefined, env); let snapshot = await getProjectGitRepositorySnapshot(linked); assert.equal(snapshot.rebaseEdit.originalCommitSha, f.commits[0]); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
  await executeProjectGitAction(linked, { type: 'continue_integration', kind: 'rebase' }, undefined, env); snapshot = await getProjectGitRepositorySnapshot(linked); assert.equal(snapshot.detached, true); assert.equal(snapshot.integrationState, null); assert.equal(snapshot.headSha, f.head); assert.equal(await f.git('rev-parse', 'main'), f.head);
});

test('native pre-rebase refusal has a specific hook explanation and never claims the custom hook wrote nothing', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'hooks')); const hook = join(f.root, 'hooks/pre-rebase'); await writeFile(hook, '#!/bin/sh\necho "pre-rebase hook failed" >&2\nexit 1\n'); await chmod(hook, 0o755); const preview = await f.preview(); await assert.rejects(() => f.run(f.action(preview)), error => error.code === 'ASTRAGIT_GIT_HOOK_REJECTED' && error.operationStatus === 'unknown_after_write' && /钩子检查未通过/u.test(describeUserFacingError(error).message)); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null);
});

async function serviceFixture(t) {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'interactive-rebase-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); f.cleanup.push(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Interactive rebase', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const send = async body => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/interactive-rebase`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); const value = await response.json(); return { response, value }; };
  const envelope = input => buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: input });
  return { ...f, get client() { return client; }, get server() { return server; }, project, repository, send, envelope, restart: async () => { await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); } };
}

test('HTTP plans use stable command receipts so duplicate and restarted continuation cannot skip edit pauses', async t => {
  const f = await serviceFixture(t); const preview = await f.client.loadProjectGitInteractiveRebasePreview(f.project.id, f.repository.id, f.base); const action = f.action(preview); action.steps[0].action = 'edit'; action.steps[1].action = 'edit'; const start = await f.envelope(action); const first = await f.send(start); assert.equal(first.response.status, 200); assert.equal(first.value.snapshot.rebaseEdit.originalCommitSha, f.commits[0]); assert.equal((await f.send(start)).value.snapshot.rebaseEdit.originalCommitSha, f.commits[0]);
  const next = await f.envelope({ type: 'continue_integration', kind: 'rebase' }); const second = await f.send(next); assert.equal(second.response.status, 200); assert.equal(second.value.snapshot.rebaseEdit.originalCommitSha, f.commits[1]); const atSecond = await f.git('rev-parse', 'HEAD'); await f.send(next); assert.equal(await f.git('rev-parse', 'HEAD'), atSecond); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).rebaseEdit.originalCommitSha, f.commits[1]);
  await f.restart(); assert.equal((await f.send(next)).value.snapshot.rebaseEdit.originalCommitSha, f.commits[1]); assert.equal(await f.git('rev-parse', 'HEAD'), atSecond); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(record => record.action === 'continue_integration').length, 1);
  await f.client.executeProjectGitAction(f.project.id, f.repository.id, { type: 'abort_integration', kind: 'rebase' }); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
});

test('HTTP dedicated route rejects raw, mismatched-scope, injected and unrelated writes, and accepts complete messages above the generic body limit', async t => {
  const f = await serviceFixture(t); const preview = await f.client.loadProjectGitInteractiveRebasePreview(f.project.id, f.repository.id, f.base); const action = f.action(preview);
  assert.equal((await f.send(action)).response.status, 400); assert.notEqual((await f.send(await f.envelope({ type: 'stage', paths: ['base.txt'] }))).response.status, 200);
  const wrong = await f.envelope(action); wrong.command.scope.id = 'another-repository'; assert.equal((await f.send(wrong)).response.status, 400);
  const injected = { ...action, steps: action.steps.map((step, index) => index === 0 ? { ...step, action: 'exec', message: 'must not execute' } : step) }; assert.notEqual((await f.send(await f.envelope(injected))).response.status, 200); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
  const message = 'large message\n\n' + '\x02'.repeat(100_000); const large = { ...action, steps: action.steps.map(step => ({ ...step, action: 'reword', message })) }; const body = await f.envelope(large); assert.ok(Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024); const result = await f.send(body); assert.equal(result.response.status, 200, JSON.stringify(result.value)); assert.equal(await f.git('show', '-s', '--format=%B', 'HEAD'), message); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(record => record.action === 'interactive_rebase' && record.status === 'completed').length, 1);
});


test('an explicitly empty squash group is applied by fixed native amend instructions and survives an edit pause', async t => {
  const f = await fixture(t); const preview = await f.preview(); const action = f.action(preview); action.steps = [{ sha: f.commits[0], action: 'edit' }, { sha: f.commits[1], action: 'squash' }, { sha: f.commits[2], action: 'fixup' }]; action.groupMessages = { [f.commits[0]]: '' }; await f.run(action); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).rebaseEdit.originalCommitSha, f.commits[0]); await f.run({ type: 'continue_integration', kind: 'rebase' }); assert.equal(await f.git('rev-list', '--count', `${f.base}..HEAD`), '1'); assert.equal(await f.git('show', '-s', '--format=%B', 'HEAD'), ''); assert.equal(await f.git('diff', '--name-only', f.head, 'HEAD'), '');
});


test('empty-message native amend hook failures remain paused and resume only on an explicit continuation', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'hooks')); const hook = join(f.root, 'hooks/commit-msg'); await writeFile(hook, '#!/bin/sh\necho "commit-msg hook failed" >&2\nexit 1\n'); await chmod(hook, 0o755); const preview = await f.preview(); const action = f.action(preview); action.steps[0] = { ...action.steps[0], action: 'reword', message: '' };
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_HOOK_REJECTED'); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, 'rebase'); assert.equal(await f.git('show', '-s', '--format=%s', 'HEAD'), 'feature A'); assert.match(await readFile(join(f.cwd, '.git/rebase-merge/git-rebase-todo'), 'utf8'), /^exec git /u);
  await writeFile(hook, '#!/bin/sh\nexit 0\n'); await f.run({ type: 'continue_integration', kind: 'rebase' }); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).integrationState, null); assert.equal(await f.git('show', '-s', '--format=%B', 'HEAD~2'), ''); assert.equal(await f.git('diff', '--name-only', f.head, 'HEAD'), '');
});

test('invalid bases give actionable range errors and local remote-tracking publication changes invalidate the review', async t => {
  const f = await fixture(t); await assert.rejects(() => getProjectGitInteractiveRebasePreview(f.cwd, 'does-not-exist'), error => error.code === 'ASTRAGIT_GIT_REBASE_RANGE_INVALID'); await assert.rejects(() => f.preview('missing-new-base'), error => error.code === 'ASTRAGIT_GIT_REBASE_RANGE_INVALID'); await f.git('update-ref', 'refs/remotes/origin/main', f.commits[0]); const preview = await f.preview(); assert.equal(preview.publishedCount, 1); await f.git('update-ref', 'refs/remotes/origin/main', f.head); await assert.rejects(() => f.run(f.action(preview)), error => error.code === 'ASTRAGIT_GIT_REBASE_PREVIEW_CHANGED'); assert.equal((await f.preview()).publishedCount, 3); assert.equal(await f.git('rev-parse', 'HEAD'), f.head);
});


test('commit details preserve the exact message for edit-step amendment while retaining the existing display body', async t => {
  const f = await fixture(t); const message = '  intentional leading space\n\n# literal comment\nunit separator \x1f remains data\n\ttrailing\t\n\n'; await f.git('commit', '--amend', '--cleanup=verbatim', '-m', message); const head = await f.git('rev-parse', 'HEAD'); const detail = await getProjectGitCommitDetail(f.cwd, head); assert.equal(detail.fullMessage, message); assert.equal(detail.body, message.trim());
  const preview = await f.preview(); const action = f.action(preview); action.steps[action.steps.length - 1].action = 'edit'; await f.run(action); const snapshot = await getProjectGitRepositorySnapshot(f.cwd); const paused = await getProjectGitCommitDetail(f.cwd, snapshot.headSha); assert.equal(paused.fullMessage, message); await f.run({ type: 'amend_rebase_step', message: paused.fullMessage, expectedHeadSha: snapshot.headSha, expectedIndexFingerprint: snapshot.indexFingerprint, expectedStepFingerprint: snapshot.rebaseEdit.fingerprint }); await f.run({ type: 'continue_integration', kind: 'rebase' }); assert.equal((await getProjectGitCommitDetail(f.cwd, await f.git('rev-parse', 'HEAD'))).fullMessage, message);
});
