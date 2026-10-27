import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot, getProjectGitHistory } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { describeUserFacingError, splitGitRemoteBranch } from '../packages/shared/src/index.ts';
import { branchActionNeedsReview } from '../apps/desktop/src/renderer/git/GitBranchManagementDialog.tsx';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout.trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-branches-')); const cwd = join(root, 'local'); await mkdir(cwd);
  const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '--initial-branch=main'); await git(cwd, 'config', 'user.name', 'Branch Test'); await git(cwd, 'config', 'user.email', 'branch@astragit.invalid'); await git(cwd, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'base');
  const remote = join(root, 'remote.git'); await git(root, 'clone', '--bare', cwd, remote); await git(remote, 'config', 'core.hooksPath', join(remote, 'hooks'));
  await git(cwd, 'remote', 'add', 'origin', remote); await git(cwd, 'fetch', 'origin'); await git(cwd, 'branch', '--set-upstream-to=origin/main', 'main');
  const snapshot = () => getProjectGitRepositorySnapshot(cwd);
  const run = (action, signal) => executeProjectGitAction(cwd, action, signal, env);
  return { root, cwd, remote, cleanup, snapshot, run };
}
async function unmerged(f, name = 'feature/remove') {
  await git(f.cwd, 'switch', '-c', name); await writeFile(join(f.cwd, 'feature.txt'), name + '\n'); await git(f.cwd, 'add', '.'); await git(f.cwd, 'commit', '-m', name); await git(f.cwd, 'switch', 'main'); return name;
}
async function remoteBranch(f, name = 'remove-me') {
  await git(f.cwd, 'push', 'origin', `HEAD:refs/heads/${name}`); await git(f.cwd, 'fetch', 'origin'); return name;
}
async function remoteDelete(f, branchName, remote = 'origin') {
  const snapshot = await f.snapshot();
  return { type: 'delete_remote_branch', remote, branchName, expectedTargetHeadSha: snapshot.remoteBranchHeads[`${remote}/${branchName}`], expectedRemotePushFingerprint: snapshot.remoteDetails.find(item => item.name === remote).pushFingerprint };
}
async function upstream(f, branchName, upstreamRef) {
  const snapshot = await f.snapshot(); return { type: 'set_upstream', branchName, upstreamRef, expectedUpstreamRef: snapshot.branchUpstreamRefs[branchName] || null, expectedTargetHeadSha: snapshot.localBranchHeads[branchName] };
}
async function until(read, done) {
  for (let index = 0; index < 150; index += 1) { const value = await read(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for branch-operation evidence');
}

test('normal deletion explains unmerged commits; explicit reviewed force deletion keeps working files and other refs', async t => {
  const f = await fixture(t); const branchName = await unmerged(f); const snapshot = await f.snapshot();
  await writeFile(join(f.cwd, 'file.txt'), 'unstaged\n'); await writeFile(join(f.cwd, 'untracked.txt'), 'untracked\n');
  const action = { type: 'delete_branch', branchName, expectedTargetHeadSha: snapshot.localBranchHeads[branchName] };
  await assert.rejects(() => f.run(action), error => { assert.equal(error.code, 'ASTRAGIT_GIT_BRANCH_NOT_MERGED', error.details); assert.equal(error.operationStatus, 'failed_before_write'); assert.match(describeUserFacingError(error).message, /强制删除/u); return true; });
  await f.run({ ...action, force: true });
  await assert.rejects(() => git(f.cwd, 'show-ref', '--verify', `refs/heads/${branchName}`));
  assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), snapshot.headSha); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'unstaged\n'); assert.equal(await readFile(join(f.cwd, 'untracked.txt'), 'utf8'), 'untracked\n');
  assert.equal(await git(f.remote, 'rev-parse', 'refs/heads/main'), snapshot.headSha);
});

