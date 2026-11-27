import type { GitFlowRequest } from '../branches/GitFlowDialog.js';
import type { GitLfsRequest } from '../files/GitLfsDialog.js';
import type { GitStageDecision } from '../changes/GitStageReviewDialog.js';
import { readGitLargeFilePreferences, saveGitLargeFilePreferences } from '../files/gitLargeFilePreferences.js';
import type { GitExternalToolRequest } from '../repository/GitExternalToolDialog.js';
import { pruneGitFileSelection } from '../changes/gitFileSelection.js';
import { gitFileStagePaths } from '../changes/gitFileStages.js';
import { projectGitWorkbenchCacheEntry, readCachedProjectGitWorkbench, requestProjectGitWorkbench, subscribeProjectGitRefresh, notifyProjectGitChanged, visibleRepositoryFiles } from './projectGitWorkbenchState.js';
import { batchSummaryId, useGitCommitDrafts } from '../commits/useGitCommitDrafts.js';
import { commitThenPush, type CommitPushTarget } from '../commits/commitThenPush.js';
import { useGitOperationHistory } from './useGitOperationHistory.js';
import type { GitMenuItem, GitMenuConfirmation } from '../components/GitContextMenu.js';
import { generateStagedCommitDrafts } from '../commits/generateStagedCommitDrafts.js';
import type { SourceCommitUnit } from '../changes/sourceGitState.js';
import type { SourceCommitCommands } from '../changes/ProjectSourceChanges.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GitHistorySearchCommit, GitHistorySearchField, GitStagePreview, ProjectGitAction, ProjectGitActionResponse, ProjectGitCommitDetail, ProjectGitRepositorySnapshot, ProjectGitRepositoryWorkbenchItem, ProjectGitWorkbenchSnapshot } from '../../../api/apiClient.js';
import { reportApplicationError, type ApplicationErrorOptions } from '../../../ui/ApplicationErrorDialog.js';
import type { GitInteractiveRebaseRequest } from '../history/GitInteractiveRebaseDialog.js';
import type { GitBranchManagementRequest } from '../branches/GitBranchManagementDialog.js';
import type { GitRevisionActionRequest } from '../history/GitRevisionActionDialog.js';
import type { GitIgnoreRequest } from '../files/GitIgnoreDialog.js';
import type { GitStopTrackingRequest } from '../files/GitStopTrackingDialog.js';
import type { GitFileHistoryRequest } from '../history/GitFileHistoryDialog.js';
import type { GitPatchDialogRequest } from '../patches/GitPatchDialog.js';
import type { GitArchiveDialogRequest } from '../archive/GitArchiveDialog.js';
import type { GitCommitReplayRequest } from '../history/GitCommitReplayDialog.js';
import type { GitCommitReplaySeriesRequest } from '../history/GitCommitReplaySeriesDialog.js';
import { useGitOperationNoticePlacement } from './useGitOperationNoticePlacement.js';
import type { GitTagManagementRequest } from '../repository/GitTagManagementDialog.js';
import { searchDestinationAvailable } from '../../search/workspaceSearchState.js';
import { describeUserFacingError, splitGitRemoteBranch } from '@astragit/shared';
import { gitFailureCode, gitFailureContext, gitFailureTitle } from './gitOperationFeedback.js';
import { createApplyStashConfirmation } from '../stash/applyStashConfirmation.js';
import { usePushBatch } from '../repository/usePushBatch.js';
import type { BranchKind, BusyState, ChangeStage, ExecutionOutcome, GitContextEvent, GitContextTarget, GitDiffOptions, OperationTone, ProjectGitWorkbenchProps, PushSelection } from './gitWorkbenchTypes.js';

const projectGitViewPreferences = new Map<string, { repositoryId: string; searchQuery: string }>();

