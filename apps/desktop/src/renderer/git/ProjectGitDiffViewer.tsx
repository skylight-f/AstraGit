import { GitExternalToolDialog, type GitExternalToolRequest } from './GitExternalToolDialog.js';
import { notifyProjectGitChanged } from './projectGitWorkbenchState.js';
import { ColumnsIcon as Columns } from '@phosphor-icons/react/dist/csr/Columns';
import { FileIcon as File } from '@phosphor-icons/react/dist/csr/File';
import { RowsIcon as Rows } from '@phosphor-icons/react/dist/csr/Rows';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import type { DashboardClient, GitDiffHunk, GitDiffSummary, GitFileDiff } from '../apiClient.js';
import { alignedDiffRows, type DiffCell } from './gitDiffRows.js';
import { useApplicationErrorDialog, VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { gitDiffFileVersions, gitDiffUnavailableMessage } from './gitDiffFeedback.js';

import '../styles.css';
import '../ui/primitives.css';
import '../agentdesk-theme.css';
import './gitTextDiff.css';

type DiffViewMode = 'side-by-side' | 'unified';

interface SideBySideDiffProps {
  emptyMessage?: string;
  toolbar?: ReactNode;
  lineControls?: GitDiffLineControls;
  previewRequest?: unknown;
  revision?: string | number;
  diff: GitDiffSummary | null;
  zh: boolean;
  title?: string;
  fill?: boolean;
  partitionHunks?: boolean;
  hunkActionsDisabled?: boolean;
  onHunkAction?: (file: GitFileDiff, hunk: GitDiffHunk, index: number) => void;
  hunkActionLabel?: string;
  onHunkDiscard?: (file: GitFileDiff, hunk: GitDiffHunk, index: number) => void;
  hunkDiscardLabel?: string;
}

export interface GitDiffLineControls {
  selected: ReadonlySet<string>;
  disabled: boolean;
  onSelect(hunk: number, line: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, order: string[]): void;
  onContextMenu(event: ReactMouseEvent, hunk: number, line: number): void;
  onSelectAll(): void;
  onClear(): void;
}

export function ProjectGitDiffWindow(props: {
  client: Pick<DashboardClient, 'loadProjectGitWorkbench' | 'loadProjectGitCommit' | 'loadProjectGitComparisonDiff' | 'loadProjectGitRevisionsDiff' | 'loadRepositoryGitExternalTools' | 'previewRepositoryGitExternalTool' | 'executeProjectGitAction' | 'cancelProjectGitAction'>;
  projectId: string;
  repositoryId: string;
  filePath: string;
  stage: 'combined' | 'staged' | 'unstaged';
  commitHash?: string;
  comparisonRef?: string;
  comparisonMode?: 'current' | 'working-tree';
  revisions?: [string, string];
  language: 'zh-CN' | 'en-US';
  appearance?: 'light' | 'dark' | 'system';
}) {
  const zh = props.language === 'zh-CN';
  const appearance = props.appearance ?? 'system';
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [title, setTitle] = useState(props.filePath || (zh ? 'Git 差异' : 'Git diff'));
  const [selectedPath, setSelectedPath] = useState(props.filePath);
  const [error, setError] = useState<unknown>(null);
  const [readRevision, setReadRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [comparedRevisions, setComparedRevisions] = useState<[string, string] | null>(null);
  const [external, setExternal] = useState<GitExternalToolRequest | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalLoading, setExternalLoading] = useState(false);
  const externalAlive = useRef(true);
  useEffect(() => { externalAlive.current = true; return () => { externalAlive.current = false; }; }, []);
  const fileLayout = useRef<HTMLDivElement>(null);
  const [filePaneBounds, setFilePaneBounds] = useState({ min: 15, max: 55 });
  useApplicationErrorDialog(error, { language: zh ? 'zh-CN' : 'en' });

  useLayoutEffect(() => {
    const layout = fileLayout.current;
    if (!layout) return;
    const measure = () => {
      const width = layout.getBoundingClientRect().width;
      if (width <= 0) return;
      // 正常窗口至少保留 160px 文件列表和 280px 差异；不足时两侧均分。
      const equal = Math.max(0, width - 6) / width * 50;
      const next = width < 446
        ? { min: equal, max: equal }
        : { min: Math.max(15, 160 / width * 100), max: Math.min(55, (width - 286) / width * 100) };
      setFilePaneBounds(current => Math.abs(current.min - next.min) < 0.1 && Math.abs(current.max - next.max) < 0.1 ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    measure();
    return () => observer.disconnect();
  }, [diff?.files.length, loading, Boolean(error)]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    setComparedRevisions(null);
    const request = props.revisions
      ? props.client.loadProjectGitRevisionsDiff(props.projectId, props.repositoryId, props.revisions, controller.signal).then(comparison => ({ diff: comparison.diff, title: `${comparison.revisions[0].slice(0, 8)} → ${comparison.revisions[1].slice(0, 8)}`, revisions: comparison.revisions }))
      : props.commitHash
      ? props.client.loadProjectGitCommit(props.projectId, props.repositoryId, props.commitHash).then(detail => ({ diff: detail.diff, title: detail.commit.subject }))
      : props.comparisonRef
        ? props.client.loadProjectGitComparisonDiff(props.projectId, props.repositoryId, props.comparisonRef, props.comparisonMode ?? 'current').then(summary => ({ diff: summary, title: `${props.comparisonRef} · ${zh ? '分支差异' : 'Branch diff'}` }))
        : props.client.loadProjectGitWorkbench(props.projectId).then((workbench) => {
            const repository = workbench.repositories.find((candidate) => candidate.id === props.repositoryId);
            if (!repository) throw new Error(zh ? '仓库已不在当前项目中。' : 'The repository is no longer part of this project.');
            const source = props.stage === 'staged' ? repository.snapshot.stagedDiff : props.stage === 'unstaged' ? repository.snapshot.unstagedDiff : repository.snapshot.diff;
            return { diff: source, title: repository.name };
          });
    void request
      .then((result) => {
        if (cancelled) return;
        setTitle(result.title);
        setDiff(result.diff);
        setComparedRevisions('revisions' in result ? result.revisions as [string, string] : null);
        setSelectedPath(props.filePath || result.diff.files[0] || '');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason);
      }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [props.projectId, props.repositoryId, props.filePath, props.stage, props.commitHash, props.comparisonRef, props.comparisonMode, props.revisions?.[0], props.revisions?.[1], props.client, zh, readRevision]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = selectedPath ? `${title} · ${selectedPath}` : title;
    return () => { document.title = previousTitle; };
  }, [selectedPath, title]);

  const selectedDiff = useMemo(() => (diff && selectedPath ? { ...diff, files: [selectedPath], fileDiffs: diff.fileDiffs.filter((file) => file.newPath === selectedPath || file.oldPath === selectedPath) } : diff), [diff, selectedPath]);

  async function openExternal() {
    if (!selectedPath || loading || externalBusy || externalLoading) return;
    setExternalLoading(true);
    try {
      const workbench = await props.client.loadProjectGitWorkbench(props.projectId);
      const repository = workbench.repositories.find(item => item.id === props.repositoryId);
      if (!repository) throw new Error(zh ? '仓库已不在当前项目中。' : 'The repository is no longer part of this project.');
      if (externalAlive.current) setExternal({ repository, input: { mode: 'diff', paths: [selectedPath], ...(comparedRevisions ? { revisions: comparedRevisions } : { stage: props.stage, ...(props.commitHash ? { commitHash: props.commitHash } : {}), ...(props.comparisonRef ? { comparisonRef: props.comparisonRef, comparisonMode: props.comparisonMode ?? 'current' } : {}) }) } });
    } catch (reason) { if (externalAlive.current) setError(reason); }
    finally { if (externalAlive.current) setExternalLoading(false); }
  }
  return (
    <main className={`macos-ai-app zeus-shell theme-${appearance} project-git-diff-window`} aria-label={zh ? 'Git 差异窗口' : 'Git diff window'}>
      <div className="project-git-diff-external-actions"><button type="button" disabled={loading || externalBusy || externalLoading} onClick={() => setReadRevision(value => value + 1)}>{zh ? '重新载入' : 'Reload'}</button><button type="button" disabled={loading || !selectedPath || externalBusy || externalLoading || Boolean(props.revisions && !comparedRevisions)} onClick={() => void openExternal()}>{zh ? '使用外部工具比较…' : 'Compare with external tool…'}</button></div>
      {comparedRevisions ? <p className="project-git-diff-parent" title={comparedRevisions.join(' → ')}>{zh ? '所选提交总差异' : 'Selected commit comparison'} · {comparedRevisions[0].slice(0, 8)} → {comparedRevisions[1].slice(0, 8)}</p> : null}
      {external ? <GitExternalToolDialog request={external} projectId={props.projectId} client={props.client} zh={zh} busy={externalBusy} onClose={() => setExternal(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.projectId, props.repositoryId); }} onExecute={async (repository, action) => {
        setExternalBusy(true);
        try { const result = await props.client.executeProjectGitAction(props.projectId, repository.id, action); return { outcome: result.result.outcome }; }
        catch (error) { return { outcome: null, error }; }
        finally { if (externalAlive.current) setExternalBusy(false); notifyProjectGitChanged(props.projectId); }
      }} /> : null}
      {diff && !error && !loading ? (
        diff.files.length > 1 ? (
          <div ref={fileLayout} className="project-git-diff-window-layout has-resizable-files">
            <aside className="project-git-diff-window-files" aria-label={zh ? '变更文件' : 'Changed files'}>
              <header>
                <strong>{title}</strong>
                <small>
                  {diff.files.length} {zh ? '个文件' : 'files'}
                </small>
              </header>
              <div>
                {diff.files.map((path) => {
                  const file = diff.fileDiffs.find(file => (file.newPath || file.oldPath) === path);
                  return (
                    <button key={path} type="button" className={path === selectedPath ? 'is-current' : ''} onClick={() => setSelectedPath(path)}>
                      <File aria-hidden="true" />
                      <span title={path}>{path}</span>
                      {file ? <><em>+{file.addedLines}</em><i>-{file.deletedLines}</i></> : null}
                    </button>
                  );
                })}
              </div>
            </aside>
            <GitPaneSeparator name="diff-window-files" label={zh ? '调整差异窗口文件列表宽度' : 'Resize diff window file list'} initial={24} min={filePaneBounds.min} max={filePaneBounds.max} />
            <SideBySideDiff diff={selectedDiff} zh={zh} title={selectedPath || title} fill />
          </div>
        ) : (
          <SideBySideDiff diff={selectedDiff} zh={zh} title={selectedPath || title} fill />
        )
      ) : (
        <p className="project-git-diff-loading">{error ? <VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} /> : zh ? '正在读取差异…' : 'Loading diff…'}</p>
      )}
    </main>
  );
}