test('force deletion still refuses current branches and branches checked out in another worktree', async t => {
  const f = await fixture(t); const branchName = await unmerged(f); const worktree = join(f.root, 'other-worktree'); await git(f.cwd, 'worktree', 'add', worktree, branchName);
  const snapshot = await f.snapshot(); assert.ok(snapshot.checkedOutBranches.includes(branchName));
  for (const branch of ['main', branchName]) await assert.rejects(() => f.run({ type: 'delete_branch', branchName: branch, force: true, expectedTargetHeadSha: snapshot.localBranchHeads[branch] }), error => error.code === 'ASTRAGIT_GIT_BRANCH_IN_USE' && error.operationStatus === 'failed_before_write');
  assert.equal(await git(worktree, 'branch', '--show-current'), branchName); assert.equal(await git(f.cwd, 'show-ref', '--verify', '--hash', `refs/heads/${branchName}`), snapshot.localBranchHeads[branchName]);
});

test('deletion rejects an unreviewed force request and branches moved after confirmation', async t => {
  const f = await fixture(t); const branchName = await unmerged(f); const snapshot = await f.snapshot();
  await assert.rejects(() => f.run({ type: 'delete_branch', branchName, force: true }), error => error.code === 'ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED');
  await git(f.cwd, 'branch', '-f', branchName, 'main');
  await assert.rejects(() => f.run({ type: 'delete_branch', branchName, force: true, expectedTargetHeadSha: snapshot.localBranchHeads[branchName] }), error => error.code === 'ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED');
  assert.equal(await git(f.cwd, 'rev-parse', `refs/heads/${branchName}`), snapshot.headSha);
});

test('tracking can move between remote and local upstreams and be cleared without altering source files', async t => {
  const f = await fixture(t); await git(f.cwd, 'branch', 'local-upstream'); await remoteBranch(f, 'other'); await writeFile(join(f.cwd, 'file.txt'), 'keep dirty\n');
  await f.run(await upstream(f, 'main', 'refs/remotes/origin/other')); assert.equal(await git(f.cwd, 'config', 'branch.main.remote'), 'origin'); assert.equal(await git(f.cwd, 'config', 'branch.main.merge'), 'refs/heads/other');
  await f.run(await upstream(f, 'main', 'refs/heads/local-upstream')); assert.equal(await git(f.cwd, 'config', 'branch.main.remote'), '.'); assert.equal((await f.snapshot()).branchUpstreamRefs.main, 'refs/heads/local-upstream');
  await f.run(await upstream(f, 'main', null)); assert.equal((await f.snapshot()).branchUpstreamRefs.main, '');
  await assert.rejects(() => git(f.cwd, 'config', '--get', 'branch.main.remote')); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'keep dirty\n');
});

test('tracking rejects stale relations, self upstreams and nonbranch revisions', async t => {
  const f = await fixture(t); await git(f.cwd, 'branch', 'base'); const action = await upstream(f, 'main', null); await git(f.cwd, 'branch', '--set-upstream-to=base', 'main');
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED');
  const self = await upstream(f, 'main', 'refs/heads/main'); const invalid = await upstream(f, 'main', 'HEAD');
  await assert.rejects(() => f.run(self), error => error.code === 'ASTRAGIT_GIT_UPSTREAM_SELF');
  await assert.rejects(() => f.run(invalid), error => error.code === 'ASTRAGIT_GIT_UPSTREAM_INVALID');
  assert.equal((await f.snapshot()).branchUpstreamRefs.main, 'refs/heads/base');
});

test('remote deletion removes the reviewed server branch while keeping the local branch and source contents', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); await git(f.cwd, 'branch', branchName); const snapshot = await f.snapshot();
  await f.run(await remoteDelete(f, branchName)); await assert.rejects(() => git(f.remote, 'show-ref', '--verify', `refs/heads/${branchName}`));
  assert.equal(await git(f.cwd, 'rev-parse', `refs/heads/${branchName}`), snapshot.headSha); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'base\n'); assert.ok(!(await f.snapshot()).remoteBranches.includes(`origin/${branchName}`));
});

