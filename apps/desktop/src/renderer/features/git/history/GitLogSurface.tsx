import type { GitExternalToolRequest } from '../repository/GitExternalToolDialog.js';
import { pruneGitFileSelection, selectGitFilePaths, type GitFileSelection } from '../changes/gitFileSelection.js';
import { MenuSurface } from '../../../ui/MenuSurface.js';
import { MotionPresence } from '../../../ui/MotionPresence.js';
import { GitHistoryTable } from './GitHistoryTable.js';
import { GitPaneSeparator } from '../components/GitPaneSeparator.js';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import type { DashboardClient, GitRevisionComparison, GitHistorySearchCommit, ProjectGitCommitDetail, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { VisibleApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import { SideBySideDiff } from '../diff/ProjectGitDiffViewer.js';
import { useGitCommitParentComparison } from './useGitCommitParentComparison.js';
import type { BusyState, GitContextEvent, GitDiffOptions } from '../workbench/gitWorkbenchTypes.js';
import { CommitFileDirectoryTree } from '../components/CommitFileDirectoryTree.js';
import { formatCommitHistoryTime } from './gitHistoryTime.js';
import { Select } from '../../../ui/FormControls.js';

const gitHistoryRowHeight = 24;

export function GitLogSurface(props: {
  /** 仓库预览所属项目。 */
  projectId: string;
  client: Pick<DashboardClient, 'loadProjectGitRevisionsDiff'>;
  zh: boolean;
  historyLoading: boolean;
  historyError: string;
  historyHasMore: boolean;
  onLoadMore: () => void;
  onReloadHistory: () => void;
  commits: Array<{ repository: ProjectGitRepositoryWorkbenchItem; commit: GitHistorySearchCommit }>;
  selectionScope: string;
  onExportSeries: (repository: ProjectGitRepositoryWorkbenchItem, revisions: string[]) => void;
  onExportComparison: (repository: ProjectGitRepositoryWorkbenchItem, revisions: [string, string], path?: string) => void;
  onCommitMenu: (event: GitContextEvent, repository: ProjectGitRepositoryWorkbenchItem, ref: string, commits: string[], position?: { x: number; y: number }) => void;
  selectedRepository: ProjectGitRepositoryWorkbenchItem | null;
  selectedCommitHash: string;
  commitDetail: ProjectGitCommitDetail | null;
  commitLoading: boolean;
  selectedFilePath: string;
  onSelectCommit: (repository: ProjectGitRepositoryWorkbenchItem, commitHash: string) => void;
  onOpenChanges: () => void;
  onSelectFile: (path: string) => void;
  busy: BusyState;
  onInteractiveRebase: (repository: ProjectGitRepositoryWorkbenchItem, baseRef: string) => void;
  onReset: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onPatchExport: (repository: ProjectGitRepositoryWorkbenchItem, revision: string, path?: string) => void;
  onArchive: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onExternalTool: (request: GitExternalToolRequest) => void;
  onCreateTag: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onFileHistory: (repository: ProjectGitRepositoryWorkbenchItem, path: string, ref: string, view: 'history' | 'blame') => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: GitDiffOptions) => void;
  onReplay: (repository: ProjectGitRepositoryWorkbenchItem, kind: 'cherry_pick' | 'revert', revision: string, mainline?: number) => void;
}) {
  const parentComparison = useGitCommitParentComparison({ projectId: props.projectId, repositoryId: props.selectedRepository?.id, detail: props.commitDetail, client: props.client });
  const detail = parentComparison.detail;
  const selectedFilePath = detail?.files.some(file => file.path === props.selectedFilePath) ? props.selectedFilePath : detail?.files[0]?.path ?? '';
  const parentRevisions: [string, string] | undefined = parentComparison.isMerge && detail ? [parentComparison.parent, detail.commit.hash] : undefined;
  const exportCommit = (path?: string) => {
    if (!props.selectedRepository || !detail || parentComparison.loading || parentComparison.error) return;
    if (parentRevisions) props.onExportComparison(props.selectedRepository, parentRevisions, path);
    else props.onPatchExport(props.selectedRepository, detail.commit.hash, path);
  };
  const [selection, setSelection] = useState<GitFileSelection & { scope: string }>({ scope: props.selectionScope, selectedPaths: props.selectedCommitHash ? [props.selectedCommitHash] : [], anchor: props.selectedCommitHash || null });
  const focusedByRow = useRef(props.selectedCommitHash); const previousScope = useRef(props.selectionScope);
  const ordered = props.commits.map(item => item.commit.hash);
  const selectedHashes = selection.scope === props.selectionScope ? pruneGitFileSelection(selection.selectedPaths, ordered) : [];
  useEffect(() => {
    if (previousScope.current !== props.selectionScope || focusedByRow.current !== props.selectedCommitHash) setSelection({ scope: props.selectionScope, selectedPaths: props.selectedCommitHash ? [props.selectedCommitHash] : [], anchor: props.selectedCommitHash || null });
    previousScope.current = props.selectionScope; focusedByRow.current = props.selectedCommitHash;
  }, [props.selectionScope, props.selectedCommitHash]);
  const selectRows = (event: ReactMouseEvent | ReactKeyboardEvent, repository: ProjectGitRepositoryWorkbenchItem, hash: string) => {
    const next = selectGitFilePaths({ orderedPaths: ordered, selectedPaths: selectedHashes, anchor: selection.scope === props.selectionScope ? selection.anchor : null, clickedPath: hash, range: event.shiftKey, additive: event.ctrlKey || event.metaKey });
    setSelection({ ...next, scope: props.selectionScope });
    const focusedHash = next.selectedPaths.includes(hash) ? hash : next.selectedPaths.at(-1);
    if (focusedHash) { focusedByRow.current = focusedHash; props.onSelectCommit(repository, focusedHash); }
  };
  const commitMenuFor = (event: GitContextEvent, repository: ProjectGitRepositoryWorkbenchItem, hash: string, position?: { x: number; y: number }) => {
    const hashes = selectedHashes.includes(hash) ? selectedHashes : [hash];
    if (!selectedHashes.includes(hash)) setSelection({ scope: props.selectionScope, selectedPaths: [hash], anchor: hash });
    focusedByRow.current = hash; props.onSelectCommit(repository, hash); props.onCommitMenu(event, repository, hash, hashes, position);
  };
  const selectedDiff = detail?.diff.fileDiffs.find((file) => file.newPath === selectedFilePath || file.oldPath === selectedFilePath) ?? null;
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setCommitMenu(null);
  }, [props.selectedRepository?.id, detail?.commit.hash, props.commitLoading, props.busy]);
  const historyScroll = useRef<HTMLDivElement>(null);
  const historySentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!historyScroll.current || !historySentinel.current || props.historyLoading || props.historyError || !props.historyHasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) props.onLoadMore();
      },
      { root: historyScroll.current, rootMargin: '0px 0px 160px 0px' },
    );
    observer.observe(historySentinel.current);
    return () => observer.disconnect();
  }, [props.historyLoading, props.historyError, props.historyHasMore, props.onLoadMore]);
  return (
    <div className="project-git-log-layout" style={{ '--base-git-history-row-height': `${gitHistoryRowHeight}px` } as React.CSSProperties}>
      <GitHistoryTable zh={props.zh} scrollRef={historyScroll} pinned={<>
        <div className="git-history-selection-tools"><span>{props.zh ? `已选 ${selectedHashes.length} 个提交 · Shift 连选，Ctrl/⌘ 多选` : `${selectedHashes.length} commits selected · Shift for ranges, Ctrl/⌘ to add`}</span><Button size="compact" variant="secondary" disabled={!props.selectedRepository || !selectedHashes.length || props.busy !== null} onClick={() => props.selectedRepository && props.onExportSeries(props.selectedRepository, selectedHashes)}>{props.zh ? '导出所选提交序列…' : 'Export selected series…'}</Button></div>
        {props.selectedRepository && props.selectedRepository.snapshot.fileStatuses.length > 0 ? (
          <button type="button" className="project-git-commit-row git-working-copy-row" onClick={props.onOpenChanges}>
            <span className="project-git-commit-subject">
              <strong>{props.zh ? '未提交的更改' : 'Uncommitted changes'}</strong>
              <small>{props.selectedRepository.snapshot.fileStatuses.length}</small>
            </span>
            <code>—</code>
            <span>—</span>
            <span />
          </button>
        ) : null}
      </>}>
        <CommitGraph commits={props.commits.map(({ commit }) => commit)} />
        {props.commits.length === 0 && !props.historyLoading && !props.historyError ? <p role="status">{props.zh ? '所选历史范围没有匹配的提交，请调整条件或刷新范围。' : 'No commits match in this history scope. Adjust the search or refresh the scope.'}</p> : null}
        {props.commits.map(({ repository, commit }) => {
          const selected = repository.id === props.selectedRepository?.id && selectedHashes.includes(commit.hash);
          const focused = selected && commit.hash === props.selectedCommitHash;
          return (
            <button
              key={`${repository.id}:${commit.hash}`}
              data-git-context={JSON.stringify({ kind: 'commit', repositoryId: repository.id, ref: commit.hash })}
              type="button"
              className={`project-git-commit-row${selected ? ' is-selected' : ''}${focused ? ' is-current' : ''}`}
              aria-pressed={selected}
              onClick={event => selectRows(event, repository, commit.hash)}
              onContextMenu={event => commitMenuFor(event, repository, commit.hash)}
              onKeyDown={event => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection({ scope: props.selectionScope, selectedPaths: ordered, anchor: selection.anchor ?? commit.hash }); return; }
                if (event.key === 'Escape') { event.preventDefault(); setSelection({ scope: props.selectionScope, selectedPaths: [], anchor: null }); return; }
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const bounds = event.currentTarget.getBoundingClientRect(); commitMenuFor(event, repository, commit.hash, { x: bounds.left, y: bounds.bottom }); return; }
                const index = ordered.indexOf(commit.hash); const next = event.key === 'ArrowDown' ? Math.min(ordered.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : null;
                if (next === null || !props.commits[next]) return;
                event.preventDefault(); selectRows(event, props.commits[next]!.repository, ordered[next]!);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.project-git-commit-row')[next]?.focus();
              }}
            >
              <span className="project-git-commit-subject" title={commit.searchMatch ? `${commit.subject}\n${commit.searchMatch.excerpt}` : commit.subject}>
                {repository.snapshot.headSha === commit.hash ? (
                  <span className="git-history-ref" title={repository.snapshot.detached ? 'HEAD' : `HEAD → ${repository.snapshot.branch}`}>
                    <GitBranch aria-hidden="true" />
                    {repository.snapshot.detached ? 'HEAD' : repository.snapshot.branch}
                  </span>
                ) : null}
                <strong>{commit.subject}</strong>
              </span>
              <code title={commit.hash}>{commit.shortHash}</code>
              <span title={commit.author}>{commit.author}</span>
              <time dateTime={commit.authoredAt} title={new Date(commit.authoredAt).toLocaleString()}>
                {formatCommitHistoryTime(commit.authoredAt, props.zh)}
              </time>
            </button>
          );
        })}
        <div ref={historySentinel} role="status" className="project-git-history-status">
          {props.historyError ? (
            <>
              <span>{props.historyError}</span>
              <Button variant="secondary" size="compact" onClick={props.onReloadHistory}>
                {props.zh ? '重新载入历史' : 'Reload history'}
              </Button>
            </>
          ) : props.historyLoading ? (
            props.zh ? (
              '正在加载提交…'
            ) : (
              'Loading commits…'
            )
          ) : props.historyHasMore ? (
            props.zh ? (
              '向下滚动加载更多提交'
            ) : (
              'Scroll for more commits'
            )
          ) : props.zh ? (
            '已加载此范围全部匹配记录；刷新可获取新提交'
          ) : (
            'All matching entries loaded for this scope. Refresh for new commits'
          )}
        </div>
      </GitHistoryTable>
      <GitPaneSeparator name="history-preview" label={props.zh ? '调整代码差异与历史高度' : 'Resize diff and history'} target=".project-git-browser-layout" axis="y" initial={44} min={24} max={60} />
      <GitPaneSeparator name="history-inspector" trailingMin={175} label={props.zh ? '调整图谱与提交详情宽度' : 'Resize graph and commit details'} target=".project-git-browser-layout" initial={74} min={62} max={82} />
      {selectedHashes.length === 2 && props.selectedRepository ? <GitHistoryComparisonInspector key={JSON.stringify([props.selectionScope, ...selectedHashes])} projectId={props.projectId} client={props.client} repository={props.selectedRepository} revisions={[selectedHashes[1]!, selectedHashes[0]!]} zh={props.zh} onOpenDiff={props.onOpenDiff} onExport={props.onExportComparison} onExternal={props.onExternalTool} onHistory={props.onFileHistory} /> : selectedHashes.length > 0 && !props.commitLoading && detail ? (
          <GitHistoryPanels zh={props.zh} info={(
            <section className="project-git-commit-detail">
              <header className="git-history-pane-heading">{props.zh ? '提交信息' : 'Commit information'}</header>
              <strong>{detail.commit.subject}</strong>
              <span>{detail.commit.author}</span>
              <small>
                {detail.commit.shortHash} · {new Date(detail.commit.authoredAt).toLocaleString()}
              </small>
              {parentComparison.isMerge ? <div className="git-merge-parent-selection">
                <label>{props.zh ? '比较基线' : 'Compare against'}<Select
                  ariaLabel={props.zh ? '合并提交父级' : 'Merge comparison parent'}
                  value={parentComparison.parent}
                  onChange={parentComparison.select}
                  options={detail.parentHashes.map((parent, index) => ({ value: parent, label: `${props.zh ? `父提交 ${index + 1}` : `Parent ${index + 1}`} · ${parent.slice(0, 8)}` }))}
                /></label>
                <small>{props.zh ? '显示所选父提交到本次合并结果的差异。' : 'Shows changes from the selected parent to this merge result.'}</small>
                {parentComparison.loading ? <p role="status">{props.zh ? '正在读取所选父提交差异…' : 'Loading the selected parent comparison…'}</p> : parentComparison.error ? <><VisibleApplicationError error={parentComparison.error} language={props.zh ? 'zh-CN' : 'en'} /><Button size="compact" onClick={parentComparison.reload}>{props.zh ? '重试比较' : 'Retry comparison'}</Button></> : null}
              </div> : null}
              <div className="project-git-commit-actions">
                <Button
                  variant="secondary"
                  disabled={!props.selectedRepository}
                  onClick={() => props.selectedRepository && props.onOpenDiff(props.selectedRepository, '', { comparisonRef: detail!.commit.hash, comparisonMode: 'current' })}
                >
                  {props.zh ? '查看与当前分支的差异' : 'View diff with current branch'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={props.busy !== null || !props.selectedRepository}
                  aria-haspopup="menu"
                  aria-expanded={commitMenu !== null}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setCommitMenu(commitMenu ? null : { x: bounds.left, y: bounds.bottom + 5 });
                  }}
                >
                  {props.zh ? '更多操作' : 'More actions'}
                  <CaretDown aria-hidden="true" />
                </Button>
              </div>
              <MotionPresence>
                {commitMenu && props.selectedRepository
                  ? createPortal(
                      <MenuSurface className="project-git-context-menu" aria-label={props.zh ? '提交操作' : 'Commit actions'} style={{ left: commitMenu.x, top: commitMenu.y }} onClose={() => setCommitMenu(null)}>
                        <button type="button" role="menuitem" disabled={props.busy !== null} onClick={() => { setCommitMenu(null); props.onCreateTag(props.selectedRepository!, detail!.commit.hash); }}>{props.zh ? '创建标签…' : 'Create tag…'}</button>
                        <button type="button" role="menuitem" disabled={props.busy !== null || parentComparison.loading || Boolean(parentComparison.error)} onClick={() => { setCommitMenu(null); exportCommit(); }}>{parentComparison.isMerge ? (props.zh ? '导出当前父级比较补丁…' : 'Export selected parent comparison…') : (props.zh ? '导出此提交补丁…' : 'Export commit as patch…')}</button>
                        <button type="button" role="menuitem" onClick={() => { setCommitMenu(null); props.onArchive(props.selectedRepository!, detail!.commit.hash); }}>{props.zh ? '导出此版本源码存档…' : 'Archive source at this revision…'}</button>
                        <button type="button" role="menuitem" disabled={props.busy !== null || Boolean(props.selectedRepository.snapshot.integrationState)} onClick={() => { setCommitMenu(null); props.onInteractiveRebase(props.selectedRepository!, detail!.commit.hash); }}>{props.zh ? '交互变基此提交之后的历史…' : 'Interactively rebase commits after this…'}</button>
                        <button type="button" role="menuitem" data-danger="true" disabled={props.busy !== null} onClick={() => { setCommitMenu(null); props.onReset(props.selectedRepository!, detail!.commit.hash); }}>{props.zh ? '重置当前分支到此提交…' : 'Reset current branch to this commit…'}</button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={props.busy !== null || props.selectedRepository.snapshot.detached}
                          onClick={() => {
                            setCommitMenu(null);
                            props.onReplay(props.selectedRepository!, 'cherry_pick', detail!.commit.hash, parentComparison.isMerge ? detail!.parentHashes.indexOf(parentComparison.parent) + 1 : undefined);
                          }}
                        >
                          {props.zh ? '拣选到当前分支' : 'Cherry-pick to current branch'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          data-danger="true"
                          disabled={props.busy !== null}
                          onClick={() => {
                            setCommitMenu(null);
                            props.onReplay(props.selectedRepository!, 'revert', detail!.commit.hash, parentComparison.isMerge ? detail!.parentHashes.indexOf(parentComparison.parent) + 1 : undefined);
                          }}
                        >
                          {props.zh ? '撤销此提交' : 'Revert this commit'}
                        </button>
                      </MenuSurface>,
                      document.querySelector('.macos-ai-app') ?? document.body,
                    )
                  : null}
              </MotionPresence>
              {detail.body && detail.body !== detail.commit.subject ? <p>{detail.body}</p> : null}
            </section>
          )} files={(
            <section className="project-git-changed-files">
              <header>
                <strong>{props.zh ? `变更文件 (${detail.files.length})` : `Changed files (${detail.files.length})`}</strong>
              </header>
              <CommitFileDirectoryTree
                zh={props.zh}
                files={detail.files}
                fileDiffs={detail.diff.fileDiffs}
                selectedPath={selectedFilePath}
                onSelect={props.onSelectFile}
                onExport={props.selectedRepository ? path => exportCommit(path) : undefined}
                onExternal={props.selectedRepository ? path => props.onExternalTool({ repository: props.selectedRepository!, input: { mode: 'diff', paths: [path], ...(parentRevisions ? { revisions: parentRevisions } : { commitHash: detail!.commit.hash }) } }) : undefined}
                onHistory={props.selectedRepository ? (path, view) => props.onFileHistory(props.selectedRepository!, path, detail!.commit.hash, view) : undefined}
                onOpen={(path) => {
                  if (props.selectedRepository) props.onOpenDiff(props.selectedRepository, path, parentRevisions ? { revisions: parentRevisions } : { commitHash: detail?.commit.hash });
                }}
              />
            </section>
          )} preview={(
            <SideBySideDiff
              previewRequest={
                props.selectedRepository && selectedFilePath
                  ? { kind: 'project-git', projectId: props.projectId, repositoryId: props.selectedRepository.id, path: selectedFilePath, ...(parentRevisions ? { revisions: parentRevisions } : { commitHash: props.selectedCommitHash }) }
                  : undefined
              }
              emptyMessage={parentComparison.loading ? (props.zh ? '正在读取所选父提交差异…' : 'Loading the selected parent comparison…') : parentComparison.error ? (props.zh ? '所选父提交未能完成比较，请查看详情或重试。' : 'The selected parent comparison failed. Review the details or retry.') : parentComparison.isMerge && detail.files.length === 0 ? (props.zh ? '该合并结果与所选父提交的文件快照相同。' : 'The merge result and selected parent have identical file trees.') : undefined}
              diff={selectedDiff || detail.diff.unavailableReason ? { ...detail.diff, files: selectedFilePath ? [selectedFilePath] : detail.diff.files, fileDiffs: selectedDiff ? [selectedDiff] : [] } : null}
              zh={props.zh}
              fill
            />
          )} />
        ) : (
          <GitHistoryPanels zh={props.zh} loading={selectedHashes.length > 0 && props.commitLoading} />
        )}
    </div>
  );
}

