import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitCommitReplayInput, GitCommitReplayPreview, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitCommitReplay.css';

export interface GitCommitReplayRequest { repository: ProjectGitRepositoryWorkbenchItem; kind: 'cherry_pick' | 'revert'; revision: string; mainline?: number }
export function GitCommitReplayDialog(props: {
  request: GitCommitReplayRequest; projectId: string; client: Pick<DashboardClient, 'previewRepositoryGitReplay'>; zh: boolean; busy: boolean;
  onClose(): void; onAbort(): Promise<void>;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
  onCompleted(preview: GitCommitReplayPreview): void;
}) {
  const [request] = useState(props.request); const text = (cn: string, en: string) => props.zh ? cn : en;
  const [mainline, setMainline] = useState(request.mainline); const [commit, setCommit] = useState(request.kind === 'revert'); const [includeSourceId, setIncludeSourceId] = useState(false); const [reload, setReload] = useState(0);
  const input: GitCommitReplayInput = { kind: request.kind, revision: request.revision, ...(mainline !== undefined ? { mainline } : {}), commit, includeSourceId };
  const key = JSON.stringify([props.projectId, request.repository.id, input, reload]);
  const [state, setState] = useState<{ key: string; value?: GitCommitReplayPreview; metadata?: GitCommitReplayPreview; error?: unknown } | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null);
  const current = state?.key === key ? state : null; const preview = current?.value; const metadata = state?.metadata; const loading = !current;
  const alive = useRef(true); const submitting = useRef(false);
  const title = request.kind === 'cherry_pick' ? text('拣选提交', 'Cherry-pick commit') : text('反向提交', 'Revert commit');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void props.client.previewRepositoryGitReplay(props.projectId, request.repository.id, { kind: request.kind, revision: request.revision, ...(mainline !== undefined ? { mainline } : {}), commit, includeSourceId }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setState({ key, value, metadata: value }); })
        .catch(error => { if (!controller.signal.aborted) setState(previous => ({ key, error, metadata: previous?.metadata })); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, props.projectId, request.repository.id, request.revision, request.kind, mainline, commit, includeSourceId, key]);
  const failed = failure?.key === key ? failure.error : null;
  const ready = preview && !loading && !props.busy && !failed;
  async function submit() {
    if (!preview || !ready || submitting.current) return;
    submitting.current = true;
    try {
      const { kind, ...options } = preview.input;
      const result = await props.onExecute(request.repository, { type: kind, ...options, expectedFingerprint: preview.fingerprint }, title);
      if (!alive.current) return;
      if (result.outcome === 'completed' || result.outcome === 'conflict') {
        if (result.outcome === 'completed') props.onCompleted(preview);
        props.onClose();
      } else setFailure({ key, error: result.error ?? new Error(text('操作结果尚未确认，请重新读取当前状态。', 'The operation outcome is unconfirmed. Reload the current state.')) });
    } catch (error) { if (alive.current) setFailure({ key, error }); }
    finally { submitting.current = false; }
  }
  return <ModalPortal role="dialog" aria-label={title} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="git-commit-replay-dialog" data-modal-surface="dialog">
      <header><strong>{title}</strong><span>{request.repository.name}</span><Button size="compact" disabled={props.busy} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <div className="git-commit-replay-body">
        <p>{request.kind === 'cherry_pick' ? text('将选定提交相对所选父级的更改应用到当前仓库。', 'Apply changes from the selected commit, relative to the chosen parent, to this repository.') : text('反向应用选定提交相对所选父级的更改。', 'Reverse the selected commit’s changes relative to the chosen parent.')}</p>
        {metadata ? <section className="git-commit-replay-source"><strong>{metadata.sourceSubject}</strong><code>{metadata.sourceSha}</code><span>{text('应用到', 'Apply to')} {metadata.detached ? text('游离 HEAD', 'Detached HEAD') : metadata.branch} · {metadata.headSha.slice(0, 12) || text('尚无提交', 'Unborn branch')}</span></section> : null}
        {metadata && metadata.parents.length > 1 ? <label>{text('合并提交的父级来源', 'Mainline parent of the merge')}<select disabled={props.busy} value={mainline ?? metadata.input.mainline ?? 1} onChange={event => setMainline(Number(event.target.value))}>{metadata.parents.map(parent => <option key={parent.number} value={parent.number}>{text(`父提交 ${parent.number}`, `Parent ${parent.number}`)} · {parent.hash.slice(0, 8)} · {parent.subject}</option>)}</select></label> : null}
        <label className="git-commit-replay-checkbox"><input type="checkbox" checked={commit} disabled={props.busy} onChange={event => { setCommit(event.target.checked); if (!event.target.checked) setIncludeSourceId(false); }} />{text('成功应用后立即提交', 'Commit immediately after applying successfully')}</label>
        {request.kind === 'cherry_pick' ? <label className="git-commit-replay-checkbox"><input type="checkbox" checked={includeSourceId} disabled={props.busy || !commit} onChange={event => setIncludeSourceId(event.target.checked)} />{text('在提交说明中记录来源提交 ID', 'Record the source commit ID in the message')}</label> : null}
        <p>{commit ? text('成功后创建新提交；发生冲突时进入已有的冲突编辑与继续／终止流程。', 'Create a new commit on success. Conflicts use the existing resolution and Continue/Abort flow.') : request.kind === 'revert' ? text('只应用到暂存区和工作区，保留现有暂存内容，不立即提交。冲突解决并暂存后可手动提交；选择“继续”会创建新提交，“终止”可取消本次反向应用。', 'Apply to the index and working tree, retaining existing staged contents without committing immediately. After resolving and staging conflicts, commit manually or choose Continue to create a commit. Abort cancels the revert.') : text('只应用到暂存区和工作区，保留现有暂存内容，不创建提交；发生冲突时解决、暂存后手动提交。', 'Apply to the index and working tree, retaining existing staged contents without committing. Resolve and stage any conflicts, then commit manually.')}</p>
        {request.kind === 'revert' && preview && preview.parents.length > 1 ? <p className="git-commit-replay-warning">{text('反向提交合并会影响以后再次合并相同历史时的结果，请确认父级来源。', 'Reverting a merge affects later merges of the same history. Review the mainline parent carefully.')}</p> : null}
        {loading ? <p role="status">{text('正在核对来源、父级与本地内容…', 'Reviewing the source, parent and local contents…')}</p> : null}
        {current?.error || failed ? <VisibleApplicationError error={failed ?? current?.error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
        {preview ? <>
          <details open><summary>{text(`此次提交包含 ${preview.fileCount} 个文件`, `This commit affects ${preview.fileCount} files`)}</summary><ul>{preview.files.map(file => <li key={file.path}><span>{file.path}</span><small>+{file.additions} −{file.deletions}</small></li>)}{preview.fileCount > preview.files.length ? <li>{text(`另有 ${preview.fileCount - preview.files.length} 个文件`, `${preview.fileCount - preview.files.length} more files`)}</li> : null}</ul></details>
          {preview.localChangeCount ? <details><summary>{text(`现有本地更改 ${preview.localChangeCount} 个文件（已暂存 ${preview.stagedFileCount} 个）`, `Existing local changes: ${preview.localChangeCount} files (${preview.stagedFileCount} staged)`)}</summary><ul>{preview.localChanges.map(path => <li key={path}>{path}</li>)}</ul><p>{text('Git 仍可能因本地内容重叠或冲突拒绝应用；本次不会自动贮藏。', 'Git may refuse overlapping local changes or report conflicts. This operation does not auto-stash.')}</p></details> : null}
        </> : null}
        {failed ? <p role="alert">{text('请重新核对当前状态后再操作。', 'Reload and review the current state before trying again.')}</p> : null}
      </div>
      <footer>{props.busy ? <Button onClick={() => void props.onAbort().catch(error => { if (alive.current) setFailure({ key, error }); })}>{text('中止操作', 'Stop operation')}</Button> : null}<Button variant="secondary" disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button variant="secondary" disabled={props.busy || loading} onClick={() => setReload(value => value + 1)}>{text('重新核对', 'Recheck')}</Button><Button variant="primary" busy={props.busy} disabled={!ready} onClick={() => void submit()}>{commit ? title : text('应用到暂存区', 'Apply without committing')}</Button></footer>
    </section>
  </ModalPortal>;
}
