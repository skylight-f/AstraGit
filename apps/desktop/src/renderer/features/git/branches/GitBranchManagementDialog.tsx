import { Select } from '../../../ui/FormControls.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeUserFacingError, splitGitRemoteBranch, userFacingErrorCause } from '@astragit/shared';
import { GitBranchIcon } from '@phosphor-icons/react/dist/csr/GitBranch';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { GitOperationDialog } from '../components/GitOperationDialog.js';
import { VisibleApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';

import { GitBranchDeletionPicker } from './GitBranchDeletionPicker.js';

export type GitBranchManagementRequest =
  | { kind: 'delete-local'; repository: ProjectGitRepositoryWorkbenchItem; branchName?: string }
  | { kind: 'delete-remote'; repository: ProjectGitRepositoryWorkbenchItem; initialRef?: string }
  | { kind: 'upstream'; repository: ProjectGitRepositoryWorkbenchItem; branchName: string; initialUpstreamRef?: string | null };

type RemoteDeleteAction = Extract<ProjectGitAction, { type: 'delete_remote_branch' }>;

function remoteDeletionKey({ remote, branchName }: RemoteDeleteAction): string {
  return JSON.stringify([remote, branchName]);
}

function reviewRemoteDeletion(snapshot: ProjectGitRepositoryWorkbenchItem['snapshot'], remote: string, branchName: string) {
  const name = `${remote}/${branchName}`;
  const head = snapshot.remoteBranchHeads?.[name];
  const target = snapshot.remoteDetails?.find(item => item.name === remote);
  if (!head || !target?.pushFingerprint || !target.pushUrls?.length) return null;
  const action: RemoteDeleteAction = { type: 'delete_remote_branch', remote, branchName, expectedTargetHeadSha: head, expectedRemotePushFingerprint: target.pushFingerprint };
  return { name, action, pushUrls: target.pushUrls };
}

export function reviewRemoteBranchOptions(snapshot: ProjectGitRepositoryWorkbenchItem['snapshot']) {
  const options = new Map<string, NonNullable<ReturnType<typeof reviewRemoteDeletion>>>();
  for (const ref of snapshot.remoteBranches) {
    const parsed = splitGitRemoteBranch(ref, snapshot.remotes);
    const target = parsed && reviewRemoteDeletion(snapshot, parsed.remote, parsed.branch);
    if (target) options.set(ref, target);
  }
  return options;
}

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
  const remoteOptions = useMemo(() => request.kind === 'delete-remote' ? reviewRemoteBranchOptions(snapshot) : null, [request, snapshot]);
  const initialBranch = request.kind === 'delete-remote' ? request.initialRef : request.branchName;
  const [selected, setSelected] = useState(() => {
    if (!initialBranch) return new Set<string>();
    const eligible = request.kind === 'delete-remote' ? remoteOptions?.has(initialBranch)
      : request.kind === 'delete-local' && !unavailable.has(initialBranch);
    return new Set(eligible ? [initialBranch] : []);
  });
  const [force, setForce] = useState(false);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [upstream, setUpstream] = useState(request.kind === 'upstream' ? (request.initialUpstreamRef === undefined ? snapshot.branchUpstreamRefs?.[request.branchName] : request.initialUpstreamRef) ?? '' : '');
  const [running, setRunning] = useState(false);
  const [activeName, setActiveName] = useState('');
  const [completed, setCompleted] = useState<Array<{ name: string; action: ProjectGitAction }>>([]);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [aborting, setAborting] = useState(false);
  const gate = useRef(false);
  const alive = useRef(true); const stop = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  const title = request.kind === 'delete-local' ? text('删除本地分支', 'Delete local branches') : request.kind === 'delete-remote' ? text('删除远程分支', 'Delete remote branches') : text('设置上游分支', 'Set upstream branch');
  const expectedHead = request.kind === 'upstream' ? snapshot.localBranchHeads?.[request.branchName] : undefined;
  const removedLocal = new Set(completed.filter(item => item.action.type === 'delete_branch').map(item => item.name));
  const removedRemote = new Set(completed.flatMap(item => item.action.type === 'delete_remote_branch' ? [remoteDeletionKey(item.action)] : []));
  const pendingLocal = request.kind === 'delete-local' ? [...selected].filter(branch => !removedLocal.has(branch)) : [];
  const remoteTargets = new Map<string, NonNullable<ReturnType<typeof reviewRemoteDeletion>> & { localBranches: string[] }>();
  const pendingRemoteForLocal = new Set<string>();
  if (deleteRemote) {
    for (const branch of selected) {
      const upstreamTarget = snapshot.branchRemoteUpstreams?.[branch];
      const target = upstreamTarget && reviewRemoteDeletion(snapshot, upstreamTarget.remote, upstreamTarget.branch);
      if (!target) continue;
      const key = remoteDeletionKey(target.action);
      if (removedRemote.has(key)) continue;
      pendingRemoteForLocal.add(branch);
      const existing = remoteTargets.get(key);
      if (existing) existing.localBranches.push(branch);
      else remoteTargets.set(key, { ...target, localBranches: [branch] });
    }
  }
  const remoteDeletes = request.kind === 'delete-remote' ? [...selected].flatMap(ref => {
    const target = remoteOptions?.get(ref);
    return target && !removedRemote.has(remoteDeletionKey(target.action)) ? [target] : [];
  }) : [...remoteTargets.values()];
  const destinations = new Map(remoteDeletes.map(target => [target.action.remote, target.pushUrls]));
  const choices = request.kind !== 'upstream' ? [] : [
    ...snapshot.localBranches.filter(branch => branch !== request.branchName).map(branch => ({ ref: `refs/heads/${branch}`, label: `${text('本地', 'Local')} · ${branch}` })),
    ...snapshot.remoteBranches.map(branch => ({ ref: `refs/remotes/${branch}`, label: `${text('远程', 'Remote')} · ${branch}` })),
  ];
  const metadataMissing = request.kind === 'upstream' ? !expectedHead : request.kind === 'delete-remote' ? !remoteOptions?.size : pendingLocal.some(branch => !snapshot.localBranchHeads?.[branch]);
  const disabled = running || props.busy || aborting;
  const ready = !review && !metadataMissing && (request.kind === 'upstream' ? upstream !== (snapshot.branchUpstreamRefs?.[request.branchName] ?? '')
    : pendingLocal.length + remoteDeletes.length > 0 && (request.kind !== 'delete-remote' || confirmed));
  const deleteLabel = remoteDeletes.length
    ? pendingLocal.length
      ? text(`删除 ${pendingLocal.length} 个本地、${remoteDeletes.length} 个远程分支`, `Delete ${pendingLocal.length} local and ${remoteDeletes.length} remote branches`)
      : text(`删除 ${remoteDeletes.length} 个远程分支`, `Delete ${remoteDeletes.length} remote branches`)
    : pendingLocal.length ? text(`删除 ${pendingLocal.length} 个分支`, `Delete ${pendingLocal.length} branches`) : text('删除分支', 'Delete branches');
  const accept = async () => {
    if (disabled || !ready || gate.current) return;
    gate.current = true; stop.current = false; setStopped(false); setRunning(true); setError(null);
    try {
      const actions: Array<{ name: string; action: ProjectGitAction; localBranches?: string[] }> = request.kind !== 'upstream'
        ? [
          ...pendingLocal.map(branchName => ({ name: branchName, action: { type: 'delete_branch' as const, branchName, force, expectedTargetHeadSha: snapshot.localBranchHeads![branchName] } })),
          ...remoteDeletes,
        ]
        : [{ name: request.branchName, action: { type: 'set_upstream', branchName: request.branchName, upstreamRef: upstream || null, expectedUpstreamRef: snapshot.branchUpstreamRefs?.[request.branchName] || null, expectedTargetHeadSha: expectedHead! } }];
      for (const item of actions) {
        if (!alive.current || stop.current) return;
        setActiveName(item.name);
        const actionTitle = item.action.type === 'delete_remote_branch' ? text('删除远程分支', 'Delete remote branch') : title;
        const result = await props.onExecute(repository, item.action, `${actionTitle} · ${item.name}`);
        if (!alive.current) return;
        if (result.outcome !== 'completed') {
          setError(result.error ?? new Error(text('操作尚未完成，请核对仓库状态。', 'The operation did not complete. Review the repository state.')));
          setReview(Boolean(result.error && branchActionNeedsReview(result.error)));
          return;
        }
        setCompleted(current => [...current, { name: item.name, action: item.action }]);
        if (item.action.type === 'delete_branch' && pendingRemoteForLocal.has(item.name)) continue;
        if (request.kind !== 'upstream') {
          const finishedBranches = new Set(item.localBranches ?? [item.name]);
          setSelected(current => new Set([...current].filter(branch => !finishedBranches.has(branch))));
        }
      }
      if (!stop.current) props.onClose();
    } catch (reason) { if (alive.current) { setError(reason); setReview(branchActionNeedsReview(reason)); } }
    finally {
      gate.current = false;
      if (alive.current) { setRunning(false); setConfirmed(false); }
    }
  };
  function branchStatus(branch: string) {
    const missing = text('请刷新后重开', 'Refresh and reopen');
    const deleted = text('已删除', 'Deleted');
    if (request.kind === 'delete-remote') {
      const target = remoteOptions?.get(branch);
      if (!target) return missing;
      return removedRemote.has(remoteDeletionKey(target.action)) ? deleted : null;
    }
    if (removedLocal.has(branch)) return deleted;
    if (unavailable.has(branch)) return text('工作区正在使用', 'Checked out in a worktree');
    return snapshot.localBranchHeads?.[branch] ? null : missing;
  }
  const selectBranches = (branches: string[], checked: boolean) => {
    setConfirmed(false);
    setSelected(current => {
      const next = new Set(current);
      for (const branch of branches) {
        if (checked) next.add(branch);
        else next.delete(branch);
      }
      return next;
    });
  };
  async function stopDeletion() {
    stop.current = true;
    setStopped(true);
    if (request.kind !== 'delete-remote') return;
    setAborting(true);
    try { await props.onAbort(); }
    catch (reason) { if (alive.current) setError(reason); }
    finally { if (alive.current) setAborting(false); }
  }
  return <GitOperationDialog className="project-git-menu-action-dialog git-branch-management" role="alertdialog" aria-label={title} onDismiss={props.onClose} dismissDisabled={disabled}>
      <header className="git-branch-management-heading">
        <span className="git-branch-management-icon" data-danger={request.kind !== 'upstream' || undefined} aria-hidden="true">{request.kind === 'upstream' ? <GitBranchIcon size={20} /> : <TrashIcon size={20} />}</span>
        <div><h2>{title}</h2><p>{repository.name}{request.kind === 'upstream' && ` · ${request.branchName}`}</p></div>
      </header>
      <div className="git-branch-management-body">
        {request.kind !== 'upstream' && <>
          {request.kind === 'delete-local' && <p>{text('选择要删除的本地分支。Git 会检查分支是否已合入。', 'Select local branches to delete. Git checks whether they have been merged.')}</p>}
          <GitBranchDeletionPicker
            branches={request.kind === 'delete-remote' ? snapshot.remoteBranches : snapshot.localBranches}
            heads={request.kind === 'delete-remote' ? snapshot.remoteBranchHeads : snapshot.localBranchHeads}
            selected={selected} initialBranch={initialBranch} status={branchStatus} onSelect={selectBranches} locked={disabled || review} zh={props.zh} />
        </>}
        {request.kind === 'delete-local' ? <>
          <label className="git-branch-choice"><input type="checkbox" checked={force} disabled={disabled || review} onChange={event => setForce(event.target.checked)} /><span>{text('强制删除（允许删除尚未合入的分支）', 'Force delete regardless of merge status')}</span></label>
          {force ? <p role="note">{text('强制删除会移除所选本地分支引用。仅由这些分支保留的提交可能无法再访问，请先核对需要保留的提交。', 'Force deletion removes the selected local branch refs. Commits reachable only from those branches may become unavailable. Review any commits you need to keep first.')}</p> : null}
          <div className="git-branch-remote-delete">
            <label className="git-branch-choice">
              <input type="checkbox" checked={deleteRemote} disabled={disabled || review} onChange={event => {
                setDeleteRemote(event.currentTarget.checked);
                if (!event.currentTarget.checked) setSelected(current => new Set([...current].filter(branch => !removedLocal.has(branch))));
              }} />
              <span>{text('同时删除远程上游分支', 'Also delete tracked remote branches')}</span>
            </label>
            {deleteRemote ? remoteDeletes.length ? (
              <ul className="git-branch-remote-targets" aria-label={text('待删除的远程分支与推送地址', 'Remote branches and push destinations to delete from')}>
                {remoteDeletes.map(target => <li key={remoteDeletionKey(target.action)}><code>{target.name}</code><small>{target.pushUrls.join(' · ')}</small></li>)}
              </ul>
            ) : <small className="git-branch-remote-empty">{selected.size
              ? text('所选分支没有可核对的远程上游。', 'The selected branches have no reviewable remote upstreams.')
              : text('勾选本地分支后可查看待删除的远程上游。', 'Select local branches to review their remote upstreams.')}</small> : null}
          </div>
        </> : request.kind === 'delete-remote' ? <section className="git-branch-destinations">
          <h3>{text('推送目标', 'Push destinations')}</h3>
          {destinations.size ? <dl>{[...destinations].map(([remote, urls]) => <div key={remote}>
            <dt>{remote}</dt><dd>{urls.map((url, index) => <code key={index}>{url}</code>)}</dd>
          </div>)}</dl> : <small>{text('勾选分支后可查看推送地址。', 'Select a branch to see its push destinations.')}</small>}
        </section> : <>
          <p>{text('当前上游：', 'Current upstream: ')}{snapshot.branchUpstreamRefs?.[request.branchName]?.replace(/^refs\/(?:heads|remotes)\//u, '') || text('无', 'None')}</p>
          <label>{text('新的上游分支', 'New upstream branch')}<Select
            ariaLabel={text('新的上游分支', 'New upstream branch')}
            value={upstream}
            disabled={disabled || review}
            onChange={setUpstream}
            options={[
              { value: '', label: text('不跟踪上游', 'No upstream') },
              ...(upstream && !choices.some(choice => choice.ref === upstream) ? [{ value: upstream, label: `${upstream} · ${text('不可用', 'Unavailable')}`, disabled: true }] : []),
              ...(choices.map(choice => ({ value: choice.ref, label: choice.label }))),
            ]}
          /></label>
          <p>{upstream ? text('更新该分支的跟踪关系，之后拉取与默认推送会使用此上游。', 'Update this branch’s tracking relationship for subsequent pulls and default pushes.') : text('清除该分支的上游跟踪关系。', 'Clear this branch’s upstream tracking relationship.')}</p>
        </>}
        {(running || error) && activeName ? <p role="status">{text('当前操作分支', 'Current branch operation')} · <code>{activeName}</code></p> : null}
        {completed.length ? <p role="status">{text('已完成 ', 'Completed ')}{completed.map(item => item.action.type === 'delete_remote_branch' ? `${text('远程', 'Remote')} ${item.name}` : item.name).join(text('、', ', '))}</p> : null}
        {stopped ? <p role="status">{text('已请求停止后续删除。当前单项结束后可核对已完成结果。', 'Further deletions are stopped. Review completed results after the current item finishes.')}</p> : null}
        {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
        {metadataMissing || review ? <p role="status">{text('请关闭此窗口，刷新或抓取仓库，核对最新状态后重新操作。', 'Close this dialog, refresh or fetch the repository, then review its current state before continuing.')}</p> : null}
      </div>
      <footer className="git-branch-management-footer">
        {request.kind === 'delete-remote' && <label className="git-branch-choice git-branch-confirm">
          <input type="checkbox" checked={confirmed} disabled={disabled || review || !remoteDeletes.length} onChange={event => setConfirmed(event.target.checked)} />
          <span>{text('我确认从所有列出的推送目标删除所选分支。此操作会影响其他协作者。', 'I confirm deletion of the selected branches from every listed destination. This affects other collaborators.')}</span>
        </label>}
        <div className="git-branch-actions">
          {running && request.kind !== 'upstream' && <Button disabled={stopped && (request.kind === 'delete-local' || aborting)} onClick={() => void stopDeletion()}>
            {request.kind === 'delete-remote' ? text('中止删除', 'Abort deletion') : text('停止后续删除', 'Stop further deletions')}
          </Button>}
          <Button data-modal-initial-focus disabled={disabled} onClick={props.onClose}>{review || completed.length ? text('关闭', 'Close') : text('取消', 'Cancel')}</Button>
          <Button variant={request.kind === 'upstream' ? 'primary' : 'danger'} disabled={disabled || !ready} busy={running} onClick={() => void accept()}>
            {request.kind === 'upstream' ? text('保存跟踪关系', 'Save tracking') : running ? text('正在删除…', 'Deleting…') : deleteLabel}
          </Button>
        </div>
      </footer>
    </GitOperationDialog>;
}
