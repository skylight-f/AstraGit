import { parseGitUnifiedDiff } from './gitUnifiedDiff.js';
import { readRepositoryContext, readRepositoryStatus, readRepositoryClean } from './gitRepositoryState.js';
import { gitDiffReader, gitDisplayDiffOptions, gitDisplayDiffMetadataOptions, readGitDiffMetadata, readGitDisplayDiff, readWorkspaceGitDiffs, type GitDiffUnavailableReason } from './gitDiffReader.js';
import { readGitArchivePreview, writeGitArchive } from './gitArchive.js';
export { parseGitArchiveInput } from './gitArchive.js';
export type { GitArchiveInput, GitArchiveFormat, GitArchivePreview, GitArchiveResult } from './gitArchive.js';
export type { GitDiffUnavailableReason } from './gitDiffReader.js';
export { parseGitUnifiedDiff };
import { readGitLineDiff, prepareGitLineChanges, parseGitLineDiffInput, parseGitLineChange, type GitLineDiffInput, type GitLineChange } from './gitLineOperations.js';
export { parseGitLineDiffInput, parseGitLineChange };
export type { GitLineDiffInput, GitLineDiffPreview, GitLineChange, GitLineSelection } from './gitLineOperations.js';
import { readGitStagePreview, validateGitStageReview, parseGitStagePreviewInput, parseGitLargeFileReview, type GitLargeFileReview, type GitStagePreviewInput } from './gitStageReview.js';
export { parseGitStagePreviewInput, parseGitLargeFileReview };
export type { GitStagePreview, GitStagePreviewInput, GitLargeFileReview } from './gitStageReview.js';
import { readGitLfsState, previewGitLfs, executeGitLfs, parseGitLfsChange, type GitLfsChange } from './gitLfsOperations.js';
import { readGitFlowState, previewGitFlow, executeGitFlow, parseGitFlowChange, type GitFlowChange, type GitFlowOutcome } from './gitFlowOperations.js';
export { parseGitFlowChange };
export type { GitFlowKind, GitFlowConfiguration, GitFlowChange, GitFlowState, GitFlowBranch, GitFlowPreview, GitFlowOutcome, GitFlowRefChange } from './gitFlowOperations.js';
export { parseGitLfsChange };
export type { GitLfsChange, GitLfsState, GitLfsPattern, GitLfsFile, GitLfsPreview } from './gitLfsOperations.js';
import { configureGitExternalTool, readGitExternalToolSettings, previewGitExternalTool, executeGitExternalTool, parseGitExternalToolInput, parseGitExternalToolConfiguration, type GitExternalToolInput, type GitExternalToolConfiguration } from './gitExternalTools.js';
export { parseGitExternalToolInput, parseGitExternalToolConfiguration };
export type { GitExternalToolKind, GitExternalToolInput, GitExternalToolConfiguration, GitExternalToolSettings, GitExternalToolPreview } from './gitExternalTools.js';
import { readGitSubmodules, previewGitSubmodule, executeGitSubmodule, parseGitSubmoduleChange, type GitSubmoduleChange } from './gitSubmoduleOperations.js';
export { parseGitSubmoduleChange };
export type { GitSubmoduleChange, GitSubmoduleState, GitSubmoduleItem, GitSubmodulePreview } from './gitSubmoduleOperations.js';
import { readMailboxPreview, prepareMailboxImport, type GitMailboxInput } from './gitMailboxOperations.js';
export type { GitMailboxInput, GitMailboxPreview, GitMailboxCommit } from './gitMailboxOperations.js';
// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
import { AsyncLocalStorage } from 'node:async_hooks';
import { decodeGitQuotedPath as decodeGitDiagnosticPath } from './gitQuotedPath.js';
import { readTrackedFiles, readFileHistory, readFileRevision, type GitTrackedFileQuery, type GitFileHistoryQuery, type GitFileRevisionQuery } from './gitFileHistory.js';
import { captureHistorySearchScope, searchHistoryScope, type GitHistorySearchScope, type GitHistorySearchQuery } from './gitHistorySearch.js';
import { readPatchPreview, preparePatchImport, exportGitPatch, type GitPatchInput, type GitPatchExportInput } from './gitPatchOperations.js';
import { assertGitTagRef, localGitTags, readGitTagPage, deleteGitRemoteTag, type GitTagQuery } from './gitTagOperations.js';
import { gitCommandConfig } from './gitRemoteEndpoint.js';
export type { GitTagQuery, GitTagPage, GitTagItem, GitTagLocalInfo, GitTagTarget, DeleteRemoteTagInput } from './gitTagOperations.js';
export type { GitPatchSeriesCommit, GitPatchInput, GitPatchPreview, GitPatchExportInput, GitRepositoryPatchExport, GitPatchFile } from './gitPatchOperations.js';
export { validateHistorySearch } from './gitHistorySearch.js';
export type { GitHistorySearchScope, GitHistorySearchQuery, GitHistorySearchPage, GitHistorySearchCommit, GitHistorySearchField } from './gitHistorySearch.js';
export type { GitTrackedFileQuery, GitTrackedFilePage, GitFileHistoryQuery, GitFileHistoryEntry, GitFileHistoryPage, GitFileRevisionQuery, GitFileRevision, GitFileOriginLine } from './gitFileHistory.js';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { defaultTaskBranchPrefix, normalizeTaskBranchPrefix, hasUnresolvedGitConflictMarkers, gitRemoteAddressIssue, splitGitRemoteBranch, type RepositorySetupInput, type UserFacingErrorCause } from '@astragit/shared';
import { commitSelectedPaths } from './gitSelectedCommit.js';
import { executeRepositorySettings, readRepositorySettings, type RepositorySettingsAction } from './gitRepositorySettings.js';
import { configureCommitTemplate, readCommitTemplate, type GitCommitTemplateChange } from './gitCommitTemplate.js';
import { readGitWritePreview, type GitResetMode, type GitWritePreview } from './gitDestructivePreview.js';
import { readGitCommitReplayPreview, parseGitCommitReplayInput, gitCommitReplayArguments, gitCommitReplayFailure, type GitCommitReplayInput } from './gitCommitReplay.js';
export { parseGitCommitReplayInput } from './gitCommitReplay.js';
export type { GitCommitReplayInput, GitCommitReplayPreview } from './gitCommitReplay.js';
import { readGitCommitReplaySeriesPreview, gitCommitReplaySeriesArguments, type GitCommitReplaySeriesInput } from './gitCommitReplaySeries.js';
export { parseGitCommitReplaySeriesInput } from './gitCommitReplaySeries.js';
export type { GitCommitReplaySeriesInput, GitCommitReplaySeriesPreview } from './gitCommitReplaySeries.js';
import { resolveGitFileLocation, type GitFileIntent } from './gitFileLocation.js';
import { appendGitIgnore, readGitIgnorePreview, type GitIgnoreInput, type GitIgnoreScope } from './gitIgnore.js';
import { readGitHiddenChanges, readInteractiveRebasePreview, executeInteractiveRebase, prepareInteractiveRebaseControl, readRebaseEditState, type GitInteractiveRebaseInput, type GitRebaseEditState } from './gitInteractiveRebase.js';
export type { GitInteractiveRebaseInput, GitInteractiveRebasePreview, GitRebasePlanStep, GitRebasePlanAction, GitRebaseEditState } from './gitInteractiveRebase.js';
import { readStopTracking, gitFileSelection } from './gitFileTracking.js';
import { readIgnoredFiles, requireIgnoredSelection, gitIgnoreMatches, type GitIgnoredQuery } from './gitIgnoredFiles.js';
export type { GitIgnoreMatch, GitIgnoredItem, GitIgnoredPage, GitIgnoredQuery } from './gitIgnoredFiles.js';
export type { GitStopTrackingPreview } from './gitFileTracking.js';
export type { GitIgnoreInput, GitIgnorePreview, GitIgnoreScope } from './gitIgnore.js';
export type { GitFileIntent, GitFileLocation } from './gitFileLocation.js';
export type { GitResetMode, GitWritePreview } from './gitDestructivePreview.js';
export type { ProjectGitRepositorySettings, RepositorySettingsAction } from './gitRepositorySettings.js';
export { parseGitCommitTemplateChange } from './gitCommitTemplate.js';
export type { GitCommitTemplate, GitCommitTemplateChange } from './gitCommitTemplate.js';
import { readProjectConflict, saveProjectConflict, type ProjectGitConflictFile, type ProjectGitConflictWriteResult, type SaveProjectGitConflictInput } from './gitProjectConflict.js';
export type { ProjectGitConflictFile, ProjectGitConflictIndexStage, ProjectGitConflictWriteResult, SaveProjectGitConflictInput } from './gitProjectConflict.js';
export { readSelectedCommitFingerprint, readSelectedGitCommitChanges, type GitCommitSelectionMode } from './gitCommitSelectionContext.js';

const execFileAsync = promisify(execFile);
/** 当前工作台操作的取消、凭据环境和命令记录回调，彼此隔离。 */
const projectGitExecution = new AsyncLocalStorage<{ signal?: AbortSignal; env?: NodeJS.ProcessEnv; onCommand?: (command: string) => Promise<void>; onOutput?: (text: string) => void; timeoutMs?: number }>();
const gitDirectoryEnvironment = { GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_NAMESPACE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined, GIT_PREFIX: undefined };

/**
 * Git Core 对外暴露的真实 mutation capability 单一来源。
 *
 * 上层机器清单按这里的名字动态发现调用点；新增 Git 写能力若未进入该表，或进入该表后
 * 没有在独立内部副作用清单中取得精确恢复边界，架构门禁都会失败关闭。
 */
export const gitMutatingCapabilityNames = [
  'prepareTaskWorktree',
  'prepareWorkflowCandidate',
  'cleanupPreparedTaskWorktree',
  'refreshConflictTaskWorkspace',
  'fetchGitRemote',
  'commitTaskWorkspace',
  'pushTaskWorkspace',
  'pushLocalBranch',
  'reclaimTaskWorktree',
  'reclaimDeliveredTaskWorktree',
  'removeTaskWorktreeForTerminalStatus',
  'discardTaskWorktree',
  'startTaskBranchIntegration',
  'startTaskIntegrationAttempt',
  'writeTaskIntegrationResolution',
  'writeTaskIntegrationDraft',
  'completeTaskIntegrationCommit',
  'finalizeTaskBranchIntegration',
  'cleanupTaskIntegrationWorktree',
  'executeHighRiskGitOperation',
  'executeProjectGitAction',
  'saveProjectGitConflict',
  'setupGitRepository',
] as const;

export interface GitStatusSummary {
  isRepository: boolean;
  branch: string;
  clean: boolean;
  changedFiles: string[];
  conflictFiles: string[];
  fileStatuses: GitFileStatus[];
  remoteBranches: string[];
  recentCommits: GitRecentCommit[];
}

export interface GitWorkingContext {
  isRepository: boolean;
  branch: string | null;
}