function GitHistoryPanels(props: { zh: boolean; preview?: ReactNode; files?: ReactNode; info?: ReactNode; loading?: boolean }) {
  return <>
    <section className="git-history-preview-pane" aria-label={props.zh ? '代码差异预览' : 'Code diff preview'}>
      <header className="git-history-pane-heading">{props.zh ? '代码变化' : 'Code changes'}</header>
      {props.preview ?? <p className="project-git-empty-copy" role="status">{props.loading ? (props.zh ? '正在读取提交…' : 'Loading commit…') : (props.zh ? '选择一个提交查看代码变化。' : 'Select a commit to see its changes.')}</p>}
    </section>
    <aside className="git-history-detail-pane" aria-label={props.zh ? '变更文件与提交信息' : 'Changed files and commit information'}>
      {props.files && props.info ? <>
        {props.files}
        <GitPaneSeparator name="history-details" label={props.zh ? '调整文件与提交信息高度' : 'Resize files and commit information'} axis="y" initial={55} min={24} max={76} />
        {props.info}
      </> : <>
        <header className="git-history-pane-heading">{props.zh ? '变更文件与提交信息' : 'Changed files and commit information'}</header>
        <p className="project-git-empty-copy">{props.loading ? (props.zh ? '正在读取提交…' : 'Loading commit…') : (props.zh ? '选中提交后，文件和提交信息会显示在这里。' : 'Select a commit to see its files and information here.')}</p>
      </>}
    </aside>
  </>;
}

