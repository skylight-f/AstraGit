import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
import { ProjectGitWorkbenchService } from '../packages/git-server/dist/projectGitWorkbenchService.js';
import { ProjectStore } from '../packages/git-server/dist/projectStore.js';
import { OperationHistoryStore } from '../packages/git-server/dist/operationHistoryStore.js';
import { gitFailureDiagnostics } from '../packages/git-server/dist/projectGitWorkbenchService.js';

const execute = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-git-diagnostics-'));
  const repository = join(root, 'repo'); await mkdir(repository);
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await execute('git', args, { cwd: repository, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } })).stdout.trim();
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'AstraGit Test'); await git('config', 'user.email', 'test@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  const put = (path, text) => writeFile(join(repository, path), text);
  await put('file.txt', 'base\n'); await git('add', '.'); await git('commit', '-m', 'baseline');
  const action = value => executeProjectGitAction(repository, value, undefined, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  return { root, repository, git, put, action };
}
const rejectsCode = (work, code, verify = () => {}) => assert.rejects(work, error => {
  assert.equal(error.code, code); verify(error); return true;
});

test('checkout distinguishes local changes, untracked overwrite, missing branch and existing conflicts', async t => {
  const f = await fixture(t);
  await f.git('switch', '-c', 'feature'); await f.put('file.txt', 'feature\n'); await f.put('target.txt', 'tracked on feature\n');
  await f.git('add', '.'); await f.git('commit', '-m', 'feature'); await f.git('switch', 'main');
  await f.put('file.txt', 'local work\n');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'feature' }), 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', error => {
    assert.equal(error.blockedBy, 'tracked'); assert.equal(error.operationStatus, 'failed_before_write'); assert.match(error.details, /file\.txt/u);
    assert.deepEqual(error.affectedFiles, ['file.txt']); assert.equal(error.affectedFileCount, 1);
  });
  assert.equal(await f.git('branch', '--show-current'), 'main'); assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'local work\n');
  await f.git('restore', 'file.txt'); await f.put('target.txt', 'untracked work\n');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'feature' }), 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', error => { assert.equal(error.blockedBy, 'untracked'); assert.deepEqual(error.affectedFiles, ['target.txt']); });
  await rm(join(f.repository, 'target.txt'));
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'missing' }), 'ASTRAGIT_GIT_BRANCH_NOT_FOUND');
  await f.put('file.txt', 'main change\n'); await f.git('add', '.'); await f.git('commit', '-m', 'main');
  const merge = await f.action({ type: 'merge', branchName: 'feature' });
  assert.equal(merge.outcome, 'conflict'); assert.equal(merge.operationStage, 'integration');
  const before = await f.git('status', '--porcelain');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'feature', smart: true }), 'ASTRAGIT_GIT_CHECKOUT_CONFLICTED', error => {
    assert.equal(error.operationStage, 'preflight'); assert.equal(error.operationStatus, 'failed_before_write'); assert.match(error.details, /UU file\.txt/u);
    assert.deepEqual(error.affectedFiles, ['file.txt']);
  });
  await rejectsCode(() => f.action({ type: 'merge', branchName: 'feature' }), 'ASTRAGIT_GIT_UNMERGED_FILES');
  assert.equal(await f.git('status', '--porcelain'), before);
});

test('checkout affected files decode Git quoted UTF-8, tabs and newlines without listing unrelated modifications', async t => {
  const f = await fixture(t);
  const paths = ['中文 文件.txt', 'tab\tname.txt', 'line\nname.txt', '  leading.txt'];
  for (const path of paths) await f.put(path, 'base\n');
  await f.git('add', '.'); await f.git('commit', '-m', 'paths');
  await f.git('switch', '-c', 'target');
  for (const path of paths) await f.put(path, 'target\n');
  await f.git('add', '.'); await f.git('commit', '-m', 'target'); await f.git('switch', 'main');
  for (const path of [...paths, 'file.txt']) await f.put(path, 'keep local work\n');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'target' }), 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', error => {
    assert.deepEqual(new Set(error.affectedFiles), new Set(paths));
    assert.equal(error.affectedFileCount, paths.length);
  });
  assert.equal(await f.git('branch', '--show-current'), 'main');
  for (const path of [...paths, 'file.txt']) assert.equal(await readFile(join(f.repository, path), 'utf8'), 'keep local work\n');
});

