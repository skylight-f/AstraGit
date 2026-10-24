import type { GitFlowState, GitFlowPreview, GitFlowChange } from './gitContracts.js';
import type { GitArchiveInput, GitArchivePreview } from './gitContracts.js';
import type { GitCommitReplayInput, GitCommitReplayPreview, GitCommitReplaySeriesInput, GitCommitReplaySeriesPreview } from './gitContracts.js';
import type { GitLineDiffInput, GitLineDiffPreview } from './gitContracts.js';
import type { GitStagePreview, GitStagePreviewInput, GitLfsState, GitLfsPreview, GitLfsChange, GitExternalToolSettings, GitExternalToolPreview, GitExternalToolInput } from './gitContracts.js';
import type { GitSubmoduleChange, GitSubmoduleState, GitSubmodulePreview } from './gitContracts.js';
import type {
  CreateGitConfirmationRequest,
  ExecuteGitOperationRequest,
  ExecutedGitOperationResult,
  GitDiffSummary,
  GitOperationConfirmation,
  GitPatchExport,
  GitStatusSummary,
  ProjectGitAction,
  ProjectGitActionResponse,
  ProjectGitCommitDetail,
  GitRevisionComparison,
  ProjectGitWorkbenchSnapshot,
  ProjectGitRepositorySettings,
  GitCommitTemplate,
  GitResetMode,
  GitWritePreview,
  GitIgnoreScope,
  GitIgnorePreview,
  GitStopTrackingPreview,
  GitInteractiveRebasePreview,
  GitMailboxInput, GitMailboxPreview, GitTagQuery, GitTagPage, GitTagTarget, GitPatchInput, GitPatchPreview, GitPatchExportInput, GitRepositoryPatchExport, GitHistorySearchQuery, GitHistorySearchPage, GitTrackedFileQuery, GitTrackedFilePage, GitFileHistoryQuery, GitFileHistoryPage, GitFileRevisionQuery, GitFileRevision,
  GitIgnoredQuery,
  GitIgnoredPage,
  ProjectGitOperationPage,
  GitCommitSelectionMode,
  GitCommitSelectionTarget,
  GitCommitSelectionPreview,
  ProjectGitConflictFile,
  ProjectGitConflictSaveResponse,
  SaveProjectGitConflictInput,
} from './gitContracts.js';
import { jsonRequest, type LocalApiTransport } from '../../transport/localApiTransport.js';
import { buildGitCommandRequest, gitClientCommandTypes } from './gitCommandClient.js';
import { buildWorkspaceGitCommandRequest, workspaceGitClientCommandTypes } from './workspaceGitCommandClient.js';