/** 工作台、项目提交及独立窗口共用结构化差异与区块操作。 */
export function SideBySideDiff(props: SideBySideDiffProps) {
  const [mode, setMode] = useState<DiffViewMode>('side-by-side');
  const [stage, setStage] = useState<NonNullable<GitFileDiff['stage']>>('unstaged');
  const columns = useRef<HTMLDivElement>(null);
  const hunks = useRef<HTMLDivElement>(null);
  const [columnBounds, setColumnBounds] = useState({ min: 15, max: 85 });
  const { file, versions } = gitDiffFileVersions(props.diff, stage);
  const multipleVersions = versions.length > 1 && versions.every(version => version.stage);
  const stageNames = { staged: props.zh ? '已暂存' : 'Staged', unstaged: props.zh ? '未暂存' : 'Unstaged', untracked: props.zh ? '未跟踪' : 'Untracked' };
  const versionControl = multipleVersions ? <select className="project-git-diff-stage" aria-label={props.zh ? '差异版本范围' : 'Diff version scope'} value={file?.stage} onChange={event => setStage(event.target.value as NonNullable<GitFileDiff['stage']>)}>{versions.map(version => <option key={version.stage} value={version.stage}>{stageNames[version.stage!]}</option>)}</select> : null;
  const order = useMemo(() => file?.hunks.flatMap((hunk, hunkIndex) => mode === 'unified'
    ? hunk.lines.flatMap((line, index) => ['addition', 'deletion'].includes(line.type) ? [`${hunkIndex}:${index}`] : [])
    : alignedDiffRows(hunk).flatMap(row => [row.left, row.right].flatMap(cell => ['addition', 'deletion'].includes(cell.kind) && cell.lineIndex !== undefined ? [`${hunkIndex}:${cell.lineIndex}`] : []))) ?? [], [file, mode]);
  useLayoutEffect(() => {
    const layout = columns.current;
    const content = hunks.current;
    if (!layout || !content) return;
    // 给滚动条单独留出宽度，让表头、所有区块和唯一的分隔条使用相同的列尺寸。
    const measure = () => {
      layout.style.setProperty('--git-diff-scrollbar', `${mode === 'side-by-side' ? Math.max(0, content.offsetWidth - content.clientWidth) : 0}px`);
      const width = layout.getBoundingClientRect().width;
      if (width <= 0) return;
      const sideMinimum = Math.min(120, Math.max(0, (width - 6) / 2));
      const next = { min: Math.max(15, sideMinimum / width * 100), max: Math.min(85, (width - sideMinimum - 6) / width * 100) };
      setColumnBounds(current => Math.abs(current.min - next.min) < 0.1 && Math.abs(current.max - next.max) < 0.1 ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [file, mode]);
  if (props.diff?.unavailableReason) return <section className="project-git-diff-preview is-fill"><header><strong title={props.title}>{props.title ?? (props.zh ? '文件差异' : 'File diff')}</strong></header>{props.toolbar}<p className="project-git-empty-copy" role="status">{gitDiffUnavailableMessage(props.diff.unavailableReason, props.zh)}</p>{props.diff.readError ? <p className="project-git-empty-copy"><VisibleApplicationError error={props.diff.readError} language={props.zh ? 'zh-CN' : 'en'} /></p> : null}</section>;
  if (!file) {
    const message = props.emptyMessage ?? (props.diff && !props.diff.files.length ? (props.zh ? '所选范围没有文件差异。' : 'The selected scope has no file differences.') : (props.zh ? '选择一个文件查看差异。' : 'Select a file to inspect its diff.'));
    return props.toolbar ? <section className="project-git-diff-preview is-fill"><header><strong title={props.title}>{props.title}</strong></header>{props.toolbar}<p className="project-git-empty-copy">{message}</p></section> : <p className="project-git-empty-copy">{message}</p>;
  }
  if (file.hunks.length === 0) {
    return <section className={`project-git-diff-preview${props.fill ? ' is-fill' : ''}`}><header><strong title={props.title ?? (file.newPath || file.oldPath)}>{props.title ?? (file.newPath || file.oldPath)}</strong>{versionControl}</header>{props.toolbar}<p className="project-git-empty-copy">{props.emptyMessage ?? fileDiffEmptyMessage(file, props.zh)}</p></section>;
  }
  const oldPath = file.changeType === 'added' ? (props.zh ? '变更前（空文件）' : 'Before (empty file)') : file.oldPath;
  const newPath = file.changeType === 'deleted' ? (props.zh ? '变更后（空文件）' : 'After (empty file)') : file.newPath;
  return (
    <section className={`project-git-diff-preview${props.fill ? ' is-fill' : ''}`} aria-label={props.zh ? '文件差异' : 'File diff'}>
      <header>
        <strong title={props.title ?? (file.newPath || file.oldPath)}>{props.title ?? (file.newPath || file.oldPath)}</strong>
        <span>+{file.addedLines}</span>
        <em>-{file.deletedLines}</em>
        {versionControl}
        <span className="project-git-diff-mode" aria-label={props.zh ? '差异布局' : 'Diff layout'}>
          <button type="button" className={mode === 'side-by-side' ? 'is-active' : ''} aria-pressed={mode === 'side-by-side'} onClick={() => setMode('side-by-side')} title={props.zh ? '左右两栏' : 'Side-by-side'}>
            <Columns aria-hidden="true" />
          </button>
          <button type="button" className={mode === 'unified' ? 'is-active' : ''} aria-pressed={mode === 'unified'} onClick={() => setMode('unified')} title={props.zh ? '统一视图' : 'Unified'}>
            <Rows aria-hidden="true" />
          </button>
        </span>
      </header>
      {props.diff?.comparisonParent ? <p className="project-git-diff-parent">{props.zh ? '合并提交 · 相对父提交' : 'Merge commit · Compared with parent'} <code title={props.diff.comparisonParent}>{props.diff.comparisonParent.slice(0, 8)}</code></p> : null}
      {props.toolbar}
      <div ref={columns} className="project-git-diff-side-by-side">
        {mode === 'side-by-side' ? (
          <div className="project-git-diff-side-head">
            <span title={oldPath}>{oldPath}</span>
            <span title={newPath}>{newPath}</span>
          </div>
        ) : null}
        <div ref={hunks} className="project-git-diff-hunks" aria-label={props.zh ? '差异区块' : 'Diff hunks'}>
          {file.hunks.map((hunk, index) => (
            <TextHunkSection
              key={`${hunk.header}:${index}`}
              file={file}
              hunk={hunk}
              index={index}
              unified={mode === 'unified'}
              zh={props.zh}
              actionsDisabled={multipleVersions || props.hunkActionsDisabled === true}
              onAction={props.partitionHunks && !multipleVersions ? props.onHunkAction : undefined}
              actionLabel={props.hunkActionLabel}
              onDiscard={props.partitionHunks && !multipleVersions ? props.onHunkDiscard : undefined}
              discardLabel={props.hunkDiscardLabel}
              lineControls={multipleVersions ? undefined : props.lineControls}
              order={order}
            />
          ))}
        </div>
        {mode === 'side-by-side' ? <GitPaneSeparator name="diff-columns" label={props.zh ? '调整变更前后差异列宽度' : 'Resize before and after diff columns'} initial={50} min={columnBounds.min} max={columnBounds.max} /> : null}
      </div>
    </section>
  );
}

function TextHunkSection(props: {
  file: GitFileDiff;
  hunk: GitDiffHunk;
  index: number;
  unified: boolean;
  zh: boolean;
  actionsDisabled: boolean;
  onAction?: (file: GitFileDiff, hunk: GitDiffHunk, index: number) => void;
  actionLabel?: string;
  onDiscard?: (file: GitFileDiff, hunk: GitDiffHunk, index: number) => void;
  discardLabel?: string;
  lineControls?: GitDiffLineControls;
  order: string[];
}) {
  const oldRange = formatHunkRange(props.hunk.oldStart, props.hunk.oldLines, props.zh);
  const newRange = formatHunkRange(props.hunk.newStart, props.hunk.newLines, props.zh);
  const range = props.zh ? `原始行 ${oldRange} → 新行 ${newRange}` : `Old ${oldRange} → new ${newRange}`;
  return (
    <section className="project-git-diff-hunk" aria-label={`${props.zh ? '区块' : 'Hunk'} ${props.index + 1}`}>
      <header className="project-git-diff-hunk-header">
        <span>
          <strong>
            {props.zh ? '区块' : 'Hunk'} {props.index + 1}
          </strong>
          <small title={props.hunk.header}>{range}</small>
        </span>
        {props.onAction || props.onDiscard ? (
          <span className="project-git-diff-hunk-commands">
            {props.onAction ? (
              <button type="button" disabled={props.actionsDisabled} onClick={() => props.onAction?.(props.file, props.hunk, props.index)}>
                {props.actionLabel ?? (props.zh ? '应用区块' : 'Apply hunk')}
              </button>
            ) : null}
            {props.onDiscard ? (
              <button type="button" className="is-danger" disabled={props.actionsDisabled} onClick={() => props.onDiscard?.(props.file, props.hunk, props.index)}>
                {props.discardLabel ?? (props.zh ? '放弃区块' : 'Discard hunk')}
              </button>
            ) : null}
          </span>
        ) : null}
      </header>
      <TextHunkDiff hunk={props.hunk} unified={props.unified} zh={props.zh} lineControls={props.lineControls} hunkIndex={props.index} order={props.order} />
    </section>
  );
}

function TextHunkDiff(props: { hunk: GitDiffHunk; unified: boolean; zh: boolean; lineControls?: GitDiffLineControls; hunkIndex: number; order: string[] }) {
  const rows = useMemo(() => alignedDiffRows(props.hunk), [props.hunk]);
  const highlightedLines = useMemo(() => ({
    left: new Map(rows.flatMap((row) => row.left.number !== null && row.left.highlight ? [[row.left.number, row.left.highlight] as const] : [])),
    right: new Map(rows.flatMap((row) => row.right.number !== null && row.right.highlight ? [[row.right.number, row.right.highlight] as const] : [])),
  }), [rows]);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  return (
    <div className={`project-git-diff-hunk-body astragit-text-diff${props.unified ? ' is-unified' : ''}`}>
      {props.unified ? (
        <div className="astragit-diff-pane" role="region" tabIndex={0} aria-label={props.zh ? '统一差异' : 'Unified diff'}>
          <div className="astragit-diff-lines">
            {props.hunk.lines.map((line, index) => {
              const cell: DiffCell = { lineIndex: index, content: line.content, number: line.oldLineNumber, kind: line.type };
              cell.highlight = line.type === 'deletion' && line.oldLineNumber !== null
                ? highlightedLines.left.get(line.oldLineNumber)
                : line.type === 'addition' && line.newLineNumber !== null ? highlightedLines.right.get(line.newLineNumber) : undefined;
              return <TextDiffLine key={index} cell={cell} unified newNumber={line.newLineNumber} controls={props.lineControls} hunkIndex={props.hunkIndex} order={props.order} zh={props.zh} />;
            })}
          </div>
        </div>
      ) : (['left', 'right'] as const).map((side) => (
        <div
          key={side}
          ref={side === 'left' ? left : right}
          className={`astragit-diff-pane is-${side}`}
          role="region"
          tabIndex={0}
          aria-label={side === 'left' ? (props.zh ? '变更前' : 'Before changes') : (props.zh ? '变更后' : 'After changes')}
          onScroll={(event) => {
            const other = side === 'left' ? right.current : left.current;
            if (other && other.scrollTop !== event.currentTarget.scrollTop) other.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div className="astragit-diff-lines">
            {rows.map((row, index) => <TextDiffLine key={index} cell={row[side]} controls={props.lineControls} hunkIndex={props.hunkIndex} order={props.order} zh={props.zh} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TextDiffLine(props: { cell: DiffCell; unified?: boolean; newNumber?: number | null; controls?: GitDiffLineControls; hunkIndex: number; order: string[]; zh: boolean }) {
  const { cell } = props;
  const key = `${props.hunkIndex}:${cell.lineIndex}`;
  const selectable = Boolean(props.controls && cell.lineIndex !== undefined && ['addition', 'deletion'].includes(cell.kind));
  const number = cell.number ?? props.newNumber;
  const numberButton = selectable ? <button type="button" className="astragit-diff-line-number git-line-select" data-line-key={key} disabled={props.controls!.disabled} aria-pressed={props.controls!.selected.has(key)} aria-label={`${props.zh ? '选择' : 'Select'} ${cell.kind === 'addition' ? '+' : '−'} ${number}`} onClick={event => props.controls!.onSelect(props.hunkIndex, cell.lineIndex!, event, props.order)} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); event.stopPropagation(); props.controls!.onSelectAll(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.controls!.onClear(); }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const next = props.order[props.order.indexOf(key) + (event.key === 'ArrowUp' ? -1 : 1)]; if (!next) return;
          event.preventDefault(); const [hunk, line] = next.split(':').map(Number); event.currentTarget.closest('.project-git-diff-preview')?.querySelector<HTMLButtonElement>(`[data-line-key="${next}"]`)?.focus();
          if (event.shiftKey && !props.controls!.selected.size) props.controls!.onSelect(props.hunkIndex, cell.lineIndex!, { shiftKey: false, ctrlKey: false, metaKey: false }, props.order);
          if (!event.ctrlKey && !event.metaKey) props.controls!.onSelect(hunk!, line!, event, props.order);
        }
      }}>{number}</button> : null;
  return (
    <div className={`astragit-diff-line is-${cell.kind}`} data-line-selected={selectable && props.controls?.selected.has(key) || undefined} onContextMenu={event => { if (selectable && !props.controls!.disabled) { event.preventDefault(); event.stopPropagation(); props.controls!.onContextMenu(event, props.hunkIndex, cell.lineIndex!); } }}>
      {selectable && (!props.unified || cell.kind === 'deletion') ? numberButton : <span className="astragit-diff-line-number" aria-hidden="true">{cell.number}</span>}
      {props.unified ? selectable && cell.kind === 'addition' ? numberButton : <span className="astragit-diff-line-number" aria-hidden="true">{props.newNumber}</span> : null}
      <span className="astragit-diff-line-sign" aria-hidden="true">{cell.kind === 'addition' ? '+' : cell.kind === 'deletion' ? '−' : ' '}</span>
      <code>{cell.highlight ? <>{cell.highlight.before}<mark>{cell.highlight.changed}</mark>{cell.highlight.after}</> : cell.content}</code>
    </div>
  );
}

function formatHunkRange(start: number, lines: number, zh: boolean): string {
  if (lines === 0) return zh ? '空' : 'empty';
  return lines === 1 ? String(start) : `${start}–${start + lines - 1}`;
}

function fileDiffEmptyMessage(file: { changeType: string; oldPath: string; newPath: string; isBinary?: boolean }, zh: boolean): string {
  if (file.isBinary) return zh ? '二进制文件无法显示文本差异，可使用外部工具比较。' : 'Binary contents cannot be displayed as a text diff. Compare with an external tool.';
  if (file.changeType === 'added') return zh ? '新增文件，暂无逐行差异。' : 'Added file with no line diff.';
  if (file.changeType === 'deleted') return zh ? '已删除文件，暂无逐行差异。' : 'Deleted file with no line diff.';
  if (file.changeType === 'renamed') return zh ? '重命名文件，内容可能未变化。' : 'Renamed file with no content change.';
  return zh ? '没有可展示的文本差异。' : 'No text diff to display.';
}
