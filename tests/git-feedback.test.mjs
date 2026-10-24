import assert from 'node:assert/strict';
import test from 'node:test';
import { gitConflictMessage, gitFailureCode, gitFailureContext, gitFailureText, gitPostActionRefreshError } from '../apps/desktop/src/renderer/git/gitOperationFeedback.ts';
import { describeUserFacingError } from '../packages/shared/src/userFacingError.ts';
import { AstraGitApiError, createLocalApiTransport } from '../apps/desktop/src/renderer/transport/localApiTransport.ts';

const connection = { baseUrl: 'http://127.0.0.1:43123', apiToken: 'feedback-fixture-token' };
const conflictSnapshot = (extra = {}) => ({ branch: 'feature/local', detached: false, conflictFiles: ['src/first.ts', 'src/second.ts'], integrationState: 'merge', ...extra });
const conflictResult = (extra = {}) => ({ outcome: 'conflict', conflictFiles: ['src/first.ts'], ...extra });

test('checkout recovery context shows verified files and never claims protection for an uncertain outer outcome', () => {
  const error = { code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'blocked', operationStatus: 'failed_before_write', affectedFiles: ['src/中文 文件.ts'], affectedFileCount: 1 };
  const blocked = gitFailureContext(error, true);
  assert.match(blocked.description, /分支未切换.*未被覆盖/u); assert.deepEqual(blocked.files, error.affectedFiles);
  const unknown = gitFailureContext({ code: 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', message: 'timeout', operationStatus: 'unknown_after_write', cause: error }, true);
  assert.match(unknown.description, /尚未确认.*避免重复/u); assert.doesNotMatch(unknown.description, /未被覆盖|分支未切换/u);
  assert.equal(gitFailureContext({ code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'unknown' }, false).description, undefined);
  assert.deepEqual(gitFailureContext({ ...error, affectedFiles: ['  leading.txt', 'line\nname.txt', '/Users/private/file.txt', '../escape'] }, false).files, ['  leading.txt', 'line\nname.txt']);
});

test('Git feedback serialization retains every error identity and redacts nested diagnostics', () => {
  const personalPath = '/Users/feedback-fixture/private/project/file.ts';
  const token = 'ghp_' + 'a'.repeat(36);
  const error = {
    error: 'ASTRAGIT_GIT_ACTION_FAILED',
    message: 'ASTRAGIT_GIT_ACTION_FAILED: command did not complete',
    details: '$ git push origin feature/local',
    cause: {
      code: 'ASTRAGIT_GIT_AUTH_REQUIRED',
      message: 'remote authentication failed',
      details: [`src/first.ts`, `https://user:private-password@example.invalid/repo.git?token=private-query`, `Authorization: Bearer ${token}`, personalPath].join('\n'),
    },
  };
  const text = gitFailureText(error);
  assert.equal(text.match(/ASTRAGIT_GIT_ACTION_FAILED:/gu)?.length, 1);
  assert.match(text, /ASTRAGIT_GIT_AUTH_REQUIRED: remote authentication failed/u);
  assert.match(text, /git push origin feature\/local/u);
  assert.match(text, /src\/first\.ts/u);
  assert.match(text, /example\.invalid/u);
  for (const secret of [token, personalPath, 'private-password', 'private-query']) assert.equal(text.includes(secret), false, secret);
  assert.equal(gitFailureCode(error), 'ASTRAGIT_GIT_AUTH_REQUIRED');
  const longDiagnostic = gitFailureText({ ...error, details: 'remote output\n'.repeat(400) });
  assert.match(longDiagnostic, /ASTRAGIT_GIT_AUTH_REQUIRED/u);
  for (const code of ['ASTRAGIT_GIT_COMMAND_FAILED', 'ASTRAGIT_GIT_ACTION_FAILED', 'ASTRAGIT_COMMAND_FAILED', 'ASTRAGIT_ACTION_FAILED']) {
    assert.equal(gitFailureCode({ code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'checkout blocked', cause: { code, message: 'command failed' } }), 'ASTRAGIT_GIT_CHECKOUT_BLOCKED');
  }
});

test('Git feedback preserves unconfirmed outcomes instead of replacing them with a nested rejection', () => {
  const unknown = {
    code: 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN',
    message: 'The action timed out before its response arrived',
    cause: { code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'A partial diagnostic was received' },
  };
  assert.equal(gitFailureCode(unknown), 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN');
  assert.equal(gitFailureCode({ code: 'ASTRAGIT_GIT_ACTION_FAILED', message: 'request failed', cause: unknown }), 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN');
  assert.match(gitFailureText(unknown), /ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN/u);
  assert.match(gitFailureText(unknown), /ASTRAGIT_GIT_CHECKOUT_BLOCKED/u);
});

test('reported push rejection explains partial remote updates without disguising delivery uncertainty', () => {
  const rejection = { code: 'ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD', message: 'branch rejected', operationStatus: 'unknown_after_write' };
  assert.equal(describeUserFacingError(rejection).outcomeUnconfirmed, true, 'other refs in the push may have changed');
  assert.equal(gitFailureCode(rejection), rejection.code);
  assert.match(gitFailureContext(rejection, true).description, /所报分支.*已被拒绝.*其他分支或标签.*可能已更新.*抓取并核对/u);
  assert.match(gitFailureContext(rejection, false).description, /rejected the reported branch.*Other branches or tags.*may have been updated/u);
  for (const code of ['ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', 'ASTRAGIT_GIT_ACTION_STATE_READ_FAILED']) {
    const unknown = { code, message: 'response incomplete', operationStatus: 'unknown_after_write', cause: rejection };
    assert.equal(gitFailureCode(unknown), code);
    assert.match(gitFailureContext(unknown, true).description, /尚未确认最终状态/u);
    assert.doesNotMatch(gitFailureContext(unknown, true).description, /已被拒绝/u);
  }
});

test('merge and stash conflicts describe their distinct continuation and preservation facts', () => {
  const merged = gitConflictMessage({ type: 'merge', branchName: 'feature/remote' }, conflictResult(), conflictSnapshot(), true);
  assert.match(merged, /合并已暂停.*2 个文件存在冲突/u);
  assert.match(merged, /feature\/local/u);
  assert.match(merged, /解决冲突并暂存.*继续.*终止/u);
  assert.doesNotMatch(merged, /切换未执行|重复应用|自动恢复/u);
  const stashed = gitConflictMessage({ type: 'apply_stash', stashRef: 'stash@{0}', pop: true }, conflictResult(), conflictSnapshot({ integrationState: null }), true);
  assert.match(stashed, /应用贮藏后.*2 个文件存在冲突/u);
  assert.match(stashed, /贮藏条目仍保留.*解决冲突并暂存.*不要重复应用/u);
  assert.doesNotMatch(stashed, /已移除|再点击“继续”|点击“终止”/u);
  const english = gitConflictMessage({ type: 'apply_stash', stashRef: 'stash@{0}', pop: true }, conflictResult(), conflictSnapshot({ integrationState: null }), false);
  assert.match(english, /stash is retained.*Do not apply it again/u);
});

test('manual replay conflicts explain manual commits while native replay sequences retain Continue and Abort', () => {
  for (const type of ['cherry_pick', 'revert']) {
    const manual = { type, revision: 'HEAD', commit: false };
    const snapshot = conflictSnapshot({ integrationState: null });
    assert.match(gitConflictMessage(manual, conflictResult(), snapshot, true), /不自动提交.*自行填写提交说明并提交.*没有创建/u);
    assert.match(gitConflictMessage(manual, conflictResult(), snapshot, false), /commit manually.*did not create a native sequence/u);
    assert.match(gitConflictMessage({ ...manual, commit: true }, conflictResult(), conflictSnapshot({ integrationState: type }), true), /再点击“继续”.*点击“终止”/u);
    assert.match(gitConflictMessage({ ...manual, commit: true }, conflictResult(), conflictSnapshot({ integrationState: type }), false), /choose Continue.*Choose Abort/u);
  }
  const reverse = { type: 'revert', revision: 'HEAD', commit: false };
  assert.match(gitConflictMessage(reverse, conflictResult(), conflictSnapshot({ integrationState: 'revert' }), true), /未自动提交.*“继续”创建新提交.*“终止”/u);
  assert.match(gitConflictMessage(reverse, conflictResult(), conflictSnapshot({ integrationState: 'revert' }), false), /No commit was created automatically.*Continue to create a commit.*Abort/u);
});

test('manual batch feedback requires committing the resolved prefix before continuing the native sequence', () => {
  const snapshot = conflictSnapshot({ integrationState: 'cherry_pick', integrationNoCommit: true }); const action = { type: 'cherry_pick_series', input: { revisions: [], commit: false, includeSourceId: false } };
  assert.match(gitConflictMessage(action, conflictResult(), snapshot, true), /手动提交已应用的内容.*“继续”处理剩余提交/u); assert.match(gitConflictMessage(action, conflictResult(), snapshot, false), /manually commit the applied changes.*Continue for the remaining/u);
});

test('restore-stage conflicts report that update ran and name only the stash that was actually retained', () => {
  const savedStash = '0123456789abcdef0123456789abcdef01234567';
  const result = conflictResult({ operationStage: 'restore', savedStash });
  const snapshot = conflictSnapshot({ branch: 'main', integrationState: null });
  const zh = gitConflictMessage({ type: 'update', strategy: 'rebase', smart: true }, result, snapshot, true);
  assert.match(zh, /更新步骤已执行.*恢复本地修改时2 个文件存在冲突/u);
  assert.match(zh, /当前分支为“main”/u);
  assert.match(zh, /自动贮藏 0123456789ab 已保留，不要重复应用/u);
  assert.doesNotMatch(zh, /变基已暂停|合并已暂停|恢复完成|已回滚/u);
  const en = gitConflictMessage({ type: 'update', strategy: 'merge', smart: true }, result, snapshot, false);
  assert.match(en, /update step ran.*restoring local changes/u);
  assert.match(en, /Saved stash 0123456789ab is retained; do not apply it again/u);
  const withoutStash = gitConflictMessage({ type: 'update', strategy: 'merge', smart: true }, conflictResult({ operationStage: 'restore' }), snapshot, true);
  assert.doesNotMatch(withoutStash, /自动贮藏|0123456789ab/u);
  const integration = gitConflictMessage({ type: 'update', strategy: 'rebase', smart: true }, conflictResult({ operationStage: 'integration', savedStash }), conflictSnapshot({ integrationState: 'rebase' }), true);
  assert.match(integration, /变基已暂停/u);
  assert.match(integration, /本地修改仍保存在自动贮藏 0123456789ab，尚未恢复/u);
  assert.match(integration, /先完成或终止整合，再检查并从该贮藏恢复/u);
  assert.doesNotMatch(integration, /恢复本地修改时|不要重复应用/u);
});

test('local API HTTP failures preserve structured Git diagnostics across 4xx and 5xx responses', async (t) => {
  const payload = {
    error: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED',
    message: 'Checkout was not performed',
    details: '$ git switch feature/next\nlocal changes would be overwritten: src/first.ts',
    blockedBy: 'both',
    operationStage: 'preflight',
    operationStatus: 'failed_before_write',
    recoveryRequired: true,
    cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'git switch failed', details: 'src/first.ts' },
  };
  let status = 409;
  let calls = 0;
  let reconnects = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls += 1;
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.get('x-astragit-api-token'), connection.apiToken);
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'retry-after': '2' } });
  });
  t.after(() => t.mock.restoreAll());
  const transport = createLocalApiTransport({ getConnection: () => connection, refreshConnection: async () => { reconnects += 1; return connection; } });
  for (status of [409, 503]) {
    await assert.rejects(transport.request('/projects/fixture/git/action', { method: 'POST', body: '{}' }), (error) => {
      assert.ok(error instanceof AstraGitApiError);
      assert.equal(error.status, status);
      assert.equal(error.error, payload.error);
      assert.equal(error.message, payload.message);
      assert.equal(error.details, payload.details);
      assert.equal(error.blockedBy, payload.blockedBy);
      assert.equal(error.operationStage, payload.operationStage);
      assert.equal(error.operationStatus, payload.operationStatus);
      assert.equal(error.recoveryRequired, true);
      assert.equal(error.retryAfterMs, 2000);
      assert.deepEqual(error.cause, payload.cause);
      assert.equal(gitFailureCode(error), 'ASTRAGIT_GIT_CHECKOUT_BLOCKED');
      assert.match(gitFailureText(error), /ASTRAGIT_GIT_CHECKOUT_BLOCKED/u);
      assert.match(gitFailureText(error), /src\/first\.ts/u);
      return true;
    });
  }
  assert.equal(calls, 2, 'write requests are not automatically retried');
  assert.equal(reconnects, 0, 'a 5xx write is not replayed through the reconnect path');
});

