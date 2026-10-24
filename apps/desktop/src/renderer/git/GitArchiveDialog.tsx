import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitArchiveFormat, GitArchivePreview, GitArchiveResult, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import './gitArchive.css';

export interface GitArchiveDialogRequest { repository: ProjectGitRepositoryWorkbenchItem; revision?: string }
export function GitArchiveDialog(props: { request: GitArchiveDialogRequest; projectId: string; client: Pick<DashboardClient, 'previewRepositoryGitArchive'>; zh: boolean; onClose: () => void }) {
  const [request] = useState(props.request); const [projectId] = useState(props.projectId); const text = (cn: string, en: string) => props.zh ? cn : en;
  const [revision, setRevision] = useState(request.revision ?? 'HEAD'); const [format, setFormat] = useState<GitArchiveFormat>('zip'); const [prefix, setPrefix] = useState('');
  const [refresh, setRefresh] = useState(0); const key = JSON.stringify([revision, format, prefix, refresh]);
  const [read, setRead] = useState<{ key: string; value: GitArchivePreview } | null>(null); const preview = read?.key === key ? read.value : null;
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState('');
  const [receipt, setReceipt] = useState<(GitArchiveResult & { name: string }) | null>(null);
  const alive = useRef(true); const exportId = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (exportId.current) void window.astraGit?.cancelSourceArchive?.(exportId.current).catch(() => undefined); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setReceipt(null); setFeedback('');
    const timer = setTimeout(() => {
      void props.client.previewRepositoryGitArchive(projectId, request.repository.id, { revision, format, prefix }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setRead({ key, value }); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, projectId, request.repository.id, revision, format, prefix, key]);

  async function save() {
    if (!preview || loading || saving || exportId.current) return;
    const id = crypto.randomUUID(); exportId.current = id; setSaving(true); setError(null); setReceipt(null); setFeedback('');
    try {
      if (!window.astraGit?.saveSourceArchive) throw Object.assign(new Error('请在 AstraGit 桌面应用中保存源码存档。'), { code: 'ASTRAGIT_GIT_ARCHIVE_DESKTOP_REQUIRED' });
      const result = await window.astraGit.saveSourceArchive({ id, projectId, repositoryId: request.repository.id, input: { revision: preview.commitHash, format: preview.format, prefix: preview.prefix } });
      if (!alive.current || exportId.current !== id) return;
      if (!result.ok) throw result.error;
      if (result.canceled) setFeedback(text('已取消，尚未保存源码存档。', 'Cancelled. No source archive was saved.'));
      else setReceipt(result);
    } catch (reason) { if (alive.current) setError(reason); }
    finally { if (exportId.current === id) exportId.current = null; if (alive.current) setSaving(false); }
  }

  return <ModalPortal role="dialog" aria-label={text('导出源码存档', 'Export source archive')} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={saving}>
    <section className="git-archive-dialog" data-modal-surface="dialog">
      <header><strong>{text('导出源码存档', 'Export source archive')}</strong><span>{request.repository.name}</span><Button size="compact" disabled={saving} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>{text('修订版本', 'Revision')}<input value={revision} disabled={saving} onChange={event => setRevision(event.target.value)} placeholder="HEAD" /></label>
        <label>{text('存档格式', 'Archive format')}<select value={format} disabled={saving} onChange={event => setFormat(event.target.value as GitArchiveFormat)}><option value="zip">ZIP (.zip)</option><option value="tar">TAR (.tar)</option><option value="tar.gz">TAR.GZ (.tar.gz)</option></select></label>
        <label>{text('归档内目录（可留空）', 'Folder inside archive (optional)')}<input value={prefix} disabled={saving} onChange={event => setPrefix(event.target.value)} placeholder="project-v1.0/" /></label>
        <p>{text('导出该提交的源码文件，保留文件模式与符号链接；不包含暂存区、工作区修改或未跟踪文件。', 'Export the commit’s source files, preserving file modes and symbolic links. Staged, working tree and untracked changes are excluded.')}</p>
        <p>{text('遵循 Git 的导出属性；子模块中的文件不会递归打包。', 'Git export attributes apply. Files inside submodules are not included recursively.')}</p>
        {loading ? <p role="status">{text('正在核对修订版本…', 'Checking revision…')}</p> : preview ? <section className="git-archive-revision" aria-label={text('将要存档的提交', 'Commit to archive')}><strong>{preview.subject}</strong><code>{preview.commitHash}</code><small>{preview.suggestedName}</small></section> : null}
        {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
        {receipt ? <section className="git-archive-receipt" role="status"><strong>{text(`已保存 ${receipt.name}`, `Saved ${receipt.name}`)}</strong><span>{receipt.byteLength.toLocaleString()} {text('字节', 'bytes')}</span><code title="SHA-256">{receipt.sha256}</code></section> : feedback ? <p role="status">{feedback}</p> : null}
      </form>
      <footer>{saving ? <><span role="status">{text('正在生成并保存源码存档…', 'Creating and saving source archive…')}</span><Button onClick={() => { if (exportId.current) void window.astraGit?.cancelSourceArchive?.(exportId.current).catch(setError); }}>{text('取消导出', 'Cancel export')}</Button></> : <><Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>{text('重新核对', 'Recheck')}</Button><Button variant="primary" disabled={!preview || loading} onClick={() => void save()}>{text('选择位置并存档…', 'Choose location and archive…')}</Button></>}</footer>
    </section>
  </ModalPortal>;
}