test('commit failures retain exact causes and sanitized raw command diagnostics', async t => {
  const f = await fixture(t); const head = await f.git('rev-parse', 'HEAD');
  await rejectsCode(() => f.action({ type: 'commit', message: 'empty' }), 'ASTRAGIT_GIT_NOTHING_TO_COMMIT', error => {
    assert.match(error.stdout, /nothing to commit/u); assert.match(error.command, /git commit/u); assert.equal(error.operationStatus, 'failed_before_write');
  });
  await f.put('file.txt', 'commit work\n'); await f.git('add', '.'); await f.git('config', '--unset', 'user.email'); await f.git('config', 'user.useConfigOnly', 'true');
  await rejectsCode(() => f.action({ type: 'commit', message: 'identity' }), 'ASTRAGIT_GIT_IDENTITY_REQUIRED');
  await f.git('config', 'user.email', 'test@astragit.invalid'); await f.put('.git/index.lock', '');
  await rejectsCode(() => f.action({ type: 'commit', message: 'locked' }), 'ASTRAGIT_GIT_INDEX_LOCKED');
  await rejectsCode(() => f.action({ type: 'commit', message: 'selected locked', paths: ['file.txt'] }), 'ASTRAGIT_GIT_INDEX_LOCKED', error => assert.equal(error.operationStage, 'preflight'));
  await rm(join(f.repository, '.git/index.lock'));
  await f.put('.git/hooks/pre-commit', '#!/bin/sh\nprintf "pre-commit hook failed: token=private-token-value\\n" >&2\nexit 1\n');
  await chmod(join(f.repository, '.git/hooks/pre-commit'), 0o755);
  await rejectsCode(() => f.action({ type: 'commit', message: 'hook' }), 'ASTRAGIT_GIT_HOOK_REJECTED', error => {
    assert.doesNotMatch(JSON.stringify(gitFailureDiagnostics(error)), /private-token-value/u); assert.match(error.details, /pre-commit/u);
  });
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
});

test('explicit stash-and-switch retains tracked index/worktree versions and untracked files without restoring on the target', async t => {
  const f = await fixture(t);
  await f.git('switch', '-c', 'target'); await f.put('file.txt', 'target\n'); await f.git('add', '.'); await f.git('commit', '-m', 'target'); await f.git('switch', 'main');
  await f.put('file.txt', 'staged\n'); await f.git('add', 'file.txt'); await f.put('file.txt', 'staged and unstaged\n'); await f.put('new.txt', 'untracked\n');
  const result = await f.action({ type: 'checkout', branchName: 'target', stashBeforeCheckout: true });
  assert.equal(result.outcome, 'completed'); assert.equal(result.branch, 'target'); assert.match(result.savedStash, /^[a-f0-9]{40,64}$/u);
  assert.equal(await f.git('status', '--porcelain'), ''); assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'target\n');
  assert.equal(await f.git('rev-parse', 'refs/stash'), result.savedStash);
  assert.equal(await f.git('show', `${result.savedStash}^2:file.txt`), 'staged');
  assert.equal(await f.git('show', `${result.savedStash}:file.txt`), 'staged and unstaged');
  assert.equal(await f.git('show', `${result.savedStash}^3:new.txt`), 'untracked');
});

