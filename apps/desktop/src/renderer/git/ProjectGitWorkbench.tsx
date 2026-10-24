import { GitFlowDialog, type GitFlowRequest } from './GitFlowDialog.js';
import { GitLfsDialog, type GitLfsRequest } from './GitLfsDialog.js';
import { GitStageReviewDialog, type GitStageDecision } from './GitStageReviewDialog.js';
import { readGitLargeFilePreferences, saveGitLargeFilePreferences } from './gitLargeFilePreferences.js';
import { GitLineChanges } from './GitLineChanges.js';
import type { GitStagePreview } from '../apiClient.js';
import { GitExternalToolDialog, type GitExternalToolRequest } from './GitExternalToolDialog.js';
import { GitSubmoduleManagementDialog } from './GitSubmoduleManagementDialog.js';
import { GitFileStatusIcon, gitFileStatusCategory, gitFileStatusLabel } from './GitFileStatusIcon.js';
import { pruneGitFileSelection, selectGitFilePaths, type GitFileSelection } from './gitFileSelection.js';
import { DotsThreeIcon as DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { GitCommitIcon as GitCommit } from '@phosphor-icons/react/dist/csr/GitCommit';
import { GitMergeIcon as GitMerge } from '@phosphor-icons/react/dist/csr/GitMerge';
import { ArrowDownIcon as ArrowDown } from '@phosphor-icons/react/dist/csr/ArrowDown';
import { ArrowUpIcon as ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp';
import { ClockCounterClockwiseIcon as History } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { projectGitWorkbenchCacheEntry, readCachedProjectGitWorkbench, requestProjectGitWorkbench, subscribeProjectGitRefresh, notifyProjectGitChanged, visibleRepositoryFiles } from './projectGitWorkbenchState.js';
import {
  BranchSwitcher,
  MergeBranchDialog,
  UpdateProjectDialog,
  NewBranchDialog,
  RemoteBranchCheckoutDialog,
  CheckoutRevisionDialog,
  BranchDirectoryTree,
  BranchContextMenu,
  StashDialog,
  PullDialog,
  PushDialog,
} from './GitRepositoryControls.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import type { BranchKind } from './gitWorkbenchTypes.js';
import type { OperationTone } from './gitWorkbenchTypes.js';
import type { BusyState } from './gitWorkbenchTypes.js';
import { MenuSurface } from '../ui/MenuSurface.js';
import { MotionPresence } from '../ui/MotionPresence.js';
import { useGitCommitDrafts } from './useGitCommitDrafts.js';
import { GitCommitTemplateControl } from './GitCommitTemplateControl.js';
import { repositoryColor } from './repositoryColor.js';
import { loadGitCommitModelOptions } from './gitCommitModels.js';
import { useGitOperationHistory } from './useGitOperationHistory.js';
import { GitContextMenu, GitMenuActionDialog, type GitMenuItem, type GitMenuConfirmation } from './GitContextMenu.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArchiveIcon as Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwiseIcon as ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDownIcon as CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CircleNotchIcon as CircleNotch } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { FileIcon as File } from '@phosphor-icons/react/dist/csr/File';
import { FolderIcon as Folder } from '@phosphor-icons/react/dist/csr/Folder';
import { GitBranchIcon as GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import { TagIcon as Tag } from '@phosphor-icons/react/dist/csr/Tag';
import { ListBulletsIcon as ListBullets } from '@phosphor-icons/react/dist/csr/ListBullets';
import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { TreeStructureIcon as TreeStructure } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { WarningCircleIcon as WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type { DashboardClient, GitRevisionComparison, GitHistorySearchCommit, GitHistorySearchField, ProjectGitAction, ProjectGitCommitDetail, ProjectGitOperationRecord, ProjectGitRepositorySnapshot, ProjectGitRepositoryWorkbenchItem, ProjectGitWorkbenchSnapshot, ProjectRecord } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { reportApplicationError, VisibleApplicationError, type ApplicationErrorOptions } from '../ui/ApplicationErrorDialog.js';
import { ProjectGitDiffWindow, SideBySideDiff } from './ProjectGitDiffViewer.js';
import { GitConflictEditor } from './GitConflictEditor.js';
import { GitCheckoutDialog } from './GitCheckoutDialog.js';
import { GitAmendDialog } from './GitAmendDialog.js';
import { GitInteractiveRebaseDialog, type GitInteractiveRebaseRequest } from './GitInteractiveRebaseDialog.js';
import { GitRepositorySettingsDialog } from './GitRepositorySettingsDialog.js';
import { GitBranchManagementDialog, type GitBranchManagementRequest } from './GitBranchManagementDialog.js';
import { GitRevisionActionDialog, type GitRevisionActionRequest } from './GitRevisionActionDialog.js';
import { GitIgnoreDialog, type GitIgnoreRequest } from './GitIgnoreDialog.js';
import { GitStopTrackingDialog, type GitStopTrackingRequest } from './GitStopTrackingDialog.js';
import { GitIgnoredFiles } from './GitIgnoredFiles.js';
import { GitFileHistoryDialog, type GitFileHistoryRequest } from './GitFileHistoryDialog.js';
import { GitPatchDialog, type GitPatchDialogRequest } from './GitPatchDialog.js';
import { GitArchiveDialog, type GitArchiveDialogRequest } from './GitArchiveDialog.js';
import { useGitCommitParentComparison } from './useGitCommitParentComparison.js';
import { GitCommitReplayDialog, type GitCommitReplayRequest } from './GitCommitReplayDialog.js';
import { GitCommitReplaySeriesDialog, type GitCommitReplaySeriesRequest } from './GitCommitReplaySeriesDialog.js';
import { useGitOperationNoticePlacement } from './useGitOperationNoticePlacement.js';
import { GitTagManagementDialog, type GitTagManagementRequest } from './GitTagManagementDialog.js';
import './gitFileTracking.css';
import { describeUserFacingError, splitGitRemoteBranch } from '@astragit/shared';
import { gitConflictMessage, gitFailureCode, gitFailureContext, gitFailureTitle, gitIntegrationLabel } from './gitOperationFeedback.js';

type GitTab = 'changes' | 'ignored' | 'stash' | 'log' | 'console';
type ChangeStage = 'staged' | 'unstaged';
type GitContextEvent = ReactMouseEvent | ReactKeyboardEvent;
interface GitContextTarget {
  kind: 'file' | 'directory' | 'stage' | 'local' | 'remote' | 'tag' | 'commit' | 'stash' | 'repository';
  repositoryId: string;
  ref: string;
  stage?: ChangeStage;
  /** A frozen selection within one repository and one staging area. */
  paths?: string[];
  commits?: string[];
}

export interface ProjectGitWorkbenchProps {
  /** 独立应用固定为项目工作台；保留字段以兼容迁移后的调用方。 */
  conversationScope?: boolean;
  project: ProjectRecord;
  client: Pick<
    DashboardClient,
    'previewRepositoryGitReplay' | 'previewRepositoryGitReplaySeries' | 'previewRepositoryGitArchive' |
    'loadRepositoryGitFlow' | 'previewRepositoryGitFlow' | 'loadProjectGitLineDiff' | 'previewProjectGitStage' | 'loadRepositoryGitLfs' | 'previewRepositoryGitLfs' | 'loadRepositoryGitExternalTools' | 'previewRepositoryGitExternalTool' | 'loadRepositoryGitSubmodules' | 'previewRepositoryGitSubmodule' | 'previewRepositoryGitMailbox' | 'loadRepositoryGitTags' | 'loadRepositoryGitTagTarget' | 'previewRepositoryGitPatch' | 'exportRepositoryGitPatch' | 'searchProjectGitHistory' | 'loadProjectGitTrackedFiles' | 'loadProjectGitFileHistory' | 'loadProjectGitFileRevision' | 'loadProjectGitInteractiveRebasePreview' | 'loadProjectGitIgnoredFiles' | 'loadProjectGitStopTrackingPreview' | 'loadProjectGitIgnorePreview' | 'loadProjectGitResetPreview' | 'loadProjectGitSkipPreview' | 'loadProjectGitRepositorySettings' | 'loadProjectGitCommitTemplate' | 'loadProjectGitHistory' | 'loadProjectGitWorkbench' | 'loadProjectGitOperations' | 'loadProjectGitCommit' | 'loadProjectGitComparisonDiff' | 'loadProjectGitRevisionsDiff' | 'executeProjectGitAction' | 'cancelProjectGitAction' | 'generateGitCommitMessage' | 'loadGitCommitModels' | 'readProjectGitConflict' | 'saveProjectGitConflict'
  >;
  language: 'zh-CN' | 'en-US';
  modelSettingsRevision?: number;
}

const projectGitViewPreferences = new Map<string, { repositoryId: string; searchQuery: string }>();

export function ProjectGitWorkbench(props: ProjectGitWorkbenchProps) {
  const zh = props.language === 'zh-CN';
  const currentProjectId = useRef(props.project.id);
  currentProjectId.current = props.project.id;
  const [snapshot, setSnapshot] = useState<ProjectGitWorkbenchSnapshot | null>(() => readCachedProjectGitWorkbench(props.client, props.project.id));
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(() => (snapshot ? 'ready' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const [conflictAction, setConflictAction] = useState<{ repositoryId: string; action: ProjectGitAction; result: import('../apiClient.js').ProjectGitActionResponse['result'] } | null>(null);
  type CheckoutRequest = { repository: ProjectGitRepositoryWorkbenchItem; action: Extract<ProjectGitAction, { type: 'checkout' | 'create_branch' | 'checkout_revision' }>; label: string; resolve: (outcome: ExecutionOutcome) => void };
  const [checkoutRequest, setCheckoutRequest] = useState<CheckoutRequest | null>(null);
  const checkoutRequestRef = useRef<CheckoutRequest | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<{ repositoryId: string; branch: string; savedStash: string } | null>(null);
  useEffect(() => () => { checkoutRequestRef.current?.resolve(null); checkoutRequestRef.current = null; }, []);
  // errorMessage() reports the original failure once; this state is its inline summary.
  const [tab, setTab] = useState<GitTab>(() => (props.conversationScope ? 'changes' : readRememberedTab(props.project.id)));
  const [subtree, setSubtree] = useState<{ repositoryId: string; path: string } | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(() => projectGitViewPreferences.get(props.project.id)?.repositoryId ?? '');
  /** 只有用户点选才建立提交选择，并绑定仓库，避免初始加载或换仓库产生伪选中。 */
  const [selectedCommit, setSelectedCommit] = useState<{ repositoryId: string; ref: string } | null>(null);
  const [selectedStashRef, setSelectedStashRef] = useState('');
  const [conversationDiff, setConversationDiff] = useState<{ diff: import('../apiClient.js').GitDiffSummary; preview?: unknown } | null>(null);
  const [diffWindowRequest, setDiffWindowRequest] = useState<{ repositoryId: string; filePath: string; stage: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] } | null>(null);
  const [commitDetail, setCommitDetail] = useState<ProjectGitCommitDetail | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileStage, setSelectedFileStage] = useState<ChangeStage>('unstaged');
  const currentFileSelection = useRef({ repositoryId: selectedRepositoryId, path: selectedFilePath, tab });
  currentFileSelection.current = { repositoryId: selectedRepositoryId, path: selectedFilePath, tab };
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
  const [externalRevisions, setExternalRevisions] = useState<Record<string, number>>({});
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; title: string; items: GitMenuItem[]; target: GitContextTarget } | null>(null);
  const [menuConfirmation, setMenuConfirmation] = useState<GitMenuConfirmation | null>(null);
  const [commitDrafts, setCommitDrafts] = useGitCommitDrafts(props.project.id);
  const [commitModels, setCommitModels] = useState<Array<{ id: string; label: string }>>([]);
  const [commitModelRef, setCommitModelRef] = useState('');
  const [commitModelsLoading, setCommitModelsLoading] = useState(true);
  const [commitModelsError, setCommitModelsError] = useState('');
  const [commitModelsRefresh, setCommitModelsRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setCommitModelsLoading(true);
    setCommitModelsError('');
    setCommitModelRef('');
    setCommitModels([]);
    void loadGitCommitModelOptions(props.client, props.project.id)
      .then((models) => {
        if (!active) return;
        // 单个来源不可用不代表整个模型列表失败；有可用模型时不阻挡生成反馈。
        setCommitModelsError(models.items.length ? '' : models.warning);
        setCommitModels(models.items);
        setCommitModelRef(models.modelRef);
      })
      .catch((reason: unknown) => {
        if (active) setCommitModelsError(errorMessage(reason, zh));
      })
      .finally(() => {
        if (active) setCommitModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.client, props.project.id, zh, commitModelsRefresh, props.modelSettingsRevision]);
  function selectCommitModel(modelRef: string): void {
    setCommitModelRef(modelRef);
    try {
      localStorage.setItem(`astragit.commit-model.${props.project.id}`, modelRef);
    } catch {
      /* 本次选择仍然有效。 */
    }
  }
  const [generatingCommitFor, setGeneratingCommitFor] = useState<string | null>(null);
  const generatingCommitRef = useRef(false);
  const commitGenerationController = useRef<AbortController | null>(null);
  useEffect(() => () => commitGenerationController.current?.abort(), [props.project.id]);
  const [commitGenerationFeedback, setCommitGenerationFeedback] = useState<Record<string, string>>({});
  const [updateOpen, setUpdateOpen] = useState(false);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchBase, setNewBranchBase] = useState('');
  const [remoteCheckoutTarget, setRemoteCheckoutTarget] = useState<{ repositoryId: string; remoteRef: string } | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const actionBusyRef = useRef(false);
  /** 控制台缓存可以销毁，历史由桌面耐久账本恢复。 */
  const operationHistory = useGitOperationHistory(props.client, props.project.id);
  const [pushResults, setPushResults] = useState<Array<{ repositoryId: string; repositoryName: string; tone: OperationTone; message: string }>>([]);
  function openPush(): void {
    setPushResults([]);
    setPushOpen(true);
  }
  const requestVersionRef = useRef(0);
  const operationErrorsByRepositoryRef = useRef<Record<string, string>>({});

  const [subtreeDialogOpen, setSubtreeDialogOpen] = useState(false);
  const [historyRef, setHistoryRef] = useState('');
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
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId) ?? repositories[0] ?? null;
  const activeOperationRepository = busy ? repositories.find((repository) => repository.id === busy.repositoryId) : selectedRepository;
  const stashRepository = repositories.find((repository) => repository.id === stashRepositoryId) ?? null;
  const remoteCheckoutRepository = repositories.find((repository) => repository.id === remoteCheckoutTarget?.repositoryId) ?? null;
  const activeStash = selectedRepository?.snapshot.stashes.find((stash) => stash.ref === selectedStashRef) ?? selectedRepository?.snapshot.stashes[0] ?? null;
  const activeStashRef = activeStash?.ref ?? '';
  /** 其他仓库的选择不能借用当前仓库读取详情。 */
  const selectedCommitHash = selectedCommit?.repositoryId === selectedRepository?.id ? (selectedCommit?.ref ?? '') : '';
  // 角标与文件列表使用同一个仓库，不能把其他子模块的改动算进来。
  const changedCount = selectedRepository?.snapshot.fileStatuses.length ?? 0;
  const conflictCount = repositories.reduce((total, repository) => total + repository.snapshot.conflictFiles.length, 0);
  const conflictRepository = selectedRepository?.snapshot.conflictFiles.length ? selectedRepository : repositories.find((repository) => repository.snapshot.conflictFiles.length > 0);
  const historyKey = JSON.stringify([selectedRepository?.id, historyRef, historySearch, historyField, historyOrder]);
  const allCommits = useMemo(() => selectedRepository && historyPage?.key === historyKey
    ? historyPage.commits.map(commit => ({ repository: selectedRepository, commit })) : [], [selectedRepository, historyPage, historyKey]);

  useEffect(() => {
    setHistoryRef(''); setHistoryPage(null); setSelectedStashRef('');
  }, [selectedRepository?.id]);
  useEffect(() => {
    if (tab === 'log') void loadHistory(false);
    return () => { historyRequest.current += 1; historyAbort.current?.abort(); };
  }, [historyKey, tab, historyReload, selectedRepository?.snapshot.headSha]);

  async function loadHistory(append: boolean): Promise<void> {
    if (!selectedRepository) return;
    if (append && historyInFlight.current === historyRequest.current) return;
    const previous = append && historyPage?.key === historyKey ? historyPage : null;
    if (previous && !previous.nextCursor) return;
    const request = ++historyRequest.current;
    historyAbort.current?.abort(); const controller = new AbortController(); historyAbort.current = controller;
    historyInFlight.current = request; setHistoryLoading(true); setHistoryError('');
    try {
      const page = await props.client.searchProjectGitHistory(props.project.id, selectedRepository.id, { ref: historyRef || undefined, search: historySearch, field: historyField, order: historyOrder, cursor: previous?.nextCursor ?? undefined }, controller.signal);
      if (request !== historyRequest.current || controller.signal.aborted) return;
      const commits = [...(previous?.commits ?? []), ...page.commits];
      setHistoryPage({ key: historyKey, commits, hasMore: page.hasMore, nextCursor: page.nextCursor });
    } catch (reason) {
      if (request === historyRequest.current && !controller.signal.aborted) setHistoryError(errorMessage(reason, zh));
    } finally {
      if (request === historyRequest.current) { historyInFlight.current = null; setHistoryLoading(false); }
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
    if (snapshot?.projectId === props.project.id) projectGitWorkbenchCacheEntry(props.client, props.project.id).snapshot = snapshot;
  }, [props.client, props.project.id, snapshot]);

  useEffect(() => {
    window.localStorage.setItem(`astragit.project-git-tab-v2:${props.project.id}`, tab);
  }, [props.project.id, tab]);

  useEffect(() => {
    if (!props.conversationScope && tab === 'console') void operationHistory.refresh();
  }, [tab, operationHistory.refresh, props.conversationScope]);

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
    const ordinary = repository.snapshot.fileStatuses.filter((file) => !conflicts.has(file.path));
    const unstagedPaths = new Set(ordinary.filter((file) => file.workingTreeStatus !== ' ' || file.indexStatus === '?').map((file) => file.path));
    const stagedPaths = new Set(ordinary.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?').map((file) => file.path));
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

  useEffect(() => {
    // 新选择立即清除旧详情，避免旧行高亮在异步读取期间冒充当前选择。
    setCommitDetail(null);
    const revision = tab === 'stash' ? activeStashRef : selectedCommitHash;
    if (!selectedRepository || !revision || (tab !== 'log' && tab !== 'stash')) {
      setCommitLoading(false);
      return;
    }
    let cancelled = false;
    setCommitLoading(true);
    props.client
      .loadProjectGitCommit(props.project.id, selectedRepository.id, revision)
      .then((detail) => {
        if (cancelled) return;
        setCommitDetail(detail);
        setSelectedFilePath(detail.files[0]?.path ?? '');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, zh));
      })
      .finally(() => {
        if (!cancelled) setCommitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.project.id, selectedRepository?.id, selectedCommitHash, activeStashRef, activeStash?.hash, tab]);

  async function loadWorkbench(): Promise<void> {
    // 历史与仓库快照独立读取，仓库刷新失败不能伪装成没有操作记录。
    if (!props.conversationScope) void operationHistory.refresh();
    const version = ++requestVersionRef.current;
    setLoadState('loading');
    setError(null);
    try {
      const next = await requestProjectGitWorkbench(props.client, props.project.id);
      if (version !== requestVersionRef.current) return;
      setSnapshot(next);
      setSelectedRepositoryId((current) => (next.repositories.some((repository) => repository.id === current) ? current : (next.repositories[0]?.id ?? '')));
      setLoadState('ready');
    } catch (reason) {
      if (version !== requestVersionRef.current) return;
      setLoadState('error');
      setError(errorMessage(reason, zh));
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
      const current = currentFileSelection.current;
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
    if ((action.type === 'checkout' || action.type === 'create_branch' || action.type === 'checkout_revision') && (action.type === 'checkout' ? action.branchName !== repository.snapshot.branch : action.stashBeforeCheckout === undefined && repository.snapshot.fileStatuses.length > 0) && !repository.snapshot.conflictFiles.length && !repository.snapshot.integrationState) {
      if (checkoutRequestRef.current || actionBusyRef.current) return Promise.resolve(null);
      return new Promise(resolve => {
        const request = { repository, action, label, resolve };
        checkoutRequestRef.current = request;
        setCheckoutRequest(request);
      });
    }
    return executeConfirmed(repository, action, label);
  }

  async function executeConfirmed(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string, onFailure?: (reason: unknown) => void): Promise<ExecutionOutcome> {
    if (actionBusyRef.current) return null;
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
      const response = await props.client.executeProjectGitAction(props.project.id, repository.id, preparedAction);
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
      if (response.result.outcome === 'completed' && (action.type === 'checkout' || action.type === 'checkout_revision' || action.type === 'create_branch') && response.result.savedStash) setCheckoutNotice({ repositoryId: repository.id, branch: response.snapshot.branch, savedStash: response.result.savedStash });
      if (response.result.outcome === 'conflict') {
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
        ? [{ label: zh ? '刷新仓库状态' : 'Refresh repository', onClick: () => loadWorkbench() }]
        : code === 'ASTRAGIT_GIT_CHECKOUT_BLOCKED' || code === 'ASTRAGIT_GIT_LOCAL_CHANGES_BLOCKED' || code === 'ASTRAGIT_GIT_REBASE_LOCAL_CHANGES'
          ? [{ label: zh ? '查看受影响文件' : 'Review affected files', onClick: reviewFiles }, { label: zh ? '贮藏本地修改…' : 'Stash local changes…', onClick: () => { closeOperationDialogs(); setSelectedRepositoryId(repository.id); setStashRepositoryId(repository.id); } }]
          : ['ASTRAGIT_GIT_CHECKOUT_CONFLICTED', 'ASTRAGIT_GIT_CHECKOUT_INTEGRATION_ACTIVE', 'ASTRAGIT_GIT_UNMERGED_FILES', 'ASTRAGIT_GIT_CONFLICTS_REMAIN', 'ASTRAGIT_GIT_INTEGRATION_ACTIVE'].includes(code ?? '')
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
        title: gitFailureTitle(action, label, repository.name, zh),
        // 首屏说明原因与下一步；真实 Git 诊断保留在可展开的详情中。
        showDetails: false,
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
      if (!props.conversationScope) void operationHistory.refresh(true);
    }
  }

  async function generateCommitMessage(repository: ProjectGitRepositoryWorkbenchItem): Promise<void> {
    if (generatingCommitRef.current || busy || commitModelsLoading || !commitModelRef) return;
    generatingCommitRef.current = true;
    const controller = new AbortController();
    commitGenerationController.current = controller;
    setGeneratingCommitFor(repository.id);
    setCommitGenerationFeedback((current) => ({ ...current, [repository.id]: '' }));
    const originalMessage = commitDrafts[repository.id] ?? '';
    let lastGenerated = originalMessage;
    const updateGenerated = (message: string) => {
      const expected = lastGenerated;
      lastGenerated = message;
      setCommitDrafts((current) => ((current[repository.id] ?? '') === expected ? { ...current, [repository.id]: message } : current));
    };
    try {
      const result = await props.client.generateGitCommitMessage(
        props.project.id,
        { repositoryId: repository.id, relativePath: repository.relativePath, language: zh ? 'zh-CN' : 'en', modelRef: commitModelRef },
        (text) => {
          if (!controller.signal.aborted) updateGenerated(text);
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      updateGenerated(result.message);
      setCommitGenerationFeedback((current) => ({
        ...current,
        [repository.id]:
          (zh ? `已由 ${result.model} 生成，请检查后提交。` : `Generated by ${result.model}. Review before committing.`) +
          (result.truncated ? (zh ? ' 部分大文件或生成文件仅提供摘要，请核对完整性。' : ' Large or generated files were summarized; check completeness.') : ''),
      }));
    } catch (reason) {
      updateGenerated(originalMessage);
      setCommitGenerationFeedback((current) => ({ ...current, [repository.id]: controller.signal.aborted ? (zh ? '已停止生成，已保留原提交说明。' : 'Generation stopped. The original message was preserved.') : errorMessage(reason, zh) }));
    } finally {
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

  function showGitContextMenu(event: GitContextEvent, target: GitContextTarget, position = { x: 'clientX' in event ? event.clientX : 0, y: 'clientY' in event ? event.clientY : 0 }): void {
    event.preventDefault();
    event.stopPropagation();
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
          if (confirmation) setMenuConfirmation({ title, description: `${repository.name} · ${target.ref}\n${confirmation}`, danger, run: async () => (await execute(repository, value, title)) !== null });
          else return execute(repository, value, title).then(() => {});
        },
      });
    const form = (title: string, field: string, build: (text: string) => ProjectGitAction, initialValue = '') =>
      items.push({
        label: title,
        disabled: busy !== null,
        run: () => setMenuConfirmation({ title, description: `${repository.name} · ${target.ref}`, field, initialValue, run: async (text) => (await execute(repository, build(text), title)) !== null }),
      });
    const newBranch = (baseRef: string) => form(label('新建分支…', 'New branch…'), label('分支名称', 'Branch name'), (branchName) => ({ type: 'create_branch', branchName, baseRef }));
    const fileAction = (path: string, intent: 'open' | 'reveal') => () => launchRepositoryFile(repository, path, intent);
    if (target.kind === 'file' || target.kind === 'directory' || target.kind === 'stage') {
      const selectedPaths = target.kind === 'file' && target.paths ? new Set(target.paths) : null;
      const files = repository.snapshot.fileStatuses
        .filter((file) => !repository.snapshot.conflictFiles.includes(file.path))
        .filter((file) => !subtree || subtree.repositoryId !== repository.id || file.path === subtree.path || file.path.startsWith(`${subtree.path}/`))
        .filter(
          (file) =>
            (target.kind === 'stage' || (selectedPaths ? selectedPaths.has(file.path) && file.path.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()) : file.path === target.ref) || (target.kind === 'directory' && file.path.startsWith(`${target.ref}/`))) &&
            (target.stage === 'staged' ? file.indexStatus !== ' ' && file.indexStatus !== '?' : file.workingTreeStatus !== ' ' || file.indexStatus === '?'),
        );
      const paths = selectedPaths ? pruneGitFileSelection(files.map((file) => file.path), target.paths!) : files.map((file) => file.path);
      const multiple = target.kind === 'file' && paths.length > 1;
      items.push({ label: label('Git LFS 管理…', 'Manage Git LFS…'), disabled: busy !== null, run: () => setLfsRequest({ repository }) });
      if (target.kind === 'file' && paths.length === 1 && !repository.snapshot.submodules?.some(item => item.path === paths[0])) {
        const path = paths[0]!; const extension = /[^/.]\.([A-Za-z0-9_-]+)$/u.exec(path)?.[1];
        items.push({ label: label('使用 LFS 跟踪此文件…', 'Track this file with LFS…'), disabled: busy !== null, run: () => setLfsRequest({ repository, change: { operation: 'track', pattern: path, literal: true } }) });
        if (extension) items.push({ label: label(`使用 LFS 跟踪 *.${extension}…`, `Track *.${extension} with LFS…`), disabled: busy !== null, run: () => setLfsRequest({ repository, change: { operation: 'track', pattern: `*.${extension}` } }) });
      }
      items.push({ label: label('使用外部工具比较所选文件…', 'Compare selected files with external tool…'), disabled: busy !== null || !paths.length, run: () => setExternalToolRequest({ repository, input: { mode: 'diff', paths, stage: target.stage === 'staged' ? 'staged' : 'unstaged' } }) });
      const conflictPaths = target.kind === 'file' ? (target.paths ?? [target.ref]).filter(path => repository.snapshot.conflictFiles.includes(path)) : [];
      if (conflictPaths.length) items.push({ label: label(`外部合并所选冲突 (${conflictPaths.length})…`, `Merge selected conflicts externally (${conflictPaths.length})…`), disabled: busy !== null, run: () => setExternalToolRequest({ repository, input: { mode: 'merge', paths: conflictPaths } }) });
      if (multiple) menuTitle = label(`已选择 ${paths.length} 个文件`, `${paths.length} files selected`);
      items.push({ label: label('导出所选文件补丁…', 'Export selected files as patch…'), disabled: !paths.length || busy !== null, run: () => setPatchRequest({ repository, mode: 'export', paths, scope: target.stage === 'staged' ? 'staged' : 'unstaged' }) });
      const stageLabel = target.stage === 'staged' ? label('取消暂存', 'Unstage') : label('暂存', 'Stage');
      action(multiple ? label(`${stageLabel}所选文件 (${paths.length})`, `${stageLabel} selected files (${paths.length})`) : stageLabel, { type: target.stage === 'staged' ? 'unstage' : 'stage', paths }, undefined, false, !paths.length);
      if (target.kind === 'file') items.push({ label: multiple ? label('查看当前文件差异', 'View current file diff') : label('查看差异', 'View diff'), run: () => openDiffWindow(repository, target.ref, { stage: target.stage }) });
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
          label(`将 ${tracked.length} 个已跟踪文件恢复为暂存区内容。未跟踪文件不会被删除。此操作无法撤销。\n${tracked.join('\n')}`, `Restore ${tracked.length} tracked files from the index. Untracked files are kept. This cannot be undone.`),
          true,
          !tracked.length || repository.snapshot.conflictFiles.length > 0,
        );
      }
      if (target.kind !== 'stage') items.push({ label: multiple ? label('复制所选相对路径', 'Copy selected relative paths') : label('复制相对路径', 'Copy relative path'), run: () => copy(target.kind === 'file' ? paths.join('\n') : target.ref) });
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
          items.push({ label: label('删除远程分支…', 'Delete remote branch…'), danger: true, disabled: busy !== null || !repository.snapshot.remoteBranchHeads?.[target.ref] || !repository.snapshot.remoteDetails?.find(item => item.name === remote)?.pushFingerprint, run: () => setBranchManagement({ kind: 'delete-remote', repository, remote, branchName: parsed.branch }) });
          items.push({ label: label('设为当前分支的上游…', 'Track from current branch…'), disabled: busy !== null || repository.snapshot.detached || !repository.snapshot.localBranchHeads?.[repository.snapshot.branch], run: () => setBranchManagement({ kind: 'upstream', repository, branchName: repository.snapshot.branch, initialUpstreamRef: `refs/remotes/${target.ref}` }) });
        }
      }
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
      action(label('应用贮藏', 'Apply stash'), { type: 'apply_stash', stashRef: target.ref });
      action(label('应用并移除贮藏…', 'Pop stash…'), { type: 'apply_stash', stashRef: target.ref, pop: true }, label('应用成功后删除该贮藏；发生冲突时保留。', 'Remove the stash after successful application; keep it on conflicts.'));
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
    setContextMenu({ ...position, title: menuTitle, items, target });
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

  function openDiffWindow(repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: { stage?: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] }): void {
    if (props.conversationScope) {
      const request = options?.revisions
        ? props.client.loadProjectGitRevisionsDiff(props.project.id, repository.id, options.revisions).then(comparison => comparison.diff)
        : options?.comparisonRef
        ? props.client.loadProjectGitComparisonDiff(props.project.id, repository.id, options.comparisonRef, options.comparisonMode ?? 'current')
        : options?.commitHash
          ? props.client.loadProjectGitCommit(props.project.id, repository.id, options.commitHash).then((detail) => detail.diff)
          : Promise.resolve(options?.stage === 'staged' ? repository.snapshot.stagedDiff : options?.stage === 'unstaged' ? repository.snapshot.unstagedDiff : repository.snapshot.diff);
      void request
        .then((diff) =>
          setConversationDiff({
            diff: filePath ? { ...diff, files: [filePath], fileDiffs: diff.fileDiffs.filter((file) => file.newPath === filePath || file.oldPath === filePath) } : diff,
            preview: { kind: 'project-git', projectId: props.project.id, repositoryId: repository.id, path: filePath, ...options },
          }),
        )
        .catch((reason: unknown) => setError(errorMessage(reason, zh)));
      return;
    }
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

  if (loadState === 'loading' && !snapshot) {
    return (
      <section className="project-git-workbench-state" aria-live="polite">
        <CircleNotch aria-hidden="true" className="project-git-spinner" />
        <strong>{zh ? '正在读取项目的 Git 状态' : 'Loading the project’s Git status'}</strong>
        <span>{zh ? '正在查找项目中的 Git 仓库。' : 'Finding Git repositories in this project.'}</span>
      </section>
    );
  }

  if (loadState === 'error' && !snapshot) {
    return (
      <section className="project-git-workbench-state" role="alert">
        <VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} />
        <Button variant="secondary" onClick={() => void loadWorkbench()}>
          {zh ? '重新读取' : 'Reload'}
        </Button>
      </section>
    );
  }

  if (repositories.length === 0) {
    return (
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
      {busy || selectedRepository?.snapshot.integrationState || checkoutNotice ? (
        <aside className="git-operation-notice" aria-label={zh ? 'Git 操作状态' : 'Git operation status'}>
          <span className="git-operation-notice-status" role="status">
            {busy ? <CircleNotch aria-hidden="true" className="project-git-spinner" /> : selectedRepository?.snapshot.integrationState ? <WarningCircle aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}
            <span>
              <strong>{!busy && !selectedRepository?.snapshot.integrationState && checkoutNotice ? repositories.find(repository => repository.id === checkoutNotice.repositoryId)?.name : activeOperationRepository?.name}</strong>
              <span>{busy ? `${operationActionLabels[busy.action][zh ? 0 : 1]}…` : selectedRepository?.snapshot.integrationNoCommit ? (zh ? `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}待完成：解决并暂存冲突，先提交已应用内容，再继续剩余提交。` : `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)} in progress: resolve and stage conflicts, commit the applied contents, then continue the remaining commits.`) : selectedRepository?.snapshot.integrationState ? (zh ? `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)}待完成` : `${gitIntegrationLabel(selectedRepository.snapshot.integrationState, zh)} in progress`) : zh ? `已切换到 ${checkoutNotice?.branch}；本地修改保留在贮藏中` : `Switched to ${checkoutNotice?.branch}; local changes remain in a stash`}</span>
            </span>
          </span>
          <div className="git-operation-notice-actions">
            {!busy && !selectedRepository?.snapshot.integrationState && checkoutNotice ? <><Button variant="secondary" size="compact" onClick={() => { setSelectedRepositoryId(checkoutNotice.repositoryId); setSelectedStashRef(repositories.find(repository => repository.id === checkoutNotice.repositoryId)?.snapshot.stashes.find(stash => stash.hash === checkoutNotice.savedStash)?.ref ?? ''); setTab('stash'); setCheckoutNotice(null); }}>{zh ? '查看贮藏' : 'View stash'}</Button><Button variant="secondary" size="compact" onClick={() => setCheckoutNotice(null)}>{zh ? '关闭' : 'Close'}</Button></> : null}
            {busy && !(props.conversationScope ?? false) ? (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  if (stagePreviewController.current) {
                    stagePreviewController.current.abort(); stageRequestRef.current?.resolve(null); stageRequestRef.current = null; setStageRequest(null); return;
                  }
                  void props.client.cancelProjectGitAction(props.project.id, busy.repositoryId).catch((reason: unknown) => setError(errorMessage(reason, zh)));
                }}
              >
                {zh ? '中止操作' : 'Stop operation'}
              </Button>
            ) : null}
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

      <MotionPresence>
        {conversationDiff ? (
          <ModalPortal role="dialog" aria-label={zh ? '文件差异' : 'File diff'} onDismiss={() => setConversationDiff(null)}>
            <section className="conversation-git-delivery">
              <header>
                <strong>{((conversationDiff.preview as any).path)}</strong>
                <Button onClick={() => setConversationDiff(null)}>{zh ? '关闭' : 'Close'}</Button>
              </header>
              <SideBySideDiff previewRequest={(conversationDiff.preview as never)} diff={conversationDiff.diff} zh={zh} fill />
            </section>
          </ModalPortal>
        ) : null}
      </MotionPresence>

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

      <div className="project-git-browser-layout">
        <aside className="project-git-navigator" aria-label={zh ? 'Git 导航' : 'Git navigation'}>
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
          <nav className="git-workspace-navigation" aria-label={zh ? 'Git 工作区' : 'Git workspace'}>
            <strong>{zh ? '工作区' : 'Workspace'}</strong>
            {(
              [
                ['changes', zh ? '文件状态' : 'File Status', <File key="file" />, changedCount],
                ['log', zh ? '历史' : 'History', <History key="history" />, null],
              ] as const
            ).map(([id, label, icon, count]) => (
              <button type="button" key={id} aria-current={tab === id || (id === 'changes' && tab === 'ignored') ? 'page' : undefined} onClick={() => setTab(id)}>
                {icon}
                <span>{label}</span>
                {count !== null ? <small>{count}</small> : null}
              </button>
            ))}
          </nav>
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
                  }}
                />
              </details>
            ))}
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
                    selected={tab === 'log' ? (historyRef === 'HEAD' && namespace === 'heads' ? selectedRepository.snapshot.branch : historyRef.startsWith(`refs/${namespace}/`) ? historyRef.slice(`refs/${namespace}/`.length) : '') : ''}
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
                      setTab('log');
                      setHistoryRef(`refs/${namespace}/${ref}`);
                      selectCommit(selectedRepository, `refs/${namespace}/${ref}`);
                    }}
                    onCheckout={
                      branches === selectedRepository.snapshot.tags
                        ? undefined
                        : (ref) => {
                            if (kind === 'remote') {
                              setRemoteCheckoutTarget({ repositoryId: selectedRepository.id, remoteRef: ref });
                              return;
                            }
                            if (!selectedRepository.snapshot.detached && selectedRepository.snapshot.branch === ref) return;
                            void execute(selectedRepository, { type: 'checkout', branchName: ref }, zh ? `切换到分支“${ref}”` : `Checkout '${ref}'`).then((outcome) => {
                              if (outcome !== 'completed') return;
                              setTab('log');
                              setHistoryRef('');
                              setSelectedCommit(null);
                            });
                          }
                    }
                    onContextMenu={(event, ref) => showGitContextMenu(event, { kind: branches === selectedRepository.snapshot.tags ? 'tag' : kind, repositoryId: selectedRepository.id, ref })}
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
        </aside>
        <GitPaneSeparator name="navigation" label={zh ? '调整 Git 导航宽度' : 'Resize Git navigation'} initial={20} min={12} max={40} />
        <div className="project-git-browser-content">
          <header className="project-git-toolbar git-command-toolbar" aria-label={zh ? 'Git 工具栏' : 'Git toolbar'}>
            <button type="button" disabled={!selectedRepository || busy !== null} onClick={openCommit}>
              <GitCommit />
              <span>{zh ? '提交' : 'Commit'}</span>
            </button>
            <i />
            <button type="button" disabled={!selectedRepository || busy !== null || selectedRepository.snapshot.detached || !selectedRepository.snapshot.remotes.length} onClick={() => setPullOpen(true)}>
              <ArrowDown />
              <span>{zh ? '拉取' : 'Pull'}</span>
              {selectedRepository?.snapshot.behind ? <small>{selectedRepository.snapshot.behind}</small> : null}
            </button>
            <button type="button" disabled={!selectedRepository || busy !== null || selectedRepository.snapshot.detached || !selectedRepository.snapshot.remotes.length} onClick={openPush}>
              <ArrowUp />
              <span>{zh ? '推送' : 'Push'}</span>
              {selectedRepository?.snapshot.ahead ? <small>{selectedRepository.snapshot.ahead}</small> : null}
            </button>
            <button
              type="button"
              disabled={!selectedRepository || busy !== null || !selectedRepository.snapshot.remotes.length}
              onClick={() => {
                if (selectedRepository) void execute(selectedRepository, { type: 'fetch' }, zh ? '获取远端' : 'Fetch');
              }}
            >
              <ArrowsClockwise />
              <span>{zh ? '抓取' : 'Fetch'}</span>
            </button>
            <i />
            <button
              type="button"
              disabled={!selectedRepository || busy !== null}
              onClick={() => {
                setNewBranchBase('');
                setNewBranchOpen(true);
              }}
            >
              <GitBranch />
              <span>{zh ? '分支' : 'Branch'}</span>
            </button>
            <button type="button" disabled={!selectedRepository || busy !== null || selectedRepository.snapshot.detached || Boolean(selectedRepository.snapshot.integrationState)} onClick={() => setMergeOpen(true)}>
              <GitMerge />
              <span>{zh ? '合并' : 'Merge'}</span>
            </button>
            <button type="button" disabled={!selectedRepository || busy !== null} onClick={() => selectedRepository && setTagRequest({ repository: selectedRepository })}><Tag /><span>{zh ? '标签' : 'Tag'}</span></button>
            <button
              type="button"
              disabled={!selectedRepository || busy !== null || selectedRepository.snapshot.clean || selectedRepository.snapshot.conflictFiles.length > 0}
              onClick={() => {
                if (selectedRepository) setStashRepositoryId(selectedRepository.id);
              }}
            >
              <Archive />
              <span>{zh ? '贮藏' : 'Stash'}</span>
            </button>
            <span className="project-git-menu-anchor">
              <button ref={operationsTriggerRef} type="button" aria-haspopup="menu" aria-expanded={operationsOpen} onClick={() => setOperationsOpen((current) => !current)}>
                <DotsThree aria-hidden="true" />
                <span>{zh ? '操作' : 'Actions'}</span>
              </button>
              <MotionPresence>
                {operationsOpen ? (
                  <OperationsMenu
                    anchor={operationsTriggerRef.current}
                    zh={zh}
                    onClose={() => setOperationsOpen(false)}
                    onOpenCommit={openCommit}
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
                    onOpenSettings={selectedRepository && busy === null ? () => setSettingsRepository(selectedRepository) : undefined}
                    onOpenAmend={selectedRepository && busy === null && selectedRepository.snapshot.headSha && !selectedRepository.snapshot.integrationState && !selectedRepository.snapshot.conflictFiles.length && selectedRepository.snapshot.indexFingerprint ? () => openAmend(selectedRepository) : undefined}
                    onOpenPush={openPush}
                    onOpenUpdate={() => setUpdateOpen(true)}
                    onOpenNewBranch={() => {
                      setNewBranchBase('');
                      setNewBranchOpen(true);
                    }}
                    onOpenRevision={() => setRevisionOpen(true)}
                    onSelectTab={setTab}
                    onOpenConsole={props.conversationScope ? undefined : () => setTab('console')}
                    onOpenSubtree={() => setSubtreeDialogOpen(true)}
                  />
                ) : null}
              </MotionPresence>
            </span>

            <button type="button" disabled={busy !== null} onClick={() => { void loadWorkbench(); setHistoryReload(value => value + 1); }}>
              <ArrowsClockwise />
              <span>{zh ? '刷新' : 'Refresh'}</span>
            </button>
          </header>
          <div className={`git-content-toolbar${tab === 'log' ? ' is-history-toolbar' : ''}`}>
            <strong>{tab === 'changes' || tab === 'ignored' ? (zh ? '文件状态' : 'File Status') : tab === 'log' ? (zh ? '提交历史' : 'Commit history') : tab === 'stash' ? (zh ? '贮藏' : 'Stashes') : zh ? '操作记录' : 'Operation history'}</strong>
            {(tab === 'changes' || tab === 'ignored') && selectedRepository ? <select aria-label={zh ? '文件范围' : 'File scope'} value={tab} onChange={event => setTab(event.currentTarget.value === 'ignored' ? 'ignored' : 'changes')}><option value="changes">{zh ? '更改文件' : 'Changed files'}</option><option value="ignored">{zh ? '已忽略文件' : 'Ignored files'}</option></select> : null}
            {tab === 'log' && selectedRepository ? (
              <select
                aria-label={zh ? '历史分支范围' : 'History branch scope'}
                value={historyRef}
                onChange={(event) => {
                  setHistoryRef(event.currentTarget.value);
                  setSelectedCommit(null);
                  setSelectedFilePath('');
                }}
              >
                <option value="">{zh ? '全部分支' : 'All branches'}</option>
                <option value="HEAD">{zh ? '当前分支' : 'Current branch'}</option>
                {historyRef && historyRef !== 'HEAD' && ![...selectedRepository.snapshot.localBranches.map(ref => `refs/heads/${ref}`), ...selectedRepository.snapshot.remoteBranches.map(ref => `refs/remotes/${ref}`), ...selectedRepository.snapshot.tags.map(ref => `refs/tags/${ref}`)].includes(historyRef) ? <option value={historyRef}>{historyRef.replace(/^refs\/(?:heads|remotes|tags)\//u, '')}</option> : null}
                {([['heads', zh ? '本地' : 'Local', selectedRepository.snapshot.localBranches], ['remotes', zh ? '远程' : 'Remote', selectedRepository.snapshot.remoteBranches], ['tags', zh ? '标签' : 'Tag', selectedRepository.snapshot.tags]] as const).flatMap(([namespace, label, refs]) => refs.map(ref => <option key={`${namespace}:${ref}`} value={`refs/${namespace}/${ref}`}>{label} · {ref}</option>))}
              </select>
            ) : null}
            {tab === 'log' ? <>
              <select aria-label={zh ? '历史搜索字段' : 'History search field'} value={historyField} onChange={event => setHistoryField(event.target.value as GitHistorySearchField)}>
                <option value="all">{zh ? '全部字段' : 'All fields'}</option><option value="message">{zh ? '完整提交说明' : 'Full commit message'}</option><option value="author">{zh ? '作者' : 'Author'}</option><option value="hash">{zh ? '提交哈希' : 'Commit hash'}</option>
              </select>
              <select aria-label={zh ? '历史排序' : 'History order'} value={historyOrder} onChange={event => setHistoryOrder(event.target.value === 'date' ? 'date' : 'topo')}><option value="topo">{zh ? '拓扑顺序' : 'Ancestor order'}</option><option value="date">{zh ? '日期顺序' : 'Date order'}</option></select>
            </> : null}
            {tab === 'changes' || tab === 'ignored' || tab === 'log' ? (
              <label>
                <MagnifyingGlass />
                <input
                  aria-label={tab === 'ignored' ? (zh ? '筛选当前忽略范围' : 'Filter current ignored scope') : tab === 'changes' ? (zh ? '筛选更改文件' : 'Filter changed files') : zh ? '搜索提交' : 'Search commits'}
                  value={tab === 'ignored' ? ignoredQuery : tab === 'changes' ? fileQuery : searchQuery}
                  onChange={(event) => (tab === 'ignored' ? setIgnoredQuery(event.currentTarget.value) : tab === 'changes' ? setFileQuery(event.currentTarget.value) : setSearchQuery(event.currentTarget.value))}
                  placeholder={tab === 'ignored' ? (zh ? '筛选当前范围…' : 'Filter current scope…') : tab === 'changes' ? (zh ? '筛选文件…' : 'Filter files…') : zh ? '搜索完整历史的说明、作者或哈希…' : 'Search all history by message, author or hash…'}
                />
              </label>
            ) : null}
          </div>
          {tab === 'log' ? (
            <GitLogSurface
              projectId={props.project.id}
              client={props.client}
              zh={zh}
              repositories={repositories}
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
              onSelectRepository={setSelectedRepositoryId}
              onSelectCommit={selectCommit}
              onOpenChanges={() => setTab('changes')}
              onSelectFile={setSelectedFilePath}
              busy={busy}
              onExecute={execute}
              onOpenDiff={openDiffWindow}
              onManageBranch={setBranchManagement}
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
              onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : <p className="project-git-empty-copy">{zh ? '请选择一个仓库。' : 'Select a repository.'}</p>
          ) : tab === 'changes' ? (
            <LocalChangesSurface
              client={props.client}
              query={fileQuery}
              commitRequest={commitRequest}
              externalRevision={selectedRepository ? externalRevisions[selectedRepository.id] : undefined}
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
              onConflictSaved={conflictSaved}
              onConfirmAction={(repository, action, title, description, danger) =>
                setMenuConfirmation({
                  title,
                  description: `${repository.name}\n${description}`,
                  danger,
                  run: async () => (await execute(repository, action, title)) !== null,
                })
              }
              onCommit={() => setCommitOpen(true)}
              commitDrafts={commitDrafts}
              commitModels={commitModels}
              commitModelRef={commitModelRef}
              commitModelsLoading={commitModelsLoading}
              commitModelsError={commitModelsError}
              onSelectCommitModel={selectCommitModel}
              onRefreshCommitModels={() => setCommitModelsRefresh((current) => current + 1)}
              generatingCommitFor={generatingCommitFor}
              generationFeedback={selectedRepository ? commitGenerationFeedback[selectedRepository.id] : undefined}
              onGenerateCommitMessage={generateCommitMessage}
              onStopCommitGeneration={() => commitGenerationController.current?.abort()}
              onCommitMessageChange={(repositoryId, message) => setCommitDrafts((current) => ({ ...current, [repositoryId]: message }))}
              onCommitTemplateApply={(repositoryId, message, expected) => setCommitDrafts(current => (current[repositoryId] ?? '') === expected ? { ...current, [repositoryId]: message } : current)}
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
              onExecute={execute}
            />
          ) : (
            <ConsoleSurface zh={zh} history={operationHistory} />
          )}
        </div>
      </div>

      <MotionPresence>{mergeOptions ? <MergeBranchDialog key={`${mergeOptions.repository.id}:${mergeOptions.source}`} repository={mergeOptions.repository} initialBranch={mergeOptions.source} zh={zh} busy={busy} onClose={() => setMergeOptions(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{mergeOpen && selectedRepository ? <MergeBranchDialog repository={selectedRepository} zh={zh} busy={busy} onClose={() => setMergeOpen(false)} onExecute={execute} /> : null}</MotionPresence>
      {checkoutRequest ? <GitCheckoutDialog repository={checkoutRequest.repository} action={checkoutRequest.action} zh={zh} busy={busy !== null} onClose={() => { checkoutRequestRef.current = null; setCheckoutRequest(null); checkoutRequest.resolve(null); }} onConfirm={async stash => {
        if (actionBusyRef.current) return;
        const outcome = await executeConfirmed(checkoutRequest.repository, { ...checkoutRequest.action, stashBeforeCheckout: stash }, checkoutRequest.label);
        checkoutRequestRef.current = null; setCheckoutRequest(null); checkoutRequest.resolve(outcome);
      }} /> : null}
      <MotionPresence>
        {subtreeDialogOpen && selectedRepository ? <SubtreeManagementDialog key={selectedRepository.id} repository={selectedRepository} zh={zh} busy={busy} onClose={() => setSubtreeDialogOpen(false)} onExecute={execute} /> : null}
      </MotionPresence>
      <MotionPresence>{contextMenu ? <GitContextMenu {...contextMenu} onClose={() => setContextMenu(null)} onError={(reason) => setError(errorMessage(reason, zh))} /> : null}</MotionPresence>
      <MotionPresence>{menuConfirmation ? <GitMenuActionDialog value={menuConfirmation} zh={zh} onClose={() => setMenuConfirmation(null)} /> : null}</MotionPresence>
      <MotionPresence>{commitOpen ? <CommitDialog open={commitOpen} client={props.client} projectId={props.project.id} zh={zh} repositories={repositories} busy={busy} onClose={() => setCommitOpen(false)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{interactiveRebase ? <GitInteractiveRebaseDialog key={`${props.project.id}:${interactiveRebase.repository.id}:${interactiveRebase.baseRef ?? 'default'}`} request={interactiveRebase} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setInteractiveRebase(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{amendStepRepository ? <GitAmendDialog key={`rebase:${amendStepRepository.id}`} projectId={props.project.id} client={props.client} repository={amendStepRepository} rebaseStep zh={zh} busy={busy !== null} onClose={() => setAmendStepRepository(null)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>{amendRepository ? <GitAmendDialog key={amendRepository.id} projectId={props.project.id} client={props.client} repository={amendRepository} zh={zh} busy={busy !== null} onClose={() => setAmendRepository(null)} onExecute={execute} /> : null}</MotionPresence>
      {stageRequest ? <GitStageReviewDialog key={stageRequest.preview.fingerprint} repositoryName={stageRequest.repository.name} preview={stageRequest.preview} zh={zh} selectionHint={stageRequest.selectionHint} onDecide={decision => {
        const request = stageRequestRef.current; stageRequestRef.current = null; setStageRequest(null); request?.resolve(decision);
      }} /> : null}
      {flowRequest ? <GitFlowDialog key={JSON.stringify([props.project.id, flowRequest.repository.id, flowRequest.change])} request={flowRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setFlowRequest(null)} onResolve={() => {
        const repository = currentSnapshot.current?.repositories.find(item => item.id === flowRequest.repository.id);
        setSelectedRepositoryId(flowRequest.repository.id); setSelectedFilePath(repository?.snapshot.conflictFiles[0] ?? ''); setSelectedFileStage('unstaged'); setTab('changes'); setFlowRequest(null);
      }} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, flowRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}
      {lfsRequest ? <GitLfsDialog key={JSON.stringify([props.project.id, lfsRequest.repository.id, lfsRequest.change])} request={lfsRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setLfsRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, lfsRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}
      {externalToolRequest ? <GitExternalToolDialog key={JSON.stringify([externalToolRequest.repository.id, externalToolRequest.input])} request={externalToolRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setExternalToolRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, externalToolRequest.repository.id); }} onExecute={async (repository, action, label) => {
        let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; });
        if (action.type === 'external_tool' && action.input.mode === 'merge') {
          setExternalRevisions(current => ({ ...current, [repository.id]: (current[repository.id] ?? 0) + 1 }));
          setSelectedRepositoryId(repository.id); setTab('changes'); setSelectedFilePath(action.input.paths[0] ?? ''); setSelectedFileStage(outcome === 'completed' && action.input.markResolved ? 'staged' : 'unstaged');
        }
        return { outcome, error };
      }} /> : null}
      {submoduleRequest ? <GitSubmoduleManagementDialog key={JSON.stringify([submoduleRequest.repository.id, submoduleRequest.path])} repository={submoduleRequest.repository} initialPath={submoduleRequest.path} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setSubmoduleRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, submoduleRequest.repository.id); }} onOpenRepository={path => {
        const target = currentSnapshot.current?.repositories.find(item => item.relativePath === [submoduleRequest.repository.relativePath === '.' ? '' : submoduleRequest.repository.relativePath, path].filter(Boolean).join('/'));
        if (target) { setSelectedRepositoryId(target.id); setTab('changes'); setSubmoduleRequest(null); }
        else setError(zh ? '子仓库尚未被项目发现，请重新载入工作台后查看。' : 'The module has not been discovered in this project. Reload the workbench first.');
      }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}
      <MotionPresence>{settingsRepository ? <GitRepositorySettingsDialog key={settingsRepository.id} projectId={props.project.id} client={props.client} repository={settingsRepository} zh={zh} busy={busy !== null} onClose={() => setSettingsRepository(null)} onExecute={execute} /> : null}</MotionPresence>
      {tagRequest ? <GitTagManagementDialog key={JSON.stringify([tagRequest.repository.id, tagRequest.mode, tagRequest.revision, tagRequest.tagName])} request={tagRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setTagRequest(null)} onOpenCommit={hash => { setSelectedRepositoryId(tagRequest.repository.id); setTab('log'); selectCommit(tagRequest.repository, hash); setTagRequest(null); }} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, tagRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}
      {patchRequest ? <GitPatchDialog key={JSON.stringify([patchRequest.repository.id, patchRequest.mode, patchRequest.scope, patchRequest.revision, patchRequest.paths, patchRequest.revisions])} request={patchRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setPatchRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, patchRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}
      {fileHistoryRequest ? <GitFileHistoryDialog key={JSON.stringify([fileHistoryRequest.repository.id, fileHistoryRequest.path, fileHistoryRequest.ref, fileHistoryRequest.view])} request={fileHistoryRequest} projectId={props.project.id} client={props.client} zh={zh} onClose={() => setFileHistoryRequest(null)} onOpenCommit={hash => { setSelectedRepositoryId(fileHistoryRequest.repository.id); setTab('log'); selectCommit(fileHistoryRequest.repository, hash); setFileHistoryRequest(null); }} /> : null}
      <MotionPresence>{stopTrackingRequest ? <GitStopTrackingDialog key={JSON.stringify([stopTrackingRequest.repository.id, stopTrackingRequest.paths])} request={stopTrackingRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setStopTrackingRequest(null)} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}</MotionPresence>
      <MotionPresence>{ignoreRequest ? <GitIgnoreDialog key={ignoreRequest.repository.id} request={ignoreRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setIgnoreRequest(null)} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}</MotionPresence>
      <MotionPresence>{branchManagement ? <GitBranchManagementDialog key={`${branchManagement.repository.id}:${branchManagement.kind}`} request={branchManagement} zh={zh} busy={busy !== null} onClose={() => setBranchManagement(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, branchManagement.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} /> : null}</MotionPresence>
      <MotionPresence>{revisionAction ? <GitRevisionActionDialog key={`${revisionAction.repository.id}:${revisionAction.type}:${revisionAction.type === 'reset' ? revisionAction.revision : revisionAction.kind}`} request={revisionAction} client={props.client} projectId={props.project.id} zh={zh} busy={busy !== null} onClose={() => setRevisionAction(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, revisionAction.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} onCompleted={preview => {
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
            errorsByRepository={operationErrorsByRepositoryRef.current}
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
      <MotionPresence>{pullOpen && selectedRepository ? <PullDialog key={selectedRepository.id} repository={selectedRepository} zh={zh} busy={busy} onClose={() => setPullOpen(false)} onExecute={execute} /> : null}</MotionPresence>
      <MotionPresence>
        {pushOpen ? (
          <PushDialog
            open={pushOpen}
            zh={zh}
            repositories={repositories}
            selectedRepository={selectedRepository}
            busy={busy}
            results={pushResults}
            onClose={() => {
              setPushOpen(false);
              setPushResults([]);
            }}
            onPush={async (selections, forceWithLease, pushTags) => {
              const results: Array<{ repositoryId: string; repositoryName: string; tone: OperationTone; message: string }> = [];
              for (const selection of selections) {
                const repository = repositories.find((candidate) => candidate.id === selection.repositoryId)!;
                const ok = await execute(
                  repository,
                  { type: 'push', remote: selection.remote, sourceBranch: selection.sourceBranch, targetBranch: selection.targetBranch, setUpstream: selection.setUpstream, forceWithLease, pushAllTags: pushTags },
                  zh ? '推送提交' : 'Push commits',
                );
                results.push({
                  repositoryId: repository.id,
                  repositoryName: `${repository.name} · ${selection.sourceBranch}`,
                  tone: ok === 'completed' ? 'success' : 'error',
                  message: ok === 'completed'
                    ? zh
                      ? `已推送到 ${selection.remote}/${selection.targetBranch}`
                      : `Pushed to ${selection.remote}/${selection.targetBranch}`
                    : (operationErrorsByRepositoryRef.current[repository.id] ?? (zh ? '推送失败。' : 'Push failed.')),
                });
              }
              setPushResults(results);
            }}
          />
        ) : null}
      </MotionPresence>
      {replaySeriesRequest ? <GitCommitReplaySeriesDialog key={JSON.stringify([props.project.id, replaySeriesRequest.repository.id, replaySeriesRequest.revisions])} request={replaySeriesRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setReplaySeriesRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, replaySeriesRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} onCompleted={preview => { if (!preview.input.commit) { setSelectedRepositoryId(replaySeriesRequest.repository.id); setTab('changes'); setSelectedFilePath(preview.files[0] ?? ''); setSelectedFileStage('staged'); } }} /> : null}
      {replayRequest ? <GitCommitReplayDialog key={JSON.stringify([props.project.id, replayRequest.repository.id, replayRequest.kind, replayRequest.revision, replayRequest.mainline])} request={replayRequest} projectId={props.project.id} client={props.client} zh={zh} busy={busy !== null} onClose={() => setReplayRequest(null)} onAbort={async () => { await props.client.cancelProjectGitAction(props.project.id, replayRequest.repository.id); }} onExecute={async (repository, action, label) => { let error: unknown; const outcome = await executeConfirmed(repository, action, label, reason => { error = reason; }); return { outcome, error }; }} onCompleted={preview => {
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

const gitHistoryRowHeight = 28;

function GitLogSurface(props: {
  /** 仓库预览所属项目。 */
  projectId: string;
  client: Pick<DashboardClient, 'loadProjectGitRevisionsDiff'>;
  zh: boolean;
  historyLoading: boolean;
  historyError: string;
  historyHasMore: boolean;
  onLoadMore: () => void;
  onReloadHistory: () => void;
  repositories: ProjectGitRepositoryWorkbenchItem[];
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
  onSelectRepository: (repositoryId: string) => void;
  onSelectCommit: (repository: ProjectGitRepositoryWorkbenchItem, commitHash: string) => void;
  onOpenChanges: () => void;
  onSelectFile: (path: string) => void;
  busy: BusyState;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
  onManageBranch: (request: GitBranchManagementRequest) => void;
  onInteractiveRebase: (repository: ProjectGitRepositoryWorkbenchItem, baseRef: string) => void;
  onReset: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onPatchExport: (repository: ProjectGitRepositoryWorkbenchItem, revision: string, path?: string) => void;
  onArchive: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onExternalTool: (request: GitExternalToolRequest) => void;
  onCreateTag: (repository: ProjectGitRepositoryWorkbenchItem, revision: string) => void;
  onFileHistory: (repository: ProjectGitRepositoryWorkbenchItem, path: string, ref: string, view: 'history' | 'blame') => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: { stage?: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] }) => void;
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
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; repository: ProjectGitRepositoryWorkbenchItem; branch: string; kind: BranchKind } | null>(null);
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
    <div className="project-git-log-layout" style={{ '--git-history-row-height': `${gitHistoryRowHeight}px` } as React.CSSProperties}>
      <aside className="project-git-repository-rail">
        <header>
          <strong>{props.zh ? '仓库与分支' : 'Repositories and branches'}</strong>
        </header>
        {props.repositories.map((repository) => (
          <section key={repository.id} className={repository.id === props.selectedRepository?.id ? 'is-current' : ''}>
            <button type="button" className="project-git-repository-row" onClick={() => props.onSelectRepository(repository.id)}>
              <GitBranch aria-hidden="true" />
              <span>
                <strong>{repository.name}</strong>
                <small>{repository.relativePath === '.' ? repository.snapshot.branch : `${repository.relativePath} · ${repository.snapshot.branch}`}</small>
              </span>
              {repository.snapshot.fileStatuses.length > 0 ? <em>{repository.snapshot.fileStatuses.length}</em> : null}
            </button>
            <div className="project-git-branch-tree">
              <span>{props.zh ? '本地分支' : 'Local branches'}</span>
              <BranchDirectoryTree
                branches={repository.snapshot.localBranches}
                current={repository.snapshot.branch}
                kind="local"
                zh={props.zh}
                onContextMenu={(event, branch) => {
                  event.preventDefault();
                  setBranchMenu({ x: event.clientX, y: event.clientY, repository, branch, kind: 'local' });
                }}
              />
              {repository.snapshot.remoteBranches.length > 0 ? <span>{props.zh ? '远程分支' : 'Remote branches'}</span> : null}
              <BranchDirectoryTree
                branches={repository.snapshot.remoteBranches}
                current=""
                kind="remote"
                zh={props.zh}
                onContextMenu={(event, branch) => {
                  event.preventDefault();
                  setBranchMenu({ x: event.clientX, y: event.clientY, repository, branch, kind: 'remote' });
                }}
              />
            </div>
          </section>
        ))}
      </aside>
      <main className="project-git-commit-list">
        <header className="project-git-list-header">
          <span className="git-history-graph-heading">{props.zh ? '图表' : 'Graph'}</span>
          <span>{props.zh ? '描述' : 'Description'}</span>
          <span>{props.zh ? '提交' : 'Commit'}</span>
          <span>{props.zh ? '作者' : 'Author'}</span>
          <span>{props.zh ? '日期' : 'Date'}</span>
        </header>
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
        <div className="project-git-commit-scroll" ref={historyScroll}>
          <CommitGraph commits={props.commits.map(({ commit }) => commit)} />
          <div className="project-git-commit-rows">
            {props.commits.length === 0 ? <p role="status">{props.zh ? '所选历史范围没有匹配的提交，请调整条件或刷新范围。' : 'No commits match in this history scope. Adjust the search or refresh the scope.'}</p> : null}
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
                    {formatRelativeTime(commit.authoredAt, props.zh)}
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
          </div>
        </div>
      </main>
      <GitPaneSeparator name="history" label={props.zh ? '调整历史与详情高度' : 'Resize history and details'} axis="y" initial={55} min={20} max={75} />
      <aside className="project-git-inspector">
        {selectedHashes.length === 0 ? <p>{props.zh ? '选择一个提交查看文件与差异。' : 'Select a commit to view its files and diff.'}</p> : selectedHashes.length === 2 && props.selectedRepository ? <GitHistoryComparisonInspector key={JSON.stringify([props.selectionScope, ...selectedHashes])} projectId={props.projectId} client={props.client} repository={props.selectedRepository} revisions={[selectedHashes[1]!, selectedHashes[0]!]} zh={props.zh} onOpenDiff={props.onOpenDiff} onExport={props.onExportComparison} onExternal={props.onExternalTool} onHistory={props.onFileHistory} /> : props.commitLoading ? (
          <div className="project-git-inspector-loading">
            <CircleNotch aria-hidden="true" />
            {props.zh ? '正在读取提交' : 'Loading commit'}
          </div>
        ) : detail ? (
          <>
            <section className="project-git-commit-detail">
              <strong>{detail.commit.subject}</strong>
              <span>{detail.commit.author}</span>
              <small>
                {detail.commit.shortHash} · {new Date(detail.commit.authoredAt).toLocaleString()}
              </small>
              {parentComparison.isMerge ? <div className="git-merge-parent-selection">
                <label>{props.zh ? '比较基线' : 'Compare against'}<select aria-label={props.zh ? '合并提交父级' : 'Merge comparison parent'} value={parentComparison.parent} onChange={event => parentComparison.select(event.target.value)}>
                  {detail.parentHashes.map((parent, index) => <option key={`${parent}-${index}`} value={parent}>{props.zh ? `父提交 ${index + 1}` : `Parent ${index + 1}`} · {parent.slice(0, 8)}</option>)}
                </select></label>
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
            <section className="project-git-changed-files">
              <header>
                <strong>{props.zh ? `变更文件 (${detail.files.length})` : `Changed files (${detail.files.length})`}</strong>
              </header>
              <CommitFileDirectoryTree
                zh={props.zh}
                files={detail.files}
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
            <GitPaneSeparator name="inspector" label={props.zh ? '调整详情与差异宽度' : 'Resize details and diff'} initial={35} min={20} max={65} />
            <GitPaneSeparator name="details" label={props.zh ? '调整文件与提交详情高度' : 'Resize files and commit details'} axis="y" initial={55} min={20} max={80} />
            <SideBySideDiff
              previewRequest={
                props.selectedRepository && selectedFilePath
                  ? { kind: 'project-git', projectId: props.projectId, repositoryId: props.selectedRepository.id, path: selectedFilePath, ...(parentRevisions ? { revisions: parentRevisions } : { commitHash: props.selectedCommitHash }) }
                  : undefined
              }
              emptyMessage={parentComparison.loading ? (props.zh ? '正在读取所选父提交差异…' : 'Loading the selected parent comparison…') : parentComparison.error ? (props.zh ? '所选父提交未能完成比较，请查看详情或重试。' : 'The selected parent comparison failed. Review the details or retry.') : parentComparison.isMerge && detail.files.length === 0 ? (props.zh ? '该合并结果与所选父提交的文件快照相同。' : 'The merge result and selected parent have identical file trees.') : undefined}
              diff={selectedDiff || detail.diff.unavailableReason ? { ...detail.diff, files: selectedFilePath ? [selectedFilePath] : detail.diff.files, fileDiffs: selectedDiff ? [selectedDiff] : [] } : null}
              zh={props.zh}
            />
          </>
        ) : (
          <p className="project-git-empty-copy">{props.zh ? '选择一个提交查看文件与差异。' : 'Select a commit to inspect files and diff.'}</p>
        )}
      </aside>
      <MotionPresence>{branchMenu ? <BranchContextMenu {...branchMenu} zh={props.zh} busy={props.busy} onClose={() => setBranchMenu(null)} onExecute={props.onExecute} onManageBranch={props.onManageBranch} onOpenDiff={props.onOpenDiff} /> : null}</MotionPresence>
    </div>
  );
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
  return <>
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
    <section className="project-git-changed-files">
      <header><strong>{text(`变更文件 (${comparison?.files.length ?? '…'})`, `Changed files (${comparison?.files.length ?? '…'})`)}</strong></header>
      {comparison ? <CommitFileDirectoryTree zh={props.zh} files={comparison.files} selectedPath={path} onSelect={setSelectedPath}
        onOpen={path => props.onOpenDiff(props.repository, path, { revisions: comparison.revisions })}
        onExport={path => props.onExport(props.repository, comparison.revisions, path)}
        onExternal={path => props.onExternal({ repository: props.repository, input: { mode: 'diff', paths: [path], revisions: comparison.revisions } })}
        onHistory={(path, view) => props.onHistory(props.repository, path, comparison.revisions[1], view)} /> : null}
    </section>
    <GitPaneSeparator name="inspector" label={text('调整详情与差异宽度', 'Resize details and diff')} initial={35} min={20} max={65} />
    <GitPaneSeparator name="details" label={text('调整文件与提交详情高度', 'Resize files and commit details')} axis="y" initial={55} min={20} max={80} />
    <SideBySideDiff diff={comparison ? { ...comparison.diff, files: path ? [path] : comparison.diff.files, fileDiffs: selected } : null} zh={props.zh} title={path} fill emptyMessage={loading ? text('正在比较所选提交…', 'Comparing selected commits…') : current?.error ? text('所选提交未能完整比较，请查看详情或重新载入。', 'The commits could not be compared completely. Review the details or reload.') : comparison && !comparison.files.length ? text('两个提交的文件快照相同。', 'The two commits have identical file trees.') : undefined} />
  </>;
}

interface CommitFileTreeNode {
  name: string;
  path: string;
  children: Map<string, CommitFileTreeNode>;
  stats?: { additions: number; deletions: number };
}

function CommitFileDirectoryTree(props: { zh: boolean; files: Array<{ path: string; additions: number; deletions: number }>; selectedPath: string; onSelect: (path: string) => void; onOpen: (path: string) => void; onHistory?: (path: string, view: 'history' | 'blame') => void; onExport?: (path: string) => void; onExternal?: (path: string) => void }) {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; open: (path: string, view: 'history' | 'blame') => void; export?: () => void; external?: () => void } | null>(null);
  const tree = useMemo(() => buildCommitFileTree(props.files), [props.files.map((file) => `${file.path}:${file.additions}:${file.deletions}`).join('\0')]);
  return (
    <div className="project-git-commit-file-tree">
      {menu ? <GitContextMenu {...menu} title={menu.path} onClose={() => setMenu(null)} onError={reason => reportApplicationError(reason, { language: props.zh ? 'zh-CN' : 'en' })} items={[...(menu.external ? [{ label: props.zh ? '使用外部工具比较…' : 'Compare with external tool…', run: menu.external }] : []), { label: props.zh ? '文件历史…' : 'File history…', run: () => menu.open(menu.path, 'history') }, { label: props.zh ? '代码归属…' : 'Blame…', run: () => menu.open(menu.path, 'blame') }, ...(menu.export ? [{ label: props.zh ? '导出此文件补丁…' : 'Export file as patch…', run: menu.export }] : [])]} /> : null}
      {Array.from(tree.children.values()).map((node) => (
        <CommitFileTreeEntry key={node.path} node={node} depth={0} {...props} onMenu={(path, event) => { event.preventDefault(); event.stopPropagation(); if (!props.onHistory) return; const box = event.currentTarget.getBoundingClientRect(); setMenu({ path, open: props.onHistory, external: props.onExternal ? () => props.onExternal!(path) : undefined, export: props.onExport ? () => props.onExport!(path) : undefined, x: 'clientX' in event ? event.clientX : box.left, y: 'clientY' in event ? event.clientY : box.bottom }); }} />
      ))}
    </div>
  );
}

function CommitFileTreeEntry(props: Parameters<typeof CommitFileDirectoryTree>[0] & { node: CommitFileTreeNode; depth: number; onMenu: (path: string, event: ReactMouseEvent | ReactKeyboardEvent) => void }) {
  if (!props.node.stats) {
    return (
      <details className="project-git-commit-file-folder" open>
        <summary style={{ paddingLeft: `${props.depth * 12 + 5}px` }}>
          <CaretRight aria-hidden="true" />
          <Folder aria-hidden="true" />
          <span>{props.node.name}</span>
        </summary>
        {Array.from(props.node.children.values()).map((child) => (
          <CommitFileTreeEntry key={child.path} {...props} node={child} depth={props.depth + 1} />
        ))}
      </details>
    );
  }
  return (
    <div className="git-commit-file-row" onContextMenu={props.onHistory ? event => props.onMenu(props.node.path, event) : undefined}>
    <button
      type="button"
      onKeyDown={event => { if (props.onHistory && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) props.onMenu(props.node.path, event); }}
      className={props.node.path === props.selectedPath ? 'is-current' : ''}
      style={{ paddingLeft: `${props.depth * 12 + 7}px` }}
      onClick={() => props.onSelect(props.node.path)}
      onDoubleClick={() => props.onOpen(props.node.path)}
    >
      <File aria-hidden="true" />
      <span title={props.node.path}>{props.node.name}</span>
      <em>+{props.node.stats.additions}</em>
      <i>-{props.node.stats.deletions}</i>
    </button>
    {props.onHistory ? <button type="button" className="git-commit-file-menu" aria-label={`${props.zh ? '文件操作' : 'File actions'} · ${props.node.path}`} aria-haspopup="menu" onClick={event => props.onMenu(props.node.path, event)}><DotsThree aria-hidden="true" /></button> : null}
    </div>
  );
}

function buildCommitFileTree(files: Array<{ path: string; additions: number; deletions: number }>): CommitFileTreeNode {
  const root: CommitFileTreeNode = { name: '', path: '', children: new Map() };
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    let current = root;
    const parts = file.path.split('/').filter(Boolean);
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const next = current.children.get(part) ?? { name: part, path, children: new Map<string, CommitFileTreeNode>() };
      if (index === parts.length - 1) next.stats = { additions: file.additions, deletions: file.deletions };
      current.children.set(part, next);
      current = next;
    });
  }
  return root;
}

function CommitGraph(props: { commits: ProjectGitRepositoryWorkbenchItem['snapshot']['recentCommits'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = 112;
    const rowHeight = gitHistoryRowHeight;
    const height = Math.max(1, props.commits.length * rowHeight);
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
    props.commits.forEach((commit, row) => {
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
        if (destination < 0 || row === props.commits.length - 1) return;
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
  }, [props.commits]);
  return <canvas ref={canvasRef} className="project-git-graph-canvas" aria-hidden="true" />;
}

// 子模块按仓库相对路径组织，目录节点只负责展开，不改变仓库选择。
function RepositoryNavigationTree(props: { repositories: ProjectGitRepositoryWorkbenchItem[]; zh: boolean; selectedId?: string; onSelect: (id: string) => void }) {
  type Node = { name: string; path: string; children: Map<string, Node>; repository?: ProjectGitRepositoryWorkbenchItem };
  const root: Node = { name: '', path: '', children: new Map() };
  for (const repository of props.repositories) {
    const parts = repository.relativePath === '.' ? [repository.name] : repository.relativePath.split('/').filter(Boolean);
    let node = root;
    for (const name of parts) {
      if (!node.children.has(name)) node.children.set(name, { name, path: `${node.path}/${name}`, children: new Map() });
      node = node.children.get(name)!;
    }
    node.repository = repository;
  }
  const render = (node: Node): React.ReactNode => {
    const repository = node.repository;
    const snapshot = repository?.snapshot;
    const relation = !snapshot
      ? ''
      : snapshot.detached
        ? props.zh
          ? '分离 HEAD'
          : 'Detached HEAD'
        : !snapshot.upstream
          ? props.zh
            ? '未跟踪'
            : 'No upstream'
          : snapshot.ahead || snapshot.behind
            ? [snapshot.ahead ? `↑${snapshot.ahead}` : '', snapshot.behind ? `↓${snapshot.behind}` : ''].filter(Boolean).join(' ')
            : props.zh
              ? '已同步'
              : 'Synced';
    const row =
      repository && snapshot ? (
        <button
          data-git-context={JSON.stringify({ kind: 'repository', repositoryId: repository.id, ref: repository.name })}
          type="button"
          className="project-git-navigation-repository"
          aria-current={props.selectedId === repository.id ? 'true' : undefined}
          onClick={() => props.onSelect(repository.id)}
          title={`${repository.name} · ${repository.relativePath}\n${snapshot.branch} → ${snapshot.upstream ?? (props.zh ? '未设置远程跟踪分支' : 'No upstream')}\n${relation}`}
        >
          <span className="project-git-navigation-repository-color" style={{ backgroundColor: repositoryColor(repository.id) }} aria-hidden="true" />
          <span className="project-git-navigation-repository-label">
            <strong>{node.name}</strong>
            <small title={snapshot.detached ? snapshot.headSha : snapshot.branch}>{snapshot.detached ? snapshot.headSha.slice(0, 7) : snapshot.branch}</small>
          </span>
          <span className="git-tracking-badge" aria-label={relation}>
            {relation}
          </span>
        </button>
      ) : null;
    if (!node.children.size) return <div key={node.path}>{row}</div>;
    return (
      <details key={node.path} className="git-repository-directory" open>
        <summary>
          <CaretRight aria-hidden="true" />
          <Folder aria-hidden="true" />
          <span>{node.name}</span>
        </summary>
        <div className="git-repository-directory-children">
          {row}
          {[...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(render)}
        </div>
      </details>
    );
  };
  return <>{[...root.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(render)}</>;
}

function LocalChangesSurface(props: {
  client: Pick<DashboardClient, 'loadProjectGitLineDiff' | 'readProjectGitConflict' | 'saveProjectGitConflict' | 'loadProjectGitCommitTemplate'>;
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
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: { stage?: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] }) => void;
  activeFileMenu: GitContextTarget | null;
  onFileMenu: (event: GitContextEvent, target: GitContextTarget, position: { x: number; y: number }) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
  externalRevision?: number;
  onExternalTool: (request: GitExternalToolRequest) => void;
  onConflictSaved: (repositoryId: string, path: string, result: { resolved: boolean; snapshot?: ProjectGitRepositorySnapshot }) => Promise<void>;
  onConfirmAction: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, title: string, description: string, danger: boolean) => void;
  onCommit: () => void;
  commitDrafts: Record<string, string>;
  commitModels: Array<{ id: string; label: string }>;
  commitModelRef: string;
  commitModelsLoading: boolean;
  commitModelsError: string;
  onSelectCommitModel: (modelRef: string) => void;
  onRefreshCommitModels: () => void;
  generatingCommitFor: string | null;
  generationFeedback?: string;
  onGenerateCommitMessage: (repository: ProjectGitRepositoryWorkbenchItem) => Promise<void>;
  onStopCommitGeneration: () => void;
  onCommitMessageChange: (repositoryId: string, message: string) => void;
  onCommitTemplateApply: (repositoryId: string, message: string, expected: string) => void;
}) {
  const committingRef = useRef(false);
  const [fileView, setFileView] = useState<'tree' | 'flat'>(() => {
    try {
      return localStorage.getItem('astragit.git.file-view.v1') === 'flat' ? 'flat' : 'tree';
    } catch {
      return 'tree';
    }
  });
  const [editingRepository, setEditingRepository] = useState<string | null>(null);
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
  const conflicts = new Set(repository?.snapshot.conflictFiles ?? []);
  const selectedConflict = Boolean(repository && conflicts.has(props.selectedFilePath));
  const message = repository ? (props.commitDrafts[repository.id] ?? '') : '';
  const stagedCount = repository?.snapshot.fileStatuses.filter((file) => !conflicts.has(file.path) && file.indexStatus !== ' ' && file.indexStatus !== '?').length ?? 0;
  const generating = props.generatingCommitFor === repository?.id;
  const canCommit = Boolean(repository && !conflicts.size && stagedCount > 0 && message.trim() && !props.busy && !generating);
  async function commitCurrentRepository(): Promise<void> {
    if (!repository || !canCommit || committingRef.current) return;
    committingRef.current = true;
    try {
      const outcome = await props.onExecute(repository, { type: 'commit', message: message.trim() }, props.zh ? '提交已暂存变更' : 'Commit staged changes');
      if (outcome === 'completed') {
        props.onCommitMessageChange(repository.id, '');
        setEditingRepository(null);
      }
    } finally {
      committingRef.current = false;
    }
  }
  const subtree = props.subtree;
  const matchesSubtree = (path: string) => !subtree || subtree.repositoryId !== props.selectedRepository?.id || path === subtree.path || path.startsWith(`${subtree.path}/`);
  const visibleFileStatuses = repository?.snapshot.fileStatuses.filter((file) => !conflicts.has(file.path) && matchesSubtree(file.path) && file.path.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase())) ?? [];
  const visibleChangeCount = visibleFileStatuses.length;
  const emptyVisibleChanges = Boolean(repository && visibleChangeCount === 0 && repository.snapshot.conflictFiles.length === 0);
  const workspaceClean = Boolean(emptyVisibleChanges && repository?.snapshot.fileStatuses.length === 0);
  const visibleStageFiles = {
    staged: visibleFileStatuses.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?').map((file) => file.path),
    unstaged: visibleFileStatuses.filter((file) => file.workingTreeStatus !== ' ' || file.indexStatus === '?').map((file) => file.path),
  };
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
      <aside className="project-git-change-tree" data-empty={emptyVisibleChanges || undefined}>
        {repository && repository.snapshot.conflictFiles.length > 0 ? (
          <section className="project-git-conflict-files" aria-label={props.zh ? '冲突文件' : 'Conflicted files'}>
            <header>
              <WarningCircle aria-hidden="true" />
              <strong>{props.zh ? `冲突文件 (${repository.snapshot.conflictFiles.length})` : `Conflicts (${repository.snapshot.conflictFiles.length})`}</strong>
            </header>
            {repository.snapshot.conflictFiles.map((path) => (
              <button key={path} type="button" className={path === props.selectedFilePath ? 'is-current' : ''} onClick={() => props.onSelectFile(path, 'unstaged')} title={path}>
                <span>{path}</span>
              </button>
            ))}
          </section>
        ) : null}
        <header>
          <strong>{props.zh ? '变更文件' : 'Changed files'}</strong>
          <span className="project-git-file-view-control" title={fileView === 'flat' ? (props.zh ? '平铺结构' : 'Flat view') : props.zh ? '树状结构' : 'Tree view'}>
            {fileView === 'flat' ? <ListBullets aria-hidden="true" /> : <TreeStructure aria-hidden="true" />}
            <CaretDown aria-hidden="true" />
            <select
              className="project-git-file-view-select"
              aria-label={props.zh ? `文件显示方式：${fileView === 'flat' ? '平铺结构' : '树状结构'}` : `File view: ${fileView === 'flat' ? 'Flat view' : 'Tree view'}`}
              value={fileView}
              disabled={!repository || visibleChangeCount === 0}
              onChange={(event) => {
                const next = event.currentTarget.value === 'flat' ? 'flat' : 'tree';
                setFileView(next);
                try {
                  localStorage.setItem('astragit.git.file-view.v1', next);
                } catch {
                  /* 存储不可用时保留当前会话选择。 */
                }
              }}
            >
              <option value="tree">{props.zh ? '树状结构' : 'Tree view'}</option>
              <option value="flat">{props.zh ? '平铺结构' : 'Flat view'}</option>
            </select>
          </span>
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
                          selectedRepositoryId={repository.id}
                          selectedFilePath={props.selectedFilePath}
                          selectedFileStage={props.selectedFileStage}
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
      <GitPaneSeparator name="files" label={props.zh ? '调整文件列表宽度' : 'Resize file list'} initial={30} min={15} max={65} />
      <main className="project-git-change-diff">
        {repository && selectedConflict ? (
          <GitConflictEditor client={props.client} projectId={props.projectId} repositoryId={repository.id} filePath={props.selectedFilePath} zh={props.zh} disabled={props.busy !== null} externalRevision={props.externalRevision}
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
                  {repository ? <GitCommitTemplateControl key={`${props.projectId}:${repository.id}`} client={props.client} projectId={props.projectId} repositoryId={repository.id} repositoryName={repository.name} value={message} zh={props.zh} disabled={props.busy !== null || generating} onApply={(next, expected) => props.onCommitTemplateApply(repository.id, next, expected)} /> : null}
                  <small className="project-git-commit-generation-feedback" role="status" title={props.commitModelsError || undefined}>
                    {!props.commitModelsLoading && !props.commitModels.length
                      ? props.zh
                        ? '暂无可用模型，请在设置中配置模型连接后刷新。'
                        : 'No models available. Configure a model connection in Settings, then refresh.'
                      : props.generationFeedback || props.commitModelsError}
                  </small>
                  <select
                    aria-label={props.zh ? '生成提交说明的模型' : 'Commit message model'}
                    value={props.commitModelRef}
                    disabled={props.commitModelsLoading || props.generatingCommitFor !== null || props.commitModels.length === 0}
                    onChange={(event) => props.onSelectCommitModel(event.currentTarget.value)}
                  >
                    {!props.commitModelRef ? <option value="">{props.commitModelsLoading ? (props.zh ? '正在加载模型…' : 'Loading models…') : props.zh ? '没有可用模型' : 'No available models'}</option> : null}
                    {props.commitModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    disabled={props.commitModelsLoading || props.generatingCommitFor !== null}
                    onClick={props.onRefreshCommitModels}
                    title={props.zh ? '刷新模型列表' : 'Refresh models'}
                    aria-label={props.zh ? '刷新模型列表' : 'Refresh models'}
                  >
                    <ArrowsClockwise aria-hidden="true" />
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!generating && (!repository || stagedCount === 0 || props.busy !== null || props.generatingCommitFor !== null || props.commitModelsLoading || !props.commitModelRef)}
                    onClick={() => {
                      if (generating) props.onStopCommitGeneration();
                      else if (repository) void props.onGenerateCommitMessage(repository);
                    }}
                  >
                    {generating ? (props.zh ? '停止生成' : 'Stop generating') : props.zh ? 'AI 生成' : 'Generate with AI'}
                  </Button>
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
                  if (repository) props.onCommitMessageChange(repository.id, event.currentTarget.value);
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
              <Button variant="secondary" disabled={props.busy !== null || generating} onClick={() => setEditingRepository(null)}>
                {props.zh ? '取消' : 'Cancel'}
              </Button>
              <Button variant="primary" onClick={() => void commitCurrentRepository()} disabled={!canCommit} busy={props.busy?.action === 'commit'}>
                {props.zh ? '提交已暂存变更' : 'Commit staged changes'}
              </Button>
              {props.repositories.length > 1 ? (
                <Button variant="secondary" onClick={props.onCommit} disabled={props.busy !== null}>
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

function ChangeDirectoryTree(props: {
  view?: 'tree' | 'flat';
  files: string[];
  stage: ChangeStage;
  repository: ProjectGitRepositoryWorkbenchItem;
  selectedRepositoryId?: string;
  selectedFilePath: string;
  selectedFileStage: ChangeStage;
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
    return [...(root.current?.querySelectorAll<HTMLElement>('[data-git-file-path]') ?? [])].filter((element) => !element.closest('details:not([open])') && element.checkVisibility()).map((element) => element.dataset.gitFilePath!);
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
  const current = props.repository.id === props.selectedRepositoryId && props.node.path === props.selectedFilePath && props.stage === props.selectedFileStage;
  const selected = props.selectedPaths.includes(props.node.path);
  const checked = props.stage === 'staged';
  const status = props.repository.snapshot.fileStatuses.find((file) => file.path === props.node.path);
  const category = gitFileStatusCategory(status, props.stage);
  const submodule = props.repository.snapshot.submodules?.some((item) => item.path === props.node.path) ?? false;
  const menuOpen = Boolean(props.activeFileMenu?.kind === 'file' && props.activeFileMenu.repositoryId === props.repository.id && props.activeFileMenu.ref === props.node.path && props.activeFileMenu.stage === props.stage);
  const menuLabel = props.zh ? `${props.node.path} · ${checked ? '已暂存' : '未暂存'}文件操作` : `${props.node.path} · ${checked ? 'Staged' : 'Unstaged'} file actions`;
  return (
    <div data-git-file-path={props.node.path} data-git-context={JSON.stringify({ kind: 'file', repositoryId: props.repository.id, ref: props.node.path, stage: props.stage })} className={`project-git-change-file-row${selected ? ' is-selected' : ''}${current && selected ? ' is-current' : ''}`}
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
      }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={props.busy !== null}
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
        onDoubleClick={(event) => { if (!event.shiftKey && !event.ctrlKey && !event.metaKey) props.onOpenDiff(props.repository, props.node.path, { stage: props.stage }); }}
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
    </div>
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

function StashSurface(props: {
  /** 仓库预览所属项目。 */
  projectId: string;
  zh: boolean;
  repository: ProjectGitRepositoryWorkbenchItem | null;
  stash: ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number] | null;
  detail: ProjectGitCommitDetail | null;
  loading: boolean;
  selectedFilePath: string;
  busy: BusyState;
  onSelectFile: (path: string) => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: { stage?: 'combined' | ChangeStage; commitHash?: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string] }) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const selectedDiff = props.detail?.diff.fileDiffs.find((file) => file.newPath === props.selectedFilePath || file.oldPath === props.selectedFilePath) ?? null;
  if (!props.repository || !props.stash) {
    return (
      <div className="project-git-empty-surface">
        <Archive aria-hidden="true" />
        <strong>{props.zh ? '没有可查看的贮藏' : 'No stash to inspect'}</strong>
        <span>{props.zh ? '左侧“贮藏区”会显示当前仓库中的贮藏。' : 'Stashes in the current repository appear in the sidebar.'}</span>
      </div>
    );
  }
  const repository = props.repository;
  const stash = props.stash;
  return (
    <section className="project-git-stash-surface" aria-label={props.zh ? '贮藏详情' : 'Stash details'}>
      <header className="project-git-stash-toolbar">
        <span className="project-git-stash-identity">
          <Archive aria-hidden="true" />
          <span>
            <strong>{displayStashSubject(stash.subject, props.zh)}</strong>
            <small>
              {stash.ref} · {stash.author} · {formatRelativeTime(stash.authoredAt, props.zh)}
            </small>
          </span>
        </span>
        <span className="project-git-stash-actions">
          <Button variant="secondary" size="compact" disabled={props.busy !== null} onClick={() => void props.onExecute(repository, { type: 'apply_stash', stashRef: stash.ref }, props.zh ? '应用 Stash' : 'Apply stash')}>
            {props.zh ? '应用' : 'Apply'}
          </Button>
          <Button variant="secondary" size="compact" disabled={props.busy !== null} onClick={() => void props.onExecute(repository, { type: 'apply_stash', stashRef: stash.ref, pop: true }, props.zh ? '弹出 Stash' : 'Pop stash')}>
            {props.zh ? '弹出' : 'Pop'}
          </Button>
          <Button variant="danger" size="compact" disabled={props.busy !== null} onClick={() => void props.onExecute(repository, { type: 'drop_stash', stashRef: stash.ref }, props.zh ? '删除 Stash' : 'Drop stash')}>
            {props.zh ? '删除' : 'Delete'}
          </Button>
        </span>
      </header>
      {props.loading ? (
        <div className="project-git-inspector-loading">
          <CircleNotch aria-hidden="true" />
          {props.zh ? '正在读取贮藏差异' : 'Loading stash diff'}
        </div>
      ) : props.detail ? (
        <div className="project-git-stash-diff-layout">
          <aside className="project-git-changed-files project-git-stash-files" aria-label={props.zh ? '贮藏中的变更文件' : 'Files changed in stash'}>
            <header>
              <strong>{props.zh ? `变更文件 (${props.detail.files.length})` : `Changed files (${props.detail.files.length})`}</strong>
            </header>
            <CommitFileDirectoryTree zh={props.zh} files={props.detail.files} selectedPath={props.selectedFilePath} onSelect={props.onSelectFile} onOpen={(path) => props.onOpenDiff(repository, path, { commitHash: stash.ref })} />
          </aside>
          <GitPaneSeparator name="stash-files" label={props.zh ? '调整贮藏文件列表宽度' : 'Resize stash file list'} initial={28} min={16} max={55} />
          <SideBySideDiff
            previewRequest={props.selectedFilePath ? { kind: 'project-git', projectId: props.projectId, repositoryId: props.repository.id, path: props.selectedFilePath, commitHash: props.stash.ref } : undefined}
            diff={selectedDiff || props.detail.diff.unavailableReason ? { ...props.detail.diff, files: props.selectedFilePath ? [props.selectedFilePath] : props.detail.diff.files, fileDiffs: selectedDiff ? [selectedDiff] : [] } : null}
            zh={props.zh}
            title={props.selectedFilePath}
          />
        </div>
      ) : (
        <p className="project-git-empty-copy">{props.zh ? '无法读取该贮藏的文件差异。' : 'The files and diff for this stash could not be loaded.'}</p>
      )}
    </section>
  );
}

/** 控制台复用既有记录布局，滚动和键盘入口共用历史加载门禁。 */
function ConsoleSurface(props: { zh: boolean; history: ReturnType<typeof useGitOperationHistory> }) {
  /** 当前控制台是独立滚动区域。 */
  const root = useRef<HTMLDivElement>(null);
  /** 底部标记只负责触发读取，不执行任何 Git 动作。 */
  const sentinel = useRef<HTMLElement>(null);
  /** 以可见记录作为锚点，刷新插入新记录时保留阅读位置。 */
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  /** 只记录首个可见记录；位于顶部时保持最新记录可见。 */
  function rememberPosition(): void {
    /** 容器卸载时无需继续计算滚动位置。 */
    const container = root.current;
    if (!container || container.scrollTop === 0) {
      anchor.current = null;
      return;
    }
    /** 相对容器的偏移不会受整个窗口移动影响。 */
    const top = container.getBoundingClientRect().top;
    /** 操作卡片都是滚动区直接子项，跳过底部加载状态。 */
    const visible = [...container.children].find((element) => element instanceof HTMLElement && element.dataset.operationId && element.getBoundingClientRect().bottom > top) as HTMLElement | undefined;
    anchor.current = visible ? { id: visible.dataset.operationId!, offset: visible.getBoundingClientRect().top - top } : null;
  }

  useLayoutEffect(() => {
    /** DOM 更新后按原记录偏移补偿新增内容的高度。 */
    const container = root.current;
    if (container && anchor.current) {
      /** 使用已知元素身份查找，不把输出文本拼成选择器。 */
      const element = [...container.children].find((child) => child instanceof HTMLElement && child.dataset.operationId === anchor.current!.id);
      if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.current.offset;
    }
    rememberPosition();
  }, [props.history.items]);

  useEffect(() => {
    if (!root.current || !sentinel.current || props.history.loading || props.history.error || !props.history.nextCursor || typeof IntersectionObserver === 'undefined') return;
    /** 使用浏览器原生可见性观察，靠近底部 240 像素时加载下一页。 */
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void props.history.loadMore();
      },
      { root: root.current, rootMargin: '240px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [props.history.loading, props.history.error, props.history.nextCursor, props.history.loadMore, props.history.items.length]);

  return (
    <div ref={root} className="project-git-console-surface" role="region" aria-label={props.zh ? 'Git 操作历史' : 'Git operation history'} tabIndex={0} onScroll={rememberPosition} aria-busy={props.history.loading}>
      {props.history.total === 0 && !props.history.loading && !props.history.error ? (
        <section className="project-git-empty-surface">
          <ArrowsClockwise aria-hidden="true" />
          <strong>{props.zh ? '这个项目还没有仓库操作记录' : 'No repository operations for this project yet'}</strong>
          <span>{props.zh ? '通过仓库管理执行的操作会保存在这里。' : 'Operations performed through Repository management are saved here.'}</span>
        </section>
      ) : null}
      {props.history.items.map((operation) => (
        <article key={operation.id} data-operation-id={operation.id} data-tone={operation.status === 'completed' ? 'success' : operation.status === 'failed_before_write' ? 'error' : 'warning'}>
          {operation.status === 'completed' ? <CheckCircle aria-hidden="true" /> : operation.status === 'running' ? <CircleNotch aria-hidden="true" /> : <WarningCircle aria-hidden="true" />}
          <span>
            <strong>
              {operation.action && Object.hasOwn(operationActionLabels, operation.action)
                ? operationActionLabels[operation.action as ProjectGitAction['type']][props.zh ? 0 : 1]
                : (operation.action ?? (props.zh ? 'Git 操作' : 'Git operation'))}
            </strong>
            <small>
              {operation.repositoryName} · <time dateTime={operation.startedAt}>{new Date(operation.startedAt).toLocaleString(props.zh ? 'zh-CN' : 'en-US')}</time>
              {operation.durationMs !== null ? ` · ${operation.durationMs} ms` : ''}
            </small>
            <span>{operationStatusLabels[operation.status][props.zh ? 0 : 1]}</span>
            {operation.commands?.length ? <pre aria-label={props.zh ? '执行的 Git 命令' : 'Git commands invoked'}>{operation.commands.map((command) => `$ ${command}`).join('\n')}</pre> : null}
            {operation.status === 'unknown_after_write' ? (
              <small>{props.zh ? '请刷新并核对仓库状态；推送还需要核对远端。不会自动重试此操作。' : 'Refresh and check the repository; also check the remote for a push. This operation will not be retried automatically.'}</small>
            ) : null}
            {operation.output ? <pre>{operation.output}</pre> : null}
            {operation.limitations.map((limitation) => (
              <small key={limitation}>{operationLimitationLabels[limitation][props.zh ? 0 : 1]}</small>
            ))}
          </span>
        </article>
      ))}
      <footer ref={sentinel} className="project-git-console-pagination">
        {props.history.error ? (
          <>
            <span role="alert">
              {props.zh ? '操作历史读取失败：' : 'Could not read operation history: '}
              {props.history.error}
            </span>
            <Button variant="secondary" size="compact" onClick={() => void props.history.retry()}>
              {props.zh ? '重试读取' : 'Retry loading'}
            </Button>
          </>
        ) : props.history.loading || props.history.total === null ? (
          <span role="status">{props.zh ? '正在加载操作记录…' : 'Loading operation records…'}</span>
        ) : props.history.nextCursor ? (
          <Button variant="secondary" size="compact" onClick={() => void props.history.loadMore()}>
            {props.zh ? '加载更多' : 'Load more'}
          </Button>
        ) : props.history.items.length > 0 ? (
          <span role="status">{props.zh ? '已加载全部' : 'All records loaded'}</span>
        ) : null}
      </footer>
    </div>
  );
}

/** 动作名称只按已保存的类型翻译，不从 Git 输出猜测操作。 */
const operationActionLabels: Record<ProjectGitAction['type'], [string, string]> = {
  interactive_rebase: ['交互变基', 'Interactive rebase'],
  amend_rebase_step: ['修订当前变基步骤', 'Amend current rebase step'],
  stop_tracking: ['停止跟踪', 'Stop tracking'],
  stage_ignored: ['强制暂存已忽略项', 'Force stage ignored items'],
  ignore: ['追加忽略规则', 'Append ignore rules'],
  discard: ['放弃修改', 'Discard changes'],
  rename_branch: ['重命名分支', 'Rename branch'],
  create_tag: ['创建标签', 'Create tag'],
  push_tag: ['推送标签', 'Push tag'],
  delete_tag: ['删除标签', 'Delete tag'],
  delete_remote_tag: ['删除远程标签', 'Delete remote tag'],
  subtree: ['子树操作', 'Subtree operation'],
  submodule_update: ['更新子模块', 'Update submodule'],
  manage_submodule: ['管理子模块', 'Manage submodule'],
  manage_lfs: ['Git LFS', 'Git LFS'],
  manage_flow: ['Git Flow', 'Git Flow'],
  external_tool: ['外部工具', 'External tool'],
  configure_external_tool: ['外部工具设置', 'External tool settings'],
  fetch: ['获取', 'Fetch'],
  stage: ['暂存', 'Stage'],
  unstage: ['取消暂存', 'Unstage'],
  import_patch: ['导入补丁', 'Import patch'],
  import_mailbox: ['导入提交序列', 'Import commit series'],
  apply_patch: ['应用补丁', 'Apply patch'],
  apply_line_changes: ['应用所选更改', 'Apply selected changes'],
  commit: ['提交', 'Commit'],
  amend_commit: ['修订上次提交', 'Amend last commit'],
  set_identity_field: ['设置提交身份', 'Set commit identity'],
  configure_remote: ['设置远程仓库', 'Configure remote'],
  configure_commit_template: ['设置提交模板', 'Configure commit template'],
  push: ['推送', 'Push'],
  pull: ['拉取', 'Pull'],
  update: ['更新', 'Update'],
  checkout: ['切换分支', 'Switch branch'],
  checkout_revision: ['检出提交', 'Checkout revision'],
  reset_revision: ['重置当前分支', 'Reset current branch'],
  create_branch: ['创建分支', 'Create branch'],
  delete_branch: ['删除分支', 'Delete branch'],
  delete_remote_branch: ['删除远程分支', 'Delete remote branch'],
  set_upstream: ['设置上游分支', 'Set upstream branch'],
  revert: ['撤销提交', 'Revert commit'],
  cherry_pick: ['拣选提交', 'Cherry-pick commit'],
  cherry_pick_series: ['批量拣选提交', 'Cherry-pick selected commits'],
  merge: ['合并', 'Merge'],
  rebase: ['变基', 'Rebase'],
  stash: ['创建 Stash', 'Create stash'],
  apply_stash: ['应用 Stash', 'Apply stash'],
  drop_stash: ['删除 Stash', 'Drop stash'],
  continue_integration: ['继续提交整合', 'Continue integration'],
  skip_integration: ['跳过当前提交', 'Skip current commit'],
  abort_integration: ['终止提交整合', 'Abort integration'],
};

/** 文本明确表达账本事实，颜色与图标不承担唯一的状态提示。 */
const operationStatusLabels: Record<ProjectGitOperationRecord['status'], [string, string]> = {
  running: ['正在执行', 'Running'],
  completed: ['已完成', 'Completed'],
  conflict: ['存在冲突，需要处理', 'Conflicts need attention'],
  failed_before_write: ['执行前失败，未开始写入', 'Failed before writing'],
  unknown_after_write: ['结果未知，需要核对', 'Outcome unknown; verification needed'],
  recorded: ['已保存执行结果，详细状态未保存', 'Result recorded; detailed status unavailable'],
};

/** 缺失信息与展示上限均直接说明，避免将空白误认为完整历史。 */
const operationLimitationLabels: Record<ProjectGitOperationRecord['limitations'][number], [string, string]> = {
  action_unavailable: ['记录未保存动作名称。', 'The action name was not saved.'],
  output_not_saved: ['记录未保存输出内容。', 'Output was not saved.'],
  output_truncated: ['输出过长，此处仅展示前 64 Ki 字符。', 'Output is long; only the first 64 Ki characters are shown.'],
  commands_not_saved: ['记录未保存具体 Git 命令。', 'The Git commands were not saved.'],
  commands_truncated: ['命令记录过长，仅保存前 64 Ki 字符。', 'Command history exceeded 64 Ki characters and was truncated.'],
};

function OperationsMenu(props: {
  anchor: HTMLButtonElement | null;
  zh: boolean;
  onClose: () => void;
  onOpenCommit: () => void;
  onOpenDeleteBranches?: () => void;
  onOpenAmend?: () => void;
  onOpenInteractiveRebase?: () => void;
  onOpenFileHistory?: () => void;
  onImportPatch?: () => void;
  onOpenExternalTools?: () => void;
  onOpenLfs?: () => void;
  onOpenFlow?: () => void;
  onOpenSubmodules?: () => void;
  onOpenTags?: () => void;
  onExportPatch?: () => void;
  onExportArchive?: () => void;
  onOpenSettings?: () => void;
  onOpenPush: () => void;
  onOpenUpdate: () => void;
  onOpenNewBranch: () => void;
  onOpenRevision: () => void;
  onSelectTab: (tab: GitTab) => void;
  onOpenConsole?: () => void;
  onOpenSubtree: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const bounds = props.anchor?.getBoundingClientRect();

  const action = (callback: () => void) => () => {
    props.onClose();
    callback();
  };
  return createPortal(
    <MenuSurface onClose={props.onClose} ref={menuRef} className="macos-ai-app project-git-operations-menu" role="menu" style={{ left: Math.max(8, (bounds?.right ?? 228) - 220), top: (bounds?.bottom ?? 0) + 5 }}>
      <button type="button" role="menuitem" onClick={action(props.onOpenCommit)}>
        {props.zh ? '提交…' : 'Commit…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenExternalTools} onClick={props.onOpenExternalTools ? action(props.onOpenExternalTools) : undefined}>{props.zh ? '外部工具设置…' : 'External tool settings…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenFlow} onClick={props.onOpenFlow ? action(props.onOpenFlow) : undefined}>Git Flow…</button>
      <button type="button" role="menuitem" disabled={!props.onOpenLfs} onClick={props.onOpenLfs ? action(props.onOpenLfs) : undefined}>{props.zh ? 'Git LFS 管理…' : 'Manage Git LFS…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenSubmodules} onClick={props.onOpenSubmodules ? action(props.onOpenSubmodules) : undefined}>{props.zh ? '子模块管理…' : 'Manage submodules…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenTags} onClick={props.onOpenTags ? action(props.onOpenTags) : undefined}>{props.zh ? '标签管理…' : 'Manage tags…'}</button>
      <button type="button" role="menuitem" disabled={!props.onImportPatch} onClick={props.onImportPatch ? action(props.onImportPatch) : undefined}>{props.zh ? '导入补丁…' : 'Import patch…'}</button>
      <button type="button" role="menuitem" disabled={!props.onExportPatch} onClick={props.onExportPatch ? action(props.onExportPatch) : undefined}>{props.zh ? '导出补丁…' : 'Export patch…'}</button>
      <button type="button" role="menuitem" disabled={!props.onExportArchive} onClick={props.onExportArchive ? action(props.onExportArchive) : undefined}>{props.zh ? '导出源码存档…' : 'Export source archive…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenFileHistory} onClick={props.onOpenFileHistory ? action(props.onOpenFileHistory) : undefined}>{props.zh ? '文件历史与代码归属…' : 'File history and blame…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenInteractiveRebase} onClick={props.onOpenInteractiveRebase ? action(props.onOpenInteractiveRebase) : undefined}>{props.zh ? '交互变基…' : 'Interactive rebase…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenAmend} onClick={props.onOpenAmend ? action(props.onOpenAmend) : undefined}>
        {props.zh ? '修订上次提交…' : 'Amend last commit…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenSettings} onClick={props.onOpenSettings ? action(props.onOpenSettings) : undefined}>
        {props.zh ? '仓库设置…' : 'Repository settings…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenPush)}>
        {props.zh ? '推送…' : 'Push…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenUpdate)}>
        {props.zh ? '更新项目…' : 'Update Project…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenSubtree)}>
        {props.zh ? '管理子树…' : 'Manage subtrees…'}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={action(props.onOpenNewBranch)}>
        {props.zh ? '新建分支…' : 'New Branch…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenDeleteBranches} onClick={props.onOpenDeleteBranches ? action(props.onOpenDeleteBranches) : undefined}>
        {props.zh ? '删除本地分支…' : 'Delete local branches…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenRevision)}>
        {props.zh ? '切换到标签或提交…' : 'Switch to a tag or commit…'}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('log'))}>
        {props.zh ? '显示 Git 历史' : 'Show Git History'}
      </button>
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('changes'))}>
        {props.zh ? '未提交的变更' : 'Uncommitted Changes'}
      </button>
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('stash'))}>
        {props.zh ? '贮藏' : 'Stashes'}
      </button>
      {props.onOpenConsole ? (
        <button type="button" role="menuitem" onClick={action(props.onOpenConsole)}>
          {props.zh ? '控制台 / 操作记录' : 'Console / Operation history'}
        </button>
      ) : null}
    </MenuSurface>,
    document.body,
  );
}

function CommitDialog(props: {
  open: boolean;
  client: Pick<DashboardClient, 'loadProjectGitCommitTemplate'>;
  projectId: string;
  zh: boolean;
  repositories: ProjectGitRepositoryWorkbenchItem[];
  busy: BusyState;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [message, setMessage] = useState('');
  const [templateSource, setTemplateSource] = useState('');
  const staged = props.repositories.filter((repository) => repository.snapshot.fileStatuses.some((file) => file.indexStatus !== ' ' && file.indexStatus !== '?'));
  const templateRepository = staged.length === 1 ? staged[0] : staged.find(repository => repository.id === templateSource);
  if (!props.open) return null;
  return (
    <ModalPortal
      rootClassName="project-git-modal-root"
      backdropClassName="project-git-modal-backdrop"
      onDismiss={props.onClose}
      dismissDisabled={props.busy !== null}
      role="dialog"
      aria-label={props.zh ? '提交已暂存变更' : 'Commit staged changes'}
    >
      <section className="project-git-commit-dialog" data-modal-surface="dialog">
        <header>
          <strong>{props.zh ? '提交已暂存变更' : 'Commit staged changes'}</strong>
          <small>{props.zh ? '每个仓库会分别创建提交。' : 'Each repository will receive a separate commit.'}</small>
        </header>
        <main>
          {staged.map((repository) => (
            <span key={repository.id}>
              <GitBranch aria-hidden="true" />
              <strong>{repository.name}</strong>
              <small>
                {repository.snapshot.fileStatuses.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?').length} {props.zh ? '个文件' : 'files'}
              </small>
            </span>
          ))}
          <div className="source-git-template">
            {staged.length > 1 ? <select aria-label={props.zh ? '提交模板来源仓库' : 'Commit template source repository'} value={templateRepository?.id ?? ''} disabled={props.busy !== null} onChange={event => setTemplateSource(event.target.value)}><option value="">{props.zh ? '选择模板来源仓库' : 'Choose a template repository'}</option>{staged.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select> : null}
            <GitCommitTemplateControl key={`${props.projectId}:${templateRepository?.id ?? ''}`} client={props.client} projectId={props.projectId} repositoryId={templateRepository?.id ?? ''} repositoryName={templateRepository?.name} value={message} zh={props.zh} disabled={props.busy !== null} active={props.open} autoFill={staged.length === 1} onApply={(next, expected) => setMessage(current => current === expected ? next : current)} />
          </div>
          <label>
            <span>{props.zh ? '提交说明' : 'Commit message'}</span>
            <textarea value={message} onChange={(event) => setMessage(event.currentTarget.value)} autoFocus />
          </label>
        </main>
        <footer>
          <Button variant="secondary" onClick={props.onClose} disabled={props.busy !== null}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            busy={props.busy?.action === 'commit'}
            disabled={!message.trim() || staged.length === 0 || props.busy !== null}
            onClick={async () => {
              for (const repository of staged) {
                const outcome = await props.onExecute(repository, { type: 'commit', message: message.trim() }, props.zh ? '提交已暂存变更' : 'Commit staged changes');
                if (outcome !== 'completed') return;
              }
              setMessage('');
              props.onClose();
            }}
          >
            {props.zh ? `提交 ${staged.length} 个仓库` : `Commit ${staged.length} repositories`}
          </Button>
        </footer>
      </section>
    </ModalPortal>
  );
}

function readRememberedTab(projectId: string): GitTab {
  const value = typeof window === 'undefined' ? null : window.localStorage.getItem(`astragit.project-git-tab-v2:${projectId}`);
  return value === 'changes' || value === 'ignored' || value === 'stash' || value === 'console' ? value : 'log';
}

function displayStashSubject(subject: string, zh: boolean): string {
  const cleaned = subject.replace(/^(?:On\s+[^:]+|WIP\s+on\s+[^:]+):\s*/iu, '').trim();
  return cleaned || (zh ? '未命名 Stash' : 'Untitled stash');
}

function errorMessage(error: unknown, zh: boolean, options: ApplicationErrorOptions = {}): string {
  return reportApplicationError(error, { language: zh ? 'zh-CN' : 'en', ...options });
}

function formatRelativeTime(value: string, zh: boolean): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return zh ? '刚刚' : 'Just now';
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}

/** 将当前文件的单个 hunk 重建为 Git 可接受的 patch，供暂存、取消暂存或放弃使用。 */

function SubtreeManagementDialog(props: {
  repository: ProjectGitRepositoryWorkbenchItem;
  zh: boolean;
  busy: BusyState;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [operation, setOperation] = useState<'add' | 'pull' | 'push'>('add');
  const [path, setPath] = useState('');
  const [remote, setRemote] = useState(props.repository.snapshot.remotes[0] ?? '');
  const [branch, setBranch] = useState('');
  return (
    <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={props.busy !== null} role="dialog" aria-label={props.zh ? '管理子树' : 'Manage subtree'}>
      <section className="project-git-subtree-dialog" data-modal-surface="dialog">
        <h2>{props.zh ? '管理子树' : 'Manage subtree'}</h2>
        <p>{props.zh ? '添加和拉取使用 squash 合并，需要干净的工作区。操作前会确认目标仓库与分支。' : 'Add and pull use squash and require a clean working tree. Confirm the target before executing.'}</p>
        <label>
          {props.zh ? '操作' : 'Action'}
          <select value={operation} onChange={(event) => setOperation(event.currentTarget.value as 'add' | 'pull' | 'push')}>
            <option value="add">{props.zh ? '添加' : 'Add'}</option>
            <option value="pull">{props.zh ? '拉取' : 'Pull'}</option>
            <option value="push">{props.zh ? '推送' : 'Push'}</option>
          </select>
        </label>
        <label>
          {props.zh ? '子树路径' : 'Subtree path'}
          <input value={path} onChange={(event) => setPath(event.currentTarget.value)} placeholder="packages/example" list="project-git-subtree-paths" />
        </label>
        <datalist id="project-git-subtree-paths">
          {props.repository.subtreePaths?.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <label>
          {props.zh ? '远端' : 'Remote'}
          <select value={remote} onChange={(event) => setRemote(event.currentTarget.value)}>
            {props.repository.snapshot.remotes.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          {props.zh ? '远端分支' : 'Remote branch'}
          <input value={branch} onChange={(event) => setBranch(event.currentTarget.value)} placeholder="main" />
        </label>
        <footer>
          <Button variant="secondary" disabled={props.busy !== null} onClick={props.onClose}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            disabled={props.busy !== null || !path || !remote || !branch}
            onClick={() =>
              void props.onExecute(props.repository, { type: 'subtree', operation, path, remote, branch }, props.zh ? '子树操作' : 'Subtree operation').then((result) => {
                if (result === 'completed') props.onClose();
              })
            }
          >
            {props.zh ? '执行' : 'Execute'}
          </Button>
        </footer>
      </section>
    </ModalPortal>
  );
}
