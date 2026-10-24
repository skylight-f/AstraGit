import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardClient, GitDiffSummary, GitLineChange, GitLineDiffPreview, ProjectGitAction } from '../apiClient.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { SideBySideDiff, type GitDiffLineControls } from './ProjectGitDiffViewer.js';
import { GitContextMenu } from './GitContextMenu.js';
import { selectGitFilePaths } from './gitFileSelection.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitLineChanges.css';

export function GitLineChanges(props: {
  client: Pick<DashboardClient, 'loadProjectGitLineDiff'>; projectId: string; repositoryId: string; path: string; stage: 'staged' | 'unstaged';
  fallback: GitDiffSummary | null; revision?: string; zh: boolean; busy: boolean;
  onExecute(action: ProjectGitAction, label: string): Promise<ExecutionOutcome>;
  onConfirm(action: ProjectGitAction, title: string, description: string): void;
}) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const identity = JSON.stringify([props.projectId, props.repositoryId, props.path, props.stage]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const [loaded, setLoaded] = useState<{ identity: string; preview: GitLineDiffPreview } | null>(null);
  const [selection, setSelection] = useState<{ version: string; selectedPaths: string[]; anchor: string | null } | null>(null);
  const [request, setRequest] = useState<{ identity: string; error: unknown; loading: boolean }>({ identity, error: null, loading: true });
  const [revision, setRevision] = useState(0); const [pending, setPending] = useState(false); const gate = useRef(false); const alive = useRef(true);
  const [menu, setMenu] = useState<{ x: number; y: number; keys: string[]; version: string } | null>(null);
  const preview = loaded?.identity === identity ? loaded.preview : null;
  const state = request.identity === identity ? request : { identity, loading: true, error: null };
  const file = preview?.diff.fileDiffs[0];
  const allKeys = useMemo(() => file?.hunks.flatMap((hunk, hunkIndex) => hunk.lines.flatMap((line, index) => ['addition', 'deletion'].includes(line.type) ? [`${hunkIndex}:${index}`] : [])) ?? [], [file]);
  const selected = selection && preview && selection.version === preview.fingerprint ? selection.selectedPaths : [];
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // Keep keyboard focus/selection during background reads. Every write still
  // carries this displayed version and is revalidated by the native service.
  const disabled = props.busy || pending || Boolean(state.error) || !preview || Boolean(preview.readOnlyReason);
  const version = preview?.fingerprint ?? '';
  useEffect(() => {
    const controller = new AbortController(); setRequest({ identity, error: null, loading: true });
    void props.client.loadProjectGitLineDiff(props.projectId, props.repositoryId, { path: props.path, stage: props.stage }, controller.signal).then(value => {
      if (!controller.signal.aborted && currentIdentity.current === identity) { setLoaded({ identity, preview: value }); setRequest({ identity, error: null, loading: false }); }
    }).catch(error => { if (!controller.signal.aborted && currentIdentity.current === identity) setRequest({ identity, error: gate.current ? null : error, loading: false }); });
    return () => controller.abort();
  }, [props.client, props.projectId, props.repositoryId, props.path, props.stage, props.revision, identity, revision]);
  useEffect(() => { setMenu(null); }, [identity, version]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function action(operation: GitLineChange['operation'], keys: string[]): ProjectGitAction | null {
    if (!preview || disabled || !keys.length) return null;
    const picked = new Set(keys);
    const selection = file?.hunks.flatMap((hunk, index) => { const lines = hunk.lines.flatMap((line, lineIndex) => ['addition', 'deletion'].includes(line.type) && picked.has(`${index}:${lineIndex}`) ? [lineIndex] : []); return lines.length ? [{ hunk: index, lines }] : []; }) ?? [];
    return selection.length ? { type: 'apply_line_changes', input: { path: props.path, stage: props.stage, expectedFingerprint: preview.fingerprint, selection, operation } } : null;
  }
  async function execute(operation: 'stage' | 'unstage', keys: string[]) {
    const value = action(operation, keys); if (!value || gate.current) return;
    gate.current = true; setPending(true); const owner = identity;
    try { const outcome = await props.onExecute(value, operation === 'stage' ? text('暂存所选行', 'Stage selected lines') : text('取消暂存所选行', 'Unstage selected lines')); if (alive.current && currentIdentity.current === owner && outcome === 'completed') { setSelection(null); setRevision(value => value + 1); } }
    catch (error) { if (alive.current && currentIdentity.current === owner) setRequest({ identity, error, loading: false }); }
    finally { gate.current = false; if (alive.current) setPending(false); }
  }
  function discard(keys: string[]) {
    const value = action('discard', keys); if (!value) return;
    const all = keys.length === allKeys.length;
    const extra = file?.changeType === 'added' && all ? text('所选内容覆盖全部新增行，未跟踪文件将被删除。', 'The selection covers every added line; the untracked file will be deleted.')
      : file?.changeType === 'deleted' ? text('文件已删除，将恢复所选行。', 'The file is deleted; selected lines will be restored.') : '';
    props.onConfirm(value, text('放弃所选行', 'Discard selected lines'), text(`将放弃“${props.path}”中选择的 ${keys.length} 条增删行，保留其他未选更改。${extra}`, `Discard ${keys.length} selected changed lines in “${props.path}”, retaining other changes. ${extra}`));
  }
  const primary = props.stage === 'staged' ? 'unstage' : 'stage';
  const controls: GitDiffLineControls = {
    selected: selectedSet, disabled,
    onSelect(hunk, line, event, order) { if (disabled) return; const clickedPath = `${hunk}:${line}`; setSelection(current => ({ version, ...selectGitFilePaths({ orderedPaths: order, selectedPaths: current?.version === version ? current.selectedPaths : [], anchor: current?.version === version ? current.anchor : null, clickedPath, range: event.shiftKey, additive: event.ctrlKey || event.metaKey }) })); },
    onContextMenu(event, hunk, line) { if (disabled) return; const key = `${hunk}:${line}`; const keys = selectedSet.has(key) ? selected : [key]; if (!selectedSet.has(key)) setSelection({ version, selectedPaths: keys, anchor: key }); setMenu({ x: event.clientX, y: event.clientY, keys, version }); },
    onSelectAll() { if (!disabled) setSelection({ version, selectedPaths: allKeys, anchor: allKeys[0] ?? null }); },
    onClear() { setSelection(null); },
  };
  const messages = {
    filter: text('文件使用 Git filter（如 LFS），请使用整文件操作。', 'This file uses a Git filter (such as LFS). Use whole-file actions.'),
    binary: text('二进制差异请使用整文件操作或外部工具。', 'Use whole-file actions or external tools for binary changes.'),
    'file-type': text('符号链接、子模块及非普通文件请使用整文件操作。', 'Use whole-file actions for symlinks, submodules and other file types.'),
    metadata: text('只有文件模式或空文件元数据变化，请使用整文件操作。', 'Only file mode or empty-file metadata changed. Use whole-file actions.'),
  };
  const toolbar = <div className="git-lines-toolbar" aria-busy={state.loading || pending}>
    <span role="status">{preview?.readOnlyReason ? messages[preview.readOnlyReason] : !preview && state.loading ? text('正在读取当前文件差异…', 'Reading current file diff…') : text(`已选择 ${selected.length} 条增删行`, `${selected.length} changed lines selected`)}</span>
    <button type="button" disabled={disabled || !allKeys.length} onClick={controls.onSelectAll}>{text('全选更改行', 'Select changed lines')}</button>
    <button type="button" disabled={!selected.length || pending} onClick={controls.onClear}>{text('清除', 'Clear')}</button>
    <button type="button" disabled={disabled || !selected.length} onClick={() => void execute(primary, selected)}>{props.stage === 'staged' ? text('取消暂存所选行', 'Unstage selected lines') : text('暂存所选行', 'Stage selected lines')}</button>
    {props.stage === 'unstaged' ? <button type="button" data-danger disabled={disabled || !selected.length} onClick={() => discard(selected)}>{text('放弃所选行…', 'Discard selected lines…')}</button> : null}
    <small>{text('点击行号；Shift 连选，Ctrl/⌘ 多选；右键操作。', 'Click line numbers; Shift for range, Ctrl/⌘ to toggle; right-click for actions.')}</small>
  </div>;
  const shown = preview ? preview.readOnlyReason && !file ? props.fallback : preview.diff : props.fallback;
  const hunkKeys = (index: number) => allKeys.filter(key => key.startsWith(`${index}:`));
  return <div className="git-line-changes">
    <SideBySideDiff diff={shown} zh={props.zh} title={props.path} fill toolbar={toolbar} lineControls={preview?.readOnlyReason ? undefined : controls} partitionHunks hunkActionsDisabled={disabled}
      emptyMessage={state.error ? text('当前文件差异未能完整读取。', 'The current file diff could not be read completely.') : preview?.readOnlyReason ? messages[preview.readOnlyReason] : state.loading ? text('正在读取当前文件差异…', 'Reading current file diff…') : text('当前文件没有可操作的文本更改。', 'No actionable text changes in the current file.')}
      onHunkAction={preview && !preview.readOnlyReason && file?.hunks.length ? (_, _hunk, index) => void execute(primary, hunkKeys(index)) : undefined}
      hunkActionLabel={props.stage === 'staged' ? text('取消暂存区块', 'Unstage hunk') : text('暂存区块', 'Stage hunk')}
      onHunkDiscard={preview && !preview.readOnlyReason && props.stage === 'unstaged' && file?.hunks.length ? (_, _hunk, index) => discard(hunkKeys(index)) : undefined} hunkDiscardLabel={text('放弃区块…', 'Discard hunk…')} />
    {state.error ? <div className="git-lines-error" role="alert"><VisibleApplicationError error={state.error} language={props.zh ? 'zh-CN' : 'en'} /><button type="button" onClick={() => setRevision(value => value + 1)}>{text('重新读取差异', 'Reload diff')}</button></div> : null}
    {menu ? <GitContextMenu x={menu.x} y={menu.y} title={text(`已选择 ${menu.keys.length} 条增删行`, `${menu.keys.length} changed lines selected`)} onClose={() => setMenu(null)} onError={error => setRequest({ identity, error, loading: false })} items={[
      { label: primary === 'stage' ? text('暂存所选行', 'Stage selected lines') : text('取消暂存所选行', 'Unstage selected lines'), disabled: disabled || menu.version !== version, run: () => execute(primary, menu.keys) },
      ...(props.stage === 'unstaged' ? [{ label: text('放弃所选行…', 'Discard selected lines…'), danger: true, disabled: disabled || menu.version !== version, run: () => discard(menu.keys) }] : []),
      { label: text('全选更改行', 'Select changed lines'), disabled, run: controls.onSelectAll }, { label: text('清除选择', 'Clear selection'), run: controls.onClear },
    ]} /> : null}
  </div>;
}
