import assert from 'node:assert/strict';
import test from 'node:test';
import { gitConflictMessage, gitFailureCode, gitFailureText, gitPostActionRefreshError } from '../apps/desktop/src/renderer/git/gitOperationFeedback.ts';
import { describeUserFacingError } from '../packages/shared/src/userFacingError.ts';
import { AstraGitApiError, createLocalApiTransport } from '../apps/desktop/src/renderer/transport/localApiTransport.ts';

const connection = { baseUrl: 'http://127.0.0.1:43123', apiToken: 'feedback-fixture-token' };
const conflictSnapshot = (extra = {}) => ({ branch: 'feature/local', detached: false, conflictFiles: ['src/first.ts', 'src/second.ts'], integrationState: 'merge', ...extra });
const conflictResult = (extra = {}) => ({ outcome: 'conflict', conflictFiles: ['src/first.ts'], ...extra });

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