export interface GitWorktreeEntry {
  path: string;
  headSha: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface GitRepositoryContext {
  isRepository: boolean;
  topLevel: string;
  branch: string;
  detached: boolean;
  headSha: string;
  localBranches: string[];
  remoteBranches: string[];
  remotes: string[];
  worktrees: GitWorktreeEntry[];
}

export interface DiscoveredGitRepository {
  name: string;
  relativePath: string;
  localPath: string;
  branch: string;
  headSha: string;
  clean: boolean;
  localBranches: string[];
  remotes: string[];
  context: GitRepositoryContext;
}

export interface PrepareTaskWorktreeInput {
  repositoryPath: string;
  repositoryContext?: GitRepositoryContext;
  projectSlug: string;
  taskCode: string;
  taskTitle: string;
  workspaceId: string;
  branchName: string;
  /** 新建或接管分支时要求的命名空间；null 仅用于恢复已登记工作区。 */
  branchPrefix?: string | null;
  sourceRef: string;
  sourceKind?: 'local' | 'remote';
  sourceBranch?: string;
  existingBranch: boolean;
  existingRemoteRef?: string;
  worktreePath?: string;
  includeLocalChanges?: boolean;
  ignoredPaths?: string[];
  /** 仅恢复已交付或已回收的任务时，允许完整保留失去 Git 登记的残留目录后重建。 */
  preserveUnregisteredDirectory?: boolean;
  /** 补入新增仓库时只挂接 Git 身份，保留既有普通任务目录的全部文件。 */
  adoptUnregisteredDirectory?: { nestedPaths: string[] };
}

export interface PreparedTaskWorktree {
  topLevel: string;
  worktreePath: string;
  branchName: string;
  sourceBranch: string;
  sourceHeadSha: string;
  headSha: string;
  reused: boolean;
  localChangesApplied: boolean;
  /** 原目录完整保留的位置；上层必须记录，不能把残留文件静默当作已恢复的代码。 */
  preservedDirectory?: string;
}

/** 从冻结代码事实准备数字团队内部候选版本的输入。 */
export interface PrepareWorkflowCandidateInput {
  /** 已登记项目仓库或其中任意工作区的路径。 */
  repositoryPath: string;
  /** 用于隔离候选工作区目录的项目标识。 */
  projectSlug: string;
  /** 当前工作流候选的稳定身份；相同身份只恢复同一物理工作区。 */
  candidateId: string;
  /** 仅供当前工作流内部使用的稳定候选分支。 */
  branchName: string;
  /** 创建候选分支所依据的冻结提交。 */
  baseSha: string;
  /** 按工作流拓扑顺序排列的精确上游交付提交。 */
  upstreamCommitShas: string[];
}

/** 数字团队内部候选工作区的可恢复结果。 */
export interface PreparedWorkflowCandidate {
  /** 项目真实 Git 根目录。 */
  topLevel: string;
  /** 稳定候选 worktree 的绝对路径。 */
  worktreePath: string;
  /** 候选 worktree 绑定的本地分支。 */
  branchName: string;
  /** 已校验存在的冻结基础提交。 */
  baseSha: string;
  /** 已校验存在且保持调用顺序的上游提交。 */
  upstreamCommitShas: string[];
  /** 无冲突时的候选提交；冲突现场尚未形成候选提交时为空。 */
  candidateSha: string | null;
  /** 候选已经可验证，或仍保留待处理冲突。 */
  state: 'ready' | 'conflicted';
  /** 以 Git 原始相对路径返回的未解决冲突文件。 */
  conflictFiles: string[];
  /** 是否复用了已经登记的候选分支或 worktree。 */
  reused: boolean;
}

export interface TaskWorkspaceReview {
  cwd: string;
  branch: string;
  headSha: string;
  /** 正在合并的另一端提交；用于区分不同冲突现场。 */
  mergeHeadSha: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  conflictFiles: string[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  untrackedFiles: GitFileStatus[];
  stagedDiff: GitDiffSummary;
  unstagedDiff: GitDiffSummary;
}

export interface CommitTaskWorkspaceInput {
  cwd: string;
  message: string;
  selectedPaths: string[];
  ignoredPaths?: string[];
}

export interface CommitTaskWorkspaceResult {
  branch: string;
  headSha: string;
  committed: boolean;
  formattedPaths: string[];
}

export interface PushTaskWorkspaceInput {
  cwd: string;
  ignoredPaths?: string[];
  remoteName?: string;
  remoteBranch?: string;
}

export interface PushTaskWorkspaceResult {
  branch: string;
  headSha: string;
  remoteName: string;
  remoteBranch: string;
  remoteHeadSha: string;
}

export interface PushLocalBranchInput {
  repositoryPath: string;
  remoteName: string;
  branchName: string;
}

export interface TaskWorkspaceFileDiff {
  path: string;
  diff: GitDiffSummary;
}

export interface TaskBranchFileChange {
  path: string;
  originalPath?: string;
  changeType: GitDiffFileChangeType;
  additions: number;
  deletions: number;
}

export interface TaskBranchComparison {
  sourceBranch: string;
  taskBranch: string;
  sourceHeadSha: string;
  taskHeadSha: string;
  mergeBaseSha: string;
  ahead: number;
  behind: number;
  files: TaskBranchFileChange[];
}

export interface TaskBranchIntegrationStartResult {
  integrationPath: string;
  targetBranch: string;
  targetHeadSha: string;
  taskBranch: string;
  taskHeadSha: string;
  mode: 'merge' | 'squash';
  state: 'ready' | 'conflicted';
  resultHeadSha: string | null;
  conflictFiles: string[];
  /** 冲突是否来自来源工作区未提交草稿与任务成果的叠加。 */
  localChangesConflict?: boolean;
}

export interface TaskIntegrationConflictFile {
  path: string;
  fingerprint: string;
  base: string;
  source: string;
  task: string;
  result: string;
}

export interface FinalizedTaskBranchIntegration {
  targetBranch: string;
  targetHeadSha: string;
  resultHeadSha: string;
  remoteName: string;
  remoteHeadSha: string | null;
  localSyncStatus: 'synced' | 'pending';
  localHeadSha: string;
  localWorktreePath: string | null;
  /** 来源草稿与任务成果产生的真实冲突；为空时只表示同步完成或仍有其他阻碍。 */
  conflictFiles: string[];
}

/** 来源工作区草稿在隔离合入现场中的持久恢复信息。 */
interface TaskIntegrationLocalChangesState {
  /** 原来源工作区绝对路径，落回时必须仍绑定同一目标分支。 */
  sourceWorktreePath: string;
  /** 来源分支开始合入时的提交。 */
  targetHeadSha: string;
  /** 只包含任务分支已提交成果的合入提交。 */
  resultHeadSha: string;
  /** 以来源提交为父节点、只用于三方合并的临时快照提交。 */
  sourceSnapshotCommitSha: string;
  /** 来源工作区完整未提交内容对应的 Git 树。 */
  sourceSnapshotTreeSha: string;
  /** 来源工作区原暂存区对应的 Git 树，用于失败回滚。 */
  sourceIndexTreeSha: string;
  /** 快照时未跟踪的普通文件，用于精确清理后再落回。 */
  sourceUntrackedPaths: string[];
}

/** 来源工作区同步结果同时承载可续办的冲突文件。 */
interface TaskIntegrationLocalSync {
  /** 本地来源分支是否已经推进。 */
  localSyncStatus: 'synced' | 'pending';
  /** 本地来源分支当前提交。 */
  localHeadSha: string;
  /** 来源分支当前检出目录；未检出时为空。 */
  localWorktreePath: string | null;
  /** 隔离现场中的来源草稿冲突文件。 */
  conflictFiles: string[];
}

/** 一次来源工作区快照的 Git 对象与未跟踪文件清单。 */
interface TaskIntegrationLocalChangesSnapshot {
  /** 完整工作区内容对应的临时提交。 */
  commitSha: string;
  /** 完整工作区内容对应的树。 */
  treeSha: string;
  /** 原暂存区对应的树。 */
  indexTreeSha: string;
  /** 不受忽略规则排除的未跟踪普通文件。 */
  untrackedPaths: string[];
}

/** 每个合入 worktree 独立保存来源草稿快照，不污染业务文件。 */
const taskIntegrationLocalChangesStateName = 'astragit-local-changes.json';

export type GitFileStatusCategory = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'other';

export interface GitFileStatus {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
  category: GitFileStatusCategory;
}

export interface GitRecentCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
  parentHashes: string[];
}

/** 单行 Git blame 归属信息；时间使用 Git 返回的 Unix 秒级时间戳。 */
export interface GitBlameLine {
  commitHash: string;
  shortHash: string;
  author: string;
  authorTime: number;
  subject: string;
  line: number;
}

export interface GitFileBlame {
  path: string;
  lines: GitBlameLine[];
  /** 没有可追溯历史属于正常状态，不能与 Git 执行失败混为一谈。 */
  unavailableReason?: 'not_repository' | 'no_commits' | 'uncommitted_file' | 'not_in_revision';
}

export interface ProjectGitStashEntry {
  ref: string;
  hash: string;
  subject: string;
  author: string;
  authoredAt: string;
}

export interface ProjectGitRecentRef {
  ref: string;
  kind: 'local' | 'remote' | 'tag' | 'revision';
}

export interface ProjectGitRepositorySnapshot {
  rebaseEdit?: GitRebaseEditState | null;
  /** Identifies the index shown for an explicit amend confirmation. */
  indexFingerprint?: string;
  submodules?: { path: string; initialized: boolean }[];
  integrationState?: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' | null;
  /** Native sequencer is applying changes without automatic commits. */
  integrationNoCommit?: boolean;
  branch: string;
  detached: boolean;
  headTags: string[];
  headSha: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  fileStatuses: GitFileStatus[];
  conflictFiles: string[];
  localBranches: string[];
  checkedOutBranches: string[];
  /** 仅用于展示的脱敏远端地址与各本地分支的跟踪关系。 */
  remoteDetails?: Array<{ name: string; fetchUrl: string; pushUrl: string; pushUrls?: string[]; pushFingerprint?: string }>;
  localBranchHeads?: Record<string, string>;
  remoteBranchHeads?: Record<string, string>;
  branchUpstreamRefs?: Record<string, string>;
  branchUpstreams?: Record<string, string>;
  /** 每个已设置上游的本地分支，相对其远端跟踪分支的提交差异。 */
  branchDivergences?: Record<string, { ahead: number; behind: number }>;
  remoteBranches: string[];
  remotes: string[];
  tags: string[];
  recentRefs: ProjectGitRecentRef[];
  recentCommits: GitRecentCommit[];
  outgoingCommits: GitRecentCommit[];
  stashes: ProjectGitStashEntry[];
  diff: GitDiffSummary;
  stagedDiff: GitDiffSummary;
  unstagedDiff: GitDiffSummary;
}

export type ProjectGitAction =
  | { type: 'cherry_pick_series'; input: GitCommitReplaySeriesInput; expectedFingerprint: string }
  | ({ type: 'interactive_rebase' } & GitInteractiveRebaseInput)
  | { type: 'amend_rebase_step'; message: string; expectedHeadSha: string; expectedIndexFingerprint: string; expectedStepFingerprint: string }
  | { type: 'stage_ignored'; paths: string[]; largeFileReview?: GitLargeFileReview }
  | { type: 'stop_tracking'; paths: string[]; force?: boolean; expectedFingerprint: string }
  | ({ type: 'ignore'; expectedFingerprint: string } & GitIgnoreInput)
  | { type: 'reset_revision'; targetSha: string; mode: GitResetMode; expectedFingerprint: string; discardNestedRepositories?: boolean }
  | { type: 'skip_integration'; kind: 'rebase' | 'cherry_pick' | 'revert' | 'am'; expectedFingerprint: string; discardNestedRepositories?: boolean }
  | RepositorySettingsAction
  | GitCommitTemplateChange
  | { type: 'amend_commit'; message: string; expectedHeadSha: string; expectedBranch: string; expectedIndexFingerprint: string }
  | { type: 'discard'; paths: string[] }
  | { type: 'rename_branch'; branchName: string; newName: string }
  | { type: 'create_tag'; tagName: string; revision: string; message?: string; annotated?: boolean; expectedTargetSha?: string }
  | { type: 'push_tag'; tagName: string; remote: string; expectedTagObjectSha?: string; expectedRemotePushFingerprint?: string }
  | { type: 'delete_tag'; tagName: string; expectedTagObjectSha?: string }
  | { type: 'delete_remote_tag'; tagName: string; remote: string; expectedRemotePushFingerprint: string; expectedTargets: Array<string | null> }
  | { type: 'subtree'; operation: 'add' | 'pull' | 'push'; path: string; remote: string; branch: string }
  | { type: 'external_tool'; input: GitExternalToolInput; expectedFingerprint: string }
  | { type: 'manage_lfs'; change: GitLfsChange; expectedFingerprint: string }
  | { type: 'manage_flow'; change: GitFlowChange; expectedFingerprint: string }
  | { type: 'configure_external_tool'; configuration: GitExternalToolConfiguration; expectedFingerprint: string }
  | { type: 'manage_submodule'; change: GitSubmoduleChange; expectedFingerprint: string }
  | { type: 'submodule_update'; path: string }
  | { type: 'fetch'; remote?: string }
  | { type: 'stage'; paths: string[]; largeFileReview?: GitLargeFileReview }
  | { type: 'unstage'; paths: string[] }
  | { type: 'import_mailbox'; mailbox: GitMailboxInput; expectedFingerprint: string }
  | { type: 'import_patch'; patch: GitPatchInput; expectedFingerprint: string }
  | { type: 'apply_line_changes'; input: GitLineChange; largeFileReview?: GitLargeFileReview }
  | { type: 'apply_patch'; patch: string; reverse?: boolean; target?: 'index' | 'worktree' }
  | { type: 'commit'; message: string; paths?: string[]; selectionMode?: 'worktree' | 'staged'; expectedFingerprint?: string; expectedHeadSha?: string; expectedBranch?: string }
  | { type: 'push'; remote?: string; sourceBranch?: string; targetBranch?: string; setUpstream?: boolean; forceWithLease?: boolean; pushTags?: boolean; pushAllTags?: boolean; expectedHeadSha?: string; expectedBranch?: string }
  | { type: 'pull'; remote?: string; targetBranch?: string; strategy: 'rebase' | 'merge'; commitMerge?: boolean; includeMergeLog?: boolean; noFastForward?: boolean }
  | { type: 'update'; strategy: 'merge' | 'rebase' | 'reset'; smart?: boolean }
  | { type: 'checkout'; branchName: string; smart?: boolean; stashBeforeCheckout?: boolean }
  | { type: 'checkout_revision'; revision: string; smart?: boolean; stashBeforeCheckout?: boolean }
  | { type: 'create_branch'; branchName: string; baseRef?: string; trackRemote?: boolean; smart?: boolean; stashBeforeCheckout?: boolean }
  | { type: 'delete_branch'; branchName: string; force?: boolean; expectedTargetHeadSha?: string }
  | { type: 'delete_remote_branch'; remote: string; branchName: string; expectedTargetHeadSha: string; expectedRemotePushFingerprint: string }
  | { type: 'set_upstream'; branchName: string; upstreamRef: string | null; expectedUpstreamRef: string | null; expectedTargetHeadSha: string }
  | { type: 'revert'; revision: string; mainline?: number; commit?: boolean; includeSourceId?: boolean; expectedFingerprint?: string }
  | { type: 'cherry_pick'; revision: string; mainline?: number; commit?: boolean; includeSourceId?: boolean; expectedFingerprint?: string }
  | { type: 'merge'; branchName: string; commitMerge?: boolean; includeMergeLog?: boolean; noFastForward?: boolean; expectedHeadSha?: string; expectedBranch?: string; expectedSourceHeadSha?: string }
  | { type: 'rebase'; branchName: string }
  | { type: 'stash'; message?: string; includeUntracked?: boolean; keepIndex?: boolean }
  | { type: 'apply_stash'; stashRef: string; pop?: boolean }
  | { type: 'drop_stash'; stashRef: string }
  | { type: 'continue_integration' | 'abort_integration'; kind: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' };

export interface ProjectGitActionResult extends GitRunnerResult {
  action: ProjectGitAction['type'];
  outcome: 'completed' | 'conflict';
  branch: string;
  headSha: string;
  conflictFiles: string[];
  flow?: GitFlowOutcome;
}

/** 桌面控制台只接收操作展示信息，不携带完整仓库快照。 */
export interface ProjectGitOperationRecord {
  /** 耐久命令身份，用于合并刷新结果和去重。 */
  id: string;
  /** 当前项目内的稳定仓库身份。 */
  repositoryId: string;
  /** 仓库名称来自当前项目发现结果。 */
  repositoryName: string;
  /** 历史记录未保存动作时保持未知，不从输出猜测。 */
  action: string | null;
  /** 开始接纳操作的真实时间，亦为历史排序时间。 */
  startedAt: string;
  /** 终态耗时；仍在执行时不展示虚假的固定耗时。 */
  durationMs: number | null;
  /** 忠实区分确定结果、写前失败与写出后未知。 */
  status: 'running' | 'completed' | 'conflict' | 'failed_before_write' | 'unknown_after_write' | 'recorded';
  /** 原有脱敏输出或账本保留的错误摘要。 */
  output: string;
  /** 实际调用的 Git 命令；旧账本未保存时保持空值。 */
  commands: string[] | null;
  /** 明示历史信息缺失和本页输出的展示上限。 */
  limitations: Array<'action_unavailable' | 'output_not_saved' | 'output_truncated' | 'commands_not_saved' | 'commands_truncated'>;
}

/** 控制台历史页固定 50 条，计数始终代表整个项目的历史总量。 */
export interface ProjectGitOperationPage {
  /** 本页按时间和命令身份倒序排列。 */
  items: ProjectGitOperationRecord[];
  /** 当前查询范围内的真实记录总数。 */
  total: number;
  /** 服务端生成的不透明分页位置，空值表示已到末尾。 */
  nextCursor: string | null;
}

export interface ProjectGitCommitDetail {
  commit: GitRecentCommit;
  body: string;
  /** Exact Git message, including intentional leading/trailing whitespace. */
  fullMessage?: string;
  parentHashes: string[];
  files: Array<{ path: string; originalPath?: string; additions: number; deletions: number }>;
  diff: GitDiffSummary;
}

export interface GitRevisionComparison {
  /** Immutable before/after commits, in the direction selected by the user. */
  revisions: [string, string];
  files: ProjectGitCommitDetail['files'];
  diff: GitDiffSummary;
}

export interface GitDiffSummary {
  isRepository: boolean;
  files: string[];
  diffText: string;
  fileDiffs: GitFileDiff[];
  /** The file list is intact, but no complete patch was returned. Never export it as an empty patch. */
  unavailableReason?: GitDiffUnavailableReason;
  /** Merge commit previews explicitly identify the comparison parent. */
  comparisonParent?: string;
  readError?: UserFacingErrorCause;
}

export type GitDiffFileChangeType = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
export type GitDiffLineType = 'context' | 'addition' | 'deletion' | 'metadata';

export interface GitDiffLine {
  type: GitDiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface GitDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}

export interface GitFileDiff {
  /** Aggregate workspace reads preserve each index/worktree version separately. */
  stage?: 'staged' | 'unstaged' | 'untracked';
  oldPath: string;
  newPath: string;
  changeType: GitDiffFileChangeType;
  /** Gitlink 子模块的差异应展示提交指针行，不应作为普通目录预览。 */
  isSubmodule?: boolean;
  isBinary?: boolean;
  addedLines: number;
  deletedLines: number;
  hunks: GitDiffHunk[];
}

export interface GitPatchExport {
  fileName: string;
  mimeType: 'text/x-patch';
  patchText: string;
  files: string[];
  createdAt: string;
}

/** 读取仓库、分支和 worktree 身份；该快照不修改 refs 或工作区。 */
export async function getGitRepositoryContext(cwd: string, signal?: AbortSignal): Promise<GitRepositoryContext> {
  return readRepositoryContext(cwd, fileHistoryRuntime(signal));
}

/**
 * 在项目容器内完整发现真实 Git 根目录；只返回候选，不替用户登记仓库。
 * 扫描跳过依赖、构建产物和 AstraGit 自己的 worktree 根，避免把缓存仓库误纳入项目。
 * 目录或仓库不可读时抛出错误，禁止把不完整扫描伪装成空清单；退出可中止遍历。
 */
export async function discoverGitRepositories(containerPath: string, maxDepth = 6, signal?: AbortSignal): Promise<DiscoveredGitRepository[]> {
  const execution = projectGitExecution.getStore();
  const combined = signal && execution?.signal ? AbortSignal.any([signal, execution.signal]) : signal ?? execution?.signal;
  return projectGitExecution.run({ ...execution, signal: combined, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, () => discoverGitRepositoriesInternal(containerPath, maxDepth, combined));
}

async function discoverGitRepositoriesInternal(containerPath: string, maxDepth: number, signal?: AbortSignal): Promise<DiscoveredGitRepository[]> {
  /** 拒绝把文件系统根目录作为项目递归发现范围。 */
  const containerRoot = canonicalFilesystemPath(containerPath);
  if (dirname(containerRoot) === containerRoot) throw new Error('请选择实际项目目录，不能在文件系统根目录发现仓库。');
  const candidates: string[] = [];
  const seen = new Set<string>();
  const skippedDirectories = new Set(['.git', '.tmp', '.astragit-worktrees', 'node_modules', 'dist', 'build', 'target', '.next', '.turbo', '.cache']);

  let currentLevel = [containerRoot];
  for (let depth = 0; depth <= maxDepth && currentLevel.length > 0; depth += 1) {
    const nested = await mapWithConcurrency(currentLevel, 8, async (directoryPath) => {
      signal?.throwIfAborted();
      try {
        const [gitMarker, entries] = await Promise.all([
          lstat(join(directoryPath, '.git')).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          }),
          readdir(directoryPath, { withFileTypes: true }),
        ]);
        if (gitMarker?.isDirectory() || gitMarker?.isFile()) {
          const repositoryRoot = canonicalFilesystemPath(directoryPath);
          if (!seen.has(repositoryRoot)) {
            seen.add(repositoryRoot);
            candidates.push(repositoryRoot);
          }
        }
        if (depth === maxDepth) return [];
        return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !skippedDirectories.has(entry.name)).map((entry) => join(directoryPath, entry.name));
      } catch (error) {
        /** 权限错误码放在消息开头，跨进程丢失错误属性后仍能显示明确原因。 */
        const permissionCode = error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM') ? `${error.code}: ` : '';
        throw new Error(`${permissionCode}无法完整读取项目目录 ${directoryPath}：${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
    currentLevel = nested.flat();
  }
  const discovered = await mapWithConcurrency(candidates, 4, async (localPath) => {
    signal?.throwIfAborted();
    const [context, clean] = await Promise.all([getGitRepositoryContext(localPath), getGitWorktreeClean(localPath)]);
    if (!context.isRepository || canonicalFilesystemPath(context.topLevel) !== localPath) throw new Error(`无法读取 Git 仓库 ${localPath}，请检查目录权限和仓库状态。`);
    const repositoryRelativePath = relative(containerRoot, localPath);
    if (repositoryRelativePath === '..' || repositoryRelativePath.startsWith(`..${sep}`) || isAbsolute(repositoryRelativePath)) return null;
    return {
      name: basename(localPath),
      relativePath: repositoryRelativePath ? repositoryRelativePath.split(sep).join('/') : '.',
      localPath,
      branch: context.branch,
      headSha: context.headSha,
      clean,
      localBranches: context.localBranches,
      remotes: context.remotes,
      context,
    } satisfies DiscoveredGitRepository;
  });
  return discovered.filter((candidate): candidate is DiscoveredGitRepository => candidate !== null).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function mapWithConcurrency<Input, Output>(items: Input[], concurrency: number, operation: (item: Input, index: number) => Promise<Output>): Promise<Output[]> {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

/** 为一次任务推送生成共同根目录；逐仓 worktree 会按原相对路径放在该根目录内。 */
export function buildTaskEnvironmentRootPath(projectContainerPath: string, projectSlug: string, taskCode: string, pushId: string): string {
  const containerRoot = resolve(projectContainerPath);
  const root = join(dirname(containerRoot), '.astragit-worktrees');
  const safeProject = safePathSegment(projectSlug || basename(containerRoot));
  const safeTask = safePathSegment(taskCode);
  const safePush = safePathSegment(pushId).slice(-20) || 'push';
  return join(root, safeProject, safePush, safeTask);
}

/** 从任务编码、名称和开发线序号生成可读分支；最终合法性仍由 git check-ref-format 判定。 */
export function buildTaskBranchName(taskCode: string, taskTitle: string, sequence: number, branchPrefix = defaultTaskBranchPrefix): string {
  const slug =
    taskTitle
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 36) || 'task';
  return `${buildTaskBranchPrefix(taskCode, branchPrefix)}${slug}-${String(Math.max(1, Math.trunc(sequence))).padStart(2, '0')}`;
}

/** 用任务编码限定可接管的既有本地任务分支，避免把其他任务分支登记到当前任务。 */
export function buildTaskBranchPrefix(taskCode: string, branchPrefix = defaultTaskBranchPrefix): string {
  /** 调用方只应传入设置层已校验的值；这里仍失败关闭，避免生成无命名空间的分支。 */
  const normalizedPrefix = normalizeTaskBranchPrefix(branchPrefix);
  if (!normalizedPrefix) throw gitCoreError('ASTRAGIT_TASK_BRANCH_PREFIX_INVALID', 'Task branch prefix is invalid.');
  /** 任务编码继续使用既有清洗规则，避免外部任务系统字符污染分支路径。 */
  const normalizedCode =
    taskCode
      .trim()
      .replace(/[^A-Za-z0-9._-]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'TASK';
  return `${normalizedPrefix}/${normalizedCode}-`;
}

/** 使用 Git 自己的规则校验分支名，避免复制一份会漂移的手写正则。 */
export async function assertValidGitBranchName(cwd: string, branchName: string, branchPrefix: string | null = defaultTaskBranchPrefix): Promise<string> {
  const normalized = branchName.trim();
  if (branchPrefix !== null) {
    /** 前缀校验与自动命名共用规范化规则，避免两条路径接受范围不同。 */
    const normalizedPrefix = normalizeTaskBranchPrefix(branchPrefix);
    if (!normalizedPrefix) throw gitCoreError('ASTRAGIT_TASK_BRANCH_PREFIX_INVALID', 'Task branch prefix is invalid.');
    if (!normalized.startsWith(`${normalizedPrefix}/`) || normalized.length <= normalizedPrefix.length + 1) {
      throw gitCoreError('ASTRAGIT_TASK_BRANCH_PREFIX_REQUIRED', `Task branches must use the ${normalizedPrefix}/ prefix.`);
    }
  }
  try {
    return await assertGitBranchFormat(cwd, normalized, 'task branch');
  } catch {
    throw gitCoreError('ASTRAGIT_TASK_BRANCH_INVALID', `Invalid task branch name: ${normalized}`);
  }
}

/**
 * 创建或恢复任务 worktree。已注册的同名分支 worktree 会直接复用，
 * 从而保证一个任务开发分支同时只有一个物理写工作区。
 */
export async function prepareTaskWorktree(input: PrepareTaskWorktreeInput): Promise<PreparedTaskWorktree> {
  const context = input.repositoryContext ?? (await getGitRepositoryContext(input.repositoryPath));
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const branchName = await assertValidGitBranchName(context.topLevel, input.branchName, input.branchPrefix === undefined ? defaultTaskBranchPrefix : input.branchPrefix);
  /** unborn 来源只有分支名而没有引用；它仍是可用的本地开发起点。 */
  const sourceUnborn =
    input.sourceKind !== 'remote' && !context.detached && !context.headSha && (input.sourceRef.trim() === context.branch || (input.existingBranch && !input.sourceRef.trim() && input.sourceBranch?.trim() === context.branch));
  const registered = context.worktrees.find((entry) => entry.branch === branchName);
  if (registered) {
    if (!input.existingBranch) {
      throw gitCoreError('ASTRAGIT_TASK_BRANCH_ALREADY_EXISTS', `Task branch already has a registered worktree: ${branchName}`);
    }
    /** orphan 任务分支在首次提交前没有 refs/heads 引用，登记的 worktree 才是其稳定身份。 */
    const headSha = (await readCommitIfPresent(registered.path, 'HEAD')) ?? '';
    return {
      topLevel: context.topLevel,
      worktreePath: registered.path,
      branchName,
      sourceBranch: input.sourceBranch?.trim() || input.sourceRef.trim() || context.branch,
      sourceHeadSha: input.sourceRef.trim(),
      headSha,
      reused: true,
      localChangesApplied: false,
    };
  }
  // 新建工作区按调用方选中的本机可用引用冻结精确提交；恢复只接受持久化对象 ID。
  const adoptLocalBranch = input.existingBranch && input.sourceKind === 'local';
  const sourceRef = sourceUnborn ? context.branch : input.existingBranch && !adoptLocalBranch ? requireGitObjectId(input.sourceRef, 'source commit') : input.sourceRef.trim();
  const sourceBranch = sourceUnborn
    ? await assertGitBranchFormat(context.topLevel, input.sourceBranch?.trim() || context.branch, 'source branch')
    : adoptLocalBranch
      ? await assertNamedBranchExists(context.topLevel, sourceRef, 'task branch')
      : input.existingBranch
        ? input.sourceBranch?.trim() || sourceRef
        : input.sourceKind === 'remote'
          ? await assertRemoteBranchExists(context.topLevel, sourceRef, input.sourceBranch)
          : await assertNamedBranchExists(context.topLevel, sourceRef, 'source branch');
  const sourceHeadSha = sourceUnborn ? '' : await resolveCommit(context.topLevel, input.existingBranch && !adoptLocalBranch ? sourceRef : input.sourceKind === 'remote' ? `refs/remotes/${sourceRef}` : localBranchRef(sourceRef));

  const worktreePath = input.worktreePath ? resolve(input.worktreePath) : buildTaskWorktreePath(context.topLevel, input.projectSlug, input.taskCode, input.workspaceId);
  /** 先识别原目录；任何读取失败都不能当成目录不存在。 */
  const existingPath = await lstat(worktreePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  /** 仅普通非空目录可能属于失败回收的残留；符号链接和文件始终拒绝接管。 */
  const occupiedDirectory = existingPath?.isDirectory() && (await readdir(worktreePath)).length > 0;
  if (occupiedDirectory && input.adoptUnregisteredDirectory && !input.existingBranch) {
    return adoptTaskDirectory(context, worktreePath, branchName, sourceBranch, sourceHeadSha, input.adoptUnregisteredDirectory.nestedPaths);
  }
  /** 包括嵌套仓库在内，任何 Git 身份都不能随回收残留移动；递归读取不跟随符号链接。 */
  const containsGitIdentity = occupiedDirectory && input.existingBranch && input.preserveUnregisteredDirectory && (await readdir(worktreePath, { recursive: true, withFileTypes: true })).some((entry) => entry.name === '.git');
  /** Git 仍登记该路径时，即使标记文件丢失，也不能移动另一个分支或游离工作区。 */
  const pathRegistered = context.worktrees.some((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(worktreePath));
  if (existingPath && (!existingPath.isDirectory() || (occupiedDirectory && (!input.existingBranch || !input.preserveUnregisteredDirectory || containsGitIdentity || pathRegistered)))) {
    throw gitCoreError('ASTRAGIT_TASK_WORKTREE_PATH_OCCUPIED', `任务工作目录已有内容，且未登记为所需分支的工作区；已保留原文件：${worktreePath}`);
  }
  await mkdir(dirname(worktreePath), { recursive: true });
  const localBranchExists = context.localBranches.includes(branchName);
  if (localBranchExists && !input.existingBranch) {
    throw gitCoreError('ASTRAGIT_TASK_BRANCH_ALREADY_EXISTS', `Task branch already exists locally: ${branchName}`);
  }
  /** 只有 Git 确认创建成功后，才拥有失败回滚时清理该目录的权限。 */
  let worktreeCreated = false;
  /** 保留目录位于任务环境外，后续回收环境或创建失败回滚都不会删除它。 */
  let preservedDirectory: string | undefined;
  try {
    if (occupiedDirectory) {
      // 分支不可恢复时不移动原文件；只使用本机已有的任务分支或记录的远端引用。
      if (!localBranchExists && !context.remoteBranches.includes(input.existingRemoteRef?.trim() ?? '')) {
        throw gitCoreError('ASTRAGIT_TASK_BRANCH_NOT_FOUND', `Existing task branch is not available locally or on its recorded remote: ${branchName}`);
      }
      /** 在仓库旁的独立保留区创建唯一目录，不覆盖任何旧备份。 */
      const preservationRoot = join(dirname(context.topLevel), '.astragit-preserved-worktrees');
      await mkdir(preservationRoot, { recursive: true });
      /** 原目录整体移动，保留文件、权限、符号链接和未提交内容。 */
      const preservedPath = join(await mkdtemp(join(preservationRoot, `${safePathSegment(input.taskCode)}-`)), basename(worktreePath));
      await rename(worktreePath, preservedPath);
      preservedDirectory = preservedPath;
    }
    if (input.existingBranch) {
      if (localBranchExists) {
        await runGit(context.topLevel, ['worktree', 'add', worktreePath, branchName]);
      } else if (sourceUnborn) {
        await createUnbornTaskWorktree(context.topLevel, worktreePath, branchName);
      } else {
        const remoteRef = input.existingRemoteRef?.trim() ?? '';
        if (!remoteRef || !context.remoteBranches.includes(remoteRef)) {
          throw gitCoreError('ASTRAGIT_TASK_BRANCH_NOT_FOUND', `Existing task branch is not available locally or on its recorded remote: ${branchName}`);
        }
        await runGit(context.topLevel, ['worktree', 'add', '-b', branchName, worktreePath, remoteRef]);
      }
    } else if (sourceUnborn) {
      await createUnbornTaskWorktree(context.topLevel, worktreePath, branchName);
    } else {
      await runGit(context.topLevel, ['worktree', 'add', '-b', branchName, worktreePath, sourceHeadSha]);
    }
    worktreeCreated = true;
    /** 空仓库的全部项目文件都是来源内容，不能再要求用户额外勾选“未提交修改”。 */
    const localChangesApplied = (sourceUnborn || input.includeLocalChanges === true) && (!input.existingBranch || sourceUnborn) ? await applyLocalChangesToTaskWorktree(context.topLevel, worktreePath, input.ignoredPaths) : false;
    const headSha = (await readCommitIfPresent(worktreePath, 'HEAD')) ?? '';
    return {
      topLevel: context.topLevel,
      worktreePath,
      branchName,
      sourceBranch,
      sourceHeadSha,
      headSha,
      reused: false,
      localChangesApplied,
      ...(preservedDirectory ? { preservedDirectory } : {}),
    };
  } catch (error) {
    if (worktreeCreated) await cleanupPreparedTaskWorktree({ repositoryPath: context.topLevel, worktreePath, branchName, removeBranch: !input.existingBranch }).catch(() => undefined);
    if (preservedDirectory) throw new Error(`任务工作区恢复未完成；原目录保留在 ${preservedDirectory}。${commandFailureDetail(error)}`, { cause: error });
    throw error;
  }
}

/** 为已有普通目录挂接独立工作区；只新增 .git 和索引，不检出或覆盖任何业务文件。 */
async function adoptTaskDirectory(context: GitRepositoryContext, worktreePath: string, branchName: string, sourceBranch: string, sourceHeadSha: string, nestedPaths: string[]): Promise<PreparedTaskWorktree> {
  if (
    context.worktrees.some((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(worktreePath)) ||
    (await readdir(worktreePath, { recursive: true, withFileTypes: true })).some((entry) => entry.name === '.git' && !nestedPaths.some((path) => resolve(worktreePath, requireSafeWorkspacePath(path)) === resolve(entry.parentPath)))
  ) {
    throw gitCoreError('ASTRAGIT_TASK_WORKTREE_PATH_OCCUPIED', '任务目录已包含 Git 身份，不能作为普通目录补入。');
  }
  /** 临时工作区只建立 Git 元数据，最终目录中的代码始终留在原处。 */
  const temporaryPath = await mkdtemp(join(dirname(worktreePath), '.astragit-attach-'));
  /** 挂接后失败必须保留现场，不能用通用回滚删除用户目录或分支。 */
  let attached = false;
  /** 只清理本次确实创建的 Git 登记，禁止误删已有同名分支。 */
  let created = false;
  try {
    if (sourceHeadSha) await runGit(context.topLevel, ['worktree', 'add', '--no-checkout', '-b', branchName, temporaryPath, sourceHeadSha]);
    else await createUnbornTaskWorktree(context.topLevel, temporaryPath, branchName);
    created = true;
    if (sourceHeadSha) await runGit(temporaryPath, ['read-tree', 'HEAD']);
    await copyFile(join(temporaryPath, '.git'), join(worktreePath, '.git'), constants.COPYFILE_EXCL);
    attached = true;
    await runGit(context.topLevel, ['worktree', 'repair', worktreePath]);
    await rm(temporaryPath, { recursive: true, force: true });
    return { topLevel: context.topLevel, worktreePath, branchName, sourceBranch, sourceHeadSha, headSha: sourceHeadSha, reused: false, localChangesApplied: false };
  } catch (error) {
    if (attached) throw new Error(`任务目录的原文件已保留；Git 挂接尚未确认完成，请检查 ${worktreePath} 和 ${temporaryPath}。${commandFailureDetail(error)}`, { cause: error });
    if (created) await cleanupPreparedTaskWorktree({ repositoryPath: context.topLevel, worktreePath: temporaryPath, branchName, removeBranch: true });
    else await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 与 Codex 托管 worktree 一致，把来源工作目录的 staged、unstaged、未跟踪文件和
 * `.worktreeinclude` 命中的忽略文件应用到新任务工作区。来源合入快照可关闭忽略文件复制，
 * 因为目标分支推进不会改写它们。任一步失败都会由调用方回收。
 */
async function applyLocalChangesToTaskWorktree(sourcePath: string, targetPath: string, ignoredPaths: string[] = [], includeConfiguredIgnored = true): Promise<boolean> {
  const ignored = ignoredPaths.map((path) => requireSafeWorkspacePath(path));
  const pathspec = ['.', ...ignored.flatMap((path) => [`:(exclude)${path}`, `:(exclude)${path}/**`])];
  const stagedPatch = await readGitDiffAllowChanges(sourcePath, ['diff', '--cached', '--binary', '--', ...pathspec]);
  const unstagedPatch = await readGitDiffAllowChanges(sourcePath, ['diff', '--binary', '--', ...pathspec]);
  const untracked = splitNullRecords((await runGit(sourcePath, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec])).stdout);
  const includeFile = join(sourcePath, '.worktreeinclude');
  const includeExists = await lstat(includeFile)
    .then((entry) => entry.isFile())
    .catch(() => false);
  const includedIgnored = includeConfiguredIgnored && includeExists ? splitNullRecords((await runGit(sourcePath, ['ls-files', '--others', '--ignored', `--exclude-from=${includeFile}`, '-z', '--', ...pathspec])).stdout) : [];
  const copyPaths = Array.from(new Set([...untracked, ...includedIgnored]));
  const hasChanges = Boolean(stagedPatch || unstagedPatch || copyPaths.length > 0);
  if (!hasChanges) return false;

  const patchRoot = dirname(targetPath);
  if (stagedPatch) {
    const patchPath = join(patchRoot, `.astragit-staged-${process.pid}-${Date.now()}.patch`);
    await writeFile(patchPath, stagedPatch, 'utf8');
    try {
      await runGit(targetPath, ['apply', '--index', '--binary', patchPath]);
    } finally {
      await rm(patchPath, { force: true });
    }
  }
  if (unstagedPatch) {
    const patchPath = join(patchRoot, `.astragit-unstaged-${process.pid}-${Date.now()}.patch`);
    await writeFile(patchPath, unstagedPatch, 'utf8');
    try {
      await runGit(targetPath, ['apply', '--binary', patchPath]);
    } finally {
      await rm(patchPath, { force: true });
    }
  }
  for (const relativePath of copyPaths) {
    const safePath = requireSafeWorkspacePath(relativePath);
    const sourceFile = resolve(sourcePath, safePath);
    const targetFile = resolve(targetPath, safePath);
    if (!isPathInside(sourcePath, sourceFile) || !isPathInside(targetPath, targetFile)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Local change path escapes its repository: ${relativePath}`);
    const sourceEntry = await lstat(sourceFile);
    if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) continue;
    const targetEntry = await lstat(targetFile).catch(() => null);
    if (targetEntry) throw gitCoreError('ASTRAGIT_TASK_LOCAL_CHANGE_CONFLICT', `Local untracked file conflicts with the selected source branch: ${relativePath}`);
    await mkdir(dirname(targetFile), { recursive: true });
    await copyFile(sourceFile, targetFile);
  }
  return true;
}

/** 精确回收本次刚创建的任务 worktree；只在创建失败回滚或用户显式回收时调用。 */
export async function cleanupPreparedTaskWorktree(input: { repositoryPath: string; worktreePath: string; branchName: string; removeBranch: boolean }): Promise<void> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'Task workspace repository is unavailable during cleanup.');
  const targetPath = canonicalFilesystemPath(input.worktreePath);
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === targetPath);
  if (registered) await runGit(context.topLevel, ['worktree', 'remove', '--force', registered.path]);
  else await rm(input.worktreePath, { recursive: true, force: true });
  if (input.removeBranch && context.localBranches.includes(input.branchName)) await runGit(context.topLevel, ['branch', '-D', input.branchName]);
}

/** 汇总 IDEA 式提交窗口所需的 staged、unstaged、untracked 与冲突状态。 */
export async function getTaskWorkspaceReview(cwd: string, ignoredPaths: string[] = [], repositoryContext?: GitRepositoryContext): Promise<TaskWorkspaceReview> {
  const context = repositoryContext ?? (await getGitRepositoryContext(cwd));
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'Task workspace is not a Git repository.');
  const ignored = ignoredPaths.map((path) => requireSafeWorkspacePath(path));
  const isIgnored = (path: string): boolean => ignored.some((ignoredPath) => path === ignoredPath || path.startsWith(`${ignoredPath}/`));
  const diffPathspec = ['.', ...ignored.flatMap((path) => [`:(exclude)${path}`, `:(exclude)${path}/**`])];
  // Porcelain 的前两列包含有意义的空格，不能经过通用 splitLines 的 trim。
  const porcelainPromise = runGit(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall', '--', ...diffPathspec]).then((result) => result.stdout);
  const upstreamPromise = readGitStdout(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then((value) => value || null);
  const unstagedStatPromise = runGit(cwd, ['diff', '--numstat', '-z', '--', ...diffPathspec]).then((result) => result.stdout);
  const stagedStatPromise = runGit(cwd, ['diff', '--cached', '--numstat', '-z', '--', ...diffPathspec]).then((result) => result.stdout);
  /** 尚未结束的合并用于标识当前冲突现场，不能把已暂存等同于已合入。 */
  const mergeHeadPromise = readGitStdout(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  const [porcelain, upstream, unstagedStat, stagedStat, mergeHeadSha] = await Promise.all([porcelainPromise, upstreamPromise, unstagedStatPromise, stagedStatPromise, mergeHeadPromise]);
  const fileStatuses = parseGitPorcelainEntries(porcelain).filter((file) => !isIgnored(file.path) && (!file.originalPath || !isIgnored(file.originalPath)));
  const counts = upstream ? parseAheadBehind(await readGitStdout(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])) : { ahead: 0, behind: 0 };
  const stagedFiles = fileStatuses.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?');
  const unstagedFiles = fileStatuses.filter((file) => file.workingTreeStatus !== ' ' && file.workingTreeStatus !== '?');
  const untrackedFiles = fileStatuses.filter((file) => file.indexStatus === '?' && file.workingTreeStatus === '?');
  return {
    cwd: resolve(cwd),
    branch: context.branch,
    headSha: context.headSha,
    mergeHeadSha: mergeHeadSha || null,
    upstream,
    ...counts,
    clean: fileStatuses.length === 0,
    conflictFiles: fileStatuses.filter((file) => file.category === 'conflict').map((file) => file.path),
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    stagedDiff: gitDiffStatSummary(stagedStat, stagedFiles),
    unstagedDiff: gitDiffStatSummary(unstagedStat, unstagedFiles),
  };
}

/** 只读取工作区是否干净，避免为能力列表生成完整差异。 */
export async function getGitWorktreeClean(cwd: string, ignoredPaths: string[] = []): Promise<boolean> {
  const ignored = ignoredPaths.map((path) => requireSafeWorkspacePath(path));
  return readRepositoryClean(cwd, ignored, fileHistoryRuntime());
}

function gitDiffStatSummary(stdout: string, statuses: GitFileStatus[]): GitDiffSummary {
  const statusByPath = new Map(statuses.map((status) => [status.path, status]));
  const fileDiffs = parseGitNumStat(stdout).map((entry): GitFileDiff => {
    const status = statusByPath.get(entry.path);
    const changeType: GitDiffFileChangeType = status?.category === 'added' || status?.category === 'deleted' || status?.category === 'renamed' ? status.category : 'modified';
    const originalPath = entry.originalPath ?? status?.originalPath;
    return {
      oldPath: changeType === 'added' ? '' : (originalPath ?? entry.path),
      newPath: changeType === 'deleted' ? '' : entry.path,
      changeType,
      addedLines: entry.additions,
      deletedLines: entry.deletions,
      hunks: [],
    };
  });
  return { isRepository: true, files: fileDiffs.map((file) => file.newPath || file.oldPath), diffText: '', fileDiffs };
}

function parseGitNumStat(stdout: string, strict = false): Array<{ path: string; originalPath?: string; additions: number; deletions: number }> {
  const invalid = () => gitCoreError('ASTRAGIT_GIT_DIFF_READ_FAILED', 'Git 返回的变更文件统计不完整，请重新载入。');
  if (strict && stdout && !stdout.endsWith('\0')) throw invalid();
  const records = stdout.split('\0');
  const entries: Array<{ path: string; originalPath?: string; additions: number; deletions: number }> = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (!record) continue;
    const firstTab = record.indexOf('\t');
    const secondTab = firstTab >= 0 ? record.indexOf('\t', firstTab + 1) : -1;
    if (firstTab < 0 || secondTab < 0) { if (strict) throw invalid(); continue; }
    if (strict && (!/^(?:[0-9]+|-)$/u.test(record.slice(0, firstTab)) || !/^(?:[0-9]+|-)$/u.test(record.slice(firstTab + 1, secondTab)))) throw invalid();
    const additions = Number.parseInt(record.slice(0, firstTab), 10);
    const deletions = Number.parseInt(record.slice(firstTab + 1, secondTab), 10);
    const inlinePath = record.slice(secondTab + 1);
    if (inlinePath) {
      entries.push({ path: inlinePath, additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 });
      continue;
    }
    const originalPath = records[++index] ?? '';
    const path = records[++index] ?? originalPath;
    if (strict && (!originalPath || !path)) throw invalid();
    if (path) entries.push({ path, ...(originalPath && originalPath !== path ? { originalPath } : {}), additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 });
  }
  return entries;
}

/** 读取提交窗口当前文件的 HEAD 对比；未跟踪文件以 /dev/null 为旧版本。 */
export async function getTaskWorkspaceFileDiff(cwd: string, path: string): Promise<TaskWorkspaceFileDiff> {
  const safePath = requireSafeWorkspacePath(path);
  const review = await getTaskWorkspaceReview(cwd);
  const untracked = review.untrackedFiles.some((file) => file.path === safePath);
  /** orphan 分支首次提交前使用空提交比较，不能把不存在的 HEAD 当成错误。 */
  const baseline = review.headSha || (await createEmptyRootCommit(cwd));
  const diffText = untracked ? await readGitDiffAllowChanges(cwd, ['diff', '--no-index', '--binary', '--', '/dev/null', safePath]) : await readGitDiffAllowChanges(cwd, ['diff', baseline, '--binary', '--', safePath]);
  return { path: safePath, diff: diffSummaryFromText(diffText) };
}

/** 读取任务分支相对来源分支共同起点产生的已提交代码成果。 */
export async function getTaskBranchComparison(repositoryPath: string, sourceBranch: string, taskBranch: string, frozenSourceHeadSha?: string, repositoryContext?: GitRepositoryContext): Promise<TaskBranchComparison> {
  const context = repositoryContext ?? (await getGitRepositoryContext(repositoryPath));
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const [safeSourceBranch, safeTaskBranch] = await Promise.all([assertGitBranchFormat(context.topLevel, sourceBranch, 'source branch'), assertNamedBranchExists(context.topLevel, taskBranch, 'task branch')]);
  /** 显式空字符串表示任务从 unborn 来源开始；undefined 才表示读取当前来源分支。 */
  const sourceUnborn = frozenSourceHeadSha !== undefined && frozenSourceHeadSha.trim() === '';
  const sourceBranchRef = sourceUnborn
    ? await createEmptyRootCommit(context.topLevel)
    : frozenSourceHeadSha
      ? requireGitObjectId(frozenSourceHeadSha, 'source commit')
      : localBranchRef(await assertNamedBranchExists(context.topLevel, safeSourceBranch, 'source branch'));
  const taskBranchRef = localBranchRef(safeTaskBranch);
  const [resolvedSourceHeadSha, taskHeadSha] = await Promise.all([resolveCommit(context.topLevel, sourceBranchRef), resolveCommit(context.topLevel, taskBranchRef)]);
  /** 两个独立根提交没有 merge-base；空来源以确定性空提交直接比较任务历史。 */
  const [mergeBaseSha, rawCounts, numStat, nameStatus] = sourceUnborn
    ? await Promise.all([
        Promise.resolve(resolvedSourceHeadSha),
        requireGitStdout(context.topLevel, ['rev-list', '--count', taskBranchRef]).then((ahead) => `0 ${ahead}`),
        runGit(context.topLevel, ['diff', '--numstat', '-z', sourceBranchRef, taskBranchRef, '--', '.']).then((result) => result.stdout),
        runGit(context.topLevel, ['diff', '--name-status', '-z', sourceBranchRef, taskBranchRef, '--', '.']).then((result) => result.stdout),
      ])
    : await Promise.all([
        requireGitStdout(context.topLevel, ['merge-base', sourceBranchRef, taskBranchRef]),
        readGitStdout(context.topLevel, ['rev-list', '--left-right', '--count', `${sourceBranchRef}...${taskBranchRef}`]),
        runGit(context.topLevel, ['diff', '--numstat', '-z', `${sourceBranchRef}...${taskBranchRef}`, '--', '.']).then((result) => result.stdout),
        runGit(context.topLevel, ['diff', '--name-status', '-z', `${sourceBranchRef}...${taskBranchRef}`, '--', '.']).then((result) => result.stdout),
      ]);
  const counts = sourceUnborn ? { ahead: Number.parseInt(rawCounts.split(/\s+/u)[1] ?? '0', 10) || 0, behind: 0 } : parseAheadBehind(rawCounts);
  const statsByPath = new Map(parseGitNumStat(numStat).map((entry) => [entry.path, entry]));
  const files = parseGitNameStatus(nameStatus).map((entry) => {
    const stats = statsByPath.get(entry.path);
    return {
      path: entry.path,
      ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
      changeType: entry.changeType,
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
    };
  });
  return {
    sourceBranch: safeSourceBranch,
    taskBranch: safeTaskBranch,
    sourceHeadSha: sourceUnborn ? '' : resolvedSourceHeadSha,
    taskHeadSha,
    mergeBaseSha,
    ...counts,
    files,
  };
}

function parseGitNameStatus(stdout: string): Array<{ path: string; originalPath?: string; changeType: GitDiffFileChangeType }> {
  const records = stdout.split('\0');
  const entries: Array<{ path: string; originalPath?: string; changeType: GitDiffFileChangeType }> = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++] ?? '';
    if (!status) continue;
    const code = status[0] ?? 'M';
    if (code === 'R' || code === 'C') {
      const originalPath = records[index++] ?? '';
      const path = records[index++] ?? '';
      if (path) entries.push({ path, ...(originalPath ? { originalPath } : {}), changeType: code === 'R' ? 'renamed' : 'copied' });
      continue;
    }
    const path = records[index++] ?? '';
    if (!path) continue;
    const changeType: GitDiffFileChangeType = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified';
    entries.push({ path, changeType });
  }
  return entries;
}

/** 读取任务分支单个文件的已提交差异，不依赖任务 worktree 是否仍然存在。 */
export async function getTaskBranchFileDiff(repositoryPath: string, sourceBranch: string, taskBranch: string, path: string, frozenSourceHeadSha?: string): Promise<TaskWorkspaceFileDiff> {
  const safePath = requireSafeWorkspacePath(path);
  const comparison = await getTaskBranchComparison(repositoryPath, sourceBranch, taskBranch, frozenSourceHeadSha);
  const diffText = await readGitDiffAllowChanges(repositoryPath, ['diff', '--binary', `${comparison.mergeBaseSha}..${comparison.taskHeadSha}`, '--', safePath]);
  return { path: safePath, diff: diffSummaryFromText(diffText) };
}

/** 读取本地命名分支提交，供服务端建立合入并发基线。 */
export async function getGitBranchHead(repositoryPath: string, branchName: string, repositoryContext?: GitRepositoryContext): Promise<string> {
  const context = repositoryContext ?? (await getGitRepositoryContext(repositoryPath));
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const safeBranch = await assertNamedBranchExists(context.topLevel, branchName);
  return resolveCommit(context.topLevel, localBranchRef(safeBranch));
}

/**
 * 代码交付前让冲突处理开发线同时包含最新来源分支和原任务分支。
 * 新冲突保留在当前命名 worktree，交回原会话继续处理。
 */
export async function refreshConflictTaskWorkspace(input: { cwd: string; sourceBranch: string; taskBranch: string }): Promise<{ headSha: string; conflictFiles: string[]; updatedBranch: string | null }> {
  const review = await getTaskWorkspaceReview(input.cwd);
  if (review.branch === 'detached') throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DETACHED', 'Conflict workspace must stay on a named branch.');
  if (review.conflictFiles.length > 0) return { headSha: review.headSha, conflictFiles: review.conflictFiles, updatedBranch: null };
  if (!review.clean) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DIRTY', 'Commit or discard every conflict workspace change before refreshing its branches.');

  for (const branch of [input.sourceBranch, input.taskBranch]) {
    const safeBranch = await assertNamedBranchExists(input.cwd, branch);
    const branchHeadSha = await resolveCommit(input.cwd, localBranchRef(safeBranch));
    if (await gitCommitIsAncestor(input.cwd, branchHeadSha, 'HEAD')) continue;
    try {
      await runGit(input.cwd, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', branchHeadSha]);
    } catch (error) {
      const conflictFiles = await readTaskIntegrationConflictPaths(input.cwd);
      if (conflictFiles.length === 0) throw error;
      return { headSha: await resolveCommit(input.cwd, 'HEAD'), conflictFiles, updatedBranch: safeBranch };
    }
  }
  return { headSha: await resolveCommit(input.cwd, 'HEAD'), conflictFiles: [], updatedBranch: null };
}

/**
 * 刷新一个明确远端并返回该次刷新后的分支快照。
 * 刷新失败必须由调用方阻断当前动作，不能继续使用旧的远端跟踪引用。
 */
export async function fetchGitRemote(
  cwd: string,
  remoteName: string,
): Promise<{
  remoteName: string;
  branches: string[];
}> {
  const remote = requireSafeGitRef(remoteName, 'remote');
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  if (!context.remotes.includes(remote)) throw gitCoreError('ASTRAGIT_TASK_GIT_REMOTE_UNAVAILABLE', `Git remote is not configured: ${remote}`);
  try {
    await execFileAsync('git', ['fetch', '--prune', '--no-tags', remote, `+refs/heads/*:refs/remotes/${remote}/*`], {
      cwd: context.topLevel,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to refresh ${remote}.`;
    throw gitCoreError('ASTRAGIT_GIT_REMOTE_REFRESH_FAILED', message);
  }
  const refreshed = await getGitRepositoryContext(context.topLevel);
  return {
    remoteName: remote,
    branches: refreshed.remoteBranches.filter((ref) => ref.startsWith(`${remote}/`)),
  };
}

/** 读取已经刷新到本机的远端跟踪分支提交；不会再次访问网络。 */
export async function getRemoteTrackingBranchHead(cwd: string, remoteName: string, remoteBranch: string): Promise<string | null> {
  const remote = requireSafeGitRef(remoteName, 'remote');
  const branch = await assertGitBranchFormat(cwd, remoteBranch, 'remote branch');
  return readCommitIfPresent(cwd, `refs/remotes/${remote}/${branch}`);
}

/**
 * 先整理用户选中的路径，再应用到 index 并创建本地提交。
 * 该函数不会选择文件、猜测提交说明、访问远端或静默合并来源分支。
 */
export async function commitTaskWorkspace(input: CommitTaskWorkspaceInput): Promise<CommitTaskWorkspaceResult> {
  /** 提交前重新读取文件状态，不把页面打开时的路径当作当前事实。 */
  const review = await getTaskWorkspaceReview(input.cwd, input.ignoredPaths);
  if (review.branch === 'detached') throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DETACHED', 'Task workspace is detached and cannot be committed.');
  if (review.conflictFiles.length > 0) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_CONFLICTED', `提交尚未开始，请先处理并确认以下冲突文件：${review.conflictFiles.join('、')}`);
  /** 共享目录和子仓库仍由各自的工作区负责提交。 */
  const ignored = (input.ignoredPaths ?? []).map((path) => requireSafeWorkspacePath(path));
  /** 用户勾选的是当前文件名，保留特殊字符并去重。 */
  const selectedPaths = [...new Set(input.selectedPaths.map((path) => requireSafeWorkspacePath(path)))];
  /** 同一文件可以同时存在暂存和未暂存修改。 */
  const filesByPath = new Map([...review.stagedFiles, ...review.unstagedFiles, ...review.untrackedFiles].map((file) => [file.path, file]));
  /** 已消失或已提交的选择必须在格式化和暂存前明确拒绝。 */
  const stalePaths = selectedPaths.filter((path) => !filesByPath.has(path));
  /** 重命名必须同时提交旧路径的删除，复制操作则不包含来源文件。 */
  const paths = [
    ...new Set(
      selectedPaths.flatMap((path) => {
        /** 使用本次读取的 Git 重命名关系，不接受前端自行指定来源路径。 */
        const file = filesByPath.get(path);
        return file?.originalPath && (file.indexStatus === 'R' || file.workingTreeStatus === 'R') ? [requireSafeWorkspacePath(file.originalPath), path] : [path];
      }),
    ),
  ];
  if (paths.some((path) => ignored.some((ignoredPath) => path === ignoredPath || path.startsWith(`${ignoredPath}/`)))) {
    throw gitCoreError('ASTRAGIT_TASK_GIT_PATH_INVALID', 'Shared paths and nested repositories cannot be committed from their parent workspace.');
  }
  if (stalePaths.length > 0) throw gitCoreError('ASTRAGIT_TASK_COMMIT_SELECTION_CHANGED', `所选文件状态已变化，本次未提交。请刷新代码交付页后重新选择：${stalePaths.join(', ')}`);
  // 重命名旧位置若又出现文件，按路径提交会夹带其内容，必须先让用户明确选择。
  for (const path of paths.filter((path) => !selectedPaths.includes(path))) {
    /** 仅不存在的旧路径可以随重命名自动纳入删除；读取失败不能当作不存在。 */
    const entry = await lstat(resolve(input.cwd, path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry) throw gitCoreError('ASTRAGIT_TASK_COMMIT_SELECTION_CHANGED', `重命名来源位置又出现文件，本次未提交。请刷新并确认是否同时选择：${path}`);
  }
  /** 合并提交仍要求完整选择，且先校验再改写文件。 */
  const mergeHeadSha = await readGitStdout(input.cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (mergeHeadSha) {
    /** 展开的重命名路径也属于本次选择。 */
    const selected = new Set(paths);
    /** 沿用父仓库的共享目录排除规则。 */
    const mergePaths = [...review.stagedFiles, ...review.unstagedFiles, ...review.untrackedFiles].map((file) => file.path).filter((path) => !ignored.some((ignoredPath) => path === ignoredPath || path.startsWith(`${ignoredPath}/`)));
    /** 缺少任一修改时，不开始格式化或暂存。 */
    const omitted = mergePaths.filter((path) => !selected.has(path));
    if (omitted.length > 0) {
      throw gitCoreError('ASTRAGIT_TASK_MERGE_COMMIT_INCOMPLETE', `Merge commits must include every changed path: ${omitted.join(', ')}`);
    }
  }
  /** 已暂存删除的路径不再属于 index，不能再次 git add；仍保留在提交范围中。 */
  const stagePaths = paths.length > 0 ? splitNullRecords((await runGit(input.cwd, ['--literal-pathspecs', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...paths])).stdout) : [];
  /** 只整理用户选择的现存文件，不格式化重命名来源处可能重新创建的文件。 */
  const formattedPaths = await formatTaskCommitPaths(input.cwd, selectedPaths);
  // 来源目录里的暂存改动可能先被带入 worktree；共享目录和子仓库必须从父仓 index 中明确退出。
  if (ignored.length > 0 && review.headSha) await runGit(input.cwd, ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...ignored]);
  if (stagePaths.length > 0) await runGit(input.cwd, ['--literal-pathspecs', 'add', '-A', '--', ...stagePaths]);
  /** 从暂存结果确定最终路径；关闭重命名折叠以保留两端，排除新增后又删除的空变化。 */
  const stagedNames = paths.length > 0 ? splitNullRecords((await runGit(input.cwd, ['--literal-pathspecs', 'diff', '--cached', '--name-only', '--no-renames', '-z', '--', ...paths])).stdout) : [];
  /** 仅在 Git 提交成功返回后标记完成。 */
  let committed = false;
  if (mergeHeadSha) {
    // 合并提交不能按路径局部提交；即使冲突全部选择来源侧而没有净差异，也必须结束 MERGE_HEAD。
    await runGit(input.cwd, ['commit', '-m', requireSafeGitText(input.message, 'commit message')]);
    committed = true;
  } else if (stagedNames.length > 0) {
    // 只提交用户本次选中的路径；其他预先暂存的改动继续留在 index，不得绕过本次门禁混入提交。
    await runGit(input.cwd, ['--literal-pathspecs', 'commit', '-m', requireSafeGitText(input.message, 'commit message'), '--', ...stagedNames]);
    committed = true;
  }

  /** 返回真实分支提交，供上层更新交付状态。 */
  const headSha = await resolveCommit(input.cwd, 'HEAD');
  return { branch: review.branch, headSha, committed, formattedPaths };
}

/**
 * 只把任务开发线当前 HEAD 推送到记录的远端分支。
 * 该函数不读取或写入 index，也不会把未提交和已暂存改动带入远端。
 */
export async function pushTaskWorkspace(input: PushTaskWorkspaceInput): Promise<PushTaskWorkspaceResult> {
  const review = await getTaskWorkspaceReview(input.cwd, input.ignoredPaths);
  if (review.branch === 'detached') throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DETACHED', 'Task workspace is detached and cannot be pushed.');
  if (review.conflictFiles.length > 0) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_CONFLICTED', 'Resolve all conflicts before pushing.');

  const headSha = review.headSha;
  const remoteName = requireSafeGitRef(input.remoteName || 'origin', 'remote');
  const remoteBranch = await assertGitBranchFormat(input.cwd, input.remoteBranch || review.branch, 'remote branch');
  const remoteHeadSha = await pushBranchHead(input.cwd, remoteName, remoteBranch, headSha);
  return { branch: review.branch, headSha, remoteName, remoteBranch, remoteHeadSha };
}

/** 推送明确的本地命名分支；任务分支与合入后的来源分支共用同一套非强制保护。 */
export async function pushLocalBranch(input: PushLocalBranchInput): Promise<PushTaskWorkspaceResult> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const branch = await assertNamedBranchExists(context.topLevel, input.branchName, 'local branch');
  const headSha = await resolveCommit(context.topLevel, localBranchRef(branch));
  const remoteName = requireSafeGitRef(input.remoteName, 'remote');
  const remoteHeadSha = await pushBranchHead(context.topLevel, remoteName, branch, headSha);
  return { branch, headSha, remoteName, remoteBranch: branch, remoteHeadSha };
}

/** 刷新并校验指定远端分支后执行普通推送；远端领先或分叉时拒绝覆盖。 */
async function pushBranchHead(cwd: string, remoteName: string, remoteBranch: string, headSha: string): Promise<string> {
  await fetchGitRemote(cwd, remoteName);
  const trackingRef = `refs/remotes/${remoteName}/${remoteBranch}`;
  const remoteHeadBeforePush = await readCommitIfPresent(cwd, trackingRef);
  if (remoteHeadBeforePush && remoteHeadBeforePush !== headSha) {
    const { remoteOnly } = await compareCommits(cwd, remoteHeadBeforePush, headSha);
    if (remoteOnly > 0) {
      throw gitCoreError('ASTRAGIT_TASK_REMOTE_DIVERGED', `Remote branch ${remoteName}/${remoteBranch} contains commits that are not in local HEAD.`);
    }
  }
  try {
    await runGit(cwd, ['push', remoteName, `${headSha}:refs/heads/${remoteBranch}`]);
  } catch (error) {
    await fetchGitRemote(cwd, remoteName);
    const latestRemoteHead = await readCommitIfPresent(cwd, trackingRef);
    if (latestRemoteHead && latestRemoteHead !== headSha) {
      const { remoteOnly } = await compareCommits(cwd, latestRemoteHead, headSha);
      if (remoteOnly > 0) throw gitCoreError('ASTRAGIT_TASK_REMOTE_DIVERGED', `Remote branch ${remoteName}/${remoteBranch} advanced before the push completed.`);
    }
    throw error;
  }
  const remoteHeadSha = await readRemoteHead(cwd, remoteName, remoteBranch);
  if (remoteHeadSha !== headSha) {
    throw gitCoreError('ASTRAGIT_TASK_REMOTE_VERIFICATION_FAILED', `Remote ${remoteName}/${remoteBranch} does not match local HEAD after push.`);
  }
  return remoteHeadSha;
}

/** 仅当工作区干净且本地命名分支保留完整提交时回收目录；不依赖远端。 */
export async function reclaimTaskWorktree(input: {
  repositoryPath: string;
  worktreePath: string;
  remoteName: string;
  remoteBranch: string;
  sourceHeadSha: string;
  ignoredPaths?: string[];
}): Promise<{ headSha: string; remoteHeadSha: string | null; unchanged: boolean }> {
  const review = await getTaskWorkspaceReview(input.worktreePath, input.ignoredPaths);
  if (!review.clean) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DIRTY', 'Task worktree still contains uncommitted changes.');
  const unchanged = review.headSha === input.sourceHeadSha;
  const context = await getGitRepositoryContext(input.repositoryPath);
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.worktreePath));
  if (!registered) throw gitCoreError('ASTRAGIT_TASK_WORKTREE_NOT_REGISTERED', 'Task worktree is not registered in the project repository.');
  /** 未产生任何文件的 orphan 任务没有分支引用，登记身份和空 HEAD 足以证明它仍未改变。 */
  const registeredHeadSha = registered.branch ? await readCommitIfPresent(context.topLevel, localBranchRef(registered.branch)) : null;
  const registeredUnborn = registered.branch === review.branch && !review.headSha && !input.sourceHeadSha;
  if (!registered.branch || (!registeredUnborn && registeredHeadSha !== review.headSha)) {
    throw gitCoreError('ASTRAGIT_TASK_LOCAL_BRANCH_UNAVAILABLE', '本地任务分支未完整保留当前提交，不能回收工作目录。');
  }
  await runGit(context.topLevel, ['worktree', 'remove', ...(input.ignoredPaths?.length ? ['--force'] : []), input.worktreePath]);
  await rm(input.worktreePath, { recursive: true, force: true });
  return { headSha: review.headSha, remoteHeadSha: null, unchanged };
}

/** 目标分支已完成交付后回收干净的任务 worktree；任务分支不要求存在远端副本。 */
export async function reclaimDeliveredTaskWorktree(input: { repositoryPath: string; worktreePath: string; ignoredPaths?: string[] }): Promise<{
  headSha: string;
}> {
  const review = await getTaskWorkspaceReview(input.worktreePath, input.ignoredPaths);
  if (!review.clean) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_DIRTY', 'Task worktree still contains uncommitted changes.');
  const context = await getGitRepositoryContext(input.repositoryPath);
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.worktreePath));
  if (!registered) throw gitCoreError('ASTRAGIT_TASK_WORKTREE_NOT_REGISTERED', 'Task worktree is not registered in the project repository.');
  await runGit(context.topLevel, ['worktree', 'remove', ...(input.ignoredPaths?.length ? ['--force'] : []), input.worktreePath]);
  await rm(input.worktreePath, { recursive: true, force: true });
  return { headSha: review.headSha };
}

/**
 * 任务进入终态时只移除物理 worktree，保留本地任务分支和远端分支。
 * 脏目录必须由调用方完成用户确认后显式传入 force，不能静默丢弃本机变化。
 */
export async function removeTaskWorktreeForTerminalStatus(input: { repositoryPath: string; worktreePath: string; force: boolean }): Promise<{ removed: boolean }> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.worktreePath));
  if (!registered) {
    const pathExists = await lstat(input.worktreePath).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      },
    );
    if (pathExists) throw gitCoreError('ASTRAGIT_TASK_WORKTREE_NOT_REGISTERED', 'Task worktree path exists but is not registered in the project repository.');
    return { removed: false };
  }
  await runGit(context.topLevel, ['worktree', 'remove', ...(input.force ? ['--force'] : []), registered.path]);
  await rm(registered.path, { recursive: true, force: true });
  return { removed: true };
}

/**
 * 明确放弃任务分支时删除 worktree 与本地分支。
 * 不删除远端分支，避免把本机任务处置扩散为远端不可逆动作。
 */
export async function discardTaskWorktree(input: {
  repositoryPath: string;
  worktreePath: string | null;
  branchName: string;
  confirmationText: string;
}): Promise<{ branchName: string; removedWorktree: boolean; removedLocalBranch: boolean }> {
  if (input.confirmationText !== input.branchName) throw gitCoreError('ASTRAGIT_TASK_DISCARD_CONFIRMATION_INVALID', 'Type the exact task branch name to discard it.');
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  let removedWorktree = false;
  const registered = context.worktrees.find((entry) => entry.branch === input.branchName || (input.worktreePath && canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.worktreePath)));
  if (registered) {
    await runGit(context.topLevel, ['worktree', 'remove', '--force', registered.path]);
    await rm(registered.path, { recursive: true, force: true });
    removedWorktree = true;
  }
  const refreshed = await getGitRepositoryContext(context.topLevel);
  const removedLocalBranch = refreshed.localBranches.includes(input.branchName);
  if (removedLocalBranch) await runGit(context.topLevel, ['branch', '-D', input.branchName]);
  return { branchName: input.branchName, removedWorktree, removedLocalBranch };
}

/**
 * 从冻结基础提交创建或恢复数字团队内部候选，并按给定顺序合入精确上游提交。
 * 该能力只维护独立候选分支和 worktree，不更新目标分支、不推送，也不触发正式交付。
 */
export async function prepareWorkflowCandidate(input: PrepareWorkflowCandidateInput): Promise<PreparedWorkflowCandidate> {
  /** 真实仓库上下文用于约束候选分支和 worktree 身份。 */
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  /** 候选分支沿用 AstraGit 任务分支命名边界，避免接管普通业务分支。 */
  const branchName = await assertValidGitBranchName(context.topLevel, input.branchName);
  /** 候选身份必须生成非空目录段，防止多个无效身份落到同一路径。 */
  const candidateSegment = safePathSegment(input.candidateId);
  if (!candidateSegment) throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_ID_INVALID', 'Workflow candidate ID must contain a safe path segment.');
  /** 基础提交只接受并解析调用方冻结的完整对象 ID。 */
  const baseSha = await resolveCommit(context.topLevel, requireGitObjectId(input.baseSha, 'workflow candidate base'));
  /** 上游提交逐项解析为仓库中的真实提交，同时保留调用方给定顺序。 */
  const upstreamCommitShas = await Promise.all(input.upstreamCommitShas.map((sha, index) => resolveCommit(context.topLevel, requireGitObjectId(sha, `workflow candidate upstream ${index + 1}`))));
  /** 候选目录完全由仓库、项目和候选身份决定，重启后不会漂移。 */
  const worktreePath = join(dirname(context.topLevel), '.astragit-worktrees', safePathSegment(input.projectSlug || basename(context.topLevel)), '.workflow-candidates', candidateSegment);
  /** 同一路径只能属于当前候选分支。 */
  const registeredByPath = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(worktreePath));
  /** 同一候选分支只能绑定当前稳定路径。 */
  const registeredByBranch = context.worktrees.find((entry) => entry.branch === branchName);
  if (registeredByPath && (registeredByPath.detached || registeredByPath.branch !== branchName)) {
    throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_WORKTREE_MISMATCH', 'Workflow candidate path is registered to another branch or a detached worktree.');
  }
  if (registeredByBranch && canonicalFilesystemPath(registeredByBranch.path) !== canonicalFilesystemPath(worktreePath)) {
    throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_WORKTREE_MISMATCH', 'Workflow candidate branch is registered at another worktree path.');
  }
  /** 已存在的候选分支或登记工作区均视为恢复，不重新创建提交。 */
  const reused = Boolean(registeredByPath || registeredByBranch || context.localBranches.includes(branchName));

  if (!registeredByPath) {
    /** 未登记目录只能是不存在或空目录，任何现有文件都原样保留并拒绝接管。 */
    const existingPath = await lstat(worktreePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existingPath && (!existingPath.isDirectory() || existingPath.isSymbolicLink() || (await readdir(worktreePath)).length > 0)) {
      throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_PATH_OCCUPIED', `候选工作目录已有未登记内容，已保留原文件：${worktreePath}`);
    }
    /** Git worktree add 要求目标目录不存在；这里只移除已确认的空普通目录。 */
    if (existingPath) await rm(worktreePath, { recursive: true });
    await mkdir(dirname(worktreePath), { recursive: true });
    if (context.localBranches.includes(branchName)) await runGit(context.topLevel, ['worktree', 'add', worktreePath, branchName]);
    else await runGit(context.topLevel, ['worktree', 'add', '-b', branchName, worktreePath, baseSha]);
  }

  /** worktree 必须仍附着于持久化候选分支，不能在恢复期间变成游离 HEAD。 */
  const activeBranch = await requireGitStdout(worktreePath, ['branch', '--show-current']);
  if (activeBranch !== branchName) throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_BRANCH_MISMATCH', 'Workflow candidate worktree is not attached to its recorded branch.');

  /** 未完成 merge 的另一端必须正好是有序输入中的下一项。 */
  const mergeHeadSha = await readGitStdout(worktreePath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (mergeHeadSha) {
    /** 既有第一父链决定本次应恢复哪一个上游提交。 */
    const nextIndex = await readWorkflowCandidateProgress(worktreePath, baseSha, upstreamCommitShas);
    if (nextIndex >= upstreamCommitShas.length || mergeHeadSha !== upstreamCommitShas[nextIndex]) {
      throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_INPUT_MISMATCH', 'Workflow candidate merge state does not match its frozen upstream commits.');
    }
    /** 未解决冲突保持 Git 原始现场，等待显式处理。 */
    const conflictFiles = await readTaskIntegrationConflictPaths(worktreePath);
    if (conflictFiles.length > 0) {
      return { topLevel: context.topLevel, worktreePath, branchName, baseSha, upstreamCommitShas, candidateSha: null, state: 'conflicted', conflictFiles, reused };
    }
    /** 冲突已全部暂存后完成原 merge；额外未暂存或未跟踪文件不得混入候选。 */
    const review = await getTaskWorkspaceReview(worktreePath);
    if (review.unstagedFiles.length > 0 || review.untrackedFiles.length > 0) {
      throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_DIRTY', 'Workflow candidate contains changes outside the recorded merge resolution.');
    }
    await runGit(worktreePath, ['commit', '--no-edit']);
  } else if (!(await getGitWorktreeClean(worktreePath))) {
    throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_DIRTY', 'Workflow candidate contains uncommitted changes outside a recorded merge.');
  }

  /** 每轮重新读取已完成前缀，既能跳过祖先提交，也能从进程中断点继续。 */
  let nextIndex = await readWorkflowCandidateProgress(worktreePath, baseSha, upstreamCommitShas);
  while (nextIndex < upstreamCommitShas.length) {
    /** 当前轮只合入有序输入中的一个精确提交。 */
    const upstreamCommitSha = upstreamCommitShas[nextIndex]!;
    /** 候选已核对内容干净；合并阶段忽略易抖动的亚秒级文件元数据，避免新工作区被 Git 误判为需要 stash。 */
    await runGitPreservingConflict(worktreePath, ['-c', 'core.checkStat=minimal', '-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', upstreamCommitSha]);
    /** Git 报冲突时直接返回，绝不自动清理或切换输入。 */
    const conflictFiles = await readTaskIntegrationConflictPaths(worktreePath);
    if (conflictFiles.length > 0) {
      return { topLevel: context.topLevel, worktreePath, branchName, baseSha, upstreamCommitShas, candidateSha: null, state: 'conflicted', conflictFiles, reused };
    }
    nextIndex = await readWorkflowCandidateProgress(worktreePath, baseSha, upstreamCommitShas);
  }

  /** 最终候选 SHA 只来自隔离分支 HEAD，不同步任何目标引用。 */
  const candidateSha = await resolveCommit(worktreePath, 'HEAD');
  return { topLevel: context.topLevel, worktreePath, branchName, baseSha, upstreamCommitShas, candidateSha, state: 'ready', conflictFiles: [], reused };
}

/**
 * 按第一父链校验候选是否严格由基础提交和有序上游提交生成，并返回下一项输入位置。
 * 非候选提交、乱序提交或不同输入生成的旧分支都会被拒绝恢复。
 */
async function readWorkflowCandidateProgress(cwd: string, baseSha: string, upstreamCommitShas: string[]): Promise<number> {
  /** 当前候选分支头用于界定已经形成的第一父链。 */
  const headSha = await resolveCommit(cwd, 'HEAD');
  if (!(await gitCommitIsAncestor(cwd, baseSha, headSha))) {
    throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_BASE_MISMATCH', 'Workflow candidate is not based on its frozen base commit.');
  }
  /** 正序第一父提交应当逐个对应本能力创建的双亲 merge。 */
  const firstParentCommits = splitLines(await readGitStdout(cwd, ['rev-list', '--first-parent', '--reverse', `${baseSha}..${headSha}`]));
  /** 已验证候选链的游标从冻结基础提交开始。 */
  let cursorSha = baseSha;
  /** 第一父提交游标与上游输入游标分离，祖先输入不会生成多余提交。 */
  let historyIndex = 0;
  for (let upstreamIndex = 0; upstreamIndex < upstreamCommitShas.length; upstreamIndex += 1) {
    /** 当前有序上游提交必须保持调用方冻结的精确对象身份。 */
    const upstreamCommitSha = upstreamCommitShas[upstreamIndex]!;
    if (await gitCommitIsAncestor(cwd, upstreamCommitSha, cursorSha)) continue;
    /** 第一父链耗尽表示应从当前上游输入继续执行。 */
    const mergeCommitSha = firstParentCommits[historyIndex];
    if (!mergeCommitSha) return upstreamIndex;
    /** 候选 merge 必须只有“前一候选 + 当前精确上游”两个父提交。 */
    const parents = (await requireGitStdout(cwd, ['show', '-s', '--format=%P', mergeCommitSha])).split(/\s+/u).filter(Boolean);
    if (parents.length !== 2 || parents[0] !== cursorSha || parents[1] !== upstreamCommitSha) {
      throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_INPUT_MISMATCH', 'Workflow candidate history does not match its frozen upstream commit order.');
    }
    cursorSha = mergeCommitSha;
    historyIndex += 1;
  }
  if (historyIndex !== firstParentCommits.length || cursorSha !== headSha) {
    throw gitCoreError('ASTRAGIT_WORKFLOW_CANDIDATE_INPUT_MISMATCH', 'Workflow candidate contains commits outside its frozen upstream inputs.');
  }
  return upstreamCommitShas.length;
}

/**
 * 在隔离 worktree 内执行任务分支合入。无冲突时只产出候选结果，
 * 最终更新来源分支前仍需调用 finalizeTaskBranchIntegration 重新校验主工作区。
 */
export async function startTaskBranchIntegration(input: {
  repositoryPath: string;
  projectSlug: string;
  integrationId: string;
  targetBranch: string;
  targetRef?: string;
  taskBranch: string;
  mode: 'merge' | 'squash';
  commitMessage: string;
}): Promise<TaskBranchIntegrationStartResult> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const [targetBranch, taskBranch] = await Promise.all([assertGitBranchFormat(context.topLevel, input.targetBranch, 'target branch'), assertNamedBranchExists(context.topLevel, input.taskBranch, 'task branch')]);
  /** 当前检出的 unborn 分支是合法首次交付目标，不能用 show-ref 存在性把它排除。 */
  const targetRef = input.targetRef?.trim() || localBranchRef(targetBranch);
  const resolvedTargetHeadSha = await readCommitIfPresent(context.topLevel, targetRef);
  const targetUnborn = !resolvedTargetHeadSha && !input.targetRef?.trim() && !context.detached && !context.headSha && context.branch === targetBranch;
  if (!resolvedTargetHeadSha && !targetUnborn) throw gitCoreError('ASTRAGIT_GIT_BRANCH_NOT_FOUND', `Local branch does not exist: ${targetBranch}`);
  const targetHeadSha = resolvedTargetHeadSha ?? '';
  const taskHeadSha = await resolveCommit(context.topLevel, localBranchRef(taskBranch));
  const integrationPath = join(dirname(context.topLevel), '.astragit-worktrees', safePathSegment(input.projectSlug || basename(context.topLevel)), '.integration', safePathSegment(input.integrationId));
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(integrationPath));
  if (!registered) {
    await mkdir(dirname(integrationPath), { recursive: true });
    await runGit(context.topLevel, ['worktree', 'add', '--detach', integrationPath, targetUnborn ? taskHeadSha : targetHeadSha]);
  } else if (targetUnborn) {
    /** 重用首次交付候选时重新固定当前任务提交，避免旧现场返回过期结果。 */
    await runGit(integrationPath, ['reset', '--hard', taskHeadSha]);
  }
  /** 首次交付没有既有历史可合并；任务根提交本身就是唯一候选结果。 */
  if (targetUnborn) {
    return {
      integrationPath,
      targetBranch,
      targetHeadSha: '',
      taskBranch,
      taskHeadSha,
      mode: input.mode,
      state: 'ready',
      resultHeadSha: taskHeadSha,
      conflictFiles: [],
    };
  }
  try {
    if (input.mode === 'merge') {
      await runGit(integrationPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', taskHeadSha]);
    } else {
      await runGit(integrationPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--squash', taskHeadSha]);
      const staged = splitLines(await readGitStdout(integrationPath, ['diff', '--cached', '--name-only']));
      if (staged.length > 0) await runGit(integrationPath, ['commit', '-m', requireSafeGitText(input.commitMessage, 'commit message')]);
    }
  } catch (error) {
    const conflictFiles = await readTaskIntegrationConflictPaths(integrationPath);
    if (conflictFiles.length === 0) throw error;
    return {
      integrationPath,
      targetBranch,
      targetHeadSha,
      taskBranch,
      taskHeadSha,
      mode: input.mode,
      state: 'conflicted',
      resultHeadSha: null,
      conflictFiles,
    };
  }
  return {
    integrationPath,
    targetBranch,
    targetHeadSha,
    taskBranch,
    taskHeadSha,
    mode: input.mode,
    state: 'ready',
    resultHeadSha: await resolveCommit(integrationPath, 'HEAD'),
    conflictFiles: [],
  };
}

/** 为一次 AI 冲突处理创建独立命名分支和持久 worktree。 */
export async function startTaskIntegrationAttempt(input: {
  repositoryPath: string;
  projectSlug: string;
  integrationId: string;
  attemptId: string;
  targetBranch: string;
  targetHeadSha: string;
  taskBranch: string;
  taskHeadSha: string;
  conflictBranch: string;
  mode: 'merge' | 'squash';
  commitMessage: string;
  /** 来源草稿冲突需要从原隔离现场复制同一份快照。 */
  localChangesFromPath?: string;
}): Promise<TaskBranchIntegrationStartResult> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const targetBranch = await assertGitBranchFormat(context.topLevel, input.targetBranch, 'target branch');
  const taskBranch = await assertGitBranchFormat(context.topLevel, input.taskBranch, 'task branch');
  const conflictBranch = await assertGitBranchFormat(context.topLevel, input.conflictBranch, 'conflict branch');
  const targetHeadSha = await resolveCommit(context.topLevel, requireGitObjectId(input.targetHeadSha, 'target head'));
  const taskHeadSha = await resolveCommit(context.topLevel, requireGitObjectId(input.taskHeadSha, 'task head'));
  const integrationPath = join(dirname(context.topLevel), '.astragit-worktrees', safePathSegment(input.projectSlug || basename(context.topLevel)), '.integration-attempts', safePathSegment(input.integrationId), safePathSegment(input.attemptId));
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(integrationPath));
  if (registered) {
    if (registered.branch !== conflictBranch || registered.detached) {
      throw gitCoreError('ASTRAGIT_TASK_CONFLICT_BRANCH_MISMATCH', 'The conflict worktree is not attached to its recorded conflict branch.');
    }
    const [conflictFiles, localChanges] = await Promise.all([readTaskIntegrationConflictPaths(integrationPath), readTaskIntegrationLocalChangesState(integrationPath)]);
    return {
      integrationPath,
      targetBranch,
      targetHeadSha,
      taskBranch,
      taskHeadSha,
      mode: input.mode,
      state: conflictFiles.length > 0 ? 'conflicted' : 'ready',
      resultHeadSha: conflictFiles.length > 0 ? null : await resolveCommit(integrationPath, 'HEAD'),
      conflictFiles,
      localChangesConflict: Boolean(localChanges),
    };
  }
  await mkdir(dirname(integrationPath), { recursive: true });
  if (context.localBranches.includes(conflictBranch)) await runGit(context.topLevel, ['worktree', 'add', integrationPath, conflictBranch]);
  else await runGit(context.topLevel, ['worktree', 'add', '-b', conflictBranch, integrationPath, targetHeadSha]);
  try {
    if (input.mode === 'merge') {
      await runGit(integrationPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', taskHeadSha]);
    } else {
      await runGit(integrationPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--squash', taskHeadSha]);
      const staged = splitLines(await readGitStdout(integrationPath, ['diff', '--cached', '--name-only']));
      if (staged.length > 0) await runGit(integrationPath, ['commit', '-m', requireSafeGitText(input.commitMessage, 'commit message')]);
    }
  } catch (error) {
    const conflictFiles = await readTaskIntegrationConflictPaths(integrationPath);
    if (conflictFiles.length === 0) {
      await cleanupTaskIntegrationWorktree({ repositoryPath: context.topLevel, integrationPath }).catch(() => undefined);
      throw error;
    }
    return { integrationPath, targetBranch, targetHeadSha, taskBranch, taskHeadSha, mode: input.mode, state: 'conflicted', resultHeadSha: null, conflictFiles };
  }
  const resultHeadSha = await resolveCommit(integrationPath, 'HEAD');
  const localChanges = input.localChangesFromPath ? await readTaskIntegrationLocalChangesState(input.localChangesFromPath) : null;
  if (localChanges) {
    const conflictFiles = await prepareTaskIntegrationLocalChangesMerge(integrationPath, { ...localChanges, resultHeadSha });
    return {
      integrationPath,
      targetBranch,
      targetHeadSha,
      taskBranch,
      taskHeadSha,
      mode: input.mode,
      state: conflictFiles.length > 0 ? 'conflicted' : 'ready',
      resultHeadSha: conflictFiles.length > 0 ? null : resultHeadSha,
      conflictFiles,
      localChangesConflict: true,
    };
  }
  return {
    integrationPath,
    targetBranch,
    targetHeadSha,
    taskBranch,
    taskHeadSha,
    mode: input.mode,
    state: 'ready',
    resultHeadSha,
    conflictFiles: [],
  };
}

/** 以 NUL 分隔读取真实冲突路径，保留中文、引号和空白；查询失败时抛错，不能误报冲突已清空。 */
export async function readTaskIntegrationConflictPaths(cwd: string): Promise<string[]> {
  return splitNullRecords((await runGit(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout);
}

/** 读取三方冲突内容：source 是来源分支，task 是任务分支，result 是当前可编辑结果。 */
export async function readTaskIntegrationConflict(integrationPath: string, path: string): Promise<TaskIntegrationConflictFile> {
  const safePath = requireSafeWorkspacePath(path);
  const conflicts = await readTaskIntegrationConflictPaths(integrationPath);
  if (!conflicts.includes(safePath)) throw gitCoreError('ASTRAGIT_TASK_CONFLICT_NOT_FOUND', `Conflict file is no longer unresolved: ${safePath}`);
  const [base, second, third, result, localChanges] = await Promise.all([
    readGitStageText(integrationPath, 1, safePath),
    readGitStageText(integrationPath, 2, safePath),
    readGitStageText(integrationPath, 3, safePath),
    readWorkspaceText(integrationPath, safePath),
    readTaskIntegrationLocalChangesState(integrationPath),
  ]);
  /** 来源草稿叠加在任务成果上时，Git 的 ours/theirs 顺序与产品两栏相反。 */
  const source = localChanges ? third : second;
  /** 任务侧始终展示任务分支已经提交的结果。 */
  const task = localChanges ? second : third;
  const fingerprint = createHash('sha256').update(safePath).update('\0').update(base).update('\0').update(source).update('\0').update(task).digest('hex');
  return { path: safePath, fingerprint, base, source, task, result };
}

/** 保存用户确认后的中间结果并暂存；未解决的其他文件保持冲突态。 */
export async function writeTaskIntegrationResolution(integrationPath: string, path: string, content: string): Promise<{ path: string; remainingConflictFiles: string[] }> {
  const safePath = requireSafeWorkspacePath(path);
  if (content.includes('\0')) throw gitCoreError('ASTRAGIT_TASK_CONFLICT_BINARY_UNSUPPORTED', 'Binary conflict resolution is not supported in the text editor.');
  const absolutePath = resolve(integrationPath, safePath);
  if (!isPathInside(integrationPath, absolutePath)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Conflict path escapes the integration worktree: ${safePath}`);
  await writeFile(absolutePath, content, 'utf8');
  await runGit(integrationPath, ['add', '--', safePath]);
  const remainingConflictFiles = await readTaskIntegrationConflictPaths(integrationPath);
  return { path: safePath, remainingConflictFiles };
}

/** AI 接管前只把当前三栏草稿写入隔离工作区，保留未解决 marker，不暂存也不生成提交。 */
export async function writeTaskIntegrationDraft(integrationPath: string, path: string, content: string): Promise<{ path: string }> {
  const safePath = requireSafeWorkspacePath(path);
  if (content.includes('\0')) throw gitCoreError('ASTRAGIT_TASK_CONFLICT_BINARY_UNSUPPORTED', 'Binary conflict resolution is not supported in the text editor.');
  const absolutePath = resolve(integrationPath, safePath);
  if (!isPathInside(integrationPath, absolutePath)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Conflict path escapes the integration worktree: ${safePath}`);
  await writeFile(absolutePath, content, 'utf8');
  return { path: safePath };
}

/** 冲突全部解决后生成合入候选提交；仍有冲突时拒绝继续。 */
export async function completeTaskIntegrationCommit(input: { integrationPath: string; mode: 'merge' | 'squash'; commitMessage: string }): Promise<{ resultHeadSha: string }> {
  const conflicts = await readTaskIntegrationConflictPaths(input.integrationPath);
  if (conflicts.length > 0) throw gitCoreError('ASTRAGIT_TASK_WORKSPACE_CONFLICTED', 'Resolve every conflict before completing the integration commit.');
  const localChanges = await readTaskIntegrationLocalChangesState(input.integrationPath);
  if (localChanges) {
    // 来源草稿只形成最终工作区内容，不能被提交进目标分支历史。
    await runGit(input.integrationPath, ['add', '-A']);
    const mergeHead = await readGitStdout(input.integrationPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    if (mergeHead) await runGit(input.integrationPath, ['merge', '--quit']);
    const resultHeadSha = await resolveCommit(input.integrationPath, 'HEAD');
    if (resultHeadSha !== localChanges.resultHeadSha) throw gitCoreError('ASTRAGIT_TARGET_HEAD_CHANGED', 'Integration result changed while local source changes were being resolved.');
    return { resultHeadSha };
  }
  const mergeHead = await readGitStdout(input.integrationPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  const staged = splitLines(await readGitStdout(input.integrationPath, ['diff', '--cached', '--name-only']));
  if (mergeHead) {
    await runGit(input.integrationPath, ['commit', '--no-edit']);
  } else if (input.mode === 'squash' && staged.length > 0) {
    await runGit(input.integrationPath, ['commit', '-m', requireSafeGitText(input.commitMessage, 'commit message')]);
  }
  return { resultHeadSha: await resolveCommit(input.integrationPath, 'HEAD') };
}

/** 重新校验来源分支提交后只同步本地来源分支；远端推送由独立用户动作完成。 */
export async function finalizeTaskBranchIntegration(input: { repositoryPath: string; integrationPath: string; targetBranch: string; targetHeadSha: string; resultHeadSha: string }): Promise<FinalizedTaskBranchIntegration> {
  const targetBranch = await assertGitBranchFormat(input.repositoryPath, input.targetBranch, 'target branch');
  const resultHeadSha = requireGitObjectId(input.resultHeadSha, 'integration result');
  const targetHeadSha = await readCommitIfPresent(input.repositoryPath, localBranchRef(targetBranch));
  const resolvedTargetHeadSha = targetHeadSha ?? input.targetHeadSha;
  if (resolvedTargetHeadSha !== input.targetHeadSha) throw gitCoreError('ASTRAGIT_TARGET_HEAD_CHANGED', 'Target branch advanced while the integration was being prepared.');

  const localChanges = await readTaskIntegrationLocalChangesState(input.integrationPath);
  if (localChanges && (localChanges.targetHeadSha !== input.targetHeadSha || localChanges.resultHeadSha !== resultHeadSha)) {
    throw gitCoreError('ASTRAGIT_TASK_LOCAL_CHANGE_STATE_INVALID', 'Local source change snapshot does not match the recorded integration commits.');
  }
  const localSync = localChanges
    ? await finalizeTaskIntegrationLocalChanges({ repositoryPath: input.repositoryPath, integrationPath: input.integrationPath, targetBranch, state: localChanges })
    : input.targetHeadSha
      ? await syncLocalTargetBranch({
          repositoryPath: input.repositoryPath,
          integrationPath: input.integrationPath,
          targetBranch,
          targetHeadSha: input.targetHeadSha,
          resultHeadSha,
        })
      : await syncUnbornLocalTargetBranch({ repositoryPath: input.repositoryPath, targetBranch, resultHeadSha });
  // 本地来源分支暂时不安全时保留隔离合入结果，待用户清理原工作区后重试同步。
  if (localSync.localSyncStatus === 'synced') {
    const context = await getGitRepositoryContext(input.repositoryPath);
    const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.integrationPath));
    if (registered) {
      await runGit(context.topLevel, ['worktree', 'remove', input.integrationPath]);
      await rm(input.integrationPath, { recursive: true, force: true });
    }
  }
  return {
    targetBranch,
    targetHeadSha: input.targetHeadSha,
    resultHeadSha,
    remoteName: '',
    remoteHeadSha: null,
    ...localSync,
  };
}

/** 只回收已登记在 AstraGit worktree 容器内的临时合入目录。 */
export async function cleanupTaskIntegrationWorktree(input: { repositoryPath: string; integrationPath: string }): Promise<boolean> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected project is not a Git repository.');
  const integrationPath = resolve(input.integrationPath);
  const containerRoot = resolve(join(dirname(context.topLevel), '.astragit-worktrees'));
  if (!isPathInside(containerRoot, integrationPath)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', 'Integration worktree is outside the AstraGit worktree container.');
  const registered = context.worktrees.find((entry) => canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(integrationPath));
  if (!registered) return false;
  await runGit(context.topLevel, ['worktree', 'remove', '--force', integrationPath]);
  await rm(integrationPath, { recursive: true, force: true });
  return true;
}

/** 返回当前 worktree 私有 Git 目录中的来源草稿状态文件。 */
async function taskIntegrationLocalChangesStatePath(integrationPath: string): Promise<string> {
  const gitDirectory = await requireGitStdout(integrationPath, ['rev-parse', '--absolute-git-dir']);
  return join(gitDirectory, taskIntegrationLocalChangesStateName);
}

/** 读取并校验隔离现场的来源草稿快照状态。 */
async function readTaskIntegrationLocalChangesState(integrationPath: string): Promise<TaskIntegrationLocalChangesState | null> {
  const statePath = await taskIntegrationLocalChangesStatePath(integrationPath);
  const raw = await readFile(statePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TaskIntegrationLocalChangesState>;
    const sourceWorktreePath = typeof value.sourceWorktreePath === 'string' && isAbsolute(value.sourceWorktreePath) ? resolve(value.sourceWorktreePath) : '';
    const sourceUntrackedPaths = Array.isArray(value.sourceUntrackedPaths) ? value.sourceUntrackedPaths.map((path) => requireSafeWorkspacePath(String(path))) : null;
    if (!sourceWorktreePath || !sourceUntrackedPaths) throw new Error('来源工作区路径或未跟踪文件清单无效。');
    return {
      sourceWorktreePath,
      targetHeadSha: requireGitObjectId(value.targetHeadSha, 'local changes target head'),
      resultHeadSha: requireGitObjectId(value.resultHeadSha, 'local changes integration result'),
      sourceSnapshotCommitSha: requireGitObjectId(value.sourceSnapshotCommitSha, 'local changes snapshot commit'),
      sourceSnapshotTreeSha: requireGitObjectId(value.sourceSnapshotTreeSha, 'local changes snapshot tree'),
      sourceIndexTreeSha: requireGitObjectId(value.sourceIndexTreeSha, 'local changes index tree'),
      sourceUntrackedPaths,
    };
  } catch (error) {
    throw gitCoreError('ASTRAGIT_TASK_LOCAL_CHANGE_STATE_INVALID', error instanceof Error ? error.message : '来源工作区快照状态无效。');
  }
}

/** 持久保存来源草稿快照，使手工与 AI 续办读取同一事实。 */
async function writeTaskIntegrationLocalChangesState(integrationPath: string, state: TaskIntegrationLocalChangesState): Promise<void> {
  await writeFile(await taskIntegrationLocalChangesStatePath(integrationPath), `${JSON.stringify(state)}\n`, 'utf8');
}

/** 完成安全落地后移除 worktree 私有的来源草稿状态。 */
async function clearTaskIntegrationLocalChangesState(integrationPath: string): Promise<void> {
  await rm(await taskIntegrationLocalChangesStatePath(integrationPath), { force: true });
}

/**
 * 在独立临时 worktree 中复制来源草稿并写成不可见的 Git 对象。
 * 原来源目录和索引全程只读；忽略文件不会参与分支合入。
 */
async function captureTaskIntegrationLocalChanges(input: { repositoryPath: string; integrationPath: string; sourcePath: string; targetHeadSha: string }): Promise<TaskIntegrationLocalChangesSnapshot> {
  const sourceHeadSha = await resolveCommit(input.sourcePath, 'HEAD');
  if (sourceHeadSha !== input.targetHeadSha) throw gitCoreError('ASTRAGIT_TARGET_HEAD_CHANGED', 'Source branch advanced while local changes were being captured.');
  const conflictFiles = await readTaskIntegrationConflictPaths(input.sourcePath);
  if (conflictFiles.length > 0) throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_CONFLICTED', 'Source worktree already contains unresolved conflicts.');
  const sourceIndexTreeSha = requireGitObjectId(await requireGitStdout(input.sourcePath, ['write-tree']), 'source index tree');
  const sourceUntrackedPaths = splitNullRecords((await runGit(input.sourcePath, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout).map((path) => requireSafeWorkspacePath(path));
  for (const path of sourceUntrackedPaths) {
    const entry = await lstat(resolve(input.sourcePath, path));
    if (!entry.isFile() || entry.isSymbolicLink()) throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_UNSUPPORTED', `Source worktree contains an unsupported untracked entry: ${path}`);
  }
  const context = await getGitRepositoryContext(input.repositoryPath);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'Source worktree repository is unavailable.');
  const snapshotRoot = await mkdtemp(join(dirname(input.integrationPath), '.source-snapshot-'));
  const snapshotPath = join(snapshotRoot, 'worktree');
  let registered = false;
  try {
    await runGit(context.topLevel, ['worktree', 'add', '--detach', snapshotPath, input.targetHeadSha]);
    registered = true;
    await applyLocalChangesToTaskWorktree(input.sourcePath, snapshotPath, [], false);
    await runGit(snapshotPath, ['add', '-A']);
    const treeSha = requireGitObjectId(await requireGitStdout(snapshotPath, ['write-tree']), 'source snapshot tree');
    const commitSha = requireGitObjectId(await requireGitStdout(snapshotPath, ['commit-tree', treeSha, '-p', input.targetHeadSha, '-m', 'AstraGit 来源工作区临时快照']), 'source snapshot commit');
    return { commitSha, treeSha, indexTreeSha: sourceIndexTreeSha, untrackedPaths: sourceUntrackedPaths };
  } finally {
    if (registered) await runGit(context.topLevel, ['worktree', 'remove', '--force', snapshotPath]).catch(() => undefined);
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}

/** 来源工作区普通快进被重叠草稿阻挡时，在原隔离候选上建立三方冲突现场。 */
async function prepareTaskIntegrationLocalChanges(input: { repositoryPath: string; integrationPath: string; targetBranch: string; targetHeadSha: string; resultHeadSha: string }): Promise<string[]> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  const source = context.worktrees.find((entry) => entry.branch === input.targetBranch) ?? null;
  if (!source) throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_UNAVAILABLE', 'Checked-out source worktree is unavailable.');
  const snapshot = await captureTaskIntegrationLocalChanges({ repositoryPath: input.repositoryPath, integrationPath: input.integrationPath, sourcePath: source.path, targetHeadSha: input.targetHeadSha });
  const state: TaskIntegrationLocalChangesState = {
    sourceWorktreePath: resolve(source.path),
    targetHeadSha: input.targetHeadSha,
    resultHeadSha: input.resultHeadSha,
    sourceSnapshotCommitSha: snapshot.commitSha,
    sourceSnapshotTreeSha: snapshot.treeSha,
    sourceIndexTreeSha: snapshot.indexTreeSha,
    sourceUntrackedPaths: snapshot.untrackedPaths,
  };
  return prepareTaskIntegrationLocalChangesMerge(input.integrationPath, state);
}

/** 把同一来源草稿快照叠加到任务合入提交；真实冲突保留在当前隔离 worktree。 */
async function prepareTaskIntegrationLocalChangesMerge(integrationPath: string, state: TaskIntegrationLocalChangesState): Promise<string[]> {
  const currentHeadSha = await resolveCommit(integrationPath, 'HEAD');
  if (currentHeadSha !== state.resultHeadSha) throw gitCoreError('ASTRAGIT_TARGET_HEAD_CHANGED', 'Integration worktree is not at the recorded task result.');
  await writeTaskIntegrationLocalChangesState(integrationPath, state);
  try {
    await runGitPreservingConflict(integrationPath, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', state.sourceSnapshotCommitSha]);
    return readTaskIntegrationConflictPaths(integrationPath);
  } catch (error) {
    await runGit(integrationPath, ['reset', '--hard', state.resultHeadSha]).catch(() => undefined);
    await clearTaskIntegrationLocalChangesState(integrationPath).catch(() => undefined);
    throw error;
  }
}

/** 读取两棵 Git 树之间的完整二进制补丁。 */
async function readTaskIntegrationTreePatch(cwd: string, beforeTree: string, afterTree: string): Promise<string> {
  return readGitDiffAllowChanges(cwd, ['diff', '--binary', beforeTree, afterTree, '--', '.']);
}

/** 读取两棵 Git 树之间的字面量相对路径。 */
async function readTaskIntegrationChangedPaths(cwd: string, beforeTree: string, afterTree: string): Promise<string[]> {
  return splitNullRecords((await runGit(cwd, ['diff', '--name-only', '-z', beforeTree, afterTree, '--', '.'])).stdout).map((path) => requireSafeWorkspacePath(path));
}

/** 只清理已快照且当前仍为未跟踪状态的精确路径，禁止扩大到整个工作区。 */
async function cleanTaskIntegrationUntrackedPaths(cwd: string, paths: string[]): Promise<void> {
  const uniquePaths = Array.from(new Set(paths.map((path) => requireSafeWorkspacePath(path))));
  for (let offset = 0; offset < uniquePaths.length; offset += 128) {
    await runGit(cwd, ['--literal-pathspecs', 'clean', '-fd', '--', ...uniquePaths.slice(offset, offset + 128)]);
  }
}

/** 将树补丁应用为未暂存修改；空补丁不启动 Git 写操作。 */
async function applyTaskIntegrationTreePatch(cwd: string, patch: string): Promise<void> {
  if (patch) await runGit(cwd, ['apply', '--binary', '--whitespace=nowarn', '-'], patch);
}

/** 落地失败时用快照对象恢复来源分支、工作区内容和原暂存区。 */
async function restoreTaskIntegrationLocalChanges(input: { sourcePath: string; integrationPath: string; state: TaskIntegrationLocalChangesState; originalPatch: string; cleanupPaths: string[] }): Promise<void> {
  await runGit(input.sourcePath, ['reset', '--hard', input.state.targetHeadSha]);
  await cleanTaskIntegrationUntrackedPaths(input.sourcePath, input.cleanupPaths);
  await applyTaskIntegrationTreePatch(input.sourcePath, input.originalPatch);
  await runGit(input.sourcePath, ['read-tree', input.state.sourceIndexTreeSha]);
  const restored = await captureTaskIntegrationLocalChanges({ repositoryPath: input.sourcePath, integrationPath: input.integrationPath, sourcePath: input.sourcePath, targetHeadSha: input.state.targetHeadSha });
  if (restored.treeSha !== input.state.sourceSnapshotTreeSha || restored.indexTreeSha !== input.state.sourceIndexTreeSha) {
    throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_RESTORE_FAILED', 'Source worktree recovery did not reproduce the protected snapshot.');
  }
}

/**
 * 目标分支只推进到任务提交，再把用户确认后的组合内容落回为未暂存草稿。
 * 写入前后都使用 Git 树校验；任一步失败会恢复原来源现场。
 */
async function finalizeTaskIntegrationLocalChanges(input: { repositoryPath: string; integrationPath: string; targetBranch: string; state: TaskIntegrationLocalChangesState }): Promise<TaskIntegrationLocalSync> {
  const conflictFiles = await readTaskIntegrationConflictPaths(input.integrationPath);
  if (conflictFiles.length > 0) {
    return { localSyncStatus: 'pending', localHeadSha: input.state.targetHeadSha, localWorktreePath: input.state.sourceWorktreePath, conflictFiles };
  }
  const context = await getGitRepositoryContext(input.repositoryPath);
  const source = context.worktrees.find((entry) => entry.branch === input.targetBranch && canonicalFilesystemPath(entry.path) === canonicalFilesystemPath(input.state.sourceWorktreePath));
  if (!source) throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_CHANGED', 'Source branch is no longer checked out in its protected worktree.');
  const current = await captureTaskIntegrationLocalChanges({ repositoryPath: input.repositoryPath, integrationPath: input.integrationPath, sourcePath: source.path, targetHeadSha: input.state.targetHeadSha });
  if (current.treeSha !== input.state.sourceSnapshotTreeSha || current.indexTreeSha !== input.state.sourceIndexTreeSha) {
    throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_CHANGED', 'Source worktree changed while local conflicts were being resolved.');
  }
  await runGit(input.integrationPath, ['add', '-A']);
  const remaining = await readTaskIntegrationConflictPaths(input.integrationPath);
  if (remaining.length > 0) return { localSyncStatus: 'pending', localHeadSha: input.state.targetHeadSha, localWorktreePath: source.path, conflictFiles: remaining };
  const mergeHeadSha = await readGitStdout(input.integrationPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  if (mergeHeadSha) await runGit(input.integrationPath, ['merge', '--quit']);
  const combinedTreeSha = requireGitObjectId(await requireGitStdout(input.integrationPath, ['write-tree']), 'resolved local changes tree');
  const [originalPatch, combinedPatch, originalPaths, combinedPaths] = await Promise.all([
    readTaskIntegrationTreePatch(input.integrationPath, input.state.targetHeadSha, input.state.sourceSnapshotTreeSha),
    readTaskIntegrationTreePatch(input.integrationPath, input.state.resultHeadSha, combinedTreeSha),
    readTaskIntegrationChangedPaths(input.integrationPath, input.state.targetHeadSha, input.state.sourceSnapshotTreeSha),
    readTaskIntegrationChangedPaths(input.integrationPath, input.state.resultHeadSha, combinedTreeSha),
  ]);
  const cleanupPaths = Array.from(new Set([...input.state.sourceUntrackedPaths, ...originalPaths, ...combinedPaths]));
  try {
    await runGit(source.path, ['reset', '--hard', input.state.targetHeadSha]);
    await cleanTaskIntegrationUntrackedPaths(source.path, cleanupPaths);
    await runGit(source.path, ['merge', '--ff-only', input.state.resultHeadSha]);
    await applyTaskIntegrationTreePatch(source.path, combinedPatch);
    const verified = await captureTaskIntegrationLocalChanges({ repositoryPath: input.repositoryPath, integrationPath: input.integrationPath, sourcePath: source.path, targetHeadSha: input.state.resultHeadSha });
    if (verified.treeSha !== combinedTreeSha) throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_VERIFICATION_FAILED', 'Resolved source worktree content does not match the isolated result.');
  } catch (error) {
    try {
      await restoreTaskIntegrationLocalChanges({ sourcePath: source.path, integrationPath: input.integrationPath, state: input.state, originalPatch, cleanupPaths });
    } catch (restoreError) {
      throw gitCoreError('ASTRAGIT_TARGET_WORKTREE_RESTORE_FAILED', `Source worktree recovery requires attention: ${commandFailureDetail(restoreError)}`);
    }
    throw error;
  }
  await runGit(input.integrationPath, ['reset', '--hard', input.state.resultHeadSha]);
  await clearTaskIntegrationLocalChangesState(input.integrationPath);
  return { localSyncStatus: 'synced', localHeadSha: input.state.resultHeadSha, localWorktreePath: source.path, conflictFiles: [] };
}

/** 首次交付原子创建来源分支，并让已检出目录保留全部文件内容为相对新 HEAD 的本地修改。 */
async function syncUnbornLocalTargetBranch(input: { repositoryPath: string; targetBranch: string; resultHeadSha: string }): Promise<TaskIntegrationLocalSync> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  const checkedOut = context.worktrees.find((entry) => entry.branch === input.targetBranch) ?? null;
  const targetRef = localBranchRef(input.targetBranch);
  const currentHeadSha = await readCommitIfPresent(context.topLevel, targetRef);
  if (currentHeadSha) return { localSyncStatus: 'pending', localHeadSha: currentHeadSha, localWorktreePath: checkedOut?.path ?? null, conflictFiles: [] };
  try {
    /** create 指令在引用已出现时失败，避免首次交付覆盖并发产生的真实提交。 */
    await runGit(context.topLevel, ['update-ref', '--stdin'], `create ${targetRef} ${input.resultHeadSha}\n`);
    if (checkedOut) {
      try {
        /** mixed reset 只建立新 HEAD 的索引基线，不覆盖来源目录里的任何文件。 */
        await runGit(checkedOut.path, ['reset', '--mixed', input.resultHeadSha]);
      } catch (error) {
        /** 索引同步失败时撤销刚创建的引用，使同一次交付可以安全重试。 */
        await runGit(context.topLevel, ['update-ref', '--stdin'], `delete ${targetRef} ${input.resultHeadSha}\n`).catch(() => undefined);
        throw error;
      }
    }
  } catch {
    const observedHeadSha = await readCommitIfPresent(context.topLevel, targetRef);
    return { localSyncStatus: 'pending', localHeadSha: observedHeadSha ?? '', localWorktreePath: checkedOut?.path ?? null, conflictFiles: [] };
  }
  return { localSyncStatus: 'synced', localHeadSha: input.resultHeadSha, localWorktreePath: checkedOut?.path ?? null, conflictFiles: [] };
}

/** 本地合入完成后尽力同步来源分支；任何本地风险都降级为待同步，不反写用户现场。 */
async function syncLocalTargetBranch(input: { repositoryPath: string; integrationPath: string; targetBranch: string; targetHeadSha: string; resultHeadSha: string }): Promise<TaskIntegrationLocalSync> {
  const context = await getGitRepositoryContext(input.repositoryPath);
  const checkedOut = context.worktrees.find((entry) => entry.branch === input.targetBranch) ?? null;
  if (checkedOut) {
    try {
      // Git 会保留不受快进影响的本机改动，并在可能覆盖改动时自行拒绝；不要把任意脏文件都误判成合入失败。
      await runGit(checkedOut.path, ['merge', '--ff-only', input.resultHeadSha]);
      const localHeadSha = await resolveCommit(checkedOut.path, 'HEAD');
      return localHeadSha === input.resultHeadSha
        ? { localSyncStatus: 'synced', localHeadSha, localWorktreePath: checkedOut.path, conflictFiles: [] }
        : { localSyncStatus: 'pending', localHeadSha, localWorktreePath: checkedOut.path, conflictFiles: [] };
    } catch {
      const review = await getTaskWorkspaceReview(checkedOut.path).catch(() => null);
      if (review && !review.clean && review.conflictFiles.length === 0 && review.headSha === input.targetHeadSha) {
        try {
          const conflictFiles = await prepareTaskIntegrationLocalChanges(input);
          if (conflictFiles.length > 0) {
            return { localSyncStatus: 'pending', localHeadSha: review.headSha, localWorktreePath: checkedOut.path, conflictFiles };
          }
          const state = await readTaskIntegrationLocalChangesState(input.integrationPath);
          if (state) return finalizeTaskIntegrationLocalChanges({ repositoryPath: input.repositoryPath, integrationPath: input.integrationPath, targetBranch: input.targetBranch, state });
        } catch {
          // 无法安全快照或落回时继续保留隔离候选，不触碰来源现场。
        }
      }
      const localHeadSha = await resolveCommit(input.repositoryPath, localBranchRef(input.targetBranch)).catch(() => input.targetHeadSha);
      return {
        localSyncStatus: localHeadSha === input.resultHeadSha ? 'synced' : 'pending',
        localHeadSha,
        localWorktreePath: checkedOut.path,
        conflictFiles: [],
      };
    }
  }

  const currentLocalHead = await readCommitIfPresent(input.repositoryPath, localBranchRef(input.targetBranch));
  try {
    if (currentLocalHead) {
      const { localOnly } = await compareCommits(input.repositoryPath, input.resultHeadSha, currentLocalHead);
      if (localOnly > 0) {
        return { localSyncStatus: 'pending', localHeadSha: currentLocalHead, localWorktreePath: null, conflictFiles: [] };
      }
      await runGit(input.repositoryPath, ['update-ref', `refs/heads/${input.targetBranch}`, input.resultHeadSha, currentLocalHead]);
    } else {
      await runGit(input.repositoryPath, ['update-ref', `refs/heads/${input.targetBranch}`, input.resultHeadSha]);
    }
  } catch {
    const localHeadSha = await resolveCommit(input.repositoryPath, localBranchRef(input.targetBranch)).catch(() => currentLocalHead ?? input.targetHeadSha);
    return {
      localSyncStatus: localHeadSha === input.resultHeadSha ? 'synced' : 'pending',
      localHeadSha,
      localWorktreePath: null,
      conflictFiles: [],
    };
  }
  return { localSyncStatus: 'synced', localHeadSha: input.resultHeadSha, localWorktreePath: null, conflictFiles: [] };
}

export type HighRiskGitOperation = 'commit' | 'stash' | 'apply_stash' | 'rollback' | 'branch' | 'switch_branch' | 'pull' | 'push';
export type GitOperationConfirmationStatus = 'pending' | 'confirmed' | 'rejected';

export interface CreateGitOperationConfirmationInput {
  operation: HighRiskGitOperation;
  cwd: string;
  reason: string;
  message?: string;
}

export interface GitOperationConfirmation extends CreateGitOperationConfirmationInput {
  id: string;
  status: GitOperationConfirmationStatus;
  riskLevel: 'high';
  confirmationText: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  rejectedReason?: string;
}

export interface CreateGitOperationConfirmationOptions {
  createdAt?: Date;
  ttlMs?: number;
}

export interface GitRunnerResult {
  stdout: string;
  stderr: string;
  /** 冲突发生在 Git 集成过程，或集成后恢复本地修改的过程。 */
  operationStage?: 'integration' | 'restore';
  /** 只有已确认保留的临时贮藏才填入此字段。 */
  savedStash?: string;
}

export type GitCommandRunner = (cwd: string, args: string[]) => Promise<GitRunnerResult>;

export interface ExecuteHighRiskGitOperationInput {
  confirmation: GitOperationConfirmation;
  operation: HighRiskGitOperation;
  message?: string;
  branchName?: string;
  baseRef?: string;
  stashRef?: string;
  remote?: string;
  targetRef?: string;
  runner?: GitCommandRunner;
}

export interface ExecutedGitOperationResult extends GitRunnerResult {
  operation: HighRiskGitOperation;
  cwd: string;
  args: string[];
}

/**
 * 为 Git 写操作创建二次确认记录；该函数只生成确认意图，不执行任何 Git 命令。
 */
export function createGitOperationConfirmation(input: CreateGitOperationConfirmationInput, options: CreateGitOperationConfirmationOptions = {}): GitOperationConfirmation {
  const createdAtDate = options.createdAt ?? new Date();
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const createdAt = createdAtDate.toISOString();
  const expiresAt = new Date(createdAtDate.getTime() + ttlMs).toISOString();
  return {
    ...input,
    id: `git-confirm-${createdAt}-${input.operation}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
    status: 'pending',
    riskLevel: 'high',
    confirmationText: gitConfirmationText(input.operation),
    createdAt,
    expiresAt,
  };
}

/** 将等待确认的 Git 操作标记为已确认，调用方拿到确认后才能执行真实 Git 写命令。 */
export function confirmGitOperation(confirmation: GitOperationConfirmation, confirmedAt = new Date()): GitOperationConfirmation {
  return {
    ...confirmation,
    status: 'confirmed',
    confirmedAt: confirmedAt.toISOString(),
  };
}

/** 将等待确认的 Git 操作标记为已拒绝；拒绝只记录用户意图，不执行任何 Git 写命令。 */
export function rejectGitOperation(confirmation: GitOperationConfirmation, rejectedAt = new Date(), rejectedReason?: string): GitOperationConfirmation {
  return {
    ...confirmation,
    status: 'rejected',
    rejectedAt: rejectedAt.toISOString(),
    rejectedReason,
  };
}

/** 判断 Git 高风险确认是否已过期；过期确认不能再用于执行写操作。 */
export function isGitConfirmationExpired(confirmation: GitOperationConfirmation, now = new Date()): boolean {
  return now.getTime() >= new Date(confirmation.expiresAt).getTime();
}

function gitConfirmationText(operation: HighRiskGitOperation): string {
  const labels: Record<HighRiskGitOperation, string> = {
    commit: 'Git commit',
    stash: 'Git stash',
    apply_stash: 'Git stash apply',
    rollback: 'Git rollback',
    branch: 'Git branch',
    switch_branch: 'Git switch',
    pull: 'Git pull',
    push: 'Git push',
  };
  return `确认执行 ${labels[operation]}`;
}

/** 在确认完成后执行受控 Git 写操作；参数由白名单构造，调用方不能传入任意 git 子命令。 */
export async function executeHighRiskGitOperation(input: ExecuteHighRiskGitOperationInput): Promise<ExecutedGitOperationResult> {
  if (input.confirmation.status !== 'confirmed') {
    throw new Error('Git operation requires a confirmed confirmation');
  }
  if (input.confirmation.operation !== input.operation) {
    throw new Error('Git operation must match the confirmed operation');
  }
  const args = buildHighRiskGitOperationArgs(input);
  const runner = input.runner ?? defaultGitCommandRunner;
  const output = await runner(input.confirmation.cwd, args);
  return {
    operation: input.operation,
    cwd: input.confirmation.cwd,
    args,
    stdout: output.stdout,
    stderr: output.stderr,
  };
}

function buildHighRiskGitOperationArgs(input: ExecuteHighRiskGitOperationInput): string[] {
  switch (input.operation) {
    case 'commit':
      return ['commit', '-m', requireSafeGitText(input.message ?? input.confirmation.message, 'commit message')];
    case 'stash':
      return ['stash', 'push', '-m', requireSafeGitText(input.message ?? input.confirmation.message ?? input.confirmation.reason, 'stash message')];
    case 'apply_stash':
      return ['stash', 'apply', requireSafeGitRef(input.stashRef ?? 'stash@{0}', 'stash ref')];
    case 'rollback':
      return ['restore', '--source', requireSafeGitRef(input.targetRef ?? 'HEAD', 'rollback ref'), '--', '.'];
    case 'branch':
      return ['switch', '-c', requireSafeGitRef(input.branchName, 'branch name'), ...(input.baseRef ? [requireSafeGitRef(input.baseRef, 'base ref')] : [])];
    case 'switch_branch':
      return ['switch', requireSafeGitRef(input.branchName, 'branch name')];
    case 'pull':
      return ['pull', '--ff-only', requireSafeGitRef(input.remote ?? 'origin', 'remote'), requireSafeGitRef(input.targetRef ?? 'HEAD', 'pull ref')];
    case 'push':
      return ['push', requireSafeGitRef(input.remote ?? 'origin', 'remote'), requireSafeGitRef(input.targetRef ?? 'HEAD', 'push ref')];
  }
}

function requireSafeGitText(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`Git ${label} is required`);
  if (normalized.includes('\0')) throw new Error(`Git ${label} contains unsafe characters`);
  return normalized;
}

function requireSafeGitRef(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`Git ${label} is required`);
  if (!/^[A-Za-z0-9._/@{}:+~-]+$/u.test(normalized) || normalized.includes('..') || normalized.startsWith('-')) {
    throw new Error(`Git ${label} contains unsafe characters`);
  }
  return normalized;
}

function requireGitObjectId(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!/^[0-9a-f]{40,64}$/u.test(normalized)) throw gitCoreError('ASTRAGIT_GIT_OBJECT_ID_INVALID', `Git ${label} must be an exact object ID.`);
  return normalized;
}

/** 分支名称只服从 Git 自身规则，避免手写字符白名单拒绝中文或 # 等合法字符。 */
async function assertGitBranchFormat(cwd: string, branchName: string | undefined, label: string): Promise<string> {
  const normalized = branchName?.trim() ?? '';
  if (!normalized) throw gitCoreError('ASTRAGIT_GIT_BRANCH_REQUIRED', `Git ${label} is required.`);
  try {
    await execFileAsync('git', ['check-ref-format', '--branch', normalized], { cwd });
  } catch {
    throw gitCoreError('ASTRAGIT_GIT_BRANCH_INVALID', `Invalid Git ${label}: ${normalized}`);
  }
  return normalized;
}

function localBranchRef(branchName: string): string {
  return `refs/heads/${branchName}`;
}

/** 创建不挂到任何引用的确定性空提交，只为旧版 Git 建立 linked worktree 和空树比较基线。 */
async function createEmptyRootCommit(cwd: string): Promise<string> {
  /** mktree 会把空树写入对象库，后续 diff/show 可以按普通 Git 对象读取。 */
  const emptyTreeSha = requireGitObjectId((await runGit(cwd, ['mktree'], '')).stdout.trim(), 'empty tree');
  /** 内部对象使用固定身份和时间，既不依赖用户 Git 配置，也不会产生重复对象。 */
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run(
    {
      ...execution,
      env: {
        ...execution?.env,
        GIT_AUTHOR_NAME: 'AstraGit',
        GIT_AUTHOR_EMAIL: 'astragit@localhost',
        GIT_COMMITTER_NAME: 'AstraGit',
        GIT_COMMITTER_EMAIL: 'astragit@localhost',
        GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
      },
    },
    async () => requireGitObjectId((await runGit(cwd, ['commit-tree', emptyTreeSha, '-m', 'AstraGit 空仓库工作树起点'])).stdout.trim(), 'empty root commit'),
  );
}

/** 在兼容旧版 Git 的前提下创建 orphan linked worktree，不向用户分支历史写入引导提交。 */
async function createUnbornTaskWorktree(repositoryPath: string, worktreePath: string, branchName: string): Promise<void> {
  const bootstrapSha = await createEmptyRootCommit(repositoryPath);
  await runGit(repositoryPath, ['worktree', 'add', '--detach', worktreePath, bootstrapSha]);
  try {
    await runGit(worktreePath, ['checkout', '--orphan', branchName]);
  } catch (error) {
    await runGit(repositoryPath, ['worktree', 'remove', '--force', worktreePath]).catch(() => undefined);
    throw error;
  }
}

async function defaultGitCommandRunner(cwd: string, args: string[], input?: string | Uint8Array): Promise<GitRunnerResult> {
  const execution = projectGitExecution.getStore();
  execution?.signal?.throwIfAborted();
  // 由实际参数生成命令；先耐久记录调用，再启动 Git，失败和中断也能追溯。
  await execution?.onCommand?.(formatGitCommand(args, input !== undefined));
  execution?.signal?.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn('git', args, {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...gitDirectoryEnvironment, GIT_TERMINAL_PROMPT: '0', ...execution?.env, LANG: 'C', LC_ALL: 'C' },
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let stopped: string | undefined;
    const stop = (reason: string) => {
      stopped ??= reason;
      // 同时终止 SSH、凭据助手等子进程，防止取消后仍在后台写入。
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* 进程可能已经退出。 */
      }
    };
    const cancel = () => stop('Git 操作已中止。');
    const timer = setTimeout(() => stop('ETIMEDOUT: Git 操作超时。'), execution?.timeoutMs ?? 120_000);
    execution?.signal?.addEventListener('abort', cancel, { once: true });
    if (execution?.signal?.aborted) cancel();
    const cleanup = () => {
      clearTimeout(timer);
      execution?.signal?.removeEventListener('abort', cancel);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    if (input !== undefined) {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
    const append = (text: string, error: boolean) => {
      bytes += Buffer.byteLength(text);
      if (!execution?.onOutput && bytes > 10 * 1024 * 1024) {
        stop('Git 输出超过 10 MB 上限。');
        return;
      }
      if (error) stderr = (stderr + text).slice(execution?.onOutput ? -65_536 : 0);
      else stdout = (stdout + text).slice(execution?.onOutput ? -65_536 : 0);
      if (execution?.onOutput) {
        try { execution.onOutput(redactGitOutput(text)); }
        catch { stop('无法记录 Git 操作进度，请检查本地存储。'); }
      }
    };
    child.stdout.on('data', (text: string) => append(text, false));
    child.stderr.on('data', (text: string) => append(text, true));
    child.once('error', (error) => {
      cleanup();
      reject(classifyGitCommandFailure(args, error));
    });
    child.once('close', (code) => {
      cleanup();
      if (stopped || code !== 0)
        reject(classifyGitCommandFailure(args, Object.assign(new Error(stopped ?? (stderr || `Git 命令退出码：${code}`)), { interrupted: Boolean(stopped), stdout, stderr, exitCode: code })));
      else resolveResult({ stdout, stderr });
    });
  });
}

/** 命令仅用于展示；参数按 shell 单引号转义，敏感信息先经过统一脱敏。 */
function formatGitCommand(args: string[], hasInput: boolean): string {
  /** 保留参数边界，避免空格、引号或命令替换字符改变展示语义。 */
  const words = args.map((argument) => {
    /** 凭据不进入耐久账本，真实执行仍使用未经修改的参数。 */
    const safe = redactGitOutput(argument);
    return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(safe) ? safe : `'${safe.replaceAll("'", "'\\''")}'`;
  });
  return `git ${words.join(' ')}${hasInput ? ' # 通过标准输入传入内容' : ''}`;
}

/** 只在 Git 命令边界解释 Git 自身的固定诊断，不从任意界面文案推测失败原因。 */
function classifyGitCommandFailure(args: string[], error: unknown): Error & { code: string; details?: string } {
  const candidate = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown; stdout?: unknown; stderr?: unknown; interrupted?: unknown; exitCode?: unknown };
  const stdout = typeof candidate.stdout === 'string' ? redactGitOutput(candidate.stdout) : '';
  const stderr = typeof candidate.stderr === 'string' ? redactGitOutput(candidate.stderr) : '';
  const message = typeof candidate.message === 'string' ? redactGitOutput(candidate.message) : 'Git 命令执行失败。';
  const output = [stderr, stdout, message].filter(Boolean).join('\n');
  let code = 'ASTRAGIT_GIT_COMMAND_FAILED';
  let summary = 'Git 命令未完成，请查看详情并刷新仓库状态。';
  // 仅这些 Git 明确保护性拒绝的场景能声明本条命令在写入前被阻止。
  let operationStatus: 'failed_before_write' | 'unknown_after_write' = 'unknown_after_write';
  if (/^ASTRAGIT_GIT_HOOK_SELECTION_CHANGED:/mu.test(stderr)) { code = 'ASTRAGIT_GIT_HOOK_SELECTION_CHANGED'; summary = '提交 Hook 暂存了未勾选的文件，本次提交已被阻止。请调整 Hook 或重新确认提交范围。'; }
  else if (/^ASTRAGIT_GIT_HOOK_REJECTED:/mu.test(stderr)) { code = 'ASTRAGIT_GIT_HOOK_REJECTED'; summary = 'Git Hook 检查未通过，本次提交已被阻止。请查看详情并修复检查结果。'; }
  else if (candidate.code === 'ENOENT') { code = 'ASTRAGIT_GIT_EXECUTABLE_MISSING'; summary = '找不到 Git 程序，请检查安装和程序路径。'; operationStatus = 'failed_before_write'; }
  else if (candidate.code === 'EACCES' || candidate.code === 'EPERM') { code = candidate.code; summary = '系统拒绝执行 Git，请检查 Git 程序和仓库访问权限。'; operationStatus = 'failed_before_write'; }
  else if (/ETIMEDOUT:/u.test(message)) { code = 'ASTRAGIT_GIT_TIMEOUT'; summary = 'Git 操作超时，尚未确认执行结果，请刷新状态后检查。'; }
  else if (/Unable to create [^\n]*\.lock[^\n]*File exists|Another git process seems to be running/iu.test(output)) { code = 'ASTRAGIT_GIT_INDEX_LOCKED'; summary = '仓库存在 Git 锁，请确认其他 Git 操作已结束后再重试。'; operationStatus = 'failed_before_write'; }
  else if (/index file (?:smaller than expected|corrupt)|(?:bad|invalid) (?:index|signature)|index.*signature/iu.test(output)) { code = 'ASTRAGIT_GIT_INDEX_CORRUPT'; summary = 'Git 暂存区索引无法读取，请保留工作区文件并核对索引和操作结果。'; }
  else if (args.includes('rm') && args.includes('--cached') && /staged content different from both|changes staged in the index/iu.test(output)) { code = 'ASTRAGIT_GIT_STOP_TRACKING_STAGED'; summary = '所选文件的暂存版本与磁盘及 HEAD 不同，请核对后决定是否强制移除索引；磁盘文件保留。'; operationStatus = 'failed_before_write'; }
  else if (args[0] === 'merge' && /^fatal: Not possible to fast-forward, aborting\.?$/imu.test(stderr)) { code = 'ASTRAGIT_GIT_MERGE_FF_ONLY'; summary = '当前分支已经分叉，Git 的仅快进配置拒绝了合并。请查看历史并在合并选项中确认是否允许创建合并提交。'; operationStatus = 'failed_before_write'; }
  else if (/Author identity unknown|Committer identity unknown|unable to auto-detect email address|empty ident name/iu.test(output)) { code = 'ASTRAGIT_GIT_IDENTITY_REQUIRED'; summary = 'Git 提交身份未配置，请设置用户名和邮箱后重试。'; operationStatus = 'failed_before_write'; }
  else if (/nothing to commit|no changes added to commit|nothing added to commit/iu.test(output)) { code = 'ASTRAGIT_GIT_NOTHING_TO_COMMIT'; summary = '没有可提交的暂存内容，请先选择并暂存需要提交的更改。'; operationStatus = 'failed_before_write'; }
  else if (args[0] === 'branch' && /^error: the branch [^\n]+ is not fully merged\.?$/imu.test(stderr)) { code = 'ASTRAGIT_GIT_BRANCH_NOT_MERGED'; summary = '分支尚未合入，普通删除已被阻止。请先核对提交，确认舍弃后可选择强制删除。'; operationStatus = 'failed_before_write'; }
  else if (args[0] === 'branch' && /^error: cannot delete branch [^\n]+(?:used by worktree|checked out)/imu.test(stderr)) { code = 'ASTRAGIT_GIT_BRANCH_IN_USE'; summary = '分支正在工作区中使用，请先到对应工作区切换分支。'; operationStatus = 'failed_before_write'; }
  else if (/unmerged files|you need to resolve your current index first|needs merge|Committing is not possible because you have unmerged files/iu.test(output)) { code = 'ASTRAGIT_GIT_UNMERGED_FILES'; summary = '仓库还有未解决的冲突，请处理冲突并暂存解决结果后再继续。'; operationStatus = 'failed_before_write'; }
  else if (/You have not concluded your merge|rebase-merge directory|rebase-apply directory|cannot (?:merge|pull).*MERGE_HEAD/iu.test(output)) { code = 'ASTRAGIT_GIT_INTEGRATION_ACTIVE'; summary = '上一次合并或变基尚未结束，请先继续或中止该操作。'; operationStatus = 'failed_before_write'; }
  else if (/Entry [\s\S]*not uptodate\. Cannot merge\./u.test(output)) { code = 'ASTRAGIT_GIT_INDEX_ENTRY_NOT_UPTODATE'; summary = 'Git 拒绝更新某些暂存条目，请检查文件状态及 assume-unchanged/skip-worktree 标记，并刷新核对执行结果。'; }
  else if (/local changes[\s\S]*would be overwritten|untracked working tree files would be overwritten|cannot (?:pull|rebase)[^\n]*unstaged changes|index contains uncommitted changes|Please commit or stash them/iu.test(output)) { code = 'ASTRAGIT_GIT_LOCAL_CHANGES_BLOCKED'; summary = '本地更改阻止了操作，请先提交或贮藏相关更改，再重试。'; operationStatus = 'failed_before_write'; }
  else if (/Authentication failed|Permission denied \(publickey|could not read (?:Username|Password)|terminal prompts disabled|HTTP Basic: Access denied/iu.test(output)) { code = 'ASTRAGIT_GIT_AUTH_REQUIRED'; summary = '远程仓库未接受当前凭据，请检查账号、SSH 密钥或访问权限。'; }
  else if (/Could not resolve host|Could not resolve hostname|Failed to connect to|Connection (?:timed out|refused|reset)|network is unreachable/iu.test(output)) { code = 'ASTRAGIT_GIT_NETWORK_FAILED'; summary = '无法连接远程仓库，请检查远程地址和网络后重试。'; }
  else if (args.includes('push') && /\[rejected\][^\n]*\((?:non-fast-forward|fetch first|stale info)\)/iu.test(output)) { code = 'ASTRAGIT_GIT_PUSH_NON_FAST_FORWARD'; summary = '远程分支已有不同的提交，推送被拒绝。请先抓取并核对差异。'; }
  else if (args.includes('push') && /\[remote rejected\]/iu.test(output)) { code = 'ASTRAGIT_GIT_REMOTE_REJECTED'; summary = '远程仓库拒绝了推送，请查看服务器返回的原因。'; }
  else if (/gpg failed to sign|Couldn't load public key|signing failed/iu.test(output)) { code = 'ASTRAGIT_GIT_SIGNING_FAILED'; summary = '提交签名失败，请检查 Git 签名工具和密钥配置。'; }
  else if (/(?:hooks\/[^\n]+|husky[^\n]*|(?:pre-commit|pre-merge-commit|pre-rebase|commit-msg) hook)[^\n]*(?:failed|not found|exit(?:ed)?[^\n]*[1-9]|declined|refused)/iu.test(output)) { code = 'ASTRAGIT_GIT_HOOK_REJECTED'; summary = 'Git Hook 检查未通过，请查看详情并修复检查结果。'; }
  const command = formatGitCommand(args, false);
  return Object.assign(gitCoreError(code, summary, [`$ ${command}`, output].join('\n')), {
    command, stdout, stderr, operationStage: 'command', operationStatus,
    ...(candidate.interrupted ? { interrupted: true } : {}),
    ...(typeof candidate.exitCode === 'number' ? { exitCode: candidate.exitCode } : {}),
  });
}

async function runGit(cwd: string, args: string[], input?: string | Uint8Array): Promise<GitRunnerResult> {
  return defaultGitCommandRunner(cwd, args, input);
}

async function gitCommitIsAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    const message = error instanceof Error ? error.message : 'Git ancestry check failed.';
    throw gitCoreError('ASTRAGIT_GIT_COMMAND_FAILED', message);
  }
}

