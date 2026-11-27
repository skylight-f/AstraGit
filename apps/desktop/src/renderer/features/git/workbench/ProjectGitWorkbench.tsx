import { GitFlowDialog } from '../branches/GitFlowDialog.js';
import { GitLfsDialog } from '../files/GitLfsDialog.js';
import { GitStageReviewDialog } from '../changes/GitStageReviewDialog.js';
import { GitExternalToolDialog } from '../repository/GitExternalToolDialog.js';
import { GitSubmoduleManagementDialog } from '../repository/GitSubmoduleManagementDialog.js';
import { DotsThreeIcon as DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { GitCommitIcon as GitCommit } from '@phosphor-icons/react/dist/csr/GitCommit';
import { GitMergeIcon as GitMerge } from '@phosphor-icons/react/dist/csr/GitMerge';
import { ArrowDownIcon as ArrowDown } from '@phosphor-icons/react/dist/csr/ArrowDown';
import { ArrowUpIcon as ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp';
import { BranchSwitcher, MergeBranchDialog, UpdateProjectDialog, NewBranchDialog, RemoteBranchCheckoutDialog, CheckoutRevisionDialog, BranchDirectoryTree, PullDialog, PushDialog } from '../repository/GitRepositoryControls.js';
import { MotionPresence } from '../../../ui/MotionPresence.js';
import { GitContextMenu, GitMenuActionDialog } from '../components/GitContextMenu.js';
import { GitPaneSeparator } from '../components/GitPaneSeparator.js';
import { stagedCommitUnits } from '../changes/sourceGitState.js';
import { ProjectSourceChanges } from '../changes/ProjectSourceChanges.js';
import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArchiveIcon as Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon as ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { FolderIcon as Folder } from '@phosphor-icons/react/dist/csr/Folder';
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import { TagIcon as Tag } from '@phosphor-icons/react/dist/csr/Tag';
import { SearchInput, Select } from '../../../ui/FormControls.js';
import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { GitHistorySearchField } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { ModalPortal } from '../../../ui/ModalPortal.js';
import { ProjectGitDiffWindow } from '../diff/ProjectGitDiffViewer.js';
import { GitAmendDialog } from '../commits/GitAmendDialog.js';
import { GitInteractiveRebaseDialog } from '../history/GitInteractiveRebaseDialog.js';
import { GitRepositorySettingsDialog } from '../repository/GitRepositorySettingsDialog.js';
import { GitBranchManagementDialog } from '../branches/GitBranchManagementDialog.js';
import { GitRevisionActionDialog } from '../history/GitRevisionActionDialog.js';
import { GitIgnoreDialog } from '../files/GitIgnoreDialog.js';
import { GitStopTrackingDialog } from '../files/GitStopTrackingDialog.js';
import { GitIgnoredFiles } from '../files/GitIgnoredFiles.js';
import { GitFileHistoryDialog } from '../history/GitFileHistoryDialog.js';
import { GitPatchDialog } from '../patches/GitPatchDialog.js';
import { GitArchiveDialog } from '../archive/GitArchiveDialog.js';
import { GitCommitReplayDialog } from '../history/GitCommitReplayDialog.js';
import { GitCommitReplaySeriesDialog } from '../history/GitCommitReplaySeriesDialog.js';
import { GitTagManagementDialog } from '../repository/GitTagManagementDialog.js';
import '../files/gitFileTracking.css';
import { gitConflictMessage, gitIntegrationLabel } from './gitOperationFeedback.js';
import { GitLogSurface } from '../history/GitLogSurface.js';
import { LocalChangesSurface } from '../changes/LocalChangesSurface.js';
import { StashDialog } from '../stash/StashDialog.js';
import { StashSurface } from '../stash/StashSurface.js';
import { RepositoryNavigationTree } from '../repository/RepositoryNavigationTree.js';
import { SubtreeManagementDialog } from '../repository/SubtreeManagementDialog.js';
import { CommitDialog } from '../commits/CommitDialog.js';
import { GitOperationConsole, operationActionLabels } from './GitOperationConsole.js';
import { GitOperationProgress, GitOperationStopButton } from '../components/GitOperationProgress.js';
import { GitOperationsMenu } from './GitOperationsMenu.js';
import type { GitContextTarget, ProjectGitWorkbenchProps } from './gitWorkbenchTypes.js';
import { useProjectGitWorkbench } from './useProjectGitWorkbench.js';
import { ProjectGitInitialChanges } from './ProjectGitInitialChanges.js';

export function ProjectGitWorkbench(props: ProjectGitWorkbenchProps) {
  const {
    selection: {
      activeSidebarReference, activeStash, activeStashRef, checkoutSidebarBranch, repositories,
      selectedRepository, selectedRepositoryId, setSelectedRepositoryId, selectedCommitHash,
      selectCommit, setSelectedCommit, selectedFilePath, selectedFileStage, setSelectedFilePath,
      setSelectedFileStage, setSelectedStashRef, setSidebarReference, subtree, setSubtree, tab, setTab,
    },
    history: {
      allCommits, commitDetail, commitLoading, historyError, historyField, historyKey, historyLoading,
      historyOrder, historyPage, historyRef, loadHistory, openReferenceHistory, searchQuery,
      setHistoryField, setHistoryOrder, setHistoryRef, setSearchQuery,
    },
    drafts: {
      commitAndPush, commitGenerationFeedback, commitMessages, commitRequest, generateCommitMessage,
      generatingCommitFor, openCommit, openCommitDialog, openToolbarCommit, preview,
      stopCommitGeneration,
    },
    dialogs: {
      amendRequest, amendStepRepository, archiveRequest, branchManagement, commitDialogOptions,
      diffWindowRequest, externalToolRequest, fileHistoryRequest, flowRequest, ignoreRequest,
      interactiveRebase, lfsRequest, mergeOpen, mergeOptions, newBranchBase, newBranchOpen, openAmend,
      openDiffWindow, openPush, operationsOpen, operationsTriggerRef, patchRequest, pullOpen, pushOpen,
      remoteCheckoutRepository, remoteCheckoutTarget, replayRequest, replaySeriesRequest, revisionAction,
      revisionOpen, setAmendRequest, setAmendStepRepository, setArchiveRequest, setBranchManagement,
      setCommitDialogOptions, setDiffWindowRequest, setExternalToolRequest, setFileHistoryRequest, setFlowRequest,
      setIgnoreRequest, setInteractiveRebase, setLfsRequest, setMergeOpen, setMergeOptions,
      setNewBranchBase, setNewBranchOpen, setOperationsOpen, setPatchRequest, setPullOpen, setPushOpen,
      setRemoteCheckoutTarget, setReplayRequest, setReplaySeriesRequest, setRevisionAction,
      setRevisionOpen, setSettingsRepository, setStashRepositoryId, setStopTrackingRequest,
      setSubmoduleRequest, setSubtreeDialogOpen, setTagRequest, setUpdateOpen, settingsRepository,
      stashRepository, stopTrackingRequest, submoduleRequest, subtreeDialogOpen, tagRequest, updateOpen,
    },
    operations: {
      activeOperationRepository, busy, cancelGitAction, checkoutNotice, confirmApplyStash, conflictAction,
      conflictCount, openFlowConflicts, openSubmoduleRepository,
      conflictRepository, conflictSaved, contextMenu, execute, executeWithResult, finishStageReview,
      launchRepositoryFile, menuConfirmation, operationErrorsByRepository, operationHistory,
      operationNoticeRoot, pushResults, pushSelectedBranches, pushStopping, setCheckoutNotice, setConflictAction,
      setContextMenu, setMenuConfirmation, setPushResults, setStagePreferenceNotice, showGitContextMenu,
      stagePreferenceNotice, stageRequest, stopOperation, stopPush,
    },
    workspace: {
      error, fileQuery, ignoredQuery, initialChanges, loadState, loadWorkbench, refreshWorkbench, reportWorkbenchError,
      requestVersionRef, setFileQuery, setIgnoredQuery, setSnapshot, setSourceTarget, snapshot,
      sourceCommands, sourceLocked, sourceView, sourceVisible, zh,
    },
  } = useProjectGitWorkbench(props);

  const historyReferences = tab === 'log' && selectedRepository ? ([
    ['heads', zh ? '本地' : 'Local', selectedRepository.snapshot.localBranches],
    ['remotes', zh ? '远程' : 'Remote', selectedRepository.snapshot.remoteBranches],
    ['tags', zh ? '标签' : 'Tag', selectedRepository.snapshot.tags],
  ] as const).flatMap(([namespace, label, refs]) => refs.map(ref => ({
    value: `refs/${namespace}/${ref}`,
    label: `${label} · ${ref}`,
  }))) : [];
  const missingHistoryRef = historyRef && historyRef !== 'HEAD' && !historyReferences.some(ref => ref.value === historyRef);

  let workbenchState: ReactNode = null;
  if (!snapshot) {
    workbenchState = (
      <ProjectGitInitialChanges changes={initialChanges} zh={zh}
        error={loadState === 'error' ? (error ?? (zh ? '无法读取项目 Git 状态。' : 'Could not load project Git status.')) : null}
        onRetry={refreshWorkbench} />
    );
  } else if (repositories.length === 0) {
    workbenchState = (
      <section className="project-git-workbench-state">
        <GitBranch aria-hidden="true" />
        <strong>{zh ? '这个项目中没有发现 Git 仓库' : 'No Git repository was found'}</strong>
        <span>{zh ? '请检查项目目录是否包含 Git 仓库，然后重新扫描。' : 'Check that the project folder contains a Git repository, then scan again.'}</span>
        <Button variant="secondary" onClick={() => void loadWorkbench()}>
          {zh ? '重新扫描' : 'Scan again'}
        </Button>
      </section>
    );
  }

  const commandsDisabled = busy !== null || sourceLocked;
  const toolbar = (
    <header className="project-git-toolbar git-command-toolbar" aria-label={zh ? 'Git 工具栏' : 'Git toolbar'}>
      <Button size="compact" variant="ghost" data-desktop-menu-command="commit" disabled={!selectedRepository || commandsDisabled} onClick={openToolbarCommit}>
        <GitCommit aria-hidden="true" />
        <span>{zh ? '提交' : 'Commit'}</span>
      </Button>
      <i />
      <Button size="compact" variant="ghost" data-desktop-menu-command="pull" disabled={!selectedRepository || commandsDisabled || selectedRepository.snapshot.detached || !selectedRepository.snapshot.remotes.length} onClick={() => setPullOpen(true)}>
        <ArrowDown aria-hidden="true" />
        <span>{zh ? '拉取' : 'Pull'}</span>
        {selectedRepository?.snapshot.behind ? <small>{selectedRepository.snapshot.behind}</small> : null}
      </Button>
      <Button size="compact" variant="ghost" data-desktop-menu-command="push" disabled={!selectedRepository || commandsDisabled || selectedRepository.snapshot.detached || !selectedRepository.snapshot.remotes.length} onClick={openPush}>
        <ArrowUp aria-hidden="true" />
        <span>{zh ? '推送' : 'Push'}</span>
        {selectedRepository?.snapshot.ahead ? <small>{selectedRepository.snapshot.ahead}</small> : null}
      </Button>
      <Button size="compact" variant="ghost" data-desktop-menu-command="fetch"

        disabled={!selectedRepository || commandsDisabled || !selectedRepository.snapshot.remotes.length}
        onClick={() => {
          if (selectedRepository) void execute(selectedRepository, { type: 'fetch' }, zh ? '获取远端' : 'Fetch');
        }}
      >
        <ArrowsClockwise aria-hidden="true" />
        <span>{zh ? '抓取' : 'Fetch'}</span>
      </Button>
      <i />
      <Button size="compact" variant="ghost" data-desktop-menu-command="branch"

        disabled={!selectedRepository || commandsDisabled}
        onClick={() => {
          setNewBranchBase('');
          setNewBranchOpen(true);
        }}
      >
        <GitBranch aria-hidden="true" />
        <span>{zh ? '分支' : 'Branch'}</span>
      </Button>
      <Button size="compact" variant="ghost" data-desktop-menu-command="merge" disabled={!selectedRepository || commandsDisabled || selectedRepository.snapshot.detached || Boolean(selectedRepository.snapshot.integrationState)} onClick={() => setMergeOpen(true)}>
        <GitMerge aria-hidden="true" />
        <span>{zh ? '合并' : 'Merge'}</span>
      </Button>
      <Button size="compact" variant="ghost" data-desktop-menu-command="tag" disabled={!selectedRepository || commandsDisabled} onClick={() => selectedRepository && setTagRequest({ repository: selectedRepository })}><Tag aria-hidden="true" /><span>{zh ? '标签' : 'Tag'}</span></Button>
      <Button size="compact" variant="ghost" data-desktop-menu-command="stash"

        disabled={!selectedRepository || commandsDisabled || selectedRepository.snapshot.clean || selectedRepository.snapshot.conflictFiles.length > 0}
        onClick={() => {
          if (selectedRepository) setStashRepositoryId(selectedRepository.id);
        }}
      >
        <Archive aria-hidden="true" />
        <span>{zh ? '贮藏' : 'Stash'}</span>
      </Button>
      <span className="project-git-menu-anchor">
        <Button size="compact" variant="ghost" data-desktop-menu-command="git-actions" ref={operationsTriggerRef} disabled={!selectedRepository || commandsDisabled} aria-haspopup="menu" aria-expanded={operationsOpen} onClick={() => setOperationsOpen((current) => !current)}>
          <DotsThree aria-hidden="true" />
          <span>{zh ? '操作' : 'Actions'}</span>
        </Button>
        <MotionPresence>
          {operationsOpen ? (
            <GitOperationsMenu
              anchor={operationsTriggerRef.current}
              zh={zh}
              onClose={() => setOperationsOpen(false)}
              onOpenCommit={openToolbarCommit}
              onOpenExternalTools={selectedRepository && !busy ? () => setExternalToolRequest({ repository: selectedRepository }) : undefined}
              onOpenFlow={selectedRepository && !busy ? () => setFlowRequest({ repository: selectedRepository }) : undefined}
              onOpenLfs={selectedRepository && !busy ? () => setLfsRequest({ repository: selectedRepository }) : undefined}
              onOpenSubmodules={selectedRepository && !busy ? () => setSubmoduleRequest({ repository: selectedRepository }) : undefined}
              onOpenTags={selectedRepository && !busy ? () => setTagRequest({ repository: selectedRepository }) : undefined}
              onImportPatch={selectedRepository && !busy ? () => setPatchRequest({ repository: selectedRepository, mode: 'import' }) : undefined}
              onExportPatch={selectedRepository && !busy ? () => setPatchRequest({ repository: selectedRepository, mode: 'export' }) : undefined}
              onExportArchive={selectedRepository?.snapshot.headSha && !busy ? () => setArchiveRequest({ repository: selectedRepository }) : undefined}
              onOpenFileHistory={selectedRepository ? () => setFileHistoryRequest({ repository: selectedRepository }) : undefined}
              onOpenInteractiveRebase={selectedRepository && busy === null && selectedRepository.snapshot.headSha && !selectedRepository.snapshot.integrationState ? () => setInteractiveRebase({ repository: selectedRepository }) : undefined}
              onOpenDeleteBranches={selectedRepository && busy === null ? () => setBranchManagement({ kind: 'delete-local', repository: selectedRepository }) : undefined}
              onOpenDeleteRemoteBranches={selectedRepository && busy === null && selectedRepository.snapshot.remoteBranches.length > 0 ? () => setBranchManagement({ kind: 'delete-remote', repository: selectedRepository }) : undefined}
              onOpenSettings={selectedRepository && busy === null ? () => setSettingsRepository(selectedRepository) : undefined}
              onOpenAmend={selectedRepository && busy === null && selectedRepository.snapshot.headSha && !selectedRepository.snapshot.integrationState && !selectedRepository.snapshot.conflictFiles.length && selectedRepository.snapshot.indexFingerprint ? () => openAmend(selectedRepository) : undefined}
              onOpenPush={openPush}
              onOpenUpdate={() => setUpdateOpen(true)}
              onOpenNewBranch={() => {
                setNewBranchBase('');
                setNewBranchOpen(true);
              }}
              onOpenRevision={() => setRevisionOpen(true)}
              onSelectTab={nextTab => {
                if (sourceVisible && selectedRepository) setSelectedRepositoryId(selectedRepository.id);
                setTab(nextTab);
              }}
              onOpenConsole={() => setTab('console')}
              onOpenSubtree={() => setSubtreeDialogOpen(true)}
            />
          ) : null}
        </MotionPresence>
      </span>

      <Button size="compact" variant="ghost" data-desktop-menu-command="refresh" disabled={commandsDisabled} onClick={refreshWorkbench}>
        <ArrowsClockwise aria-hidden="true" />
        <span>{zh ? '刷新' : 'Refresh'}</span>
      </Button>
    </header>
  );

  return (
    <section
      className="project-git-workbench"
      ref={operationNoticeRoot}
      onContextMenu={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[data-git-context]');
        if (element?.dataset.gitContext) showGitContextMenu(event, JSON.parse(element.dataset.gitContext) as GitContextTarget);
      }}
      aria-label={zh ? '仓库管理' : 'Repository management'}
    >
      {stagePreferenceNotice && !busy && !selectedRepository?.snapshot.integrationState && !checkoutNotice ? <aside className="git-operation-notice"><span role="status">{stagePreferenceNotice}</span><Button variant="secondary" size="compact" onClick={() => setStagePreferenceNotice('')}>{zh ? '关闭' : 'Close'}</Button></aside> : null}
      {busy && !pushOpen && !pullOpen ? (
        <aside className="git-operation-notice" aria-label={zh ? "Git 操作状态" : "Git operation status"}>
          <GitOperationProgress repositoryName={activeOperationRepository?.name} action={operationActionLabels[busy.action][zh ? 0 : 1]} />
          <GitOperationStopButton zh={zh} size="compact" onStop={() => stopOperation(busy.repositoryId)} onStopError={reportWorkbenchError} />
        </aside>
      ) : null}
      {!busy && (selectedRepository?.snapshot.integrationState || checkoutNotice) ? (
        <aside className="git-operation-notice" aria-label={zh ? 'Git 操作状态' : 'Git operation status'}>
          <span className="git-operation-notice-status" role="status">
            {selectedRepository?.snapshot.integrationState ? <WarningCircle aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}
            <span>
              <strong>{!selectedRepository?.snapshot.integrationState && checkoutNotice ? repositories.find(repository => repository.id === checkoutNotice.repositoryId)?.name : activeOperationRepository?.name}</strong>
              <span>{selectedRepository?.snapshot.integrationNoCommit ? (zh ? `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}待完成：解决并暂存冲突，先提交已应用内容，再继续剩余提交。` : `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)} in progress: resolve and stage conflicts, commit the applied contents, then continue the remaining commits.`) : selectedRepository?.snapshot.integrationState ? (zh ? `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}待完成` : `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)} in progress`) : zh ? `已切换到 ${checkoutNotice?.branch}；本地修改保留在贮藏中` : `Switched to ${checkoutNotice?.branch}; local changes remain in a stash`}</span>
            </span>
          </span>
          <div className="git-operation-notice-actions">
            {!selectedRepository?.snapshot.integrationState && checkoutNotice ? <><Button variant="secondary" size="compact" onClick={() => { setSelectedRepositoryId(checkoutNotice.repositoryId); setSelectedStashRef(repositories.find(repository => repository.id === checkoutNotice.repositoryId)?.snapshot.stashes.find(stash => stash.hash === checkoutNotice.savedStash)?.ref ?? ''); setTab('stash'); setCheckoutNotice(null); }}>{zh ? '查看贮藏' : 'View stash'}</Button><Button variant="secondary" size="compact" onClick={() => setCheckoutNotice(null)}>{zh ? '关闭' : 'Close'}</Button></> : null}
            {selectedRepository?.snapshot.integrationState ? (
              <>
                {selectedRepository.snapshot.integrationNoCommit ? <Button variant="secondary" size="compact" disabled={busy !== null || selectedRepository.snapshot.conflictFiles.length > 0 || !selectedRepository.snapshot.fileStatuses.some(file => file.indexStatus !== ' ' && file.indexStatus !== '?')} onClick={openCommit}>{zh ? '先提交已应用内容…' : 'Commit applied changes first…'}</Button> : null}
                {selectedRepository.snapshot.rebaseEdit ? <Button variant="secondary" size="compact" disabled={busy !== null || selectedRepository.snapshot.conflictFiles.length > 0} onClick={() => setAmendStepRepository(selectedRepository)}>{zh ? '修订当前变基步骤…' : 'Amend current rebase step…'}</Button> : null}
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy !== null || selectedRepository.snapshot.conflictFiles.length > 0 || Boolean(selectedRepository.snapshot.integrationNoCommit && selectedRepository.snapshot.fileStatuses.some(file => file.indexStatus !== ' ' && file.indexStatus !== '?'))}
                  title={selectedRepository.snapshot.integrationNoCommit ? (zh ? '先手动提交已应用内容，再继续剩余提交。' : 'Commit the applied changes manually before continuing the remaining commits.') : undefined}
                  onClick={() => void execute(selectedRepository, { type: 'continue_integration', kind: selectedRepository.snapshot.integrationState! }, `${zh ? '继续' : 'Continue '}${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}`)}
                >
                  {zh ? '继续' : 'Continue'}
                </Button>
                {selectedRepository.snapshot.integrationState !== 'merge' ? <Button variant="secondary" size="compact" disabled={busy !== null} onClick={() => {
                  const kind = selectedRepository.snapshot.integrationState;
                  if (kind && kind !== 'merge') setRevisionAction({ type: 'skip', repository: selectedRepository, kind });
                }}>{zh ? '跳过当前提交…' : 'Skip current commit…'}</Button> : null}
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy !== null}
                  onClick={() => {
                    const kind = selectedRepository.snapshot.integrationState!;
                    const title = `${zh ? '终止' : 'Abort '}${gitIntegrationLabel(kind, zh)}`;
                    setMenuConfirmation({ title, danger: true, description: kind === 'cherry_pick' || kind === 'revert' ? (zh ? `${selectedRepository.name}\n终止当前序列并回到整合开始时的提交。序列中已创建的提交及未提交的处理结果可能被撤回；开始前已暂存的内容也可能被移除。请先另存需要保留的内容。` : `${selectedRepository.name}\nAbort this sequence and return to its starting commit. Commits created during the sequence and uncommitted resolutions can be undone. Contents staged before the sequence can also be removed. Save work you need to keep separately first.`) : zh ? `${selectedRepository.name}\n终止当前${gitIntegrationLabel(kind, zh)}并恢复操作前状态。当前整合中尚未提交的冲突处理结果会被放弃，请确认需要保留的内容已另行保存。` : `${selectedRepository.name}\nAbort this ${gitIntegrationLabel(kind, zh)} and return to the pre-operation state. Uncommitted conflict resolutions from this operation will be discarded. Save any work you want to keep first.`, run: async () => (await execute(selectedRepository, { type: 'abort_integration', kind }, title)) === 'completed' });
                  }}
                >
                  {zh ? `终止${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}…` : `Abort ${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}…`}
                </Button>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}

      {conflictCount > 0 ? (
        <section className="project-git-conflict-banner" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>
              <strong>{zh ? `项目共有 ${conflictCount} 个冲突文件 · ${conflictRepository?.name}` : `${conflictCount} conflicted files in this project · ${conflictRepository?.name}`}</strong>
              <small>{conflictAction && conflictRepository && conflictAction.repositoryId === conflictRepository.id
                ? gitConflictMessage(conflictAction.action, conflictAction.result, conflictRepository.snapshot, zh)
                : conflictRepository?.snapshot.integrationNoCommit ? (zh ? '本次序列不自动提交。请先解决并暂存冲突、手动提交已应用内容，再继续剩余提交；结束后剩余暂存内容仍需手动提交。终止前请另存需要保留的内容。' : 'This sequence does not commit automatically. Resolve and stage conflicts, manually commit applied changes, then continue the remaining commits. Commit remaining staged contents after completion. Save work you need to keep before aborting.')
                : zh ? '打开对应仓库的文件状态，逐个解决冲突并暂存，再继续或终止当前整合；贮藏产生的冲突请勿重复应用。' : 'Open File Status for the affected repository, then resolve and stage the files. Continue or abort the active integration; do not reapply a stash that already produced conflicts.'}</small>
          </span>
          <Button variant="secondary" size="compact" onClick={() => { if (conflictRepository) { setSelectedRepositoryId(conflictRepository.id); setSelectedFilePath(conflictRepository.snapshot.conflictFiles[0] ?? ''); setSelectedFileStage('unstaged'); } setTab('changes'); }}>
            {zh ? '处理冲突' : 'Resolve conflicts'}
          </Button>
        </section>
      ) : null}

      {props.commandHost && (props.commitViewNavigation || sourceVisible || !snapshot || !workbenchState) ? createPortal(
        <div className="git-command-strip">
          {props.commitViewNavigation}
          {toolbar}
        </div>,
        props.commandHost,
      ) : null}
      {sourceView && snapshot ? (
        <div className="project-git-source-view" hidden={!sourceVisible}>
          <ProjectSourceChanges
            project={props.project}
            client={props.client}
            language={props.language}
            active={sourceView.active}
            commitModels={props.commitModels}
            onOpenModelSettings={props.onOpenModelSettings}
            onBusyChange={sourceView.onBusyChange}
            snapshot={snapshot}
            setSnapshot={setSnapshot}
            refreshVersion={requestVersionRef}
            commitMessages={commitMessages}
            generationPreview={preview}
            generatingFor={generatingCommitFor}
            onGenerate={generateCommitMessage}
            onStopGeneration={stopCommitGeneration}
            selectedRepositoryId={selectedRepositoryId}
            onSelectRepository={setSelectedRepositoryId}
            onStageAction={execute}
            onAmend={openAmend}
            repositoryCommandBusy={busy !== null}
            commandsRef={sourceCommands}
            onCommandTargetChange={setSourceTarget}
          />
        </div>
      ) : null}
      {workbenchState ? (!sourceVisible || !snapshot ? workbenchState : null) : (
      <div className="project-git-browser-layout" data-view={tab} hidden={sourceVisible}>
        <aside className="project-git-navigator" aria-label={zh ? 'Git 导航' : 'Git navigation'}>
          <section className="git-history-repositories" aria-label={zh ? '仓库导航' : 'Repository navigation'}>
            <header className="git-history-pane-heading">{zh ? '仓库' : 'Repositories'}</header>
            <div className="git-history-navigation-scroll">
              <div className="git-toolbar-identity">
                {selectedRepository ? (
                  <BranchSwitcher
                    cascadeRepositories
                    zh={zh}
                    repositories={repositories}
                    selectedRepository={selectedRepository}
                    busy={busy}
                    onSelectRepository={setSelectedRepositoryId}
                    onExecute={execute}
                    onManageBranch={setBranchManagement}
                    onOpenDiff={openDiffWindow}
                    onOpenUpdate={() => setUpdateOpen(true)}
                    onOpenCommit={openCommit}
                    onOpenPush={openPush}
                    onOpenNewBranch={(baseRef) => {
                      setNewBranchBase(baseRef ?? '');
                      setNewBranchOpen(true);
                    }}
                    onOpenRevision={() => setRevisionOpen(true)}
                  />
                ) : null}
              </div>
              {selectedRepository?.snapshot.submodules?.length ? (
                <details>
                  <summary className="project-git-reference-section-heading">
                    <span>{zh ? '子模块管理' : 'Submodule management'}</span>
                  </summary>
                  <button type="button" disabled={busy !== null} onClick={() => setSubmoduleRequest({ repository: selectedRepository })}>{zh ? '添加或管理子模块…' : 'Add or manage submodules…'}</button>
                  {selectedRepository.snapshot.submodules.map((module) => (
                    <button
                      type="button"
                      key={module.path}
                      disabled={busy !== null}
                      title={zh ? '检出父仓库记录的子模块提交，保留未提交修改；有冲突时 Git 会拒绝更新。' : 'Check out the recorded submodule commit without forcing local changes.'}
                      onClick={() => void execute(selectedRepository, { type: 'submodule_update', path: module.path }, zh ? '初始化/更新子模块' : 'Initialize/update submodule')}
                    >
                      <span>{module.path}</span>
                      <small>{module.initialized ? (zh ? '更新' : 'Update') : zh ? '初始化' : 'Initialize'}</small>
                    </button>
                  ))}
                </details>
              ) : null}
              {[
                { title: zh ? '仓库' : 'Repositories', items: repositories.filter((repository) => !repository.isSubmodule) },
                { title: zh ? '子模块' : 'Submodules', items: repositories.filter((repository) => repository.isSubmodule) },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <details key={group.title} open>
                    <summary className="project-git-reference-section-heading">
                      <span>{group.title}</span>
                      <small>{group.items.length}</small>
                    </summary>
                    <RepositoryNavigationTree
                      repositories={group.items}
                      zh={zh}
                      selectedId={selectedRepository?.id}
                      onSelect={(id) => {
                        setSubtree(null);
                        setSelectedRepositoryId(id);
                        setSelectedFilePath('');
                        setSelectedCommit(null);
                        if (tab === 'stash') setTab('log');
                      }}
                    />
                  </details>
                ))}
            </div>
          </section>
          <GitPaneSeparator name="navigation-repositories" label={zh ? '调整仓库与分支面板高度' : 'Resize repository and branch panels'} axis="y" initial={44} min={20} max={80} />
          <section className="git-history-branches" aria-label={zh ? '分支与引用' : 'Branches and refs'}>
            <header className="git-history-pane-heading">{zh ? '分支与引用' : 'Branches and refs'}</header>
            <div className="git-history-navigation-scroll">
              {selectedRepository ? (
                <>
                  {(
                    [
                      [zh ? '分支' : 'Branches', selectedRepository.snapshot.localBranches, 'local', 'heads'],
                      [zh ? '远程' : 'Remotes', selectedRepository.snapshot.remoteBranches, 'remote', 'remotes'],
                      [zh ? '标签' : 'Tags', selectedRepository.snapshot.tags, 'local', 'tags'],
                    ] as const
                  ).map(([title, branches, kind, namespace]) => (
                    <details key={title} open={branches === selectedRepository.snapshot.localBranches ? true : undefined}>
                      <summary className="project-git-reference-section-heading">
                        {branches === selectedRepository.snapshot.localBranches ? <GitBranch className="project-git-branch-section-icon" aria-hidden="true" /> : null}
                        <span>{title}</span>
                        <small>{branches.length}</small>
                      </summary>
                      <BranchDirectoryTree
                        hideBranchIcons={branches === selectedRepository.snapshot.localBranches}
                        branches={[...branches]}
                        current={branches === selectedRepository.snapshot.localBranches && !selectedRepository.snapshot.detached ? selectedRepository.snapshot.branch : ''}
                        selected={activeSidebarReference === 'HEAD' && namespace === 'heads'
                          ? selectedRepository.snapshot.branch
                          : activeSidebarReference.startsWith(`refs/${namespace}/`) ? activeSidebarReference.slice(`refs/${namespace}/`.length) : ''}
                        showActions={tab !== 'log'}
                        activeMenuRef={contextMenu?.target.repositoryId === selectedRepository.id && contextMenu.target.kind === (namespace === 'tags' ? 'tag' : kind) ? contextMenu.target.ref : undefined}
                        branchDivergences={
                          branches === selectedRepository.snapshot.localBranches
                            ? {
                                ...selectedRepository.snapshot.branchDivergences,
                                [selectedRepository.snapshot.branch]: {
                                  ahead: selectedRepository.snapshot.ahead,
                                  behind: selectedRepository.snapshot.behind,
                                },
                              }
                            : undefined
                        }
                        kind={kind}
                        zh={zh}
                        onSelect={(ref) => {
                          const reference = `refs/${namespace}/${ref}`;
                          if (tab === 'log' || tab === 'stash') openReferenceHistory(selectedRepository, reference);
                          else setSidebarReference({ repositoryId: selectedRepository.id, ref: reference });
                        }}
                        onCheckout={branches === selectedRepository.snapshot.tags ? undefined : ref => checkoutSidebarBranch(selectedRepository, kind, ref)}
                        onContextMenu={(event, ref) => {
                          const target: GitContextTarget = { kind: namespace === 'tags' ? 'tag' : kind, repositoryId: selectedRepository.id, ref };
                          if (event.type === 'contextmenu' && 'clientX' in event && (event.clientX || event.clientY)) {
                            showGitContextMenu(event, target);
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          const anchor = event.type === 'click' && event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : undefined;
                          showGitContextMenu(event, target, { x: rect.left, y: rect.bottom + 4 }, anchor);
                        }}
                      />
                    </details>
                  ))}
                  <details>
                    <summary className="project-git-reference-section-heading">
                      <span>{zh ? '贮藏区' : 'Stashes'}</span>
                      <small>{selectedRepository.snapshot.stashes.length}</small>
                    </summary>
                    {selectedRepository.snapshot.stashes.map((stash) => (
                      <button
                        key={stash.ref}
                        className="project-git-navigation-stash"
                        data-git-context={JSON.stringify({ kind: 'stash', repositoryId: selectedRepository.id, ref: stash.ref })}
                        type="button"
                        aria-current={tab === 'stash' && activeStashRef === stash.ref ? 'true' : undefined}
                        onClick={() => {
                          setSelectedStashRef(stash.ref);
                          setTab('stash');
                        }}
                        title={stash.subject}
                      >
                        <Archive aria-hidden="true" />
                        <span>{stash.subject}</span>
                      </button>
                    ))}
                  </details>
                  <details>
                    <summary className="project-git-reference-section-heading">
                      <span>{zh ? '子树' : 'Subtrees'}</span>
                    </summary>
                    {(selectedRepository.subtreePaths ?? []).map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => {
                          setSubtree({ repositoryId: selectedRepository.id, path });
                          setSelectedFilePath('');
                          setTab('changes');
                        }}
                      >
                        <Folder aria-hidden="true" />
                        <span>{path}</span>
                      </button>
                    ))}
                  </details>
                </>
              ) : null}
            </div>
          </section>
        </aside>
        <GitPaneSeparator name="navigation" trailingMin={240} label={zh ? '调整 Git 导航宽度' : 'Resize Git navigation'} initial={20} min={12} max={40} />
        <div className="project-git-browser-content">
          <div className={`git-content-toolbar${tab === 'log' ? ' is-history-toolbar' : ''}`}>
            <strong>{tab === 'changes' || tab === 'ignored' ? (zh ? '文件状态' : 'File Status') : tab === 'log' ? (zh ? '提交历史' : 'Commit history') : tab === 'stash' ? (zh ? '贮藏' : 'Stashes') : zh ? '操作记录' : 'Operation history'}</strong>
            {tab === 'stash' ? <Button className="git-stash-back" variant="ghost" size="compact" onClick={() => setTab('log')}>{zh ? '返回提交历史' : 'Back to commit history'}</Button> : null}
            {(tab === 'changes' || tab === 'ignored') && selectedRepository ? <Select
              density="compact"
              ariaLabel={zh ? '文件范围' : 'File scope'}
              value={tab}
              onChange={value => setTab(value === 'ignored' ? 'ignored' : 'changes')}
              options={[
                { value: 'changes', label: zh ? '更改文件' : 'Changed files' },
                { value: 'ignored', label: zh ? '已忽略文件' : 'Ignored files' },
              ]}
            /> : null}
            {tab === 'log' && selectedRepository ? (
              <Select
                density="compact"
                ariaLabel={zh ? '历史分支范围' : 'History branch scope'}
                searchPlaceholder={zh ? '搜索分支或标签…' : 'Search branches or tags…'}
                value={historyRef}
                onChange={value => {
                  setHistoryRef(value);
                  setSelectedCommit(null);
                  setSelectedFilePath('');
                }}
                options={[
                  { value: '', label: zh ? '全部分支' : 'All branches' },
                  { value: 'HEAD', label: zh ? '当前分支' : 'Current branch' },
                  ...(missingHistoryRef ? [{ value: historyRef, label: historyRef.replace(/^refs\/(?:heads|remotes|tags)\//u, '') }] : []),
                  ...historyReferences,
                ]}
              />
            ) : null}
            {tab === 'log' ? <>
              <Select
                density="compact"
                ariaLabel={zh ? '历史搜索字段' : 'History search field'}
                value={historyField}
                onChange={value => setHistoryField(value as GitHistorySearchField)}
                options={[
                  { value: 'all', label: zh ? '全部字段' : 'All fields' },
                  { value: 'message', label: zh ? '完整提交说明' : 'Full commit message' },
                  { value: 'author', label: zh ? '作者' : 'Author' },
                  { value: 'hash', label: zh ? '提交哈希' : 'Commit hash' },
                ]}
              />
              <Select
                density="compact"
                ariaLabel={zh ? '历史排序' : 'History order'}
                value={historyOrder}
                onChange={value => setHistoryOrder(value === 'date' ? 'date' : 'topo')}
                options={[
                  { value: 'topo', label: zh ? '拓扑顺序' : 'Ancestor order' },
                  { value: 'date', label: zh ? '日期顺序' : 'Date order' },
                ]}
              />
            </> : null}
            {tab === 'changes' || tab === 'ignored' || tab === 'log' ? (
              <SearchInput
                density="compact"
                aria-label={tab === 'ignored' ? (zh ? '筛选当前忽略范围' : 'Filter current ignored scope') : tab === 'changes' ? (zh ? '筛选更改文件' : 'Filter changed files') : zh ? '搜索提交' : 'Search commits'}
                value={tab === 'ignored' ? ignoredQuery : tab === 'changes' ? fileQuery : searchQuery}
                onChange={(event) => (tab === 'ignored' ? setIgnoredQuery(event.currentTarget.value) : tab === 'changes' ? setFileQuery(event.currentTarget.value) : setSearchQuery(event.currentTarget.value))}
                placeholder={tab === 'ignored' ? (zh ? '筛选当前范围…' : 'Filter current scope…') : tab === 'changes' ? (zh ? '筛选文件…' : 'Filter files…') : zh ? '搜索完整历史的说明、作者或哈希…' : 'Search all history by message, author or hash…'}
              />
            ) : null}
          </div>
          {tab === 'log' ? (
            <GitLogSurface
              projectId={props.project.id}
              client={props.client}
              zh={zh}
              selectionScope={historyKey}
              onExportSeries={(repository, revisions) => setPatchRequest({ repository, mode: 'export', scope: 'series', revisions })}
              onExportComparison={(repository, revisions, path) => setPatchRequest({ repository, mode: 'export', scope: 'range', baseRef: revisions[0], targetRef: revisions[1], paths: path ? [path] : undefined })}
              onCommitMenu={(event, repository, ref, commits, position) => showGitContextMenu(event, { kind: 'commit', repositoryId: repository.id, ref, commits }, position)}
              commits={allCommits.filter(({ repository }) => repository.id === selectedRepository?.id)}
              historyLoading={historyLoading}
              historyError={historyError}
              historyHasMore={historyPage?.key === historyKey && historyPage.hasMore}
              onLoadMore={() => void loadHistory(true)}
              onReloadHistory={() => void loadHistory(false)}
              selectedRepository={selectedRepository}
              selectedCommitHash={commitDetail?.commit.hash ?? selectedCommitHash}
              commitDetail={commitDetail}
              commitLoading={commitLoading}
              selectedFilePath={selectedFilePath}
              onSelectCommit={selectCommit}
              onOpenChanges={() => setTab('changes')}
              onSelectFile={setSelectedFilePath}
              busy={busy}
              onOpenDiff={openDiffWindow}
              onInteractiveRebase={(repository, baseRef) => setInteractiveRebase({ repository, baseRef })}
              onPatchExport={(repository, revision, path) => setPatchRequest({ repository, mode: 'export', scope: 'commit', revision, paths: path ? [path] : undefined })}
              onArchive={(repository, revision) => setArchiveRequest({ repository, revision })}
              onExternalTool={setExternalToolRequest}
              onCreateTag={(repository, revision) => setTagRequest({ repository, mode: 'create', revision })}
              onFileHistory={(repository, path, ref, view) => setFileHistoryRequest({ repository, path, ref, view })}
              onReset={(repository, revision) => setRevisionAction({ type: 'reset', repository, revision })}
              onReplay={(repository, kind, revision, mainline) => setReplayRequest({ repository, kind, revision, mainline })}
            />
          ) : tab === 'ignored' ? (
            selectedRepository ? <GitIgnoredFiles key={selectedRepository.id} projectId={props.project.id} repository={selectedRepository} client={props.client} zh={zh} query={ignoredQuery} busy={busy !== null}
              onOpenFile={(path, intent) => launchRepositoryFile(selectedRepository, path, intent)} onOpenChanges={() => setTab('changes')}
              onExecute={executeWithResult} /> : <p className="project-git-empty-copy">{zh ? '请选择一个仓库。' : 'Select a repository.'}</p>
          ) : tab === 'changes' ? (
            <LocalChangesSurface
              client={props.client}
              query={fileQuery}
              commitRequest={commitRequest}
              onExternalTool={setExternalToolRequest}
              previewRevision={snapshot?.refreshedAt}
              projectId={props.project.id}
              subtree={subtree}
              onClearSubtree={() => setSubtree(null)}
              zh={zh}
              onOpenStash={() => setTab('stash')}
              repositories={repositories}
              selectedRepository={selectedRepository}
              selectedFilePath={selectedFilePath}
              selectedFileStage={selectedFileStage}
              busy={busy}
              onSelectRepository={setSelectedRepositoryId}
              onSelectFile={(path, stage) => {
                setSelectedFilePath(path);
                setSelectedFileStage(stage);
              }}
              onOpenDiff={openDiffWindow}
              activeFileMenu={contextMenu?.target ?? null}
              onFileMenu={showGitContextMenu}
              onExecute={execute}
              onCommitAndPush={commitAndPush}
              onConflictSaved={conflictSaved}
              onConfirmAction={(repository, action, title, description, danger) =>
                setMenuConfirmation({
                  title,
                  description: `${repository.name}\n${description}`,
                  danger,
                  run: async () => (await execute(repository, action, title)) !== null,
                })
              }
              onCommit={openCommitDialog}
              onAmend={openAmend}
              commitMessages={commitMessages}
              commitModels={props.commitModels}
              onOpenModelSettings={props.onOpenModelSettings}
              generationPreview={preview}
              generatingCommitFor={generatingCommitFor}
              generationFeedback={selectedRepository ? commitGenerationFeedback[selectedRepository.id] : undefined}
              onGenerateCommitMessage={repository => generateCommitMessage(stagedCommitUnits([repository]))}
              onStopCommitGeneration={stopCommitGeneration}
            />
          ) : tab === 'stash' ? (
            <StashSurface
              projectId={props.project.id}
              zh={zh}
              repository={selectedRepository}
              stash={activeStash}
              detail={commitDetail?.commit.hash === activeStash?.hash ? commitDetail : null}
              loading={commitLoading}
              selectedFilePath={selectedFilePath}
              busy={busy}
              onSelectFile={setSelectedFilePath}
              onOpenDiff={openDiffWindow}
              onApplyStash={confirmApplyStash}
              onExecute={execute}
            />
          ) : (
            <GitOperationConsole zh={zh} history={operationHistory} />
          )}
        </div>
      </div>
      )}

      <MotionPresence>{mergeOptions ? <MergeBranchDialog key={`${mergeOptions.repository.id}:${mergeOptions.source}`} repository={mergeOptions.repository} initialBranch={mergeOptions.source} zh={zh} busy={busy} onClose={() => setMergeOptions(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{mergeOpen && selectedRepository ? <MergeBranchDialog repository={selectedRepository} zh={zh} busy={busy} onClose={() => setMergeOpen(false)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>
        {subtreeDialogOpen && selectedRepository ? <SubtreeManagementDialog key={selectedRepository.id} repository={selectedRepository} zh={zh} busy={busy} onClose={() => setSubtreeDialogOpen(false)} onExecute={execute} /> : null}
      </MotionPresence>
      <MotionPresence>{contextMenu ? <GitContextMenu {...contextMenu} onClose={() => setContextMenu(null)} onError={reportWorkbenchError} /> : null}</MotionPresence>
      <MotionPresence>{menuConfirmation ? <GitMenuActionDialog value={menuConfirmation} zh={zh} onClose={() => setMenuConfirmation(null)} /> : null}</MotionPresence>
      <MotionPresence>{commitDialogOptions ? <CommitDialog commitMessages={commitMessages} initialOptions={commitDialogOptions} zh={zh} repositories={repositories} busy={busy} onClose={() => setCommitDialogOptions(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{interactiveRebase ? <GitInteractiveRebaseDialog key={`${props.project.id}:${interactiveRebase.repository.id}:${interactiveRebase.baseRef ?? 'default'}`} request={interactiveRebase} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setInteractiveRebase(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{amendStepRepository ? <GitAmendDialog key={`rebase:${amendStepRepository.id}`} projectId={props.project.id} client={props.client} repository={amendStepRepository} rebaseStep zh={zh} busy={busy !== null} onClose={() => setAmendStepRepository(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{amendRequest ? <GitAmendDialog key={amendRequest.repository.id} projectId={props.project.id} client={props.client} repository={amendRequest.repository} options={amendRequest.options} zh={zh} busy={busy !== null} onClose={() => setAmendRequest(null)} onExecute={execute} /> : null}</MotionPresence>
      {stageRequest ? <GitStageReviewDialog key={stageRequest.preview.fingerprint} repositoryName={stageRequest.repository.name} preview={stageRequest.preview} zh={zh} selectionHint={stageRequest.selectionHint} onDecide={finishStageReview} /> : null}
      {flowRequest ? <GitFlowDialog key={JSON.stringify([props.project.id, flowRequest.repository.id, flowRequest.change])} request={flowRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setFlowRequest(null)} onResolve={() => openFlowConflicts(flowRequest.repository.id)} onAbort={() => cancelGitAction(flowRequest.repository.id)} onExecute={executeWithResult} /> : null}
      {lfsRequest ? <GitLfsDialog key={JSON.stringify([props.project.id, lfsRequest.repository.id, lfsRequest.change])} request={lfsRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setLfsRequest(null)} onAbort={() => cancelGitAction(lfsRequest.repository.id)} onExecute={executeWithResult} /> : null}
      {externalToolRequest ? <GitExternalToolDialog key={JSON.stringify([externalToolRequest.repository.id, externalToolRequest.input])} request={externalToolRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setExternalToolRequest(null)} onAbort={() => cancelGitAction(externalToolRequest.repository.id)} onExecute={async (repository, action, label) => {
        const result = await executeWithResult(repository, action, label);
        if (action.type === 'external_tool' && action.input.mode === 'merge') {
          setSelectedRepositoryId(repository.id); setTab('changes'); setSelectedFilePath(action.input.paths[0] ?? ''); setSelectedFileStage(result.outcome === 'completed' && action.input.markResolved ? 'staged' : 'unstaged');
        }
        return result;
      }} /> : null}
      {submoduleRequest ? <GitSubmoduleManagementDialog key={JSON.stringify([submoduleRequest.repository.id, submoduleRequest.path])} repository={submoduleRequest.repository} initialPath={submoduleRequest.path} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setSubmoduleRequest(null)} onAbort={() => cancelGitAction(submoduleRequest.repository.id)} onOpenRepository={path => openSubmoduleRepository(submoduleRequest.repository, path)} onExecute={executeWithResult} /> : null}
      <MotionPresence>{settingsRepository ? <GitRepositorySettingsDialog key={settingsRepository.id} projectId={props.project.id} client={props.client} repository={settingsRepository} zh={zh} busy={busy !== null} onClose={() => setSettingsRepository(null)} onExecute={execute} /> : null}</MotionPresence>
      {tagRequest ? <GitTagManagementDialog key={JSON.stringify([tagRequest.repository.id, tagRequest.mode, tagRequest.revision, tagRequest.tagName])} request={tagRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setTagRequest(null)} onOpenCommit={hash => { setSelectedRepositoryId(tagRequest.repository.id); setTab('log'); selectCommit(tagRequest.repository, hash); setTagRequest(null); }} onAbort={() => cancelGitAction(tagRequest.repository.id)} onExecute={executeWithResult} /> : null}
      {patchRequest ? <GitPatchDialog key={JSON.stringify([patchRequest.repository.id, patchRequest.mode, patchRequest.scope, patchRequest.revision, patchRequest.paths, patchRequest.revisions])} request={patchRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setPatchRequest(null)} onAbort={() => cancelGitAction(patchRequest.repository.id)} onExecute={executeWithResult} /> : null}
      {fileHistoryRequest ? <GitFileHistoryDialog key={JSON.stringify([fileHistoryRequest.repository.id, fileHistoryRequest.path, fileHistoryRequest.ref, fileHistoryRequest.view])} request={fileHistoryRequest} projectId={props.project.id} client={props.client} zh={zh} onClose={() => setFileHistoryRequest(null)} onOpenCommit={hash => { setSelectedRepositoryId(fileHistoryRequest.repository.id); setTab('log'); selectCommit(fileHistoryRequest.repository, hash); setFileHistoryRequest(null); }} /> : null}
      <MotionPresence>{stopTrackingRequest ? <GitStopTrackingDialog key={JSON.stringify([stopTrackingRequest.repository.id, stopTrackingRequest.paths])} request={stopTrackingRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setStopTrackingRequest(null)} onExecute={executeWithResult} /> : null}</MotionPresence>
      <MotionPresence>{ignoreRequest ? <GitIgnoreDialog key={ignoreRequest.repository.id} request={ignoreRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setIgnoreRequest(null)} onExecute={executeWithResult} /> : null}</MotionPresence>
      <MotionPresence>{branchManagement ? <GitBranchManagementDialog key={`${branchManagement.repository.id}:${branchManagement.kind}`} request={branchManagement} zh={zh} busy={busy !== null} onClose={() => setBranchManagement(null)} onAbort={() => cancelGitAction(branchManagement.repository.id)} onExecute={executeWithResult} /> : null}</MotionPresence>
      <MotionPresence>{revisionAction ? <GitRevisionActionDialog key={`${revisionAction.repository.id}:${revisionAction.type}:${revisionAction.type === 'reset' ? revisionAction.revision : revisionAction.kind}`} request={revisionAction} client={props.client} projectId={props.project.id} zh={zh} busy={busy !== null} onClose={() => setRevisionAction(null)} onAbort={() => cancelGitAction(revisionAction.repository.id)} onExecute={executeWithResult} onCompleted={preview => {
        setConflictAction(null);
        if (revisionAction.type === 'reset') { setSelectedRepositoryId(revisionAction.repository.id); setHistoryRef(preview.detached ? 'HEAD' : `refs/heads/${preview.branch}`); setTab('log'); selectCommit(revisionAction.repository, preview.targetSha); }
      }} /> : null}</MotionPresence>
      <MotionPresence>{stashRepository ? <StashDialog key={stashRepository.id} repository={stashRepository} zh={zh} busy={busy} onClose={() => setStashRepositoryId(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>
        {updateOpen ? (
          <UpdateProjectDialog
            open={updateOpen}
            projectId={props.project.id}
            zh={zh}
            repositories={repositories}
            busy={busy}
            errorsByRepository={operationErrorsByRepository}
            onClose={() => setUpdateOpen(false)}
            onExecute={execute}
          />
        ) : null}
      </MotionPresence>
      <MotionPresence>
        {newBranchOpen ? (
          <NewBranchDialog open={newBranchOpen} zh={zh} repositories={repositories} selectedRepository={selectedRepository} baseRef={newBranchBase} busy={busy} onClose={() => setNewBranchOpen(false)} onExecute={execute} />
        ) : null}
      </MotionPresence>
      <MotionPresence>
        {remoteCheckoutTarget && remoteCheckoutRepository ? (
          <RemoteBranchCheckoutDialog
            key={`${remoteCheckoutTarget.repositoryId}:${remoteCheckoutTarget.remoteRef}`}
            zh={zh}
            repository={remoteCheckoutRepository}
            initialRemoteRef={remoteCheckoutTarget.remoteRef}
            busy={busy}
            onClose={() => setRemoteCheckoutTarget(null)}
            onExecute={execute}
          />
        ) : null}
      </MotionPresence>
      <MotionPresence>
        {revisionOpen ? <CheckoutRevisionDialog open={revisionOpen} zh={zh} repositories={repositories} selectedRepository={selectedRepository} busy={busy} onClose={() => setRevisionOpen(false)} onExecute={execute} /> : null}
      </MotionPresence>
      <MotionPresence>{pullOpen && selectedRepository ? <PullDialog key={selectedRepository.id} repository={selectedRepository} zh={zh} busy={busy} onStop={() => cancelGitAction(selectedRepository.id)} onStopError={reportWorkbenchError} onClose={() => setPullOpen(false)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>
        {pushOpen ? (
          <PushDialog
            open={pushOpen}
            zh={zh}
            repositories={repositories}
            selectedRepository={selectedRepository}
            busy={busy}
            stopping={pushStopping}
            onStop={stopPush}
            results={pushResults}
            onClose={() => {
              setPushOpen(false);
              setPushResults([]);
            }}
            onPush={pushSelectedBranches}
          />
        ) : null}
      </MotionPresence>
      {replaySeriesRequest ? <GitCommitReplaySeriesDialog key={JSON.stringify([props.project.id, replaySeriesRequest.repository.id, replaySeriesRequest.revisions])} request={replaySeriesRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setReplaySeriesRequest(null)} onAbort={() => cancelGitAction(replaySeriesRequest.repository.id)} onExecute={executeWithResult} onCompleted={preview => { if (!preview.input.commit) { setSelectedRepositoryId(replaySeriesRequest.repository.id); setTab('changes'); setSelectedFilePath(preview.files[0] ?? ''); setSelectedFileStage('staged'); } }} /> : null}
      {replayRequest ? <GitCommitReplayDialog key={JSON.stringify([props.project.id, replayRequest.repository.id, replayRequest.kind, replayRequest.revision, replayRequest.mainline])} request={replayRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setReplayRequest(null)} onAbort={() => cancelGitAction(replayRequest.repository.id)} onExecute={executeWithResult} onCompleted={preview => {
        if (!preview.input.commit) { setSelectedRepositoryId(replayRequest.repository.id); setTab('changes'); setSelectedFilePath(preview.files[0]?.path ?? ''); setSelectedFileStage('staged'); }
      }} /> : null}
      {archiveRequest ? <GitArchiveDialog key={JSON.stringify([props.project.id, archiveRequest.repository.id, archiveRequest.revision])} request={archiveRequest} projectId={props.project.id} client={props.client} zh={zh} onClose={() => setArchiveRequest(null)} /> : null}
      {diffWindowRequest ? (
        <ModalPortal role="dialog" aria-label={zh ? '文件差异' : 'File diff'} rootClassName="gitapp-diff-root" onDismiss={() => setDiffWindowRequest(null)}>
          <div className="gitapp-diff-dialog" data-modal-surface="dialog">
            <header>
              <strong title={diffWindowRequest.filePath}>{diffWindowRequest.filePath || (diffWindowRequest.revisions ? `${diffWindowRequest.revisions[0].slice(0, 8)} → ${diffWindowRequest.revisions[1].slice(0, 8)}` : zh ? '文件差异' : 'File diff')}</strong>
              <Button size="compact" onClick={() => setDiffWindowRequest(null)}>{zh ? '关闭' : 'Close'}</Button>
            </header>
            <ProjectGitDiffWindow
              key={`${diffWindowRequest.repositoryId}:${diffWindowRequest.filePath}:${diffWindowRequest.stage}:${diffWindowRequest.commitHash ?? ''}:${diffWindowRequest.comparisonRef ?? ''}:${diffWindowRequest.revisions?.join(':') ?? ''}`}
              client={props.client}
              projectId={props.project.id}
              repositoryId={diffWindowRequest.repositoryId}
              filePath={diffWindowRequest.filePath}
              stage={diffWindowRequest.stage}
              commitHash={diffWindowRequest.commitHash}
              comparisonRef={diffWindowRequest.comparisonRef}
              comparisonMode={diffWindowRequest.comparisonMode}
              revisions={diffWindowRequest.revisions}
              language={props.language}
              appearance="light"
            />
          </div>
        </ModalPortal>
      ) : null}
    </section>
  );
}
