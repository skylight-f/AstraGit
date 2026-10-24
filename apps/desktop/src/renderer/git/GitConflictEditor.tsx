import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acceptConflictBlock, parseConflictBlocks, userFacingErrorCause, type ConflictBlockChoice } from '@astragit/shared';
import type { DashboardClient, ProjectGitConflictFile, ProjectGitRepositorySnapshot } from '../apiClient.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { notifyProjectGitChanged } from './projectGitWorkbenchState.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import './gitConflictEditor.css';

import { ConflictTextEditorLoader as ConflictTextEditor } from './ConflictEditorBoundary.js';
type Side = 'current' | 'incoming';
interface Draft { schemaVersion: 1; fingerprint: string; content: string; exists: boolean; side?: Side }
interface DocumentState { file: ProjectGitConflictFile; draft: Draft; dirty: boolean }
interface ConflictEditorProps {
  client: Pick<DashboardClient, 'readProjectGitConflict' | 'saveProjectGitConflict'>;
  projectId: string;
  repositoryId: string;
  filePath: string;
  zh: boolean;
  disabled?: boolean;
  externalRevision?: number;
  onExternalMerge?: () => void;
  onSaved: (result: { resolved: boolean; snapshot?: ProjectGitRepositorySnapshot }) => void | Promise<void>;
}
const memoryDrafts = new Map<string, Draft>();
const draftOwners = new Map<string, symbol>();
function storedDraft(key: string): Draft | null {
  const memory = memoryDrafts.get(key);
  if (memory) return memory;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
    if (value?.schemaVersion === 1 && typeof value.fingerprint === 'string' && typeof value.content === 'string' && typeof value.exists === 'boolean' && (value.side === undefined || value.side === 'current' || value.side === 'incoming')) return value;
  } catch { /* 不可用的存储不覆盖当前编辑器。 */ }
  return null;
}
function retainDraft(key: string, draft: Draft | null): boolean {
  if (draft) memoryDrafts.set(key, draft); else memoryDrafts.delete(key);
  try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); return true; }
  catch { return false; }
}

/** 文件身份隔离异步读写和编辑器模型；草稿独立保存，切换文件不会丢失未写入的结果。 */
export function GitConflictEditor(props: ConflictEditorProps) {
  return <ConflictDocument key={JSON.stringify([props.projectId, props.repositoryId, props.filePath])} {...props} />;
}