/** 合并类命令遇到真实冲突时保留现场并返回输出；其他失败仍按错误处理。 */
async function runGitPreservingConflict(cwd: string, args: string[], skippedStep?: GitWritePreview, input?: string | Uint8Array): Promise<GitRunnerResult> {
  const before = await getGitStatus(cwd);
  if (before.conflictFiles.length && !skippedStep) throw Object.assign(gitCoreError('ASTRAGIT_GIT_UNMERGED_FILES', '仓库还有未解决的冲突，请先处理并暂存冲突文件后再继续。', before.conflictFiles.join('\n')), { operationStage: 'preflight', operationStatus: 'failed_before_write', affectedFiles: before.conflictFiles.slice(0, 200), affectedFileCount: before.conflictFiles.length });
  try {
    return await defaultGitCommandRunner(cwd, args, input);
  } catch (error) {
    if (projectGitExecution.getStore()?.signal?.aborted || (error as { interrupted?: boolean }).interrupted) throw error;
    const status = await getGitStatus(cwd).catch(() => emptyGitStatus());
    if (status.conflictFiles.length === 0) {
      let commandIndex = 0; while (args[commandIndex] === '-c') commandIndex += 2;
      if (args[commandIndex] === 'am' && await readIntegrationState(cwd).catch(() => null) === 'am') {
        if (['ASTRAGIT_GIT_IDENTITY_REQUIRED', 'ASTRAGIT_GIT_HOOK_REJECTED'].includes((error as { code?: string }).code ?? '')) throw Object.assign(error as object, { operationStatus: 'unknown_after_write', operationStage: 'integration' });
        throw Object.assign(gitCoreError('ASTRAGIT_GIT_MAILBOX_PAUSED', '邮件补丁导入已暂停，之前的提交可能已经完成。请核对当前状态并继续、跳过或终止。', gitErrorOutput(error)), { cause: error, operationStatus: 'unknown_after_write', operationStage: 'integration' });
      }
      if ((error as { code?: string }).code === 'ASTRAGIT_GIT_LOCAL_CHANGES_BLOCKED') Object.assign(error as object, gitOverwriteFiles(gitErrorOutput(error), before.fileStatuses.flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])])));
      throw error;
    }
    const candidate = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    if (skippedStep) {
      // Existing conflicts cannot prove that --skip reached the next step. A lock
      // or precondition error must remain a failure, even if the old index is UU.
      const kind = skippedStep.integrationState;
      const next = kind && kind !== 'merge' ? await getProjectGitSkipPreview(cwd, kind).catch(() => null) : null;
      const diagnostics = `${candidate.stdout ?? ''}\n${candidate.stderr ?? ''}`;
      if (!next || next.integrationStepFingerprint === skippedStep.integrationStepFingerprint || !/^CONFLICT(?:\s*\(|:)|^error: could not (?:apply|revert) [a-f0-9]+/mu.test(diagnostics)) throw error;
    }
    return {
      stdout: typeof candidate.stdout === 'string' ? candidate.stdout : '',
      stderr: typeof candidate.stderr === 'string' ? candidate.stderr : typeof candidate.message === 'string' ? candidate.message : 'Git operation stopped on conflicts.',
      operationStage: 'integration',
    };
  }
}

