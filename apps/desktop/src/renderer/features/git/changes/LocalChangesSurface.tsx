import { GitLineChanges } from '../diff/GitLineChanges.js';
import { type GitExternalToolRequest } from '../repository/GitExternalToolDialog.js';
import { GitFileStatusIcon, gitFileStatusCategory, gitFileStatusLabel } from '../components/GitFileStatusIcon.js';
import { navigateGitFileRows, pruneGitFileSelection, selectGitFilePaths, type GitFileSelection } from './gitFileSelection.js';
import { gitFileStagePaths } from './gitFileStages.js';
import { DotsThreeIcon as DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import type { ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';
import type { BusyState } from '../workbench/gitWorkbenchTypes.js';
import { repositoryDraftScope, type GitCommitDrafts } from '../commits/useGitCommitDrafts.js';
import { commitPushTarget, type CommitPushTarget } from '../commits/commitThenPush.js';
import { GitCommitAiControls } from '../commits/GitCommitAiControls.js';
import { GitCommitOptionsMenu } from '../commits/GitCommitOptionsMenu.js';
import type { GitCommitModelState } from '../../models/useGitCommitModels.js';
import { GitPaneSeparator } from '../components/GitPaneSeparator.js';
import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { FolderIcon as Folder } from '@phosphor-icons/react/dist/csr/Folder';
import { GitFileViewSelect } from './GitFileViewSelect.js';
import type { DashboardClient, GitCommitOptions, ProjectGitAction, ProjectGitRepositorySnapshot, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { SelectableRow } from '../../../ui/SelectableRow.js';
import { SideBySideDiff } from '../diff/ProjectGitDiffViewer.js';
import { GitConflictEditor } from '../conflicts/GitConflictEditor.js';
import type { ChangeStage, GitContextEvent, GitContextTarget, GitDiffOptions } from '../workbench/gitWorkbenchTypes.js';

export function LocalChangesSurface(props: {
  client: Pick<DashboardClient, 'loadProjectGitLineDiff' | 'readProjectGitConflict' | 'saveProjectGitConflict'>;
  query: string;
  commitRequest: number;
  /** 刷新时即使二进制补丁相同，也重新读取当前文件。 */
  previewRevision?: string;
  /** 仓库预览所属项目。 */
  projectId: string;
  subtree: { repositoryId: string; path: string } | null;
  onClearSubtree: () => void;
  zh: boolean;
  onOpenStash: () => void;
  repositories: ProjectGitRepositoryWorkbenchItem[];
  selectedRepository: ProjectGitRepositoryWorkbenchItem | null;
  selectedFilePath: string;
  selectedFileStage: ChangeStage;
  busy: BusyState;
  onSelectRepository: (repositoryId: string) => void;
  onSelectFile: (path: string, stage: ChangeStage) => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: GitDiffOptions) => void;
  activeFileMenu: GitContextTarget | null;
  onFileMenu: (event: GitContextEvent, target: GitContextTarget, position: { x: number; y: number }) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
  onExternalTool: (request: GitExternalToolRequest) => void;
  onConflictSaved: (repositoryId: string, path: string, result: { resolved: boolean; snapshot?: ProjectGitRepositorySnapshot }) => Promise<void>;
  onConfirmAction: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, title: string, description: string, danger: boolean) => void;
  onCommit: (options: GitCommitOptions) => void;
  onAmend: (repository: ProjectGitRepositoryWorkbenchItem, options: GitCommitOptions) => void;
  onCommitAndPush: (repository: ProjectGitRepositoryWorkbenchItem, message: string, target: CommitPushTarget, onCommitted: () => void, options: GitCommitOptions) => Promise<ExecutionOutcome>;
  commitMessages: GitCommitDrafts;
  commitModels: GitCommitModelState;
  onOpenModelSettings: () => void;
  generationPreview: { id: string; text: string } | null;
  generatingCommitFor: string | null;
  generationFeedback?: string;
  onGenerateCommitMessage: (repository: ProjectGitRepositoryWorkbenchItem) => Promise<void>;
  onStopCommitGeneration: () => void;
}) {
  const { modelRef: commitModelRef, loading: commitModelsLoading } = props.commitModels;
  const committingRef = useRef(false);
  const [fileView, setFileView] = useState<'tree' | 'flat'>(() => {
    try {
      return localStorage.getItem('astragit.git.file-view.v1') === 'tree' ? 'tree' : 'flat';
    } catch {
      return 'flat';
    }
  });
  const [editingRepository, setEditingRepository] = useState<string | null>(null);
  const [pushSelection, setPushSelection] = useState<string | null>(null);
  const [commitOptions, setCommitOptions] = useState<GitCommitOptions>({});
  const [fileSelection, setFileSelection] = useState<(GitFileSelection & { repositoryId: string; stage: ChangeStage }) | null>(null);
  const commitInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.commitRequest && props.selectedRepository) setEditingRepository(props.selectedRepository.id);
  }, [props.commitRequest]);
  const commitActive = Boolean(props.selectedRepository && editingRepository === props.selectedRepository.id);
  useEffect(() => {
    if (commitActive) commitInputRef.current?.focus();
  }, [commitActive]);
  const repository = props.selectedRepository;
  const pushTarget = repository ? commitPushTarget(repository.snapshot) : null;
  const pushKey = repository && pushTarget ? JSON.stringify([repository.id, pushTarget]) : null;
  const pushAfterCommit = pushKey !== null && pushSelection === pushKey;
  useEffect(() => { setPushSelection(null); }, [repository?.id, repository?.snapshot.branch]);
  useEffect(() => { setCommitOptions({}); }, [repository?.id, repository?.snapshot.branch, commitActive]);
  const conflicts = new Set(repository?.snapshot.conflictFiles ?? []);
  const selectedConflict = Boolean(repository && conflicts.has(props.selectedFilePath));
  const draft = repository && props.commitMessages.drafts[repository.id];
  const message = props.generationPreview && props.generationPreview.id === repository?.id ? props.generationPreview.text : draft?.message ?? '';
  const scope = repository && repositoryDraftScope(repository.snapshot);
  const staleDraft = draft?.scope && scope !== draft.scope;
  const stagedCount = repository?.snapshot.fileStatuses.filter((file) => !conflicts.has(file.path) && file.indexStatus !== ' ' && file.indexStatus !== '?').length ?? 0;
  const generating = props.generatingCommitFor === repository?.id;
  const canCommit = Boolean(repository && !conflicts.size && stagedCount > 0 && message.trim() && !props.busy && !generating);
  async function commitCurrentRepository(): Promise<void> {
    if (!repository || !canCommit || committingRef.current) return;
    committingRef.current = true;
    try {
      const clearCommittedDraft = () => {
        props.commitMessages.clearCommitted(repository.id, message);
        setEditingRepository(null);
      };
      if (pushAfterCommit && pushTarget) {
        await props.onCommitAndPush(repository, message.trim(), pushTarget, clearCommittedDraft, commitOptions);
      } else if (await props.onExecute(repository, { type: 'commit', message: message.trim(), options: commitOptions }, props.zh ? '提交已暂存变更' : 'Commit staged changes') === 'completed') clearCommittedDraft();
    } finally {
      committingRef.current = false;
    }
  }
  const subtree = props.subtree;
  const matchesSubtree = (path: string) => !subtree || subtree.repositoryId !== props.selectedRepository?.id || path === subtree.path || path.startsWith(`${subtree.path}/`);
  const matchesFileFilter = (path: string) => matchesSubtree(path) && path.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase());
  const stagePaths = gitFileStagePaths(repository?.snapshot.fileStatuses ?? [], repository?.snapshot.conflictFiles ?? []);
  const visibleStageFiles = {
    staged: stagePaths.staged.filter(matchesFileFilter),
    unstaged: stagePaths.unstaged.filter(matchesFileFilter),
  };
  const visibleChangeCount = new Set([...visibleStageFiles.staged, ...visibleStageFiles.unstaged]).size;
  const emptyVisibleChanges = Boolean(repository && visibleChangeCount === 0);
  const workspaceClean = Boolean(emptyVisibleChanges && repository?.snapshot.fileStatuses.length === 0 && conflicts.size === 0);
  const selectedRows = fileSelection?.repositoryId === repository?.id ? pruneGitFileSelection(fileSelection?.selectedPaths ?? [], fileSelection ? visibleStageFiles[fileSelection.stage] : []) : [];
  const visibleFilesKey = JSON.stringify(visibleStageFiles);
  useEffect(() => {
    // Filtering, refreshing or changing repositories must not leave hidden write targets selected.
    setFileSelection((current) => {
      if (!current || current.repositoryId !== repository?.id) return null;
      const paths = visibleStageFiles[current.stage];
      const selectedPaths = pruneGitFileSelection(current.selectedPaths, paths);
      const anchor = current.anchor && paths.includes(current.anchor) ? current.anchor : null;
      return selectedPaths.join('\0') === current.selectedPaths.join('\0') && anchor === current.anchor ? current : { ...current, selectedPaths, anchor };
    });
  }, [repository?.id, visibleFilesKey]);
  function selectFileRows(event: ReactMouseEvent, path: string, stage: ChangeStage, orderedPaths: string[]): void {
    if (!repository) return;
    const current = fileSelection?.repositoryId === repository.id && fileSelection.stage === stage ? fileSelection : null;
    const next = selectGitFilePaths({ orderedPaths, selectedPaths: current?.selectedPaths ?? [], anchor: current?.anchor ?? null, clickedPath: path, range: event.shiftKey, additive: event.ctrlKey || event.metaKey });
    setFileSelection({ ...next, repositoryId: repository.id, stage });
    props.onSelectRepository(repository.id);
    props.onSelectFile(path, stage);
  }
  function showFileMenu(event: GitContextEvent, path: string, stage: ChangeStage, orderedPaths: string[], position: { x: number; y: number }): void {
    if (!repository || !orderedPaths.includes(path)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const current = fileSelection?.repositoryId === repository.id && fileSelection.stage === stage ? fileSelection : null;
    const selectedPaths = pruneGitFileSelection(current?.selectedPaths ?? [], orderedPaths);
    // Compute the menu target synchronously: setState does not update this event's closure.
    const paths = selectedPaths.includes(path) ? selectedPaths : [path];
    setFileSelection({ repositoryId: repository.id, stage, selectedPaths: paths, anchor: paths.length > 1 ? current?.anchor ?? path : path });
    props.onFileMenu(event, { kind: 'file', repositoryId: repository.id, ref: path, stage, paths }, position);
  }
  function pruneVisibleFileRows(stage: ChangeStage, orderedPaths: string[]): void {
    setFileSelection((current) => {
      if (!current || current.repositoryId !== repository?.id || current.stage !== stage) return current;
      const selectedPaths = pruneGitFileSelection(current.selectedPaths, orderedPaths);
      const anchor = current.anchor && orderedPaths.includes(current.anchor) ? current.anchor : null;
      return selectedPaths.join('\0') === current.selectedPaths.join('\0') && anchor === current.anchor ? current : { ...current, selectedPaths, anchor };
    });
  }
  const stageDiff = props.selectedFileStage === 'staged' ? props.selectedRepository?.snapshot.stagedDiff : props.selectedRepository?.snapshot.unstagedDiff;
  const selectedDiff = stageDiff?.fileDiffs.find((file) => (file.newPath === props.selectedFilePath || file.oldPath === props.selectedFilePath) && matchesSubtree(file.newPath || file.oldPath)) ?? null;
  return (
    <div className="project-git-changes-layout project-git-navigator-layout" data-commit-active={commitActive}>
      <aside className="project-git-change-tree" data-empty={emptyVisibleChanges || undefined} onKeyDown={navigateGitFileRows}>
        <header>
          <strong>{props.zh ? '变更文件' : 'Changed files'}</strong>
          <GitFileViewSelect zh={props.zh} value={fileView} disabled={!repository || visibleChangeCount === 0} onChange={next => {
            setFileView(next);
            try {
              localStorage.setItem('astragit.git.file-view.v1', next);
            } catch {
              /* 存储不可用时保留当前会话选择。 */
            }
          }} />
          <span>{visibleChangeCount}</span>
          {subtree?.repositoryId === props.selectedRepository?.id ? (
            <button type="button" onClick={props.onClearSubtree}>
              {props.zh ? '清除目录筛选' : 'Clear folder filter'}
            </button>
          ) : null}
        </header>
        <p className="project-git-file-selection-status" role="status" aria-live="polite">
          {selectedRows.length ? (props.zh ? `已选择 ${selectedRows.length} 个文件 · 右键批量操作` : `${selectedRows.length} files selected · Right-click for actions`) : props.zh ? 'Shift 连选 · Ctrl / ⌘ 多选' : 'Shift for range · Ctrl / ⌘ to select multiple'}
        </p>
        {emptyVisibleChanges ? (
          <div className="project-git-clean-state" role="status">
            <span className="project-git-empty-symbol">
              <CheckCircle aria-hidden="true" />
            </span>
            <strong>{workspaceClean ? (props.zh ? '工作区干净' : 'Working tree clean') : props.zh ? '没有匹配的更改' : 'No matching changes'}</strong>
            <span>{workspaceClean ? (props.zh ? '没有待暂存或提交的文件。' : 'There are no files to stage or commit.') : props.zh ? '调整文件或目录筛选可查看其他更改。' : 'Adjust the file or folder filter to view other changes.'}</span>
          </div>
        ) : (
          <div className="project-git-stage-panels">
            {(['staged', 'unstaged'] as const).map((stage) => {
              const files = visibleStageFiles[stage];
              const title = stage === 'staged' ? (props.zh ? '已暂存' : 'Staged') : props.zh ? '未暂存' : 'Unstaged';
              return (
                <Fragment key={stage}>
                  {stage === 'unstaged' ? <GitPaneSeparator name="stages" label={props.zh ? '调整已暂存与未暂存区域高度' : 'Resize staged and unstaged panels'} axis="y" initial={50} min={15} max={85} /> : null}
                  <section className="project-git-stage-panel" aria-label={title}>
                    <header data-git-context={repository ? JSON.stringify({ kind: 'stage', repositoryId: repository.id, ref: title, stage }) : undefined}>
                      <label className="project-git-stage-select-all">
                        <input
                          type="checkbox"
                          checked={stage === 'staged' && files.length > 0}
                          disabled={!repository || !files.length || props.busy !== null}
                          aria-label={stage === 'staged' ? (props.zh ? '取消暂存全部显示文件' : 'Unstage all displayed files') : props.zh ? '暂存全部显示文件' : 'Stage all displayed files'}
                          title={stage === 'staged' ? (props.zh ? '取消暂存全部显示文件' : 'Unstage all displayed files') : props.zh ? '暂存全部显示文件' : 'Stage all displayed files'}
                          onChange={() => {
                            if (repository && files.length && !props.busy)
                              void props.onExecute(
                                repository,
                                { type: stage === 'staged' ? 'unstage' : 'stage', paths: files },
                                stage === 'staged' ? (props.zh ? '取消暂存全部显示文件' : 'Unstage all displayed files') : props.zh ? '暂存全部显示文件' : 'Stage all displayed files',
                              );
                          }}
                        />
                        <strong>{title}</strong>
                      </label>
                      <span>{files.length}</span>
                    </header>
                    <div className="project-git-stage-scroll">
                      {repository && files.length > 0 ? (
                        <ChangeDirectoryTree
                          view={fileView}
                          files={files}
                          stage={stage}
                          repository={repository}
                          busy={props.busy}
                          zh={props.zh}
                          selectedPaths={fileSelection?.stage === stage ? selectedRows : []}
                          onSelectRows={selectFileRows}
                          onVisiblePathsChange={pruneVisibleFileRows}
                          onOpenDiff={props.onOpenDiff}
                          activeFileMenu={props.activeFileMenu}
                          onFileMenu={showFileMenu}
                          onExecute={props.onExecute}
                        />
                      ) : (
                        <p className="project-git-stage-empty">{stage === 'staged' ? (props.zh ? '暂无已暂存文件' : 'No staged files') : props.zh ? '暂无未暂存文件' : 'No unstaged files'}</p>
                      )}
                    </div>
                  </section>
                </Fragment>
              );
            })}
          </div>
        )}
      </aside>
      <GitPaneSeparator name="files" trailingMin={240} label={props.zh ? '调整文件列表宽度' : 'Resize file list'} initial={30} min={15} max={65} />
      <main className="project-git-change-diff">
        {repository && selectedConflict ? (
          <GitConflictEditor client={props.client} projectId={props.projectId} repositoryId={repository.id} filePath={props.selectedFilePath} zh={props.zh} disabled={props.busy !== null} revision={props.previewRevision}
            onExternalMerge={() => props.onExternalTool({ repository, input: { mode: 'merge', paths: [props.selectedFilePath] } })}
            onSaved={(result) => props.onConflictSaved(repository.id, props.selectedFilePath, result)} />
        ) : emptyVisibleChanges ? (
          <div className="project-git-change-diff-empty" role="status">
            <span className="project-git-empty-symbol">
              <CheckCircle aria-hidden="true" />
            </span>
            <strong>{workspaceClean ? (props.zh ? '当前分支没有本地更改' : 'No local changes on this branch') : props.zh ? '当前目录没有可比较的变更' : 'No comparable changes in this folder'}</strong>
            <span>
              {workspaceClean
                ? props.zh
                  ? '修改文件后，可在这里逐项查看差异。'
                  : 'Edit a file to inspect its diff here.'
                : props.zh
                  ? '清除目录筛选，或选择其他目录查看差异。'
                  : 'Clear the folder filter or select another folder to inspect changes.'}
            </span>
          </div>
        ) : (
          repository && props.selectedFilePath ? <GitLineChanges client={props.client} projectId={props.projectId} repositoryId={repository.id} path={props.selectedFilePath} stage={props.selectedFileStage}
            fallback={selectedDiff ? { isRepository: true, files: [selectedDiff.newPath || selectedDiff.oldPath], diffText: stageDiff?.diffText ?? '', fileDiffs: [selectedDiff] } : null}
            revision={props.previewRevision} zh={props.zh} busy={props.busy !== null}
            onExecute={(action, label) => props.onExecute(repository, action, label)}
            onConfirm={(action, title, description) => props.onConfirmAction(repository, action, title, description, true)} /> : <SideBySideDiff diff={null} zh={props.zh} />
        )}
      </main>
      {commitActive ? (
        <>
          <GitPaneSeparator name="commit" label={props.zh ? '调整提交区域高度' : 'Resize commit panel'} axis="y" initial={65} min={25} max={85} />
          <aside className="project-git-commit-rail project-git-commit-composer">
            <div className="project-git-commit-summary" role="status">
              <strong>{repository?.name ?? (props.zh ? '请选择仓库' : 'Select a repository')}</strong>
              <small>{props.zh ? `${stagedCount} 个已暂存文件 · 仅提交当前仓库` : `${stagedCount} staged files · Current repository only`}</small>
              {stagedCount === 0 ? <small>{props.zh ? '勾选左侧文件进行暂存后即可提交。' : 'Select files on the left to stage them before committing.'}</small> : null}
            </div>
            <div className="project-git-commit-message">
              <div className="project-git-commit-message-heading">
                <label htmlFor="project-git-commit-message">{props.zh ? '提交说明' : 'Commit message'}</label>
                <div className="project-git-commit-generation-controls">
                  <GitCommitOptionsMenu zh={props.zh} repository={repository} disabled={!repository || props.busy !== null || generating}
                    options={commitOptions} onChange={setCommitOptions} onAmend={(target, options) => {
                      setCommitOptions({});
                      props.onAmend(target, options);
                    }} />
                  <small className="project-git-commit-generation-feedback" role="status">{staleDraft ? (props.zh ? '提交范围已变化，可重新生成。' : 'Staged content changed. You can regenerate the message.') : props.generationFeedback}</small>
                  <GitCommitAiControls
                    zh={props.zh}
                    models={props.commitModels}
                    modelDisabled={props.generatingCommitFor !== null}
                    generating={generating}
                    disabled={!generating && (!repository || stagedCount === 0 || props.busy !== null || props.generatingCommitFor !== null || commitModelsLoading || !commitModelRef)}
                    onClick={() => {
                      if (generating) props.onStopCommitGeneration();
                      else if (repository) void props.onGenerateCommitMessage(repository);
                    }}
                    onOpenSettings={props.onOpenModelSettings}
                  />
                </div>
              </div>
              <textarea
                ref={commitInputRef}
                id="project-git-commit-message"
                value={message}
                rows={3}
                placeholder={props.zh ? '简要描述本次修改，可换行补充详情' : 'Describe this change; add details on subsequent lines'}
                disabled={!repository || props.busy !== null || generating}
                onChange={(event) => {
                  if (repository) props.commitMessages.write(repository.id, event.currentTarget.value, scope ?? undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !event.nativeEvent.isComposing && !props.busy && !generating) {
                    event.preventDefault();
                    setEditingRepository(null);
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void commitCurrentRepository();
                  }
                }}
              />
            </div>
            <div className="project-git-commit-actions">
              <label className="project-git-commit-push-option" title={pushTarget ? `${pushTarget.remote}/${pushTarget.targetBranch}${pushTarget.setUpstream ? (props.zh ? '（跟踪此远程分支）' : ' (track this remote branch)') : ''}` : props.zh ? '请先配置远程与分支推送目标；游离 HEAD 无法自动推送。' : 'Configure a remote and branch target first; detached HEAD cannot be pushed automatically.'}>
                <input type="checkbox" checked={pushAfterCommit} disabled={!pushTarget || props.busy !== null || generating} onChange={event => setPushSelection(event.target.checked ? pushKey : null)} />
                <span>{pushTarget ? (props.zh ? `立即推送变更到 ${pushTarget.remote}/${pushTarget.targetBranch}` : `Push changes immediately to ${pushTarget.remote}/${pushTarget.targetBranch}`) : (props.zh ? '提交后立即推送（暂无可用目标）' : 'Push after commit (no target available)')}</span>
              </label>
              <Button variant="secondary" disabled={props.busy !== null || generating} onClick={() => setEditingRepository(null)}>
                {props.zh ? '取消' : 'Cancel'}
              </Button>
              <Button variant="primary" onClick={() => void commitCurrentRepository()} disabled={!canCommit} busy={props.busy?.action === 'commit' || props.busy?.action === 'push'}>
                {pushAfterCommit ? (props.zh ? '提交并推送' : 'Commit and push') : props.zh ? '提交已暂存变更' : 'Commit staged changes'}
              </Button>
              {props.repositories.length > 1 ? (
                <Button variant="secondary" onClick={() => props.onCommit(commitOptions)} disabled={props.busy !== null || props.generatingCommitFor !== null}>
                  {props.zh ? '多仓库提交…' : 'Commit across repositories…'}
                </Button>
              ) : null}
            </div>
          </aside>
        </>
      ) : (
        <aside className="project-git-commit-collapsed">
          <span title={repository?.name}>{repository?.name ?? (props.zh ? '提交' : 'Commit')}</span>
          <button
            type="button"
            disabled={!repository || workspaceClean}
            aria-label={workspaceClean ? (props.zh ? '当前仓库没有可提交的变更' : 'No changes to commit in this repository') : props.zh ? '展开提交说明编辑区' : 'Expand commit message editor'}
            onClick={() => {
              if (repository) setEditingRepository(repository.id);
            }}
          >
            {message.split(/\r?\n/u)[0] ||
              (workspaceClean
                ? props.zh
                  ? '工作区干净'
                  : 'Working tree clean'
                : stagedCount > 0
                  ? props.zh
                    ? '填写提交说明…'
                    : 'Enter a commit message…'
                  : props.zh
                    ? '先暂存文件，再填写提交说明…'
                    : 'Stage files before entering a commit message…')}
          </button>
        </aside>
      )}
    </div>
  );
}