export function useProjectGitWorkbench(props: ProjectGitWorkbenchProps) {
  const zh = props.language === 'zh-CN';
  const sourceView = props.sourceView;
  const sourceVisible = Boolean(sourceView?.visible);
  const sourceCommands = useRef<SourceCommitCommands>(null);
  const [sourceTarget, setSourceTarget] = useState<{ repositoryId: string | undefined; locked: boolean }>({ repositoryId: undefined, locked: false });
  const currentProjectId = useRef(props.project.id);
  currentProjectId.current = props.project.id;
  const [snapshot, setSnapshot] = useState<ProjectGitWorkbenchSnapshot | null>(() => readCachedProjectGitWorkbench(props.client, props.project.id));
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(() => (snapshot ? 'ready' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const [conflictAction, setConflictAction] = useState<{ repositoryId: string; action: ProjectGitAction; result: ProjectGitActionResponse['result'] } | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<{ repositoryId: string; branch: string; savedStash: string } | null>(null);
  // errorMessage() reports the original failure once; this state is its inline summary.
  const { tab, onTabChange: setTab } = props;
  const [subtree, setSubtree] = useState<{ repositoryId: string; path: string } | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(() => projectGitViewPreferences.get(props.project.id)?.repositoryId ?? '');
  /** 只有用户点选才建立提交选择，并绑定仓库，避免初始加载或换仓库产生伪选中。 */
  const [selectedCommit, setSelectedCommit] = useState<{ repositoryId: string; ref: string } | null>(null);
  const [selectedStashRef, setSelectedStashRef] = useState('');
  const [diffWindowRequest, setDiffWindowRequest] = useState<{ repositoryId: string; filePath: string; stage: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] } | null>(null);
  const [commitDetail, setCommitDetail] = useState<ProjectGitCommitDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileStage, setSelectedFileStage] = useState<ChangeStage>('unstaged');
  const [searchQuery, setSearchQuery] = useState(() => projectGitViewPreferences.get(props.project.id)?.searchQuery ?? '');
  useEffect(() => {
    projectGitViewPreferences.set(props.project.id, { repositoryId: selectedRepositoryId, searchQuery });
  }, [props.project.id, selectedRepositoryId, searchQuery]);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [stashRepositoryId, setStashRepositoryId] = useState<string | null>(null);
  const operationsTriggerRef = useRef<HTMLButtonElement>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [amendRepository, setAmendRepository] = useState<ProjectGitRepositoryWorkbenchItem | null>(null);
  const [amendStepRepository, setAmendStepRepository] = useState<ProjectGitRepositoryWorkbenchItem | null>(null);
  const [interactiveRebase, setInteractiveRebase] = useState<GitInteractiveRebaseRequest | null>(null);
  const [externalToolRequest, setExternalToolRequest] = useState<GitExternalToolRequest | null>(null);
  const [lfsRequest, setLfsRequest] = useState<GitLfsRequest | null>(null);
  const [flowRequest, setFlowRequest] = useState<GitFlowRequest | null>(null);
  type StageRequest = { repository: ProjectGitRepositoryWorkbenchItem; preview: GitStagePreview; selectionHint?: string; resolve(decision: GitStageDecision): void };
  const [stageRequest, setStageRequest] = useState<StageRequest | null>(null);
  const stageRequestRef = useRef<StageRequest | null>(null);
  const stagePreviewController = useRef<AbortController | null>(null);
  const [stagePreferenceNotice, setStagePreferenceNotice] = useState('');
  useEffect(() => {
    setStageRequest(null); setStagePreferenceNotice('');
    return () => { stagePreviewController.current?.abort(); stageRequestRef.current?.resolve(null); stageRequestRef.current = null; };
  }, [props.project.id]);
  const [submoduleRequest, setSubmoduleRequest] = useState<{ repository: ProjectGitRepositoryWorkbenchItem; path?: string } | null>(null);
  const [settingsRepository, setSettingsRepository] = useState<ProjectGitRepositoryWorkbenchItem | null>(null);
  const [branchManagement, setBranchManagement] = useState<GitBranchManagementRequest | null>(null);
  const [revisionAction, setRevisionAction] = useState<GitRevisionActionRequest | null>(null);
  const [ignoreRequest, setIgnoreRequest] = useState<GitIgnoreRequest | null>(null);
  const [patchRequest, setPatchRequest] = useState<GitPatchDialogRequest | null>(null);
  const [archiveRequest, setArchiveRequest] = useState<GitArchiveDialogRequest | null>(null);
  const operationNoticeRoot = useGitOperationNoticePlacement();
  const [replaySeriesRequest, setReplaySeriesRequest] = useState<GitCommitReplaySeriesRequest | null>(null);
  useEffect(() => { setReplaySeriesRequest(null); }, [props.project.id]);
  const [replayRequest, setReplayRequest] = useState<GitCommitReplayRequest | null>(null);
  useEffect(() => { setReplayRequest(null); }, [props.project.id]);
  useEffect(() => { setArchiveRequest(null); }, [props.project.id]);
  const [tagRequest, setTagRequest] = useState<GitTagManagementRequest | null>(null);
  const [fileHistoryRequest, setFileHistoryRequest] = useState<GitFileHistoryRequest | null>(null);
  const [stopTrackingRequest, setStopTrackingRequest] = useState<GitStopTrackingRequest | null>(null);
  const openAmend = (repository: ProjectGitRepositoryWorkbenchItem) => setAmendRepository(currentSnapshot.current?.repositories.find(item => item.id === repository.id) ?? repository);
  const [commitRequest, setCommitRequest] = useState(0);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeOptions, setMergeOptions] = useState<{ repository: ProjectGitRepositoryWorkbenchItem; source: string } | null>(null);
  const [fileQuery, setFileQuery] = useState('');
  const [ignoredQuery, setIgnoredQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; anchor?: HTMLElement; title: string; items: GitMenuItem[]; target: GitContextTarget } | null>(null);
  const [menuConfirmation, setMenuConfirmation] = useState<GitMenuConfirmation | null>(null);
  const commitMessages = useGitCommitDrafts(props.project.id);
  const { modelRef: commitModelRef, loading: commitModelsLoading } = props.commitModels;
  const [generatingCommitFor, setGeneratingCommitFor] = useState<string | null>(null);
  const [generationPreview, setGenerationPreview] = useState<{ id: string; text: string; original: string } | null>(null);
  const preview = generationPreview && (commitMessages.drafts[generationPreview.id]?.message ?? '') === generationPreview.original ? generationPreview : null;
  const generatingCommitRef = useRef(false);
  const commitGenerationController = useRef<AbortController | null>(null);
  useEffect(() => () => commitGenerationController.current?.abort(), [props.project.id]);
  const { generationFeedback: commitGenerationFeedback, setGenerationFeedback: setCommitGenerationFeedback } = commitMessages;
  const [updateOpen, setUpdateOpen] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchBase, setNewBranchBase] = useState('');
  const [remoteCheckoutTarget, setRemoteCheckoutTarget] = useState<{ repositoryId: string; remoteRef: string } | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const onToolbarBusyChange = sourceView?.onToolbarBusyChange;
  const sourceToolbarBusy = sourceVisible && busy !== null;
  useLayoutEffect(() => {
    onToolbarBusyChange?.(sourceToolbarBusy);
    return () => onToolbarBusyChange?.(false);
  }, [onToolbarBusyChange, sourceToolbarBusy]);
  const actionBusyRef = useRef(false);
  /** 控制台缓存可以销毁，历史由桌面耐久账本恢复。 */
  const operationHistory = useGitOperationHistory(props.client, props.project.id);
  const [pushResults, setPushResults] = useState<Array<{ repositoryId: string; repositoryName: string; tone: OperationTone; message: string }>>([]);
  const pushBatch = usePushBatch(repositoryId => props.client.cancelProjectGitAction(props.project.id, repositoryId), reportWorkbenchError);
  function openPush(): void {
    setPushResults([]);
    setPushOpen(true);
  }
  const requestVersionRef = useRef(0);
  const operationErrorsByRepositoryRef = useRef<Record<string, string>>({});

  const [subtreeDialogOpen, setSubtreeDialogOpen] = useState(false);
  const [historyRef, setHistoryRef] = useState('');
  const [sidebarReference, setSidebarReference] = useState<{ repositoryId: string; ref: string } | null>(null);
  const [historyPage, setHistoryPage] = useState<{ key: string; commits: GitHistorySearchCommit[]; hasMore: boolean; nextCursor: string | null } | null>(null);
  const [historySearch, setHistorySearch] = useState(searchQuery.trim());
  const [historyField, setHistoryField] = useState<GitHistorySearchField>('all');
  const [historyOrder, setHistoryOrder] = useState<'topo' | 'date'>('topo');
  const [historyReload, setHistoryReload] = useState(0);
  const historyAbort = useRef<AbortController | null>(null);
  useEffect(() => { const timer = setTimeout(() => setHistorySearch(searchQuery.trim()), 250); return () => clearTimeout(timer); }, [searchQuery]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyInFlight = useRef<number | null>(null);
  const historyRequest = useRef(0);
  const repositories = useMemo(() => {
    const items = snapshot?.repositories ?? [];
    return items.map((repository) => ({ ...repository, snapshot: { ...repository.snapshot, fileStatuses: visibleRepositoryFiles(repository, items) } }));
  }, [snapshot]);
  const workbenchRepository = repositories.find(repository => repository.id === selectedRepositoryId) ?? repositories[0] ?? null;
  const visibleWorkbenchSelection = { repositoryId: workbenchRepository?.id, path: selectedFilePath, tab: sourceVisible ? null : tab };
  const currentWorkbenchSelection = useRef(visibleWorkbenchSelection);
  currentWorkbenchSelection.current = visibleWorkbenchSelection;
  const selectedRepository = sourceVisible
    ? repositories.find(repository => repository.id === sourceTarget.repositoryId) ?? null
    : workbenchRepository;
  const activeSidebarReference = tab === 'log'
    ? historyRef
    : sidebarReference && sidebarReference.repositoryId === selectedRepository?.id ? sidebarReference.ref : '';
  const sourceLocked = sourceVisible && sourceTarget.locked;
  const autoFetchRepositoryId = props.autoFetchEnabled && selectedRepository?.snapshot.remotes.length
    ? selectedRepository.id : undefined;
  const autoFetchBlocked = useRef(false);
  autoFetchBlocked.current = sourceLocked || busy !== null;
  useEffect(() => {
    if (!autoFetchRepositoryId) return;
    const projectId = props.project.id;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible' || autoFetchBlocked.current || actionBusyRef.current) return;
        void props.client.autoFetchProjectGitRepository(projectId, autoFetchRepositoryId).then(({ fetched }) => {
          if (!fetched) return;
          // The request can finish after switching projects. Refresh its original project only.
          projectGitWorkbenchCacheEntry(props.client, projectId).request = null;
          notifyProjectGitChanged(projectId);
          if (active) setHistoryReload(value => value + 1);
        }).catch(() => { /* Manual fetch provides interactive error feedback. */ });
      }, 250);
    };
    schedule();
    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [props.client, props.project.id, autoFetchRepositoryId]);
  const activeOperationRepository = busy ? repositories.find((repository) => repository.id === busy.repositoryId) : selectedRepository;
  const stashRepository = repositories.find((repository) => repository.id === stashRepositoryId) ?? null;
  const remoteCheckoutRepository = repositories.find((repository) => repository.id === remoteCheckoutTarget?.repositoryId) ?? null;
  const activeStash = selectedRepository?.snapshot.stashes.find((stash) => stash.ref === selectedStashRef) ?? selectedRepository?.snapshot.stashes[0] ?? null;
  const activeStashRef = activeStash?.ref ?? '';
  /** 其他仓库的选择不能借用当前仓库读取详情。 */
  const selectedCommitHash = selectedCommit?.repositoryId === selectedRepository?.id ? (selectedCommit?.ref ?? '') : '';
  // 角标与文件列表使用同一个仓库，不能把其他子模块的改动算进来。
  const conflictCount = repositories.reduce((total, repository) => total + repository.snapshot.conflictFiles.length, 0);
  const conflictRepository = selectedRepository?.snapshot.conflictFiles.length ? selectedRepository : repositories.find((repository) => repository.snapshot.conflictFiles.length > 0);
  const watchedConflictRepositoryId = conflictRepository?.id;
  const watchedConflictRepositoryPath = conflictRepository?.relativePath;
  const watchedConflictPath = tab === 'changes' && conflictRepository?.id === selectedRepository?.id && conflictRepository?.snapshot.conflictFiles.includes(selectedFilePath) ? selectedFilePath : undefined;
  const historyKey = JSON.stringify([workbenchRepository?.id, historyRef, historySearch, historyField, historyOrder]);
  const allCommits = useMemo(() => workbenchRepository && historyPage?.key === historyKey
    ? historyPage.commits.map(commit => ({ repository: workbenchRepository, commit })) : [], [workbenchRepository, historyPage, historyKey]);

  useEffect(() => {
    setHistoryRef(''); setHistoryPage(null); setSelectedStashRef('');
  }, [workbenchRepository?.id]);
  useEffect(() => {
    if (!sourceVisible && tab === 'log') void loadHistory(false);
    return () => { historyRequest.current += 1; historyAbort.current?.abort(); };
  }, [historyKey, tab, historyReload, workbenchRepository?.snapshot.headSha, sourceVisible]);

  async function loadHistory(append: boolean): Promise<void> {
    if (!workbenchRepository) return;
    if (append && historyInFlight.current === historyRequest.current) return;
    const previous = append && historyPage?.key === historyKey ? historyPage : null;
    if (previous && !previous.nextCursor) return;
    const request = ++historyRequest.current;
    historyAbort.current?.abort(); const controller = new AbortController(); historyAbort.current = controller;
    historyInFlight.current = request; setHistoryLoading(true); setHistoryError('');
    try {
      const page = await props.client.searchProjectGitHistory(props.project.id, workbenchRepository.id, { ref: historyRef || undefined, search: historySearch, field: historyField, order: historyOrder, cursor: previous?.nextCursor ?? undefined }, controller.signal);
      if (request !== historyRequest.current || controller.signal.aborted) return;
      const commits = [...(previous?.commits ?? []), ...page.commits];
      setHistoryPage({ key: historyKey, commits, hasMore: page.hasMore, nextCursor: page.nextCursor });
    } catch (reason) {
      if (request === historyRequest.current && !controller.signal.aborted) setHistoryError(errorMessage(reason, zh));
    } finally {
      if (historyInFlight.current === request) { historyInFlight.current = null; setHistoryLoading(false); }
    }
  }

  useEffect(() => {
    // 缓存仅用于首屏，进入页面和回到应用时都重新读取外部 Git 变化。
    const refresh = () => {
      if (document.visibilityState === 'visible' && !actionBusyRef.current) void loadWorkbench();
    };
    refresh();
    const unsubscribe = subscribeProjectGitRefresh(props.project.id, refresh);
    return () => {
      requestVersionRef.current += 1;
      unsubscribe();
    };
  }, [props.client, props.project.id]);

  useEffect(() => {
    const repositoryId = watchedConflictRepositoryId;
    const repositoryPath = watchedConflictRepositoryPath;
    if (!repositoryId || repositoryPath === undefined) return;
    const controller = new AbortController();
    let previous: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        if (document.visibilityState !== 'visible' || actionBusyRef.current) return;
        const { revision } = await props.client.loadProjectGitConflictRevision(props.project.id, repositoryId, repositoryPath, watchedConflictPath, controller.signal);
        if (controller.signal.aborted || actionBusyRef.current || previous === revision) return;
        // 用新的状态请求读取已知的磁盘变更，避免复用变更前开始的请求。
        projectGitWorkbenchCacheEntry(props.client, props.project.id).request = null;
        if (await loadWorkbench()) previous = revision;
      } catch { /* 仓库可能正在被外部工具更新，下次检查时重试。 */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void check(), 1500); }
    };
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [props.client, props.project.id, watchedConflictRepositoryId, watchedConflictRepositoryPath, watchedConflictPath]);

  useEffect(() => {
    if (snapshot?.projectId === props.project.id) projectGitWorkbenchCacheEntry(props.client, props.project.id).snapshot = snapshot;
  }, [props.client, props.project.id, snapshot]);

  useEffect(() => {
    if (tab === 'console') void operationHistory.refresh();
  }, [tab, operationHistory.refresh]);

  useEffect(() => {
    if (tab !== 'changes' || !snapshot) return;
    const repository = snapshot.repositories.find((candidate) => candidate.id === selectedRepositoryId) ?? snapshot.repositories[0];
    if (!repository) {
      if (selectedFilePath) setSelectedFilePath('');
      return;
    }
    if (repository.id !== selectedRepositoryId) setSelectedRepositoryId(repository.id);
    const conflicts = new Set(repository.snapshot.conflictFiles);
    if (conflicts.has(selectedFilePath)) {
      if (selectedFileStage !== 'unstaged') setSelectedFileStage('unstaged');
      return;
    }
    const stagePaths = gitFileStagePaths(repository.snapshot.fileStatuses, repository.snapshot.conflictFiles);
    const unstagedPaths = new Set(stagePaths.unstaged);
    const stagedPaths = new Set(stagePaths.staged);
    const selectedPaths = selectedFileStage === 'staged' ? stagedPaths : unstagedPaths;
    if (selectedPaths.has(selectedFilePath)) return;
    const otherStagePaths = selectedFileStage === 'staged' ? unstagedPaths : stagedPaths;
    if (otherStagePaths.has(selectedFilePath)) {
      setSelectedFileStage(selectedFileStage === 'staged' ? 'unstaged' : 'staged');
      return;
    }
    const firstConflictPath = repository.snapshot.conflictFiles[0];
    if (firstConflictPath) {
      setSelectedFilePath(firstConflictPath);
      setSelectedFileStage('unstaged');
      return;
    }
    const firstUnstagedPath = unstagedPaths.values().next().value;
    const firstStagedPath = stagedPaths.values().next().value;
    setSelectedFilePath(firstUnstagedPath ?? firstStagedPath ?? '');
    setSelectedFileStage(firstUnstagedPath ? 'unstaged' : 'staged');
  }, [snapshot, tab, selectedRepositoryId, selectedFilePath, selectedFileStage]);

  const handledSearchRequest = useRef<number | null>(null);
  useEffect(() => {
    const target = props.navigationRequest;
    if (!target || target.projectId !== props.project.id || target.requestId === handledSearchRequest.current) return;
    handledSearchRequest.current = target.requestId;
    let active = true;
    // 搜索和评审可能发现刷新前新增的文件，不能用旧工作台快照拒绝定位。
    void requestProjectGitWorkbench(props.client, props.project.id).then(next => {
      if (!active) return;
      const repository = next.repositories.find(item => item.id === target.repositoryId);
      if (!repository || !searchDestinationAvailable(next, target)) {
        reportApplicationError(zh ? '目标文件或仓库已变化，请刷新后重试。' : 'The target file or repository changed. Refresh and retry.', { language: zh ? 'zh-CN' : 'en' });
        return;
      }
      ++requestVersionRef.current;
      setSnapshot(next);
      setLoadState('ready');
      setError(null);
      setSelectedRepositoryId(repository.id);
      setSubtree(null);
      setFileQuery('');
      setSelectedCommit(null);
      setCommitOpen(false);
      setTab('changes');
      setSelectedFilePath(target.kind === 'file' ? target.path : '');
      setSelectedFileStage(target.kind === 'file' ? target.stage : 'unstaged');
    }).catch(() => {
      if (active) reportApplicationError(zh ? '无法刷新目标仓库，请稍后重试。' : 'Unable to refresh the target repository. Please retry.', { language: zh ? 'zh-CN' : 'en' });
    }).finally(() => { if (active) props.onNavigationHandled?.(target.requestId); });
    return () => { active = false; if (handledSearchRequest.current === target.requestId) handledSearchRequest.current = null; };
  }, [props.navigationRequest, props.onNavigationHandled, props.project.id, props.client, zh]);

  const detailRevision = tab === 'stash' ? activeStashRef : tab === 'log' ? selectedCommitHash : '';
  const detailStashHash = tab === 'stash' ? activeStash?.hash : undefined;
  useEffect(() => {
    // 新选择立即清除旧详情，避免旧行高亮在异步读取期间冒充当前选择。
    setCommitDetail(null);
    if (sourceVisible || !selectedRepository || !detailRevision) {
      setCommitLoading(false);
      return;
    }
    const controller = new AbortController();
    setCommitLoading(true);
    props.client
      .loadProjectGitCommit(props.project.id, selectedRepository.id, detailRevision, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setCommitDetail(detail);
        setSelectedFilePath(detail.files[0]?.path ?? '');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason, zh));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommitLoading(false);
      });
    return () => controller.abort();
  }, [props.client, props.project.id, selectedRepository?.id, detailRevision, detailStashHash, sourceVisible, zh]);

  async function loadWorkbench(): Promise<boolean> {
    // 历史与仓库快照独立读取，仓库刷新失败不能伪装成没有操作记录。
    void operationHistory.refresh();
    const version = ++requestVersionRef.current;
    setLoadState('loading');
    setError(null);
    try {
      const next = await requestProjectGitWorkbench(props.client, props.project.id);
      if (version !== requestVersionRef.current) return false;
      setSnapshot(next);
      setSelectedRepositoryId((current) => (next.repositories.some((repository) => repository.id === current) ? current : (next.repositories[0]?.id ?? '')));
      setLoadState('ready');
      return true;
    } catch (reason) {
      if (version === requestVersionRef.current) {
        setLoadState('error');
        setError(errorMessage(reason, zh));
      }
      return false;
    }
  }

  async function conflictSaved(repositoryId: string, path: string, result: { resolved: boolean; snapshot?: ProjectGitRepositorySnapshot }): Promise<void> {
    const projectId = props.project.id;
    if (currentProjectId.current !== projectId) {
      notifyProjectGitChanged(projectId);
      return;
    }
    const version = ++requestVersionRef.current;
    const entry = projectGitWorkbenchCacheEntry(props.client, projectId);
    entry.request = null;
    const selectAfterSave = (saved: ProjectGitRepositorySnapshot) => {
      const current = currentWorkbenchSelection.current;
      if (currentProjectId.current !== projectId || !result.resolved || current.tab !== 'changes' || current.repositoryId !== repositoryId || current.path !== path || saved.conflictFiles.includes(path)) return;
      const nextConflict = saved.conflictFiles[0];
      const nextFile = saved.fileStatuses.find((file) => file.path === path) ?? saved.fileStatuses[0];
      setSelectedFilePath(nextConflict ?? nextFile?.path ?? '');
      setSelectedFileStage(nextConflict || !nextFile || nextFile.workingTreeStatus !== ' ' || nextFile.indexStatus === '?' ? 'unstaged' : 'staged');
    };
    if (result.snapshot && currentSnapshot.current?.projectId === projectId) {
      const next = { ...currentSnapshot.current, refreshedAt: new Date().toISOString(), repositories: currentSnapshot.current.repositories.map((repository) => repository.id === repositoryId ? { ...repository, snapshot: result.snapshot! } : repository) };
      currentSnapshot.current = next;
      entry.snapshot = next;
      setSnapshot(next);
      selectAfterSave(result.snapshot);
    }
    try {
      const next = await requestProjectGitWorkbench(props.client, projectId);
      if (currentProjectId.current !== projectId || version !== requestVersionRef.current) return;
      currentSnapshot.current = next;
      setSnapshot(next);
      setLoadState('ready');
      const repository = next.repositories.find((item) => item.id === repositoryId);
      if (repository) selectAfterSave(repository.snapshot);
    } catch (reason) {
      if (currentProjectId.current === projectId && version === requestVersionRef.current) setError(errorMessage(reason, zh, { title: zh ? '冲突结果已保存，但刷新仓库失败' : 'Conflict result was saved, but repository refresh failed' }));
    } finally {
      notifyProjectGitChanged(projectId);
    }
  }

  function execute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<ExecutionOutcome> {
    // Let Git carry compatible edits; show checkout recovery only if it refuses.
    return executeConfirmed(repository, action, label);
  }

  async function executeConfirmed(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string, onFailure?: (reason: unknown) => void, commitPush?: { target: CommitPushTarget; onCommitted: () => void }): Promise<ExecutionOutcome> {
    if (actionBusyRef.current || sourceLocked) return null;
    actionBusyRef.current = true;
    requestVersionRef.current += 1;
    projectGitWorkbenchCacheEntry(props.client, props.project.id).request = null;
    setBusy({ repositoryId: repository.id, action: action.type });
    setError(null);
    setCheckoutNotice(null);
    const previousOperationErrors = { ...operationErrorsByRepositoryRef.current };
    delete previousOperationErrors[repository.id];
    operationErrorsByRepositoryRef.current = previousOperationErrors;
    const projectId = props.project.id;
    let stagingController: AbortController | undefined;
    let preparedAction = action;
    let failureAction = action;
    let committedHead = '';
    try {
      if (action.type === 'stage' || action.type === 'stage_ignored' || action.type === 'apply_line_changes' && action.input.operation === 'stage') {
        stagingController = new AbortController(); stagePreviewController.current = stagingController;
        const policy = readGitLargeFilePreferences(); const thresholdBytes = policy.thresholdMiB * 1024 ** 2;
        const preview = await props.client.previewProjectGitStage(projectId, repository.id, { paths: action.type === 'apply_line_changes' ? [action.input.path] : action.paths, thresholdBytes, forceIgnored: action.type === 'stage_ignored' }, stagingController.signal);
        if (stagingController.signal.aborted || currentProjectId.current !== projectId) return null;
        if (preview.lfsSetupRequired || (policy.enabled && preview.largeFiles.length)) {
          const decision = await new Promise<GitStageDecision>(resolve => {
            const request = { repository, preview, resolve, ...(action.type === 'apply_line_changes' ? { selectionHint: zh ? '本次只暂存已选择的增删行，其他更改保留。' : 'Only selected changed lines will be staged; other changes are retained.' } : {}) }; stageRequestRef.current = request; setStageRequest(request);
          });
          if (!decision || stagingController.signal.aborted || currentProjectId.current !== projectId) return null;
          if (decision.kind === 'lfs') { setLfsRequest({ repository, change: { operation: 'track', pattern: decision.path, literal: true } }); return null; }
          if (preview.lfsSetupRequired) return null;
          if (decision.suppressFuture && !saveGitLargeFilePreferences({ ...policy, enabled: false })) setStagePreferenceNotice(zh ? '大文件提醒仅在本次会话关闭：无法保存本机偏好。' : 'Large-file warnings are disabled for this session only: local preferences could not be saved.');
        }
        preparedAction = { ...action, largeFileReview: { thresholdBytes, skipWarning: !policy.enabled, expectedFingerprint: preview.fingerprint } };
        // After review, Stop must cancel the native action rather than the finished read.
        if (stagePreviewController.current === stagingController) stagePreviewController.current = null;
      }
      const response = commitPush && action.type === 'commit'
        ? await commitThenPush({ snapshot: repository.snapshot, message: action.message, target: commitPush.target,
          execute: next => props.client.executeProjectGitAction(projectId, repository.id, next),
          onCommitted: committed => { committedHead = committed.result.headSha; commitPush.onCommitted(); },
          onPushing: next => { failureAction = next; setBusy({ repositoryId: repository.id, action: 'push' }); },
        })
        : await props.client.executeProjectGitAction(projectId, repository.id, preparedAction);
      // A read started while Git was writing can still contain the previous index.
      ++requestVersionRef.current;
      projectGitWorkbenchCacheEntry(props.client, projectId).request = null;
      setLoadState('ready');
      setSnapshot((current) =>
        current
          ? {
              ...current,
              refreshedAt: new Date().toISOString(),
              repositories: current.repositories.map((candidate) => (candidate.id === repository.id ? { ...candidate, snapshot: response.snapshot } : candidate)),
            }
          : current,
      );
      if (action.type === 'submodule_update' || action.type === 'manage_submodule' || action.type === 'subtree') await loadWorkbench();
      if (response.result.outcome === 'completed' && !response.snapshot.integrationState && response.snapshot.fileStatuses.some(file => file.indexStatus !== ' ' && file.indexStatus !== '?') && (action.type === 'cherry_pick_series' && !action.input.commit || action.type === 'continue_integration' && repository.snapshot.integrationNoCommit)) setStagePreferenceNotice(zh ? '所选序列已应用到暂存区，尚未提交。请核对并填写提交说明。' : 'The selected sequence has been applied to the index without committing. Review it and enter a commit message.');
      if ((action.type === 'merge' && response.snapshot.integrationState === 'merge' || (action.type === 'interactive_rebase' || action.type === 'amend_rebase_step') && response.snapshot.integrationState === 'rebase') && response.result.outcome === 'completed') {
        setSelectedRepositoryId(repository.id);
        setTab('changes');
        setSelectedFilePath(response.snapshot.fileStatuses.find(file => file.indexStatus !== ' ' && file.indexStatus !== '?')?.path ?? '');
        setSelectedFileStage('staged');
      }
      notifyProjectGitChanged(props.project.id);
      if (sourceVisible) sourceCommands.current?.refresh();
      if (response.result.outcome === 'completed' && (action.type === 'checkout' || action.type === 'checkout_revision' || action.type === 'create_branch') && response.result.savedStash) setCheckoutNotice({ repositoryId: repository.id, branch: response.snapshot.branch, savedStash: response.result.savedStash });
      if (response.result.outcome === 'conflict' && action.type !== 'stage') {
        setConflictAction({ repositoryId: repository.id, action, result: response.result });
        setSelectedRepositoryId(repository.id);
        setTab('changes');
        setSelectedFilePath(response.snapshot.conflictFiles[0] ?? '');
        setSelectedFileStage('unstaged');
      }
      return response.result.outcome;
    } catch (reason) {
      if (stagingController?.signal.aborted || currentProjectId.current !== projectId) return null;
      onFailure?.(reason);
      const explanation = describeUserFacingError(reason, zh ? 'zh-CN' : 'en');
      const code = gitFailureCode(reason);
      const context = gitFailureContext(reason, zh);
      const closeOperationDialogs = () => {
        setNewBranchOpen(false); setRevisionOpen(false); setRemoteCheckoutTarget(null);
        setPullOpen(false); setPushOpen(false); setPushResults([]); setMergeOpen(false); setMergeOptions(null); setUpdateOpen(false);
        setMenuConfirmation(null); setStashRepositoryId(null); setCommitOpen(false); setAmendRepository(null); setBranchManagement(null); setRevisionAction(null); setIgnoreRequest(null); setStopTrackingRequest(null); setInteractiveRebase(null); setAmendStepRepository(null); setFlowRequest(null); setReplayRequest(null); setReplaySeriesRequest(null);
      };
      const reviewFiles = () => {
        const latest = currentSnapshot.current?.repositories.find((item) => item.id === repository.id);
        closeOperationDialogs();
        setSelectedRepositoryId(repository.id);
        const path = context.files.find(path => latest?.snapshot.fileStatuses.some(file => file.path === path)) ?? latest?.snapshot.conflictFiles[0] ?? '';
        const file = latest?.snapshot.fileStatuses.find(file => file.path === path);
        setSelectedFilePath(path);
        setSelectedFileStage(file?.indexStatus !== ' ' && file?.workingTreeStatus === ' ' ? 'staged' : 'unstaged');
        setFileQuery('');
        setTab('changes');
      };
      const recovery = code === 'ASTRAGIT_GIT_FLOW_CHECKOUT_BLOCKED'
        ? [{ label: zh ? '查看本地更改' : 'Review local changes', onClick: reviewFiles }, { label: zh ? '贮藏本地修改…' : 'Stash local changes…', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setStashRepositoryId(repository.id); } }]
        : ['ASTRAGIT_GIT_FLOW_PAUSED', 'ASTRAGIT_GIT_FLOW_INTEGRATION', 'ASTRAGIT_GIT_FLOW_CONFLICT'].includes(code ?? '')
        ? [{ label: zh ? '查看冲突与整合状态' : 'Review conflicts and integration', onClick: reviewFiles }]
        : code === 'ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD'
        ? [{ label: zh ? '查看提交历史' : 'Review history', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setTab('log'); } }, { label: zh ? '拉取并整合…' : 'Pull and integrate…', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setPullOpen(true); } }]
        : explanation.outcomeUnconfirmed || code === 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED'
        ? [{ label: zh ? '刷新仓库状态' : 'Refresh repository', onClick: async () => { await loadWorkbench(); } }]
        : code === 'ASTRAGIT_GIT_CHECKOUT_BLOCKED' || code === 'ASTRAGIT_GIT_LOCAL_CHANGES_BLOCKED' || code === 'ASTRAGIT_GIT_REBASE_LOCAL_CHANGES'
          ? [{ label: zh ? '查看受影响文件' : 'Review affected files', onClick: reviewFiles }, { label: zh ? '贮藏本地修改…' : 'Stash local changes…', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setStashRepositoryId(repository.id); } }]
          : ['ASTRAGIT_GIT_CHECKOUT_CONFLICTED', 'ASTRAGIT_GIT_CHECKOUT_INTEGRATION_ACTIVE', 'ASTRAGIT_GIT_UNMERGED_FILES', 'ASTRAGIT_GIT_CONFLICTS_REMAIN', 'ASTRAGIT_GIT_INTEGRATION_ACTIVE', 'ASTRAGIT_GIT_STAGE_CONFLICT_MARKERS'].includes(code ?? '')
            ? [{ label: zh ? '查看冲突与整合状态' : 'Review conflicts and integration', onClick: reviewFiles }]
            : code === 'ASTRAGIT_GIT_BRANCH_NOT_MERGED'
              ? [{ label: zh ? '查看该分支的提交' : 'Review branch commits', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setHistoryRef(action.type === 'delete_branch' ? `refs/heads/${action.branchName}` : ''); setTab('log'); } }]
            : code === 'ASTRAGIT_GIT_REMOTE_BRANCH_CHANGED' && action.type === 'delete_remote_branch'
              ? [{ label: zh ? '抓取并查看远程提交' : 'Fetch and review remote commits', onClick: async () => { closeOperationDialogs(); if (await execute(repository, { type: 'fetch', remote: action.remote }, zh ? '抓取远程更新' : 'Fetch remote updates') === 'completed') { setSelectedRepositoryId(repository.id); setHistoryRef(`refs/remotes/${action.remote}/${action.branchName}`); setTab('log'); } } }]
            : ['ASTRAGIT_GIT_IDENTITY_REQUIRED', 'ASTRAGIT_GIT_REMOTE_REQUIRED', 'ASTRAGIT_GIT_REMOTE_NOT_FOUND'].includes(code ?? '')
              ? [{ label: zh ? '打开仓库设置' : 'Open repository settings', onClick: () => setSettingsRepository(repository) }]
            : code?.startsWith('ASTRAGIT_GIT_LINES_')
              ? [{ label: zh ? '重新读取文件差异' : 'Reload file diff', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); if (action.type === 'apply_line_changes') { setSelectedFilePath(action.input.path); setSelectedFileStage(action.input.stage); } setTab('changes'); notifyProjectGitChanged(props.project.id); } }]
            : ['ASTRAGIT_GIT_STAGE_CHANGED', 'ASTRAGIT_GIT_STAGE_LARGE_FILES', 'ASTRAGIT_GIT_STAGE_LFS_SETUP'].includes(code ?? '')
              ? [{ label: zh ? '查看受影响文件' : 'Review affected files', onClick: reviewFiles }, { label: zh ? 'Git LFS 管理…' : 'Manage Git LFS…', onClick: () => { closeOperationDialogs(); setLfsRequest({ repository }); } }]
              : [];
      const message = errorMessage(reason, zh, {
        title: committedHead
          ? `${repository.name} · ${zh ? '提交已完成，但推送未完成' : 'Committed, but push did not complete'} (${committedHead.slice(0, 7)})`
          : gitFailureTitle(failureAction, label, repository.name, zh),
        // 首屏展示原因、下一步与真实 Git 诊断，详情仍可手动收起。
        showDetails: true,
        detailTitle: zh ? 'Git 日志' : 'Git log',
        context,
        actions: recovery,
      });
      operationErrorsByRepositoryRef.current = { ...operationErrorsByRepositoryRef.current, [repository.id]: message };
      await loadWorkbench();
      setError(`${label}: ${message}`);
      return null;
    } finally {
      if (stagingController && stagePreviewController.current === stagingController) stagePreviewController.current = null;
      actionBusyRef.current = false;
      setBusy(null);
      void operationHistory.refresh(true);
    }
  }

  async function generateCommitMessage(units: SourceCommitUnit[], summary = false): Promise<void> {
    const first = units[0];
    if (!first || generatingCommitRef.current || busy || commitModelsLoading || !commitModelRef) return;
    const id = summary ? batchSummaryId : first.repository.id;
    const original = commitMessages.drafts[id];
    const originalMessage = original?.message ?? '';
    generatingCommitRef.current = true;
    const controller = new AbortController();
    commitGenerationController.current = controller;
    setGeneratingCommitFor(id);
    setCommitGenerationFeedback(current => ({ ...current, [id]: '' }));
    try {
      const generated = await generateStagedCommitDrafts({
        client: props.client, projectId: props.project.id, units, summary, drafts: commitMessages.drafts,
        language: zh ? 'zh-CN' : 'en', model: commitModelRef, signal: controller.signal,
        onText: text => { if (!controller.signal.aborted) setGenerationPreview({ id, text, original: originalMessage }); },
      });
      controller.signal.throwIfAborted();
      for (const draft of generated.messages) commitMessages.write(draft.id, draft.message, draft.scope, draft.expected);
      setCommitGenerationFeedback(current => ({ ...current, [id]:
        (zh ? '已生成，请检查后提交。' : 'Generated. Review before committing.') +
        (generated.truncated ? (zh ? ' 部分大文件或生成文件仅提供摘要，请核对完整性。' : ' Large or generated files were summarized; check completeness.') : ''),
      }));
    } catch (reason) {
      setCommitGenerationFeedback(current => ({ ...current, [id]: controller.signal.aborted ? (zh ? '已停止生成，已保留原提交说明。' : 'Generation stopped. The original message was preserved.') : errorMessage(reason, zh) }));
    } finally {
      setGenerationPreview(null);
      generatingCommitRef.current = false;
      if (commitGenerationController.current === controller) commitGenerationController.current = null;
      setGeneratingCommitFor(null);
    }
  }

  async function launchRepositoryFile(repository: ProjectGitRepositoryWorkbenchItem, path: string, intent: 'open' | 'reveal' | 'edit-ignore-rule'): Promise<void> {
    setError(null);
    try {
      const launch = window.astraGit?.performFileAction;
      if (!launch) throw Object.assign(new Error('此操作需要 AstraGit 桌面应用。'), { code: 'ASTRAGIT_GIT_FILE_ACTION_UNAVAILABLE' });
      const result = await launch({ projectId: props.project.id, repositoryId: repository.id, path, intent });
      if (!result.ok) throw result.error;
    } catch (reason) {
      const titles = { open: ['无法在外部打开', 'Could not open externally'], reveal: ['无法在 Finder 中定位', 'Could not reveal in Finder'], 'edit-ignore-rule': ['无法编辑匹配规则', 'Could not edit the matching rule'] };
      setError(errorMessage(reason, zh, { title: titles[intent][zh ? 0 : 1] }));
    }
  }

  function confirmApplyStash(repository: ProjectGitRepositoryWorkbenchItem, stash: ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number]): void {
    setMenuConfirmation(createApplyStashConfirmation(repository, stash, zh, execute));
  }

  function showGitContextMenu(event: GitContextEvent, target: GitContextTarget, position = { x: 'clientX' in event ? event.clientX : 0, y: 'clientY' in event ? event.clientY : 0 }, anchor?: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    if (anchor && contextMenu?.anchor === anchor) {
      setContextMenu(null);
      return;
    }
    const repository = repositories.find((item) => item.id === target.repositoryId);
    if (!repository) return;
    const copy = (text: string) => navigator.clipboard.writeText(text);
    const label = (cn: string, en: string) => (zh ? cn : en);
    let menuTitle = target.ref || repository.name;
    const items: GitMenuItem[] = [];
    const action = (title: string, value: ProjectGitAction, confirmation?: string, danger = false, disabled = false) =>
      items.push({
        label: title,
        disabled: busy !== null || disabled,
        danger,
        run: () => {
          if (value.type === 'cherry_pick' || value.type === 'revert') { setReplayRequest({ repository, kind: value.type, revision: value.revision }); return; }
          // A conflict is a confirmed pause, so reveal the conflict editor instead of offering to run the action again.
          if (confirmation) {
            const paths = value.type === 'discard' ? value.paths : undefined;
            const scope = paths ? repository.name : `${repository.name} · ${target.ref}`;
            setMenuConfirmation({ title, description: `${scope}\n${confirmation}`, paths, danger, run: async () => (await execute(repository, value, title)) !== null });
          }
          else return execute(repository, value, title).then(() => {});
        },
      });
    const form = (title: string, field: string, build: (text: string) => ProjectGitAction, initialValue = '') =>
      items.push({
        label: title,
        disabled: busy !== null,
        run: () => setMenuConfirmation({ title, description: `${repository.name} · ${target.ref}`, field, initialValue, run: async ({ text }) => (await execute(repository, build(text), title)) !== null }),
      });
    const newBranch = (baseRef: string) => form(label('新建分支…', 'New branch…'), label('分支名称', 'Branch name'), (branchName) => ({ type: 'create_branch', branchName, baseRef }));
    const fileAction = (path: string, intent: 'open' | 'reveal') => () => launchRepositoryFile(repository, path, intent);
    if (target.kind === 'file' || target.kind === 'directory' || target.kind === 'stage') {
      const selectedPaths = target.kind === 'file' && target.paths ? new Set(target.paths) : null;
      const conflicts = new Set(repository.snapshot.conflictFiles);
      const stage = target.stage === 'staged' ? 'staged' : 'unstaged';
      const available = gitFileStagePaths(repository.snapshot.fileStatuses, repository.snapshot.conflictFiles)[stage].filter(path =>
        (!subtree || subtree.repositoryId !== repository.id || path === subtree.path || path.startsWith(`${subtree.path}/`)) &&
        path.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()) &&
        (target.kind === 'stage' || (target.kind === 'directory' ? path.startsWith(`${target.ref}/`) : selectedPaths ? selectedPaths.has(path) : path === target.ref)),
      );
      const stagePaths = selectedPaths ? pruneGitFileSelection(available, target.paths!) : available;
      const paths = stagePaths.filter(path => !conflicts.has(path));
      const ordinaryPaths = new Set(paths);
      const files = repository.snapshot.fileStatuses.filter(file => ordinaryPaths.has(file.path));
      const multiple = target.kind === 'file' && stagePaths.length > 1;
      items.push({ label: label('Git LFS 管理…', 'Manage Git LFS…'), disabled: busy !== null, run: () => setLfsRequest({ repository }) });
      if (target.kind === 'file' && paths.length === 1 && !repository.snapshot.submodules?.some(item => item.path === paths[0])) {
        const path = paths[0]!; const extension = /[^/.]\.([A-Za-z0-9_-]+)$/u.exec(path)?.[1];
        items.push({ label: label('使用 LFS 跟踪此文件…', 'Track this file with LFS…'), disabled: busy !== null, run: () => setLfsRequest({ repository, change: { operation: 'track', pattern: path, literal: true } }) });
        if (extension) items.push({ label: label(`使用 LFS 跟踪 *.${extension}…`, `Track *.${extension} with LFS…`), disabled: busy !== null, run: () => setLfsRequest({ repository, change: { operation: 'track', pattern: `*.${extension}` } }) });
      }
      items.push({ label: label('使用外部工具比较所选文件…', 'Compare selected files with external tool…'), disabled: busy !== null || !paths.length, run: () => setExternalToolRequest({ repository, input: { mode: 'diff', paths, stage: target.stage === 'staged' ? 'staged' : 'unstaged' } }) });
      const conflictPaths = target.kind === 'file' ? stagePaths.filter(path => conflicts.has(path)) : [];
      if (conflictPaths.length) items.push({ label: label(`外部合并所选冲突 (${conflictPaths.length})…`, `Merge selected conflicts externally (${conflictPaths.length})…`), disabled: busy !== null, run: () => setExternalToolRequest({ repository, input: { mode: 'merge', paths: conflictPaths } }) });
      if (multiple) menuTitle = label(`已选择 ${stagePaths.length} 个文件`, `${stagePaths.length} files selected`);
      items.push({ label: label('导出所选文件补丁…', 'Export selected files as patch…'), disabled: !paths.length || busy !== null, run: () => setPatchRequest({ repository, mode: 'export', paths, scope: target.stage === 'staged' ? 'staged' : 'unstaged' }) });
      const stageLabel = target.stage === 'staged' ? label('取消暂存', 'Unstage') : label('暂存', 'Stage');
      action(multiple ? label(`${stageLabel}所选文件 (${stagePaths.length})`, `${stageLabel} selected files (${stagePaths.length})`) : stageLabel, { type: stage === 'staged' ? 'unstage' : 'stage', paths: stagePaths }, undefined, false, !stagePaths.length);
      if (target.kind === 'file') {
        if (conflictPaths.includes(target.ref)) items.push({ label: label('处理冲突', 'Resolve conflict'), run: () => { setSelectedFilePath(target.ref); setSelectedFileStage('unstaged'); } });
        else items.push({ label: multiple ? label('查看当前文件差异', 'View current file diff') : label('查看差异', 'View diff'), run: () => openDiffWindow(repository, target.ref, { stage: target.stage }) });
      }
      if (target.kind === 'file') {
        items.push({ label: label('文件历史…', 'File history…'), run: () => setFileHistoryRequest({ repository, path: target.ref }) });
        items.push({ label: label('工作区代码归属…', 'Working tree blame…'), run: () => setFileHistoryRequest({ repository, path: target.ref, view: 'blame' }) });
      }
      if (target.kind !== 'stage') {
        items.push({ label: multiple ? label('使用默认应用打开当前文件', 'Open current file with default app') : label('使用默认应用打开', 'Open with default app'), run: fileAction(target.ref, 'open') });
        items.push({ label: multiple ? label('在 Finder 中定位当前文件', 'Reveal current file in Finder') : label('在 Finder 中定位', 'Reveal in Finder'), run: fileAction(target.ref, 'reveal') });
        const untracked = files.filter(file => file.indexStatus === '?').map(file => file.path);
        items.push({ label: multiple ? label(`忽略所选未跟踪项 (${untracked.length})…`, `Ignore selected untracked items (${untracked.length})…`) : label('忽略…', 'Ignore…'), disabled: busy !== null || !untracked.length, run: () => setIgnoreRequest({ repository, paths: untracked, directory: target.kind === 'directory' ? target.ref : undefined }) });
      }
      const trackedPaths = target.kind === 'directory' ? [target.ref] : paths.filter(path => files.some(file => file.path === path && file.indexStatus !== '?' && file.indexStatus !== 'D'));
      items.push({ label: target.kind === 'directory' ? label('停止跟踪此目录…', 'Stop tracking this directory…') : paths.length > 1 ? label(`停止跟踪所选已跟踪文件 (${trackedPaths.length})…`, `Stop tracking selected tracked files (${trackedPaths.length})…`) : label('停止跟踪…', 'Stop tracking…'), disabled: busy !== null || !trackedPaths.length, run: () => setStopTrackingRequest({ repository, paths: trackedPaths }) });
      if (target.stage !== 'staged') {
        const tracked = paths.filter((path) => files.some((file) => file.path === path && file.indexStatus !== '?'));
        action(
          multiple ? label(`丢弃所选未暂存修改 (${tracked.length})…`, `Discard selected unstaged changes (${tracked.length})…`) : label('丢弃未暂存修改…', 'Discard unstaged changes…'),
          { type: 'discard', paths: tracked },
          label(`将 ${tracked.length} 个已跟踪文件恢复为暂存区内容。未跟踪文件不会被删除。此操作无法撤销。`, `Restore ${tracked.length} tracked files from the index. Untracked files are kept. This cannot be undone.`),
          true,
          !tracked.length || repository.snapshot.conflictFiles.length > 0,
        );
      }
      if (target.kind !== 'stage') items.push({ label: multiple ? label('复制所选相对路径', 'Copy selected relative paths') : label('复制相对路径', 'Copy relative path'), run: () => copy(target.kind === 'file' ? stagePaths.join('\n') : target.ref) });
    } else if (target.kind === 'local' || target.kind === 'remote') {
      const current = target.kind === 'local' && !repository.snapshot.detached && repository.snapshot.branch === target.ref;
      const reference = `refs/${target.kind === 'local' ? 'heads' : 'remotes'}/${target.ref}`;
      if (target.kind === 'local') action(label('切换到此分支', 'Checkout branch'), { type: 'checkout', branchName: target.ref }, undefined, false, current);
      else {
        const parsed = splitGitRemoteBranch(target.ref, repository.snapshot.remotes);
        const remote = parsed?.remote ?? '';
        action(label('获取此远程', 'Fetch remote'), { type: 'fetch', remote }, undefined, false, !parsed);
        form(
          label('检出为本地跟踪分支…', 'Checkout tracking branch…'),
          label('本地分支名称', 'Local branch name'),
          (branchName) => ({ type: 'create_branch', branchName, baseRef: reference, trackRemote: true }),
          parsed?.branch ?? '',
        );
        if (parsed) {
          items.push({ label: label('删除远程分支…', 'Delete remote branches…'), danger: true, disabled: busy !== null || !repository.snapshot.remoteBranchHeads?.[target.ref] || !repository.snapshot.remoteDetails?.find(item => item.name === remote)?.pushFingerprint, run: () => setBranchManagement({ kind: 'delete-remote', repository, initialRef: target.ref }) });
          items.push({ label: label('设为当前分支的上游…', 'Track from current branch…'), disabled: busy !== null || repository.snapshot.detached || !repository.snapshot.localBranchHeads?.[repository.snapshot.branch], run: () => setBranchManagement({ kind: 'upstream', repository, branchName: repository.snapshot.branch, initialUpstreamRef: `refs/remotes/${target.ref}` }) });
        }
      }
      items.push({ label: label('查看分支提交', 'View branch commits'), run: () => openReferenceHistory(repository, reference) });
      items.push({ label: label('与当前分支比较', 'Compare with current branch'), run: () => openDiffWindow(repository, '', { comparisonRef: reference, comparisonMode: 'current' }) });
      items.push({ label: label('与工作区比较', 'Compare with working tree'), run: () => openDiffWindow(repository, '', { comparisonRef: reference, comparisonMode: 'working-tree' }) });
      newBranch(reference);
      items.push({ label: label(`将“${target.ref}”合并到“${repository.snapshot.branch}”…`, `Merge '${target.ref}' into '${repository.snapshot.branch}'…`), disabled: busy !== null || current || repository.snapshot.detached || Boolean(repository.snapshot.integrationState), run: () => setMergeOptions({ repository, source: reference }) });
      action(
        label('将当前分支变基到此处…', 'Rebase current branch here…'),
        { type: 'rebase', branchName: reference },
        label('这会重写当前分支的本地提交历史。', 'This rewrites the current branch history.'),
        true,
        current || repository.snapshot.detached,
      );
      if (target.kind === 'local') {
        form(label('重命名分支…', 'Rename branch…'), label('新名称', 'New name'), (newName) => ({ type: 'rename_branch', branchName: target.ref, newName }), target.ref);
        items.push({ label: label('删除本地分支…', 'Delete local branch…'), danger: true, disabled: busy !== null || current || Boolean(repository.snapshot.checkedOutBranches?.includes(target.ref)), run: () => setBranchManagement({ kind: 'delete-local', repository, branchName: target.ref }) });
        items.push({ label: label('设置上游分支…', 'Set upstream branch…'), disabled: busy !== null || !repository.snapshot.localBranchHeads?.[target.ref], run: () => setBranchManagement({ kind: 'upstream', repository, branchName: target.ref }) });
        items.push({ label: label('取消上游跟踪…', 'Unset upstream…'), disabled: busy !== null || !repository.snapshot.branchUpstreamRefs?.[target.ref], run: () => setBranchManagement({ kind: 'upstream', repository, branchName: target.ref, initialUpstreamRef: null }) });
      }
      items.push({ label: label('复制分支名', 'Copy branch name'), run: () => copy(target.ref) });
      items.push({ label: label('导出此版本源码存档…', 'Archive source at this revision…'), run: () => setArchiveRequest({ repository, revision: reference }) });
    } else if (target.kind === 'commit' && target.commits && target.commits.length > 1) {
      const commits = [...target.commits]; menuTitle = label(`已选 ${commits.length} 个提交`, `${commits.length} selected commits`);
      items.push({ label: label('拣选所选提交…', 'Cherry-pick selected commits…'), disabled: busy !== null || Boolean(repository.snapshot.integrationState), run: () => setReplaySeriesRequest({ repository, revisions: commits }) });
      if (commits.length === 2) items.push({ label: label('比较所选两个提交…', 'Compare selected commits…'), run: () => openDiffWindow(repository, '', { revisions: [commits[1]!, commits[0]!] }) });
      items.push({ label: label('导出所选提交序列…', 'Export selected commit series…'), disabled: busy !== null, run: () => setPatchRequest({ repository, mode: 'export', scope: 'series', revisions: commits }) });
      items.push({ label: label('复制所选提交哈希', 'Copy selected commit hashes'), run: () => copy(commits.join('\n')) });
    } else if (target.kind === 'commit' || target.kind === 'tag') {
      const revision = target.kind === 'tag' ? `refs/tags/${target.ref}` : target.ref;
      items.push({ label: label('导出此版本源码存档…', 'Archive source at this revision…'), run: () => setArchiveRequest({ repository, revision }) });
      items.push({ label: label('导出此提交补丁…', 'Export commit as patch…'), run: () => setPatchRequest({ repository, mode: 'export', scope: 'commit', revision }) });
      if (target.kind === 'commit') items.push({ label: label('导出此提交邮件补丁…', 'Export commit as mailbox…'), run: () => setPatchRequest({ repository, mode: 'export', scope: 'series', revisions: [target.ref] }) });
      items.push({ label: label('交互变基此提交之后的历史…', 'Interactively rebase commits after this…'), disabled: busy !== null || Boolean(repository.snapshot.integrationState) || !repository.snapshot.headSha, run: () => setInteractiveRebase({ repository, baseRef: revision }) });
      items.push({ label: label('重置当前分支到此提交…', 'Reset current branch to this commit…'), disabled: busy !== null, danger: true, run: () => setRevisionAction({ type: 'reset', repository, revision }) });
      items.push({
        label: label('查看提交详情', 'View commit details'),
        run: () => {
          setTab('log');
          selectCommit(repository, revision);
        },
      });
      items.push({ label: label('与当前分支比较', 'Compare with current branch'), run: () => openDiffWindow(repository, '', { comparisonRef: revision, comparisonMode: 'current' }) });
      if (target.kind === 'commit' && target.ref === repository.snapshot.headSha) items.push({ label: label('修订此提交…', 'Amend this commit…'), disabled: busy !== null || Boolean(repository.snapshot.integrationState) || repository.snapshot.conflictFiles.length > 0 || !repository.snapshot.indexFingerprint, run: () => openAmend(repository) });
      action(
        label('反向提交…', 'Revert commit…'),
        { type: 'revert', revision },
        label('创建一个新提交，反向撤销该提交的变更；如果发生冲突，会保留现场供处理。', 'Create a new commit that reverses this commit. Conflicts remain available for resolution.'),
        true,
      );
      action(
        label('拣选到当前分支…', 'Cherry-pick commit…'),
        { type: 'cherry_pick', revision },
        label('将该提交的变更应用到当前分支，可能产生冲突。', 'Apply this commit to the current branch; conflicts may occur.'),
        false,
        repository.snapshot.detached,
      );
      action(
        label('检出此版本…', 'Checkout revision…'),
        { type: 'checkout_revision', revision },
        label('进入游离 HEAD 状态；若本地修改阻碍切换，将停止并提示，不自动贮藏。', 'Enter detached HEAD. Stop if local changes block checkout; do not auto-stash.'),
      );
      newBranch(revision);
      items.push({ label: label('创建标签…', 'Create tag…'), disabled: busy !== null, run: () => setTagRequest({ repository, mode: 'create', revision }) });
      if (target.kind === 'tag') {
        items.push({ label: label('管理、推送或删除此标签…', 'Manage, push or delete this tag…'), disabled: busy !== null, run: () => setTagRequest({ repository, tagName: target.ref }) });
      }
      items.push({ label: target.kind === 'tag' ? label('复制标签名', 'Copy tag name') : label('复制提交哈希', 'Copy commit hash'), run: () => copy(target.ref) });
      const commit = repository.snapshot.recentCommits.find((item) => item.hash === target.ref);
      if (commit) items.push({ label: label('复制提交说明', 'Copy commit message'), run: () => copy(commit.subject) });
    } else if (target.kind === 'stash') {
      const stash = repository.snapshot.stashes.find(entry => entry.ref === target.ref);
      if (!stash) return;
      items.push({ label: label('应用贮藏…', 'Apply stash…'), disabled: busy !== null, run: () => confirmApplyStash(repository, stash) });
      action(label('删除贮藏…', 'Drop stash…'), { type: 'drop_stash', stashRef: target.ref }, label('将永久删除该贮藏，无法撤销。', 'Permanently delete this stash. This cannot be undone.'), true);
      items.push({ label: label('复制贮藏引用', 'Copy stash reference'), run: () => copy(target.ref) });
    } else {
      items.push({ label: label('标签管理…', 'Manage tags…'), disabled: busy !== null, run: () => setTagRequest({ repository }) });
      items.push({ label: label('导入补丁…', 'Import patch…'), disabled: busy !== null, run: () => setPatchRequest({ repository, mode: 'import' }) });
      items.push({ label: label('导出补丁…', 'Export patch…'), disabled: busy !== null, run: () => setPatchRequest({ repository, mode: 'export' }) });
      items.push({ label: label('导出源码存档…', 'Export source archive…'), disabled: !repository.snapshot.headSha, run: () => setArchiveRequest({ repository }) });
      items.push({ label: label('文件历史与代码归属…', 'File history and blame…'), run: () => setFileHistoryRequest({ repository }) });
      items.push({ label: label('交互变基…', 'Interactive rebase…'), disabled: busy !== null || !repository.snapshot.headSha || Boolean(repository.snapshot.integrationState), run: () => setInteractiveRebase({ repository }) });
      items.push({ label: label('在 Finder 中定位仓库', 'Reveal repository in Finder'), run: fileAction('', 'reveal') });
      items.push({ label: label('修订上次提交…', 'Amend last commit…'), disabled: busy !== null || !repository.snapshot.headSha || Boolean(repository.snapshot.integrationState) || repository.snapshot.conflictFiles.length > 0 || !repository.snapshot.indexFingerprint, run: () => openAmend(repository) });
      items.push({ label: label('外部工具设置…', 'External tool settings…'), disabled: busy !== null, run: () => setExternalToolRequest({ repository }) });
      items.push({ label: 'Git Flow…', disabled: busy !== null, run: () => setFlowRequest({ repository }) });
      items.push({ label: label('Git LFS 管理…', 'Manage Git LFS…'), disabled: busy !== null, run: () => setLfsRequest({ repository }) });
      items.push({ label: label('子模块管理…', 'Manage submodules…'), disabled: busy !== null, run: () => setSubmoduleRequest({ repository }) });
      items.push({ label: label('仓库设置…', 'Repository settings…'), disabled: busy !== null, run: () => setSettingsRepository(repository) });
      items.push({
        label: label('查看文件状态', 'View file status'),
        run: () => {
          setSelectedRepositoryId(repository.id);
          setTab('changes');
        },
      });
      items.push({ label: label('查看已忽略文件', 'View ignored files'), run: () => { setSelectedRepositoryId(repository.id); setTab('ignored'); } });
      items.push({
        label: label('查看历史', 'View history'),
        run: () => {
          setSelectedRepositoryId(repository.id);
          setTab('log');
        },
      });
      action(label('获取远程更新', 'Fetch'), { type: 'fetch' }, undefined, false, !repository.snapshot.remotes.length);
      action(
        label('拉取并合并…', 'Pull with merge…'),
        { type: 'update', strategy: 'merge', smart: true },
        label('获取并合并此仓库的远程更新。', 'Fetch and merge remote updates for this repository.'),
        false,
        !repository.snapshot.remotes.length || repository.snapshot.detached,
      );
      action(
        label('拉取并变基…', 'Pull with rebase…'),
        { type: 'update', strategy: 'rebase', smart: true },
        label('获取此仓库的远程更新，并将当前分支的本地提交变基到上游。', 'Fetch remote updates and rebase this branch onto its upstream.'),
        true,
        !repository.snapshot.remotes.length || repository.snapshot.detached,
      );
      items.push({
        label: label('推送…', 'Push…'),
        disabled: busy !== null,
        run: () => {
          setSelectedRepositoryId(repository.id);
          openPush();
        },
      });
      items.push({
        label: label('贮藏当前修改…', 'Stash changes…'),
        disabled: busy !== null || repository.snapshot.clean || repository.snapshot.conflictFiles.length > 0,
        run: () => {
          setSelectedRepositoryId(repository.id);
          setStashRepositoryId(repository.id);
        },
      });
      items.push({ label: label('复制仓库名称', 'Copy repository name'), run: () => copy(repository.name) });
    }
    setContextMenu({ ...position, anchor, title: menuTitle, items, target });
  }

  function openReferenceHistory(repository: ProjectGitRepositoryWorkbenchItem, ref: string): void {
    setHistoryRef(ref);
    selectCommit(repository, ref);
    if (tab !== 'log') setTab('log');
  }

  /** 提交、分支和标签入口共用显式选择，后台刷新不再自动选中首条提交。 */
  function selectCommit(repository: ProjectGitRepositoryWorkbenchItem, commitHash: string): void {
    setSelectedRepositoryId(repository.id);
    setSelectedCommit({ repositoryId: repository.id, ref: commitHash });
  }

  function openCommit(): void {
    setTab('changes');
    setCommitRequest((value) => value + 1);
  }

  function openToolbarCommit(): void {
    if (sourceVisible && !selectedRepository?.snapshot.integrationState) sourceCommands.current?.focusCommit();
    else openCommit();
  }

  function openDiffWindow(repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: GitDiffOptions): void {
    setDiffWindowRequest({
      repositoryId: repository.id,
      filePath,
      stage: options?.stage ?? 'combined',
      ...(options?.commitHash ? { commitHash: options.commitHash } : {}),
      ...(options?.comparisonRef ? { comparisonRef: options.comparisonRef } : {}),
      ...(options?.comparisonMode ? { comparisonMode: options.comparisonMode } : {}),
      ...(options?.revisions ? { revisions: options.revisions } : {}),
    });
  }

  async function cancelGitAction(repositoryId: string): Promise<void> {
    await props.client.cancelProjectGitAction(props.project.id, repositoryId);
  }

  function reportWorkbenchError(reason: unknown): void {
    setError(errorMessage(reason, zh));
  }

  function stopSyncOperation(repositoryId: string): void {
    void cancelGitAction(repositoryId).catch(reportWorkbenchError);
  }

  function openFlowConflicts(repositoryId: string): void {
    const repository = currentSnapshot.current?.repositories.find(item => item.id === repositoryId);
    setSelectedRepositoryId(repositoryId);
    setSelectedFilePath(repository?.snapshot.conflictFiles[0] ?? '');
    setSelectedFileStage('unstaged');
    setTab('changes');
    setFlowRequest(null);
  }

  function openSubmoduleRepository(repository: ProjectGitRepositoryWorkbenchItem, path: string): void {
    const relativePath = [repository.relativePath === '.' ? '' : repository.relativePath, path].filter(Boolean).join('/');
    const target = currentSnapshot.current?.repositories.find(item => item.relativePath === relativePath);
    if (!target) {
      setError(zh ? '子仓库尚未被项目发现，请重新载入工作台后查看。' : 'The module has not been discovered in this project. Reload the workbench first.');
      return;
    }
    setSelectedRepositoryId(target.id);
    setTab('changes');
    setSubmoduleRequest(null);
  }

  function refreshWorkbench(): void {
    void loadWorkbench();
    if (sourceVisible) sourceCommands.current?.refresh();
    else setHistoryReload(value => value + 1);
  }

  function finishStageReview(decision: GitStageDecision): void {
    const request = stageRequestRef.current;
    stageRequestRef.current = null;
    setStageRequest(null);
    request?.resolve(decision);
  }

  function stopOperation(repositoryId: string): void {
    if (stagePreviewController.current) {
      stagePreviewController.current.abort();
      finishStageReview(null);
      return;
    }
    stopSyncOperation(repositoryId);
  }

  async function executeWithResult(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) {
    let error: unknown;
    const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; });
    return { outcome, error };
  }

  function commitAndPush(repository: ProjectGitRepositoryWorkbenchItem, message: string, target: CommitPushTarget, onCommitted: () => void): Promise<ExecutionOutcome> {
    return executeConfirmed(repository, { type: 'commit', message }, zh ? '提交并推送' : 'Commit and push', undefined, { target, onCommitted });
  }

  function openCommitDialog(): void {
    if (!generatingCommitRef.current) setCommitOpen(true);
  }

  function stopCommitGeneration(): void {
    commitGenerationController.current?.abort();
  }

  function checkoutSidebarBranch(repository: ProjectGitRepositoryWorkbenchItem, kind: BranchKind, ref: string): void {
    if (kind === 'remote') {
      setRemoteCheckoutTarget({ repositoryId: repository.id, remoteRef: ref });
      return;
    }
    if (!repository.snapshot.detached && repository.snapshot.branch === ref) return;
    void execute(repository, { type: 'checkout', branchName: ref }, zh ? `切换到分支“${ref}”` : `Checkout '${ref}'`).then(outcome => {
      const currentView = currentWorkbenchSelection.current;
      if (outcome !== 'completed' || tab !== 'log' || currentView.tab !== 'log' || currentView.repositoryId !== repository.id) return;
      const reference = `refs/heads/${ref}`;
      setHistoryRef(current => current === reference ? '' : current);
      setSelectedCommit(current => current?.repositoryId === repository.id && current.ref === reference ? null : current);
    });
  }

  async function pushSelectedBranches(selections: PushSelection[], forceWithLease: boolean, pushTags: boolean): Promise<void> {
    await pushBatch.run(async batch => {
      const results: typeof pushResults = [];
      for (const selection of selections) {
        const repository = repositories.find((candidate) => candidate.id === selection.repositoryId)!;
        const target = { repositoryId: repository.id, repositoryName: `${repository.name} · ${selection.sourceBranch}` };
        if (batch.stopped()) {
          results.push({ ...target, tone: 'warning', message: zh ? '本次推送已中止，此分支未执行。' : 'Push stopped. This branch was skipped.' });
          continue;
        }

        const outcome = await batch.execute(repository.id, () => execute(
          repository,
          { type: 'push', remote: selection.remote, sourceBranch: selection.sourceBranch, targetBranch: selection.targetBranch, setUpstream: selection.setUpstream, forceWithLease, pushAllTags: pushTags },
          zh ? '推送提交' : 'Push commits',
        ));
        results.push({
          ...target,
          tone: outcome === 'completed' ? 'success' : 'error',
          message: outcome === 'completed'
            ? zh
              ? `已推送到 ${selection.remote}/${selection.targetBranch}`
              : `Pushed to ${selection.remote}/${selection.targetBranch}`
            : (operationErrorsByRepositoryRef.current[repository.id] ?? (zh ? '推送失败。' : 'Push failed.')),
        });
      }
      setPushResults(results);
    });
  }

  return {
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
      amendRepository, amendStepRepository, archiveRequest, branchManagement, commitOpen,
      diffWindowRequest, externalToolRequest, fileHistoryRequest, flowRequest, ignoreRequest,
      interactiveRebase, lfsRequest, mergeOpen, mergeOptions, newBranchBase, newBranchOpen, openAmend,
      openDiffWindow, openPush, operationsOpen, operationsTriggerRef, patchRequest, pullOpen, pushOpen,
      remoteCheckoutRepository, remoteCheckoutTarget, replayRequest, replaySeriesRequest, revisionAction,
      revisionOpen, setAmendRepository, setAmendStepRepository, setArchiveRequest, setBranchManagement,
      setCommitOpen, setDiffWindowRequest, setExternalToolRequest, setFileHistoryRequest, setFlowRequest,
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
      launchRepositoryFile, menuConfirmation, operationHistory,
      operationErrorsByRepository: operationErrorsByRepositoryRef.current,
      operationNoticeRoot, pushResults, pushSelectedBranches, pushStopping: pushBatch.stopping, setCheckoutNotice, setConflictAction,
      setContextMenu, setMenuConfirmation, setPushResults, setStagePreferenceNotice, showGitContextMenu,
      stagePreferenceNotice, stageRequest, stopOperation, stopPush: pushBatch.stop, stopSyncOperation,
    },
    workspace: {
      error, fileQuery, ignoredQuery, loadState, loadWorkbench, refreshWorkbench, reportWorkbenchError,
      requestVersionRef, setFileQuery, setIgnoredQuery, setSnapshot, setSourceTarget, snapshot,
      sourceCommands, sourceLocked, sourceView, sourceVisible, zh,
    },
  };
}

function errorMessage(error: unknown, zh: boolean, options: ApplicationErrorOptions = {}): string {
  return reportApplicationError(error, { language: zh ? 'zh-CN' : 'en', ...options });
}
