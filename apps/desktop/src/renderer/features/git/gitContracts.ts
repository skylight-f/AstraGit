export type { GitFlowKind, GitFlowConfiguration, GitFlowChange, GitFlowState, GitFlowBranch, GitFlowPreview, GitFlowOutcome, GitFlowRefChange } from '@astragit/git-core';
import type { GitFlowChange, GitFlowOutcome } from '@astragit/git-core';
export type { GitLineDiffInput, GitLineDiffPreview, GitLineChange, GitLineSelection } from '@astragit/git-core';
export type { GitStagePreview, GitStagePreviewInput, GitLargeFileReview } from '@astragit/git-core';
import type { GitLargeFileReview } from '@astragit/git-core';
export type { GitLfsChange, GitLfsState, GitLfsPattern, GitLfsFile, GitLfsPreview } from '@astragit/git-core';
import type { GitLfsChange } from '@astragit/git-core';
export type { GitExternalToolKind, GitExternalToolInput, GitExternalToolConfiguration, GitExternalToolSettings, GitExternalToolPreview } from '@astragit/git-core';
import type { GitExternalToolInput, GitExternalToolConfiguration } from '@astragit/git-core';
export type { GitSubmoduleChange, GitSubmoduleState, GitSubmoduleItem, GitSubmodulePreview } from '@astragit/git-core';
import type { GitSubmoduleChange } from '@astragit/git-core';
export type { GitMailboxInput, GitMailboxPreview, GitMailboxCommit } from '@astragit/git-core';
import type { GitMailboxInput } from '@astragit/git-core';
export type { GitTagQuery, GitTagPage, GitTagItem, GitTagLocalInfo, GitTagTarget } from '@astragit/git-core';
export type { GitPatchSeriesCommit, GitPatchInput, GitPatchPreview, GitPatchExportInput, GitRepositoryPatchExport, GitPatchFile } from '@astragit/git-core';
export type { GitTrackedFileQuery, GitTrackedFilePage, GitFileHistoryQuery, GitFileHistoryEntry, GitFileHistoryPage, GitFileRevisionQuery, GitFileRevision, GitFileOriginLine } from '@astragit/git-core';
export type { GitHistorySearchQuery, GitHistorySearchPage, GitHistorySearchCommit, GitHistorySearchField } from '@astragit/git-core';
/** Git blame 公共契约由 Git Core 统一定义，渲染层只消费只读数据。 */
export type { GitBlameLine, GitFileBlame } from '@astragit/git-core';
export type { ProjectGitConflictFile, ProjectGitConflictIndexStage, SaveProjectGitConflictInput } from '@astragit/git-core';
export type { ProjectGitRepositorySettings } from '@astragit/git-core';
export type { GitCommitTemplate } from '@astragit/git-core';
export type { GitResetMode, GitWritePreview } from '@astragit/git-core';
export type { GitIgnoreInput, GitIgnorePreview, GitIgnoreScope } from '@astragit/git-core';
export type { GitStopTrackingPreview, GitIgnoredItem, GitIgnoredPage, GitIgnoredQuery } from '@astragit/git-core';
export type { GitInteractiveRebaseInput, GitInteractiveRebasePreview, GitRebasePlanStep, GitRebasePlanAction, GitRebaseEditState } from '@astragit/git-core';
import type { ProjectGitConflictWriteResult } from '@astragit/git-core';

export interface ProjectGitConflictSaveResponse extends ProjectGitConflictWriteResult {
  snapshot: ProjectGitRepositorySnapshot;
}

