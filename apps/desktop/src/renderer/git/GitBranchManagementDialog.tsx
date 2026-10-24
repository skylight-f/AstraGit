import { useEffect, useRef, useState } from 'react';
import { describeUserFacingError, userFacingErrorCause } from '@astragit/shared';
import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export type GitBranchManagementRequest =
  | { kind: 'delete-local'; repository: ProjectGitRepositoryWorkbenchItem; branchName?: string }
  | { kind: 'delete-remote'; repository: ProjectGitRepositoryWorkbenchItem; branchName: string; remote: string }
  | { kind: 'upstream'; repository: ProjectGitRepositoryWorkbenchItem; branchName: string; initialUpstreamRef?: string | null };

export function branchActionNeedsReview(error: unknown): boolean {
  if (describeUserFacingError(error).outcomeUnconfirmed) return true;
  for (let cause: ReturnType<typeof userFacingErrorCause> | undefined = userFacingErrorCause(error); cause; cause = cause.cause) {
    if (cause.operationStatus === 'unknown_after_write' || ['ASTRAGIT_GIT_BRANCH_IN_USE', 'ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED', 'ASTRAGIT_GIT_REMOTE_BRANCH_CHANGED', 'ASTRAGIT_GIT_REMOTE_TARGET_CHANGED', 'ASTRAGIT_GIT_BRANCH_NOT_FOUND', 'ASTRAGIT_GIT_REF_NOT_FOUND', 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED'].includes(cause.code ?? '')) return true;
  }
  return false;
}

/** Review is frozen while the live workbench continues refreshing behind this dialog. */
export function GitBranchManagementDialog(props: {
  request: GitBranchManagementRequest;
  zh: boolean;
  busy: boolean;
  onClose: () => void;
  onAbort: () => Promise<void>;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request);
  const repository = request.repository; const snapshot = repository.snapshot;
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const unavailable = new Set(snapshot.checkedOutBranches ?? []);
  if (!snapshot.detached) unavailable.add(snapshot.branch);
  const [selected, setSelected] = useState(() => new Set(request.kind === 'delete-local' && request.branchName && !unavailable.has(request.branchName) ? [request.branchName] : []));
  const [force, setForce] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [upstream, setUpstream] = useState(request.kind === 'upstream' ? (request.initialUpstreamRef === undefined ? snapshot.branchUpstreamRefs?.[request.branchName] : request.initialUpstreamRef) ?? '' : '');
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [aborting, setAborting] = useState(false);
  const gate = useRef(false);
  const alive = useRef(true); const stop = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  const title = request.kind === 'delete-local' ? text('删除本地分支', 'Delete local branches') : request.kind === 'delete-remote' ? text('删除远程分支', 'Delete remote branch') : text('设置上游分支', 'Set upstream branch');
  const remote = request.kind === 'delete-remote' ? snapshot.remoteDetails?.find(item => item.name === request.remote) : undefined;
  const expectedHead = request.kind === 'upstream' ? snapshot.localBranchHeads?.[request.branchName] : request.kind === 'delete-remote' ? snapshot.remoteBranchHeads?.[`${request.remote}/${request.branchName}`] : undefined;
  const choices = [...snapshot.localBranches.filter(branch => request.kind !== 'upstream' || branch !== request.branchName).map(branch => ({ ref: `refs/heads/${branch}`, label: `${text('本地', 'Local')} · ${branch}` })), ...snapshot.remoteBranches.map(branch => ({ ref: `refs/remotes/${branch}`, label: `${text('远程', 'Remote')} · ${branch}` }))];
  const metadataMissing = request.kind === 'delete-local' ? [...selected].some(branch => !snapshot.localBranchHeads?.[branch]) : !expectedHead || (request.kind === 'delete-remote' && (!remote?.pushFingerprint || !remote.pushUrls?.length));
  const disabled = running || props.busy;
  const ready = !review && !metadataMissing && (request.kind === 'delete-local' ? selected.size > 0 : request.kind === 'delete-remote' ? confirmed : upstream !== (snapshot.branchUpstreamRefs?.[request.branchName] ?? ''));
  const accept = async () => {
    if (disabled || !ready || gate.current) return;
    gate.current = true; stop.current = false; setStopped(false); setRunning(true); setError(null);
    try {
      const actions: Array<{ name: string; action: ProjectGitAction }> = request.kind === 'delete-local'
        ? [...selected].map(branchName => ({ name: branchName, action: { type: 'delete_branch', branchName, force, expectedTargetHeadSha: snapshot.localBranchHeads![branchName] } }))
        : request.kind === 'delete-remote'
          ? [{ name: `${request.remote}/${request.branchName}`, action: { type: 'delete_remote_branch', remote: request.remote, branchName: request.branchName, expectedTargetHeadSha: expectedHead!, expectedRemotePushFingerprint: remote!.pushFingerprint! } }]
          : [{ name: request.branchName, action: { type: 'set_upstream', branchName: request.branchName, upstreamRef: upstream || null, expectedUpstreamRef: snapshot.branchUpstreamRefs?.[request.branchName] || null, expectedTargetHeadSha: expectedHead! } }];
      for (const item of actions) {
        if (!alive.current || stop.current) return;
        const result = await props.onExecute(repository, item.action, `${title} · ${item.name}`);
        if (!alive.current) return;
        if (result.outcome !== 'completed') {
          setError(result.error ?? new Error(text('操作尚未完成，请核对仓库状态。', 'The operation did not complete. Review the repository state.')));
          setReview(Boolean(result.error && branchActionNeedsReview(result.error)));
          return;
        }
        setCompleted(current => [...current, item.name]);
        setSelected(current => { const next = new Set(current); next.delete(item.name); return next; });
      }
      if (!stop.current) props.onClose();
    } catch (reason) { setError(reason); setReview(branchActionNeedsReview(reason)); }
    finally { gate.current = false; if (alive.current) setRunning(false); }
  };
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="alertdialog" aria-label={title} onDismiss={props.onClose} dismissDisabled={disabled}>
    <section className="project-git-menu-action-dialog git-branch-management" data-modal-surface="alertdialog">
      <header><strong>{title}</strong><p>{repository.name}{request.kind === 'delete-local' ? '' : ` · ${request.kind === 'delete-remote' ? `${request.remote}/` : ''}${request.branchName}`}</p></header>
      {request.kind === 'delete-local' ? <>
        <p>{text('选择要删除的本地分支。Git 会检查合入情况；正在工作区使用的分支不能删除。', 'Select local branches to delete. Git checks merge status; checked-out branches cannot be deleted.')}</p>
        <div className="git-branch-delete-list">{snapshot.localBranches.map(branch => <label key={branch} className="git-branch-choice"><input type="checkbox" checked={selected.has(branch)} disabled={disabled || unavailable.has(branch) || completed.includes(branch) || !snapshot.localBranchHeads?.[branch]} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(branch); else next.delete(branch); return next; })} /><span>{branch}<small>{completed.includes(branch) ? text('已删除', 'Deleted') : unavailable.has(branch) ? text('工作区正在使用', 'Checked out in a worktree') : snapshot.localBranchHeads?.[branch]?.slice(0, 12) ?? text('请刷新后重开', 'Refresh and reopen')}</small></span></label>)}</div>
        <label className="git-branch-choice"><input type="checkbox" checked={force} disabled={disabled || review} onChange={event => setForce(event.target.checked)} /><span>{text('强制删除（允许删除尚未合入的分支）', 'Force delete regardless of merge status')}</span></label>
        {force ? <p role="note">{text('强制删除会移除所选本地分支引用。仅由这些分支保留的提交可能无法再访问，请先核对需要保留的提交。', 'Force deletion removes the selected local branch refs. Commits reachable only from those branches may become unavailable. Review any commits you need to keep first.')}</p> : null}
      </> : request.kind === 'delete-remote' ? <>
        <p>{text('从以下推送目标删除服务器上的分支：', 'Delete the server branch from these push destinations:')}</p>
        <ul>{remote?.pushUrls?.map((url, index) => <li key={index}>{url}</li>)}</ul>
        <p>{text('确认版本：', 'Reviewed commit: ')}{expectedHead?.slice(0, 12) ?? text('不可用', 'Unavailable')}</p>
        <label className="git-branch-choice"><input type="checkbox" checked={confirmed} disabled={disabled || review} onChange={event => setConfirmed(event.target.checked)} /><span>{text('确认删除服务器上的此分支。这会影响其他使用者；所有列出的目标都将执行。', 'Confirm deleting this server branch. This affects other users and applies to every listed destination.')}</span></label>
      </> : <>
        <p>{text('当前上游：', 'Current upstream: ')}{snapshot.branchUpstreamRefs?.[request.branchName]?.replace(/^refs\/(?:heads|remotes)\//u, '') || text('无', 'None')}</p>
        <label>{text('新的上游分支', 'New upstream branch')}<select value={upstream} disabled={disabled || review} onChange={event => setUpstream(event.target.value)}><option value="">{text('不跟踪上游', 'No upstream')}</option>{upstream && !choices.some(choice => choice.ref === upstream) ? <option value={upstream} disabled>{upstream} · {text('不可用', 'Unavailable')}</option> : null}{choices.map(choice => <option key={choice.ref} value={choice.ref}>{choice.label}</option>)}</select></label>
        <p>{upstream ? text('更新该分支的跟踪关系，之后拉取与默认推送会使用此上游。', 'Update this branch’s tracking relationship for subsequent pulls and default pushes.') : text('清除该分支的上游跟踪关系。', 'Clear this branch’s upstream tracking relationship.')}</p>
      </>}
      {completed.length ? <p role="status">{text(`已完成：${completed.join('、')}。其余选择尚待处理。`, `Completed: ${completed.join(', ')}. Other selections remain pending.`)}</p> : null}
      {stopped ? <p role="status">{text('已请求停止后续删除。当前单项结束后可核对已完成结果。', 'Further deletions are stopped. Review completed results after the current item finishes.')}</p> : null}
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      {metadataMissing || review ? <p role="status">{text('请关闭此窗口，刷新或抓取仓库，核对最新状态后重新操作。', 'Close this dialog, refresh or fetch the repository, then review its current state before continuing.')}</p> : null}
      <footer>{running && request.kind === 'delete-local' ? <Button variant="secondary" disabled={stopped} onClick={() => { stop.current = true; setStopped(true); }}>{text('停止后续删除', 'Stop further deletions')}</Button> : running && request.kind === 'delete-remote' ? <Button variant="secondary" disabled={aborting} onClick={async () => { setAborting(true); try { await props.onAbort(); } catch (reason) { if (alive.current) setError(reason); } finally { if (alive.current) setAborting(false); } }}>{text('中止当前操作', 'Abort operation')}</Button> : null}<Button autoFocus variant="secondary" disabled={disabled} onClick={props.onClose}>{review ? text('关闭', 'Close') : text('取消', 'Cancel')}</Button><Button variant={request.kind === 'upstream' ? 'primary' : 'danger'} disabled={disabled || !ready} busy={running} onClick={() => void accept()}>{request.kind === 'delete-local' ? text(`删除 ${selected.size} 个分支`, `Delete ${selected.size} branches`) : request.kind === 'delete-remote' ? text('删除远程分支', 'Delete remote branch') : text('保存跟踪关系', 'Save tracking')}</Button></footer>
    </section>
  </ModalPortal>;
}