async function requireGitStdout(cwd: string, args: string[]): Promise<string> {
  return (await runGit(cwd, args)).stdout.trim();
}

async function resolveCommit(cwd: string, ref: string): Promise<string> {
  const normalized = requireSafeGitText(ref, 'Git revision');
  try {
    return await requireGitStdout(cwd, ['rev-parse', '--verify', '--end-of-options', `${normalized}^{commit}`]);
  } catch {
    throw gitCoreError('ASTRAGIT_GIT_REF_NOT_FOUND', `Git ref does not resolve to a commit: ${normalized}`);
  }
}

async function assertNamedBranchExists(cwd: string, branchName: string, label = 'branch name'): Promise<string> {
  const branch = await assertGitBranchFormat(cwd, branchName, label);
  const exists = await readGitStdout(cwd, ['show-ref', '--verify', '--hash', localBranchRef(branch)]);
  if (!exists) throw gitCoreError('ASTRAGIT_GIT_BRANCH_NOT_FOUND', `Local branch does not exist: ${branch}`);
  return branch;
}

/** 校验一次远端刷新快照中的分支，并返回不含远端名前缀的业务分支名。 */
async function assertRemoteBranchExists(cwd: string, remoteRef: string, expectedBranch?: string): Promise<string> {
  const normalized = remoteRef.trim();
  const parts = splitGitRemoteBranch(normalized, splitLines(await requireGitStdout(cwd, ['remote'])));
  if (!parts) throw gitCoreError('ASTRAGIT_TASK_SOURCE_BRANCH_INVALID', `Remote source branch is invalid: ${normalized}`);
  const remoteName = requireSafeGitRef(parts.remote, 'remote');
  const branch = await assertGitBranchFormat(cwd, expectedBranch?.trim() || parts.branch, 'source branch');
  if (normalized !== `${remoteName}/${branch}`) throw gitCoreError('ASTRAGIT_TASK_SOURCE_BRANCH_INVALID', `Remote source branch does not match its selected remote: ${normalized}`);
  const exists = await readGitStdout(cwd, ['show-ref', '--verify', '--hash', `refs/remotes/${remoteName}/${branch}`]);
  if (!exists) throw gitCoreError('ASTRAGIT_GIT_BRANCH_NOT_FOUND', `Remote branch does not exist in the refreshed snapshot: ${normalized}`);
  return branch;
}

