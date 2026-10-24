import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitMailboxInput, GitMailboxPreview, GitPatchInput, GitPatchPreview, GitPatchExportInput, GitRepositoryPatchExport, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitPatchDialog.css';

export interface GitPatchDialogRequest { repository: ProjectGitRepositoryWorkbenchItem; mode: 'import' | 'export'; paths?: string[]; scope?: GitPatchExportInput['scope']; revision?: string; revisions?: string[]; baseRef?: string; targetRef?: string }
function utf8(data: string): string | null {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(atob(data), char => char.charCodeAt(0))); } catch { return null; }
}
const desktopRequired = () => Object.assign(new Error('请在 AstraGit 桌面应用中选择或保存补丁文件。'), { code: 'ASTRAGIT_GIT_PATCH_DESKTOP_REQUIRED' });

export function GitPatchDialog(props: {
  request: GitPatchDialogRequest; projectId: string; client: Pick<DashboardClient, 'previewRepositoryGitMailbox' | 'previewRepositoryGitPatch' | 'exportRepositoryGitPatch'>; zh: boolean; busy: boolean;
  onClose: () => void; onAbort: () => Promise<void>;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request); const importing = request.mode === 'import'; const text = (cn: string, en: string) => props.zh ? cn : en;
  const [importFormat, setImportFormat] = useState<'diff' | 'mailbox'>('diff');
  const [mailboxOptions, setMailboxOptions] = useState<Omit<GitMailboxInput, 'data' | 'encoding'>>({ threeWay: true, keepSubject: true, keepCR: true, empty: 'stop' });
  const seriesRevisions = request.revisions ?? (request.revision && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(request.revision) ? [request.revision] : undefined);
  const [seriesSelected, setSeriesSelected] = useState(Boolean(seriesRevisions?.length));
  const [source, setSource] = useState<'file' | 'text'>('file'); const [fileName, setFileName] = useState(''); const [raw, setRaw] = useState('');
  const [input, setInput] = useState<GitPatchInput>({ data: '', encoding: 'base64', target: 'worktree', strip: 1, reverse: false });
  const [scope, setScope] = useState<GitPatchExportInput['scope']>(request.scope ?? (request.revisions?.length ? 'series' : request.revision ? 'commit' : 'worktree'));
  const [selectedOnly, setSelectedOnly] = useState(Boolean(request.paths?.length)); const [includeUntracked, setIncludeUntracked] = useState(Boolean(request.paths?.some(path => request.repository.snapshot.fileStatuses.some(file => file.path === path && file.indexStatus === '?'))));
  const [revision, setRevision] = useState(request.revision ?? 'HEAD'); const [baseRef, setBaseRef] = useState(request.baseRef ?? 'HEAD~1'); const [targetRef, setTargetRef] = useState(request.targetRef ?? request.revision ?? 'HEAD');
  const [diffPreview, setDiffPreview] = useState<GitPatchPreview | null>(null); const [mailboxPreview, setMailboxPreview] = useState<GitMailboxPreview | null>(null);
  const preview = importFormat === 'mailbox' ? mailboxPreview : diffPreview; const mailbox = { data: input.data, encoding: input.encoding, ...mailboxOptions }; const [artifact, setArtifact] = useState<GitRepositoryPatchExport | null>(null);
  const [loading, setLoading] = useState(false); const [fileBusy, setFileBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState(''); const [needsReview, setNeedsReview] = useState(false);
  const [fullText, setFullText] = useState(false);
  const alive = useRef(true); const submitting = useRef(false); const reading = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; reading.current?.abort(); }; }, []);
  const locked = props.busy || fileBusy;
  const invalidate = () => { reading.current?.abort(); setLoading(false); setDiffPreview(null); setMailboxPreview(null); setArtifact(null); setNeedsReview(false); setError(null); setFeedback(''); setFullText(false); };
  const changeInput = (next: GitPatchInput) => { invalidate(); setInput(next); };
  async function chooseFile() {
    if (locked) return; invalidate(); setFileBusy(true);
    try {
      if (!window.astraGit?.choosePatchFile) throw desktopRequired(); const result = await window.astraGit.choosePatchFile(); if (!alive.current) return;
      if (!result.ok) throw result.error;
      if (!result.canceled) { setFileName(result.name); setInput(current => ({ ...current, data: result.data, encoding: 'base64' })); setRaw(utf8(result.data) ?? ''); }
    } catch (reason) { if (alive.current) setError(reason); }
    finally { if (alive.current) setFileBusy(false); }
  }
  async function review() {
    if (locked || loading) return;
    const controller = new AbortController(); reading.current?.abort(); reading.current = controller; setLoading(true); setError(null); setFeedback(''); setNeedsReview(false); setDiffPreview(null); setMailboxPreview(null); setArtifact(null);
    try {
      if (importing) {
        if (importFormat === 'mailbox') { const next = await props.client.previewRepositoryGitMailbox(props.projectId, request.repository.id, mailbox, controller.signal); if (!controller.signal.aborted) setMailboxPreview(next); }
        else { const next = await props.client.previewRepositoryGitPatch(props.projectId, request.repository.id, input, controller.signal); if (!controller.signal.aborted) setDiffPreview(next); }
      }
      else {
        const next = await props.client.exportRepositoryGitPatch(props.projectId, request.repository.id, { scope, paths: scope !== 'series' && selectedOnly ? request.paths : undefined, includeUntracked: scope === 'series' ? undefined : includeUntracked, revision, baseRef, targetRef, revisions: scope === 'series' && seriesSelected ? seriesRevisions : undefined }, controller.signal);
        if (!controller.signal.aborted) setArtifact(next);
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function apply() {
    if (!preview?.applicable || locked || loading || needsReview || submitting.current) return;
    submitting.current = true; setError(null);
    try {
      const result = await props.onExecute(request.repository, importFormat === 'mailbox' ? { type: 'import_mailbox', mailbox, expectedFingerprint: preview.fingerprint } : { type: 'import_patch', patch: input, expectedFingerprint: preview.fingerprint }, importFormat === 'mailbox' ? text('导入提交序列', 'Import commit series') : text('导入补丁', 'Import patch'));
      if (!alive.current) return;
      if (result.outcome === 'completed' || result.outcome === 'conflict') props.onClose();
      else { setError(result.error); setNeedsReview(true); }
    } catch (reason) { if (alive.current) { setError(reason); setNeedsReview(true); } }
    finally { submitting.current = false; }
  }
  async function save() {
    if (!artifact || locked || loading) return; setFileBusy(true); setError(null); setFeedback('');
    try {
      if (!window.astraGit?.savePatchFile) throw desktopRequired(); const result = await window.astraGit.savePatchFile(artifact);
      if (!alive.current) return; if (!result.ok) throw result.error; if (!result.canceled) setFeedback(text(`已保存 ${result.name}`, `Saved ${result.name}`));
    } catch (reason) { if (alive.current) setError(reason); }
    finally { if (alive.current) setFileBusy(false); }
  }
  const patchText = importing ? input.encoding === 'utf8' ? input.data : input.data ? utf8(input.data) : '' : artifact ? utf8(artifact.data) : '';
  const files = preview?.files ?? artifact?.files; const affected = preview?.affectedPaths ?? artifact?.affectedPaths;
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={importing ? text('导入补丁', 'Import patch') : text('导出补丁', 'Export patch')} onDismiss={props.onClose} dismissDisabled={locked}>
    <section className="git-patch-dialog" data-modal-surface="dialog">
      <header><strong>{importing ? text('导入补丁', 'Import patch') : text('导出补丁', 'Export patch')}</strong><span>{request.repository.name}</span><Button variant="secondary" size="compact" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <div className="git-patch-dialog-body">
        <section className="git-patch-options" aria-label={text('补丁选项', 'Patch options')}>
          {importing ? <>
            <label>{text('导入方式', 'Import mode')}<select value={importFormat} disabled={locked} onChange={event => { invalidate(); setImportFormat(event.target.value === 'mailbox' ? 'mailbox' : 'diff'); }}><option value="diff">{text('应用文件差异（不创建提交）', 'Apply file differences (no commits)')}</option><option value="mailbox">{text('导入邮箱补丁序列并创建提交', 'Import mailbox series as commits')}</option></select></label>
            <label>{text('补丁来源', 'Patch source')}<select value={source} disabled={locked} onChange={event => { const next = event.target.value === 'text' ? 'text' : 'file'; setSource(next); changeInput({ ...input, data: next === 'text' ? raw : '', encoding: next === 'text' ? 'utf8' : 'base64' }); if (next === 'file') setFileName(''); }}><option value="file">{text('从文件读取', 'Read from file')}</option><option value="text">{text('粘贴补丁文本', 'Paste patch text')}</option></select></label>
            {source === 'file' ? <><Button disabled={locked} onClick={() => void chooseFile()}>{text('选择补丁文件…', 'Choose patch file…')}</Button><small>{fileName || text('支持 Git diff、二进制补丁和普通统一差异；最多 8 MiB。', 'Git diff, binary patches and unified diffs, up to 8 MiB.')}</small></> : <label className="git-patch-text-input">{text('补丁文本', 'Patch text')}<textarea value={raw} disabled={locked} spellCheck={false} onChange={event => { setRaw(event.target.value); changeInput({ ...input, data: event.target.value, encoding: 'utf8' }); }} /></label>}
            {importFormat === 'diff' ? <>
            <label>{text('应用位置', 'Apply to')}<select value={input.target} disabled={locked} onChange={event => changeInput({ ...input, target: event.target.value as GitPatchInput['target'] })}><option value="worktree">{text('仅工作区（不暂存）', 'Working tree only (do not stage)')}</option><option value="index">{text('仅暂存区（保留磁盘内容）', 'Index only (keep disk contents)')}</option><option value="both">{text('工作区和暂存区', 'Working tree and index')}</option></select></label>
            <label>{text('移除路径前缀层数', 'Strip path components')}<input type="number" min={0} max={32} value={input.strip ?? 1} disabled={locked} onChange={event => changeInput({ ...input, strip: Number(event.target.value) })} /></label>
            <label className="git-patch-check"><input type="checkbox" checked={input.reverse === true} disabled={locked} onChange={event => changeInput({ ...input, reverse: event.target.checked })} />{text('反向应用', 'Apply in reverse')}</label>
            <p>{text('导入只应用文件内容及模式，不创建提交、不切换分支，也不会自动继续合并或变基。', 'Import applies file contents and modes. It does not create commits, switch branches, or continue a merge or rebase.')}</p>
            </> : <>
              <label>{text('邮件格式', 'Mailbox format')}<select value={mailboxOptions.format ?? 'auto'} disabled={locked} onChange={event => { invalidate(); setMailboxOptions(current => ({ ...current, format: event.target.value as GitMailboxInput['format'] })); }}><option value="auto">{text('自动（识别 AstraGit 的 mboxrd 标记）', 'Auto (recognize AstraGit’s mboxrd marker)')}</option><option value="mbox">mbox</option><option value="mboxrd">mboxrd</option></select></label>
              <label className="git-patch-check"><input type="checkbox" checked={mailboxOptions.threeWay !== false} disabled={locked} onChange={event => { invalidate(); setMailboxOptions(current => ({ ...current, threeWay: event.target.checked })); }} />{text('需要时尝试三方合并', 'Try a three-way merge when needed')}</label>
              <label className="git-patch-check"><input type="checkbox" checked={mailboxOptions.keepSubject !== false} disabled={locked} onChange={event => { invalidate(); setMailboxOptions(current => ({ ...current, keepSubject: event.target.checked })); }} />{text('保留邮件主题（含已有前缀）', 'Keep the email subject, including prefixes')}</label>
              <label className="git-patch-check"><input type="checkbox" checked={mailboxOptions.keepCR !== false} disabled={locked} onChange={event => { invalidate(); setMailboxOptions(current => ({ ...current, keepCR: event.target.checked })); }} />{text('保留补丁行尾的 CR 字节', 'Keep CR bytes at patch line endings')}</label>
              <label>{text('没有文件变动的邮件', 'Emails without file changes')}<select value={mailboxOptions.empty ?? 'stop'} disabled={locked} onChange={event => { invalidate(); setMailboxOptions(current => ({ ...current, empty: event.target.value as GitMailboxInput['empty'] })); }}><option value="stop">{text('暂停并由我处理', 'Stop for review')}</option><option value="keep">{text('保留为空提交', 'Keep as empty commits')}</option><option value="drop">{text('跳过', 'Drop')}</option></select></label>
              <p>{text('按预览顺序在当前分支创建提交，作者、日期和说明取自邮件。发生冲突会暂停，可在文件状态中处理并继续、跳过或终止；前面的提交可能已完成。', 'Create commits on the current branch in preview order, using email authors, dates and messages. Conflicts pause the series. Resolve, continue, skip or abort in File Status; earlier commits may already have completed.')}</p>
            </>}

          </> : <>
            <label>{text('导出范围', 'Export scope')}<select value={scope} disabled={locked} onChange={event => { invalidate(); setScope(event.target.value as GitPatchExportInput['scope']); }}><option value="worktree">{text('工作区相对 HEAD 的全部变更', 'All working tree changes against HEAD')}</option><option value="staged">{text('已暂存变更', 'Staged changes')}</option><option value="unstaged">{text('未暂存变更', 'Unstaged changes')}</option><option value="commit">{text('一个提交（相对第一父提交）', 'One commit (against its first parent)')}</option><option value="range">{text('两个版本之间的差异', 'Diff between two revisions')}</option><option value="series">{text('提交序列（保留作者与顺序）', 'Commit series (keep authors and order)')}</option></select></label>
            {scope === 'commit' ? <label>{text('提交或引用', 'Commit or ref')}<input value={revision} disabled={locked} onChange={event => { invalidate(); setRevision(event.target.value); }} /></label> : (scope === 'range' || (scope === 'series' && !seriesSelected)) ? <><label>{text('起始版本', 'Base revision')}<input value={baseRef} disabled={locked} onChange={event => { invalidate(); setBaseRef(event.target.value); }} /></label><label>{text('目标版本', 'Target revision')}<input value={targetRef} disabled={locked} onChange={event => { invalidate(); setTargetRef(event.target.value); }} /></label></> : null}
            {scope !== 'series' && request.paths?.length ? <label className="git-patch-check"><input type="checkbox" checked={selectedOnly} disabled={locked} onChange={event => { invalidate(); setSelectedOnly(event.target.checked); }} />{text(`仅所选 ${request.paths.length} 项`, `Only ${request.paths.length} selected items`)}</label> : null}
            {['worktree', 'unstaged'].includes(scope) ? <label className="git-patch-check"><input type="checkbox" checked={includeUntracked} disabled={locked} onChange={event => { invalidate(); setIncludeUntracked(event.target.checked); }} />{text('包含未跟踪文件', 'Include untracked files')}</label> : null}
            {scope === 'series' && seriesRevisions?.length ? <label className="git-patch-check"><input type="checkbox" checked={seriesSelected} disabled={locked} onChange={event => { invalidate(); setSeriesSelected(event.target.checked); }} />{text(`使用所选 ${seriesRevisions.length} 个提交`, `Use ${seriesRevisions.length} selected commits`)}</label> : null}
            {scope === 'series' && seriesSelected ? <ul>{seriesRevisions?.map(sha => <li key={sha}>{sha}</li>)}</ul> : null}
            {scope !== 'series' && selectedOnly ? <ul>{request.paths?.map(path => <li key={path}>{path}</li>)}</ul> : null}
            {scope === 'series' ? <p>{text('生成按拓扑先后排列的 mboxrd 邮件补丁，保留每份提交的作者、日期和说明。空提交会包含在序列中；合并提交请使用普通差异格式。', 'Generate an ordered mboxrd mailbox with each commit’s author, date and message. Empty commits are included. Use a regular diff for merge commits.')}</p> : <p>{text('生成可应用的 Git 差异补丁，包含二进制、重命名和文件模式；保存不会改动仓库。两个版本的差异会合并为一个补丁，不携带提交作者与顺序。', 'Generate an applicable Git diff, including binary changes, renames and modes. Saving does not change the repository. A revision comparison produces one combined diff without commit authors or sequence.')}</p>}
          </>}
          <Button disabled={locked || loading || (importing && !input.data)} busy={loading} onClick={() => void review()}>{importing ? text('预览并校验', 'Preview and check') : text('生成补丁', 'Generate patch')}</Button>
        </section>
        <GitPaneSeparator name="patch-options" label={text('调整补丁选项与预览宽度', 'Resize patch options and preview')} initial={36} min={22} max={65} />
        <section className="git-patch-preview" aria-label={text('补丁预览', 'Patch preview')}>
          {loading ? <p role="status">{text('正在读取并核对补丁…', 'Reading and checking the patch…')}</p> : null}
          {preview ? <p role="status" className={preview.applicable ? 'is-success' : 'is-error'}>{importFormat === 'mailbox' ? preview.applicable ? text(`已读取 ${mailboxPreview?.commits.length ?? 0} 封提交邮件，尚未导入；实际应用可能产生冲突。`, `Read ${mailboxPreview?.commits.length ?? 0} commit emails. Nothing has been imported; application may produce conflicts.`) : text('当前仓库不能开始导入，请先处理下方原因。', 'The current repository cannot start the import. Review the reasons below.') : preview.applicable ? text(`校验通过，涉及 ${preview.affectedPaths.length} 个路径，尚未应用。`, `Check passed for ${preview.affectedPaths.length} paths. Nothing has been applied.`) : text('校验未通过，尚未应用。请查看下方 Git 原因。', 'Check failed. Nothing has been applied. Review the Git details below.')}</p> : null}
          {mailboxPreview?.commits || artifact?.commits ? <section className="git-patch-commits" aria-label={text('提交顺序与作者', 'Commit order and authors')}><strong>{text(`提交序列 · ${(mailboxPreview?.commits ?? artifact?.commits ?? []).length} 项`, `Commit series · ${(mailboxPreview?.commits ?? artifact?.commits ?? []).length} entries`)}</strong>{(mailboxPreview?.commits ?? artifact?.commits ?? []).map((commit, index) => <details key={index}><summary>{index + 1}. {commit.subject || text('（无主题）', '(No subject)')}{commit.empty ? text(' · 无文件变动', ' · No file changes') : ''}</summary><small>{commit.author} &lt;{commit.email}&gt; · {'authoredAt' in commit ? commit.authoredAt : commit.date}</small><pre>{commit.message}</pre></details>)}</section> : null}
          {preview?.diagnostics ? <pre className="git-patch-diagnostics">{preview.diagnostics}</pre> : null}
          {files ? <details open><summary>{text(`补丁文件 ${files.length} 项`, `${files.length} patch entries`)}</summary><ul>{files.map((file, index) => <li key={`${index}:${file.path}`}><span>{file.path}</span><small>{file.additions === null ? text('二进制', 'Binary') : `+${file.additions} −${file.deletions}`}</small></li>)}</ul>{affected && affected.length !== files.length ? <small>{text('完整涉及路径（含重命名前路径）', 'All affected paths (including rename sources)')}: {affected.join(', ')}</small> : null}</details> : <p>{text('先预览核对文件范围，再执行下一步。', 'Preview and review the file scope before proceeding.')}</p>}
          {patchText === null ? <p>{text('补丁包含非 UTF-8 字节，保留原始字节用于应用和保存，无法显示为完整文本。', 'This patch contains non-UTF-8 bytes. The original bytes are preserved for application and saving, but cannot be displayed as full text.')}</p> : patchText ? <>{patchText.length > 262144 && !fullText ? <p>{text('文本预览先显示前 256 Ki 字符，应用和保存使用完整补丁。', 'Text preview initially shows 256 Ki characters. Application and saving use the full patch.')} <Button size="compact" onClick={() => setFullText(true)}>{text('显示全部文本', 'Show full text')}</Button></p> : null}<pre className="git-patch-raw" tabIndex={0}>{fullText ? patchText : patchText.slice(0, 262144)}</pre></> : null}
        </section>
      </div>
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}{needsReview ? <p role="alert">{text('请刷新核对仓库结果，再重新预览；不会自动重复应用。', 'Refresh and verify the repository outcome before previewing again. The patch is not reapplied automatically.')}</p> : null}{feedback ? <p role="status">{feedback}</p> : null}
      <footer>{props.busy ? <Button variant="secondary" onClick={() => void props.onAbort().catch(setError)}>{text('中止操作', 'Stop operation')}</Button> : null}<Button variant="secondary" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button>{importing ? <Button variant="primary" disabled={locked || loading || !preview?.applicable || needsReview} busy={props.busy} onClick={() => void apply()}>{importFormat === 'mailbox' ? text('开始导入提交序列', 'Start importing commits') : text('应用补丁', 'Apply patch')}</Button> : <Button variant="primary" disabled={locked || loading || !artifact} onClick={() => void save()}>{text('保存补丁…', 'Save patch…')}</Button>}</footer>
    </section>
  </ModalPortal>;
}