interface ChangeTreeNode {
  name: string;
  path: string;
  children: Map<string, ChangeTreeNode>;
  file: boolean;
}

function visibleChangeFileRows(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[data-git-file-path]') ?? [])]
    .filter((row) => !row.closest('details:not([open])') && row.checkVisibility());
}

function ChangeDirectoryTree(props: {
  view?: 'tree' | 'flat';
  files: string[];
  stage: ChangeStage;
  repository: ProjectGitRepositoryWorkbenchItem;
  busy: BusyState;
  zh: boolean;
  selectedPaths: string[];
  onSelectRows: (event: ReactMouseEvent, path: string, stage: ChangeStage, orderedPaths: string[]) => void;
  onVisiblePathsChange: (stage: ChangeStage, orderedPaths: string[]) => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: { stage?: 'combined' | ChangeStage }) => void;
  activeFileMenu: GitContextTarget | null;
  onFileMenu: (event: GitContextEvent, path: string, stage: ChangeStage, orderedPaths: string[], position: { x: number; y: number }) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const root = useRef<HTMLDivElement>(null);
  function visiblePaths(): string[] {
    return visibleChangeFileRows(root.current).map((row) => row.dataset.gitFilePath!);
  }
  const nodes = useMemo(
    () => (props.view === 'flat' ? [...props.files].sort((a, b) => a.localeCompare(b)).map((path): ChangeTreeNode => ({ name: path, path, file: true, children: new Map() })) : [...buildChangeTree(props.files).children.values()]),
    [props.files.join('\0'), props.view],
  );
  if (props.files.length === 0) return null;
  return (
    <div ref={root} className="project-git-change-directory-tree" role="group" aria-label={props.zh ? '更改文件多选列表' : 'Changed file selection'}>
      {nodes.map((node) => (
        <ChangeTreeEntry key={node.path} node={node} depth={0} {...props} visiblePaths={visiblePaths} onTreeToggle={() => props.onVisiblePathsChange(props.stage, visiblePaths())} />
      ))}
    </div>
  );
}