async function readCommitIfPresent(cwd: string, ref: string): Promise<string | null> {
  const stdout = await readGitStdout(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return /^[0-9a-f]{40,64}$/u.test(stdout) ? stdout : null;
}

async function compareCommits(
  cwd: string,
  remoteCommit: string,
  localCommit: string,
): Promise<{
  remoteOnly: number;
  localOnly: number;
}> {
  const [remoteOnlyText = '0', localOnlyText = '0'] = (await requireGitStdout(cwd, ['rev-list', '--left-right', '--count', `${remoteCommit}...${localCommit}`])).split(/\s+/u);
  return {
    remoteOnly: Number.parseInt(remoteOnlyText, 10) || 0,
    localOnly: Number.parseInt(localOnlyText, 10) || 0,
  };
}

function buildTaskWorktreePath(topLevel: string, projectSlug: string, taskCode: string, workspaceId: string): string {
  const root = join(dirname(topLevel), '.astragit-worktrees');
  const safeProject = safePathSegment(projectSlug || basename(topLevel));
  const safeTask = safePathSegment(taskCode);
  const safeWorkspace = safePathSegment(workspaceId).slice(-16) || 'workspace';
  return join(root, safeProject, safeWorkspace, safeTask);
}

function safePathSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
}

/** 校验工作区相对路径并保留原始文件名，首尾空白也是合法路径的一部分。 */
function requireSafeWorkspacePath(value: string): string {
  if (!value || isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`) || relative('.', value).startsWith(`..${sep}`) || value.includes('\0')) {
    throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Invalid workspace-relative path: ${value}`);
  }
  return value;
}

/** 项目显式使用本地 Prettier 时，只整理本次提交选中的现存普通文件。 */
async function formatTaskCommitPaths(cwd: string, selectedPaths: string[]): Promise<string[]> {
  if (!(await projectDeclaresPrettier(cwd))) return [];

  const prettierPath = await resolveTaskPrettierPath(cwd);
  if (!prettierPath) throw gitCoreError('ASTRAGIT_TASK_PRECOMMIT_FORMAT_UNAVAILABLE', '项目配置了 Prettier，但仓库尚未安装本地 Prettier。请先安装项目依赖再提交。');
  const prettierEntrypoint = await resolveTaskPrettierEntrypoint(prettierPath);
  if (!prettierEntrypoint) throw gitCoreError('ASTRAGIT_TASK_PRECOMMIT_FORMAT_UNAVAILABLE', '项目配置了 Prettier，但本地 Prettier 入口无法解析。请先安装项目依赖再提交。');

  const existingFiles: string[] = [];
  const before = new Map<string, Buffer>();
  for (const path of selectedPaths) {
    const absolutePath = resolve(cwd, path);
    if (!isPathInside(cwd, absolutePath)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Workspace path escapes the task worktree: ${path}`);
    const entry = await lstat(absolutePath).catch(() => null);
    // 符号链接不交给格式化器，避免跟随链接改写任务工作区之外的目标。
    if (!entry?.isFile() || entry.isSymbolicLink()) continue;
    existingFiles.push(path);
    before.set(path, await readFile(absolutePath));
  }
  if (existingFiles.length === 0) return [];

  const ignorePath = join(cwd, '.prettierignore');
  const ignoreEntry = await lstat(ignorePath).catch(() => null);
  const commonArgs = [...(ignoreEntry?.isFile() ? ['--ignore-path', '.prettierignore'] : []), '--ignore-unknown'];
  const absoluteFiles = existingFiles.map((path) => resolve(cwd, path));
  const prettierEnvironment = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
  try {
    await execFileAsync(process.execPath, [prettierEntrypoint, '--write', ...commonArgs, ...absoluteFiles], {
      cwd,
      env: prettierEnvironment,
      maxBuffer: 20 * 1024 * 1024,
    });
    await execFileAsync(process.execPath, [prettierEntrypoint, '--check', ...commonArgs, ...absoluteFiles], {
      cwd,
      env: prettierEnvironment,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    throw gitCoreError('ASTRAGIT_TASK_PRECOMMIT_FORMAT_FAILED', `提交前 Prettier 格式化失败：${commandFailureDetail(error)}`);
  }

  const formattedPaths: string[] = [];
  for (const path of existingFiles) {
    const previous = before.get(path);
    const current = await readFile(resolve(cwd, path));
    if (previous && !previous.equals(current)) formattedPaths.push(path);
  }
  return formattedPaths;
}

async function resolveTaskPrettierPath(cwd: string): Promise<string | null> {
  const candidates = [join(cwd, 'node_modules', '.bin', 'prettier')];
  // Git worktree 默认不复制 node_modules；允许复用同一仓库主工作区已经安装的固定版本。
  const commonGitDirectory = await readGitStdout(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => null);
  if (commonGitDirectory) candidates.push(join(dirname(commonGitDirectory), 'node_modules', '.bin', 'prettier'));
  for (const candidate of new Set(candidates)) {
    const entry = await lstat(candidate).catch(() => null);
    if (entry && !entry.isDirectory()) return candidate;
  }
  return null;
}

/** 解析项目本地 Prettier 的 JavaScript 入口，避免执行依赖外部 node 命令的 shell 包装器。 */
async function resolveTaskPrettierEntrypoint(prettierPath: string): Promise<string | null> {
  const resolvedPath = await realpath(prettierPath).catch(() => null);
  if (resolvedPath && isJavaScriptEntrypoint(resolvedPath)) return resolvedPath;

  const packageRoot = resolve(dirname(prettierPath), '..', 'prettier');
  const packageManifest = await readFile(join(packageRoot, 'package.json'), 'utf8').catch(() => null);
  if (!packageManifest) return null;

  let binPath: string | null = null;
  try {
    const manifest = JSON.parse(packageManifest) as { bin?: unknown };
    binPath = readPrettierBinPath(manifest.bin);
  } catch {
    return null;
  }
  if (!binPath) return null;

  const entrypoint = resolve(packageRoot, binPath);
  if (!isPathInside(packageRoot, entrypoint)) return null;
  const entry = await lstat(entrypoint).catch(() => null);
  return entry && !entry.isDirectory() ? entrypoint : null;
}

function readPrettierBinPath(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const entries = value as Record<string, unknown>;
  const preferred = entries.prettier;
  if (typeof preferred === 'string') return preferred;
  const firstPath = Object.values(entries).find((entry) => typeof entry === 'string');
  return typeof firstPath === 'string' ? firstPath : null;
}

function isJavaScriptEntrypoint(value: string): boolean {
  return /\.(?:cjs|mjs|js)$/iu.test(value);
}

async function projectDeclaresPrettier(cwd: string): Promise<boolean> {
  const packageJsonPath = join(cwd, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8').catch(() => null);
  if (!packageJson) return false;
  try {
    const manifest = JSON.parse(packageJson) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some((field) => {
      const dependencies = manifest[field];
      return typeof dependencies === 'object' && dependencies !== null && Object.prototype.hasOwnProperty.call(dependencies, 'prettier');
    });
  } catch {
    // package.json 正在编辑且暂时不是合法 JSON 时，仍识别显式声明，交由 Prettier 给出准确错误。
    return /"prettier"\s*:/u.test(packageJson);
  }
}

function commandFailureDetail(error: unknown): string {
  const failure = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const detail = [failure.stderr, failure.stdout, failure.message].find((value) => typeof value === 'string' && value.trim());
  return typeof detail === 'string' ? detail.trim().slice(0, 4_000) : '命令执行失败。';
}

/** 统一 macOS 等系统上的符号链接路径，避免同一 worktree 因 /tmp 与 /private/tmp 被误判。 */
function canonicalFilesystemPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const [behindText = '0', aheadText = '0'] = stdout.trim().split(/\s+/u);
  return {
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0,
  };
}

async function readGitDiffAllowChanges(cwd: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout;
  } catch (error) {
    const output = (error as { stdout?: unknown }).stdout;
    // Only diff --no-index's expected difference exit may return usable stdout.
    // A timeout or buffer overflow can contain a truncated, unsafe-to-apply patch.
    if ((error as { code?: unknown }).code === 1 && typeof output === 'string') return output;
    throw error;
  }
}

function diffSummaryFromText(diffText: string): GitDiffSummary {
  const fileDiffs = parseGitUnifiedDiff(diffText);
  return {
    isRepository: true,
    files: Array.from(new Set(fileDiffs.flatMap((file) => [file.newPath || file.oldPath]).filter(Boolean))),
    diffText,
    fileDiffs,
  };
}

async function readRemoteHead(cwd: string, remoteName: string, remoteBranch: string): Promise<string | null> {
  const remote = requireSafeGitRef(remoteName, 'remote');
  const branch = await assertGitBranchFormat(cwd, remoteBranch, 'remote branch');
  const stdout = await readGitStdout(cwd, ['ls-remote', '--heads', remote, localBranchRef(branch)]);
  const [sha = ''] = stdout.trim().split(/\s+/u);
  return /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null;
}

async function readGitStageText(cwd: string, stage: 1 | 2 | 3, path: string): Promise<string> {
  try {
    return (await execFileAsync('git', ['show', `:${stage}:${path}`], { cwd, maxBuffer: 4 * 1024 * 1024 })).stdout;
  } catch {
    return '';
  }
}

async function readWorkspaceText(cwd: string, path: string): Promise<string> {
  const absolutePath = resolve(cwd, path);
  if (!isPathInside(cwd, absolutePath)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Workspace path escapes the integration worktree: ${path}`);
  const bytes = await readFile(absolutePath);
  if (bytes.includes(0)) throw gitCoreError('ASTRAGIT_TASK_CONFLICT_BINARY_UNSUPPORTED', 'Binary conflict resolution is not supported in the text editor.');
  if (bytes.byteLength > 4 * 1024 * 1024) throw gitCoreError('ASTRAGIT_TASK_CONFLICT_TOO_LARGE', 'Conflict file is too large for the built-in editor.');
  return bytes.toString('utf8');
}

/** 只清洗操作诊断；不改写用户文件和差异正文。 */
export function redactGitOutput(message: string): string {
  return message
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu, '$1[已隐藏]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, '$1 [已隐藏]')
    .replace(/((?:access_token|private_token|token|password|passwd|authorization|client_secret)[=:]\s*)[^\s&]+/giu, '$1[已隐藏]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|glpat-[A-Za-z0-9_-]+)\b/gu, '[已隐藏]');
}

/** 消息保留错误身份，确保只传递消息的跨进程入口仍能解释原因。 */
function gitCoreError(code: string, message: string, details?: string): Error & { code: string; details?: string } {
  return Object.assign(new Error(redactGitOutput(message.startsWith(`${code}:`) ? message : `${code}: ${message}`)), { code, ...(details ? { details: redactGitOutput(details) } : {}) });
}

/** Clone/init are explicit setup operations, isolated from existing workbench writes. */
export async function setupGitRepository(input: RepositorySetupInput, signal?: AbortSignal, onOutput?: (text: string) => void): Promise<string> {
  return projectGitExecution.run({ signal, onOutput, timeoutMs: 30 * 60_000, env: { GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined, GIT_PREFIX: undefined, GIT_NAMESPACE: undefined } }, async () => {
    signal?.throwIfAborted();
    if (!isAbsolute(input.localPath) || input.localPath.includes('\0') || /[\r\n]/u.test(input.localPath)) throw gitCoreError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '请选择有效的目标绝对目录。');
    const destination = resolve(input.localPath);
    if (destination === dirname(destination)) throw gitCoreError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '请选择具体的仓库文件夹。');
    if (input.kind !== 'clone' && input.kind !== 'init') throw gitCoreError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '请选择克隆或初始化。');
    if (input.kind === 'clone') {
      const issue = gitRemoteAddressIssue(input.source ?? '');
      if (issue) throw gitCoreError(issue === 'credentials' ? 'ASTRAGIT_GIT_REMOTE_CREDENTIALS_IN_URL' : 'ASTRAGIT_GIT_REMOTE_URL_INVALID', issue === 'credentials' ? '请使用不包含密码、令牌或查询参数的仓库地址，通过系统 Git 凭据助手认证。' : '仓库地址无效。');
    }
    if (input.depth !== undefined && (!Number.isSafeInteger(input.depth) || input.depth < 1 || input.depth > 1_000_000)) throw gitCoreError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '浅克隆深度必须为正整数。');
    let ancestor = dirname(destination);
    while (!(await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))) {
      const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
    if (!(await lstat(await realpath(ancestor))).isDirectory()) throw gitCoreError('ASTRAGIT_PROJECT_PATH_INVALID', '目标的父路径必须是文件夹。');
    const branch = input.branch?.trim() || (input.kind === 'init' ? 'main' : '');
    if (branch) await assertGitBranchFormat(ancestor, branch, 'initial branch');
    const existing = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) {
      const directory = await realpath(destination);
      if (!(await lstat(directory)).isDirectory()) throw gitCoreError('ASTRAGIT_PROJECT_PATH_INVALID', '目标必须是文件夹。');
      if (input.kind === 'clone' && (await readdir(directory)).length) throw gitCoreError('ASTRAGIT_CLONE_DESTINATION_NOT_EMPTY', '克隆目标目录不是空目录，请选择新目录或空目录。');
      if (input.kind === 'init' && await lstat(join(directory, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw gitCoreError('ASTRAGIT_REPOSITORY_ALREADY_INITIALIZED', '该目录已包含 Git 仓库，请直接打开。');
      if (input.kind === 'init' && await readGitStdout(directory, ['rev-parse', '--is-bare-repository']) === 'true') throw gitCoreError('ASTRAGIT_REPOSITORY_ALREADY_INITIALIZED', '该目录已经是裸仓库，请选择其他目录。');
    }
    signal?.throwIfAborted();
    await mkdir(dirname(destination), { recursive: true });
    const args = input.kind === 'clone'
      ? ['clone', '--progress', ...(input.recursive ? ['--recurse-submodules'] : []), ...(input.depth ? ['--depth', String(input.depth)] : []), ...(branch ? ['--branch', branch] : []), '--', input.source!, destination]
      : ['init', `--initial-branch=${branch}`, '--', destination];
    await runGit(dirname(destination), args);
    signal?.throwIfAborted();
    const context = await getGitRepositoryContext(destination);
    if (!context.isRepository || await realpath(context.topLevel) !== await realpath(destination)) throw gitCoreError('ASTRAGIT_REPOSITORY_SETUP_UNCONFIRMED', '命令已结束，但未能确认目标仓库，请检查目录后再打开。');
    return await realpath(destination);
  });
}

/** 只读获取 Git 状态，不执行提交、回退、合并等高风险写操作。 */
export async function getGitStatus(cwd: string, signal?: AbortSignal): Promise<GitStatusSummary> {
  const state = await readRepositoryStatus(cwd, fileHistoryRuntime(signal));
  if (!state) return emptyGitStatus();
  return { isRepository: true, branch: state.branch, remoteBranches: state.remoteBranches, recentCommits: parseRecentCommits(state.recent), ...parseGitPorcelainStatus(state.porcelain) };
}

async function readProjectGitIndexFingerprint(cwd: string): Promise<string> {
  // Stage entries include names, modes, blob identities and unresolved stages.
  // Reading them does not create trees or alter the user's index.
  return createHash('sha256').update(await requireGitStdout(cwd, ['ls-files', '--stage', '-z'])).digest('hex');
}

export async function getProjectGitRepositorySettings(cwd: string) {
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
  return readRepositorySettings(args => runGit(context.topLevel, args), redactGitOutput);
}

export async function getProjectGitCommitTemplate(cwd: string, signal?: AbortSignal) {
  return projectGitExecution.run({ signal }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    return readCommitTemplate(context.topLevel, (args, input) => runGit(context.topLevel, args, input), redactGitOutput);
  });
}

export async function getProjectGitFileLocation(cwd: string, path: string, intent: GitFileIntent) {
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
  if (path) gitFileSelection([path]);
  if (intent === 'edit-ignore-rule') {
    await requireIgnoredSelection(context.topLevel, [path], (args, input) => runGit(context.topLevel, args, input));
    const match = (await gitIgnoreMatches([path], (args, input) => runGit(context.topLevel, args, input))).get(path.replace(/\/$/u, ''));
    if (!match) throw branchManagementFailure('ASTRAGIT_GIT_IGNORED_PATH_CHANGED', '忽略规则已变化，请刷新后重新选择。');
    const target = await realpath(resolve(context.topLevel, match.source));
    if (!(await lstat(target)).isFile()) throw gitCoreError('ASTRAGIT_GIT_IGNORE_FILE_INVALID', '匹配规则的来源不是普通文件。');
    return { path: target, isDirectory: false, missingFile: false };
  }
  const [entries, status] = await Promise.all([runGit(context.topLevel, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']), getGitStatus(context.topLevel)]);
  const known = [...entries.stdout.split('\0').filter(Boolean), ...status.fileStatuses.map(file => file.path)];
  if (path && !known.some(entry => entry === path || entry.startsWith(`${path}/`)) && (await gitIgnoreMatches([path], (args, input) => runGit(context.topLevel, args, input))).has(path.replace(/\/$/u, ''))) known.push(path);
  return resolveGitFileLocation(context.topLevel, path, intent, known);
}

export async function getProjectGitIgnorePreview(cwd: string, scope: GitIgnoreScope, signal?: AbortSignal, env?: NodeJS.ProcessEnv) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, env: { ...execution?.env, ...env, GIT_OPTIONAL_LOCKS: '0' }, signal: signal ?? execution?.signal }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    return readGitIgnorePreview(context.topLevel, scope, args => runGit(context.topLevel, args), { ...process.env, ...execution?.env, ...env }, signal ?? execution?.signal);
  });
}

function interactiveGitRun(cwd: string) {
  const execution = projectGitExecution.getStore();
  return (args: string[], input?: string, env?: NodeJS.ProcessEnv) => projectGitExecution.run({ ...execution, env: { ...execution?.env, ...env } }, () => runGit(cwd, args, input));
}

export async function getProjectGitInteractiveRebasePreview(cwd: string, baseRef: string, ontoRef?: string, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    const preview = await readInteractiveRebasePreview(context.topLevel, { ...context, integrationState: await readIntegrationState(context.topLevel) }, baseRef, ontoRef, interactiveGitRun(context.topLevel), signal ?? execution?.signal);
    const after = await getGitRepositoryContext(context.topLevel);
    if (after.headSha !== context.headSha || after.branch !== context.branch || after.detached !== context.detached || await readIntegrationState(context.topLevel)) throw branchManagementFailure('ASTRAGIT_GIT_REBASE_PREVIEW_CHANGED', '读取期间分支或整合状态已变化，请重新载入。');
    return preview;
  });
}

async function runInteractiveRebaseControl(cwd: string, operation: 'continue' | 'skip' | 'abort', action: ProjectGitAction['type'], skippedStep?: GitWritePreview) {
  const control = await prepareInteractiveRebaseControl(cwd, operation, interactiveGitRun(cwd));
  const execution = projectGitExecution.getStore(); let output: GitRunnerResult;
  try { output = await projectGitExecution.run({ ...execution, env: { ...execution?.env, ...control.env }, timeoutMs: 30 * 60_000 }, () => operation === 'abort' ? runGit(cwd, control.args) : runGitPreservingConflict(cwd, control.args, skippedStep)); }
  finally { await control.cleanup?.().catch(() => undefined); }
  return finishProjectGitAction(cwd, action, output);
}

function fileHistoryRuntime(signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return { env: execution?.env, signal: signal ?? execution?.signal, parseDiff: diffSummaryFromText };
}
export function getProjectGitArchivePreview(cwd: string, input: unknown, signal?: AbortSignal) { return readGitArchivePreview(cwd, input, fileHistoryRuntime(signal)); }
export function getProjectGitCommitReplayPreview(cwd: string, input: GitCommitReplayInput, signal?: AbortSignal, includeAllFiles = false) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal }, async () => {
    const context = await getGitRepositoryContext(cwd, signal);
    if (!context.isRepository) throw gitCommitReplayFailure('INVALID', '所选位置不是可用的 Git 仓库。');
    return readGitCommitReplayPreview(context.topLevel, input, context, await readIntegrationState(context.topLevel), { ...fileHistoryRuntime(signal), includeAllFiles });
  });
}
export function getProjectGitCommitReplaySeriesPreview(cwd: string, input: GitCommitReplaySeriesInput, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal }, () => readGitCommitReplaySeriesPreview(cwd, input, fileHistoryRuntime(signal)));
}
export function writeProjectGitArchive(cwd: string, input: unknown, destination: import('node:stream').Writable, signal?: AbortSignal) { return writeGitArchive(cwd, input, destination, fileHistoryRuntime(signal)); }
async function historySearchRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) error.code = error.code.replace('ASTRAGIT_GIT_FILE_HISTORY_', 'ASTRAGIT_GIT_HISTORY_QUERY_');
    throw error;
  }
}
export function getProjectGitHistorySearchScope(cwd: string, ref?: string, signal?: AbortSignal) { return historySearchRead(() => captureHistorySearchScope(cwd, ref, fileHistoryRuntime(signal))); }
export function queryProjectGitHistoryScope(cwd: string, scope: GitHistorySearchScope, query: GitHistorySearchQuery, offset: number, signal?: AbortSignal) { return historySearchRead(() => searchHistoryScope(cwd, scope, query, offset, fileHistoryRuntime(signal))); }
export function getProjectGitTrackedFiles(cwd: string, query: GitTrackedFileQuery = {}, signal?: AbortSignal) { return readTrackedFiles(cwd, query, fileHistoryRuntime(signal)); }
export function getProjectGitFileHistory(cwd: string, query: GitFileHistoryQuery, signal?: AbortSignal) { return readFileHistory(cwd, query, fileHistoryRuntime(signal)); }
export function getProjectGitFileRevision(cwd: string, query: GitFileRevisionQuery, signal?: AbortSignal) { return readFileRevision(cwd, query, fileHistoryRuntime(signal)); }
async function patchRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) error.code = error.code.replace('ASTRAGIT_GIT_FILE_HISTORY_', 'ASTRAGIT_GIT_PATCH_READ_');
    if (error && typeof error === 'object') Object.assign(error, { operationStatus: 'failed_before_write' });
    throw error;
  }
}
export function getProjectGitPatchPreview(cwd: string, input: GitPatchInput, signal?: AbortSignal) { return patchRead(() => readPatchPreview(cwd, input, fileHistoryRuntime(signal))); }
export function getProjectGitPatchExport(cwd: string, input: GitPatchExportInput, signal?: AbortSignal) { return patchRead(() => exportGitPatch(cwd, input, fileHistoryRuntime(signal))); }

function externalToolRuntime(cwd: string, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return { signal: signal ?? execution?.signal, env: { ...process.env, ...execution?.env }, redact: redactGitOutput,
    sources: (path: string, input: GitExternalToolInput, stashUntracked = false) => projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, () => getGitFilePreviewSources(cwd, { ...input, path, allowSpecial: true, stashUntracked })) };
}
async function lfsRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    const value = error as { code?: string; details?: string; message?: string };
    if (value.code?.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) throw Object.assign(branchManagementFailure('ASTRAGIT_GIT_LFS_READ', '无法完整读取 Git LFS 状态，请检查工具版本与 Git 详情。'), { details: redactGitOutput(value.details ?? value.message ?? ''), cause: error });
    throw error;
  }
}
export function getProjectGitLfsState(cwd: string, signal?: AbortSignal) { return lfsRead(() => readGitLfsState(cwd, { ...fileHistoryRuntime(signal), redact: redactGitOutput })); }
async function flowRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    const value = error as { code?: string; details?: string; message?: string };
    if (value.code?.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) throw Object.assign(branchManagementFailure('ASTRAGIT_GIT_FLOW_READ', '无法完整读取 Git Flow 状态，请检查工具与仓库详情。'), { details: redactGitOutput(value.details ?? value.message ?? ''), cause: error });
    throw error;
  }
}
export function getProjectGitFlowState(cwd: string, signal?: AbortSignal) { return flowRead(() => readGitFlowState(cwd, { ...fileHistoryRuntime(signal), redact: redactGitOutput })); }
export function getProjectGitFlowPreview(cwd: string, change: GitFlowChange, signal?: AbortSignal) { return flowRead(() => previewGitFlow(cwd, change, { ...fileHistoryRuntime(signal), redact: redactGitOutput })); }
async function lineRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try { return await read(); } catch (error) {
    if (signal?.aborted || fileHistoryRuntime(signal).signal?.aborted) throw Object.assign(new Error('逐行差异读取已取消。'), { code: 'ASTRAGIT_CANCELLED', operationStatus: 'failed_before_write', operationStage: 'preflight' });
    const value = error as { code?: unknown; details?: string; message?: string };
    if (typeof value?.code === 'string' && value.code.startsWith('ASTRAGIT_GIT_LINES_')) throw error;
    throw Object.assign(new Error('无法完整读取逐行差异，请重新读取或使用整文件操作。'), { code: typeof value?.code === 'string' && value.code.endsWith('TOO_LARGE') ? 'ASTRAGIT_GIT_LINES_TOO_LARGE' : 'ASTRAGIT_GIT_LINES_READ', details: redactGitOutput(value?.details ?? value?.message ?? String(error)), operationStatus: 'failed_before_write', operationStage: 'preflight', cause: error });
  }
}
export function getProjectGitLineDiff(cwd: string, input: GitLineDiffInput, signal?: AbortSignal) { return lineRead(() => readGitLineDiff(cwd, input, fileHistoryRuntime(signal)), signal); }
export async function getProjectGitStagePreview(cwd: string, input: GitStagePreviewInput, signal?: AbortSignal) {
  const runtime = fileHistoryRuntime(signal);
  try { return await readGitStagePreview(cwd, input, runtime); }
  catch (error) {
    if (runtime.signal?.aborted) throw Object.assign(new Error('暂存文件核对已取消。'), { code: 'ASTRAGIT_CANCELLED', operationStatus: 'failed_before_write', operationStage: 'preflight', cause: error });
    if (error && typeof error === 'object') {
      const value = error as { code?: unknown };
      if (typeof value.code === 'string' && value.code.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) value.code = value.code.endsWith('TOO_LARGE') ? 'ASTRAGIT_GIT_STAGE_TOO_LARGE' : 'ASTRAGIT_GIT_STAGE_READ';
      Object.assign(error, { operationStatus: 'failed_before_write', operationStage: 'preflight' });
    }
    throw error;
  }
}
export function getProjectGitLfsPreview(cwd: string, change: GitLfsChange, signal?: AbortSignal) { return lfsRead(() => previewGitLfs(cwd, change, { ...fileHistoryRuntime(signal), redact: redactGitOutput })); }
async function externalToolRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    const value = error as { code?: string; details?: string; message?: string };
    if (value.code?.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) throw Object.assign(branchManagementFailure(value.code.endsWith('TOO_LARGE') ? 'ASTRAGIT_GIT_EXTERNAL_TOOL_TOO_LARGE' : 'ASTRAGIT_GIT_EXTERNAL_TOOL_READ', '无法完整读取外部工具配置或所选文件，请核对 Git 详情。'), { details: redactGitOutput(value.details ?? value.message ?? ''), cause: error });
    throw error;
  }
}
export function getProjectGitExternalToolSettings(cwd: string, signal?: AbortSignal) { return externalToolRead(() => readGitExternalToolSettings(cwd, externalToolRuntime(cwd, signal))); }
export function getProjectGitExternalToolPreview(cwd: string, input: GitExternalToolInput, signal?: AbortSignal) { return externalToolRead(() => previewGitExternalTool(cwd, input, externalToolRuntime(cwd, signal))); }
async function runExternalTool(cwd: string, action: Extract<ProjectGitAction, { type: 'external_tool' | 'configure_external_tool' }>) {
  const execution = projectGitExecution.getStore(); const runtime = externalToolRuntime(cwd);
  const run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => projectGitExecution.run({ ...execution, env: { ...execution?.env, ...env }, timeoutMs: 4 * 60 * 60_000 }, () => runGit(cwd, args, input));
  const result = await externalToolRead(() => action.type === 'configure_external_tool' ? configureGitExternalTool(cwd, action.configuration, action.expectedFingerprint, runtime, run) : executeGitExternalTool(cwd, action.input, action.expectedFingerprint, runtime, run));
  return { ...await finishProjectGitAction(cwd, action.type, result), outcome: 'completed' as const };
}

