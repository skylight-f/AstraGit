import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitResetMode, GitWritePreview, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { describeUserFacingError, userFacingErrorCause } from '@astragit/shared';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { gitFailureCode, gitIntegrationLabel } from './gitOperationFeedback.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export type GitRevisionActionRequest =
  | { type: 'reset'; repository: ProjectGitRepositoryWorkbenchItem; revision: string }
  | { type: 'skip'; repository: ProjectGitRepositoryWorkbenchItem; kind: 'rebase' | 'cherry_pick' | 'revert' | 'am' };

export function gitRevisionActionNeedsReview(error: unknown): boolean {
  for (let cause: ReturnType<typeof userFacingErrorCause> | undefined = userFacingErrorCause(error); cause; cause = cause.cause) {
    if (cause.operationStatus === 'unknown_after_write') return true;
  }
  return describeUserFacingError(error).outcomeUnconfirmed || [
    'ASTRAGIT_GIT_RESET_PREVIEW_CHANGED', 'ASTRAGIT_GIT_INTEGRATION_PREVIEW_CHANGED',
    'ASTRAGIT_GIT_INTEGRATION_CHANGED', 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED',
  ].includes(gitFailureCode(error) ?? '');
}

/** A reviewed fingerprint binds the exact reset mode, commit and local contents. */
export function GitRevisionActionDialog(props: {
  request: GitRevisionActionRequest;
  projectId: string;
  client: Pick<DashboardClient, 'loadProjectGitResetPreview' | 'loadProjectGitSkipPreview'>;
  zh: boolean;
  busy: boolean;
  onClose: () => void;
  onAbort: () => Promise<void>;
  onCompleted: (preview: GitWritePreview) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request);
  const [mode, setMode] = useState<GitResetMode>('mixed');
  const [preview, setPreview] = useState<GitWritePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [nestedConfirmed, setNestedConfirmed] = useState(false);
  const alive = useRef(true);
  const submitting = useRef(false);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const title = request.type === 'reset' ? text('重置到选定提交', 'Reset to selected commit') : text('跳过当前提交', 'Skip current commit');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setError(null); setNeedsReview(false); setConfirmed(false); setNestedConfirmed(false);
    const pending = request.type === 'reset'
      ? props.client.loadProjectGitResetPreview(props.projectId, request.repository.id, request.revision, mode, controller.signal)
      : props.client.loadProjectGitSkipPreview(props.projectId, request.repository.id, request.kind, controller.signal);
    void pending.then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, request, mode, reload]);
  const softBlocked = request.type === 'reset' && mode === 'soft' && Boolean(preview && (preview.conflictFileCount || preview.integrationState === 'merge'));
  const destroysWorktree = request.type === 'skip' || mode === 'hard';
  const needsNestedConfirmation = destroysWorktree && Boolean(preview?.nestedRepositoryCount);
  const ready = preview && !loading && !props.busy && !needsReview && !softBlocked && confirmed && (!needsNestedConfirmation || nestedConfirmed);
  async function submit() {
    if (!ready || !preview || submitting.current) return;
    submitting.current = true; setError(null);
    try {
      const action: ProjectGitAction = request.type === 'reset'
        ? { type: 'reset_revision', targetSha: preview.targetSha, mode, expectedFingerprint: preview.fingerprint, discardNestedRepositories: nestedConfirmed }
        : { type: 'skip_integration', kind: request.kind, expectedFingerprint: preview.fingerprint, discardNestedRepositories: nestedConfirmed };
      const result = await props.onExecute(request.repository, action, title);
      if (!alive.current) return;
      if (result.outcome === 'completed' || result.outcome === 'conflict') {
        if (result.outcome === 'completed') props.onCompleted(preview);
        props.onClose();
      } else if (result.error) {
        setError(result.error); setNeedsReview(gitRevisionActionNeedsReview(result.error)); setConfirmed(false);
      }
    } catch (reason) {
      if (alive.current) { setError(reason); setNeedsReview(true); setConfirmed(false); }
    } finally { submitting.current = false; }
  }
  const list = (items: string[], count: number) => <ul>{items.map(path => <li key={path}>{path}</li>)}{count > items.length ? <li>{text(`另有 ${count - items.length} 项`, `${count - items.length} more items`)}</li> : null}</ul>;
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="alertdialog" aria-label={title} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-revision-action-dialog" data-modal-surface="dialog">
      <header><strong>{title}</strong><p>{request.repository.name}</p></header>
      {request.type === 'reset' ? <label>{text('重置方式', 'Reset mode')}<select value={mode} disabled={props.busy || loading} onChange={event => setMode(event.target.value as GitResetMode)}>
        <option value="soft">{text('Soft：移动 HEAD，保留暂存区和工作区', 'Soft: move HEAD, keep index and working tree')}</option>
        <option value="mixed">{text('Mixed：移动 HEAD，重置暂存区，保留工作区', 'Mixed: move HEAD and reset index, keep working tree')}</option>
        <option value="hard">{text('Hard：移动 HEAD，重置暂存区和工作区', 'Hard: move HEAD and reset index and working tree')}</option>
      </select></label> : <p>{text(`将跳过当前${gitIntegrationLabel(request.kind, true)}提交，放弃本步骤的冲突处理结果，并继续处理余下提交；后续仍可能发生冲突。`, `Skip the current ${gitIntegrationLabel(request.kind, false)} commit, discard this step’s resolution and process remaining commits. Further conflicts may occur.`)}</p>}
      {loading ? <p role="status">{text('正在核对当前提交、暂存区与文件…', 'Reviewing current commit, index and files…')}</p> : null}
      {preview ? <>
        <dl><dt>{text('当前分支 / HEAD', 'Current branch / HEAD')}</dt><dd>{preview.detached ? text('游离 HEAD', 'Detached HEAD') : preview.branch} · <code>{preview.headSha.slice(0, 12) || text('无提交', 'Unborn')}</code></dd>
          <dt>{request.type === 'reset' ? text('确认目标', 'Reviewed target') : text('当前步骤', 'Current step')}</dt><dd><code>{(request.type === 'reset' ? preview.targetSha : preview.currentIntegrationCommit).slice(0, 12)}</code>{request.type === 'reset' ? ` · ${preview.targetSubject}` : ''}</dd></dl>
        {request.type === 'reset' ? <p>{mode === 'soft' ? text('只移动当前分支指向（游离时移动 HEAD）；原暂存内容和文件内容保留。', 'Only move the current branch, or HEAD when detached. Existing index and file contents are kept.') : mode === 'mixed' ? text('暂存区改为目标提交，现有文件内容保留；文件状态将根据目标重新计算。', 'Replace the index with the target commit while keeping existing files. File status is recalculated against the target.') : text('目标提交会覆盖已跟踪文件的本地内容，并删除阻碍写入的未跟踪或忽略文件/目录。这些未提交内容无法通过 Git 历史恢复。', 'The target overwrites local tracked contents and removes untracked or ignored files/directories that obstruct it. Git history cannot recover these uncommitted contents.')}</p> : <p>{text('当前步骤的本地内容可能被重置；请先保存需要保留的修改。', 'Local contents from this step may be reset. Save any changes you need to keep first.')}</p>}
        {preview.integrationState && request.type === 'reset' ? <p className="git-revision-warning">{text(`当前${gitIntegrationLabel(preview.integrationState, true)}尚未完成。重置会改变此整合现场；执行后请核对是否仍需继续或终止。`, `A ${gitIntegrationLabel(preview.integrationState, false)} is in progress. Reset changes its state; review whether it still needs to be continued or aborted.`)}</p> : null}
        {softBlocked ? <p role="alert" className="git-revision-warning">{text('Git 不允许在合并或未解决的冲突中执行 Soft 重置。请选择其他方式，或先处理当前整合。', 'Git does not allow a soft reset during a merge or with unresolved conflicts. Choose another mode or finish the integration first.')}</p> : null}
        <details><summary>{text(`当前已跟踪更改：${preview.changedFileCount} 个文件`, `Current tracked changes: ${preview.changedFileCount} files`)}</summary>{list(preview.changedFiles, preview.changedFileCount)}</details>
        {destroysWorktree && preview.untrackedObstacleCount ? <details open><summary>{text(`可能被覆盖或删除的未跟踪/忽略项：${preview.untrackedObstacleCount}`, `Untracked/ignored obstacles that may be removed: ${preview.untrackedObstacleCount}`)}</summary>{list(preview.untrackedObstacles, preview.untrackedObstacleCount)}</details> : null}
        {needsNestedConfirmation ? <details open><summary>{text(`涉及其他 Git 仓库：${preview.nestedRepositoryCount}`, `Other Git repositories affected: ${preview.nestedRepositoryCount}`)}</summary><ul>{preview.nestedRepositories.map(item => <li key={item.path}>{item.path} · {item.effect === 'directory' ? text('目录及其中仓库可能被删除', 'Directory and repository may be deleted') : text('此目录中的文件可能被覆盖', 'Files in this directory may be overwritten')}</li>)}{preview.nestedRepositoryCount > preview.nestedRepositories.length ? <li>{text('另有未展示的仓库，请核对完整目录。', 'Additional repositories are not displayed. Review the full directory.')}</li> : null}</ul></details> : null}
        <small>{text('只作用于当前仓库，不递归重置已注册子模块的工作区；不自动推送或强推。', 'Applies to this repository without recursively resetting registered submodule worktrees. Does not push or force-push.')}</small>
        <label className="git-revision-confirm"><input type="checkbox" checked={confirmed} disabled={props.busy || loading || needsReview || softBlocked} onChange={event => setConfirmed(event.target.checked)} />{request.type === 'skip' ? text('确认放弃当前步骤并继续余下提交。', 'Confirm discarding this step and processing remaining commits.') : mode === 'hard' ? text('确认重置当前分支并放弃上述本地内容。', 'Confirm resetting the current branch and discarding these local contents.') : text('确认移动当前分支；已推送的历史需要与协作者协调。', 'Confirm moving the current branch. Coordinate any published history with collaborators.')}</label>
        {needsNestedConfirmation ? <label className="git-revision-confirm"><input type="checkbox" checked={nestedConfirmed} disabled={props.busy || needsReview} onChange={event => setNestedConfirmed(event.target.checked)} />{text('已核对上述其他仓库，并确认对其文件/目录的影响。', 'I reviewed the listed repositories and confirm the effects on their files/directories.')}</label> : null}
      </> : null}
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      {needsReview ? <p role="alert">{text('请重新载入并核对当前状态，不能直接重复此操作。', 'Reload and review the current state before attempting this operation again.')}</p> : null}
      <footer>{props.busy ? <Button variant="secondary" onClick={() => void props.onAbort().catch(reason => { if (alive.current) setError(reason); })}>{text('中止操作', 'Stop operation')}</Button> : null}<Button variant="secondary" autoFocus disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button variant="secondary" disabled={props.busy || loading} onClick={() => setReload(value => value + 1)}>{text('重新载入', 'Reload')}</Button><Button disabled={!ready} busy={props.busy} onClick={() => void submit()}>{request.type === 'reset' ? text('重置', 'Reset') : text('跳过', 'Skip')}</Button></footer>
    </section>
  </ModalPortal>;
}
