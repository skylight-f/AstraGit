import assert from 'node:assert/strict';
import test from 'node:test';
import { describeUserFacingError, redactUserFacingErrorDetails, userFacingErrorCause } from '../packages/shared/src/userFacingError.ts';

const describe = (code, language = 'zh-CN', extra = {}) => describeUserFacingError({ code, message: 'Git command failed.', ...extra }, language);

test('mailbox hints distinguish preflight blocks, merge export limits and partially completed imports', () => {
  assert.match(describe('ASTRAGIT_GIT_PATCH_SERIES_MERGE').message, /不能保留合并提交.*普通差异/u); assert.match(describe('ASTRAGIT_GIT_PATCH_SERIES_MERGE', 'en-US').message, /cannot preserve merge commits/u);
  assert.equal(describe('ASTRAGIT_GIT_MAILBOX_CHANGED').outcomeUnconfirmed, false); assert.match(describe('ASTRAGIT_GIT_MAILBOX_CHANGED').message, /未开始导入/u);
  const paused = describe('ASTRAGIT_GIT_MAILBOX_PAUSED', 'en-US', { operationStatus: 'unknown_after_write' }); assert.equal(paused.outcomeUnconfirmed, true); assert.equal(paused.action, 'check'); assert.match(paused.message, /earlier commits.*continue, skip or abort.*Do not import/u);
  assert.equal(describe('ASTRAGIT_GIT_IDENTITY_REQUIRED', 'en-US', { operationStatus: 'unknown_after_write' }).outcomeUnconfirmed, true);
  assert.equal(describe('ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'zh-CN', { operationStatus: 'failed_before_write', cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'native error', operationStatus: 'unknown_after_write' } }).outcomeUnconfirmed, false);
});

test('tag errors distinguish moved objects, server refusals and uncertain partial deletions in both languages', () => {
  assert.match(describe('ASTRAGIT_GIT_TAG_REMOTE_VERSION_CHANGED').message, /标签对象.*同一提交.*核对/u); assert.match(describe('ASTRAGIT_GIT_TAG_REMOTE_VERSION_CHANGED', 'en-US').message, /tag object changed.*same commit/u);
  const unknown = describe('ASTRAGIT_GIT_TAG_REMOTE_OUTCOME_UNKNOWN', 'zh-CN', { operationStatus: 'unknown_after_write' }); assert.equal(unknown.outcomeUnconfirmed, true); assert.equal(unknown.action, 'check'); assert.match(unknown.message, /部分目标.*不要直接重复删除/u);
  assert.equal(describe('ASTRAGIT_GIT_TAG_REMOTE_REJECTED').outcomeUnconfirmed, false); assert.match(describe('ASTRAGIT_GIT_TAG_REMOTE_REJECTED', 'en-US').message, /tag protection.*permissions/u); assert.match(describe('ASTRAGIT_GIT_TAG_LOCAL_CHANGED').message, /本地标签.*核对标签对象/u);
});

test('patch previews distinguish stale content, failed checks and invalid paths in both languages', () => {
  assert.match(describe('ASTRAGIT_GIT_PATCH_CHECK_FAILED').message, /本次未应用.*前缀层数/u); assert.match(describe('ASTRAGIT_GIT_PATCH_CHECK_FAILED', 'en-US').message, /not applied.*strip count/u);
  assert.equal(describe('ASTRAGIT_GIT_PATCH_PREVIEW_CHANGED').action, 'check'); assert.equal(describe('ASTRAGIT_GIT_PATCH_PREVIEW_CHANGED').outcomeUnconfirmed, false); assert.match(describe('ASTRAGIT_GIT_PATCH_PATH_INVALID').message, /Git 元数据.*符号链接/u);
  assert.doesNotMatch(describe('ASTRAGIT_GIT_PATCH_READ_FAILED').message, /文件历史|自动应用|已回滚/u);
});

test('expired history cursors request a fresh read without suggesting replaying a Git write', () => {
  const result = describe('ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED'); assert.equal(result.outcomeUnconfirmed, false); assert.equal(result.action, 'retry'); assert.match(result.message, /重新载入历史/u); assert.match(describe('ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED', 'en-US').message, /Reload history/u);
  assert.match(describe('ASTRAGIT_GIT_HISTORY_QUERY_REVISION_INVALID').message, /不是提交.*重新选择/u); assert.doesNotMatch(result.message, /(?:强推|重新提交|结果未知|写入)/u);
});

test('file-history reads explain stale revisions and unsupported encodings without implying a failed write', () => {
  const changed = describe('ASTRAGIT_GIT_FILE_HISTORY_CHANGED');
  assert.match(changed.message, /重新载入.*旧归属/u); assert.equal(changed.action, 'check'); assert.equal(changed.outcomeUnconfirmed, false);
  assert.match(describe('ASTRAGIT_GIT_FILE_HISTORY_CHANGED', 'en-US').message, /old attribution.*new contents/u);
  assert.match(describe('ASTRAGIT_GIT_FILE_HISTORY_ENCODING').message, /UTF-8.*外部工具/u);
  assert.match(describe('ASTRAGIT_GIT_FILE_HISTORY_REVISION_INVALID', 'en-US').message, /not a commit/u);
  assert.doesNotMatch(changed.message, /(?:未提交|已回滚|未执行重置|写入结果)/u);
});

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

test('Git commit failures give distinct bilingual next steps including repository identity settings', () => {
  const cases = [
    ['ASTRAGIT_GIT_IDENTITY_REQUIRED', /仓库设置.*姓名和邮箱/u, /repository settings.*name and email/u],
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
  assert.match(wrapped.message, /repository settings.*name and email/u);
  // Outcome uncertainty still has higher priority than both specific and generic causes.
  const uncertain = describe('ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN', 'zh-CN', { cause: { code: 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', message: 'switch refused', cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'command failed' } } });
  assert.match(uncertain.message, /执行结果尚未确认/u);
  assert.equal(uncertain.outcomeUnconfirmed, true);
});


test('conflict editor failures explain current state without promising that partial saves were rolled back', () => {
  const cases = [
    ['PATH_UNSAFE', /链接目录.*外部工具/u, /linked directory.*external tool/u],
    ['NOT_FOUND', /已不处于未解决冲突.*刷新/u, /no longer an unresolved conflict.*Refresh/u],
    ['STALE', /已变化.*草稿未写入.*保留草稿.*重新载入/u, /changed.*draft was not written.*Keep the draft.*reload/u],
    ['INPUT_INVALID', /参数或版本凭据无效.*保留草稿/u, /parameters or version token are invalid.*Keep the draft/u],
    ['TEXT_UNSUPPORTED', /二进制文件.*子模块.*符号链接.*外部工具/u, /binary file.*submodule.*symbolic link.*external tool/u],
    ['CONTENT_INVALID', /UTF-8.*空字符.*大小限制/u, /UTF-8.*null character.*size limit/u],
    ['MARKERS_REMAIN', /格式不完整的冲突标记.*不能标记为已解决/u, /malformed conflict markers.*cannot be marked resolved/u],
    ['READ_FAILED', /无法读取或核对.*已有草稿请先保留/u, /could not be read or verified.*Keep any existing draft/u],
  ];
  const wrappedPartial = describe('ASTRAGIT_GIT_ACTION_FAILED', 'en-US', { operationStatus: 'unknown_after_write', cause: { code: 'ASTRAGIT_GIT_CONFLICT_STALE', message: 'stale after save' } });
  assert.match(wrappedPartial.message, /conflict save result is unconfirmed/u);
  assert.equal(wrappedPartial.outcomeUnconfirmed, true);
  for (const [suffix, zh, en] of cases) {
    const code = 'ASTRAGIT_GIT_CONFLICT_' + suffix;
    assert.match(describe(code).message, zh, code);
    assert.match(describe(code, 'en-US').message, en, code);
    assert.notEqual(describe(code).action, 'retry', code);
    const partial = describe(code, 'zh-CN', { operationStatus: 'unknown_after_write', cause: { code: 'ASTRAGIT_GIT_COMMAND_FAILED', message: 'index refresh failed' } });
    assert.match(partial.message, /保存结果尚未确认.*可能已变化.*保留草稿/u, code);
    assert.doesNotMatch(partial.message, /草稿未写入|已回滚|自动重试/u, code);
    assert.equal(partial.outcomeUnconfirmed, true, code);
    assert.equal(partial.action, 'check', code);
  }
});


test('submodule management explains protected content, stale review and uncertain partial changes in both languages', () => {
  for (const suffix of ['INVALID', 'PATH', 'URL', 'CONFIG', 'NOT_FOUND', 'CHANGED', 'DIRTY', 'CONFIG_DIRTY', 'BLOCKED', 'ADOPT_REQUIRED', 'READ']) {
    const code = `ASTRAGIT_GIT_SUBMODULE_${suffix}`; assert.match(describe(code).message, /子模块|父仓库|本地修改|Git 仓库/u); assert.match(describe(code, 'en-US').message, /submodule|parent repository|Local changes|Git repository/iu);
  }
  for (const language of ['zh-CN', 'en-US']) {
    const result = describe('ASTRAGIT_GIT_SUBMODULE_OUTCOME_UNKNOWN', language, { operationStatus: 'unknown_after_write' }); assert.equal(result.outcomeUnconfirmed, true); assert.equal(result.action, 'check'); assert.doesNotMatch(result.message, /本次未开始|已回滚|was not started|rolled back/u);
  }
});


test('external tool hints distinguish setup, changed previews, unresolved output and uncertain tool results', () => {
  assert.equal(describe('ASTRAGIT_GIT_EXTERNAL_TOOL_REQUIRED').action, 'settings');
  assert.match(describe('ASTRAGIT_GIT_EXTERNAL_TOOL_CHANGED').message, /已变化.*重新读取/u);
  assert.match(describe('ASTRAGIT_GIT_EXTERNAL_TOOL_MARKERS_REMAIN', 'en-US').message, /conflict markers.*built-in editor/iu);
  for (const language of ['zh-CN', 'en-US']) { const result = describe('ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN', language, { operationStatus: 'unknown_after_write' }); assert.equal(result.outcomeUnconfirmed, true); assert.equal(result.action, 'check'); assert.doesNotMatch(result.message, /已回滚|本次未启动|rolled back|was not started/u); }
});

test('LFS hints require explicit initialization and never claim failed transfers or configuration writes were rolled back', () => {
  assert.equal(describe('ASTRAGIT_GIT_LFS_UNAVAILABLE').action, 'settings');
  assert.match(describe('ASTRAGIT_GIT_LFS_INIT_REQUIRED').message, /明确初始化.*不会自动修改/u);
  assert.match(describe('ASTRAGIT_GIT_LFS_CHANGED', 'en-US').message, /was not started.*Reload/u);
  for (const language of ['zh-CN', 'en-US']) {
    const result = describe('ASTRAGIT_GIT_LFS_OUTCOME_UNKNOWN', language, { operationStatus: 'unknown_after_write' });
    assert.equal(result.outcomeUnconfirmed, true); assert.equal(result.action, 'check'); assert.doesNotMatch(result.message, /已回滚|未开始|rolled back|not started/u);
  }
});


test('large-file staging messages distinguish advisory, missing filters and changed review in both languages', () => {
  for (const language of ['zh-CN', 'en-US']) {
    for (const code of ['ASTRAGIT_GIT_STAGE_LARGE_FILES', 'ASTRAGIT_GIT_STAGE_LFS_SETUP', 'ASTRAGIT_GIT_STAGE_CHANGED']) {
      const result = describe(code, language, { operationStatus: 'failed_before_write' });
      assert.equal(result.outcomeUnconfirmed, false);
      assert.match(result.message, language === 'zh-CN' ? /本次未暂存/u : /Nothing was staged/u);
    }
    assert.match(describe('ASTRAGIT_GIT_STAGE_LARGE_FILES', language).message, /LFS/u);
    assert.match(describe('ASTRAGIT_GIT_STAGE_LFS_SETUP', language).message, /clean\/process/u);
  }
});


test('selected-line hints explain changed review, read limits and conflicts without promising rollback after a write', () => {
  for (const language of ['zh-CN', 'en-US']) {
    for (const code of ['ASTRAGIT_GIT_LINES_CHANGED', 'ASTRAGIT_GIT_LINES_TOO_LARGE', 'ASTRAGIT_GIT_LINES_CHECK_FAILED', 'ASTRAGIT_GIT_LINES_CONFLICT']) {
      const value = describe(code, language, { operationStatus: 'failed_before_write' }); assert.equal(value.outcomeUnconfirmed, false); assert.match(value.message, language === 'zh-CN' ? /本次未应用/u : /not applied|Nothing was applied/u);
    }
    assert.match(describe('ASTRAGIT_GIT_LINES_UNSUPPORTED', language).message, /filter/u);
  }
});

test('Git Flow hints distinguish before-write review, paused multi-step integration and unconfirmed results', () => {
  for (const language of ['zh-CN', 'en-US']) {
    const changed = describe('ASTRAGIT_GIT_FLOW_CHANGED', language, { operationStatus: 'failed_before_write' }); assert.equal(changed.outcomeUnconfirmed, false); assert.match(changed.message, language === 'zh-CN' ? /本次未开始/u : /not started/u);
    const paused = describe('ASTRAGIT_GIT_FLOW_PAUSED', language, { operationStatus: 'conflict' }); assert.match(paused.message, language === 'zh-CN' ? /不会撤销先前/u : /does not undo earlier/u);
    const unknown = describe('ASTRAGIT_GIT_FLOW_OUTCOME_UNKNOWN', language, { operationStatus: 'unknown_after_write' }); assert.equal(unknown.outcomeUnconfirmed, true);
  }
});