function submoduleRuntime(signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return { signal: signal ?? execution?.signal, env: { ...process.env, ...execution?.env }, redact: redactGitOutput,
    hiddenChanges: (path: string, head: string) => projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, () => readGitHiddenChanges(path, head, interactiveGitRun(path))) };
}
async function submoduleRead<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    const value = error as { code?: string; details?: string; message?: string };
    if (value.code?.startsWith('ASTRAGIT_GIT_FILE_HISTORY_')) throw Object.assign(branchManagementFailure('ASTRAGIT_GIT_SUBMODULE_READ', '无法完整读取子模块，请检查 Git 详情并重新载入。'), { details: redactGitOutput(value.details ?? value.message ?? ''), cause: error });
    throw error;
  }
}
export function getProjectGitSubmodules(cwd: string, signal?: AbortSignal) { return submoduleRead(() => readGitSubmodules(cwd, submoduleRuntime(signal))); }
export function getProjectGitSubmodulePreview(cwd: string, change: GitSubmoduleChange, signal?: AbortSignal) { return submoduleRead(() => previewGitSubmodule(cwd, change, submoduleRuntime(signal))); }
async function runSubmoduleChange(cwd: string, change: GitSubmoduleChange, expected: string) {
  const execution = projectGitExecution.getStore();
  const env = change.allowLocal ? gitCommandConfig({ ...process.env, ...execution?.env }, [['protocol.file.allow', 'always']]) : execution?.env;
  return submoduleRead(() => executeGitSubmodule(cwd, change, expected, submoduleRuntime(), args => projectGitExecution.run({ ...execution, env, timeoutMs: 30 * 60_000 }, () => runGit(cwd, args))));
}

async function mailboxGuard(cwd: string) {
  const context = await getGitRepositoryContext(cwd);
  const status = parseGitPorcelainStatus((await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty'])).stdout);
  const hidden = context.headSha ? await readGitHiddenChanges(cwd, context.headSha, interactiveGitRun(cwd)) : [];
  return { integration: await readIntegrationState(cwd), changed: [...new Set([...status.fileStatuses.filter(file => file.indexStatus !== '?').map(file => file.path), ...hidden])].sort() };
}
async function mailboxPreview(cwd: string, input: GitMailboxInput, signal?: AbortSignal, expected?: string) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, timeoutMs: 30_000, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    const runtime = fileHistoryRuntime(signal); const guard = () => mailboxGuard(cwd);
    return expected === undefined
      ? { preview: await readMailboxPreview(cwd, input, runtime, guard), args: [] as string[], bytes: Buffer.alloc(0) }
      : prepareMailboxImport(cwd, input, expected, runtime, guard);
  });
}
export async function getProjectGitMailboxPreview(cwd: string, input: GitMailboxInput, signal?: AbortSignal) { return patchRead(async () => (await mailboxPreview(cwd, input, signal)).preview); }

export async function getProjectGitStopTrackingPreview(cwd: string, paths: string[], signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' }, signal: signal ?? execution?.signal }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    const result = await readStopTracking(context.topLevel, { headSha: context.headSha, branch: context.branch, detached: context.detached }, paths, args => runGit(context.topLevel, args));
    const after = await getGitRepositoryContext(context.topLevel);
    if (after.headSha !== context.headSha || after.branch !== context.branch || after.detached !== context.detached) throw branchManagementFailure('ASTRAGIT_GIT_STOP_TRACKING_CHANGED', '读取期间分支已变化，请重新载入确认范围。');
    return result.preview;
  });
}

export async function getProjectGitIgnoredFiles(cwd: string, query: GitIgnoredQuery = {}, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' }, signal: signal ?? execution?.signal }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    return readIgnoredFiles(context.topLevel, query, (args, input) => runGit(context.topLevel, args, input), signal ?? execution?.signal);
  });
}

export async function getProjectGitResetPreview(cwd: string, revision: string, mode: GitResetMode, signal?: AbortSignal) {
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw branchManagementFailure('ASTRAGIT_GIT_RESET_MODE_INVALID', '重置方式无效。');
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是 Git 仓库。');
    const targetSha = await resolveCommit(context.topLevel, revision);
    const preview = await readGitWritePreview(context.topLevel, { headSha: context.headSha, branch: context.branch, detached: context.detached, targetSha, integrationState: await readIntegrationState(context.topLevel) }, mode, args => runGit(context.topLevel, args), signal ?? execution?.signal);
    const after = await getGitRepositoryContext(context.topLevel);
    if (!after.isRepository || after.headSha !== preview.headSha || after.branch !== preview.branch || after.detached !== preview.detached) throw branchManagementFailure('ASTRAGIT_GIT_RESET_PREVIEW_CHANGED', '读取期间当前分支或提交已变化，请重新载入预览。');
    return preview;
  });
}

export async function getProjectGitSkipPreview(cwd: string, kind: 'rebase' | 'cherry_pick' | 'revert' | 'am', signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    if (!['rebase', 'cherry_pick', 'revert', 'am'].includes(kind) || await readIntegrationState(cwd) !== kind) throw branchManagementFailure('ASTRAGIT_GIT_INTEGRATION_CHANGED', '当前整合状态已变化，无法跳过该步骤。');
    const context = await getGitRepositoryContext(cwd);
    const preview = !context.headSha && kind === 'am'
      ? await readGitWritePreview(context.topLevel, { headSha: '', branch: context.branch, detached: context.detached, targetSha: '', integrationState: 'am' }, 'hard', args => runGit(context.topLevel, args), signal)
      : await getProjectGitResetPreview(cwd, requireGitObjectId(context.headSha, 'current HEAD'), 'hard', signal);
    if (preview.integrationState !== kind) throw branchManagementFailure('ASTRAGIT_GIT_INTEGRATION_CHANGED', '当前整合状态已变化，请重新载入。');
    return preview;
  });
}

async function readRemotePushTarget(cwd: string, remote: string): Promise<{ urls: string[]; fingerprint: string }> {
  const { stdout } = await runGit(cwd, ['remote', 'get-url', '--push', '--all', remote]);
  return { urls: stdout.split(/\r?\n/u).filter(Boolean), fingerprint: createHash('sha256').update(JSON.stringify([remote, stdout])).digest('hex') };
}

function tagRuntime(cwd: string, context: GitRepositoryContext, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return { signal: signal ?? execution?.signal, env: { ...process.env, ...execution?.env }, redact: redactGitOutput, pushTarget: async (remote: string) => {
    if (typeof remote !== 'string' || !remote || remote.trim() !== remote) throw branchManagementFailure('ASTRAGIT_GIT_TAG_QUERY_INVALID', '请选择明确的远程仓库。');
    return readRemotePushTarget(cwd, requireKnownRemote(context, remote));
  } };
}
export async function getProjectGitTags(cwd: string, query: GitTagQuery = {}, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, timeoutMs: 30_000, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    const context = await getGitRepositoryContext(cwd); if (!context.isRepository) throw branchManagementFailure('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '请选择有效的 Git 仓库。');
    return readGitTagPage(context.topLevel, query, interactiveGitRun(context.topLevel), tagRuntime(context.topLevel, context, signal));
  });
}
async function resolveTagCommit(cwd: string, revision: string): Promise<string> {
  if (typeof revision !== 'string' || !revision || revision.length > 4096 || revision.includes('\0')) throw branchManagementFailure('ASTRAGIT_GIT_TAG_QUERY_INVALID', '请选择有效的标签目标版本。');
  try { return await requireGitStdout(cwd, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]); }
  catch (error) {
    const candidate = error as { exitCode?: number; interrupted?: boolean };
    if (candidate.interrupted || ![1, 128].includes(candidate.exitCode ?? 0)) throw error;
    throw branchManagementFailure('ASTRAGIT_GIT_TAG_TARGET_INVALID', '标签目标不存在或不是提交，请重新选择。');
  }
}
export async function getProjectGitTagTarget(cwd: string, revision: string, signal?: AbortSignal) {
  const execution = projectGitExecution.getStore();
  return projectGitExecution.run({ ...execution, signal: signal ?? execution?.signal, timeoutMs: 30_000, env: { ...execution?.env, GIT_OPTIONAL_LOCKS: '0' } }, async () => {
    const target = await resolveTagCommit(cwd, revision);
    return { sha: target, subject: (await requireGitStdout(cwd, ['show', '-s', '--format=%s', target])).trimEnd() };
  });
}

/** 为项目 Git 工作台读取单仓完整快照；所有字段都来自当前本机仓库。 */
export async function getProjectGitRepositorySnapshot(cwd: string): Promise<ProjectGitRepositorySnapshot> {
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected directory is not a Git repository.');
  const [status, diffs, upstreamText, tagsText, headTagsText, reflogText, stashText, recentText, indexFingerprint] = await Promise.all([
    getGitStatus(context.topLevel),
    readWorkspaceGitDiffs(context.topLevel, parseGitPorcelainStatus, fileHistoryRuntime()),
    readGitStdout(context.topLevel, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    readGitStdout(context.topLevel, ['tag', '--sort=-creatordate']),
    readGitStdout(context.topLevel, ['tag', '--points-at', 'HEAD', '--sort=-creatordate']),
    readGitStdout(context.topLevel, ['reflog', '-n', '120', '--format=%gs']),
    readGitStdout(context.topLevel, ['stash', 'list', '--format=%gd%x1f%H%x1f%s%x1f%an%x1f%aI']),
    readGitStdout(context.topLevel, [
      '-c',
      'core.quotePath=false',
      'log',
      '--branches',
      '--remotes',
      '--tags',
      '--topo-order',
      '-n',
      '200',
      '--date=iso-strict',
      '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P',
      ...(context.headSha ? [context.headSha] : []),
    ]),
    readProjectGitIndexFingerprint(context.topLevel).catch(() => undefined),
  ]);
  if (!diffs) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '读取期间仓库已不可用，请刷新仓库列表。');
  const upstream = upstreamText || null;
  const divergence = upstream ? await readGitStdout(context.topLevel, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) : '';
  const [behindText = '0', aheadText = '0'] = divergence.split(/\s+/u);
  const outgoingText = upstream
    ? await readGitStdout(context.topLevel, ['-c', 'core.quotePath=false', 'log', '--topo-order', '-n', '200', '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P', `${upstream}..HEAD`])
    : '';
  const tags = splitLines(tagsText);
  const [remoteDetails, branchTracking] = await Promise.all([
    Promise.all(
      context.remotes.map(async (name) => {
        const [fetchUrl, push] = await Promise.all([readGitStdout(context.topLevel, ['remote', 'get-url', name]), readRemotePushTarget(context.topLevel, name).catch(() => null)]);
        return { name, fetchUrl: redactGitOutput(fetchUrl), pushUrl: redactGitOutput(push?.urls[0] ?? ''), ...(push ? { pushUrls: push.urls.map(redactGitOutput), pushFingerprint: push.fingerprint } : {}) };
      }),
    ),
    readGitStdout(context.topLevel, ['for-each-ref', '--format=%(refname:lstrip=2)%09%(upstream:short)%09%(upstream:track)%09%(objectname)%09%(upstream)%09%(refname)%09%(symref)', 'refs/heads/', 'refs/remotes/'], { ...process.env, LANG: 'C', LC_ALL: 'C' }),
  ]);
  const parsedBranchTracking = parseProjectGitBranchTracking(branchTracking);
  const recentRefs = await readProjectGitRecentRefs(context.topLevel, reflogText, context, tags);
  const integrationState = await readIntegrationState(context.topLevel);
  return {
    indexFingerprint,
    branch: context.branch,
    detached: context.detached,
    headTags: splitLines(headTagsText),
    headSha: context.headSha,
    upstream,
    integrationState,
    ...(integrationState === 'cherry_pick' || integrationState === 'revert' ? { integrationNoCommit: await readIntegrationNoCommit(context.topLevel) } : {}),
    rebaseEdit: integrationState === 'rebase' ? await readRebaseEditState(context.topLevel, context.headSha, args => runGit(context.topLevel, args)) : null,
    submodules: await readRegisteredSubmodules(context.topLevel),
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0,
    clean: status.clean,
    fileStatuses: status.fileStatuses,
    conflictFiles: status.conflictFiles,
    localBranches: context.localBranches,
    checkedOutBranches: context.worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])),
    remoteDetails,
    branchUpstreams: parsedBranchTracking.upstreams,
    branchUpstreamRefs: parsedBranchTracking.upstreamRefs,
    localBranchHeads: parsedBranchTracking.localHeads,
    remoteBranchHeads: parsedBranchTracking.remoteHeads,
    branchDivergences: parsedBranchTracking.divergences,
    remoteBranches: context.remoteBranches,
    remotes: context.remotes,
    tags,
    recentRefs,
    recentCommits: parseRecentCommits(recentText),
    outgoingCommits: parseRecentCommits(outgoingText),
    stashes: parseProjectGitStashes(stashText),
    ...diffs,
  };
}