function GitHistoryComparisonInspector(props: {
  projectId: string; client: Pick<DashboardClient, 'loadProjectGitRevisionsDiff'>;
  repository: ProjectGitRepositoryWorkbenchItem; revisions: [string, string]; zh: boolean;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, path: string, options: { revisions: [string, string] }) => void;
  onExport: (repository: ProjectGitRepositoryWorkbenchItem, revisions: [string, string], path?: string) => void;
  onExternal: (request: GitExternalToolRequest) => void;
  onHistory: (repository: ProjectGitRepositoryWorkbenchItem, path: string, ref: string, view: 'history' | 'blame') => void;
}) {
  const [reverse, setReverse] = useState(false); const [reload, setReload] = useState(0); const [selectedPath, setSelectedPath] = useState('');
  const before = props.revisions[reverse ? 1 : 0]; const after = props.revisions[reverse ? 0 : 1];
  const readKey = JSON.stringify([props.projectId, props.repository.id, before, after, reload]);
  const [state, setState] = useState<{ key: string; comparison?: GitRevisionComparison; error?: unknown } | null>(null);
  const current = state?.key === readKey ? state : null;
  const comparison = current?.comparison; const loading = !current;
  const path = comparison?.files.some(file => file.path === selectedPath) ? selectedPath : comparison?.files[0]?.path ?? '';
  useEffect(() => {
    const controller = new AbortController();
    void props.client.loadProjectGitRevisionsDiff(props.projectId, props.repository.id, [before, after], controller.signal)
      .then(comparison => { if (!controller.signal.aborted) setState({ key: readKey, comparison }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key: readKey, error }); });
    return () => controller.abort();
  }, [props.client, props.projectId, props.repository.id, before, after, readKey]);
  const selected = comparison?.diff.fileDiffs.filter(file => (file.newPath || file.oldPath) === path) ?? [];
  const text = (cn: string, en: string) => props.zh ? cn : en;
  return <GitHistoryPanels zh={props.zh} info={(
    <section className="project-git-commit-detail git-history-comparison-detail">
      <strong>{text('所选两个提交的总差异', 'Comparison of selected commits')}</strong>
      <code title={`${before}\n→ ${after}`}>{before.slice(0, 8)} → {after.slice(0, 8)}</code>
      <small>{text('比较两个提交的文件快照，不包含工作区或暂存区修改。', 'Compares the two commit trees, excluding index and working tree changes.')}</small>
      <div className="project-git-commit-actions">
        <Button size="compact" variant="secondary" onClick={() => setReverse(value => !value)}>{text('交换方向', 'Swap direction')}</Button>
        <Button size="compact" variant="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>{text('重新载入', 'Reload')}</Button>
        <Button size="compact" variant="secondary" disabled={!comparison} onClick={() => comparison && props.onOpenDiff(props.repository, '', { revisions: comparison.revisions })}>{text('打开差异窗口', 'Open diff window')}</Button>
        <Button size="compact" variant="secondary" disabled={!comparison} onClick={() => comparison && props.onExport(props.repository, comparison.revisions)}>{text('导出比较补丁…', 'Export comparison patch…')}</Button>
      </div>
      {loading ? <p role="status">{text('正在比较所选提交…', 'Comparing selected commits…')}</p> : current?.error ? <VisibleApplicationError error={current.error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
    </section>
  )} files={(
    <section className="project-git-changed-files">
      <header><strong>{text(`变更文件 (${comparison?.files.length ?? '…'})`, `Changed files (${comparison?.files.length ?? '…'})`)}</strong></header>
      {comparison ? <CommitFileDirectoryTree zh={props.zh} files={comparison.files} fileDiffs={comparison.diff.fileDiffs} selectedPath={path} onSelect={setSelectedPath}
        onOpen={path => props.onOpenDiff(props.repository, path, { revisions: comparison.revisions })}
        onExport={path => props.onExport(props.repository, comparison.revisions, path)}
        onExternal={path => props.onExternal({ repository: props.repository, input: { mode: 'diff', paths: [path], revisions: comparison.revisions } })}
        onHistory={(path, view) => props.onHistory(props.repository, path, comparison.revisions[1], view)} /> : null}
    </section>
  )} preview={(
    <SideBySideDiff diff={comparison ? { ...comparison.diff, files: path ? [path] : comparison.diff.files, fileDiffs: selected } : null} zh={props.zh} title={path} fill emptyMessage={loading ? text('正在比较所选提交…', 'Comparing selected commits…') : current?.error ? text('所选提交未能完整比较，请查看详情或重新载入。', 'The commits could not be compared completely. Review the details or reload.') : comparison && !comparison.files.length ? text('两个提交的文件快照相同。', 'The two commits have identical file trees.') : undefined} />
  )} />;
}

type GraphCommits = ProjectGitRepositoryWorkbenchItem['snapshot']['recentCommits'];

function CommitGraph({ commits }: { commits: GraphCommits }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const column = canvas?.closest('.git-history-table')?.querySelector('.git-history-column');
    if (!canvas || !column) return;
    const draw = () => drawCommitGraph(canvas, commits, column.getBoundingClientRect().width);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(column);
    return () => observer.disconnect();
  }, [commits]);
  return <canvas ref={canvasRef} className="project-git-graph-canvas" aria-hidden="true" />;
}

