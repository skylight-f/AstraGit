import { ColumnsIcon as Columns } from '@phosphor-icons/react/dist/csr/Columns';
import { FileIcon as File } from '@phosphor-icons/react/dist/csr/File';
import { RowsIcon as Rows } from '@phosphor-icons/react/dist/csr/Rows';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardClient, GitDiffHunk, GitDiffSummary, GitFileDiff } from '../apiClient.js';
import { alignedDiffRows, type DiffCell } from './gitDiffRows.js';
import { useApplicationErrorDialog, VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';

import '../styles.css';
import '../ui/primitives.css';
import '../agentdesk-theme.css';
import './gitTextDiff.css';

type DiffViewMode = 'side-by-side' | 'unified';

interface SideBySideDiffProps {
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

export function ProjectGitDiffWindow(props: {
  client: Pick<DashboardClient, 'loadProjectGitWorkbench' | 'loadProjectGitCommit' | 'loadProjectGitComparisonDiff'>;
  projectId: string;
  repositoryId: string;
  filePath: string;
  stage: 'combined' | 'staged' | 'unstaged';
  commitHash?: string;
  comparisonRef?: string;
  comparisonMode?: 'current' | 'working-tree';
  language: 'zh-CN' | 'en-US';
  appearance?: 'light' | 'dark' | 'system';
}) {
  const zh = props.language === 'zh-CN';
  const appearance = props.appearance ?? 'system';
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [title, setTitle] = useState(props.filePath || (zh ? 'Git 差异' : 'Git diff'));
  const [selectedPath, setSelectedPath] = useState(props.filePath);
  const [error, setError] = useState<unknown>(null);
  useApplicationErrorDialog(error, { language: zh ? 'zh-CN' : 'en' });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const request = props.commitHash
      ? props.client.loadProjectGitCommit(props.projectId, props.repositoryId, props.commitHash).then((detail) => {
          setTitle(detail.commit.subject);
          return detail.diff;
        })
      : props.comparisonRef
        ? props.client.loadProjectGitComparisonDiff(props.projectId, props.repositoryId, props.comparisonRef, props.comparisonMode ?? 'current').then((summary) => {
            setTitle(`${props.comparisonRef} · ${zh ? '分支差异' : 'Branch diff'}`);
            return summary;
          })
        : props.client.loadProjectGitWorkbench(props.projectId).then((workbench) => {
            const repository = workbench.repositories.find((candidate) => candidate.id === props.repositoryId);
            if (!repository) throw new Error(zh ? '仓库已不在当前项目中。' : 'The repository is no longer part of this project.');
            const source = props.stage === 'staged' ? repository.snapshot.stagedDiff : props.stage === 'unstaged' ? repository.snapshot.unstagedDiff : repository.snapshot.diff;
            setTitle(repository.name);
            return source;
          });
    void request
      .then((next) => {
        if (cancelled) return;
        setDiff(next);
        setSelectedPath(props.filePath || next.fileDiffs[0]?.newPath || next.fileDiffs[0]?.oldPath || '');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectId, props.repositoryId, props.filePath, props.stage, props.commitHash, props.comparisonRef, props.comparisonMode, props.client, zh]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = selectedPath ? `${title} · ${selectedPath}` : title;
    return () => { document.title = previousTitle; };
  }, [selectedPath, title]);

  const selectedDiff = useMemo(() => (diff && selectedPath ? { ...diff, fileDiffs: diff.fileDiffs.filter((file) => file.newPath === selectedPath || file.oldPath === selectedPath) } : diff), [diff, selectedPath]);

  return (
    <main className={`macos-ai-app zeus-shell theme-${appearance} project-git-diff-window`} aria-label={zh ? 'Git 差异窗口' : 'Git diff window'}>
      {diff ? (
        diff.fileDiffs.length > 1 ? (
          <div className="project-git-diff-window-layout">
            <aside className="project-git-diff-window-files" aria-label={zh ? '变更文件' : 'Changed files'}>
              <header>
                <strong>{title}</strong>
                <small>
                  {diff.fileDiffs.length} {zh ? '个文件' : 'files'}
                </small>
              </header>
              <div>
                {diff.fileDiffs.map((file) => {
                  const path = file.newPath || file.oldPath;
                  return (
                    <button key={`${file.oldPath}:${file.newPath}`} type="button" className={path === selectedPath ? 'is-current' : ''} onClick={() => setSelectedPath(path)}>
                      <File aria-hidden="true" />
                      <span title={path}>{path}</span>
                      <em>+{file.addedLines}</em>
                      <i>-{file.deletedLines}</i>
                    </button>
                  );
                })}
              </div>
            </aside>
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
  const file = props.diff?.fileDiffs[0] ?? null;
  if (!file) return <p className="project-git-empty-copy">{props.zh ? '选择一个文件查看差异。' : 'Select a file to inspect its diff.'}</p>;
  if (file.hunks.length === 0) {
    return <p className="project-git-empty-copy">{fileDiffEmptyMessage(file, props.zh)}</p>;
  }
  const oldPath = file.changeType === 'added' ? (props.zh ? '变更前（空文件）' : 'Before (empty file)') : file.oldPath;
  const newPath = file.changeType === 'deleted' ? (props.zh ? '变更后（空文件）' : 'After (empty file)') : file.newPath;
  return (
    <section className={`project-git-diff-preview${props.fill ? ' is-fill' : ''}`} aria-label={props.zh ? '文件差异' : 'File diff'}>
      <header>
        <strong title={props.title ?? (file.newPath || file.oldPath)}>{props.title ?? (file.newPath || file.oldPath)}</strong>
        <span>+{file.addedLines}</span>
        <em>-{file.deletedLines}</em>
        <span className="project-git-diff-mode" aria-label={props.zh ? '差异布局' : 'Diff layout'}>
          <button type="button" className={mode === 'side-by-side' ? 'is-active' : ''} aria-pressed={mode === 'side-by-side'} onClick={() => setMode('side-by-side')} title={props.zh ? '左右两栏' : 'Side-by-side'}>
            <Columns aria-hidden="true" />
          </button>
          <button type="button" className={mode === 'unified' ? 'is-active' : ''} aria-pressed={mode === 'unified'} onClick={() => setMode('unified')} title={props.zh ? '统一视图' : 'Unified'}>
            <Rows aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="project-git-diff-side-by-side">
        {mode === 'side-by-side' ? (
          <div className="project-git-diff-side-head">
            <span title={oldPath}>{oldPath}</span>
            <span title={newPath}>{newPath}</span>
          </div>
        ) : null}
        <div className="project-git-diff-hunks" aria-label={props.zh ? '差异区块' : 'Diff hunks'}>
          {file.hunks.map((hunk, index) => (
            <TextHunkSection
              key={`${hunk.header}:${index}`}
              file={file}
              hunk={hunk}
              index={index}
              unified={mode === 'unified'}
              zh={props.zh}
              actionsDisabled={props.hunkActionsDisabled === true}
              onAction={props.partitionHunks ? props.onHunkAction : undefined}
              actionLabel={props.hunkActionLabel}
              onDiscard={props.partitionHunks ? props.onHunkDiscard : undefined}
              discardLabel={props.hunkDiscardLabel}
            />
          ))}
        </div>
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
      <TextHunkDiff hunk={props.hunk} unified={props.unified} zh={props.zh} />
    </section>
  );
}

function TextHunkDiff(props: { hunk: GitDiffHunk; unified: boolean; zh: boolean }) {
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
              const cell: DiffCell = { content: line.content, number: line.oldLineNumber, kind: line.type };
              cell.highlight = line.type === 'deletion' && line.oldLineNumber !== null
                ? highlightedLines.left.get(line.oldLineNumber)
                : line.type === 'addition' && line.newLineNumber !== null ? highlightedLines.right.get(line.newLineNumber) : undefined;
              return <TextDiffLine key={index} cell={cell} unified newNumber={line.newLineNumber} />;
            })}
          </div>
        </div>
      ) : (['left', 'right'] as const).map((side) => (
        <div
          key={side}
          ref={side === 'left' ? left : right}
          className="astragit-diff-pane"
          role="region"
          tabIndex={0}
          aria-label={side === 'left' ? (props.zh ? '变更前' : 'Before changes') : (props.zh ? '变更后' : 'After changes')}
          onScroll={(event) => {
            const other = side === 'left' ? right.current : left.current;
            if (other && other.scrollTop !== event.currentTarget.scrollTop) other.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div className="astragit-diff-lines">
            {rows.map((row, index) => <TextDiffLine key={index} cell={row[side]} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TextDiffLine(props: { cell: DiffCell; unified?: boolean; newNumber?: number | null }) {
  const { cell } = props;
  return (
    <div className={`astragit-diff-line is-${cell.kind}`}>
      <span className="astragit-diff-line-number" aria-hidden="true">{cell.number}</span>
      {props.unified ? <span className="astragit-diff-line-number" aria-hidden="true">{props.newNumber}</span> : null}
      <span className="astragit-diff-line-sign" aria-hidden="true">{cell.kind === 'addition' ? '+' : cell.kind === 'deletion' ? '−' : ' '}</span>
      <code>{cell.highlight ? <>{cell.highlight.before}<mark>{cell.highlight.changed}</mark>{cell.highlight.after}</> : cell.content}</code>
    </div>
  );
}

function formatHunkRange(start: number, lines: number, zh: boolean): string {
  if (lines === 0) return zh ? '空' : 'empty';
  return lines === 1 ? String(start) : `${start}–${start + lines - 1}`;
}

function fileDiffEmptyMessage(file: { changeType: string; oldPath: string; newPath: string }, zh: boolean): string {
  if (file.changeType === 'added') return zh ? '新增文件，暂无逐行差异。' : 'Added file with no line diff.';
  if (file.changeType === 'deleted') return zh ? '已删除文件，暂无逐行差异。' : 'Deleted file with no line diff.';
  if (file.changeType === 'renamed') return zh ? '重命名文件，内容可能未变化。' : 'Renamed file with no content change.';
  return zh ? '没有可展示的文本差异。' : 'No text diff to display.';
}