test('remote deletion uses a lease and cannot delete new server commits missing from the reviewed tracking ref', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); const action = await remoteDelete(f, branchName);
  // A second checkout represents another contributor. Pushing by URL from f.cwd can
  // also refresh its matching remote-tracking ref on newer Git versions.
  const other = join(f.root, 'other-contributor'); await git(f.root, 'clone', '--branch', branchName, f.remote, other);
  await git(other, 'config', 'user.name', 'Other Contributor'); await git(other, 'config', 'user.email', 'other@astragit.invalid'); await git(other, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(other, 'file.txt'), 'new server commit\n'); await git(other, 'add', '.'); await git(other, 'commit', '-m', 'new commit'); const latest = await git(other, 'rev-parse', 'HEAD'); await git(other, 'push', 'origin', branchName);
  assert.notEqual(latest, action.expectedTargetHeadSha);
  assert.equal(await git(f.cwd, 'rev-parse', `refs/remotes/origin/${branchName}`), action.expectedTargetHeadSha);
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_REMOTE_BRANCH_CHANGED' && error.operationStatus === 'failed_before_write');
  assert.equal(await git(f.remote, 'rev-parse', `refs/heads/${branchName}`), latest); assert.equal(await git(f.cwd, 'rev-parse', `refs/remotes/origin/${branchName}`), action.expectedTargetHeadSha);
});

test('a changed push destination blocks remote deletion before contacting either repository', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); const action = await remoteDelete(f, branchName); const other = join(f.root, 'other.git'); await git(f.root, 'clone', '--bare', f.remote, other);
  await git(f.cwd, 'remote', 'set-url', '--push', 'origin', other);
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_REMOTE_TARGET_CHANGED' && error.operationStatus === 'failed_before_write');
  assert.equal(await git(f.remote, 'rev-parse', `refs/heads/${branchName}`), action.expectedTargetHeadSha); assert.equal(await git(other, 'rev-parse', `refs/heads/${branchName}`), action.expectedTargetHeadSha);
});

test('server hook deletion rejection has a specific explanation and retains the remote ref', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); const action = await remoteDelete(f, branchName);
  await writeFile(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\necho "Protected branch: deletion denied" >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(() => f.run(action), error => { assert.equal(error.code, 'ASTRAGIT_GIT_REMOTE_DELETE_REJECTED'); assert.match(describeUserFacingError(error).message, /服务器拒绝删除/u); assert.match(error.details, /Protected branch/u); return true; });
  assert.equal(await git(f.remote, 'rev-parse', `refs/heads/${branchName}`), action.expectedTargetHeadSha);
});

test('partial deletion across multiple push URLs is unconfirmed and requires review instead of a blind retry', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); const second = join(f.root, 'second.git'); await git(f.root, 'clone', '--bare', f.remote, second);
  await writeFile(join(f.cwd, 'file.txt'), 'second only\n'); await git(f.cwd, 'add', '.'); await git(f.cwd, 'commit', '-m', 'second server'); const latest = await git(f.cwd, 'rev-parse', 'HEAD'); await git(f.cwd, 'push', second, `HEAD:refs/heads/${branchName}`);
  await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', f.remote); await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', second);
  const action = await remoteDelete(f, branchName);
  await assert.rejects(() => f.run(action), error => { assert.equal(error.code, 'ASTRAGIT_GIT_REMOTE_DELETE_OUTCOME_UNKNOWN'); assert.equal(describeUserFacingError(error).outcomeUnconfirmed, true); assert.equal(branchActionNeedsReview(error), true); return true; });
  await assert.rejects(() => git(f.remote, 'show-ref', '--verify', `refs/heads/${branchName}`)); assert.equal(await git(second, 'rev-parse', `refs/heads/${branchName}`), latest);
});

test('canonical branch snapshots distinguish tags, retain real HEAD-suffixed branches and parse slash remote names', async t => {
  const f = await fixture(t); await git(f.cwd, 'tag', 'main'); await git(f.cwd, 'remote', 'add', 'team/origin', f.remote); await git(f.cwd, 'fetch', 'team/origin'); await remoteBranch(f, 'feature/HEAD');
  await git(f.cwd, 'symbolic-ref', 'refs/heads/local-alias', 'refs/heads/main'); await git(f.cwd, 'symbolic-ref', 'refs/remotes/origin/remote-alias', 'refs/remotes/origin/main'); await git(f.cwd, 'remote', 'set-head', 'origin', 'main');
  const snapshot = await f.snapshot(); assert.ok(snapshot.localBranches.includes('main')); assert.ok(snapshot.localBranchHeads.main); assert.ok(snapshot.remoteBranches.includes('origin/feature/HEAD'));
  assert.ok(snapshot.localBranches.includes('local-alias')); assert.equal(snapshot.localBranchHeads['local-alias'], snapshot.localBranchHeads.main); assert.ok(snapshot.remoteBranches.includes('origin/remote-alias')); assert.ok(!snapshot.remoteBranches.includes('origin/HEAD'));
  assert.deepEqual(splitGitRemoteBranch('team/origin/main', ['team', 'team/origin']), { remote: 'team/origin', branch: 'main' });
  await f.run(await upstream(f, 'main', 'refs/remotes/team/origin/main'));
  assert.equal(await git(f.cwd, 'config', 'branch.main.remote'), 'team/origin');
  assert.equal((await f.snapshot()).branchUpstreamRefs.main, 'refs/remotes/team/origin/main');
});

