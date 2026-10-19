import { describeUserFacingError, redactUserFacingErrorDetails, userFacingErrorCause } from '@astragit/shared';
import type { ProjectGitAction, ProjectGitActionResponse, ProjectGitRepositorySnapshot } from '../apiClient.js';

/** 序列化到提交批次/行内状态时保留错误码和诊断，显示时仍能准确翻译。 */
export function gitFailureText(error: unknown): string {
  const cause = userFacingErrorCause(error);
  const identities: string[] = [];
  const diagnostics: string[] = [];
  for (let item: typeof cause | undefined = cause; item; item = item.cause) {
    identities.push([item.code && !item.message.startsWith(`${item.code}:`) ? `${item.code}: ` : '', item.message].join(''));
    if (item.details) diagnostics.push(item.details);
  }
  // 日志可能很长；先保留各层错误身份，再让脱敏器截断诊断正文。
  return redactUserFacingErrorDetails([...identities, ...diagnostics].join('\n'));
}

export function gitFailureCode(error: unknown): string | undefined {
  const root = userFacingErrorCause(error);
  if (describeUserFacingError(error).outcomeUnconfirmed) {
    for (let item: typeof root | undefined = root; item; item = item.cause) {
      if (/OUTCOME_UNKNOWN|DELIVERY_UNCONFIRMED|REPLAY_BLOCKED|ACCEPTANCE_HYDRATION_PENDING|^ASTRAGIT_GIT_(?:TIMEOUT|ACTION_STATE_READ_FAILED)$/u.test(item.code ?? '')) return item.code;
    }
    return root.code;
  }
  // 外层流程已经核实的恢复/刷新事实优先于底层命令诊断。
  for (let item: typeof root | undefined = root; item; item = item.cause) {
    if (/^ASTRAGIT_GIT_(?:ACTION_REFRESH_FAILED|SMART_OPERATION_FAILED_RESTORED|SMART_OPERATION_FAILED_STASH_PRESERVED|SMART_RESTORE_FAILED)$/u.test(item.code ?? '')) return item.code;
  }
  let code = root.code;
  for (let item = root.cause; item; item = item.cause) if (item.code && !/^ASTRAGIT_(?:GIT_)?(?:ACTION_FAILED|COMMAND_FAILED)$/u.test(item.code)) code = item.code;
  return code;
}

export function gitFailureTitle(action: ProjectGitAction, label: string, repository: string, zh: boolean): string {
  const target = action.type === 'checkout' || action.type === 'create_branch' ? action.branchName : action.type === 'checkout_revision' ? action.revision : '';
  const operation = action.type === 'create_branch' ? (zh ? `创建分支“${target}”未完成` : `Could not create branch “${target}”`) : target ? (zh ? `切换到“${target}”未完成` : `Could not switch to “${target}”`) : zh ? `${label}未完成` : `${label} did not complete`;
  return `${repository} · ${operation}`;
}

/** 已收到执行结果后，刷新失败不能被底层读取超时改写为写入结果未知。 */
export function gitPostActionRefreshError(reason: unknown, outcome: ProjectGitActionResponse['result']['outcome']): unknown {
  return { code: 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED', message: 'Refreshing the repository after the Git action failed', operationStage: 'refresh', operationStatus: outcome, cause: userFacingErrorCause(reason) };
}

/** 使用操作返回的事实和最新快照，区分整合阶段与恢复本地修改阶段。 */
export function gitConflictMessage(action: ProjectGitAction, result: ProjectGitActionResponse['result'], snapshot: ProjectGitRepositorySnapshot, zh: boolean): string {
  const count = snapshot.conflictFiles.length || result.conflictFiles.length;
  const conflicts = zh ? (count ? `${count} 个文件存在冲突` : '存在文件冲突') : count ? `${count} conflicted files` : 'file conflicts';
  const branch = snapshot.detached ? (zh ? '当前为分离 HEAD' : 'HEAD is detached') : zh ? `当前分支为“${snapshot.branch}”` : `Current branch: “${snapshot.branch}”`;
  if (result.operationStage === 'restore') {
    const stash = result.savedStash ? (zh ? `自动贮藏 ${result.savedStash.slice(0, 12)} 已保留，不要重复应用。` : `Saved stash ${result.savedStash.slice(0, 12)} is retained; do not apply it again.`) : '';
    return zh ? `更新步骤已执行，但恢复本地修改时${conflicts}。${branch}。请在文件状态中解决冲突并暂存。${stash}` : `The update step ran, but restoring local changes left ${conflicts}. ${branch}. Resolve and stage the files in File Status. ${stash}`;
  }
  if (action.type === 'apply_stash') return zh
    ? `应用贮藏后${conflicts}。${branch}。贮藏条目仍保留；请先解决冲突并暂存，不要重复应用。`
    : `Applying the stash left ${conflicts}. ${branch}. The stash is retained; resolve and stage the files before continuing. Do not apply it again.`;
  const operation = action.type === 'cherry_pick' ? (zh ? '挑选提交' : 'Cherry-pick') : action.type === 'revert' ? (zh ? '撤销提交' : 'Revert') : snapshot.integrationState === 'rebase' || action.type === 'rebase' || (action.type === 'pull' && action.strategy === 'rebase') ? (zh ? '变基' : 'Rebase') : (zh ? '合并' : 'Merge');
  const next = snapshot.integrationState
    ? (zh ? '请在文件状态中解决冲突并暂存，再点击“继续”；如需取消整合，可点击“终止”。' : 'Resolve and stage the files in File Status, then choose Continue. Choose Abort to cancel the integration.')
    : (zh ? '请在文件状态中解决冲突并暂存，再通过外部 Git 工具继续或中止本次操作。' : 'Resolve and stage the files in File Status, then continue or abort this operation in an external Git tool.');
  const saved = result.operationStage === 'integration' && result.savedStash
    ? (zh ? `先前的本地修改仍保存在自动贮藏 ${result.savedStash.slice(0, 12)}，尚未恢复；请先完成或终止整合，再检查并从该贮藏恢复修改。` : `Your earlier local changes remain in saved stash ${result.savedStash.slice(0, 12)} and have not been restored. Complete or abort the integration, then review and restore that stash.`)
    : '';
  return zh ? `${operation}已暂停，${conflicts}。${branch}。${next}${saved}` : `${operation} paused with ${conflicts}. ${branch}. ${next} ${saved}`.trim();
}
