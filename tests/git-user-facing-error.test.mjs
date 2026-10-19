import assert from 'node:assert/strict';
import test from 'node:test';
import { describeUserFacingError, redactUserFacingErrorDetails, userFacingErrorCause } from '../packages/shared/src/userFacingError.ts';

const describe = (code, language = 'zh-CN', extra = {}) => describeUserFacingError({ code, message: 'Git command failed.', ...extra }, language);

test('checkout protection is distinguished from conflicts that already existed', () => {
  const protectedCheckout = describe('ASTRAGIT_GIT_CHECKOUT_BLOCKED');
  const existingConflicts = describe('ASTRAGIT_GIT_CHECKOUT_CONFLICTED');
  assert.match(protectedCheckout.message, /会被目标内容覆盖.*切换未执行/u);
  assert.match(protectedCheckout.message, /未跟踪文件需勾选包含/u);
  assert.doesNotMatch(protectedCheckout.message, /(?:已有未解决的冲突|自动恢复|已回滚|冲突编辑器)/u);
  assert.match(existingConflicts.message, /切换前已有未解决的冲突.*切换未执行/u);
  assert.match(existingConflicts.message, /暂存.*继续或中止/u);
  assert.match(describe('ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'en-US').message, /would be overwritten.*checkout was not performed/u);
  assert.match(describe('ASTRAGIT_GIT_CHECKOUT_CONFLICTED', 'en').message, /already had unresolved conflicts/u);
  assert.equal(protectedCheckout.outcomeUnconfirmed, false);
  assert.equal(existingConflicts.outcomeUnconfirmed, false);
  const tracked = describe('ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'zh-CN', { blockedBy: 'tracked' });
  const untracked = describe('ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'en-US', { blockedBy: 'untracked' });
  assert.match(tracked.message, /已跟踪文件的本地修改/u);
  assert.doesNotMatch(tracked.message, /包含未跟踪/u);
  assert.match(untracked.message, /untracked files.*Include untracked files enabled/u);
  assert.match(describeUserFacingError(tracked.message, 'en-US').message, /tracked files.*checkout was not performed/u);
  assert.match(describeUserFacingError(`Error invoking remote method 'astragit:git-action': Error: ${untracked.message}`).message, /未跟踪文件.*包含未跟踪文件/u);
  assert.doesNotMatch(untracked.message, /Commit or stash these changes/u);
  assert.equal(userFacingErrorCause({ code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', blockedBy: 'secret-not-an-enum' }).blockedBy, undefined);
});

test('Git commit failures give distinct bilingual next steps without a nonexistent settings entry', () => {
  const cases = [
    ['ASTRAGIT_GIT_IDENTITY_REQUIRED', /user\.name.*user\.email/u, /user\.name.*user\.email/u],
    ['ASTRAGIT_GIT_NOTHING_TO_COMMIT', /没有可提交.*提交范围/u, /no changes to commit.*scope/u],
    ['ASTRAGIT_GIT_INDEX_LOCKED', /其他 Git 操作已结束.*核查锁文件/u, /other Git operations have ended.*lock file/u],
    ['ASTRAGIT_GIT_HOOK_REJECTED', /钩子检查未通过.*修正检查错误/u, /Git hook check failed.*Fix the check/u],
    ['ASTRAGIT_GIT_SIGNING_FAILED', /签名失败.*签名密钥/u, /signing failed.*signing key/u],
    ['ASTRAGIT_GIT_SELECTION_CHANGED', /已变化.*刷新.*操作范围/u, /changed.*Refresh.*scope/u],
  ];
  for (const [code, zh, en] of cases) {
    assert.match(describe(code).message, zh, code);
    assert.match(describe(code, 'en-US').message, en, code);
    assert.doesNotMatch(describe(code).message, /(?:代码交付页|数字员工|任务设置|设置页面填写姓名)/u, code);
  }
  assert.match(describe('ASTRAGIT_TASK_COMMIT_SELECTION_CHANGED').message, /刷新文件状态/u);
  assert.doesNotMatch(describe('ASTRAGIT_GIT_INDEX_LOCKED').message, /(?:删除|移除).*锁/u);
});

test('remote rejection, credentials, upstream and connection failures stay distinct', () => {
  const cases = [
    ['ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD', /远端分支包含本地尚未合入.*合并或变基/u, /not integrated locally.*merge or rebase/u],
    ['ASTRAGIT_GIT_REMOTE_REJECTED', /分支保护.*远端检查/u, /branch protection.*remote checks/u],
    ['ASTRAGIT_GIT_AUTH_REQUIRED', /系统 Git 使用的 SSH 密钥或 HTTPS 凭据/u, /SSH key or HTTPS credentials used by Git/u],
    ['ASTRAGIT_GIT_UPSTREAM_REQUIRED', /首次推送.*推送窗口.*跟踪/u, /first push.*push dialog/u],
    ['ASTRAGIT_GIT_NETWORK_FAILED', /检查网络.*推送.*核对远端分支/u, /network.*push.*verify the remote branch/u],
    ['ASTRAGIT_GIT_HOST_UNVERIFIED', /服务器的身份.*核实服务器信息/u, /server identity.*Confirm its identity/u],
  ];
  for (const [code, zh, en] of cases) {
    assert.match(describe(code).message, zh, code);
    assert.match(describe(code, 'en-US').message, en, code);
  }
  assert.doesNotMatch(describe('ASTRAGIT_GIT_AUTH_REQUIRED').message, /账号.*已登录/u);
  assert.doesNotMatch(describe('ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD').message, /(?:直接|自动).*强制推送/u);
  assert.equal(describe('ASTRAGIT_GIT_NETWORK_FAILED').action, 'check');
});

test('confirmed recovery facts override a nested command cause without hiding its diagnostic output', () => {
  const cause = { code: 'ASTRAGIT_GIT_AUTH_REQUIRED', message: 'fatal: Authentication failed for https://example.invalid/repo.git' };
  const restored = describe('ASTRAGIT_GIT_SMART_OPERATION_FAILED_RESTORED', 'zh-CN', { cause });
  const preserved = describe('ASTRAGIT_GIT_SMART_OPERATION_FAILED_STASH_PRESERVED', 'en-US', { cause, details: 'stash 1234abcd was retained' });
  assert.match(restored.message, /本地修改已恢复/u);
  assert.match(preserved.message, /remain in the stash/u);
  const restoreFailed = describe('ASTRAGIT_GIT_SMART_RESTORE_FAILED', 'zh-CN', { cause });
  assert.match(restoreFailed.message, /更新命令已完成.*尚未完整恢复.*贮藏仍保留/u);
  assert.match(describe('ASTRAGIT_GIT_SMART_RESTORE_FAILED', 'en-US', { cause }).message, /command completed.*not fully restored/u);
  assert.match(restored.details, /Authentication failed/u);
  assert.match(preserved.details, /stash 1234abcd/u);
  assert.doesNotMatch(restored.message, /已回滚/u);
  assert.doesNotMatch(preserved.message, /were restored/u);
  // General wrappers still explain their specific cause.
  assert.match(describe('ASTRAGIT_GIT_ACTION_FAILED', 'en', { cause }).message, /could not authenticate/u);
});

test('a mutation timeout remains unconfirmed even when a nested cause looks like a safe rejection', () => {
  for (const code of ['ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'ASTRAGIT_GIT_AUTH_REQUIRED', 'ETIMEDOUT']) {
    const error = { code: 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', message: 'Request timed out', cause: { code, message: 'partial diagnostic' } };
    const zh = describeUserFacingError(error);
    const en = describeUserFacingError(error, 'en-US');
    assert.match(zh.message, /执行结果尚未确认.*刷新并核对当前状态/u);
    assert.match(en.message, /action request timed out.*result is unconfirmed/u);
    assert.doesNotMatch(zh.message, /切换未执行/u);
    assert.equal(zh.outcomeUnconfirmed, true);
    assert.equal(zh.action, 'check');
    assert.equal(en.action, 'check');
    assert.match(zh.details, new RegExp(code, 'u'));
  }
  assert.equal(describe('ASTRAGIT_GIT_TIMEOUT').outcomeUnconfirmed, true);
  assert.equal(describe('ASTRAGIT_GIT_TIMEOUT').action, 'check');
  assert.equal(describe('ASTRAGIT_GIT_SWITCH_FAILED').outcomeUnconfirmed, true);
  assert.equal(describe('ASTRAGIT_TASK_REMOTE_VERIFICATION_FAILED').outcomeUnconfirmed, true);
  assert.equal(describe('ASTRAGIT_CANCELLED').action, 'check');
  assert.doesNotMatch(describe('ASTRAGIT_CANCELLED').message, /已自动撤销|恢复入口/u);
});

test('fixed Electron wrappers retain structured error identity and original redacted details', () => {
  const wrapped = "Error invoking remote method 'astragit:git-action': Error: Error invoking remote method 'astragit:git-execute': Error: ASTRAGIT_GIT_CHECKOUT_CONFLICTED: needs merge";
  const zh = describeUserFacingError(wrapped);
  const en = describeUserFacingError(wrapped, 'en-US');
  assert.match(zh.message, /切换前已有未解决的冲突/u);
  assert.match(en.message, /already had unresolved conflicts/u);
  assert.doesNotMatch(zh.message, /Error invoking remote method/u);
  assert.match(zh.details, /astragit:git-action/u);
  assert.match(zh.details, /needs merge/u);
  const normalized = userFacingErrorCause({ error: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'protected checkout', details: { operationStage: 'checkout', path: 'src/file.ts', count: 2 } });
  assert.equal(normalized.code, 'ASTRAGIT_GIT_CHECKOUT_BLOCKED');
  assert.match(normalized.details, /checkout.*src\/file\.ts/u);
});

test('arbitrary filenames and raw output do not infer Git conflict or authorization classes', () => {
  const raw = 'tool could not open conflict-authentication-failed.md';
  const unknown = describeUserFacingError({ code: 'SOME_OTHER_ERROR', message: raw });
  assert.equal(unknown.message, raw);
  assert.equal(unknown.action, null);
  assert.equal(unknown.outcomeUnconfirmed, false);
  const known = describe('ASTRAGIT_GIT_ACTION_FAILED', 'en-US', { message: 'A file named authentication failed conflict.md is missing.' });
  assert.match(known.message, /repository action encountered a problem/u);
  assert.doesNotMatch(known.message, /(?:authenticate|unresolved conflicts)/u);
});

test('Git diagnostics redact credentials while retaining commands, relative paths and server errors', () => {
  const secrets = [
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'b'.repeat(60),
    'glpat-' + 'c'.repeat(24),
    'url-token-only',
    'url-password',
    'dXNlcjpzZWNyZXQ=',
    'private-query',
  ];
  const diagnostics = [
    '$ git push origin main',
    'src/components/conflict.ts',
    ...secrets.slice(0, 3),
    'fatal: unable to access https://url-token-only@example.invalid/repo.git',
    'https://username:url-password@example.invalid/repo.git?access=private-query',
    '-c http.extraheader=AUTHORIZATION: Basic dXNlcjpzZWNyZXQ=',
    'Authorization: Bearer private-bearer',
    'password="private-password"',
    '/Users/skylight/Private/project/secret.txt',
    '    at internalStack (/Users/skylight/private.js:1:1)',
    'remote: protected branch rule rejected the push',
  ].join('\n');
  const safe = redactUserFacingErrorDetails(diagnostics);
  for (const secret of [...secrets, 'private-bearer', 'private-password', '/Users/skylight']) assert.equal(safe.includes(secret), false, secret);
  assert.match(safe, /git push origin main/u);
  assert.match(safe, /src\/components\/conflict\.ts/u);
  assert.match(safe, /protected branch rule rejected/u);
  assert.match(safe, /example\.invalid/u);
  assert.doesNotMatch(safe, /internalStack/u);
  assert.ok(safe.length <= 2000);
  const shown = describe('ASTRAGIT_GIT_ACTION_FAILED', 'en-US', { cause: { code: 'OTHER_ERROR', message: diagnostics }, details: diagnostics });
  for (const secret of secrets) assert.equal((shown.message + shown.details).includes(secret), false, secret);
});


test('post-action refresh failures preserve confirmed completion or conflict instead of replaying the action', () => {
  for (const language of ['zh-CN', 'en-US']) {
    const completed = describe('ASTRAGIT_GIT_ACTION_REFRESH_FAILED', language, { operationStatus: 'completed', cause: { code: 'ASTRAGIT_GIT_TIMEOUT', message: 'status query timed out' } });
    const conflict = describe('ASTRAGIT_GIT_ACTION_REFRESH_FAILED', language, { operationStatus: 'conflict', cause: { code: 'ECONNRESET', message: 'snapshot connection ended' } });
    assert.match(completed.message, language === 'zh-CN' ? /操作已完成.*刷新.*失败/u : /action completed.*refreshing.*failed/u);
    assert.match(conflict.message, language === 'zh-CN' ? /操作已执行并留下冲突.*刷新/u : /ran and left conflicts.*refreshing/u);
    assert.doesNotMatch(conflict.message, language === 'zh-CN' ? /操作已完成|切换未执行/u : /action completed|checkout was not performed/u);
    assert.match(completed.message, language === 'zh-CN' ? /不要重复执行/u : /without repeating/u);
    assert.match(conflict.message, language === 'zh-CN' ? /不要重复执行/u : /do not repeat/u);
    assert.equal(completed.outcomeUnconfirmed, false);
    assert.equal(conflict.outcomeUnconfirmed, false);
    assert.equal(completed.action, 'check');
    assert.equal(conflict.action, 'check');
    assert.match(completed.details, /status query timed out/u);
    const unknown = describe('ASTRAGIT_GIT_ACTION_STATE_READ_FAILED', language, { operationStatus: 'unknown_after_write', cause: { code: 'ASTRAGIT_GIT_AUTH_REQUIRED', message: 'later read failed' } });
    assert.match(unknown.message, language === 'zh-CN' ? /Git 命令已结束.*结果尚未确认/u : /Git command ended.*result is unconfirmed/u);
    assert.equal(unknown.outcomeUnconfirmed, true);
    assert.equal(unknown.action, 'check');
  }
  assert.equal(userFacingErrorCause({ operationStatus: 'conflict' }).operationStatus, 'conflict');
  assert.equal(userFacingErrorCause({ operationStatus: 'unknown_after_write' }).operationStatus, 'unknown_after_write');
  assert.equal(userFacingErrorCause({ operationStatus: 'arbitrary-secret' }).operationStatus, undefined);
  const conflictCopy = describe('ASTRAGIT_GIT_ACTION_REFRESH_FAILED', 'zh-CN', { operationStatus: 'conflict' }).message;
  assert.match(describeUserFacingError(conflictCopy, 'en-US').message, /left conflicts/u);
  // Transport uncertainty still overrides a nested confirmed result.
  assert.equal(describe('ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', 'zh-CN', { cause: { code: 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED', message: 'partial read', operationStatus: 'completed' } }).outcomeUnconfirmed, true);
});


test('a commit hook that expands the selected scope is distinguished from hook failure and stale selection', () => {
  const error = { code: 'ASTRAGIT_GIT_HOOK_SELECTION_CHANGED', message: 'pre-commit staged outside.txt outside the selection', details: '$ git commit\nselection guard: outside.txt' };
  const zh = describeUserFacingError(error);
  const en = describeUserFacingError(error, 'en-US');
  assert.match(zh.message, /提交钩子暂存了未勾选的文件.*提交已被阻止.*调整钩子.*重新确认提交范围/u);
  assert.match(en.message, /commit hook staged files outside your selection.*commit was blocked.*Adjust the hook.*review the commit scope/u);
  assert.doesNotMatch(zh.message, /钩子检查未通过|所选文件.*已变化/u);
  assert.doesNotMatch(en.message, /hook check failed|selected files.*changed/u);
  assert.equal(zh.outcomeUnconfirmed, false);
  assert.match(zh.details, /outside\.txt/u);
  assert.notEqual(zh.message, describe('ASTRAGIT_GIT_HOOK_REJECTED').message);
  assert.notEqual(zh.message, describe('ASTRAGIT_GIT_SELECTION_CHANGED').message);
});


test('a generic child command error does not replace a classified root reason', () => {
  for (const childCode of ['ASTRAGIT_GIT_COMMAND_FAILED', 'ASTRAGIT_GIT_ACTION_FAILED', 'ASTRAGIT_COMMAND_FAILED', 'ASTRAGIT_ACTION_FAILED']) {
    const error = { code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', blockedBy: 'tracked', message: 'switch refused', cause: { code: childCode, message: 'Command failed: git switch feature/new' } };
    const zh = describeUserFacingError(error);
    const en = describeUserFacingError(error, 'en-US');
    assert.match(zh.message, /已跟踪文件的本地修改.*切换未执行/u, childCode);
    assert.match(en.message, /tracked files.*checkout was not performed/u, childCode);
    assert.match(zh.details, /Command failed: git switch feature\/new/u, childCode);
    assert.equal(zh.outcomeUnconfirmed, false);
  }
  // The deepest specific cause still wins when the root is only a wrapper.
  const wrapped = describe('ASTRAGIT_GIT_ACTION_FAILED', 'en-US', { cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'command failed', cause: { code: 'ASTRAGIT_GIT_IDENTITY_REQUIRED', message: 'Author identity unknown' } } });
  assert.match(wrapped.message, /user\.name.*user\.email/u);
  // Outcome uncertainty still has higher priority than both specific and generic causes.
  const uncertain = describe('ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', 'zh-CN', { cause: { code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'switch refused', cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'command failed' } } });
  assert.match(uncertain.message, /执行结果尚未确认/u);
  assert.equal(uncertain.outcomeUnconfirmed, true);
});