test('branch merges select the branch instead of its same-named tag and tracking checkout uses an explicit remote ref', async t => {
  const f = await fixture(t); const branchName = await unmerged(f, 'feature/shadowed'); const target = await git(f.cwd, 'rev-parse', `refs/heads/${branchName}`); await git(f.cwd, 'tag', branchName);
  assert.equal((await getProjectGitHistory(f.cwd, 0, `refs/heads/${branchName}`)).commits[0].hash, target); assert.notEqual((await getProjectGitHistory(f.cwd, 0, `refs/tags/${branchName}`)).commits[0].hash, target);
  await git(f.cwd, 'branch', `refs/heads/${branchName}`);
  await f.run({ type: 'merge', branchName: `refs/heads/${branchName}` }); assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), target);
  await git(f.cwd, 'reset', '--hard', `refs/tags/${branchName}`);
  await f.run({ type: 'merge', branchName }); assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), target);
  await git(f.cwd, 'tag', 'origin/main');
  await f.run({ type: 'create_branch', branchName: 'tracked-exact', baseRef: 'refs/remotes/origin/main', trackRemote: true });
  assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), await git(f.remote, 'rev-parse', 'refs/heads/main')); assert.equal(await git(f.cwd, 'config', 'branch.tracked-exact.merge'), 'refs/heads/main');
});

test('HTTP branch operations use selected repository guards and retain independent operation history', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'branch-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  await git(f.cwd, 'branch', 'merged-one'); await git(f.cwd, 'branch', 'merged-two');
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Branches', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  for (const branchName of ['merged-one', 'merged-two']) assert.equal((await client.executeProjectGitAction(project.id, repository.id, { type: 'delete_branch', branchName, expectedTargetHeadSha: repository.snapshot.localBranchHeads[branchName] })).result.outcome, 'completed');
  const records = await client.loadProjectGitOperations(project.id); assert.equal(records.items.filter(item => item.action === 'delete_branch' && item.status === 'completed').length, 2);
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'delete_remote_branch', remote: 'origin', branchName: 'main' })); assert.equal(await git(f.remote, 'rev-parse', 'refs/heads/main'), repository.snapshot.headSha);
});

test('cancelling a pending remote deletion keeps unknown outcome semantics and records the attempted command', async t => {
  const f = await fixture(t); const branchName = await remoteBranch(f); const marker = join(f.root, 'receive-started'); const quoted = "'" + marker.replaceAll("'", "'\\''") + "'";
  await writeFile(join(f.remote, 'hooks/pre-receive'), `#!/bin/sh\nprintf '%s' "$$" > ${quoted}\nsleep 20\nexit 1\n`, { mode: 0o755 });
  const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'cancel-branch-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Cancellation', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const attempt = client.executeProjectGitAction(project.id, repository.id, await remoteDelete(f, branchName)).then(value => ({ value }), error => ({ error }));
  await until(() => readFile(marker, 'utf8').catch(() => ''), Boolean); assert.equal((await client.cancelProjectGitAction(project.id, repository.id)).cancelled, true);
  const result = await attempt; assert.equal(result.error.error, 'ASTRAGIT_CANCELLED'); assert.equal(result.error.operationStatus, 'unknown_after_write'); assert.equal(branchActionNeedsReview(result.error), true);
  assert.ok((await client.loadProjectGitOperations(project.id)).items[0].commands.some(command => command.includes('force-with-lease'))); assert.equal(await git(f.remote, 'rev-parse', `refs/heads/${branchName}`), repository.snapshot.remoteBranchHeads[`origin/${branchName}`]);
});