test('a failed renderer refresh retains the confirmed Git result and only offers state checks', () => {
  const timeout = { code: 'ASTRAGIT_LOCAL_API_READ_TIMEOUT', message: 'snapshot read timed out' };
  for (const outcome of ['completed', 'conflict']) {
    const error = gitPostActionRefreshError(timeout, outcome);
    const explanation = describeUserFacingError(error, 'zh-CN');
    assert.equal(gitFailureCode(error), 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED');
    assert.equal(explanation.outcomeUnconfirmed, false);
    assert.equal(explanation.action, 'check');
    assert.match(explanation.message, outcome === 'conflict' ? /已执行并留下冲突/u : /已完成/u);
    assert.match(explanation.message, /不要重复执行/u);
    assert.match(explanation.details, /ASTRAGIT_LOCAL_API_READ_TIMEOUT/u);
  }
});

for (const [method, timeoutMs, code] of [
  ['GET', 30_000, 'ASTRAGIT_LOCAL_API_READ_TIMEOUT'],
  ['POST', 150_000, 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN'],
]) {
  test(`${method} timeout has the correct outcome classification without waiting for real time`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => { t.mock.timers.reset(); t.mock.restoreAll(); });
    let calls = 0;
    let signal;
    t.mock.method(globalThis, 'fetch', (_url, init) => {
      calls += 1;
      signal = init.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const transport = createLocalApiTransport({ getConnection: () => connection });
    const pending = transport.request('/projects/fixture/git/action', { method });
    const rejected = assert.rejects(pending, (error) => {
      assert.ok(error instanceof AstraGitApiError);
      assert.equal(error.status, 0);
      assert.equal(error.error, code);
      assert.equal(gitFailureCode(error), code);
      return true;
    });
    assert.equal(calls, 1);
    t.mock.timers.tick(timeoutMs - 1);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  });
}

const stopTrackingPreviewPath = '/api/projects/fixture/git/workbench/repositories/repo/stop-tracking-preview';
test('read-only POST stop-tracking preview times out as a read, without implying a Git mutation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { t.mock.timers.reset(); t.mock.restoreAll(); });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const transport = createLocalApiTransport({ getConnection: () => connection });
  const pending = transport.request(stopTrackingPreviewPath, { method: 'POST', body: JSON.stringify({ paths: ['folder'] }) }, { readOnly: true });
  const rejected = assert.rejects(pending, error => error.error === 'ASTRAGIT_LOCAL_API_READ_TIMEOUT' && !describeUserFacingError(error).outcomeUnconfirmed);
  t.mock.timers.tick(29_999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await rejected; assert.equal(signal.aborted, true);
});

test('only the declared read-only POST preview can replay after local service reconnect', async t => {
  let calls = 0; let refreshed = 0; const received = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { received.push([url, init.body]); if (++calls === 1) throw new TypeError('old connection'); return new Response(JSON.stringify({ total: 2 }), { headers: { 'content-type': 'application/json' } }); });
  const transport = createLocalApiTransport({ getConnection: () => connection, refreshConnection: async () => { refreshed++; return { ...connection, baseUrl: 'http://127.0.0.1:9999' }; } });
  const body = JSON.stringify({ paths: ['folder'] });
  assert.deepEqual(await transport.request(stopTrackingPreviewPath, { method: 'POST', body }, { readOnly: true }), { total: 2 }); assert.equal(calls, 2); assert.equal(refreshed, 1); assert.equal(received[1][0], `http://127.0.0.1:9999${stopTrackingPreviewPath}`); assert.equal(received[1][1], body);
});

test('read-only transport declarations cannot turn Git action writes into replayable reads', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}'); });
  const transport = createLocalApiTransport({ getConnection: () => connection });
  for (const [path, method] of [[stopTrackingPreviewPath, 'DELETE'], ['/api/projects/fixture/git/workbench/repositories/repo/action', 'POST'], [`${stopTrackingPreviewPath}/action`, 'POST']]) await assert.rejects(() => transport.request(path, { method }, { readOnly: true }), /Invalid read-only API route/u);
  assert.equal(calls, 0);
});