function drawCommitGraph(canvas: HTMLCanvasElement, commits: GraphCommits, width: number) {
  const rowHeight = gitHistoryRowHeight;
  const height = Math.max(1, commits.length * rowHeight);
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  context.lineWidth = 1.5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const colors = ['#4f67d8', '#29a98b', '#7957d5', '#76a93c', '#c27a34', '#3293ba', '#d45f86'];
  const lanes: string[] = [];
  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes[lane] = commit.hash;
    }
    const parents = commit.parentHashes.filter((parent, index, values) => values.indexOf(parent) === index);
    const destinations = parents.map((parent, index) => {
      const existing = lanes.indexOf(parent);
      if (existing >= 0) return existing;
      if (index === 0) return lane;
      lanes.push(parent);
      return lanes.length - 1;
    });
    const nextLanes = [...lanes];
    nextLanes[lane] = parents[0] ?? '';
    parents.slice(1).forEach((parent, index) => {
      const destination = destinations[index + 1]!;
      nextLanes[destination] = parent;
    });
    const y = row * rowHeight + rowHeight / 2;
    const nextY = y + rowHeight;
    lanes.forEach((value, fromLane) => {
      if (!value) return;
      const destination = value === commit.hash ? (destinations[0] ?? -1) : nextLanes.indexOf(value);
      if (destination < 0 || row === commits.length - 1) return;
      context.strokeStyle = colors[fromLane % colors.length]!;
      context.beginPath();
      context.moveTo(12 + fromLane * 14, y);
      context.bezierCurveTo(12 + fromLane * 14, y + rowHeight / 2, 12 + destination * 14, nextY - rowHeight / 2, 12 + destination * 14, nextY);
      context.stroke();
    });
    for (const destination of destinations.slice(1)) {
      context.strokeStyle = colors[destination % colors.length]!;
      context.beginPath();
      context.moveTo(12 + lane * 14, y);
      context.bezierCurveTo(12 + lane * 14, y + rowHeight / 2, 12 + destination * 14, nextY - rowHeight / 2, 12 + destination * 14, nextY);
      context.stroke();
    }
    context.fillStyle = colors[lane % colors.length]!;
    context.beginPath();
    context.arc(12 + lane * 14, y, 3.5, 0, Math.PI * 2);
    context.fill();
    for (let index = 0; index < nextLanes.length; index += 1) {
      if (nextLanes[index] && nextLanes.indexOf(nextLanes[index]!) !== index) nextLanes[index] = '';
    }
    while (nextLanes.at(-1) === '') nextLanes.pop();
    lanes.splice(0, lanes.length, ...nextLanes);
  });
}