/** 分页读取拓扑历史；分支引用先解析为提交，避免被解释为命令选项。 */
export async function getProjectGitHistory(cwd: string, offset = 0, ref?: string): Promise<{ commits: GitRecentCommit[]; hasMore: boolean }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw gitCoreError('ASTRAGIT_GIT_HISTORY_OFFSET_INVALID', '历史分页位置无效。');
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '仓库不可用。');
  if (!context.headSha && !context.localBranches.length && !context.remoteBranches.length) return { commits: [], hasMore: false };
  // 工作区历史只包含分支、标签与当前 HEAD，贮藏的内部提交在贮藏页查看。
  const revisions = ref ? [await resolveCommit(cwd, ref)] : ['--branches', '--remotes', '--tags', ...(context.headSha ? [context.headSha] : [])];
  const output = await requireGitStdout(cwd, ['log', '--topo-order', `--skip=${offset}`, '-n', '201', '--date=iso-strict', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P', ...revisions, '--']);
  const commits = parseRecentCommits(output);
  return { commits: commits.slice(0, 200), hasMore: commits.length > 200 };
}

async function readRegisteredSubmodules(cwd: string): Promise<{ path: string; initialized: boolean }[]> {
  const raw = await readGitStdout(cwd, ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
  const paths = raw
    .split('\0')
    .filter(Boolean)
    .map((record) => record.slice(record.indexOf('\n') + 1));
  const modules: { path: string; initialized: boolean }[] = [];
  for (const path of paths) {
    requireRepositoryPaths(cwd, [path]);
    const indexEntry = await requireGitStdout(cwd, ['--literal-pathspecs', 'ls-files', '--stage', '--', path]);
    if (!indexEntry.startsWith('160000 ')) continue;
    modules.push({
      path,
      initialized: await lstat(join(cwd, path, '.git')).then(
        () => true,
        () => false,
      ),
    });
  }
  return modules;
}

async function readIntegrationState(cwd: string): Promise<'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' | null> {
  for (const [marker, state] of [
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry_pick'],
    ['REVERT_HEAD', 'revert'],
  ] as const) {
    const path = await requireGitStdout(cwd, ['rev-parse', '--git-path', marker]);
    if (
      await lstat(resolve(cwd, path)).then(
        () => true,
        () => false,
      )
    ) {
      if (marker === 'rebase-apply' && await lstat(join(resolve(cwd, path), 'applying')).then(() => true, () => false)) return 'am';
      return state;
    }
  }
  // A user may commit a resolved step manually. Git clears *_HEAD but keeps
  // the remaining sequencer, which still needs --continue/--abort/--skip.
  const todoPath = await requireGitStdout(cwd, ['rev-parse', '--git-path', 'sequencer/todo']);
  try {
    const todo = await readFile(resolve(cwd, todoPath), 'utf8');
    const next = todo.split(/\r?\n/u).map(line => line.trim()).find(line => line && !line.startsWith('#'));
    if (/^pick\s+[a-f0-9]+(?:\s|$)/u.test(next ?? '')) return 'cherry_pick';
    if (/^revert\s+[a-f0-9]+(?:\s|$)/u.test(next ?? '')) return 'revert';
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return null;
}

async function readIntegrationNoCommit(cwd: string): Promise<boolean> {
  const path = resolve(cwd, await requireGitStdout(cwd, ['rev-parse', '--git-path', 'sequencer/opts']));
  try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  try { return (await requireGitStdout(cwd, ['config', '--no-includes', '--file', path, '--type=bool', '--get', 'options.no-commit'])) === 'true'; }
  catch (error) { if ((error as { exitCode?: number }).exitCode === 1) return false; throw error; }
}

/** 执行项目 Git 工作台白名单动作；调用方不能传入任意子命令或任意工作目录。 */
export async function executeProjectGitAction(cwd: string, action: ProjectGitAction, signal?: AbortSignal, env?: NodeJS.ProcessEnv, onCommand?: (command: string) => Promise<void>): Promise<ProjectGitActionResult> {
  const actionEnvironment = { ...env, ...gitDirectoryEnvironment, ...(action.type === 'external_tool' && action.input.mode === 'diff' ? { GIT_OPTIONAL_LOCKS: '0' } : {}) };
  return projectGitExecution.run({ signal, env: actionEnvironment, onCommand }, () => executeProjectGitActionInternal(cwd, action));
}

/** 冲突编辑直接使用当前项目仓库的 Git stage，不复用任务集成的来源/任务重映射。 */
export async function readProjectGitConflict(cwd: string, path: string, signal?: AbortSignal): Promise<ProjectGitConflictFile> {
  return projectGitExecution.run({ signal }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是可用的 Git 仓库。');
    return readProjectConflict(context.topLevel, path, { run: (args) => runGit(context.topLevel, args), signal, hasConflictMarkers: hasUnresolvedGitConflictMarkers });
  });
}

/** 只保存/暂存冲突结果，不继续合并、变基或创建提交。 */
export async function saveProjectGitConflict(cwd: string, input: SaveProjectGitConflictInput, signal?: AbortSignal, onCommand?: (command: string) => Promise<void>): Promise<ProjectGitConflictWriteResult> {
  return projectGitExecution.run({ signal, onCommand }, async () => {
    const context = await getGitRepositoryContext(cwd);
    if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '所选目录不是可用的 Git 仓库。');
    return saveProjectConflict(context.topLevel, input, {
      signal, hasConflictMarkers: hasUnresolvedGitConflictMarkers,
      run: (args, index) => {
        const execution = projectGitExecution.getStore();
        return projectGitExecution.run({ ...execution, env: { ...execution?.env, ...(index ? { GIT_INDEX_FILE: index } : {}) } }, () => runGit(context.topLevel, args));
      },
    });
  });
}

/** 推送前只验证本地目标配置，不联系远端、不写入仓库。 */
export async function validateProjectGitPushTarget(cwd: string, remote: string, sourceBranch: string, targetBranch: string): Promise<void> {
  const context = await getGitRepositoryContext(cwd);
  requireKnownRemote(context, remote);
  await assertNamedBranchExists(context.topLevel, sourceBranch);
  await assertGitBranchFormat(context.topLevel, targetBranch, 'push target branch');
}

async function executeProjectGitActionInternal(cwd: string, action: ProjectGitAction): Promise<ProjectGitActionResult> {
  const context = await getGitRepositoryContext(cwd).catch(error => { throw Object.assign(error as object, { operationStage: 'preflight', operationStatus: 'failed_before_write' }); });
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected directory is not a Git repository.');
  const repositoryPath = context.topLevel;
  let args: string[];
  let skippedStep: GitWritePreview | undefined;
  switch (action.type) {
    case 'interactive_rebase': {
      const preview = await getProjectGitInteractiveRebasePreview(repositoryPath, action.baseSha, action.ontoSha);
      const execution = projectGitExecution.getStore();
      const output = await executeInteractiveRebase(repositoryPath, preview, action, interactiveGitRun(repositoryPath), (args, env) => projectGitExecution.run({ ...execution, env: { ...execution?.env, ...env }, timeoutMs: 30 * 60_000 }, () => runGitPreservingConflict(repositoryPath, args)));
      return finishProjectGitAction(repositoryPath, action.type, output);
    }
    case 'amend_rebase_step': {
      const edit = await readRebaseEditState(repositoryPath, context.headSha, interactiveGitRun(repositoryPath));
      if (!edit) throw branchManagementFailure('ASTRAGIT_GIT_REBASE_EDIT_REQUIRED', '当前不是原生 edit 暂停步骤，不能修订此整合提交。');
      if (edit.fingerprint !== action.expectedStepFingerprint || context.headSha !== action.expectedHeadSha || !action.expectedIndexFingerprint || action.expectedIndexFingerprint !== await readProjectGitIndexFingerprint(repositoryPath)) throw branchManagementFailure('ASTRAGIT_GIT_REBASE_EDIT_CHANGED', '当前变基步骤、HEAD 或暂存内容已变化，请重新打开修订窗口。');
      if ((await getGitStatus(repositoryPath)).conflictFiles.length) throw branchManagementFailure('ASTRAGIT_GIT_CONFLICTS_REMAIN', '请先解决并暂存所有冲突。');
      if (typeof action.message !== 'string' || action.message.includes('\0') || Buffer.byteLength(action.message) > 128 * 1024) throw branchManagementFailure('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '提交说明无效或超过 128 KiB。');
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['commit', '--amend', '--allow-empty', '--allow-empty-message', '--cleanup=verbatim', '-F', '-'], action.message));
    }
    case 'stage_ignored': {
      let paths: string[];
      try { paths = await requireIgnoredSelection(repositoryPath, action.paths, (args, input) => runGit(repositoryPath, args, input)); }
      catch (error) { throw Object.assign(error as object, { operationStatus: 'failed_before_write', operationStage: 'preflight' }); }
      const review = parseGitLargeFileReview(action.largeFileReview);
      validateGitStageReview(await getProjectGitStagePreview(repositoryPath, { paths, forceIgnored: true, thresholdBytes: review?.thresholdBytes }), review);
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['--literal-pathspecs', 'add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'], paths.join('\0') + '\0'));
    }
    case 'stop_tracking': {
      const current = await readStopTracking(repositoryPath, { headSha: context.headSha, branch: context.branch, detached: context.detached }, action.paths, args => runGit(repositoryPath, args));
      if (!action.expectedFingerprint || action.expectedFingerprint !== current.preview.fingerprint) throw branchManagementFailure('ASTRAGIT_GIT_STOP_TRACKING_CHANGED', '分支、所选目录范围或暂存版本已变化，本次未停止跟踪，请重新载入并确认。');
      const beforeWrite = await getGitRepositoryContext(repositoryPath);
      if (beforeWrite.headSha !== context.headSha || beforeWrite.branch !== context.branch || beforeWrite.detached !== context.detached) throw branchManagementFailure('ASTRAGIT_GIT_STOP_TRACKING_CHANGED', '分支已变化，本次未停止跟踪，请重新载入并确认。');
      const output = await runGit(repositoryPath, ['--literal-pathspecs', 'rm', '--cached', ...(action.force ? ['--force'] : []), '--pathspec-from-file=-', '--pathspec-file-nul'], current.paths.join('\0') + '\0');
      return finishProjectGitAction(repositoryPath, action.type, output);
    }
    case 'ignore': {
      const execution = projectGitExecution.getStore();
      const result = await appendGitIgnore(repositoryPath, action, args => runGit(repositoryPath, args), { ...process.env, ...execution?.env }, async path => { await execution?.onCommand?.(`[AstraGit] append ignore rules to ${JSON.stringify(path)}`); }, execution?.signal);
      return finishProjectGitAction(repositoryPath, action.type, result);
    }
    case 'reset_revision': {
      const target = requireGitObjectId(action.targetSha, 'reset target');
      const preview = await getProjectGitResetPreview(repositoryPath, target, action.mode);
      if (!action.expectedFingerprint || action.expectedFingerprint !== preview.fingerprint) throw branchManagementFailure('ASTRAGIT_GIT_RESET_PREVIEW_CHANGED', '分支、暂存区或工作区内容已变化，未执行重置。请重新载入并确认预览。');
      if (action.mode === 'soft' && (preview.conflictFileCount || preview.integrationState === 'merge')) throw branchManagementFailure('ASTRAGIT_GIT_RESET_SOFT_UNMERGED', '当前有合并或未解决的冲突，Git 不允许 soft 重置。请选择其他方式，或先处理当前整合。');
      if (action.mode === 'hard' && preview.nestedRepositoryCount && action.discardNestedRepositories !== true) throw branchManagementFailure('ASTRAGIT_GIT_RESET_NESTED_CONFIRMATION_REQUIRED', '重置范围包含其他 Git 仓库，请先核对并明确确认影响。');
      const result = await finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['reset', `--${action.mode}`, '--no-recurse-submodules', target, '--']));
      if (result.headSha !== target || result.branch !== preview.branch) throw Object.assign(gitCoreError('ASTRAGIT_GIT_RESET_OUTCOME_UNKNOWN', 'Git 已执行重置，但当前提交与确认目标不同，请刷新并核对结果。'), { operationStatus: 'unknown_after_write', operationStage: 'refresh' });
      return result;
    }
    case 'skip_integration': {
      const preview = await getProjectGitSkipPreview(repositoryPath, action.kind);
      if (!action.expectedFingerprint || action.expectedFingerprint !== preview.fingerprint) throw branchManagementFailure('ASTRAGIT_GIT_INTEGRATION_PREVIEW_CHANGED', '当前步骤、暂存区或文件内容已变化，未执行跳过。请重新载入并确认。');
      if (preview.nestedRepositoryCount && action.discardNestedRepositories !== true) throw branchManagementFailure('ASTRAGIT_GIT_RESET_NESTED_CONFIRMATION_REQUIRED', '当前步骤会影响其他 Git 仓库，请先明确确认。');
      if (action.kind === 'rebase') return runInteractiveRebaseControl(repositoryPath, 'skip', action.type, preview);
      skippedStep = preview;
      args = ['-c', 'core.editor=true', '-c', 'submodule.recurse=false', action.kind === 'cherry_pick' ? 'cherry-pick' : action.kind, '--skip'];
      break;
    }
    case 'set_identity_field':
    case 'configure_remote':
      return finishProjectGitAction(repositoryPath, action.type, await executeRepositorySettings(args => runGit(repositoryPath, args), redactGitOutput, action));
    case 'configure_commit_template':
      return finishProjectGitAction(repositoryPath, action.type, await configureCommitTemplate(repositoryPath, (args, input) => runGit(repositoryPath, args, input), redactGitOutput, action));
    case 'amend_commit': {
      const refuse = (code: string, message: string) => Object.assign(gitCoreError(code, message), { operationStatus: 'failed_before_write' });
      if (!context.headSha) throw refuse('ASTRAGIT_GIT_AMEND_HEAD_REQUIRED', '仓库还没有提交，无法修订上次提交。');
      if (action.expectedHeadSha !== context.headSha || action.expectedBranch !== context.branch || !/^[a-f0-9]{64}$/u.test(action.expectedIndexFingerprint) || action.expectedIndexFingerprint !== await readProjectGitIndexFingerprint(repositoryPath)) {
        throw refuse('ASTRAGIT_GIT_AMEND_STALE', '当前分支、上次提交或暂存内容已变化，请重新打开修订窗口核对。');
      }
      if (await readIntegrationState(repositoryPath)) throw refuse('ASTRAGIT_GIT_INTEGRATION_ACTIVE', '提交整合期间不能修订上次提交，请先完成或终止当前整合。');
      if ((await getGitStatus(repositoryPath)).conflictFiles.length) throw refuse('ASTRAGIT_GIT_CONFLICTS_REMAIN', '请先解决并暂存所有冲突。');
      if (typeof action.message !== 'string' || !action.message.trim() || action.message.includes('\0') || Buffer.byteLength(action.message) > 128 * 1024) throw refuse('ASTRAGIT_GIT_AMEND_MESSAGE_INVALID', '提交说明不能为空、包含无效字节或超过 128 KiB。');
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['commit', '--amend', '--cleanup=verbatim', '-F', '-'], action.message));
    }
    case 'subtree': {
      const [path] = requireRepositoryPaths(repositoryPath, [action.path]);
      if (!path || relative(repositoryPath, resolve(repositoryPath, path)) === '') throw gitCoreError('ASTRAGIT_GIT_SUBTREE_INVALID', '子树必须使用仓库内的子目录。');
      const remote = requireKnownRemote(context, action.remote);
      const branch = await assertGitBranchFormat(repositoryPath, action.branch, 'subtree branch');
      if (action.operation !== 'push' && !(await getGitStatus(repositoryPath)).clean) throw gitCoreError('ASTRAGIT_GIT_DIRTY', '添加或拉取子树前，请先提交或贮藏本地修改。');
      if (action.operation !== 'add') {
        const history = await requireGitStdout(repositoryPath, ['log', '--all', '--format=%b', '--grep=git-subtree-dir:']);
        if (![...history.matchAll(/^git-subtree-dir:\s*(.+)$/gm)].some((match) => match[1]!.trim() === path)) throw gitCoreError('ASTRAGIT_GIT_SUBTREE_INVALID', '该目录没有子树记录，请先确认子树路径。');
      }
      args = ['subtree', action.operation, `--prefix=${path}`, ...(action.operation === 'push' ? [] : ['--squash']), remote, branch];
      break;
    }
    case 'external_tool':
    case 'configure_external_tool':
      return runExternalTool(repositoryPath, action);
    case 'manage_lfs': {
      const execution = projectGitExecution.getStore();
      const output = await lfsRead(() => executeGitLfs(repositoryPath, action.change, action.expectedFingerprint, args => projectGitExecution.run({ ...execution, timeoutMs: 30 * 60_000 }, () => runGit(repositoryPath, args)), { ...fileHistoryRuntime(), redact: redactGitOutput, onWrite: async path => { await execution?.onCommand?.(`[AstraGit] remove reviewed LFS rule in ${JSON.stringify(path)}`); } }));
      return { ...await finishProjectGitAction(repositoryPath, action.type, output), outcome: 'completed' };
    }
    case 'manage_flow': {
      const execution = projectGitExecution.getStore();
      const output = await executeGitFlow(repositoryPath, action.change, action.expectedFingerprint, (args, input) => projectGitExecution.run({ ...execution, timeoutMs: 30 * 60_000 }, () => runGit(repositoryPath, args, input)), { ...fileHistoryRuntime(), redact: redactGitOutput });
      return { ...await finishProjectGitAction(repositoryPath, action.type, output), flow: output.flow };
    }
    case 'manage_submodule': {
      const output = await runSubmoduleChange(repositoryPath, action.change, action.expectedFingerprint);
      // Submodule commands do not create parent conflicts. Preserve existing
      // conflict facts without reporting them as a new failure of this action.
      return { ...await finishProjectGitAction(repositoryPath, action.type, output), outcome: 'completed' };
    }
    case 'submodule_update': {
      const change: GitSubmoduleChange = { operation: 'update', path: action.path, strategy: 'checkout' };
      const preview = await getProjectGitSubmodulePreview(repositoryPath, change);
      return { ...await finishProjectGitAction(repositoryPath, action.type, await runSubmoduleChange(repositoryPath, change, preview.fingerprint)), outcome: 'completed' };
    }
    case 'continue_integration':
    case 'abort_integration': {
      if ((await readIntegrationState(repositoryPath)) !== action.kind) throw gitCoreError('ASTRAGIT_GIT_INTEGRATION_CHANGED', '提交整合状态已变化，请刷新后重试。');
      if (action.type === 'continue_integration' && (action.kind === 'cherry_pick' || action.kind === 'revert') && await readIntegrationNoCommit(repositoryPath)) {
        const status = await getGitStatus(repositoryPath);
        if (!status.conflictFiles.length && status.fileStatuses.some(file => file.indexStatus !== ' ' && file.indexStatus !== '?')) throw gitCommitReplayFailure('MANUAL_COMMIT_REQUIRED', '本次序列不自动提交。请先提交已解决并暂存的内容，再继续剩余提交。');
      }
      if (action.kind === 'rebase') return runInteractiveRebaseControl(repositoryPath, action.type === 'abort_integration' ? 'abort' : 'continue', action.type);
      const command = action.kind === 'cherry_pick' ? 'cherry-pick' : action.kind;
      args = action.type === 'abort_integration' ? [command, '--abort'] : ['-c', 'core.editor=true', command, '--continue'];
      break;
    }
    case 'fetch': {
      const remote = requireKnownRemote(context, action.remote);
      args = ['fetch', '--prune', remote];
      break;
    }
    case 'discard': {
      const paths = requireRepositoryPaths(repositoryPath, action.paths);
      const status = await getGitStatus(repositoryPath);
      if (status.conflictFiles.length || paths.some((path) => !status.fileStatuses.some((file) => file.path === path && file.indexStatus !== '?')))
        throw gitCoreError('ASTRAGIT_GIT_DISCARD_INVALID', '只能丢弃已跟踪文件的未暂存修改；未跟踪文件和冲突文件不会被删除。');
      args = ['--literal-pathspecs', 'restore', '--worktree', '--', ...paths];
      break;
    }
    case 'rename_branch': {
      const branch = await assertNamedBranchExists(repositoryPath, action.branchName, 'branch');
      const name = await assertGitBranchFormat(repositoryPath, action.newName, 'new branch');
      args = ['branch', '-m', branch, name];
      break;
    }
    case 'delete_remote_tag': {
      if (typeof action.remote !== 'string' || !action.remote || action.remote.trim() !== action.remote) throw branchManagementFailure('ASTRAGIT_GIT_TAG_QUERY_INVALID', '请选择明确的远程仓库。');
      const remote = requireKnownRemote(context, action.remote);
      const result = await deleteGitRemoteTag({ ...action, remote }, interactiveGitRun(repositoryPath), tagRuntime(repositoryPath, context));
      return finishProjectGitAction(repositoryPath, action.type, result);
    }
    case 'create_tag':
    case 'push_tag':
    case 'delete_tag': {
      const name = action.tagName;
      if (typeof name !== 'string' || !name || name.length > 4096 || name.includes('\0')) throw branchManagementFailure('ASTRAGIT_GIT_TAG_INVALID', '标签名称无效。');
      await assertGitTagRef(name, interactiveGitRun(repositoryPath));
      if (action.type === 'push_tag') {
        const remote = requireKnownRemote(context, action.remote);
        const tag = (await localGitTags(interactiveGitRun(repositoryPath))).get(name);
        if (!tag) throw branchManagementFailure('ASTRAGIT_GIT_TAG_NOT_FOUND', '本地标签已不存在，请刷新后重新选择。');
        if (action.expectedTagObjectSha !== undefined && action.expectedTagObjectSha !== tag.objectSha) throw branchManagementFailure('ASTRAGIT_GIT_TAG_LOCAL_CHANGED', '本地标签对象已变化，本次未推送，请刷新后核对。');
        if (action.expectedRemotePushFingerprint !== undefined && action.expectedRemotePushFingerprint !== (await readRemotePushTarget(repositoryPath, remote)).fingerprint) throw branchManagementFailure('ASTRAGIT_GIT_TAG_REMOTE_CHANGED', '远程推送地址已变化，本次未推送，请重新核对。');
        const execution = projectGitExecution.getStore();
        const env = gitCommandConfig({ ...process.env, ...execution?.env }, [[`remote.${remote}.mirror`, 'false']]);
        return finishProjectGitAction(repositoryPath, action.type, await interactiveGitRun(repositoryPath)(['push', '--no-follow-tags', '--', remote, `${tag.objectSha}:refs/tags/${name}`], undefined, env));
      } else if (action.type === 'delete_tag') {
        if (action.expectedTagObjectSha === undefined) args = ['tag', '-d', '--', name];
        else {
          const tag = (await localGitTags(interactiveGitRun(repositoryPath))).get(name);
          if (!tag || tag.objectSha !== action.expectedTagObjectSha) throw branchManagementFailure('ASTRAGIT_GIT_TAG_LOCAL_CHANGED', '本地标签对象已变化，本次未删除，请刷新后核对。');
          args = ['update-ref', '--no-deref', '-d', `refs/tags/${name}`, requireGitObjectId(action.expectedTagObjectSha, 'tag object')];
        }
      }
      else {
        if (name.startsWith('-')) throw branchManagementFailure('ASTRAGIT_GIT_TAG_INVALID', '创建标签时名称不能以短横线开头。');
        if ((action.annotated !== undefined && typeof action.annotated !== 'boolean') || (action.message !== undefined && typeof action.message !== 'string')) throw branchManagementFailure('ASTRAGIT_GIT_TAG_OPTIONS_INVALID', '标签类型或说明无效。');
        if ((await localGitTags(interactiveGitRun(repositoryPath))).has(name)) throw branchManagementFailure('ASTRAGIT_GIT_TAG_EXISTS', '该标签已存在，请选择其他名称；现有标签未替换。');
        const revision = action.revision;
        if (typeof revision !== 'string' || !revision || revision.length > 4096 || revision.includes('\0')) throw branchManagementFailure('ASTRAGIT_GIT_TAG_QUERY_INVALID', '请选择有效的标签目标版本。');
        const sha = await resolveTagCommit(repositoryPath, revision);
        if (action.expectedTargetSha !== undefined && action.expectedTargetSha !== sha) throw branchManagementFailure('ASTRAGIT_GIT_TAG_TARGET_CHANGED', '目标提交已变化，本次未创建标签，请重新读取目标。');
        if (action.annotated === false) {
          if (action.message?.trim()) throw branchManagementFailure('ASTRAGIT_GIT_TAG_OPTIONS_INVALID', '轻量标签不包含附注，请切换为附注标签或清除说明。');
          args = ['tag', '--no-sign', '--', name, sha];
        } else {
          const message = action.message?.trim() ? action.message : name;
          if (message.includes('\0') || Buffer.byteLength(message) > 128 * 1024) throw branchManagementFailure('ASTRAGIT_GIT_TAG_OPTIONS_INVALID', '标签说明包含无效内容或超过 128 KiB。');
          return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['tag', '-a', '--cleanup=verbatim', '-F', '-', '--', name, sha], message));
        }
      }
      break;
    }
    case 'stage': {
      const paths = requireRepositoryPaths(repositoryPath, action.paths); const review = parseGitLargeFileReview(action.largeFileReview);
      validateGitStageReview(await getProjectGitStagePreview(repositoryPath, { paths, thresholdBytes: review?.thresholdBytes }), review);
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, ['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], paths.join('\0') + '\0'));
    }
    case 'unstage':
      args = context.headSha
        ? ['--literal-pathspecs', 'restore', '--staged', '--', ...requireRepositoryPaths(repositoryPath, action.paths)]
        : ['--literal-pathspecs', 'rm', '--cached', '--', ...requireRepositoryPaths(repositoryPath, action.paths)];
      break;
    case 'import_mailbox': {
      const prepared = await patchRead(() => mailboxPreview(repositoryPath, action.mailbox, undefined, action.expectedFingerprint));
      return finishProjectGitAction(repositoryPath, action.type, await runGitPreservingConflict(repositoryPath, prepared.args, undefined, prepared.bytes));
    }
    case 'import_patch': {
      const prepared = await patchRead(() => preparePatchImport(repositoryPath, action.patch, action.expectedFingerprint, fileHistoryRuntime()));
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, prepared.args, prepared.bytes));
    }
    case 'apply_line_changes': {
      const input = parseGitLineChange(action.input);
      if (input.operation === 'stage') { const review = parseGitLargeFileReview(action.largeFileReview); validateGitStageReview(await getProjectGitStagePreview(repositoryPath, { paths: [input.path], thresholdBytes: review?.thresholdBytes }), review); }
      const prepared = await lineRead(() => prepareGitLineChanges(repositoryPath, input, fileHistoryRuntime()));
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, prepared.args, prepared.bytes));
    }
    case 'apply_patch': {
      // 补丁末尾换行和上下文空白属于补丁内容，不能裁剪，否则 git apply 会判定补丁损坏。
      const patch = action.patch;
      if (!patch.trim() || patch.length > 2 * 1024 * 1024 || patch.includes('\0') || (!patch.includes('\ndiff --git ') && !patch.startsWith('diff --git '))) {
        throw gitCoreError('ASTRAGIT_GIT_PATCH_INVALID', 'Git hunk patch is invalid or exceeds the size limit.');
      }
      if (action.target === 'worktree' && !action.reverse) throw gitCoreError('ASTRAGIT_GIT_PATCH_TARGET_INVALID', 'Working-tree patches may only discard an existing hunk.');
      args = ['apply', ...(action.target === 'worktree' ? [] : ['--cached']), ...(action.reverse ? ['--reverse'] : []), '--whitespace=nowarn', '-'];
      return finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, args, patch));
    }
    case 'commit': {
      const message = requireSafeGitText(action.message, 'commit message');
      if (action.paths !== undefined) {
        // 源码侧勾选代表本次提交范围，不改变未勾选文件的暂存状态。
        if ((action.expectedHeadSha !== undefined && action.expectedHeadSha !== context.headSha) || (action.expectedBranch !== undefined && action.expectedBranch !== context.branch)) {
          throw gitCoreError('ASTRAGIT_GIT_SELECTION_CHANGED', '当前分支或提交已变化，请刷新更改后重新确认提交范围。');
        }
        if (await readIntegrationState(repositoryPath)) throw gitCoreError('ASTRAGIT_GIT_INTEGRATION_ACTIVE', '提交整合期间请在 Git 工作区解决冲突并继续操作。');
        const status = await getGitStatus(repositoryPath);
        if (status.conflictFiles.length) throw gitCoreError('ASTRAGIT_GIT_CONFLICTS_REMAIN', '请先解决仓库中的冲突。');
        const selected = [...new Set(requireRepositoryPaths(repositoryPath, action.paths))];
        const files = selected.map((path) => status.fileStatuses.find((file) => file.path === path));
        if (files.some((file) => !file || file.path.endsWith('/'))) throw gitCoreError('ASTRAGIT_GIT_SELECTION_CHANGED', '所选文件已变化或包含嵌套仓库，请刷新更改后重新选择。');
        const paths = [...selected];
        for (const file of files) {
          if (file?.category !== 'renamed' || !file.originalPath || selected.includes(file.originalPath)) continue;
          const entry = await lstat(resolve(repositoryPath, file.originalPath)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (entry && action.selectionMode !== 'staged') throw gitCoreError('ASTRAGIT_GIT_SELECTION_CHANGED', '重命名来源又出现文件，请同时选择该文件或先处理其更改。');
          paths.push(file.originalPath);
        }
        const execution = projectGitExecution.getStore();
        const output = await commitSelectedPaths(repositoryPath, {
          paths, selected, mode: action.selectionMode ?? 'worktree', message, headSha: context.headSha, expectedFingerprint: action.expectedFingerprint,
        }, (command, options) => projectGitExecution.run({ ...execution, env: { ...execution?.env, ...(options?.index ? { GIT_INDEX_FILE: options.index } : {}) } }, () => runGit(repositoryPath, command, options?.input)));
        return finishProjectGitAction(repositoryPath, action.type, output);
      } else args = ['commit', '-m', message];
      break;
    }
    case 'push': {
      if ((action.expectedHeadSha !== undefined && action.expectedHeadSha !== context.headSha) || (action.expectedBranch !== undefined && action.expectedBranch !== context.branch)) throw gitCoreError('ASTRAGIT_GIT_SELECTION_CHANGED', '推送前仓库分支或提交已变化，请刷新后重新确认推送。');
      if (!action.sourceBranch) requireNamedCurrentBranch(context);
      const sourceBranch = await assertNamedBranchExists(repositoryPath, action.sourceBranch || context.branch);
      const trackingRemote = await readGitStdout(repositoryPath, ['config', '--get', `branch.${sourceBranch}.remote`]);
      const trackingRef = await readGitStdout(repositoryPath, ['config', '--get', `branch.${sourceBranch}.merge`]);
      const remote = requireKnownRemote(context, action.remote || (trackingRemote === '.' ? undefined : trackingRemote));
      const trackingBranch = (!action.remote || action.remote === trackingRemote) && trackingRef.startsWith('refs/heads/') ? trackingRef.slice(11) : '';
      const targetBranch = await assertGitBranchFormat(repositoryPath, action.targetBranch?.trim() || trackingBranch || sourceBranch, 'push target branch');
      args = [
        'push',
        ...((action.setUpstream ?? !trackingRef) ? ['--set-upstream'] : []),
        ...(action.forceWithLease ? [`--force-with-lease=refs/heads/${targetBranch}:${await readGitStdout(repositoryPath, ['rev-parse', '--verify', `refs/remotes/${remote}/${targetBranch}`])}`] : []),
        ...(action.pushAllTags ? ['--tags'] : action.pushTags ? ['--follow-tags'] : []),
        remote,
        `refs/heads/${sourceBranch}:refs/heads/${targetBranch}`,
      ];
      break;
    }
    case 'pull': {
      requireNamedCurrentBranch(context);
      const trackingRemote = await readGitStdout(repositoryPath, ['config', '--get', `branch.${context.branch}.remote`]);
      const trackingRef = await readGitStdout(repositoryPath, ['config', '--get', `branch.${context.branch}.merge`]);
      const remote = requireKnownRemote(context, action.remote || (trackingRemote === '.' ? undefined : trackingRemote));
      const trackingBranch = (!action.remote || action.remote === trackingRemote) && trackingRef.startsWith('refs/heads/') ? trackingRef.slice(11) : '';
      const targetBranch = await assertGitBranchFormat(repositoryPath, action.targetBranch?.trim() || trackingBranch || context.branch, 'pull branch');
      args = [
        'pull',
        action.strategy === 'rebase' ? '--rebase' : '--no-rebase',
        ...(action.strategy === 'merge' ? [action.commitMerge === false ? '--no-commit' : '--commit', '--no-edit', action.includeMergeLog ? '--log' : '--no-log', action.noFastForward ? '--no-ff' : '--ff'] : []),
        remote,
        targetBranch,
      ];
      break;
    }
    case 'update':
      return finishProjectGitAction(repositoryPath, action.type, await executeProjectGitUpdate(repositoryPath, action.strategy, action.smart === true));
    case 'checkout':
      args = ['switch', await assertGitBranchFormat(repositoryPath, action.branchName, 'branch')];
      break;
    case 'checkout_revision':
      args = ['switch', '--detach', await resolveCommit(repositoryPath, action.revision)];
      break;
    case 'create_branch': {
      const branchName = await assertGitBranchFormat(repositoryPath, action.branchName, 'branch');
      if (await readCommitIfPresent(repositoryPath, `refs/heads/${branchName}`)) throw Object.assign(gitCoreError('ASTRAGIT_GIT_BRANCH_EXISTS', `本地分支“${branchName}”已存在。请使用不同名称，或在分支列表中切换到已有分支。`), { operationStage: 'preflight', operationStatus: 'failed_before_write' });
      const requestedBase = action.baseRef?.trim() || '';
      const baseRef = requestedBase ? (action.trackRemote ? await assertGitBranchFormat(repositoryPath, requestedBase, 'base branch') : await resolveCommit(repositoryPath, requestedBase)) : null;
      if (action.trackRemote && baseRef) await resolveCommit(repositoryPath, baseRef);
      args = ['switch', '-c', branchName, ...(action.trackRemote ? ['--track'] : []), ...(baseRef ? [baseRef] : [])];
      break;
    }
    case 'delete_branch': {
      if (action.force !== undefined && typeof action.force !== 'boolean') throw branchManagementFailure('ASTRAGIT_ACTION_INVALID', '强制删除选项无效。');
      const branch = await assertNamedBranchExists(repositoryPath, action.branchName).catch(error => { throw Object.assign(error, { operationStage: 'preflight', operationStatus: 'failed_before_write' }); });
      if (context.worktrees.some(worktree => worktree.branch === branch)) throw branchManagementFailure('ASTRAGIT_GIT_BRANCH_IN_USE', '分支正在工作区中使用，请先到该工作区切换分支，再删除。');
      const targetHead = await resolveCommit(repositoryPath, localBranchRef(branch));
      if ((action.force && !action.expectedTargetHeadSha) || (action.expectedTargetHeadSha !== undefined && action.expectedTargetHeadSha !== targetHead)) throw branchManagementFailure('ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED', '分支提交已变化或尚未确认，请重新打开删除窗口核对。');
      args = ['branch', action.force ? '-D' : '-d', '--', branch];
      break;
    }
    case 'set_upstream': {
      const branch = await assertNamedBranchExists(repositoryPath, action.branchName).catch(error => { throw Object.assign(error, { operationStage: 'preflight', operationStatus: 'failed_before_write' }); });
      const currentHead = await resolveCommit(repositoryPath, localBranchRef(branch));
      const tracking = await requireGitStdout(repositoryPath, ['for-each-ref', '--format=%(refname)%09%(upstream)', localBranchRef(branch)]);
      const currentUpstream = tracking.split('\n').find(line => line.startsWith(`${localBranchRef(branch)}\t`))?.split('\t')[1] || null;
      if (action.expectedTargetHeadSha !== currentHead || action.expectedUpstreamRef !== currentUpstream) throw branchManagementFailure('ASTRAGIT_GIT_BRANCH_REVIEW_CHANGED', '分支或跟踪关系已变化，请重新打开跟踪设置核对。');
      if (action.upstreamRef === localBranchRef(branch)) throw branchManagementFailure('ASTRAGIT_GIT_UPSTREAM_SELF', '分支不能跟踪自身，请选择另一个上游。');
      if (action.upstreamRef !== null) {
        const ref = requireSafeGitRef(action.upstreamRef, 'upstream');
        if (!ref.startsWith('refs/heads/') && !ref.startsWith('refs/remotes/')) throw branchManagementFailure('ASTRAGIT_GIT_UPSTREAM_INVALID', '上游必须是已存在的本地或远程跟踪分支。');
        await requireGitStdout(repositoryPath, ['check-ref-format', ref]);
        await resolveCommit(repositoryPath, ref);
      } else if (!currentUpstream && !await readGitStdout(repositoryPath, ['config', '--get-all', `branch.${branch}.merge`])) return finishProjectGitAction(repositoryPath, action.type, { stdout: '', stderr: '' });
      args = ['branch', ...(action.upstreamRef === null ? ['--unset-upstream'] : [`--set-upstream-to=${action.upstreamRef}`]), '--', branch];
      break;
    }
    case 'delete_remote_branch': {
      const remote = requireKnownRemote(context, action.remote);
      const branch = await assertGitBranchFormat(repositoryPath, action.branchName, 'remote branch');
      const trackingRef = `${remote}/${branch}`;
      if (!context.remoteBranches.includes(trackingRef) || !action.expectedTargetHeadSha || await resolveCommit(repositoryPath, `refs/remotes/${trackingRef}`) !== action.expectedTargetHeadSha) throw branchManagementFailure('ASTRAGIT_GIT_REMOTE_BRANCH_CHANGED', '远程跟踪分支已变化，请重新抓取并核对后再删除。');
      const push = await readRemotePushTarget(repositoryPath, remote);
      if (!push.urls.length || push.fingerprint !== action.expectedRemotePushFingerprint) throw branchManagementFailure('ASTRAGIT_GIT_REMOTE_TARGET_CHANGED', '远程推送目标已变化，请重新打开删除窗口核对。');
      const expected = requireGitObjectId(action.expectedTargetHeadSha, 'remote branch head');
      const deleteArgs = ['push', '--no-follow-tags', `--force-with-lease=refs/heads/${branch}:${expected}`, '--', remote, `:refs/heads/${branch}`];
      try { return await finishProjectGitAction(repositoryPath, action.type, await runGit(repositoryPath, deleteArgs)); }
      catch (error) {
        const log = gitErrorOutput(error);
        const candidate = error as { interrupted?: boolean; stderr?: string; stdout?: string };
        if (push.urls.length === 1 && !candidate.interrupted && /\[rejected\][^\n]*\(stale info\)/u.test(candidate.stderr ?? '')) throw Object.assign(branchManagementFailure('ASTRAGIT_GIT_REMOTE_BRANCH_CHANGED', '服务器上的分支已变化，删除被拒绝。请重新抓取并核对后再删除。'), { details: log });
        if (push.urls.length === 1 && !candidate.interrupted && /\[remote rejected\]/u.test(candidate.stderr ?? '')) throw Object.assign(branchManagementFailure('ASTRAGIT_GIT_REMOTE_DELETE_REJECTED', '服务器拒绝删除该分支，请查看分支保护或服务端检查。'), { details: log });
        throw Object.assign(gitCoreError('ASTRAGIT_GIT_REMOTE_DELETE_OUTCOME_UNKNOWN', '未能确认所有远程目标的删除结果，请逐一核对服务器分支，不要直接重复删除。', log), { operationStatus: 'unknown_after_write', operationStage: 'command' });
      }
    }
    case 'cherry_pick_series': {
      const preview = await getProjectGitCommitReplaySeriesPreview(repositoryPath, action.input);
      if (!/^[a-f0-9]{64}$/u.test(action.expectedFingerprint) || action.expectedFingerprint !== preview.fingerprint) throw gitCommitReplayFailure('PREVIEW_CHANGED', '所选提交、顺序、选项或本地内容已变化，请重新核对后执行。');
      return finishProjectGitAction(repositoryPath, action.type, await runGitPreservingConflict(repositoryPath, gitCommitReplaySeriesArguments(preview), undefined, preview.input.revisions.join('\n') + '\n'));
    }
    case 'revert':
    case 'cherry_pick': {
      const input = parseGitCommitReplayInput({ kind: action.type, revision: action.revision, ...(action.mainline !== undefined ? { mainline: action.mainline } : {}), ...(action.commit !== undefined ? { commit: action.commit } : {}), ...(action.includeSourceId !== undefined ? { includeSourceId: action.includeSourceId } : {}) });
      const preview = await getProjectGitCommitReplayPreview(repositoryPath, input);
      if (action.expectedFingerprint !== undefined && (!/^[a-f0-9]{64}$/u.test(action.expectedFingerprint) || action.expectedFingerprint !== preview.fingerprint)) throw gitCommitReplayFailure('PREVIEW_CHANGED', '提交来源、父级、选项或本地内容已变化，请重新预览后执行。');
      args = gitCommitReplayArguments(preview, action.mainline);
      break;
    }
    case 'merge': {
      if ((action.expectedHeadSha !== undefined && action.expectedHeadSha !== context.headSha) || (action.expectedBranch !== undefined && action.expectedBranch !== context.branch)) throw branchManagementFailure('ASTRAGIT_GIT_MERGE_TARGET_CHANGED', '合入分支或提交已变化，本次未合并。请关闭合并窗口并刷新后重新确认。');
      const source = await selectedBranchReference(repositoryPath, context, action.branchName);
      if (action.expectedSourceHeadSha !== undefined && action.expectedSourceHeadSha !== await resolveCommit(repositoryPath, source)) throw branchManagementFailure('ASTRAGIT_GIT_MERGE_SOURCE_CHANGED', '来源分支已变化，本次未合并。请关闭合并窗口并刷新后重新确认。');
      args = ['merge', '--no-edit', ...(action.commitMerge !== undefined ? [action.commitMerge ? '--commit' : '--no-commit'] : []), ...(action.includeMergeLog !== undefined ? [action.includeMergeLog ? '--log' : '--no-log'] : []), ...(action.noFastForward !== undefined ? [action.noFastForward ? '--no-ff' : '--ff'] : []), source];
      break;
    }
    case 'rebase':
      args = ['rebase', await selectedBranchReference(repositoryPath, context, action.branchName)];
      break;
    case 'stash':
      args = ['stash', 'push', ...(action.includeUntracked ? ['-u'] : []), ...(action.keepIndex ? ['--keep-index'] : []), '-m', requireSafeGitText(action.message || 'AstraGit shelf', 'stash message')];
      break;
    case 'apply_stash':
      args = ['stash', action.pop ? 'pop' : 'apply', requireStashRef(action.stashRef)];
      break;
    case 'drop_stash':
      args = ['stash', 'drop', requireStashRef(action.stashRef)];
      break;
  }
  const conflictCapable =
    action.type === 'skip_integration' ||
    (action.type === 'subtree' && action.operation === 'pull') ||
    action.type === 'continue_integration' ||
    action.type === 'pull' ||
    action.type === 'merge' ||
    action.type === 'rebase' ||
    action.type === 'apply_stash' ||
    action.type === 'revert' ||
    action.type === 'cherry_pick';
  const operation = () => (conflictCapable ? runGitPreservingConflict(repositoryPath, args, skippedStep) : runGit(repositoryPath, args));
  const switchingAction = action.type === 'checkout' || action.type === 'checkout_revision' || action.type === 'create_branch' ? action : null;
  const switchingStatus = switchingAction ? await getGitStatus(repositoryPath).catch(error => { throw Object.assign(error as object, { operationStage: 'preflight', operationStatus: 'failed_before_write' }); }) : null;
  if (switchingAction && switchingStatus?.conflictFiles.length) {
    const conflictLog = [
      '$ git status --porcelain --untracked-files=all',
      ...switchingStatus.fileStatuses.filter((file) => file.category === 'conflict').map((file) => `${file.indexStatus}${file.workingTreeStatus} ${file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}`),
    ].join('\n');
    throw Object.assign(gitCoreError('ASTRAGIT_GIT_CHECKOUT_CONFLICTED', `当前仓库存在未解决的冲突，无法切换到${projectGitSwitchTarget(switchingAction)}。请先处理并确认冲突文件；本次切换未执行。`, conflictLog), { operationStage: 'preflight', operationStatus: 'failed_before_write', affectedFiles: switchingStatus.conflictFiles.slice(0, 200), affectedFileCount: switchingStatus.conflictFiles.length });
  }
  if (switchingAction && await readIntegrationState(repositoryPath)) throw Object.assign(gitCoreError('ASTRAGIT_GIT_CHECKOUT_INTEGRATION_ACTIVE', '当前提交整合尚未结束，本次切换未执行。请先继续或终止当前整合。'), { operationStage: 'preflight', operationStatus: 'failed_before_write', affectedFiles: switchingStatus!.fileStatuses.map(file => file.path).slice(0, 200), affectedFileCount: switchingStatus!.fileStatuses.length });
  // 贮藏只由本次确认显式请求；保留该条目，不在目标分支自动恢复。
  let savedStash: string | null = null;
  if (switchingAction?.stashBeforeCheckout && switchingStatus!.fileStatuses.length) {
    if (switchingAction.type === 'checkout') await assertNamedBranchExists(repositoryPath, switchingAction.branchName);
    const previous = await readCommitIfPresent(repositoryPath, 'refs/stash');
    try {
      await runGit(repositoryPath, ['stash', 'push', '--include-untracked', '-m', `AstraGit: before switch from ${context.branch}`]);
      savedStash = await readCommitIfPresent(repositoryPath, 'refs/stash');
      if (!savedStash || savedStash === previous) throw new Error('Git did not confirm a new stash.');
      const remaining = await getGitStatus(repositoryPath);
      if (remaining.fileStatuses.length) throw new Error('Some local changes remain after stashing. Check submodule changes in their own repositories.');
    } catch (error) {
      const retained = savedStash ?? await readCommitIfPresent(repositoryPath, 'refs/stash');
      throw Object.assign(gitCoreError('ASTRAGIT_GIT_CHECKOUT_STASH_OUTCOME_UNKNOWN', '贮藏步骤未确认完成，尚未执行分支切换。请刷新并核对文件与贮藏列表，避免重复贮藏。', gitErrorOutput(error)), { operationStage: 'stash', operationStatus: 'unknown_after_write', ...(retained && retained !== previous ? { savedStash: retained } : {}) });
    }
  }
  try {
    const output = await operation();
    return await finishProjectGitAction(repositoryPath, action.type, { ...output, ...(savedStash ? { savedStash } : {}) });
  } catch (error) {
    if (savedStash) throw Object.assign(gitCoreError('ASTRAGIT_GIT_CHECKOUT_FAILED_STASH_PRESERVED', '本地修改已保存在贮藏中，但尚未确认切换完成。请刷新核对当前分支，再到贮藏区查看；不会自动恢复或删除贮藏。', gitErrorOutput(error)), { savedStash, operationStage: 'command', operationStatus: 'unknown_after_write' });
    if (switchingAction) throw classifyGitSwitchFailure(switchingAction, args, error, switchingStatus!.fileStatuses.flatMap(file => [file.path, ...(file.originalPath ? [file.originalPath] : [])]));
    throw error;
  }
}

type ProjectGitSwitchAction = Extract<ProjectGitAction, { type: 'checkout' | 'checkout_revision' | 'create_branch' }>;

function branchManagementFailure(code: string, message: string): Error & { code: string } {
  return Object.assign(gitCoreError(code, message), { operationStage: 'preflight', operationStatus: 'failed_before_write' });
}

async function selectedBranchReference(cwd: string, context: GitRepositoryContext, value: string): Promise<string> {
  const branch = await assertGitBranchFormat(cwd, value, 'branch');
  if (branch.startsWith('refs/heads/') || branch.startsWith('refs/remotes/')) {
    await requireGitStdout(cwd, ['show-ref', '--verify', '--hash', branch]).catch(() => { throw branchManagementFailure('ASTRAGIT_GIT_BRANCH_NOT_FOUND', '所选分支已不存在，请刷新分支列表。'); });
    return branch;
  }
  if (context.localBranches.includes(branch)) return localBranchRef(branch);
  if (context.remoteBranches.includes(branch)) return `refs/remotes/${branch}`;
  return branch;
}

function projectGitSwitchTarget(action: ProjectGitSwitchAction): string {
  if (action.type === 'checkout') return `分支“${action.branchName}”`;
  if (action.type === 'checkout_revision') return `所选提交“${action.revision}”`;
  return `新分支“${action.branchName}”`;
}

/** 把 Git 的保护性拒绝转换为可执行的用户提示；原始输出只进入详情，不作为摘要。 */
function classifyGitSwitchFailure(action: ProjectGitSwitchAction, args: string[], error: unknown, knownPaths: string[]): Error & { code: string; details?: string } {
  const existing = error as { code?: unknown } | null;
  if (typeof existing?.code === 'string' && existing.code !== 'ASTRAGIT_GIT_COMMAND_FAILED' && existing.code !== 'ASTRAGIT_GIT_LOCAL_CHANGES_BLOCKED') return error as Error & { code: string; details?: string };
  const output = gitErrorOutput(error);
  const command = formatGitCommand(args, false);
  const details = [`$ ${command}`, output].join('\n');
  const rejected = (code: string, message: string, blockedBy?: string) => Object.assign(gitCoreError(code, message, details), { command, operationStage: 'command', operationStatus: 'failed_before_write', ...(blockedBy ? { blockedBy } : {}) });
  const target = projectGitSwitchTarget(action);
  if (/(?:already (?:used by|checked out(?: in| at)?|in use).*worktree|is already used by worktree|is already checked out)/iu.test(output)) {
    return rejected('ASTRAGIT_GIT_CHECKOUT_BRANCH_IN_USE', `无法切换到${target}：该分支已在其他工作区中使用。请先在其他工作区切换到别的分支，或在对应工作区继续操作；本次切换未执行。`);
  }
  const trackedChanges =
    /(?:local changes to the following files would be overwritten by (?:checkout|switch)|your local changes[\s\S]*would be overwritten by (?:checkout|switch)|please commit your changes or stash them before you switch branches)/iu.test(
      output,
    );
  const untrackedFiles = /(?:following )?untracked working tree files would be overwritten by (?:checkout|switch)/iu.test(output);
  if (trackedChanges || untrackedFiles) {
    const kind = trackedChanges && untrackedFiles ? '未提交修改和未跟踪文件' : trackedChanges ? '未提交修改' : '未跟踪文件';
    return Object.assign(rejected('ASTRAGIT_GIT_CHECKOUT_BLOCKED', `无法切换到${target}：当前工作区的${kind}会被目标内容覆盖。切换未执行；请先提交、贮藏（包含相关未跟踪文件），或检查后放弃/移开相关文件。`, trackedChanges && untrackedFiles ? 'both' : trackedChanges ? 'tracked' : 'untracked'), gitOverwriteFiles(output, knownPaths));
  }
  if (/invalid reference|invalid branch name|pathspec [^\n]*did not match|not a valid object name/iu.test(output)) return rejected('ASTRAGIT_GIT_BRANCH_NOT_FOUND', `找不到${target}，请刷新分支列表后重试。`);
  return Object.assign(gitCoreError('ASTRAGIT_GIT_SWITCH_FAILED', `切换到${target}未完成，Git 未确认是否修改了工作区。请刷新仓库状态并查看错误详情后再继续。`, details), { command, operationStage: 'command', operationStatus: 'unknown_after_write' });
}

/** Only read paths from Git's overwrite diagnostic blocks, never arbitrary log lines. */
function gitOverwriteFiles(output: string, knownPaths: string[]): { affectedFiles: string[]; affectedFileCount: number } {
  const paths = new Set<string>();
  const known = new Set(knownPaths);
  // Some Git versions print these paths verbatim, including embedded newlines.
  // Prefer the longest canonical status path so a file named "a" is not confused
  // with a different file named "a\nb". Never offer a path inferred from a log.
  const names = [...known].sort((a, b) => b.length - a.length);
  let inFiles = false;
  for (let offset = 0; offset < output.length;) {
    const end = output.indexOf('\n', offset);
    const line = output.slice(offset, end < 0 ? output.length : end);
    const start = offset;
    offset = end < 0 ? output.length : end + 1;
    if (/(?:following files|untracked working tree files) would be overwritten by (?:checkout|switch|merge):\s*$/iu.test(line)) { inFiles = true; continue; }
    if (!inFiles) continue;
    if (!line.startsWith('\t')) { inFiles = false; continue; }
    const literal = names.find(path => output.startsWith(`\t${path}\n`, start));
    const path = literal ?? decodeGitDiagnosticPath(line.slice(1));
    if (literal) offset = start + literal.length + 2;
    if (path && known.has(path) && !path.includes('\0') && !path.startsWith('/') && !path.split('/').includes('..')) paths.add(path);
  }
  return { affectedFiles: [...paths].slice(0, 200), affectedFileCount: paths.size };
}

/** Git C-quotes UTF-8 octets, tabs and newlines even when a filename is valid. */

function gitErrorOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error : 'Git 命令执行失败。';
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return (
    [candidate.stderr, candidate.stdout, candidate.message]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value) => value.trim())
      .join('\n') || 'Git 命令执行失败。'
  );
}

async function finishProjectGitAction(repositoryPath: string, action: ProjectGitAction['type'], output: GitRunnerResult): Promise<ProjectGitActionResult> {
  let nextContext: GitRepositoryContext;
  let nextStatus: GitStatusSummary;
  try {
    nextContext = await getGitRepositoryContext(repositoryPath);
    if (!nextContext.isRepository) throw new Error('Git repository is no longer available.');
    nextStatus = await getGitStatus(repositoryPath);
    if (!nextStatus.isRepository) throw new Error('Git status could not be read after the action.');
  } catch (error) {
    throw Object.assign(gitCoreError('ASTRAGIT_GIT_ACTION_STATE_READ_FAILED', 'Git 命令已结束，但读取操作后状态失败。请刷新核对结果，避免重复执行。', [gitErrorOutput(error), output.stdout, output.stderr].filter(Boolean).join('\n')), { cause: error, operationStage: 'refresh', operationStatus: 'unknown_after_write' });
  }
  return {
    action,
    outcome: nextStatus.conflictFiles.length > 0 ? 'conflict' : 'completed',
    branch: nextContext.branch,
    headSha: nextContext.headSha,
    conflictFiles: nextStatus.conflictFiles,
    stdout: redactGitOutput(output.stdout),
    stderr: redactGitOutput(output.stderr),
    ...(output.operationStage ? { operationStage: output.operationStage } : {}),
    ...(output.savedStash ? { savedStash: output.savedStash } : {}),
  };
}

async function executeProjectGitUpdate(repositoryPath: string, strategy: 'merge' | 'rebase' | 'reset', smart: boolean): Promise<GitRunnerResult> {
  const context = await getGitRepositoryContext(repositoryPath);
  requireNamedCurrentBranch(context);
  const upstream = await readGitStdout(repositoryPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!upstream) throw gitCoreError('ASTRAGIT_GIT_UPSTREAM_REQUIRED', `Current branch ${context.branch} does not track a remote branch.`);
  await resolveCommit(repositoryPath, upstream);
  const operation = async (): Promise<GitRunnerResult> => {
    const fetched = await runGit(repositoryPath, ['fetch', '--all', '--prune']);
    try {
      const integrated =
        strategy === 'reset'
          ? await runGit(repositoryPath, ['reset', '--hard', upstream])
          : strategy === 'rebase'
            ? await runGitPreservingConflict(repositoryPath, ['rebase', upstream])
            : await runGitPreservingConflict(repositoryPath, ['merge', '--no-edit', upstream]);
      return combineGitRunnerResults(fetched, integrated);
    } catch (error) {
      // 抓取已经完成；即使后续集成被保护性拒绝，也不能把整次更新说成未写入。
      if (error instanceof Error) Object.assign(error, { operationStatus: 'unknown_after_write' });
      throw error;
    }
  };
  return smart ? runWithSmartStash(repositoryPath, 'Smart Update', operation) : operation();
}