function ChangeTreeEntry(props: Parameters<typeof ChangeDirectoryTree>[0] & { node: ChangeTreeNode; depth: number; visiblePaths: () => string[]; onTreeToggle: () => void }) {
  if (!props.node.file) {
    return (
      <details className="project-git-change-folder" open onToggle={props.onTreeToggle}>
        <summary data-git-context={JSON.stringify({ kind: 'directory', repositoryId: props.repository.id, ref: props.node.path, stage: props.stage })} style={{ paddingLeft: `${props.depth * 13 + 6}px` }}>
          <CaretRight aria-hidden="true" />
          <Folder aria-hidden="true" />
          <span>{props.node.name}</span>
        </summary>
        {Array.from(props.node.children.values()).map((child) => (
          <ChangeTreeEntry key={child.path} {...props} node={child} depth={props.depth + 1} />
        ))}
      </details>
    );
  }
  const selected = props.selectedPaths.includes(props.node.path);
  const checked = props.stage === 'staged';
  const status = props.repository.snapshot.fileStatuses.find((file) => file.path === props.node.path);
  const conflicted = props.repository.snapshot.conflictFiles.includes(props.node.path);
  const category = conflicted ? 'conflict' : gitFileStatusCategory(status, props.stage);
  const submodule = props.repository.snapshot.submodules?.some((item) => item.path === props.node.path) ?? false;
  const menuOpen = Boolean(props.activeFileMenu?.kind === 'file' && props.activeFileMenu.repositoryId === props.repository.id && props.activeFileMenu.ref === props.node.path && props.activeFileMenu.stage === props.stage);
  const menuLabel = props.zh ? `${props.node.path} · ${checked ? '已暂存' : '未暂存'}文件操作` : `${props.node.path} · ${checked ? 'Staged' : 'Unstaged'} file actions`;
  return (
    <SelectableRow
      className="project-git-change-file-row"
      selected={selected}
      data-git-file-path={props.node.path}
      data-git-context={JSON.stringify({ kind: 'file', repositoryId: props.repository.id, ref: props.node.path, stage: props.stage })}
      onContextMenu={(event) => {
        // macOS emits contextmenu instead of click for Control-click on a file name.
        if (event.ctrlKey && (event.target as Element).closest('[data-git-file-select]')) {
          event.preventDefault();
          event.stopPropagation();
          props.onSelectRows(event, props.node.path, props.stage, props.visiblePaths());
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        props.onFileMenu(event, props.node.path, props.stage, props.visiblePaths(), { x: event.clientX || rect.left, y: event.clientY || rect.bottom + 4 });
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={props.busy !== null}
        title={conflicted ? (props.zh ? '暂存磁盘上的合并结果并标记为已解决' : 'Stage the merge result on disk and mark it resolved') : undefined}
        aria-label={checked ? (props.zh ? `取消暂存 ${props.node.path}` : `Unstage ${props.node.path}`) : props.zh ? `暂存 ${props.node.path}` : `Stage ${props.node.path}`}
        onChange={() =>
          void props.onExecute(
            props.repository,
            checked ? { type: 'unstage', paths: [props.node.path] } : { type: 'stage', paths: [props.node.path] },
            checked ? (props.zh ? '取消暂存文件' : 'Unstage file') : props.zh ? '暂存文件' : 'Stage file',
          )
        }
      />
      <button
        type="button"
        data-git-file-select
        style={{ marginLeft: `${props.depth * 13}px` }}
        title={`${props.node.path} · ${gitFileStatusLabel(category, props.zh)}`}
        aria-pressed={selected}
        onClick={(event) => props.onSelectRows(event, props.node.path, props.stage, props.visiblePaths())}
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          props.onFileMenu(event, props.node.path, props.stage, props.visiblePaths(), { x: rect.left, y: rect.bottom + 4 });
        }}
        onDoubleClick={(event) => { if (!conflicted && !event.shiftKey && !event.ctrlKey && !event.metaKey) props.onOpenDiff(props.repository, props.node.path, { stage: props.stage }); }}
      >
        {submodule ? <Folder aria-hidden="true" /> : <GitFileStatusIcon category={category} zh={props.zh} />}
        <span>{props.node.name}</span>
      </button>
      <button
        type="button"
        className="project-git-file-actions"
        aria-label={menuLabel}
        title={props.zh ? '文件操作' : 'File actions'}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          props.onFileMenu(event, props.node.path, props.stage, props.visiblePaths(), { x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <DotsThree aria-hidden="true" />
      </button>
    </SelectableRow>
  );
}

function buildChangeTree(paths: string[]): ChangeTreeNode {
  const root: ChangeTreeNode = { name: '', path: '', children: new Map(), file: false };
  for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
    let current = root;
    const parts = path.split('/').filter(Boolean);
    parts.forEach((part, index) => {
      const childPath = parts.slice(0, index + 1).join('/');
      const next = current.children.get(part) ?? { name: part, path: childPath, children: new Map<string, ChangeTreeNode>(), file: index === parts.length - 1 };
      current.children.set(part, next);
      current = next;
    });
  }
  return root;
}
