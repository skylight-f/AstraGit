import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitCommitReplaySeriesPreview, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitCommitReplay.css';

export interface GitCommitReplaySeriesRequest { repository: ProjectGitRepositoryWorkbenchItem; revisions: string[] }
export function GitCommitReplaySeriesDialog(props: {
  request: GitCommitReplaySeriesRequest; projectId: string; client: Pick<DashboardClient, 'previewRepositoryGitReplaySeries'>; zh: boolean; busy: boolean;
  onClose(): void; onAbort(): Promise<void>;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
  onCompleted(preview: GitCommitReplaySeriesPreview): void;
}) {
  const [request] = useState(props.request); const text = (cn: string, en: string) => props.zh ? cn : en;
  const [commit, setCommit] = useState(false); const [includeSourceId, setIncludeSourceId] = useState(false); const [mainline, setMainline] = useState<number>(); const [reload, setReload] = useState(0);
  const key = JSON.stringify([props.projectId, request.repository.id, request.revisions, commit, includeSourceId, mainline, reload]);
  const [state, setState] = useState<{ key: string; preview?: GitCommitReplaySeriesPreview; metadata?: GitCommitReplaySeriesPreview; error?: unknown }>();
  const [failure, setFailure] = useState<{ key: string; error: unknown }>(); const alive = useRef(true); const submitting = useRef(false);
  const current = state?.key === key ? state : undefined; const preview = current?.preview; const metadata = state?.metadata; const loading = !current; const failed = failure?.key === key ? failure.error : undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void props.client.previewRepositoryGitReplaySeries(props.projectId, request.repository.id, { revisions: request.revisions, ...(mainline !== undefined ? { mainline } : {}), commit, includeSourceId }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setState({ key, preview: value, metadata: value }); })
        .catch(error => { if (!controller.signal.aborted) setState(previous => ({ key, error, metadata: previous?.metadata })); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, props.projectId, request.repository.id, request.revisions, mainline, commit, includeSourceId, key]);
  async function submit() {
    if (!preview || props.busy || failed || submitting.current) return;
    submitting.current = true;
    try {
      const result = await props.onExecute(request.repository, { type: 'cherry_pick_series', input: preview.input, expectedFingerprint: preview.fingerprint }, text('批量拣选提交', 'Cherry-pick selected commits'));
      if (!alive.current) return;
      if (result.outcome === 'completed' || result.outcome === 'conflict') { if (result.outcome === 'completed') props.onCompleted(preview); props.onClose(); }
      else setFailure({ key, error: result.error ?? new Error(text('结果尚未确认，请重新核对仓库状态。', 'The outcome is unconfirmed. Review the repository state.')) });
    } catch (error) { if (alive.current) setFailure({ key, error }); }
    finally { submitting.current = false; }
  }
  const title = text('拣选所选提交', 'Cherry-pick selected commits');
  return <ModalPortal role="dialog" aria-label={title} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="git-commit-replay-dialog" data-modal-surface="dialog">
      <header><strong>{title}</strong><span>{request.repository.name}</span><Button size="compact" disabled={props.busy} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <div className="git-commit-replay-body">
        <p>{text('按下列顺序应用所选提交，祖先提交在先。中间未选中的提交不会自动加入。', 'Apply only the selected commits in the order below, with ancestors first. Unselected intermediate commits are not included.')}</p>
        {metadata ? <>
          <p>{text('应用到', 'Apply to')} {metadata.detached ? 'HEAD' : metadata.branch} · {metadata.headSha.slice(0, 12) || text('尚无提交', 'Unborn branch')}</p>
          <details open><summary>{text(`${metadata.commits.length} 个提交，按应用顺序排列`, `${metadata.commits.length} commits in application order`)}</summary><ol>{metadata.commits.map(item => <li key={item.sha}><code>{item.sha.slice(0, 8)}</code> {item.subject}{item.parentCount > 1 ? text('（合并提交）', ' (merge commit)') : ''}</li>)}</ol></details>
          {metadata.hasMerges ? <label>{text('合并提交的父级来源', 'Mainline parent for merge commits')}<select disabled={props.busy} value={mainline ?? metadata.input.mainline ?? 1} onChange={event => setMainline(Number(event.target.value))}>{Array.from({ length: metadata.maximumMainline }, (_, index) => <option key={index + 1} value={index + 1}>{text(`父提交 ${index + 1}`, `Parent ${index + 1}`)}</option>)}</select><small>{text('原生批量拣选使用相同的父级序号；需要不同来源的合并请分别拣选。', 'Native batch cherry-pick uses one mainline number. Cherry-pick merges separately when they need different mainline parents.')}</small></label> : null}
        </> : null}
        <label className="git-commit-replay-checkbox"><input type="checkbox" checked={commit} disabled={props.busy} onChange={event => { setCommit(event.target.checked); if (!event.target.checked) setIncludeSourceId(false); }} />{text('成功应用每个提交后立即提交', 'Commit immediately after each successful application')}</label>
        <label className="git-commit-replay-checkbox"><input type="checkbox" checked={includeSourceId} disabled={props.busy || !commit} onChange={event => setIncludeSourceId(event.target.checked)} />{text('在提交说明中记录来源提交 ID', 'Record the source commit IDs in messages')}</label>
        <p>{commit ? text('每个来源分别创建提交。中途冲突会保留已完成的提交和剩余序列，可解决后继续、跳过或终止。', 'Create a commit for each source. Conflicts retain completed commits and the remaining sequence; resolve and continue, skip, or abort.') : text('更改合并保留在暂存区，不自动提交。中途冲突时，先解决并暂存、手动提交已应用内容，再继续剩余提交；完成后剩余内容仍需手动提交。', 'Keep applied changes in the index without automatic commits. On conflict, resolve and stage, manually commit the applied contents, then continue the remaining commits. Commit remaining contents after the sequence completes.')}</p>
        {preview ? <details><summary>{text(`涉及 ${preview.fileCount} 个文件；现有本地更改 ${preview.localChangeCount} 个（已暂存 ${preview.stagedFileCount} 个）`, `${preview.fileCount} affected files; ${preview.localChangeCount} existing local changes (${preview.stagedFileCount} staged)`)}</summary><ul>{preview.files.slice(0, 200).map(path => <li key={path}>{path}</li>)}{preview.files.length > 200 ? <li>{text(`另有 ${preview.files.length - 200} 个文件`, `${preview.files.length - 200} more files`)}</li> : null}</ul></details> : null}
        {preview && !commit && preview.stagedFileCount > 0 ? <p className="git-commit-replay-warning">{text('现有暂存内容会参与后续手动提交。若中途冲突后终止序列，Git 可能移除开始前已暂存的内容；建议先提交或贮藏需要保留的修改。', 'Existing staged contents will be included in a later manual commit. Aborting a conflicted sequence can remove contents staged before it began. Commit or stash work you need to keep before starting.')}</p> : null}
        {loading ? <p role="status">{text('正在核对顺序、来源和本地内容…', 'Reviewing order, sources and local contents…')}</p> : null}
        {current?.error || failed ? <VisibleApplicationError error={failed ?? current?.error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      </div>
      <footer>{props.busy ? <Button onClick={() => void props.onAbort().catch(error => { if (alive.current) setFailure({ key, error }); })}>{text('中止操作', 'Stop operation')}</Button> : null}<Button variant="secondary" disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button variant="secondary" disabled={props.busy || loading} onClick={() => setReload(value => value + 1)}>{text('重新核对', 'Recheck')}</Button><Button variant="primary" busy={props.busy} disabled={!preview || props.busy || Boolean(failed)} onClick={() => void submit()}>{text('拣选所选提交', 'Cherry-pick selected commits')}</Button></footer>
    </section>
  </ModalPortal>;
}
