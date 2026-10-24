import { describeUserFacingError, redactUserFacingErrorDetails, userFacingErrorCause } from '@astragit/shared';
import type { ProjectGitAction, ProjectGitActionResponse, ProjectGitRepositorySnapshot } from '../apiClient.js';

export function gitIntegrationLabel(kind: ProjectGitRepositorySnapshot['integrationState'], zh: boolean): string {
  const labels = { merge: ['合并', 'Merge'], rebase: ['变基', 'Rebase'], cherry_pick: ['拣选提交', 'Cherry-pick'], revert: ['反向提交', 'Revert'], am: ['邮件补丁导入', 'Mailbox import'] } as const;
  return kind ? labels[kind][zh ? 0 : 1] : zh ? '提交整合' : 'Integration';
}

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

/** Never claim that files were protected when the server has not confirmed the outcome. */
export function gitFailureContext(error: unknown, zh: boolean): { description?: string; files: string[]; fileCount: number } {
  const chain = [];
  for (let item: ReturnType<typeof userFacingErrorCause> | undefined = userFacingErrorCause(error); item; item = item.cause) chain.push(item);
  const uncertain = describeUserFacingError(error).outcomeUnconfirmed;
  const rejectedPush = gitFailureCode(error) === 'ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD';
  const evidence = chain.find(item => item.affectedFiles?.length);
  const status = chain.find(item => item.operationStatus)?.operationStatus;
  return {
    ...(rejectedPush ? { description: zh ? '所报分支的推送已被拒绝。若同时推送了其他分支或标签，它们可能已更新；请先抓取并核对结果。' : 'Git rejected the reported branch update. Other branches or tags included in the push may have been updated; fetch and review their results first.' }
      : uncertain ? { description: zh ? '尚未确认最终状态。请先刷新仓库并核对结果，避免重复执行。' : 'The final state is unconfirmed. Refresh and review the repository before repeating the action.' }
      : status === 'failed_before_write' && /ASTRAGIT_GIT_CHECKOUT_(?:BLOCKED|CONFLICTED|BRANCH_IN_USE)/u.test(gitFailureCode(error) ?? '') ? { description: zh ? '此次切换已被阻止；分支未切换，本地文件未被覆盖。' : 'The switch was blocked. The branch was not switched and local files were not overwritten.' } : {}),
    files: evidence?.affectedFiles ?? [],
    fileCount: Math.max(evidence?.affectedFiles?.length ?? 0, evidence?.affectedFileCount ?? 0),
  };
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
  if ((snapshot.integrationState === 'cherry_pick' || snapshot.integrationState === 'revert') && snapshot.integrationNoCommit) return zh
    ? `${snapshot.integrationState === 'revert' ? '反向提交' : '批量拣选'}已暂停，${conflicts}。${branch}。本次不自动提交；请先解决并暂存冲突，手动提交已应用的内容，再点击“继续”处理剩余提交。序列完成后，剩余应用内容仍需手动提交；“终止”将回到序列开始时的提交；请先另存需要保留的暂存内容和中间提交。`
    : `The ${snapshot.integrationState === 'revert' ? 'revert' : 'cherry-pick'} sequence paused with ${conflicts}. ${branch}. Automatic commits are disabled. Resolve and stage conflicts, manually commit the applied changes, then choose Continue for the remaining commits. Commit any remaining applied changes after the sequence completes. Abort returns to the starting commit; save staged contents and intermediate commits you need to keep separately first.`;
  if ((action.type === 'cherry_pick' || action.type === 'revert') && action.commit === false && !snapshot.integrationState) return zh
    ? `${action.type === 'cherry_pick' ? '拣选' : '反向应用'}后${conflicts}。${branch}。本次选择不自动提交；请在文件状态中解决并暂存冲突，再自行填写提交说明并提交。Git 没有创建可继续或终止的原生序列。`
    : `${action.type === 'cherry_pick' ? 'Cherry-picking' : 'Reversing changes'} left ${conflicts}. ${branch}. Automatic commit was disabled. Resolve and stage the conflicts, then enter a message and commit manually. Git did not create a native sequence to continue or abort.`;
  if (action.type === 'revert' && action.commit === false && snapshot.integrationState === 'revert') return zh
    ? `反向应用后${conflicts}。${branch}。本次未自动提交；请先解决并暂存冲突，再填写说明手动提交，或点击“继续”创建新提交。点击“终止”可取消本次反向应用。`
    : `Reversing changes left ${conflicts}. ${branch}. No commit was created automatically. Resolve and stage the conflicts, then enter a message and commit manually, or choose Continue to create a commit. Choose Abort to cancel this revert.`;
  if (action.type === 'skip_integration') return zh
    ? `已跳过当前提交，继续${gitIntegrationLabel(action.kind, true)}时${conflicts}。${branch}。请处理新的冲突并暂存，再继续；也可核对后跳过下一提交或终止整合。`
    : `The current commit was skipped, but continuing ${gitIntegrationLabel(action.kind, false)} left ${conflicts}. ${branch}. Resolve and stage the new conflicts before continuing, or review whether to skip the next commit or abort.`;
  const operation = action.type === 'import_mailbox' || snapshot.integrationState === 'am' ? (zh ? '邮件补丁导入' : 'Mailbox import') : action.type === 'cherry_pick' ? (zh ? '挑选提交' : 'Cherry-pick') : action.type === 'revert' ? (zh ? '撤销提交' : 'Revert') : snapshot.integrationState === 'rebase' || action.type === 'rebase' || (action.type === 'pull' && action.strategy === 'rebase') ? (zh ? '变基' : 'Rebase') : (zh ? '合并' : 'Merge');
  const next = snapshot.integrationState
    ? (zh ? '请在文件状态中解决冲突并暂存，再点击“继续”；如需取消整合，可点击“终止”。' : 'Resolve and stage the files in File Status, then choose Continue. Choose Abort to cancel the integration.')
    : (zh ? '请在文件状态中解决冲突并暂存，再通过外部 Git 工具继续或中止本次操作。' : 'Resolve and stage the files in File Status, then continue or abort this operation in an external Git tool.');
  const saved = result.operationStage === 'integration' && result.savedStash
    ? (zh ? `先前的本地修改仍保存在自动贮藏 ${result.savedStash.slice(0, 12)}，尚未恢复；请先完成或终止整合，再检查并从该贮藏恢复修改。` : `Your earlier local changes remain in saved stash ${result.savedStash.slice(0, 12)} and have not been restored. Complete or abort the integration, then review and restore that stash.`)
    : '';
  return zh ? `${operation}已暂停，${conflicts}。${branch}。${next}${saved}` : `${operation} paused with ${conflicts}. ${branch}. ${next} ${saved}`.trim();
}