test('stash-and-switch validates missing targets before stashing and preserves the stash when a post-checkout hook fails after switching', async t => {
  const f = await fixture(t); await f.git('branch', 'target'); await f.put('file.txt', 'local work\n');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'missing', stashBeforeCheckout: true }), 'ASTRAGIT_GIT_BRANCH_NOT_FOUND');
  assert.equal(await f.git('stash', 'list'), ''); assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'local work\n');
  await f.put('.git/hooks/post-checkout', '#!/bin/sh\nexit 1\n'); await chmod(join(f.repository, '.git/hooks/post-checkout'), 0o755);
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'target', stashBeforeCheckout: true }), 'ASTRAGIT_GIT_CHECKOUT_FAILED_STASH_PRESERVED', error => {
    assert.match(error.savedStash, /^[a-f0-9]{40,64}$/u); assert.equal(error.operationStatus, 'unknown_after_write');
  });
  assert.equal(await f.git('branch', '--show-current'), 'target'); assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(await f.git('show', 'refs/stash:file.txt'), 'local work');
});

test('creating a duplicate branch is refused before the explicit stash step', async t => {
  const f = await fixture(t); await f.put('file.txt', 'keep work\n');
  await rejectsCode(() => f.action({ type: 'create_branch', branchName: 'main', stashBeforeCheckout: true }), 'ASTRAGIT_GIT_BRANCH_EXISTS');
  assert.equal(await f.git('stash', 'list'), ''); assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'keep work\n');
});

test('checkout refuses a resolved but unfinished merge before stashing or switching', async t => {
  const f = await fixture(t);
  await f.git('switch', '-c', 'target'); await f.put('file.txt', 'target\n'); await f.git('add', '.'); await f.git('commit', '-m', 'target');
  await f.git('switch', 'main'); await f.put('file.txt', 'main\n'); await f.git('add', '.'); await f.git('commit', '-m', 'main');
  await f.action({ type: 'merge', branchName: 'target' }); await f.put('file.txt', 'resolved\n'); await f.git('add', 'file.txt');
  await rejectsCode(() => f.action({ type: 'checkout', branchName: 'target', stashBeforeCheckout: true }), 'ASTRAGIT_GIT_CHECKOUT_INTEGRATION_ACTIVE', error => assert.equal(error.operationStatus, 'failed_before_write'));
  assert.equal(await f.git('branch', '--show-current'), 'main'); assert.equal(await f.git('stash', 'list'), '');
  assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'resolved\n');
});

test('merge and rebase conflicts are returned as preserved integration state rather than generic failures', async t => {
  for (const type of ['merge', 'rebase']) {
    await t.test(type, async sub => {
      const f = await fixture(sub);
      await f.git('switch', '-c', 'feature'); await f.put('file.txt', 'feature\n'); await f.git('add', '.'); await f.git('commit', '-m', 'feature');
      await f.git('switch', 'main'); await f.put('file.txt', 'main\n'); await f.git('add', '.'); await f.git('commit', '-m', 'main');
      const result = await f.action({ type, branchName: 'feature' });
      assert.equal(result.outcome, 'conflict'); assert.equal(result.operationStage, 'integration'); assert.deepEqual(result.conflictFiles, ['file.txt']);
      assert.match(result.stdout + result.stderr, /CONFLICT/u); assert.match(await readFile(join(f.repository, 'file.txt'), 'utf8'), /<<<<<<< HEAD/u);
    });
  }
});

test('stash pop conflicts keep the stash and report an integration conflict', async t => {
  const f = await fixture(t);
  await f.put('file.txt', 'saved\n'); await f.git('stash', 'push', '-m', 'saved'); const stash = await f.git('rev-parse', 'refs/stash');
  await f.put('file.txt', 'new committed\n'); await f.git('add', '.'); await f.git('commit', '-m', 'new');
  const result = await f.action({ type: 'apply_stash', stashRef: 'stash@{0}', pop: true });
  assert.equal(result.outcome, 'conflict'); assert.equal(result.operationStage, 'integration'); assert.equal(await f.git('rev-parse', 'refs/stash'), stash);
});