export interface GitApiClient {
  previewRepositoryGitArchive: (projectId: string, repositoryId: string, input: GitArchiveInput, signal?: AbortSignal) => Promise<GitArchivePreview>;
  loadProjectGitLineDiff: (projectId: string, repositoryId: string, input: GitLineDiffInput, signal?: AbortSignal) => Promise<GitLineDiffPreview>;
  previewProjectGitStage: (projectId: string, repositoryId: string, input: GitStagePreviewInput, signal?: AbortSignal) => Promise<GitStagePreview>;
  loadRepositoryGitFlow: (projectId: string, repositoryId: string, signal?: AbortSignal) => Promise<GitFlowState>;
  previewRepositoryGitFlow: (projectId: string, repositoryId: string, change: GitFlowChange, signal?: AbortSignal) => Promise<GitFlowPreview>;
  loadRepositoryGitLfs: (projectId: string, repositoryId: string, signal?: AbortSignal) => Promise<GitLfsState>;
  previewRepositoryGitLfs: (projectId: string, repositoryId: string, change: GitLfsChange, signal?: AbortSignal) => Promise<GitLfsPreview>;
  loadProjectGitTrackedFiles: (projectId: string, repositoryId: string, query: GitTrackedFileQuery, signal?: AbortSignal) => Promise<GitTrackedFilePage>;
  loadProjectGitFileHistory: (projectId: string, repositoryId: string, query: GitFileHistoryQuery, signal?: AbortSignal) => Promise<GitFileHistoryPage>;
  loadProjectGitFileRevision: (projectId: string, repositoryId: string, query: GitFileRevisionQuery, signal?: AbortSignal) => Promise<GitFileRevision>;
  loadProjectGitInteractiveRebasePreview: (projectId: string, repositoryId: string, baseRef: string, ontoRef?: string, signal?: AbortSignal) => Promise<GitInteractiveRebasePreview>;
  loadProjectGitStopTrackingPreview: (projectId: string, repositoryId: string, paths: string[], signal?: AbortSignal) => Promise<GitStopTrackingPreview>;
  loadProjectGitIgnoredFiles: (projectId: string, repositoryId: string, query: GitIgnoredQuery, signal?: AbortSignal) => Promise<GitIgnoredPage>;
  loadProjectGitIgnorePreview: (projectId: string, repositoryId: string, scope: GitIgnoreScope, signal?: AbortSignal) => Promise<GitIgnorePreview>;
  loadProjectGitResetPreview: (projectId: string, repositoryId: string, revision: string, mode: GitResetMode, signal?: AbortSignal) => Promise<GitWritePreview>;
  loadProjectGitSkipPreview: (projectId: string, repositoryId: string, kind: 'rebase' | 'cherry_pick' | 'revert' | 'am', signal?: AbortSignal) => Promise<GitWritePreview>;
  loadProjectGitRepositorySettings: (projectId: string, repositoryId: string) => Promise<ProjectGitRepositorySettings>;
  loadProjectGitCommitTemplate: (projectId: string, repositoryId: string, signal?: AbortSignal) => Promise<GitCommitTemplate>;
  previewGitCommitSelection: (projectId: string, selection: GitCommitSelectionTarget[], selectionMode: GitCommitSelectionMode, signal?: AbortSignal) => Promise<GitCommitSelectionPreview>;
  validateGitPushTargets: (projectId: string, targets: Array<{ repositoryId: string; relativePath: string; remote: string; sourceBranch: string; targetBranch: string }>) => Promise<{ ok: true }>;
  /** 操作账本属于桌面实例，不能回退到独立执行宿主的其他记录。 */
  loadProjectGitOperations: (projectId: string, cursor?: string) => Promise<ProjectGitOperationPage>;
  loadGitCommitModels: (projectId: string) => Promise<{ items: Array<{ id: string; label: string }>; warning: string }>;
  generateGitCommitMessage: (
    projectId: string,
    input: { repositoryId: string; relativePath?: string; language: 'zh-CN' | 'en'; modelRef: string; selection?: GitCommitSelectionTarget[]; selectionMode?: GitCommitSelectionMode },
    onText?: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ message: string; model: string; truncated?: boolean; fingerprints?: Record<string, string> }>;
  loadGitDiff: () => Promise<GitDiffSummary>;
  loadProjectGitStatus: (projectId: string) => Promise<GitStatusSummary>;
  loadProjectGitWorkbench: (projectId: string) => Promise<ProjectGitWorkbenchSnapshot>;
  previewRepositoryGitMailbox: (projectId: string, repositoryId: string, input: GitMailboxInput, signal?: AbortSignal) => Promise<GitMailboxPreview>;
  loadRepositoryGitExternalTools: (projectId: string, repositoryId: string, signal?: AbortSignal) => Promise<GitExternalToolSettings>;
  previewRepositoryGitExternalTool: (projectId: string, repositoryId: string, input: GitExternalToolInput, signal?: AbortSignal) => Promise<GitExternalToolPreview>;
  loadRepositoryGitSubmodules: (projectId: string, repositoryId: string, signal?: AbortSignal) => Promise<GitSubmoduleState>;
  previewRepositoryGitSubmodule: (projectId: string, repositoryId: string, change: GitSubmoduleChange, signal?: AbortSignal) => Promise<GitSubmodulePreview>;
  loadRepositoryGitTags: (projectId: string, repositoryId: string, query: GitTagQuery, signal?: AbortSignal) => Promise<GitTagPage>;
  loadRepositoryGitTagTarget: (projectId: string, repositoryId: string, revision: string, signal?: AbortSignal) => Promise<GitTagTarget>;
  previewRepositoryGitPatch: (projectId: string, repositoryId: string, input: GitPatchInput, signal?: AbortSignal) => Promise<GitPatchPreview>;
  exportRepositoryGitPatch: (projectId: string, repositoryId: string, input: GitPatchExportInput, signal?: AbortSignal) => Promise<GitRepositoryPatchExport>;
  searchProjectGitHistory: (projectId: string, repositoryId: string, query: GitHistorySearchQuery, signal?: AbortSignal) => Promise<GitHistorySearchPage>;
  loadProjectGitHistory: (projectId: string, repositoryId: string, offset: number, ref?: string) => Promise<{ commits: NonNullable<GitStatusSummary['recentCommits']>; hasMore: boolean }>;
  loadProjectGitCommit: (projectId: string, repositoryId: string, commitHash: string) => Promise<ProjectGitCommitDetail>;
  previewRepositoryGitReplay: (projectId: string, repositoryId: string, input: GitCommitReplayInput, signal?: AbortSignal) => Promise<GitCommitReplayPreview>;
  previewRepositoryGitReplaySeries: (projectId: string, repositoryId: string, input: GitCommitReplaySeriesInput, signal?: AbortSignal) => Promise<GitCommitReplaySeriesPreview>;
  loadProjectGitComparisonDiff: (projectId: string, repositoryId: string, ref: string, mode: 'current' | 'working-tree') => Promise<GitDiffSummary>;
  loadProjectGitRevisionsDiff: (projectId: string, repositoryId: string, revisions: [string, string], signal?: AbortSignal) => Promise<GitRevisionComparison>;
  readProjectGitConflict: (projectId: string, repositoryId: string, path: string) => Promise<ProjectGitConflictFile>;
  saveProjectGitConflict: (projectId: string, repositoryId: string, input: SaveProjectGitConflictInput) => Promise<ProjectGitConflictSaveResponse>;
  executeProjectGitAction: (projectId: string, repositoryId: string, input: ProjectGitAction) => Promise<ProjectGitActionResponse>;
  cancelProjectGitAction: (projectId: string, repositoryId: string) => Promise<{ cancelled: boolean }>;
  loadProjectGitDiff: (projectId: string) => Promise<GitDiffSummary>;
  exportProjectGitPatch: (projectId: string) => Promise<GitPatchExport>;
  exportGitPatch: () => Promise<GitPatchExport>;
  createGitConfirmation: (input: CreateGitConfirmationRequest) => Promise<GitOperationConfirmation>;
  confirmGitOperation: (confirmationId: string) => Promise<GitOperationConfirmation>;
  rejectGitOperation: (confirmationId: string, reason?: string) => Promise<GitOperationConfirmation>;
  executeGitOperation: (input: ExecuteGitOperationRequest) => Promise<ExecutedGitOperationResult>;
  executeProjectGitBranch: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitCheckout: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitCommit: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitStash: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitApplyStash: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitPull: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
  executeProjectGitPush: (projectId: string, input: Omit<ExecuteGitOperationRequest, 'operation'>) => Promise<ExecutedGitOperationResult>;
}

