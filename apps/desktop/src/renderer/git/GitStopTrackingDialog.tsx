import { useEffect, useRef, useState } from 'react';
import { describeUserFacingError, userFacingErrorCause } from '@astragit/shared';
import type { DashboardClient, GitStopTrackingPreview, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export interface GitStopTrackingRequest { repository: ProjectGitRepositoryWorkbenchItem; paths: string[] }
export function gitTrackingNeedsReview(error: unknown) {
  if (describeUserFacingError(error).outcomeUnconfirmed) return true;
  for (let cause: ReturnType<typeof userFacingErrorCause> | undefined = userFacingErrorCause(error); cause; cause = cause.cause) if (cause.operationStatus === 'unknown_after_write' || ['ASTRAGIT_GIT_STOP_TRACKING_CHANGED', 'ASTRAGIT_GIT_STOP_TRACKING_NOT_TRACKED', 'ASTRAGIT_GIT_IGNORED_PATH_CHANGED', 'ASTRAGIT_GIT_IGNORED_LIST_CHANGED', 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED'].includes(cause.code ?? '')) return true;
  return false;
}

export function GitStopTrackingDialog(props: {
  request: GitStopTrackingRequest; projectId: string; client: Pick<DashboardClient, 'loadProjectGitStopTrackingPreview'>; zh: boolean; busy: boolean;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request); const [preview, setPreview] = useState<GitStopTrackingPreview | null>(null);
  const [loading, setLoading] = useState(true); const [reload, setReload] = useState(0);
  const [error, setError] = useState<unknown>(null); const [needsReview, setNeedsReview] = useState(false);
  const [force, setForce] = useState(false); const [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true); const submitting = useRef(false);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setPreview(null); setError(null); setNeedsReview(false); setConfirmed(false); setForce(false);
    void props.client.loadProjectGitStopTrackingPreview(props.projectId, request.repository.id, request.paths, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, request, reload]);
  const ready = preview && !loading && !props.busy && !needsReview && confirmed;
  async function submit() {
    if (!ready || !preview || submitting.current) return; submitting.current = true;
    try {
      const result = await props.onExecute(request.repository, { type: 'stop_tracking', paths: preview.selection, force, expectedFingerprint: preview.fingerprint }, text('停止跟踪', 'Stop tracking'));
      if (!alive.current) return;
      if (result.outcome === 'completed') props.onClose();
      else if (result.error) { setError(result.error); setNeedsReview(gitTrackingNeedsReview(result.error)); setConfirmed(false); }
    } catch (reason) { if (alive.current) { setError(reason); setNeedsReview(true); setConfirmed(false); } }
    finally { submitting.current = false; }
  }
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="alertdialog" aria-label={text('停止跟踪', 'Stop tracking')} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-stop-tracking-dialog" data-modal-surface="dialog">
      <header><strong>{text('停止跟踪', 'Stop tracking')}</strong><p>{request.repository.name}{preview ? ` · ${preview.detached ? 'HEAD' : preview.branch} · ${preview.headSha.slice(0, 12)}` : ''}</p></header>
      <p>{text('仅从索引移除所选路径，现有磁盘文件保留。已提交过的路径会显示为暂存删除，新添加的路径会取消暂存。不会自动提交、修改忽略规则或恢复已不存在的文件。', 'Remove selected paths from the index while keeping existing disk files. Previously committed paths become staged deletions; newly added paths are unstaged. No commit is created, ignore rules are unchanged, and missing files are not restored.')}</p>
      {loading ? <p role="status">{text('正在读取索引与目录范围…', 'Reading the index and directory scope…')}</p> : null}
      {preview ? <>
        <strong>{text(`将移除 ${preview.total} 个索引项`, `Remove ${preview.total} index entries`)}</strong>
        <ul>{preview.items.map(item => <li key={item.path}>{item.path}{item.kind === 'gitlink' ? text(' · 子模块引用', ' · Submodule reference') : item.conflicted ? text(' · 未解决冲突', ' · Unresolved conflict') : ''}</li>)}{preview.total > preview.items.length ? <li>{text(`另有 ${preview.total - preview.items.length} 项；所选目录中的全部跟踪项均包含在内。`, `${preview.total - preview.items.length} more entries. All tracked entries inside selected directories are included.`)}</li> : null}</ul>
        {preview.gitlinkCount ? <p>{text('子模块目录和 .gitmodules 会保留；停止跟踪引用不等于完整移除子模块登记。', 'Submodule directories and .gitmodules are retained. Stopping tracking of a reference does not remove its full submodule registration.')}</p> : null}
        {preview.conflictCount ? <p>{text('包含未解决冲突的索引项；移除后将以删除处理这些路径。', 'Unresolved index entries are included. Removing them treats those paths as deleted.')}</p> : null}
        <label className="git-tracking-confirm"><input type="checkbox" checked={force} disabled={props.busy || needsReview} onChange={event => { setForce(event.target.checked); setConfirmed(false); }} />{text('强制移除索引中的所选版本（磁盘文件仍保留）', 'Force removal of the selected index versions (disk files are still kept)')}</label>
        <label className="git-tracking-confirm"><input type="checkbox" checked={confirmed} disabled={props.busy || needsReview} onChange={event => setConfirmed(event.target.checked)} />{text('已核对所选范围，确认停止跟踪。', 'I reviewed the scope and confirm stopping tracking.')}</label>
      </> : null}
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      {needsReview ? <p role="alert">{text('请重新载入并核对索引，不要直接重复执行。', 'Reload and review the index before attempting this again.')}</p> : null}
      <footer><Button variant="secondary" autoFocus disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button variant="secondary" disabled={props.busy || loading} onClick={() => setReload(value => value + 1)}>{text('重新载入', 'Reload')}</Button><Button disabled={!ready} busy={props.busy} onClick={() => void submit()}>{text('停止跟踪', 'Stop tracking')}</Button></footer>
    </section>
  </ModalPortal>;
}