test('interactive rebase previews keep read timeouts while real rebase writes allow thirty minutes and never replay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => { t.mock.timers.reset(); t.mock.restoreAll(); });
  let signal; let calls = 0; let reconnects = 0;
  t.mock.method(globalThis, 'fetch', (_url, init) => { calls++; signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); });
  const transport = createLocalApiTransport({ getConnection: () => connection });
  const mutationTransport = createLocalApiTransport({ getConnection: () => connection, refreshConnection: async () => { reconnects++; return connection; } });
  const path = '/api/projects/fixture/git/workbench/repositories/repo/interactive-rebase';
  let pending = transport.request(path + '-preview', { method: 'POST', body: JSON.stringify({ baseRef: 'HEAD~1' }) }, { readOnly: true }); let rejected = assert.rejects(pending, error => error.error === 'ASTRAGIT_LOCAL_API_READ_TIMEOUT'); t.mock.timers.tick(29_999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await rejected;
  pending = mutationTransport.request(path, { method: 'POST', body: '{}' }); rejected = assert.rejects(pending, error => error.error === 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN'); t.mock.timers.tick(30 * 60_000 - 1); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await rejected; assert.equal(calls, 2); assert.equal(reconnects, 0);
  await assert.rejects(() => transport.request(path, { method: 'POST' }, { readOnly: true }), /Invalid read-only API route/u);
});