export function createGitApiClient(transport: LocalApiTransport): GitApiClient {
  const projectOperation = async (projectId: string, operation: string, commandType: Parameters<typeof buildGitCommandRequest>[0]['commandType'], input: object) => {
    const body = await buildGitCommandRequest({
      commandType,
      scopeKind: 'git_repository',
      scopeId: () => `project:${projectId}`,
      operationPrefix: `git_project_${operation.replaceAll('-', '_')}`,
      value: input,
    });
    return transport.request<ExecutedGitOperationResult>(`${projectGitPath(projectId)}/${operation}`, jsonRequest('POST', body));
  };
  return {
    loadProjectGitTrackedFiles: (projectId, repositoryId, query, signal) => {
      const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
      return transport.request<GitTrackedFilePage>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/tracked-files?${search}`, { signal });
    },
    loadProjectGitFileHistory: (projectId, repositoryId, query, signal) => {
      const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
      return transport.request<GitFileHistoryPage>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/file-history?${search}`, { signal });
    },
    loadProjectGitFileRevision: (projectId, repositoryId, query, signal) => {
      const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
      return transport.request<GitFileRevision>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/file-revision?${search}`, { signal });
    },
    loadProjectGitInteractiveRebasePreview: (projectId, repositoryId, baseRef, ontoRef, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/interactive-rebase-preview`, { ...jsonRequest('POST', { baseRef, ontoRef }), signal }, { readOnly: true }),
    loadProjectGitIgnorePreview: (projectId, repositoryId, scope, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/ignore-preview?scope=${scope}`, { signal }),
    loadProjectGitStopTrackingPreview: (projectId, repositoryId, paths, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/stop-tracking-preview`, { ...jsonRequest('POST', { paths }), signal }, { readOnly: true }),
    loadProjectGitIgnoredFiles: (projectId, repositoryId, query, signal) => {
      const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
      return transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/ignored-files?${search}`, { signal });
    },
    loadProjectGitResetPreview: (projectId, repositoryId, revision, mode, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/reset-preview?revision=${encodeURIComponent(revision)}&mode=${mode}`, { signal }),
    loadProjectGitSkipPreview: (projectId, repositoryId, kind, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/skip-preview?kind=${kind}`, { signal }),
    loadProjectGitRepositorySettings: (projectId, repositoryId) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/settings`),
    loadProjectGitCommitTemplate: (projectId, repositoryId, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/commit-template`, { signal }),
    previewGitCommitSelection: (projectId, selection, selectionMode, signal) => transport.request(`${projectGitPath(projectId)}/commit-selection`, { ...jsonRequest('POST', { selection, selectionMode }), signal }),
    validateGitPushTargets: (projectId, targets) => transport.request(`${projectGitPath(projectId)}/commit-selection/push-targets`, jsonRequest('POST', { targets })),
    loadProjectGitOperations: (projectId, cursor) => transport.request(`${projectGitPath(projectId)}/operations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    loadGitCommitModels: (projectId) => transport.request(`${projectGitPath(projectId)}/commit-models`),
    generateGitCommitMessage: async (projectId, input, onText, signal) => {
      let result: { message: string; model: string; truncated?: boolean; fingerprints?: Record<string, string> } | undefined;
      await transport.requestStream<{ type: string; text?: string; message?: string; model?: string; truncated?: boolean; fingerprints?: Record<string, string> }>(
        `${projectGitPath(projectId)}/commit-message`,
        { ...jsonRequest('POST', { ...input, stream: true }), signal },
        (event) => {
          if (event.type === 'error') throw new Error(event.message ?? '提交说明生成失败。');
          if (event.type === 'text' && typeof event.text === 'string') onText?.(event.text);
          if (event.type === 'result' && typeof event.message === 'string' && typeof event.model === 'string') result = { message: event.message, model: event.model, truncated: event.truncated, fingerprints: event.fingerprints };
        },
      );
      if (!result) throw new Error('生成连接已中断，请重试。');
      return result;
    },
    loadGitDiff: () => transport.request<GitDiffSummary>('/api/git/diff'),
    previewRepositoryGitReplay: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/replay-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    previewRepositoryGitReplaySeries: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/replay-series-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadProjectGitStatus: (projectId) => transport.request<GitStatusSummary>(`${projectGitPath(projectId)}/status`),
    loadProjectGitWorkbench: (projectId) => transport.request<ProjectGitWorkbenchSnapshot>(`${projectGitPath(projectId)}/workbench`),
    previewRepositoryGitArchive: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/archive-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadProjectGitLineDiff: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/line-diff`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    previewProjectGitStage: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/stage-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadRepositoryGitFlow: (projectId, repositoryId, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/flow`, { signal }),
    previewRepositoryGitFlow: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/flow-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadRepositoryGitLfs: (projectId, repositoryId, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/lfs`, { signal }),
    previewRepositoryGitLfs: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/lfs-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadRepositoryGitExternalTools: (projectId, repositoryId, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/external-tools`, { signal }),
    previewRepositoryGitExternalTool: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/external-tool-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadRepositoryGitSubmodules: (projectId, repositoryId, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/submodules`, { signal }),
    previewRepositoryGitSubmodule: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/submodule-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    loadRepositoryGitTags: (projectId, repositoryId, query, signal) => { const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])); return transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/tags?${search}`, { signal }); },
    loadRepositoryGitTagTarget: (projectId, repositoryId, revision, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/tag-target?revision=${encodeURIComponent(revision)}`, { signal }),
    previewRepositoryGitMailbox: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/mailbox-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    previewRepositoryGitPatch: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/patch-preview`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    exportRepositoryGitPatch: (projectId, repositoryId, input, signal) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/patch-export`, { ...jsonRequest('POST', input), signal }, { readOnly: true }),
    searchProjectGitHistory: (projectId, repositoryId, query, signal) => {
      const search = new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]));
      return transport.request<GitHistorySearchPage>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/history-query?${search}`, { signal });
    },
    loadProjectGitHistory: async (projectId, repositoryId, offset, ref) =>
      transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/history?offset=${offset}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`),
    loadProjectGitCommit: (projectId, repositoryId, commitHash) => transport.request<ProjectGitCommitDetail>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/commits/${encodeURIComponent(commitHash)}`),
    loadProjectGitComparisonDiff: (projectId, repositoryId, ref, mode) => transport.request<GitDiffSummary>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/compare?ref=${encodeURIComponent(ref)}&mode=${mode}`),
    loadProjectGitRevisionsDiff: (projectId, repositoryId, revisions, signal) => transport.request<GitRevisionComparison>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/compare-revisions?from=${encodeURIComponent(revisions[0])}&to=${encodeURIComponent(revisions[1])}`, { signal }),
    readProjectGitConflict: (projectId, repositoryId, path) => transport.request<ProjectGitConflictFile>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/conflict?path=${encodeURIComponent(path)}`),
    saveProjectGitConflict: (projectId, repositoryId, input) => transport.request<ProjectGitConflictSaveResponse>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/conflict`, jsonRequest('PUT', input)),
    executeProjectGitAction: async (projectId, repositoryId, input) => {
      const body = await buildWorkspaceGitCommandRequest({
        commandType: workspaceGitClientCommandTypes.workbenchAction,
        scopeKind: 'git_repository',
        scopeId: repositoryId,
        value: input,
      });
      const rebase = input.type === 'interactive_rebase' || input.type === 'amend_rebase_step' || ((input.type === 'continue_integration' || input.type === 'abort_integration' || input.type === 'skip_integration') && input.kind === 'rebase');
      return transport.request<ProjectGitActionResponse>(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/${input.type === 'manage_flow' ? 'flow' : input.type === 'manage_lfs' ? 'lfs' : input.type === 'external_tool' ? 'external-tool' : rebase ? 'interactive-rebase' : ['import_patch', 'import_mailbox'].includes(input.type) ? 'patch-import' : 'actions'}`, jsonRequest('POST', body));
    },
    cancelProjectGitAction: (projectId, repositoryId) => transport.request(`${projectGitPath(projectId)}/workbench/repositories/${encodeURIComponent(repositoryId)}/cancel`, jsonRequest('POST', {})),
    loadProjectGitDiff: (projectId) => transport.request<GitDiffSummary>(`${projectGitPath(projectId)}/diff`),
    exportProjectGitPatch: async (projectId) => {
      const body = await buildWorkspaceGitCommandRequest({
        commandType: workspaceGitClientCommandTypes.projectPatchExport,
        scopeKind: 'git_repository',
        scopeId: `project:${projectId}`,
        value: {},
      });
      return transport.request<GitPatchExport>(`${projectGitPath(projectId)}/patch`, jsonRequest('POST', body));
    },
    exportGitPatch: () => transport.request<GitPatchExport>('/api/git/patch'),
    createGitConfirmation: async (input) => {
      const body = await buildGitCommandRequest({
        commandType: gitClientCommandTypes.confirmationCreate,
        scopeKind: 'approval',
        scopeId: (operationIdentity) => operationIdentity,
        operationPrefix: 'git_confirmation',
        value: input,
      });
      return transport.request<GitOperationConfirmation>('/api/git/confirmations', jsonRequest('POST', body));
    },
    confirmGitOperation: async (confirmationId) => {
      const body = await buildGitCommandRequest({
        commandType: gitClientCommandTypes.confirmationConfirm,
        scopeKind: 'approval',
        scopeId: () => confirmationId,
        operationPrefix: 'git_confirmation_confirm',
        value: {},
      });
      return transport.request<GitOperationConfirmation>(`/api/git/confirmations/${encodeURIComponent(confirmationId)}/confirm`, jsonRequest('POST', body));
    },
    rejectGitOperation: async (confirmationId, reason) => {
      const value = { reason };
      const body = await buildGitCommandRequest({
        commandType: gitClientCommandTypes.confirmationReject,
        scopeKind: 'approval',
        scopeId: () => confirmationId,
        operationPrefix: 'git_confirmation_reject',
        value,
      });
      return transport.request<GitOperationConfirmation>(`/api/git/confirmations/${encodeURIComponent(confirmationId)}/reject`, jsonRequest('POST', body));
    },
    executeGitOperation: async (input) => {
      const body = await buildGitCommandRequest({
        commandType: gitClientCommandTypes.operationExecute,
        scopeKind: 'git_repository',
        scopeId: () => 'primary',
        operationPrefix: 'git_operation',
        value: input,
      });
      return transport.request<ExecutedGitOperationResult>('/api/git/operations', jsonRequest('POST', body));
    },
    executeProjectGitBranch: (projectId, input) => projectOperation(projectId, 'branch', gitClientCommandTypes.projectBranch, input),
    executeProjectGitCheckout: (projectId, input) => projectOperation(projectId, 'checkout', gitClientCommandTypes.projectCheckout, input),
    executeProjectGitCommit: (projectId, input) => projectOperation(projectId, 'commit', gitClientCommandTypes.projectCommit, input),
    executeProjectGitStash: (projectId, input) => projectOperation(projectId, 'stash', gitClientCommandTypes.projectStash, input),
    executeProjectGitApplyStash: (projectId, input) => projectOperation(projectId, 'apply-stash', gitClientCommandTypes.projectApplyStash, input),
    executeProjectGitPull: (projectId, input) => projectOperation(projectId, 'pull', gitClientCommandTypes.projectPull, input),
    executeProjectGitPush: (projectId, input) => projectOperation(projectId, 'push', gitClientCommandTypes.projectPush, input),
  };
}

function projectGitPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/git`;
}
