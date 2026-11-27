import type { useGitOperationHistory } from './useGitOperationHistory.js';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowsClockwiseIcon as ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CircleNotchIcon as CircleNotch } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { ProjectGitAction, ProjectGitOperationRecord } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';

/** 控制台复用既有记录布局，滚动和键盘入口共用历史加载门禁。 */
export function GitOperationConsole(props: { zh: boolean; history: ReturnType<typeof useGitOperationHistory> }) {
  /** 当前控制台是独立滚动区域。 */
  const root = useRef<HTMLDivElement>(null);
  /** 底部标记只负责触发读取，不执行任何 Git 动作。 */
  const sentinel = useRef<HTMLElement>(null);
  /** 以可见记录作为锚点，刷新插入新记录时保留阅读位置。 */
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  /** 只记录首个可见记录；位于顶部时保持最新记录可见。 */
  function rememberPosition(): void {
    /** 容器卸载时无需继续计算滚动位置。 */
    const container = root.current;
    if (!container || container.scrollTop === 0) {
      anchor.current = null;
      return;
    }
    /** 相对容器的偏移不会受整个窗口移动影响。 */
    const top = container.getBoundingClientRect().top;
    /** 操作卡片都是滚动区直接子项，跳过底部加载状态。 */
    const visible = [...container.children].find((element) => element instanceof HTMLElement && element.dataset.operationId && element.getBoundingClientRect().bottom > top) as HTMLElement | undefined;
    anchor.current = visible ? { id: visible.dataset.operationId!, offset: visible.getBoundingClientRect().top - top } : null;
  }

  useLayoutEffect(() => {
    /** DOM 更新后按原记录偏移补偿新增内容的高度。 */
    const container = root.current;
    if (container && anchor.current) {
      /** 使用已知元素身份查找，不把输出文本拼成选择器。 */
      const element = [...container.children].find((child) => child instanceof HTMLElement && child.dataset.operationId === anchor.current!.id);
      if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.current.offset;
    }
    rememberPosition();
  }, [props.history.items]);

  useEffect(() => {
    if (!root.current || !sentinel.current || props.history.loading || props.history.error || !props.history.nextCursor || typeof IntersectionObserver === 'undefined') return;
    /** 使用浏览器原生可见性观察，靠近底部 240 像素时加载下一页。 */
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void props.history.loadMore();
      },
      { root: root.current, rootMargin: '240px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [props.history.loading, props.history.error, props.history.nextCursor, props.history.loadMore, props.history.items.length]);

  return (
    <div ref={root} className="project-git-console-surface" role="region" aria-label={props.zh ? 'Git 操作历史' : 'Git operation history'} tabIndex={0} onScroll={rememberPosition} aria-busy={props.history.loading}>
      {props.history.total === 0 && !props.history.loading && !props.history.error ? (
        <section className="project-git-empty-surface">
          <ArrowsClockwise aria-hidden="true" />
          <strong>{props.zh ? '这个项目还没有仓库操作记录' : 'No repository operations for this project yet'}</strong>
          <span>{props.zh ? '通过仓库管理执行的操作会保存在这里。' : 'Operations performed through Repository management are saved here.'}</span>
        </section>
      ) : null}
      {props.history.items.map((operation) => (
        <article key={operation.id} data-operation-id={operation.id} data-tone={operation.status === 'completed' ? 'success' : operation.status === 'failed_before_write' ? 'error' : 'warning'}>
          {operation.status === 'completed' ? <CheckCircle aria-hidden="true" /> : operation.status === 'running' ? <CircleNotch aria-hidden="true" /> : <WarningCircle aria-hidden="true" />}
          <span>
            <strong>
              {operation.action && Object.hasOwn(operationActionLabels, operation.action)
                ? operationActionLabels[operation.action as ProjectGitAction['type']][props.zh ? 0 : 1]
                : (operation.action ?? (props.zh ? 'Git 操作' : 'Git operation'))}
            </strong>
            <small>
              {operation.repositoryName} · <time dateTime={operation.startedAt}>{new Date(operation.startedAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</time>
              {operation.durationMs !== null ? ` · ${operation.durationMs} ms` : ''}
            </small>
            <span>{operationStatusLabels[operation.status][props.zh ? 0 : 1]}</span>
            {operation.commands?.length ? <pre aria-label={props.zh ? '执行的 Git 命令' : 'Git commands invoked'}>{operation.commands.map((command) => `$ ${command}`).join('\n')}</pre> : null}
            {operation.status === 'unknown_after_write' ? (
              <small>{props.zh ? '请刷新并核对仓库状态；推送还需要核对远端。不会自动重试此操作。' : 'Refresh and check the repository; also check the remote for a push. This operation will not be retried automatically.'}</small>
            ) : null}
            {operation.output ? <pre>{operation.output}</pre> : null}
            {operation.limitations.map((limitation) => (
              <small key={limitation}>{operationLimitationLabels[limitation][props.zh ? 0 : 1]}</small>
            ))}
          </span>
        </article>
      ))}
      <footer ref={sentinel} className="project-git-console-pagination">
        {props.history.error ? (
          <>
            <span role="alert">
              {props.zh ? '操作历史读取失败：' : 'Could not read operation history: '}
              {props.history.error}
            </span>
            <Button variant="secondary" size="compact" onClick={() => void props.history.retry()}>
              {props.zh ? '重试读取' : 'Retry loading'}
            </Button>
          </>
        ) : props.history.loading || props.history.total === null ? (
          <span role="status">{props.zh ? '正在加载操作记录…' : 'Loading operation records…'}</span>
        ) : props.history.nextCursor ? (
          <Button variant="secondary" size="compact" onClick={() => void props.history.loadMore()}>
            {props.zh ? '加载更多' : 'Load more'}
          </Button>
        ) : props.history.items.length > 0 ? (
          <span role="status">{props.zh ? '已加载全部' : 'All records loaded'}</span>
        ) : null}
      </footer>
    </div>
  );
}

/** 动作名称只按已保存的类型翻译，不从 Git 输出猜测操作。 */
export const operationActionLabels: Record<ProjectGitAction['type'], [string, string]> = {
  interactive_rebase: ['交互变基', 'Interactive rebase'],
  amend_rebase_step: ['修订当前变基步骤', 'Amend current rebase step'],
  stop_tracking: ['停止跟踪', 'Stop tracking'],
  stage_ignored: ['强制暂存已忽略项', 'Force stage ignored items'],
  ignore: ['追加忽略规则', 'Append ignore rules'],
  discard: ['放弃修改', 'Discard changes'],
  rename_branch: ['重命名分支', 'Rename branch'],
  create_tag: ['创建标签', 'Create tag'],
  push_tag: ['推送标签', 'Push tag'],
  delete_tag: ['删除标签', 'Delete tag'],
  delete_remote_tag: ['删除远程标签', 'Delete remote tag'],
  subtree: ['子树操作', 'Subtree operation'],
  submodule_update: ['更新子模块', 'Update submodule'],
  manage_submodule: ['管理子模块', 'Manage submodule'],
  manage_lfs: ['Git LFS', 'Git LFS'],
  manage_flow: ['Git Flow', 'Git Flow'],
  external_tool: ['外部工具', 'External tool'],
  configure_external_tool: ['外部工具设置', 'External tool settings'],
  fetch: ['获取', 'Fetch'],
  stage: ['暂存', 'Stage'],
  unstage: ['取消暂存', 'Unstage'],
  import_patch: ['导入补丁', 'Import patch'],
  import_mailbox: ['导入提交序列', 'Import commit series'],
  apply_patch: ['应用补丁', 'Apply patch'],
  apply_line_changes: ['应用所选更改', 'Apply selected changes'],
  commit: ['提交', 'Commit'],
  amend_commit: ['修订上次提交', 'Amend last commit'],
  set_identity_field: ['设置提交身份', 'Set commit identity'],
  configure_remote: ['设置远程仓库', 'Configure remote'],
  configure_commit_template: ['设置提交模板', 'Configure commit template'],
  push: ['推送', 'Push'],
  pull: ['拉取', 'Pull'],
  update: ['更新', 'Update'],
  checkout: ['切换分支', 'Switch branch'],
  checkout_revision: ['检出提交', 'Checkout revision'],
  reset_revision: ['重置当前分支', 'Reset current branch'],
  create_branch: ['创建分支', 'Create branch'],
  delete_branch: ['删除分支', 'Delete branch'],
  delete_remote_branch: ['删除远程分支', 'Delete remote branch'],
  set_upstream: ['设置上游分支', 'Set upstream branch'],
  revert: ['撤销提交', 'Revert commit'],
  cherry_pick: ['拣选提交', 'Cherry-pick commit'],
  cherry_pick_series: ['批量拣选提交', 'Cherry-pick selected commits'],
  merge: ['合并', 'Merge'],
  rebase: ['变基', 'Rebase'],
  stash: ['创建 Stash', 'Create stash'],
  apply_stash: ['应用 Stash', 'Apply stash'],
  drop_stash: ['删除 Stash', 'Drop stash'],
  continue_integration: ['继续提交整合', 'Continue integration'],
  skip_integration: ['跳过当前提交', 'Skip current commit'],
  abort_integration: ['终止提交整合', 'Abort integration'],
};

/** 文本明确表达账本事实，颜色与图标不承担唯一的状态提示。 */
const operationStatusLabels: Record<ProjectGitOperationRecord['status'], [string, string]> = {
  running: ['正在执行', 'Running'],
  completed: ['已完成', 'Completed'],
  conflict: ['存在冲突，需要处理', 'Conflicts need attention'],
  failed_before_write: ['执行前失败，未开始写入', 'Failed before writing'],
  unknown_after_write: ['结果未知，需要核对', 'Outcome unknown; verification needed'],
  recorded: ['已保存执行结果，详细状态未保存', 'Result recorded; detailed status unavailable'],
};

/** 缺失信息与展示上限均直接说明，避免将空白误认为完整历史。 */
const operationLimitationLabels: Record<ProjectGitOperationRecord['limitations'][number], [string, string]> = {
  action_unavailable: ['记录未保存动作名称。', 'The action name was not saved.'],
  output_not_saved: ['记录未保存输出内容。', 'Output was not saved.'],
  output_truncated: ['输出过长，此处仅展示前 64 Ki 字符。', 'Output is long; only the first 64 Ki characters are shown.'],
  commands_not_saved: ['记录未保存具体 Git 命令。', 'The Git commands were not saved.'],
  commands_truncated: ['命令记录过长，仅保存前 64 Ki 字符。', 'Command history exceeded 64 Ki characters and was truncated.'],
};