function ConflictDocument(props: ConflictEditorProps) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const key = `astragit.conflict-draft.v1.${JSON.stringify([props.projectId, props.repositoryId, props.filePath])}`;
  const [document, setDocument] = useState<DocumentState | null>(null);
  const latest = useRef<DocumentState | null>(null);
  const live = useRef(true);
  const owner = useRef(Symbol('conflict-document'));
  const loadVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pendingSave = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const [blockIndex, setBlockIndex] = useState(0);
  const [full, setFull] = useState(false);
  const [reveal, setReveal] = useState({ offset: 0, token: 0 });
  const [undoChoice, setUndoChoice] = useState<Draft | null>(null);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const mergeLayout = useRef<HTMLDivElement>(null);
  const sideLayout = useRef<HTMLDivElement>(null);
  const [paneBounds, setPaneBounds] = useState({ rows: { min: 20, max: 70 }, columns: { min: 20, max: 80 } });
  const [backup, setBackup] = useState(() => storedDraft(`${key}.backup`));
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraft = () => {
    if (draftOwners.get(key) !== owner.current) return;
    const value = latest.current;
    if (value) setStorageFailed(!retainDraft(key, value.dirty || value.draft.side ? value.draft : null));
  };

  async function load(restore = true) {
    const version = ++loadVersion.current;
    setLoading(true); setError(null); setFeedback('');
    try {
      const file = await props.client.readProjectGitConflict(props.projectId, props.repositoryId, props.filePath);
      if (!live.current || version !== loadVersion.current) return;
      const cached = restore ? storedDraft(key) : null;
      const dirty = Boolean(cached && (cached.side || cached.exists !== file.worktreeExists || cached.content !== (file.worktree ?? '')));
      const draft = dirty && cached ? cached : { schemaVersion: 1 as const, fingerprint: file.fingerprint, content: file.worktree ?? '', exists: file.worktreeExists };
      const next = { file, draft, dirty };
      latest.current = next; setDocument(next); setBlockIndex(0); setUndoChoice(null);
      setRequiresReload(false);
      const first = parseConflictBlocks(draft.content, { markerSize: file.markerSize }).blocks[0];
      setReveal(current => ({ offset: first?.start ?? 0, token: current.token + 1 }));
      if (dirty) setFeedback(text('已恢复此文件的本地合并草稿，尚未写入仓库。', 'Restored this file’s local merge draft. It has not been written to the repository.'));
    } catch (reason) { if (live.current && version === loadVersion.current) setError(reason); }
    finally { if (live.current && version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => {
    live.current = true;
    draftOwners.set(key, owner.current);
    void load();
    const unload = (event: BeforeUnloadEvent) => {
      const value = latest.current;
      if (!value?.dirty) return;
      retainDraft(key, value.draft);
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      live.current = false;
      loadVersion.current += 1;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      const value = latest.current;
      if (draftOwners.get(key) === owner.current) {
        if (value) retainDraft(key, value.dirty || value.draft.side ? value.draft : null);
        draftOwners.delete(key);
      }
      window.removeEventListener('beforeunload', unload);
    };
  }, [key, props.client]);

  const parsed = useMemo(() => parseConflictBlocks(document?.draft.content ?? '', { markerSize: document?.file.markerSize ?? 7 }), [document?.draft.content, document?.file.markerSize]);
  const index = Math.min(blockIndex, Math.max(0, parsed.blocks.length - 1));
  const block = parsed.blocks[index];
  const file = document?.file;
  const draft = document?.draft;
  const stale = requiresReload || Boolean(file && draft && file.fingerprint !== draft.fingerprint);
  const locked = busy || loading || props.disabled;
  const editable = Boolean(file?.editable && file.kind === 'text');
  const previousExternal = useRef(props.externalRevision);
  useEffect(() => {
    if (previousExternal.current === props.externalRevision) return;
    previousExternal.current = props.externalRevision;
    if (latest.current?.dirty || latest.current?.draft.side) {
      setRequiresReload(true); setFeedback(text('外部工具已返回，磁盘内容可能已变化。已保留内置草稿，请重新载入并核对；重新载入会保留备份。', 'The external tool returned and disk contents may have changed. Your built-in draft is retained. Reload and review; reloading keeps a backup.'));
    } else void load(false);
  }, [props.externalRevision]);

  const deleted = Boolean(draft && !draft.exists);
  const deletionUnconfirmed = deleted && !draft?.side;

  useLayoutEffect(() => {
    const layout = mergeLayout.current;
    const sides = sideLayout.current;
    if (!layout || !sides) return;
    const measure = () => {
      const height = layout.getBoundingClientRect().height;
      const width = sides.getBoundingClientRect().width;
      if (height <= 0 || width <= 0) return;
      const sideMinimum = Math.min(120, Math.max(0, (width - 6) / 2));
      const next = {
        rows: { min: 100 / height * 100, max: (height - 146) / height * 100 },
        columns: { min: sideMinimum / width * 100, max: (width - sideMinimum - 6) / width * 100 },
      };
      setPaneBounds(current => Object.keys(next).every(key => {
        const axis = key as keyof typeof next;
        return Math.abs(current[axis].min - next[axis].min) < 0.1 && Math.abs(current[axis].max - next[axis].max) < 0.1;
      }) ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    observer.observe(sides);
    measure();
    return () => observer.disconnect();
  }, [loading, editable]);

  function change(content: string, side?: Side, fromChoice = false, existsOverride?: boolean) {
    const value = latest.current;
    if (!value || locked || !live.current || draftOwners.get(key) !== owner.current) return;
    if (!fromChoice) setUndoChoice(null);
    const exists = existsOverride ?? (side ? value.file.indexStages.some(stage => stage.stage === (side === 'current' ? 2 : 3)) : true);
    const nextDraft: Draft = { schemaVersion: 1, fingerprint: value.draft.fingerprint, content, exists, ...(side ? { side } : {}) };
    const next = { ...value, draft: nextDraft, dirty: content !== (value.file.worktree ?? '') || exists !== value.file.worktreeExists || side !== undefined };
    latest.current = next; setDocument(next); setError(null); setFeedback('');
    // 先更新内存，退出或切文件即使发生在延迟写入前也能恢复。
    if (next.dirty || side) memoryDrafts.set(key, nextDraft); else memoryDrafts.delete(key);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushDraft, 250);
  }
  function choose(choice: ConflictBlockChoice) {
    if (!block || !document || locked) return;
    try {
      const content = acceptConflictBlock(document.draft.content, block, choice);
      setUndoChoice(document.draft); change(content, undefined, true);
      const next = parseConflictBlocks(content, { markerSize: document.file.markerSize }).blocks;
      setReveal(current => ({ offset: next[Math.min(index, Math.max(0, next.length - 1))]?.start ?? block.start, token: current.token + 1 }));
    } catch (reason) { setError(reason); }
  }
  function chooseFile(side: Side) {
    if (!document || locked) return;
    setUndoChoice(document.draft);
    change(document.file[side] ?? '', side, true);
  }
  async function save(markResolved: boolean) {
    const value = latest.current;
    if (!value || pendingSave.current || props.disabled || requiresReload || !value.file.editable || value.file.fingerprint !== value.draft.fingerprint) return;
    if (!value.draft.exists && !value.draft.side) return;
    if (markResolved && !parseConflictBlocks(value.draft.content, { markerSize: value.file.markerSize }).canComplete) return;
    pendingSave.current = true; setBusy(true); setError(null); setFeedback('');
    try {
      const response = await props.client.saveProjectGitConflict(props.projectId, props.repositoryId, {
        path: props.filePath, expectedFingerprint: value.draft.fingerprint, markResolved,
        ...(value.draft.side ? { acceptSide: value.draft.side } : { content: value.draft.content }),
      });
      if (persistTimer.current) clearTimeout(persistTimer.current);
      const saved = response.conflict;
      // 切走再返回会产生新编辑器；旧回包不能清掉新实例刚写入的草稿。
      const ownsDraft = draftOwners.get(key) === owner.current || (!draftOwners.has(key) && memoryDrafts.get(key) === value.draft);
      if (saved) {
        const nextDraft: Draft = { ...value.draft, fingerprint: saved.fingerprint, content: saved.worktree ?? '', exists: saved.worktreeExists };
        const next = { file: saved, draft: nextDraft, dirty: false };
        latest.current = next;
        if (ownsDraft) retainDraft(key, nextDraft.side ? nextDraft : null);
        if (live.current) { setDocument(next); setUndoChoice(null); setFeedback(text('已保存到工作区，尚未暂存为已解决。', 'Saved to the working tree. The file is still unresolved in the index.')); }
      } else {
        latest.current = null; if (ownsDraft) retainDraft(key, null);
        if (live.current) setFeedback(text('已保存并标记为已解决。', 'Saved and marked as resolved.'));
      }
      // 刷新失败不抹掉刚已确认的保存事实，也不自动重放写入。
      try {
        if (live.current) await props.onSaved({ resolved: markResolved && !saved, snapshot: response.snapshot });
        else notifyProjectGitChanged(props.projectId);
      }
      catch (reason) { if (live.current) { setFeedback(text('冲突结果已保存，但刷新仓库失败。请刷新核对。', 'The resolution was saved, but refreshing the repository failed. Refresh to verify its state.')); setError(reason); } }
    } catch (reason) {
      const failure = userFacingErrorCause(reason);
      if (live.current) { setError(reason); setRequiresReload(true); }
      if (failure.code === 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED' && reason && typeof reason === 'object' && 'operationStage' in reason && reason.operationStage === 'refresh' && (failure.operationStatus === 'completed' || failure.operationStatus === 'conflict')) {
        if (live.current) setFeedback(text('冲突结果已保存，但读取最新仓库状态失败。正在刷新核对，请勿重复保存。', 'The resolution was saved, but reading the latest state failed. Refreshing to verify; do not save again.'));
        try {
          if (live.current) await props.onSaved({ resolved: markResolved });
          else notifyProjectGitChanged(props.projectId);
        } catch { /* 保留原始刷新错误和草稿，不能重放写入。 */ }
      }
    }
    finally { pendingSave.current = false; if (live.current) setBusy(false); }
  }
  async function reload() {
    if (document?.dirty) { setReloadConfirm(true); return; }
    await load(false);
  }
  async function confirmReload() {
    if (document?.dirty) { retainDraft(`${key}.backup`, document.draft); setBackup(document.draft); }
    retainDraft(key, null); setReloadConfirm(false); await load(false);
  }
  function restoreBackup() {
    if (!backup || !document || locked) return;
    const next = { ...document, draft: backup, dirty: true };
    latest.current = next; setDocument(next); retainDraft(key, backup); setBackup(null);
  }
  function navigate(direction: -1 | 1) {
    if (!parsed.blocks.length) return;
    const next = (index + direction + parsed.blocks.length) % parsed.blocks.length;
    setBlockIndex(next); setReveal(current => ({ offset: parsed.blocks[next]!.start, token: current.token + 1 }));
  }
  const editor = (side: Side) => {
    const content = full || !block ? file?.[side] ?? '' : block[side];
    const missing = !file?.indexStages.some(stage => stage.stage === (side === 'current' ? 2 : 3));
    return <section className={`git-conflict-side is-${side}`} aria-label={side === 'current' ? text('当前更改', 'Current changes') : text('传入更改', 'Incoming changes')}>
      <header><strong>{side === 'current' ? text('当前更改', 'Current changes') : text('传入更改', 'Incoming changes')}</strong><small>{side === 'current' ? 'ours · stage 2' : 'theirs · stage 3'}</small></header>
      {missing ? <p className="git-conflict-missing">{text('此侧已删除文件', 'The file is deleted on this side')}</p> : <ConflictTextEditor zh={props.zh} path={props.filePath} label={side === 'current' ? text('当前版本代码', 'Current version code') : text('传入版本代码', 'Incoming version code')} content={content} readOnly regions={content ? [{ start: 0, end: content.length, kind: side }] : []} />}
    </section>;
  };
  return <section className="git-conflict-editor" aria-label={text('合并编辑器', 'Merge editor')} aria-busy={loading || busy}>
    <header className="git-conflict-heading">
      <div><strong title={props.filePath}>{props.filePath}</strong><small>{text('合并编辑器', 'Merge editor')}{document?.dirty ? text(' · 未保存', ' · Unsaved') : ''}</small></div>{props.onExternalMerge ? <button type="button" disabled={locked} onClick={props.onExternalMerge}>{text('使用外部合并工具…', 'Use external merge tool…')}</button> : null}<button type="button" disabled={locked} onClick={() => void reload()}>{text('重新载入', 'Reload')}</button></header>
    {loading ? <p className="git-conflict-placeholder">{text('正在读取工作区及冲突的三个版本…', 'Loading the working tree and three conflict versions…')}</p> : file && editable ? <>
      {stale ? <p className="git-conflict-warning" role="alert">{requiresReload ? text('当前磁盘或暂存状态需要重新核对，本地草稿已保留。请重新载入后再保存。', 'The current disk or index state needs review. Your local draft is preserved. Reload before saving.') : text('文件或索引已在外部变化，本地草稿已保留。请复制草稿或重新载入并核对后再保存。', 'The file or index changed externally. Your local draft is preserved. Copy the draft or reload and review before saving.')}</p> : null}
      <div className="git-conflict-toolbar">
        <strong>{parsed.blocks.length ? text(`冲突 ${index + 1} / ${parsed.blocks.length}`, `Conflict ${index + 1} / ${parsed.blocks.length}`) : text('没有剩余冲突标记', 'No conflict markers remain')}</strong>
        <button type="button" disabled={locked || !parsed.blocks.length} onClick={() => navigate(-1)}>{text('上一处', 'Previous')}</button><button type="button" disabled={locked || !parsed.blocks.length} onClick={() => navigate(1)}>{text('下一处', 'Next')}</button>
        <label><input type="checkbox" checked={full} onChange={event => setFull(event.target.checked)} />{text('显示完整文件', 'Show full files')}</label>
      </div>
      <div className="git-conflict-accept-actions">
        <button type="button" disabled={locked || !block} onClick={() => choose('current')}>{text('接受当前更改', 'Accept current')}</button>
        <button type="button" disabled={locked || !block} onClick={() => choose('incoming')}>{text('接受传入更改', 'Accept incoming')}</button>
        <button type="button" disabled={locked || !block} onClick={() => choose('both')}>{text('接受双方（当前在前）', 'Accept both (current first)')}</button>
        <button type="button" disabled={locked || !undoChoice} onClick={() => { if (undoChoice) { const prior = undoChoice; change(prior.content, prior.side, true, prior.exists); setUndoChoice(null); } }}>{text('撤销上次选择', 'Undo last choice')}</button>
      </div>
      {!parsed.hasMarkers && !draft?.side ? <p className="git-conflict-hint">{text('请核对工作区结果后标记为已解决。当前/传入按 Git 索引阶段显示；变基时“当前”代表目标基线。', 'Review the working tree result before marking it resolved. Current/incoming follow Git index stages; during rebase, current is the target baseline.')}</p> : null}
      {!parsed.blocks.length && (!file.worktreeExists || file.indexStages.some(stage => stage.stage === 2) !== file.indexStages.some(stage => stage.stage === 3)) ? <div className="git-conflict-file-actions"><strong>{text('文件删除冲突：', 'File deletion conflict:')}</strong><button type="button" disabled={locked || !file.canAcceptCurrent} onClick={() => chooseFile('current')}>{text('采用当前版本', 'Use current version')}</button><button type="button" disabled={locked || !file.canAcceptIncoming} onClick={() => chooseFile('incoming')}>{text('采用传入版本', 'Use incoming version')}</button></div> : null}
      <div ref={mergeLayout} className="git-conflict-merge-layout">
        <div className="git-conflict-inputs">
          <div ref={sideLayout} className="git-conflict-sides">{editor('current')}<GitPaneSeparator name="conflict-current" label={text('调整当前与传入版本宽度', 'Resize current and incoming versions')} initial={50} min={paneBounds.columns.min} max={paneBounds.columns.max} />{editor('incoming')}</div>
          {block?.base !== null && block?.base !== undefined ? <details className="git-conflict-base"><summary>{text('查看共同祖先', 'View base')}</summary><pre>{block.base}</pre></details> : null}
        </div>
        <GitPaneSeparator name="conflict-versions" label={text('调整版本对照与合并结果高度', 'Resize version comparison and merge result')} axis="y" initial={42} min={paneBounds.rows.min} max={paneBounds.rows.max} />
      <section className="git-conflict-result" aria-label={text('合并结果', 'Merge result')}><header><strong>{text('合并结果', 'Merge result')}</strong><small>{text('可以直接编辑 · ⌘/Ctrl+S 保存工作区', 'Edit directly · ⌘/Ctrl+S saves the working tree')}</small></header>
        {deleted ? <div className="git-conflict-delete-result"><strong>{deletionUnconfirmed ? text('工作区文件不存在，请明确选择结果', 'The working file is missing. Choose a result explicitly') : text('合并结果：删除此文件', 'Merge result: delete this file')}</strong><p>{deletionUnconfirmed ? text('请选择采用某一侧的版本，或改为保留空文件。不会把缺失文件默认为空文件。', 'Choose a version or keep an empty file. A missing file will not be treated as an empty file.') : text('保存后才删除工作区文件，标记已解决后才更新索引。', 'The working file is deleted only when saved. The index is updated only when marked resolved.')}</p><button type="button" disabled={locked} onClick={() => change('')}>{text('改为保留空文件', 'Keep an empty file instead')}</button></div> : <ConflictTextEditor zh={props.zh} path={props.filePath} label={text('合并结果代码', 'Merge result code')} content={draft?.content ?? ''} readOnly={Boolean(locked)} onChange={value => change(value)} onSave={() => void save(false)} reveal={reveal} regions={parsed.blocks.map(value => ({ start: value.start, end: value.end, kind: 'conflict' }))} />}
      </section>
      </div>
      {parsed.issues.length ? <p className="git-conflict-warning" role="alert">{text(`第 ${parsed.issues[0]!.line} 行的冲突标记不完整。请手动整理后再标记为已解决。`, `Conflict markers at line ${parsed.issues[0]!.line} are incomplete. Edit them before marking the file resolved.`)}</p> : null}
      <footer className="git-conflict-footer"><span>{parsed.blocks.length ? text(`剩余 ${parsed.blocks.length} 处冲突`, `${parsed.blocks.length} conflicts remaining`) : text('核对结果后完成此文件', 'Review the result to complete this file')}</span><button type="button" disabled={locked || stale || deletionUnconfirmed || !document?.dirty} onClick={() => void save(false)}>{text('保存工作区', 'Save working tree')}</button><button type="button" className="git-conflict-complete" disabled={locked || stale || deletionUnconfirmed || !parsed.canComplete} onClick={() => void save(true)}>{text('保存并标记为已解决', 'Save and mark resolved')}</button></footer>
    </> : file ? <div className="git-conflict-unsupported"><h3>{text('此冲突不能在文本编辑器中处理', 'This conflict cannot be resolved in the text editor')}</h3><p>{file.kind === 'binary' ? text('文件包含二进制或非 UTF-8 内容。', 'The file contains binary or non-UTF-8 content.') : file.kind === 'gitlink' ? text('此项是子模块引用冲突。', 'This is a submodule reference conflict.') : file.kind === 'symlink' ? text('此项是符号链接冲突。', 'This is a symbolic link conflict.') : file.kind === 'too_large' ? text('文件超出内置编辑器的大小限制。', 'The file exceeds the built-in editor size limit.') : text('此文件类型不支持内置文本合并。', 'This file type does not support built-in text merging.')}</p><p>{text('请在外部工具中处理并暂存，完成后重新载入仓库。不会用文本覆盖此文件。', 'Resolve and stage it in an external tool, then reload the repository. This file will not be overwritten with text.')}</p></div> : null}
    {error ? <div className="git-conflict-error" role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
    {feedback ? <p className="git-conflict-feedback" role="status">{feedback}</p> : null}
    {storageFailed ? <p className="git-conflict-warning" role="alert">{text('本地草稿存储不可用，请保持页面打开并及时保存或复制结果。', 'Local draft storage is unavailable. Keep this page open and save or copy the result.')}</p> : null}
    {backup && file ? <button type="button" className="git-conflict-restore" disabled={locked} onClick={restoreBackup}>{text('恢复上次重新载入前的草稿', 'Restore the draft from before reload')}</button> : null}
    {reloadConfirm ? <ModalPortal role="dialog" aria-label={text('重新载入冲突文件', 'Reload conflict file')} rootClassName="git-conflict-reload-root" onDismiss={() => setReloadConfirm(false)}><section className="git-conflict-reload"><h3>{text('重新载入冲突文件？', 'Reload this conflict file?')}</h3><p>{text('当前未保存结果会保留为本地备份，随后重新读取磁盘和索引。', 'The unsaved result will be kept as a local backup before the file and index are reloaded.')}</p><footer><button type="button" onClick={() => setReloadConfirm(false)}>{text('取消', 'Cancel')}</button><button type="button" onClick={() => void confirmReload()}>{text('保留备份并重新载入', 'Back up and reload')}</button></footer></section></ModalPortal> : null}
  </section>;
}