test('cherry-pick and revert conflicts expose their real integration type and can continue or abort', async t => {
  for (const type of ['cherry_pick', 'revert']) for (const recovery of ['continue_integration', 'abort_integration']) await t.test(`${type} ${recovery}`, async sub => {
    const f = await fixture(sub);
    let revision;
    if (type === 'cherry_pick') {
      await f.git('switch', '-c', 'incoming'); await f.put('file.txt', 'incoming\n'); await f.git('add', '.'); await f.git('commit', '-m', 'incoming'); revision = await f.git('rev-parse', 'HEAD'); await f.git('switch', 'main');
    } else {
      await f.put('file.txt', 'change to revert\n'); await f.git('add', '.'); await f.git('commit', '-m', 'change'); revision = await f.git('rev-parse', 'HEAD');
    }
    await f.put('file.txt', 'current contents\n'); await f.git('add', '.'); await f.git('commit', '-m', 'current'); const before = await f.git('rev-parse', 'HEAD');
    const conflicted = await f.action({ type, revision }); assert.equal(conflicted.outcome, 'conflict');
    assert.equal((await getProjectGitRepositorySnapshot(f.repository)).integrationState, type);
    await rejectsCode(() => f.action({ type: 'continue_integration', kind: 'merge' }), 'ASTRAGIT_GIT_INTEGRATION_CHANGED');
    if (recovery === 'continue_integration') { await f.put('file.txt', 'reviewed result\n'); await f.git('add', 'file.txt'); }
    assert.equal((await f.action({ type: recovery, kind: type })).outcome, 'completed');
    assert.equal((await getProjectGitRepositorySnapshot(f.repository)).integrationState, null);
    assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), recovery === 'continue_integration' ? 'reviewed result\n' : 'current contents\n');
    if (recovery === 'abort_integration') assert.equal(await f.git('rev-parse', 'HEAD'), before);
  });
});

test('pull conflicts, rejected push and smart update restore conflicts carry different outcomes', async t => {
  const f = await fixture(t); const remote = join(f.root, 'remote.git'); const peer = join(f.root, 'peer');
  await execute('git', ['clone', '--bare', f.repository, remote]); await f.git('remote', 'add', 'origin', remote); await f.git('fetch', 'origin'); await f.git('branch', '--set-upstream-to=origin/main', 'main');
  await execute('git', ['clone', remote, peer]);
  const peerGit = async (...args) => (await execute('git', args, { cwd: peer })).stdout.trim();
  await peerGit('config', 'user.name', 'Peer'); await peerGit('config', 'user.email', 'peer@astragit.invalid'); await peerGit('config', 'commit.gpgsign', 'false');
  await writeFile(join(peer, 'file.txt'), 'remote change\n'); await peerGit('add', '.'); await peerGit('commit', '-m', 'remote'); await peerGit('push', 'origin', 'main');
  await f.put('file.txt', 'local change\n'); await f.git('add', '.'); await f.git('commit', '-m', 'local');
  await rejectsCode(() => f.action({ type: 'push', remote: 'origin' }), 'ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD', error => {
    assert.equal(error.operationStatus, 'unknown_after_write'); assert.match(error.stderr, /rejected/u);
  });
  const pulled = await f.action({ type: 'pull', remote: 'origin', targetBranch: 'main', strategy: 'merge' });
  assert.equal(pulled.outcome, 'conflict'); assert.equal(pulled.operationStage, 'integration'); await f.git('merge', '--abort');
  await f.git('reset', '--hard', 'HEAD~1'); await f.put('file.txt', 'uncommitted local\n');
  const updated = await f.action({ type: 'update', strategy: 'merge', smart: true });
  assert.equal(updated.outcome, 'conflict'); assert.equal(updated.operationStage, 'restore'); assert.match(updated.savedStash, /^[a-f0-9]{40,64}$/u);
  assert.equal(await f.git('rev-parse', 'refs/stash'), updated.savedStash); assert.equal(await f.git('rev-parse', 'HEAD'), await peerGit('rev-parse', 'HEAD'));
});