async function runWithSmartStash(repositoryPath: string, label: string, operation: () => Promise<GitRunnerResult>): Promise<GitRunnerResult> {
  const before = await getGitStatus(repositoryPath);
  if (!before.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', '仓库已不可用，请重新载入后再更新。');
  if (before.conflictFiles.length > 0) throw gitCoreError('ASTRAGIT_GIT_CONFLICT_IN_PROGRESS', 'Resolve the current Git conflicts before starting another smart operation.');
  if (before.clean) return operation();
  const message = `AstraGit ${label} ${new Date().toISOString()}`;
  const saved = await runGit(repositoryPath, ['stash', 'push', '-u', '-m', message]);
  const stashHash = await requireGitStdout(repositoryPath, ['rev-parse', 'refs/stash']);
  let operated: GitRunnerResult;
  try {
    operated = await operation();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Git operation failed.';
    const operatedStatus = await readSmartOperationStatus(repositoryPath, stashHash, error);
    if (operatedStatus.conflictFiles.length === 0) {
      try {
        const restoration = await restoreSmartStash(repositoryPath, stashHash);
        if (restoration.conflict) return combineGitRunnerResults(saved, restoration.output, { stdout: '', stderr: `${reason} Restoring local changes caused conflicts; stash ${stashHash.slice(0, 8)} was preserved.`, operationStage: 'restore', savedStash: stashHash });
        throw Object.assign(gitCoreError('ASTRAGIT_GIT_SMART_OPERATION_FAILED_RESTORED', '更新未完成，已恢复先前贮藏的本地修改。请刷新并核对更新结果。', gitErrorOutput(error)), { cause: error, operationStage: 'restore', operationStatus: 'unknown_after_write' });
      } catch (restoreError) {
        if (restoreError instanceof Error && 'code' in restoreError && restoreError.code === 'ASTRAGIT_GIT_SMART_OPERATION_FAILED_RESTORED') throw restoreError;
        const restoreReason = restoreError instanceof Error ? restoreError.message : 'Local changes could not be restored.';
        throw Object.assign(gitCoreError('ASTRAGIT_GIT_SMART_OPERATION_FAILED_STASH_PRESERVED', `更新及恢复本地修改未完成；先前修改仍保存在贮藏 ${stashHash.slice(0, 8)}，请刷新状态后检查。`, `${gitErrorOutput(error)}\n${restoreReason}`), { cause: error, operationStage: 'restore', operationStatus: 'unknown_after_write', savedStash: stashHash });
      }
    }
    throw Object.assign(gitCoreError('ASTRAGIT_GIT_SMART_OPERATION_FAILED_STASH_PRESERVED', `更新未完成；先前修改仍保存在贮藏 ${stashHash.slice(0, 8)}，请先处理当前冲突。`, gitErrorOutput(error)), { cause: error, operationStage: 'integration', operationStatus: 'unknown_after_write', savedStash: stashHash });
  }
  const operatedStatus = await readSmartOperationStatus(repositoryPath, stashHash);
  if (operatedStatus.conflictFiles.length > 0) {
    return combineGitRunnerResults(saved, operated, {
      stdout: '',
      stderr: `Local changes remain saved in stash ${stashHash.slice(0, 8)} until the update conflict is resolved.`,
      operationStage: 'integration', savedStash: stashHash,
    });
  }
  let restoration: Awaited<ReturnType<typeof restoreSmartStash>>;
  try { restoration = await restoreSmartStash(repositoryPath, stashHash); }
  catch (error) {
    throw Object.assign(gitCoreError('ASTRAGIT_GIT_SMART_RESTORE_FAILED', `更新命令已完成，但恢复本地修改未完成；先前修改仍保存在贮藏 ${stashHash.slice(0, 8)}。请刷新并核对仓库状态。`, gitErrorOutput(error)), { cause: error, operationStage: 'restore', operationStatus: 'unknown_after_write', savedStash: stashHash });
  }
  if (restoration.conflict) {
    return combineGitRunnerResults(saved, operated, restoration.output, {
      stdout: '',
      stderr: `Restoring local changes caused conflicts. Stash ${stashHash.slice(0, 8)} was preserved.`,
      operationStage: 'restore', savedStash: stashHash,
    });
  }
  return combineGitRunnerResults(saved, operated, restoration.output);
}

async function readSmartOperationStatus(repositoryPath: string, stashHash: string, operationError?: unknown): Promise<GitStatusSummary> {
  try {
    const status = await getGitStatus(repositoryPath);
    if (!status.isRepository) throw gitCoreError('ASTRAGIT_GIT_STATE_READ_FAILED', '更新后仓库已不可用。');
    return status;
  } catch (error) {
    throw Object.assign(gitCoreError('ASTRAGIT_GIT_SMART_STATUS_UNCONFIRMED', `更新后未能核实仓库状态，先前本地修改保存在贮藏 ${stashHash.slice(0, 8)}。请刷新并核对；本次没有继续自动恢复或删除贮藏。`, [operationError ? gitErrorOutput(operationError) : '', gitErrorOutput(error)].filter(Boolean).join('\n')), { cause: error, operationStage: 'refresh', operationStatus: 'unknown_after_write', savedStash: stashHash });
  }
}

async function restoreSmartStash(repositoryPath: string, stashHash: string): Promise<{ output: GitRunnerResult; conflict: boolean }> {
  const restored = await runGitPreservingConflict(repositoryPath, ['stash', 'apply', '--index', stashHash]);
  const restoredStatus = await getGitStatus(repositoryPath);
  if (!restoredStatus.isRepository) throw gitCoreError('ASTRAGIT_GIT_STATE_READ_FAILED', '恢复命令已结束，但仓库状态不可读，未删除贮藏。');
  if (restoredStatus.conflictFiles.length > 0) return { output: restored, conflict: true };
  const stashList = await readGitStdout(repositoryPath, ['stash', 'list', '--format=%gd%x1f%H']);
  const stashRef = splitLines(stashList)
    .map((line) => line.split('\x1f'))
    .find(([, hash]) => hash === stashHash)?.[0];
  let dropped: GitRunnerResult = { stdout: '', stderr: '' };
  if (stashRef) {
    try {
      dropped = await runGit(repositoryPath, ['stash', 'drop', stashRef]);
    } catch (error) {
      dropped = { stdout: '', stderr: `Local changes were restored, but temporary stash ${stashHash.slice(0, 8)} could not be removed: ${error instanceof Error ? error.message : 'unknown error'}` };
    }
  }
  return { output: combineGitRunnerResults(restored, dropped), conflict: false };
}

function combineGitRunnerResults(...results: GitRunnerResult[]): GitRunnerResult {
  const lastStage = [...results].reverse().find((result) => result.operationStage)?.operationStage;
  const lastStash = [...results].reverse().find((result) => result.savedStash)?.savedStash;
  return {
    stdout: results
      .map((result) => result.stdout.trim())
      .filter(Boolean)
      .join('\n'),
    stderr: results
      .map((result) => result.stderr.trim())
      .filter(Boolean)
      .join('\n'),
    ...(lastStage ? { operationStage: lastStage } : {}),
    ...(lastStash ? { savedStash: lastStash } : {}),
  };
}

function requireNamedCurrentBranch(context: GitRepositoryContext): string {
  if (context.detached) throw gitCoreError('ASTRAGIT_GIT_NAMED_BRANCH_REQUIRED', 'This action requires a current named branch. Create or check out a local branch first.');
  return context.branch;
}

/** 读取一个精确提交或贮藏的文件和差异，供独立 Repository Diff 与历史检查器复用。 */
export async function getProjectGitCommitDetail(cwd: string, commitHash: string): Promise<ProjectGitCommitDetail> {
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected directory is not a Git repository.');
  const requestedRevision = commitHash.trim();
  const stashRef = /^stash@\{\d+\}$/u.test(requestedRevision) ? requireStashRef(requestedRevision) : null;
  const commit = await resolveCommit(context.topLevel, stashRef ?? requestedRevision);
  const reader = gitDiffReader(context.topLevel, fileHistoryRuntime());
  const [rawMetadata, numstat] = await Promise.all([
    readGitDiffMetadata(reader, ['show', '-s', '--date=iso-strict', '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P%x00%B%x00', commit]),
    readGitDiffMetadata(reader, stashRef
      ? ['stash', 'show', '--include-untracked', ...gitDisplayDiffMetadataOptions, '--numstat', '-z', commit]
      : ['show', '--format=', ...gitDisplayDiffMetadataOptions, '--diff-merges=first-parent', '--numstat', '-z', commit]),
  ]);
  // The trailing record separator is followed by show's output newline, not part of the message.
  const metadata = rawMetadata.replace(/\r?\n$/u, '');
  const fields = metadata.split('\0');
  if (fields.length !== 8) throw gitCoreError('ASTRAGIT_GIT_DIFF_READ_FAILED', '无法完整读取提交元数据，请重新读取。');
  const [hash = commit, shortHash = commit.slice(0, 8), subject = '', author = '', authoredAt = '', parents = '', fullMessage = ''] = fields;
  const files = parseGitNumStat(numstat, true);
  const diff = await readGitDisplayDiff(reader, stashRef
    ? ['stash', 'show', '--include-untracked', '--patch', ...gitDisplayDiffOptions, commit]
    : ['show', '--format=', ...gitDisplayDiffOptions, '--diff-merges=first-parent', commit], files.map(file => file.path));
  if (!stashRef && parents.split(' ').filter(Boolean).length > 1) diff.comparisonParent = parents.split(' ')[0];
  return {
    commit: { hash, shortHash, subject, author, authoredAt, parentHashes: splitLines(parents.replace(/\s+/gu, '\n')) },
    body: fullMessage.trim(),
    fullMessage,
    parentHashes: splitLines(parents.replace(/\s+/gu, '\n')),
    files,
    diff,
  };
}

/** 读取所选分支与当前分支或工作区的差异；只解析受 Git 校验的 ref。 */
export async function getProjectGitComparisonDiff(cwd: string, branchName: string, mode: 'current' | 'working-tree'): Promise<GitDiffSummary> {
  const context = await getGitRepositoryContext(cwd);
  if (!context.isRepository) throw gitCoreError('ASTRAGIT_GIT_REPOSITORY_REQUIRED', 'The selected directory is not a Git repository.');
  const revision = await resolveCommit(context.topLevel, branchName);
  const reader = gitDiffReader(context.topLevel, fileHistoryRuntime());
  const scope = mode === 'working-tree' ? [revision] : [revision, await resolveCommit(context.topLevel, 'HEAD')];
  const names = await readGitDiffMetadata(reader, ['diff', ...gitDisplayDiffMetadataOptions, '--name-only', '-z', ...scope, '--', '.']);
  return readGitDisplayDiff(reader, ['diff', ...gitDisplayDiffOptions, ...scope, '--', '.'], splitNullRecords(names));
}

/** Compare two selected commits directly, never via HEAD or their merge base. */
export async function getProjectGitRevisionsDiff(cwd: string, revisions: [string, string], signal?: AbortSignal): Promise<GitRevisionComparison> {
  if (!Array.isArray(revisions) || revisions.length !== 2 || revisions.some(ref => typeof ref !== 'string' || !ref || ref.length > 4096 || ref.includes('\0'))) throw gitCoreError('ASTRAGIT_GIT_COMPARISON_INVALID', '请选择两个有效提交进行比较。');
  const reader = gitDiffReader(cwd, fileHistoryRuntime(signal));
  await reader.initialize();
  const fixed = await Promise.all(revisions.map(ref => reader.revision(ref))) as [string, string];
  if (fixed.some(ref => !ref)) throw gitCoreError('ASTRAGIT_GIT_COMPARISON_INVALID', '所选版本还没有提交，无法进行两提交比较。');
  const numstat = await readGitDiffMetadata(reader, ['diff', ...gitDisplayDiffMetadataOptions, '--numstat', '-z', ...fixed, '--', '.']);
  const files = parseGitNumStat(numstat, true);
  const diff = await readGitDisplayDiff(reader, ['diff', ...gitDisplayDiffOptions, ...fixed, '--', '.'], files.map(file => file.path));
  return { revisions: fixed, files, diff };
}

/** 读取文件当前版本的逐行归属；只读命令不修改工作区、索引或引用。 */
export async function getFileBlame(cwd: string, filePath: string, ref?: string, expectedSha256?: string): Promise<GitFileBlame> {
  const projectRoot = canonicalFilesystemPath(cwd);
  const requestedPath = filePath;
  if (!requestedPath || requestedPath.includes('\0') || isAbsolute(requestedPath) || requestedPath.includes('\\')) {
    throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', 'A source file path must be a safe relative path.');
  }
  const normalizedPath = requestedPath;
  const pathSegments = normalizedPath.split(sep).filter(Boolean);
  if (pathSegments.some((segment) => segment === '.' || segment === '..' || segment === '.git')) {
    throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Invalid source file path: ${filePath}`);
  }
  const absolutePath = canonicalFilesystemPath(resolve(projectRoot, normalizedPath));
  if (!isPathInside(projectRoot, absolutePath) || absolutePath === projectRoot) {
    throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Source file path escapes the selected project: ${filePath}`);
  }

  if (relative(projectRoot, absolutePath).split(sep).includes('.git')) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', '不能读取 Git 管理目录的归属。');
  const path = relative(projectRoot, absolutePath).split(sep).join('/');
  const requestedRef = ref?.trim() || undefined;
  const unavailable = (unavailableReason: NonNullable<GitFileBlame['unavailableReason']>): GitFileBlame => ({ path, lines: [], unavailableReason });
  const verifyContent = async () => {
    if (expectedSha256 === undefined) return;
    if (requestedRef || !/^[a-f0-9]{64}$/u.test(expectedSha256)) throw gitCoreError('ASTRAGIT_GIT_BLAME_REVISION_INVALID', '源码版本校验参数无效。');
    const bytes = await readFile(absolutePath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    // 会话预览的 UTF-8 解码会去除 BOM，兼容正文摘要和项目编辑器的原始字节摘要。
    const previewHash = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? createHash('sha256').update(bytes.subarray(3)).digest('hex') : actual;
    if (actual !== expectedSha256 && previewHash !== expectedSha256) throw gitCoreError('ASTRAGIT_GIT_BLAME_STALE', '文件内容已经变化，请重新打开文件后查看归属。');
  };
  await verifyContent();

  const readGit = (directory: string, args: string[]) => execFileAsync('git', args, { cwd: directory, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  const readFailure = (error: unknown) => {
    const detail = redactGitOutput(commandFailureDetail(error));
    // Electron IPC 不保留 Error 自定义字段，原因也要进入消息，界面才能展示实际故障。
    return gitCoreError('ASTRAGIT_GIT_BLAME_FAILED', `无法读取文件归属：${detail}`, detail);
  };

  // 文件可能位于子模块或独立子仓库，只发现所属仓库，不读取整个仓库的分支和工作树清单。
  let repositoryRoot: string;
  try {
    const { stdout } = await readGit(dirname(absolutePath), ['rev-parse', '--show-toplevel']);
    repositoryRoot = canonicalFilesystemPath(stdout.replace(/\r?\n$/u, ''));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 128 && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.startsWith('fatal: not a git repository')) return unavailable('not_repository');
    throw readFailure(error);
  }
  if (!isPathInside(repositoryRoot, absolutePath) || absolutePath === repositoryRoot) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Source file path is outside the Git repository: ${filePath}`);
  const repositoryPath = relative(repositoryRoot, absolutePath);
  if (!repositoryPath || isAbsolute(repositoryPath) || repositoryPath === '..' || repositoryPath.startsWith(`..${sep}`)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Invalid repository-relative source path: ${filePath}`);

  const revision = requestedRef ? await resolveCommit(repositoryRoot, requestedRef) : undefined;
  if (!revision) {
    try {
      await readGit(repositoryRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 1) return unavailable('no_commits');
      throw readFailure(error);
    }
  }
  const args = ['-c', 'core.quotePath=false', '--no-pager', 'blame', '--line-porcelain', ...(revision ? [revision] : []), '--', repositoryPath];
  let stdout: string;
  try {
    ({ stdout } = await readGit(repositoryRoot, args));
  } catch (error) {
    // 先让 Git 追溯索引中的重命名；失败后再区分文件没有历史，避免提前丢掉可追溯的归属。
    try {
      const tree = await readGit(repositoryRoot, ['--literal-pathspecs', 'ls-tree', '-z', revision ?? 'HEAD', '--', repositoryPath]);
      if (!tree.stdout) {
        await verifyContent();
        return unavailable(revision ? 'not_in_revision' : 'uncommitted_file');
      }
    } catch (checkError) {
      if (checkError && typeof checkError === 'object' && 'code' in checkError && checkError.code === 'ASTRAGIT_GIT_BLAME_STALE') throw checkError;
      throw readFailure(checkError);
    }
    throw readFailure(error);
  }
  await verifyContent();
  return { path, lines: parseGitBlamePorcelain(stdout) };
}

/** 解析 `git blame --line-porcelain` 的记录块，兼容多行归属块和逐行归属输出。 */
export function parseGitBlamePorcelain(stdout: string): GitBlameLine[] {
  const records = stdout.split('\n');
  const result: GitBlameLine[] = [];
  let index = 0;
  while (index < records.length) {
    const header = records[index]?.match(/^([0-9a-f]{40,64})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/u);
    if (!header) {
      index += 1;
      continue;
    }
    index += 1;
    const metadata: Record<string, string> = {};
    while (index < records.length && !records[index]!.startsWith('\t')) {
      const separator = records[index]!.indexOf(' ');
      if (separator > 0) metadata[records[index]!.slice(0, separator)] = records[index]!.slice(separator + 1);
      index += 1;
    }
    const firstLine = Number.parseInt(header[3]!, 10);
    const lineCount = Math.max(1, Number.parseInt(header[4] ?? '1', 10) || 1);
    const authorTime = Number.parseInt(metadata['author-time'] ?? '', 10);
    for (let offset = 0; offset < lineCount && index < records.length; offset += 1) {
      if (!records[index]!.startsWith('\t')) break;
      index += 1;
      const commitHash = header[1]!;
      result.push({
        commitHash,
        shortHash: commitHash.slice(0, 8),
        author: metadata.author?.trim() || 'Unknown',
        authorTime: Number.isFinite(authorTime) ? authorTime : 0,
        subject: metadata.summary?.trim() || '',
        line: firstLine + offset,
      });
    }
  }
  return result;
}

function parseProjectGitStashes(stdout: string): ProjectGitStashEntry[] {
  return splitLines(stdout)
    .map((line) => {
      const [ref = '', hash = '', subject = '', author = '', authoredAt = ''] = line.split('\x1f');
      return { ref, hash, subject, author, authoredAt };
    })
    .filter((entry) => entry.ref.length > 0 && entry.hash.length > 0);
}

/** Git 一次性返回所有本地分支的上游及差异，避免为每个分支额外启动 rev-list。 */
function parseProjectGitBranchTracking(stdout: string): {
  upstreams: Record<string, string>;
  divergences: Record<string, { ahead: number; behind: number }>;
  upstreamRefs: Record<string, string>;
  localHeads: Record<string, string>;
  remoteHeads: Record<string, string>;
} {
  const rows = splitLines(stdout).map((line) => {
    const [branch = '', upstream = '', track = '', head = '', upstreamRef = '', ref = '', symbolic = ''] = line.split('\t');
    const ahead = Number.parseInt(track.match(/\bahead (\d+)\b/u)?.[1] ?? '0', 10) || 0;
    const behind = Number.parseInt(track.match(/\bbehind (\d+)\b/u)?.[1] ?? '0', 10) || 0;
    return { branch, upstream, ahead, behind, head, upstreamRef, ref, symbolic };
  });
  const local = rows.filter(row => row.ref.startsWith('refs/heads/'));
  return {
    upstreams: Object.fromEntries(local.map(row => [row.ref.slice(11), row.upstream])),
    divergences: Object.fromEntries(local.filter(row => row.upstream).map(row => [row.ref.slice(11), { ahead: row.ahead, behind: row.behind }])),
    upstreamRefs: Object.fromEntries(local.map(row => [row.ref.slice(11), row.upstreamRef])),
    localHeads: Object.fromEntries(local.filter(row => /^[a-f0-9]{40,64}$/u.test(row.head)).map(row => [row.ref.slice(11), row.head])),
    remoteHeads: Object.fromEntries(rows.filter(row => row.ref.startsWith('refs/remotes/') && !(row.symbolic && row.ref.endsWith('/HEAD')) && /^[a-f0-9]{40,64}$/u.test(row.head)).map(row => [row.ref.slice(13), row.head])),
  };
}

async function readProjectGitRecentRefs(cwd: string, reflog: string, context: GitRepositoryContext, tags: string[]): Promise<ProjectGitRecentRef[]> {
  const local = new Set(context.localBranches);
  const remote = new Set(context.remoteBranches);
  const tagSet = new Set(tags);
  const candidates = splitLines(reflog)
    .flatMap((subject) => {
      const match = /^checkout: moving from .+ to (.+)$/u.exec(subject);
      return match?.[1]?.trim() ? [match[1].trim()] : [];
    })
    .filter((ref, index, values) => ref !== context.branch && values.indexOf(ref) === index)
    .slice(0, 12);
  const resolved = await Promise.all(
    candidates.map(async (ref): Promise<ProjectGitRecentRef | null> => {
      const kind: ProjectGitRecentRef['kind'] = local.has(ref) ? 'local' : remote.has(ref) ? 'remote' : tagSet.has(ref) ? 'tag' : 'revision';
      try {
        await resolveCommit(cwd, ref);
        return { ref, kind };
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((item): item is ProjectGitRecentRef => item !== null);
}

function requireKnownRemote(context: GitRepositoryContext, requested?: string): string {
  const remote = requested?.trim() || (context.remotes.includes('origin') ? 'origin' : context.remotes[0]);
  if (!remote || remote.startsWith('-') || remote.includes('\0') || !context.remotes.includes(remote)) throw gitCoreError('ASTRAGIT_GIT_REMOTE_REQUIRED', 'A configured repository remote is required.');
  return remote;
}

function requireRepositoryPaths(repositoryPath: string, paths: string[]): string[] {
  const normalized = Array.from(new Set(paths));
  if (normalized.length === 0) throw gitCoreError('ASTRAGIT_GIT_PATH_REQUIRED', 'At least one repository path is required.');
  for (const path of normalized) {
    if (!path || isAbsolute(path) || path.includes('\0')) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Invalid repository path: ${path}`);
    const target = resolve(repositoryPath, path);
    const targetRelative = relative(repositoryPath, target);
    if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) throw gitCoreError('ASTRAGIT_GIT_PATH_INVALID', `Repository path is outside the selected repository: ${path}`);
  }
  return normalized;
}

function requireStashRef(value: string): string {
  const normalized = value.trim();
  if (!/^stash@\{\d+\}$/u.test(normalized)) throw gitCoreError('ASTRAGIT_GIT_STASH_REF_INVALID', `Invalid stash reference: ${normalized}`);
  return normalized;
}

/** 只读获取指定目录此刻所在的 Git 分支，供会话界面展示真实执行现场。 */
export async function getGitWorkingContext(cwd: string): Promise<GitWorkingContext> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd })).stdout.trim();
    return { isRepository: true, branch: branch || 'detached' };
  } catch {
    return { isRepository: false, branch: null };
  }
}

/** 解析 `git status --porcelain` 输出，提供设计书要求的新增/修改/删除/冲突等只读状态分类。 */
export function parseGitPorcelainStatus(porcelain: string): Pick<GitStatusSummary, 'clean' | 'changedFiles' | 'conflictFiles' | 'fileStatuses'> {
  const fileStatuses = parseGitPorcelainEntries(porcelain);
  const changedFiles = fileStatuses.map((item) => item.path);
  const conflictFiles = fileStatuses.filter((item) => item.category === 'conflict').map((item) => item.path);
  return {
    clean: changedFiles.length === 0,
    changedFiles,
    conflictFiles,
    fileStatuses,
  };
}

function parseGitPorcelainEntries(porcelain: string): GitFileStatus[] {
  if (!porcelain.includes('\0')) {
    return porcelain
      .split(/\r?\n/u)
      .filter((line) => line.length >= 3)
      .map(parseGitPorcelainLine);
  }
  const records = porcelain.split('\0');
  const statuses: GitFileStatus[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (record.length < 3) continue;
    const indexStatus = record[0] ?? ' ';
    const workingTreeStatus = record[1] ?? ' ';
    const path = record.slice(3);
    const renamed = indexStatus === 'R' || indexStatus === 'C' || workingTreeStatus === 'R' || workingTreeStatus === 'C';
    const originalPath = renamed ? records[++index] : undefined;
    statuses.push({
      path,
      ...(originalPath ? { originalPath } : {}),
      indexStatus,
      workingTreeStatus,
      category: classifyGitFileStatus(indexStatus, workingTreeStatus),
    });
  }
  return statuses;
}

function parseGitPorcelainLine(line: string): GitFileStatus {
  const indexStatus = line[0] ?? ' ';
  const workingTreeStatus = line[1] ?? ' ';
  const rawPath = line.slice(3);
  const [originalPath, renamedPath] = rawPath.split(' -> ');
  const path = renamedPath ?? originalPath;
  return {
    path,
    ...(renamedPath ? { originalPath } : {}),
    indexStatus,
    workingTreeStatus,
    category: classifyGitFileStatus(indexStatus, workingTreeStatus),
  };
}

function classifyGitFileStatus(indexStatus: string, workingTreeStatus: string): GitFileStatusCategory {
  const code = `${indexStatus}${workingTreeStatus}`;
  if (indexStatus === '?' && workingTreeStatus === '?') return 'untracked';
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code) || indexStatus === 'U' || workingTreeStatus === 'U') return 'conflict';
  if (indexStatus === 'R' || workingTreeStatus === 'R') return 'renamed';
  if (indexStatus === 'A' || workingTreeStatus === 'A') return 'added';
  if (indexStatus === 'D' || workingTreeStatus === 'D') return 'deleted';
  if (indexStatus === 'M' || workingTreeStatus === 'M') return 'modified';
  return 'other';
}

async function readGitStdout(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return (await readGitRawStdout(cwd, args, env)).trim();
}

async function readGitRawStdout(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    return (await execFileAsync('git', args, { cwd, env, timeout: 30_000, maxBuffer: 20 * 1024 * 1024 })).stdout;
  } catch {
    return '';
  }
}

function parseRecentCommits(stdout: string): GitRecentCommit[] {
  return splitLines(stdout)
    .map((line) => {
      const [hash = '', shortHash = '', subject = '', author = '', authoredAt = '', parents = ''] = line.split('\x1f');
      return { hash, shortHash, subject, author, authoredAt, parentHashes: parents.trim() ? parents.trim().split(/\s+/u) : [] };
    })
    .filter((commit) => commit.hash.length > 0);
}

function emptyGitStatus(): GitStatusSummary {
  return {
    isRepository: false,
    branch: '',
    clean: true,
    changedFiles: [],
    conflictFiles: [],
    fileStatuses: [],
    remoteBranches: [],
    recentCommits: [],
  };
}

/** 只读获取当前工作区 diff；不执行 add、commit、checkout、stash 等写操作。 */
export async function getGitDiff(cwd: string): Promise<GitDiffSummary> {
  return (await readWorkspaceGitDiffs(cwd, parseGitPorcelainStatus, fileHistoryRuntime()))?.diff
    ?? { isRepository: false, files: [], diffText: '', fileDiffs: [] };
}

/** 基于只读 diff 构造 patch 导出负载；不执行任何 Git 写操作。 */
export function buildGitPatchExport(diff: GitDiffSummary, createdAt = new Date().toISOString()): GitPatchExport {
  if (diff.unavailableReason) throw gitCoreError('ASTRAGIT_GIT_DIFF_INCOMPLETE', '差异未完整读取，不能导出补丁。请缩小到所需文件并重新读取，或使用外部 Git 工具导出。');
  const targets = new Set<string>();
  const stagesByPath = new Map<string, NonNullable<GitFileDiff['stage']>>();
  for (const file of diff.fileDiffs) {
    const target = file.newPath || file.oldPath;
    const mixed = targets.has(target) || (file.stage && [file.oldPath, file.newPath].filter(Boolean).some(path => stagesByPath.has(path) && stagesByPath.get(path) !== file.stage));
    if (mixed) throw gitCoreError('ASTRAGIT_GIT_DIFF_MIXED_STAGES', '同一文件包含不同暂存阶段的差异，不能直接拼接导出。请在补丁导出中明确选择已暂存、未暂存或工作区范围。');
    targets.add(target);
    if (file.stage) for (const path of [file.oldPath, file.newPath].filter(Boolean)) stagesByPath.set(path, file.stage);
  }
  const timestamp = createdAt.replace(/[^0-9A-Za-z]/g, '-');
  return {
    fileName: `astragit-diff-${timestamp}.patch`,
    mimeType: 'text/x-patch',
    patchText: diff.diffText,
    files: diff.files,
    createdAt,
  };
}

function splitLines(value: string): string[] {
  return value ? value.split('\n').filter(Boolean) : [];
}

/** 拆分 Git 原始路径记录，仅丢弃结尾的空记录，不裁剪文件名。 */
function splitNullRecords(value: string): string[] {
  return value.split('\0').filter(Boolean);
}

/** 只读取指定文件相对 HEAD 的差异；没有提交或未跟踪时以空文件为基线。 */
export async function getFileReviewDiff(absolutePath: string): Promise<GitFileDiff | null | undefined> {
  /** Git 返回真实仓库路径，先统一 macOS 临时目录等符号链接别名。 */
  absolutePath = await realpath(absolutePath);
  /** 从文件目录识别所属仓库，支持嵌套仓库与独立工作树。 */
  const cwd = dirname(absolutePath);
  /** 非仓库文件保留普通预览，不伪装成干净仓库。 */
  const root = await readGitStdout(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return undefined;
  /** 只允许字面量相对路径，不将文件名解释成 Git 路径表达式。 */
  const path = requireSafeWorkspacePath(relative(root, absolutePath));
  if (path.split('/').includes('.git')) throw new Error('不能审阅 Git 管理目录。');
  /** HEAD 中存在该文件时合并展示暂存与未暂存结果。 */
  const tracked = await readGitStdout(root, ['ls-tree', '-z', 'HEAD', '--', `:(literal)${path}`]);
  /** 禁用外部差异程序与文本转换，避免读取文件时执行仓库配置的命令。 */
  const args = tracked ? ['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', `:(literal)${path}`] : ['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', absolutePath];
  /** no-index 的退出码 1 表示存在差异，其他失败必须报告。 */
  let output: string;
  try {
    output = (await execFileAsync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (!tracked && (error as { code?: unknown }).code === 1 && typeof (error as { stdout?: unknown }).stdout === 'string') output = (error as { stdout: string }).stdout;
    else throw error;
  }
  /** 复用 Git 解析器，新增文件的显示路径仍保持仓库相对路径。 */
  const diff = parseGitUnifiedDiff(output)[0];
  return diff ? { ...diff, oldPath: tracked ? diff.oldPath : '/dev/null', newPath: path } : null;
}

/** 按差异语义解析可预览的两端；仅返回文件授权和固定对象，不读取二进制到补丁中。 */
export async function getGitFilePreviewSources(
  cwd: string,
  input: {
    /** 仓库相对路径。 */
    path: string;
    /** 工作区、索引或提交比较范围。 */
    stage?: 'combined' | 'staged' | 'unstaged';
    /** 历史提交或贮藏。 */
    commitHash?: string;
    /** 指定比较基线。 */
    comparisonRef?: string;
    /** 比较右侧是否使用工作区。 */
    comparisonMode?: 'current' | 'working-tree';
    /** 已确认的任务分支两端。 */
    revisions?: [string, string];
    allowSpecial?: boolean;
    stashUntracked?: boolean;
  },
): Promise<Array<{ name: string; label: string; root?: string; path?: string; blob?: string; inline?: string; missing?: boolean; mode?: string; reason?: string }>> {
  /** 路径沿用工作区校验，Git 管理目录不作为用户文件开放。 */
  const path = requireSafeWorkspacePath(input.path);
  if (path.split('/').includes('.git')) throw new Error('不能预览 Git 管理目录。');
  /** 将引用固定为提交，空仓库允许没有 HEAD。 */
  const head = await readGitStdout(cwd, ['rev-parse', '--verify', 'HEAD']);
  /** 两端分别为提交、索引或工作区；null 表示不存在。 */
  let before: string | null = head || null;
  let after = 'worktree';
  /** 贮藏第三父提交保存未跟踪文件，独立于普通提交树。 */
  let untrackedTree: string | null = null;
  if (input.revisions) {
    before = await resolveCommit(cwd, input.revisions[0]);
    after = await resolveCommit(cwd, input.revisions[1]);
  } else if (input.commitHash) {
    after = await resolveCommit(cwd, input.commitHash);
    before = (await readGitStdout(cwd, ['rev-parse', '--verify', `${after}^1`])) || null;
    if (input.stashUntracked || /^stash@\{\d+\}$/u.test(input.commitHash)) untrackedTree = (await readGitStdout(cwd, ['rev-parse', '--verify', `${after}^3`])) || null;
  } else if (input.comparisonRef) {
    before = await resolveCommit(cwd, input.comparisonRef);
    after = input.comparisonMode === 'working-tree' ? 'worktree' : head;
  } else if (input.stage === 'staged') after = 'index';
  else if (input.stage === 'unstaged') before = 'index';
  /** 名称状态用于还原重命名前路径，不需要加载任何文件正文。 */
  const args =
    after === 'index'
      ? ['diff', '--cached', ...(before ? [before] : [])]
      : after === 'worktree'
        ? ['diff', ...(before && before !== 'index' ? [before] : [])]
        : before
          ? ['diff', before, after]
          : ['diff-tree', '--root', '--no-commit-id', '-r', after];
  /** 禁止外部差异驱动，路径记录使用零字节分隔。 */
  const entries = (await runGit(cwd, [...args, '--no-ext-diff', '--find-renames', '--name-status', '-z', '--'])).stdout.split('\0');
  /** 默认同名读取；新增和删除由对象或文件的存在性判定。 */
  let oldPath = path;
  let newPath = path;
  for (let index = 0; index < entries.length - 1;) {
    /** 重命名和复制记录包含两个路径。 */
    const status = entries[index++];
    const left = entries[index++];
    const right = /^[RC]/u.test(status) ? entries[index++] : left;
    if (left === path || right === path) {
      oldPath = left;
      newPath = right;
      break;
    }
  }
  /** 使用 Git 树记录获取对象，拒绝符号链接和子模块作为普通文件解码。 */
  async function side(revision: string | null, name: string, prefix: string, fallback?: string | null) {
    const label = `${prefix} · ${revision === 'worktree' ? '工作区' : revision === 'index' ? '暂存区' : (revision?.slice(0, 12) ?? '不存在')}`;
    if (!revision) return { name, label, missing: true, reason: '此版本中不存在该文件。' };
    if (revision === 'worktree') return { name, label, root: cwd, path: resolve(cwd, requireSafeWorkspacePath(name)) };
    const output = revision === 'index' ? (await runGit(cwd, ['ls-files', '--stage', '-z', '--', `:(literal)${name}`])).stdout : (await runGit(cwd, ['ls-tree', '-z', revision, '--', `:(literal)${name}`])).stdout;
    const entry = output.split('\0').find((item) => item.slice(item.indexOf('\t') + 1) === name);
    const match = entry?.match(input.allowSpecial ? /^(100[0-7]{3}|120000|160000) (?:(?:blob|commit) )?([a-f0-9]{40,64})(?: 0)?\t/u : /^(100[0-7]{3}) (?:blob )?([a-f0-9]{40,64})(?: 0)?\t/u);
    if (!match && !entry && fallback) return side(fallback, name, prefix);
    if (match?.[1] === '160000') return { name, label, mode: '160000', inline: `Subproject commit ${match[2]}\n` };
    return match ? { name, label, root: cwd, blob: match[2], mode: match[1] } : { name, label, missing: !entry, reason: entry ? '符号链接、冲突索引或子模块不能作为普通文件预览。' : '此版本中不存在该文件。' };
  }
  return Promise.all([side(before, oldPath, '变更前'), side(after, newPath, '变更后', untrackedTree)]);
}
