import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { commitPushTarget, commitThenPush } from '../apps/desktop/src/renderer/git/commitThenPush.ts';
import { executeProjectGitAction, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';

test('commit push target uses the actual tracked branch, or an unambiguous first-push destination', () => {
  const snapshot = { branch: 'feature/local', detached: false, remotes: ['origin', 'team/mirror'], upstream: 'team/mirror/review/remote' };
  assert.deepEqual(commitPushTarget(snapshot), { sourceBranch: 'feature/local', remote: 'team/mirror', targetBranch: 'review/remote', setUpstream: false });
  assert.deepEqual(commitPushTarget({ ...snapshot, upstream: null }), { sourceBranch: 'feature/local', remote: 'origin', targetBranch: 'feature/local', setUpstream: true });
  assert.equal(commitPushTarget({ ...snapshot, detached: true }), null);
  assert.equal(commitPushTarget({ ...snapshot, upstream: null, remotes: [] }), null);
  assert.equal(commitPushTarget({ ...snapshot, upstream: null, remotes: ['one', 'two'] }), null);
  assert.equal(commitPushTarget({ ...snapshot, upstream: 'missing/main' }), null);
  assert.equal(commitPushTarget({ ...snapshot, upstream: 'main' }), null);
  assert.equal(commitPushTarget({ ...snapshot, upstream: null, remotes: ['publish'] }).remote, 'publish');
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-commit-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), remote = join(root, 'remote.git');
  await mkdir(repo);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '--bare', remote); git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Commit Push Test'); git(repo, 'config', 'user.email', 'test@astragit.invalid'); git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '.git/hooks');
  await writeFile(join(repo, 'selected.txt'), 'baseline\n'); await writeFile(join(repo, 'keep.txt'), 'keep\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'baseline'); git(repo, 'remote', 'add', 'origin', remote);
  await writeFile(join(repo, 'selected.txt'), 'committed content\n'); git(repo, 'add', 'selected.txt');
  await writeFile(join(repo, 'keep.txt'), 'local change stays unstaged\n');
  const events = [];
  const execute = async action => {
    events.push(action.type);
    const result = await executeProjectGitAction(repo, action);
    return { result, snapshot: await getProjectGitRepositorySnapshot(repo) };
  };
  const snapshot = await getProjectGitRepositorySnapshot(repo);
  const run = (overrides = {}) => commitThenPush({ snapshot, target: commitPushTarget(snapshot), message: 'feat: selected content', execute, onCommitted: () => events.push('committed'), onPushing: () => events.push('pushing'), ...overrides });
  return { root, repo, remote, git, snapshot, run, events, execute };
}

test('commit then first push publishes the new commit and tracks the branch, retaining unstaged edits', async t => {
  const f = await fixture(t);
  const response = await f.run();
  assert.equal(response.result.outcome, 'completed');
  assert.deepEqual(f.events, ['commit', 'committed', 'pushing', 'push']);
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), f.git(f.remote, 'rev-parse', 'refs/heads/main'));
  assert.equal(f.git(f.repo, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
  assert.equal(f.git(f.repo, 'status', '--porcelain').trim(), 'M keep.txt');
  assert.equal(f.git(f.repo, 'rev-list', '--count', 'HEAD'), '2');
});

test('a rejected commit retains the draft and never starts a push', async t => {
  const f = await fixture(t);
  await writeFile(join(f.repo, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(() => f.run());
  assert.deepEqual(f.events, ['commit']);
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), f.snapshot.headSha);
  assert.equal(f.git(f.remote, 'for-each-ref', 'refs/heads'), '');
});

test('a rejected push preserves the completed commit; retry pushes only, without duplicating it', async t => {
  const f = await fixture(t);
  const hook = join(f.remote, 'hooks/pre-receive');
  await writeFile(hook, '#!/bin/sh\necho "fixture rejects push" >&2\nexit 1\n', { mode: 0o755 });
  let push;
  await assert.rejects(() => f.run({ onPushing: action => { push = action; f.events.push('pushing'); } }));
  assert.deepEqual(f.events, ['commit', 'committed', 'pushing', 'push']);
  const committed = f.git(f.repo, 'rev-parse', 'HEAD');
  assert.notEqual(committed, f.snapshot.headSha);
  assert.equal(push.expectedHeadSha, committed);
  assert.equal(f.git(f.remote, 'for-each-ref', 'refs/heads'), '');
  await rm(hook);
  await f.execute(push);
  assert.equal(f.git(f.repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.equal(f.git(f.remote, 'rev-parse', 'main'), committed);
});

test('a branch change before commit is rejected, and a branch change after commit stops automatic pushing', async t => {
  const f = await fixture(t);
  f.git(f.repo, 'switch', '-c', 'other');
  await assert.rejects(() => f.run(), error => error.code === 'ASTRAGIT_GIT_SELECTION_CHANGED');
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), f.snapshot.headSha);
  f.git(f.repo, 'switch', 'main');
  await assert.rejects(() => f.run({ onCommitted: () => { f.git(f.repo, 'switch', 'other'); } }), error => error.code === 'ASTRAGIT_GIT_SELECTION_CHANGED');
  assert.equal(f.git(f.remote, 'for-each-ref', 'refs/heads'), '');
  assert.equal(f.git(f.repo, 'rev-list', '--count', 'main'), '2');
});