export interface GitDiffSummary {
  isRepository: boolean;
  files: string[];
  diffText: string;
  fileDiffs: GitFileDiff[];
  unavailableReason?: import('@astragit/git-core').GitDiffUnavailableReason;
  comparisonParent?: string;
  readError?: import('@astragit/git-core').GitDiffSummary['readError'];
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
  stage?: 'staged' | 'unstaged' | 'untracked';
  isBinary?: boolean;
  oldPath: string;
  newPath: string;
  changeType: GitDiffFileChangeType;
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

export interface ProjectGitSnapshotResult {
  projectId: string;
  taskId: string;
  snapshotType: 'readonly_diff';
  isRepository: boolean;
  fileCount: number;
  diffTextLength: number;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authoredAt: string;
  parentHashes: string[];
}

export interface GitFileStatusSummary {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
  category: string;
}

export interface GitStatusSummary {
  isRepository: boolean;
  branch: string;
  clean?: boolean;
  changedFiles: string[];
  conflictFiles?: string[];
  fileStatuses?: GitFileStatusSummary[];
  remoteBranches?: string[];
  recentCommits?: GitCommitSummary[];
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
  rebaseEdit?: import('@astragit/git-core').GitRebaseEditState | null;
  indexFingerprint?: string;
  submodules?: { path: string; initialized: boolean }[];
  branch: string;
  detached: boolean;
  headTags: string[];
  headSha: string;
  upstream: string | null;
  integrationState?: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' | null;
  integrationNoCommit?: boolean;
  ahead: number;
  behind: number;
  clean: boolean;
  fileStatuses: NonNullable<GitStatusSummary['fileStatuses']>;
  conflictFiles: string[];
  localBranches: string[];
  /** 同一 Git 仓库中已经由任一 worktree 检出的本地分支；混合版本宿主缺失时按空集合降级。 */
  checkedOutBranches?: string[];
  remoteDetails?: Array<{ name: string; fetchUrl: string; pushUrl: string; pushUrls?: string[]; pushFingerprint?: string }>;
  localBranchHeads?: Record<string, string>;
  remoteBranchHeads?: Record<string, string>;
  branchUpstreamRefs?: Record<string, string>;
  branchUpstreams?: Record<string, string>;
  /** 混合版本宿主缺失时仅降级为不显示非当前分支的差异标识。 */
  branchDivergences?: Record<string, { ahead: number; behind: number }>;
  remoteBranches: string[];
  remotes: string[];
  tags: string[];
  recentRefs: ProjectGitRecentRef[];
  recentCommits: NonNullable<GitStatusSummary['recentCommits']>;
  outgoingCommits: NonNullable<GitStatusSummary['recentCommits']>;
  stashes: ProjectGitStashEntry[];
  diff: GitDiffSummary;
  stagedDiff: GitDiffSummary;
  unstagedDiff: GitDiffSummary;
}

export interface ProjectGitRepositoryWorkbenchItem {
  /** 服务端校验过的会话工作树目录。 */
  localPath?: string;
  id: string;
  name: string;
  relativePath: string;
  isSubmodule?: boolean;
  subtreePaths?: string[];
  snapshot: ProjectGitRepositorySnapshot;
}

/** 桌面操作历史共用 Git 公共契约，避免桥接两端各自定义状态。 */
export type { ProjectGitOperationPage, ProjectGitOperationRecord } from '@astragit/git-core';

export interface ProjectGitWorkbenchSnapshot {
  projectId: string;
  projectName: string;
  refreshedAt: string;
  repositories: ProjectGitRepositoryWorkbenchItem[];
}

export type GitCommitSelectionMode = 'worktree' | 'staged';
export interface GitCommitSelectionTarget { repositoryId: string; relativePath: string; paths: string[] }
export interface GitCommitSelectionPreview {
  projectId: string;
  selectionMode: GitCommitSelectionMode;
  repositories: Array<GitCommitSelectionTarget & { name: string; fingerprint: string; headSha: string; branch: string; detached: boolean; diff: GitDiffSummary; truncated: boolean }>;
}

export type ProjectGitAction =
  | { type: 'cherry_pick_series'; input: import('@astragit/git-core').GitCommitReplaySeriesInput; expectedFingerprint: string }
  | ({ type: 'interactive_rebase' } & import('@astragit/git-core').GitInteractiveRebaseInput)
  | { type: 'amend_rebase_step'; message: string; expectedHeadSha: string; expectedIndexFingerprint: string; expectedStepFingerprint: string }
  | { type: 'stop_tracking'; paths: string[]; force?: boolean; expectedFingerprint: string }
  | { type: 'stage_ignored'; paths: string[]; largeFileReview?: GitLargeFileReview }
  | { type: 'ignore'; scope: import('@astragit/git-core').GitIgnoreScope; patterns: string[]; expectedFingerprint: string }
  | { type: 'reset_revision'; targetSha: string; mode: import('@astragit/git-core').GitResetMode; expectedFingerprint: string; discardNestedRepositories?: boolean }
  | { type: 'skip_integration'; kind: 'rebase' | 'cherry_pick' | 'revert' | 'am'; expectedFingerprint: string; discardNestedRepositories?: boolean }
  | import('@astragit/git-core').RepositorySettingsAction
  | import('@astragit/git-core').GitCommitTemplateChange
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
  | { type: 'import_patch'; patch: import('@astragit/git-core').GitPatchInput; expectedFingerprint: string }
  | { type: 'apply_line_changes'; input: import('@astragit/git-core').GitLineChange; largeFileReview?: GitLargeFileReview }
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

export interface ProjectGitActionResponse {
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  result: {
    action: ProjectGitAction['type'];
    outcome: 'completed' | 'conflict';
    branch: string;
    headSha: string;
    conflictFiles: string[];
    flow?: GitFlowOutcome;
    operationStage?: 'integration' | 'restore';
    savedStash?: string;
    stdout: string;
    stderr: string;
  };
  snapshot: ProjectGitRepositorySnapshot;
}

export interface ProjectGitCommitDetail {
  commit: NonNullable<GitStatusSummary['recentCommits']>[number];
  body: string;
  fullMessage?: string;
  parentHashes: string[];
  files: Array<{ path: string; originalPath?: string; additions: number; deletions: number }>;
  diff: GitDiffSummary;
}

export interface GitRevisionComparison {
  revisions: [string, string];
  files: ProjectGitCommitDetail['files'];
  diff: GitDiffSummary;
}

export type HighRiskGitOperation = 'commit' | 'stash' | 'apply_stash' | 'rollback' | 'branch' | 'switch_branch' | 'pull' | 'push';

export interface GitOperationConfirmation {
  id: string;
  operation: HighRiskGitOperation;
  cwd: string;
  reason: string;
  message?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  riskLevel: 'high';
  confirmationText: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
  rejectedReason?: string;
}

export interface CreateGitConfirmationRequest {
  operation: HighRiskGitOperation;
  reason: string;
  message?: string;
}

export interface ExecuteGitOperationRequest {
  confirmationId: string;
  operation: HighRiskGitOperation;
  message?: string;
  branchName?: string;
  baseRef?: string;
  stashRef?: string;
  remote?: string;
  targetRef?: string;
}

export interface ExecutedGitOperationResult {
  operation: HighRiskGitOperation;
  cwd: string;
  args: string[];
  stdout: string;
  stderr: string;
}
export type { GitArchiveFormat, GitArchiveInput, GitArchivePreview, GitArchiveResult } from '@astragit/git-core';
export type { GitCommitReplayInput, GitCommitReplayPreview, GitCommitReplaySeriesInput, GitCommitReplaySeriesPreview } from '@astragit/git-core';