test('workbench preserves command details and only records verified pre-write refusal as failed before write', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); await mkdir(data);
  const projects = new ProjectStore(data); const operations = new OperationHistoryStore(data); const service = new ProjectGitWorkbenchService(projects, operations);
  const project = projects.create({ name: 'Fixture', localPath: f.repository }); const repo = (await service.loadWorkbench(project.id)).repositories[0];
  await rejectsCode(() => service.execute(project.id, repo.id, { type: 'commit', message: 'empty' }), 'ASTRAGIT_GIT_NOTHING_TO_COMMIT', error => {
    assert.equal(error.statusCode, 400); assert.equal(error.operationStage, 'command'); assert.match(error.details, /nothing to commit/u); assert.match(error.stdout, /nothing to commit/u);
  });
  assert.equal(operations.list(project.id).items[0].status, 'failed_before_write'); assert.match(operations.list(project.id).items[0].output, /nothing to commit/u);
});

test('smart update fetch failure restores local changes and reports the restoration fact', async t => {
  const f = await fixture(t); const remote = join(f.root, 'remote.git');
  await execute('git', ['clone', '--bare', f.repository, remote]); await f.git('remote', 'add', 'origin', remote); await f.git('fetch', 'origin'); await f.git('branch', '--set-upstream-to=origin/main', 'main');
  await f.git('remote', 'set-url', 'origin', join(f.root, 'missing.git')); await f.put('file.txt', 'local work\n');
  const head = await f.git('rev-parse', 'HEAD');
  await rejectsCode(() => f.action({ type: 'update', strategy: 'merge', smart: true }), 'ASTRAGIT_GIT_SMART_OPERATION_FAILED_RESTORED', error => {
    assert.equal(error.operationStage, 'restore'); assert.equal(error.operationStatus, 'unknown_after_write'); assert.match(error.details, /missing\.git/u);
  });
  assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await readFile(join(f.repository, 'file.txt'), 'utf8'), 'local work\n'); assert.equal(await f.git('stash', 'list'), '');
});

test('local remote helper failures distinguish credentials from connectivity without contacting any server', async t => {
  const f = await fixture(t); const tools = join(f.root, 'tools'); await mkdir(tools);
  const helper = join(tools, 'git-remote-astragitfixture');
  await f.git('remote', 'add', 'origin', 'astragitfixture::fixture');
  for (const [diagnostic, code] of [
    ['fatal: Authentication failed for https://user:private-token@invalid/repo', 'ASTRAGIT_GIT_AUTH_REQUIRED'],
    ['fatal: Failed to connect to invalid port 443: Connection refused', 'ASTRAGIT_GIT_NETWORK_FAILED'],
  ]) {
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\n' '${diagnostic}' >&2\nexit 1\n`, { mode: 0o755 });
    await rejectsCode(() => executeProjectGitAction(f.repository, { type: 'fetch', remote: 'origin' }, undefined, { PATH: `${tools}:${process.env.PATH}` }), code, error => {
      assert.match(error.command, /git fetch/u); assert.doesNotMatch(error.details, /private-token/u);
    });
  }
});

test('snapshot refresh failure preserves the confirmed Git result and completed operation history', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); await mkdir(data);
  const projects = new ProjectStore(data); const operations = new OperationHistoryStore(data); const service = new ProjectGitWorkbenchService(projects, operations);
  const project = projects.create({ name: 'Fixture', localPath: f.repository }); const repo = (await service.loadWorkbench(project.id)).repositories[0];
  // 真实快照解析错误只在动作结束后出现；Git stage 本身仍能完成。
  await f.put('.gitmodules', '[submodule "outside"]\n\tpath = ../outside\n\turl = /missing\n'); await f.put('file.txt', 'to stage\n');
  await rejectsCode(() => service.execute(project.id, repo.id, { type: 'stage', paths: ['file.txt'] }), 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED', error => {
    assert.equal(error.operationStage, 'refresh'); assert.equal(error.operationStatus, 'completed'); assert.match(error.details, /confirmedOutcome=completed/u);
  });
  assert.equal(operations.list(project.id).items[0].status, 'completed'); assert.equal(await f.git('diff', '--cached', '--name-only'), 'file.txt');
});
