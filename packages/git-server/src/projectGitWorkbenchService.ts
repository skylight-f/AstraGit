import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { Writable } from 'node:stream';
import {
  getProjectGitStagePreview, parseGitStagePreviewInput, parseGitLargeFileReview,
  getProjectGitLineDiff, parseGitLineDiffInput, parseGitLineChange,
  getProjectGitLfsState, getProjectGitLfsPreview, parseGitLfsChange,
  getProjectGitFlowState, getProjectGitFlowPreview, parseGitFlowChange,
  discoverGitRepositories,
  getProjectGitExternalToolSettings,
  getProjectGitExternalToolPreview,
  parseGitExternalToolInput,
  parseGitExternalToolConfiguration,
  getProjectGitSubmodules,
  getProjectGitSubmodulePreview,
  parseGitSubmoduleChange,
  executeProjectGitAction,
  getProjectGitCommitDetail,
  getProjectGitComparisonDiff,
  getProjectGitRevisionsDiff,
  getProjectGitArchivePreview, writeProjectGitArchive, getProjectGitCommitReplayPreview, parseGitCommitReplayInput,
  getProjectGitCommitReplaySeriesPreview, parseGitCommitReplaySeriesInput,
  getProjectGitHistory,
  getProjectGitHistorySearchScope,
  queryProjectGitHistoryScope,
  validateHistorySearch,
  type GitHistorySearchQuery,
  type GitHistorySearchScope,
  type GitHistorySearchPage,
  getProjectGitTrackedFiles,
  getProjectGitFileHistory,
  getProjectGitFileRevision,
  getProjectGitPatchPreview,
  getProjectGitPatchExport,
  getProjectGitMailboxPreview,
  getProjectGitTags,
  getProjectGitTagTarget,
  type GitTagQuery,
  type GitPatchInput,
  type GitPatchExportInput,
  type GitTrackedFileQuery,
  type GitFileHistoryQuery,
  type GitFileRevisionQuery,
  getProjectGitRepositorySnapshot,
  getProjectGitRepositorySettings,
  getProjectGitCommitTemplate,
  parseGitCommitTemplateChange,
  getProjectGitResetPreview,
  getProjectGitSkipPreview,
  getProjectGitIgnorePreview,
  getProjectGitFileLocation,
  getProjectGitStopTrackingPreview,
  getProjectGitIgnoredFiles,
  getProjectGitInteractiveRebasePreview,
  type GitIgnoredQuery,
  type GitIgnoreScope,
  type GitResetMode,
  readProjectGitConflict,
  saveProjectGitConflict,
  redactGitOutput,
  type DiscoveredGitRepository,
  type GitDiffSummary,
  type ProjectGitAction,
  type ProjectGitActionResult,
  type ProjectGitCommitDetail,
  type ProjectGitRepositorySnapshot,
  type ProjectGitConflictFile,
  type ProjectGitConflictWriteResult,
  type SaveProjectGitConflictInput,
} from '@astragit/git-core';
import type { ProjectStore } from './projectStore.js';
import { projectError } from './projectStore.js';
import { OperationHistoryStore } from './operationHistoryStore.js';

/** 与项目错误码一致的别名，保持与 Zeus 动作解析文案对齐。 */
const projectGitError = projectError;

export interface ProjectGitProjectIdentity {
  id: string;
  name: string;
  localPath: string;
}

export interface ProjectGitRepositoryWorkbenchItem {
  id: string;
  name: string;
  relativePath: string;
  isSubmodule?: boolean;
  subtreePaths?: string[];
  snapshot: ProjectGitRepositorySnapshot;
}

export interface ProjectGitWorkbenchSnapshot {
  projectId: string;
  projectName: string;
  refreshedAt: string;
  repositories: ProjectGitRepositoryWorkbenchItem[];
}

export interface ProjectGitActionResponse {
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  result: ProjectGitActionResult;
  snapshot: ProjectGitRepositorySnapshot;
}
export interface ProjectGitConflictSaveResponse extends ProjectGitConflictWriteResult {
  snapshot: ProjectGitRepositorySnapshot;
}

interface ResolvedProjectGitRepository {
  id: string;
  project: ProjectGitProjectIdentity;
  repository: DiscoveredGitRepository;
}

/** 工作台服务：只从简化项目列表解析可信路径，再发现仓库。 */
export class ProjectGitWorkbenchService {
  private readonly activeRepositories = new Map<string, AbortController>();
  private readonly readQueries = new Set<AbortController>();
  private readonly historyScopes = new Map<string, { scope: GitHistorySearchScope; identity: string; lastRead: number }>();

  constructor(private readonly projects: ProjectStore, private readonly operations: OperationHistoryStore) {}

  async loadWorkbench(projectId: string): Promise<ProjectGitWorkbenchSnapshot> {
    const project = this.requireProject(projectId);
    const repositories = await discoverGitRepositories(project.localPath);
    return {
      projectId: project.id,
      projectName: project.name,
      refreshedAt: new Date().toISOString(),
      repositories: await mapWithConcurrency(repositories, async (repository) => ({
        ...(await loadNavigationMetadata(repository.localPath)),
        id: stableRepositoryId(project.id, repository.relativePath),
        name: repository.name,
        relativePath: repository.relativePath,
        snapshot: await getProjectGitRepositorySnapshot(repository.localPath),
      })),
    };
  }

  async loadHistory(projectId: string, repositoryId: string, offset: number, ref?: string) {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    return getProjectGitHistory(resolved.repository.localPath, offset, ref);
  }

  async searchHistory(projectId: string, repositoryId: string, query: GitHistorySearchQuery, signal?: AbortSignal): Promise<GitHistorySearchPage> {
    const settings = validateHistorySearch(query);
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      const identity = JSON.stringify([projectId, repositoryId, resolved.repository.localPath, settings]);
      for (const [id, entry] of this.historyScopes) if (Date.now() - entry.lastRead > 30 * 60_000) this.historyScopes.delete(id);
      const [existing, position] = query.cursor?.split(':') ?? [];
      const offset = position === undefined ? 0 : Number(position);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_000) throw projectGitError('ASTRAGIT_GIT_HISTORY_QUERY_INVALID', '历史分页位置无效。');
      const id = existing ?? randomUUID();
      let entry = existing ? this.historyScopes.get(existing) : undefined;
      if (existing && (!entry || entry.identity !== identity)) throw projectGitError('ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED', '历史查询已过期或范围变化，请重新载入。');
      if (!entry) {
        entry = { scope: await getProjectGitHistorySearchScope(resolved.repository.localPath, settings.ref, combined), identity, lastRead: Date.now() };
        this.historyScopes.set(id, entry);
        while (this.historyScopes.size > 64) this.historyScopes.delete(this.historyScopes.keys().next().value!);
      } else { this.historyScopes.delete(id); this.historyScopes.set(id, entry); }
      entry.lastRead = Date.now();
      const page = await queryProjectGitHistoryScope(resolved.repository.localPath, entry.scope, query, offset, combined);
      return { ...page, scopeId: id, nextCursor: page.hasMore ? `${id}:${offset + page.commits.length}` : null };
    });
  }

  async loadTrackedFiles(projectId: string, repositoryId: string, query: GitTrackedFileQuery, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitTrackedFiles(resolved.repository.localPath, query, combined); });
  }
  async loadFileHistory(projectId: string, repositoryId: string, query: GitFileHistoryQuery, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitFileHistory(resolved.repository.localPath, query, combined); });
  }
  async loadFileRevision(projectId: string, repositoryId: string, query: GitFileRevisionQuery, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitFileRevision(resolved.repository.localPath, query, combined); });
  }

  async loadPatchPreview(projectId: string, repositoryId: string, input: GitPatchInput, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitPatchPreview(resolved.repository.localPath, input, combined); });
  }
  async exportPatch(projectId: string, repositoryId: string, input: GitPatchExportInput, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitPatchExport(resolved.repository.localPath, input, combined); });
  }

  async loadMailboxPreview(projectId: string, repositoryId: string, input: import('@astragit/git-core').GitMailboxInput, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitMailboxPreview(resolved.repository.localPath, input, combined); });
  }
  async loadTags(projectId: string, repositoryId: string, query: GitTagQuery, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitTags(resolved.repository.localPath, query, combined); });
  }
  async loadTagTarget(projectId: string, repositoryId: string, revision: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitTagTarget(resolved.repository.localPath, revision, combined); });
  }

  async loadExternalToolSettings(projectId: string, repositoryId: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitExternalToolSettings(resolved.repository.localPath, combined); });
  }
  async loadLfs(projectId: string, repositoryId: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitLfsState(resolved.repository.localPath, combined); });
  }
  async loadFlow(projectId: string, repositoryId: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitFlowState(resolved.repository.localPath, combined); });
  }
  async previewFlow(projectId: string, repositoryId: string, value: unknown, signal?: AbortSignal) {
    const change = parseGitFlowChange(value);
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitFlowPreview(resolved.repository.localPath, change, combined); });
  }
  async previewStage(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    const value = parseGitStagePreviewInput(input);
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return this.withRepositoryGate(resolved, owned => getProjectGitStagePreview(resolved.repository.localPath, value, AbortSignal.any([owned, combined]))); });
  }
  async lineDiff(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    const value = parseGitLineDiffInput(input);
    // This reader verifies state before/after and writes only disposable objects.
    // It must not reserve the mutation gate during periodic diff refreshes.
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitLineDiff(resolved.repository.localPath, value, combined); });
  }
  async previewLfs(projectId: string, repositoryId: string, value: unknown, signal?: AbortSignal) {
    const change = parseGitLfsChange(value);
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitLfsPreview(resolved.repository.localPath, change, combined); });
  }
  async previewExternalTool(projectId: string, repositoryId: string, value: unknown, signal?: AbortSignal) {
    const input = parseGitExternalToolInput(value);
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitExternalToolPreview(resolved.repository.localPath, input, combined); });
  }

  async loadSubmodules(projectId: string, repositoryId: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitSubmodules(resolved.repository.localPath, combined); });
  }
  async previewSubmodule(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    const change = parseGitSubmoduleChange(input);
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitSubmodulePreview(resolved.repository.localPath, change, combined); });
  }

  async loadSettings(projectId: string, repositoryId: string) {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    return getProjectGitRepositorySettings(resolved.repository.localPath);
  }

  async loadCommitTemplate(projectId: string, repositoryId: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitCommitTemplate(resolved.repository.localPath, AbortSignal.any([owned, combined])));
    });
  }

  async loadResetPreview(projectId: string, repositoryId: string, revision: string, mode: GitResetMode, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitResetPreview(resolved.repository.localPath, revision, mode, AbortSignal.any([owned, combined])));
    });
  }

  async resolveFileLocation(projectId: string, repositoryId: string, path: string, intent: import('@astragit/git-core').GitFileIntent) {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    return getProjectGitFileLocation(resolved.repository.localPath, path, intent);
  }

  async loadIgnorePreview(projectId: string, repositoryId: string, scope: GitIgnoreScope, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitIgnorePreview(resolved.repository.localPath, scope, AbortSignal.any([owned, combined])));
    });
  }

  async loadInteractiveRebasePreview(projectId: string, repositoryId: string, baseRef: string, ontoRef?: string, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitInteractiveRebasePreview(resolved.repository.localPath, baseRef, ontoRef, AbortSignal.any([owned, combined])));
    });
  }

  async loadStopTrackingPreview(projectId: string, repositoryId: string, paths: string[], signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitStopTrackingPreview(resolved.repository.localPath, paths, AbortSignal.any([owned, combined])));
    });
  }

  async loadIgnoredFiles(projectId: string, repositoryId: string, query: GitIgnoredQuery, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return getProjectGitIgnoredFiles(resolved.repository.localPath, query, combined);
    });
  }

  private async withReadQuery<T>(signal: AbortSignal | undefined, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(); this.readQueries.add(controller);
    try { return await read(signal ? AbortSignal.any([controller.signal, signal]) : controller.signal); }
    finally { this.readQueries.delete(controller); }
  }

  async loadArchivePreview(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return getProjectGitArchivePreview(resolved.repository.localPath, input, combined); });
  }

  async loadCommitReplayPreview(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitCommitReplayPreview(resolved.repository.localPath, parseGitCommitReplayInput(input), AbortSignal.any([combined, owned])));
    });
  }

  async loadCommitReplaySeriesPreview(projectId: string, repositoryId: string, input: unknown, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitCommitReplaySeriesPreview(resolved.repository.localPath, parseGitCommitReplaySeriesInput(input), AbortSignal.any([combined, owned])));
    });
  }

  async writeArchive(projectId: string, repositoryId: string, input: unknown, output: Writable, signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => { const resolved = await this.resolveRepository(projectId, repositoryId, combined); return writeProjectGitArchive(resolved.repository.localPath, input, output, combined); });
  }

  cancelReadQueries() { for (const controller of this.readQueries) controller.abort(); this.historyScopes.clear(); }

  async loadSkipPreview(projectId: string, repositoryId: string, kind: 'rebase' | 'cherry_pick' | 'revert' | 'am', signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return this.withRepositoryGate(resolved, owned => getProjectGitSkipPreview(resolved.repository.localPath, kind, AbortSignal.any([owned, combined])));
    });
  }

  async loadCommit(projectId: string, repositoryId: string, commitHash: string): Promise<ProjectGitCommitDetail> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    if (!commitHash.trim()) throw projectError('ASTRAGIT_COMMIT_REQUIRED', '必须选择一个提交。');
    return getProjectGitCommitDetail(resolved.repository.localPath, commitHash);
  }

  async loadComparison(projectId: string, repositoryId: string, ref: string, mode: 'current' | 'working-tree'): Promise<GitDiffSummary> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    if (!ref.trim()) throw projectError('ASTRAGIT_REF_REQUIRED', '必须选择一个比较分支。');
    return getProjectGitComparisonDiff(resolved.repository.localPath, ref, mode);
  }

  async loadRevisionsComparison(projectId: string, repositoryId: string, revisions: [string, string], signal?: AbortSignal) {
    return this.withReadQuery(signal, async combined => {
      const resolved = await this.resolveRepository(projectId, repositoryId, combined);
      return getProjectGitRevisionsDiff(resolved.repository.localPath, revisions, combined);
    });
  }

  async readConflict(projectId: string, repositoryId: string, path: string): Promise<ProjectGitConflictFile> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    return this.withRepositoryGate(resolved, async (signal) => {
      try { return await readProjectGitConflict(resolved.repository.localPath, path, signal); }
      catch (error) { throw workbenchGitError(error); }
    });
  }

  async saveConflict(projectId: string, repositoryId: string, value: unknown): Promise<ProjectGitConflictSaveResponse> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    const input = parseConflictSaveInput(value);
    return this.withRepositoryGate(resolved, async (signal) => {
      const operation = this.operations.start(projectId, resolved.id, resolved.repository.name, input.markResolved ? 'resolve_conflict' : 'save_conflict');
      const commands: string[] = [];
      try {
        const result = await saveProjectGitConflict(resolved.repository.localPath, input, signal, async (command) => {
          commands.push(redactGitOutput(command).slice(0, 65_536));
          this.operations.update(operation.id, { commands: [...commands] });
        });
        const outcome = result.remainingConflictFiles.length ? 'conflict' : 'completed';
        this.operations.update(operation.id, { status: outcome, durationMs: Date.now() - Date.parse(operation.startedAt), commands, output: input.markResolved ? `Resolved and staged: ${input.path}` : `Saved worktree draft: ${input.path}` });
        let snapshot: ProjectGitRepositorySnapshot;
        try { snapshot = await getProjectGitRepositorySnapshot(resolved.repository.localPath); }
        catch (error) { throw Object.assign(projectError('ASTRAGIT_GIT_ACTION_REFRESH_FAILED', '冲突结果已保存，但刷新仓库失败。请刷新核对，避免重复保存。'), { ...gitFailureDiagnostics(error), operationStage: 'refresh', operationStatus: outcome }); }
        return { ...result, snapshot };
      } catch (error) {
        const failure = workbenchGitError(error);
        if (operation.status === 'running') {
          const diagnostics = gitFailureDiagnostics(failure);
          this.operations.update(operation.id, {
            status: diagnostics.operationStatus === 'failed_before_write' ? 'failed_before_write' : 'unknown_after_write', durationMs: Date.now() - Date.parse(operation.startedAt), commands,
            output: redactGitOutput([failure.message, diagnostics.details].filter(Boolean).join('\n')).slice(0, 65_536),
          });
        }
        throw failure;
      }
    });
  }

  async execute(projectId: string, repositoryId: string, value: unknown, signal?: AbortSignal): Promise<ProjectGitActionResponse> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    const action = parseProjectGitAction(value);
    const repositoryPath = resolved.repository.localPath;
    if (this.activeRepositories.has(repositoryPath)) throw projectError('ASTRAGIT_BUSY', '该仓库已有 Git 操作正在执行，请等待完成。');
    const operation = this.operations.start(projectId, resolved.id, resolved.repository.name, action.type);
    const controller = new AbortController();
    const actionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.activeRepositories.set(repositoryPath, controller);
    const commands: string[] = [];
    try {
      actionSignal.throwIfAborted();
      const result = await executeProjectGitAction(resolved.repository.localPath, action, actionSignal, undefined, async (command) => {
        commands.push(redactGitOutput(command).slice(0, 65_536));
        this.operations.update(operation.id, { commands: [...commands], limitations: [] });
      }).catch((error: unknown) => {
        const message = redactGitOutput(error instanceof Error ? error.message : String(error));
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
        const diagnostics = gitFailureDiagnostics(error);
        if (actionSignal.aborted) throw Object.assign(projectError('ASTRAGIT_CANCELLED', 'Git 操作已中止，请刷新核对仓库状态。'), diagnostics, { operationStatus: commands.length ? 'unknown_after_write' : 'failed_before_write' });
        // git-core 仍使用 ASTRAGIT_GIT_* 错误码；应用自有错误使用 ASTRAGIT_*。
        if (/^[A-Z][A-Z0-9_]{1,127}$/u.test(code)) throw Object.assign(projectError(code, message), diagnostics);
        throw Object.assign(projectError('ASTRAGIT_ACTION_FAILED', message), diagnostics);
      });
      const output = redactGitOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
      this.operations.update(operation.id, {
        status: result.outcome,
        durationMs: Date.now() - Date.parse(operation.startedAt),
        output: output.slice(0, 65_536),
        commands,
        limitations: output.length > 65_536 ? ['output_truncated'] : [],
      });
      let snapshot: ProjectGitRepositorySnapshot;
      try { snapshot = await getProjectGitRepositorySnapshot(resolved.repository.localPath); }
      catch (error) {
        const detail = redactGitOutput(error instanceof Error ? error.message : String(error));
        throw Object.assign(projectError('ASTRAGIT_GIT_ACTION_REFRESH_FAILED', 'Git 操作已有结果，但刷新仓库状态失败。请刷新核对结果，避免重复执行。'), {
          details: [`action=${action.type}`, `confirmedOutcome=${result.outcome}`, `branch=${result.branch}`, `head=${result.headSha}`, detail].join('\n'),
          operationStage: 'refresh', operationStatus: result.outcome,
        });
      }
      return {
        projectId: resolved.project.id,
        repositoryId: resolved.id,
        repositoryName: resolved.repository.name,
        result,
        snapshot,
      };
    } catch (error) {
      if (operation.status === 'running') {
        const details = isRecord(error) && typeof error.details === 'string' ? error.details : '';
        const output = redactGitOutput([error instanceof Error ? error.message : String(error), details].filter(Boolean).join('\n'));
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
        const rejectedBeforeChange = new Set(['ASTRAGIT_GIT_BRANCH_INVALID', 'ASTRAGIT_GIT_BRANCH_REQUIRED', 'ASTRAGIT_GIT_BRANCH_NOT_FOUND', 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'ASTRAGIT_GIT_CHECKOUT_BRANCH_IN_USE', 'ASTRAGIT_GIT_CHECKOUT_CONFLICTED']).has(code);
        this.operations.update(operation.id, {
          status: isRecord(error) && (error.operationStatus === 'failed_before_write' || error.operationStatus === 'unknown_after_write') ? error.operationStatus : commands.length && !rejectedBeforeChange ? 'unknown_after_write' : 'failed_before_write',
          durationMs: Date.now() - Date.parse(operation.startedAt),
          output: output.slice(0, 65_536),
          commands,
          limitations: output.length > 65_536 ? ['output_truncated'] : [],
        });
      }
      throw error;
    } finally {
      this.activeRepositories.delete(repositoryPath);
    }
  }

  async cancel(projectId: string, repositoryId: string): Promise<{ cancelled: boolean }> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    const controller = this.activeRepositories.get(resolved.repository.localPath);
    if (!controller) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }

  async resolveCommitTarget(projectId: string, repositoryId: string, relativePath?: string): Promise<{ localPath: string; name: string }> {
    const resolved = await this.resolveRepository(projectId, repositoryId);
    if (relativePath !== undefined && relativePath !== resolved.repository.relativePath) {
      throw projectError('ASTRAGIT_REPOSITORY_PATH_INVALID', '仓库路径与所选仓库不一致，请刷新工作台。');
    }
    return { localPath: resolved.repository.localPath, name: resolved.repository.name };
  }

  requireProject(projectId: string): ProjectGitProjectIdentity {
    const project = this.projects.getById(projectId);
    if (!project || !project.name.trim() || !project.localPath.trim() || !existsSync(project.localPath)) {
      throw projectError('ASTRAGIT_PROJECT_NOT_FOUND', '项目不存在或项目目录不可用。');
    }
    return { id: project.id, name: project.name, localPath: project.localPath };
  }

  /** 与工作台写操作共用同一仓库互斥门；读取三方快照时也不与切换/暂存交错。 */
  private async withRepositoryGate<T>(resolved: ResolvedProjectGitRepository, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const path = resolved.repository.localPath;
    if (this.activeRepositories.has(path)) throw projectError('ASTRAGIT_BUSY', '该仓库已有 Git 操作正在执行，请等待完成。');
    const controller = new AbortController();
    this.activeRepositories.set(path, controller);
    try { return await work(controller.signal); }
    finally { this.activeRepositories.delete(path); }
  }

  private async resolveRepository(projectId: string, repositoryId: string, signal?: AbortSignal): Promise<ResolvedProjectGitRepository> {
    const project = this.requireProject(projectId);
    const normalizedRepositoryId = repositoryId.trim();
    if (!normalizedRepositoryId) throw projectError('ASTRAGIT_REPOSITORY_REQUIRED', '必须选择一个项目仓库。');
    const repositories = await discoverGitRepositories(project.localPath, 6, signal);
    const repository = repositories.find((candidate) => stableRepositoryId(project.id, candidate.relativePath) === normalizedRepositoryId);
    if (!repository) throw projectError('ASTRAGIT_REPOSITORY_NOT_FOUND', '所选仓库已不属于当前项目，请刷新 Git 工作台。');
    return { id: normalizedRepositoryId, project, repository };
  }
}

function parseConflictSaveInput(value: unknown): SaveProjectGitConflictInput {
  if (!isRecord(value) || typeof value.path !== 'string' || typeof value.expectedFingerprint !== 'string' || typeof value.markResolved !== 'boolean' || (value.content !== undefined && typeof value.content !== 'string') || (value.acceptSide !== undefined && value.acceptSide !== 'current' && value.acceptSide !== 'incoming') || Object.keys(value).some(key => !['path', 'expectedFingerprint', 'content', 'acceptSide', 'markResolved'].includes(key))) throw projectError('ASTRAGIT_GIT_CONFLICT_INPUT_INVALID', '冲突保存参数无效，请重新载入后重试。');
  return { path: value.path, expectedFingerprint: value.expectedFingerprint, markResolved: value.markResolved, ...(typeof value.content === 'string' ? { content: value.content } : {}), ...(value.acceptSide ? { acceptSide: value.acceptSide } : {}) };
}
function workbenchGitError(error: unknown): Error & { code: string; statusCode: number } {
  const code = isRecord(error) && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.code) ? error.code : 'ASTRAGIT_ACTION_FAILED';
  return Object.assign(projectError(code, redactGitOutput(error instanceof Error ? error.message : String(error))), gitFailureDiagnostics(error));
}

export function stableRepositoryId(projectId: string, relativePath: string): string {
  return `project_git_repository_${createHash('sha256').update(`${projectId}\0${relativePath}`).digest('hex').slice(0, 24)}`;
}

// 通过 Git 自身识别子模块关系；子树来自标准 git-subtree 提交标记。
export async function loadNavigationMetadata(cwd: string): Promise<{ isSubmodule: boolean; subtreePaths: string[] }> {
  const execute = promisify(execFile);
  const [parent, history] = await Promise.all([
    execute('git', ['rev-parse', '--show-superproject-working-tree'], { cwd, timeout: 10000 }),
    execute('git', ['log', '--all', '--format=%b', '--grep=git-subtree-dir:'], { cwd, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }).catch((error: unknown) => {
      // 新仓库没有提交时，导航仍然可用；其他错误保持可见。
      if (/does not have any commits|bad default revision/iu.test(error instanceof Error ? error.message : '')) return { stdout: '' };
      throw error;
    }),
  ]);
  const subtreePaths = [...new Set([...history.stdout.matchAll(/^git-subtree-dir:\s*(.+)$/gm)].map((match) => match[1]!.trim()).filter((path) => path && !path.startsWith('/') && !path.split('/').includes('..')))];
  return { isSubmodule: Boolean(parent.stdout.trim()), subtreePaths };
}

export function parseProjectGitAction(value: unknown): ProjectGitAction {
  if (!isRecord(value) || typeof value.type !== 'string') throw projectGitError('ASTRAGIT_ACTION_INVALID', '必须选择受支持的 Git 动作。');
  const stringValue = (key: string): string | undefined => (typeof value[key] === 'string' ? value[key].trim() || undefined : undefined);
  const exactString = (key: string): string | undefined => (typeof value[key] === 'string' ? value[key] : undefined);
  const paths = (): string[] => {
    const candidate = value.paths;
    if (!Array.isArray(candidate) || candidate.some((path) => typeof path !== 'string')) throw projectGitError('ASTRAGIT_PATH_INVALID', 'Git 路径必须是字符串数组。');
    return candidate;
  };
  switch (value.type) {
    case 'interactive_rebase': {
      const steps = value.steps;
      if (!Array.isArray(steps) || !steps.length || steps.length > 2000 || steps.some(step => !isRecord(step) || typeof step.sha !== 'string' || typeof step.action !== 'string' || !['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'].includes(step.action) || (step.message !== undefined && typeof step.message !== 'string'))) throw projectGitError('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '交互变基计划无效。');
      const groups = value.groupMessages;
      if (groups !== undefined && (!isRecord(groups) || Object.values(groups).some(message => typeof message !== 'string'))) throw projectGitError('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '合并说明无效。');
      return { type: 'interactive_rebase', baseSha: stringValue('baseSha') ?? '', ontoSha: stringValue('ontoSha') ?? '', expectedFingerprint: stringValue('expectedFingerprint') ?? '', steps: steps.map(step => ({ sha: step.sha as string, action: step.action as import('@astragit/git-core').GitRebasePlanAction, ...(step.message !== undefined ? { message: step.message as string } : {}) })), groupMessages: groups as Record<string, string> | undefined, allowFlattenMerges: value.allowFlattenMerges === true, allowOverwriteObstacles: value.allowOverwriteObstacles === true };
    }
    case 'amend_rebase_step':
      if (typeof value.message !== 'string') throw projectGitError('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '请填写完整提交说明。');
      return { type: 'amend_rebase_step', message: value.message, expectedHeadSha: stringValue('expectedHeadSha') ?? '', expectedIndexFingerprint: stringValue('expectedIndexFingerprint') ?? '', expectedStepFingerprint: stringValue('expectedStepFingerprint') ?? '' };
    case 'stop_tracking':
      return { type: value.type, paths: paths(), force: value.force === true, expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'stage_ignored':
      return { type: value.type, paths: paths(), largeFileReview: parseGitLargeFileReview(value.largeFileReview) };
    case 'ignore': {
      if (value.scope !== 'repository' && value.scope !== 'local' && value.scope !== 'global') throw projectError('ASTRAGIT_GIT_IGNORE_INVALID', '忽略范围无效。');
      if (!Array.isArray(value.patterns) || !value.patterns.every(pattern => typeof pattern === 'string')) throw projectError('ASTRAGIT_GIT_IGNORE_INVALID', '忽略规则必须是字符串数组。');
      return { type: value.type, scope: value.scope, patterns: value.patterns, expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    }
    case 'reset_revision':
      if (value.mode !== 'soft' && value.mode !== 'mixed' && value.mode !== 'hard') throw projectError('ASTRAGIT_GIT_RESET_MODE_INVALID', '重置方式无效。');
      return { type: value.type, mode: value.mode, targetSha: stringValue('targetSha') ?? '', expectedFingerprint: stringValue('expectedFingerprint') ?? '', discardNestedRepositories: value.discardNestedRepositories === true };
    case 'skip_integration':
      if (value.kind !== 'rebase' && value.kind !== 'cherry_pick' && value.kind !== 'revert' && value.kind !== 'am') throw projectError('ASTRAGIT_GIT_INTEGRATION_CHANGED', '只有变基、拣选、反向提交或邮件补丁可以跳过当前步骤。');
      return { type: value.type, kind: value.kind, expectedFingerprint: stringValue('expectedFingerprint') ?? '', discardNestedRepositories: value.discardNestedRepositories === true };
    case 'set_identity_field':
      if ((value.field !== 'name' && value.field !== 'email') || (value.value !== null && typeof value.value !== 'string')) throw projectError('ASTRAGIT_ACTION_INVALID', '提交身份设置无效。');
      return { type: value.type, field: value.field, value: value.value, expectedSettingsFingerprint: stringValue('expectedSettingsFingerprint') ?? '' };
    case 'configure_commit_template':
      return parseGitCommitTemplateChange(value);
    case 'configure_remote': {
      const operations = ['add', 'rename', 'remove', 'set_fetch_url', 'set_push_url', 'clear_push_url'] as const;
      if (!operations.includes(value.operation as typeof operations[number])) throw projectError('ASTRAGIT_ACTION_INVALID', '远程设置操作无效。');
      return { type: value.type, operation: value.operation as typeof operations[number], name: stringValue('name') ?? '', value: stringValue('value'), expectedSettingsFingerprint: stringValue('expectedSettingsFingerprint') ?? '' };
    }
    case 'amend_commit':
      return { type: 'amend_commit', message: typeof value.message === 'string' ? value.message : '', expectedHeadSha: stringValue('expectedHeadSha') ?? '', expectedBranch: stringValue('expectedBranch') ?? '', expectedIndexFingerprint: stringValue('expectedIndexFingerprint') ?? '' };
    case 'subtree':
      if (value.operation !== 'add' && value.operation !== 'pull' && value.operation !== 'push') throw projectGitError('ASTRAGIT_ACTION_INVALID', '不支持的子树操作。');
      return { type: 'subtree', operation: value.operation, path: typeof value.path === 'string' ? value.path : '', remote: stringValue('remote') ?? '', branch: stringValue('branch') ?? '' };
    case 'external_tool':
      return { type: 'external_tool', input: parseGitExternalToolInput(value.input), expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'manage_lfs':
      return { type: 'manage_lfs', change: parseGitLfsChange(value.change), expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'manage_flow':
      return { type: 'manage_flow', change: parseGitFlowChange(value.change), expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'configure_external_tool':
      return { type: 'configure_external_tool', configuration: parseGitExternalToolConfiguration(value.configuration), expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'manage_submodule':
      return { type: 'manage_submodule', change: parseGitSubmoduleChange(value.change), expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'submodule_update':
      return { type: 'submodule_update', path: typeof value.path === 'string' ? value.path : '' };
    case 'continue_integration':
    case 'abort_integration':
      if (value.kind !== 'merge' && value.kind !== 'rebase' && value.kind !== 'cherry_pick' && value.kind !== 'revert' && value.kind !== 'am') throw projectGitError('ASTRAGIT_ACTION_INVALID', '恢复动作必须指定实际进行中的整合类型。');
      return { type: value.type, kind: value.kind };
    case 'fetch':
      return { type: 'fetch', remote: stringValue('remote') };
    case 'discard':
      return { type: 'discard', paths: paths() };
    case 'rename_branch':
      return { type: 'rename_branch', branchName: stringValue('branchName') ?? '', newName: stringValue('newName') ?? '' };
    case 'create_tag':
      if ((value.annotated !== undefined && typeof value.annotated !== 'boolean') || (value.message !== undefined && typeof value.message !== 'string')) throw projectGitError('ASTRAGIT_GIT_TAG_OPTIONS_INVALID', '标签类型或说明无效。');
      return { type: 'create_tag', tagName: exactString('tagName') ?? '', revision: exactString('revision') ?? '', message: exactString('message'), annotated: value.annotated as boolean | undefined, expectedTargetSha: exactString('expectedTargetSha') };
    case 'push_tag':
      return { type: 'push_tag', tagName: exactString('tagName') ?? '', remote: exactString('remote') ?? '', expectedTagObjectSha: exactString('expectedTagObjectSha'), expectedRemotePushFingerprint: exactString('expectedRemotePushFingerprint') };
    case 'delete_tag':
      return { type: 'delete_tag', tagName: exactString('tagName') ?? '', expectedTagObjectSha: exactString('expectedTagObjectSha') };
    case 'delete_remote_tag':
      return { type: 'delete_remote_tag', tagName: exactString('tagName') ?? '', remote: exactString('remote') ?? '', expectedRemotePushFingerprint: exactString('expectedRemotePushFingerprint') ?? '', expectedTargets: value.expectedTargets as Array<string | null> };
    case 'stage':
      return { type: 'stage', paths: paths(), largeFileReview: parseGitLargeFileReview(value.largeFileReview) };
    case 'unstage':
      return { type: 'unstage', paths: paths() };
    case 'import_mailbox':
      return { type: 'import_mailbox', mailbox: value.mailbox as unknown as import('@astragit/git-core').GitMailboxInput, expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'import_patch':
      return { type: 'import_patch', patch: value.patch as unknown as GitPatchInput, expectedFingerprint: stringValue('expectedFingerprint') ?? '' };
    case 'apply_line_changes':
      return { type: value.type, input: parseGitLineChange(value.input), largeFileReview: parseGitLargeFileReview(value.largeFileReview) };
    case 'apply_patch':
      return {
        type: 'apply_patch',
        patch: typeof value.patch === 'string' ? value.patch : '',
        reverse: value.reverse === true,
        target: value.target === 'worktree' ? 'worktree' : 'index',
      };
    case 'commit':
      if (value.selectionMode !== undefined && value.selectionMode !== 'staged' && value.selectionMode !== 'worktree') throw projectError('ASTRAGIT_INVALID_ACTION', '提交内容范围无效。');
      return {
        type: 'commit',
        message: stringValue('message') ?? '',
        ...(value.paths === undefined ? {} : { paths: paths() }),
        selectionMode: value.selectionMode === 'staged' ? 'staged' : 'worktree',
        expectedFingerprint: stringValue('expectedFingerprint'),
        expectedHeadSha: typeof value.expectedHeadSha === 'string' ? value.expectedHeadSha : undefined,
        expectedBranch: stringValue('expectedBranch'),
      };
    case 'push':
      return {
        type: 'push',
        remote: stringValue('remote'),
        sourceBranch: stringValue('sourceBranch'),
        targetBranch: stringValue('targetBranch'),
        setUpstream: typeof value.setUpstream === 'boolean' ? value.setUpstream : undefined,
        forceWithLease: value.forceWithLease === true,
        pushTags: value.pushTags === true,
        pushAllTags: value.pushAllTags === true,
        expectedHeadSha: typeof value.expectedHeadSha === 'string' ? value.expectedHeadSha : undefined,
        expectedBranch: stringValue('expectedBranch'),
      };
    case 'pull': {
      if (value.strategy !== 'rebase' && value.strategy !== 'merge') throw projectGitError('ASTRAGIT_PULL_STRATEGY_INVALID', '拉取策略必须是 merge 或 rebase。');
      return {
        type: 'pull',
        remote: stringValue('remote'),
        targetBranch: stringValue('targetBranch'),
        strategy: value.strategy,
        commitMerge: value.commitMerge !== false,
        includeMergeLog: value.includeMergeLog === true,
        noFastForward: value.noFastForward === true,
      };
    }
    case 'update': {
      if (value.strategy !== 'merge' && value.strategy !== 'rebase' && value.strategy !== 'reset') throw projectGitError('ASTRAGIT_UPDATE_STRATEGY_INVALID', '更新策略必须是 merge、rebase 或 reset。');
      return { type: 'update', strategy: value.strategy, smart: value.smart === true };
    }
    case 'checkout':
      return { type: 'checkout', branchName: stringValue('branchName') ?? '', smart: value.smart === true, stashBeforeCheckout: value.stashBeforeCheckout === true };
    case 'checkout_revision':
      return { type: 'checkout_revision', revision: stringValue('revision') ?? '', smart: value.smart === true, stashBeforeCheckout: value.stashBeforeCheckout === true };
    case 'create_branch':
      return { type: 'create_branch', branchName: stringValue('branchName') ?? '', baseRef: stringValue('baseRef'), trackRemote: value.trackRemote === true, smart: value.smart === true, stashBeforeCheckout: value.stashBeforeCheckout === true };
    case 'delete_branch':
      if (value.force !== undefined && typeof value.force !== 'boolean') throw projectGitError('ASTRAGIT_ACTION_INVALID', '删除分支的强制选项无效。');
      return { type: 'delete_branch', branchName: stringValue('branchName') ?? '', force: value.force === true, expectedTargetHeadSha: stringValue('expectedTargetHeadSha') };
    case 'delete_remote_branch':
      return { type: 'delete_remote_branch', remote: stringValue('remote') ?? '', branchName: stringValue('branchName') ?? '', expectedTargetHeadSha: stringValue('expectedTargetHeadSha') ?? '', expectedRemotePushFingerprint: stringValue('expectedRemotePushFingerprint') ?? '' };
    case 'set_upstream':
      if ((value.upstreamRef !== null && typeof value.upstreamRef !== 'string') || (value.expectedUpstreamRef !== null && typeof value.expectedUpstreamRef !== 'string')) throw projectGitError('ASTRAGIT_ACTION_INVALID', '上游分支设置参数无效。');
      return { type: 'set_upstream', branchName: stringValue('branchName') ?? '', upstreamRef: value.upstreamRef === null ? null : stringValue('upstreamRef') ?? '', expectedUpstreamRef: value.expectedUpstreamRef === null ? null : stringValue('expectedUpstreamRef') ?? '', expectedTargetHeadSha: stringValue('expectedTargetHeadSha') ?? '' };
    case 'cherry_pick_series':
      if (typeof value.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.expectedFingerprint)) throw projectError('ASTRAGIT_GIT_REPLAY_INVALID', '批量拣选确认无效，请重新预览。');
      return { type: 'cherry_pick_series', input: parseGitCommitReplaySeriesInput(value.input), expectedFingerprint: value.expectedFingerprint };
    case 'revert':
    case 'cherry_pick': {
      const input = parseGitCommitReplayInput({ kind: value.type, revision: stringValue('revision') ?? '', ...(value.mainline !== undefined ? { mainline: value.mainline } : {}), ...(value.commit !== undefined ? { commit: value.commit } : {}), ...(value.includeSourceId !== undefined ? { includeSourceId: value.includeSourceId } : {}) });
      if (value.expectedFingerprint !== undefined && (typeof value.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.expectedFingerprint))) throw projectError('ASTRAGIT_GIT_REPLAY_INVALID', '提交整合确认已失效，请重新预览。');
      return { type: value.type, revision: input.revision, ...(input.mainline !== undefined ? { mainline: input.mainline } : {}), ...(value.commit !== undefined ? { commit: input.commit } : {}), ...(value.includeSourceId !== undefined ? { includeSourceId: input.includeSourceId } : {}), ...(value.expectedFingerprint !== undefined ? { expectedFingerprint: value.expectedFingerprint } : {}) };
    }
    case 'merge':
      return { type: 'merge', branchName: stringValue('branchName') ?? '', ...(typeof value.commitMerge === 'boolean' ? { commitMerge: value.commitMerge } : {}), ...(typeof value.includeMergeLog === 'boolean' ? { includeMergeLog: value.includeMergeLog } : {}), ...(typeof value.noFastForward === 'boolean' ? { noFastForward: value.noFastForward } : {}), expectedHeadSha: stringValue('expectedHeadSha'), expectedBranch: stringValue('expectedBranch'), expectedSourceHeadSha: stringValue('expectedSourceHeadSha') };
    case 'rebase':
      return { type: 'rebase', branchName: stringValue('branchName') ?? '' };
    case 'stash':
      return { type: 'stash', message: stringValue('message'), includeUntracked: value.includeUntracked === true, keepIndex: value.keepIndex === true };
    case 'apply_stash':
      return { type: 'apply_stash', stashRef: stringValue('stashRef') ?? '', pop: value.pop === true };
    case 'drop_stash':
      return { type: 'drop_stash', stashRef: stringValue('stashRef') ?? '' };
    default:
      throw projectGitError('ASTRAGIT_ACTION_UNSUPPORTED', `不支持的项目 Git 动作：${value.type}`);
  }
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 错误身份和脱敏命令诊断穿过服务边界；不能只留下概括消息。 */
export function gitFailureDiagnostics(error: unknown): Record<string, string | number | boolean | string[]> {
  if (!isRecord(error)) return {};
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const key of ['details', 'command', 'stdout', 'stderr', 'operationStage', 'operationStatus', 'savedStash', 'blockedBy'] as const) {
    if (typeof error[key] === 'string') result[key] = redactGitOutput(error[key]).slice(0, 65_536);
  }
  if (typeof error.exitCode === 'number') result.exitCode = error.exitCode;
  if (error.interrupted === true) result.interrupted = true;
  if (Array.isArray(error.affectedFiles)) result.affectedFiles = error.affectedFiles.filter((path): path is string => typeof path === 'string' && Boolean(path) && !path.includes('\0') && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/u.test(path) && !path.split('/').includes('..')).slice(0, 200).map(path => path.slice(0, 4096));
  if (typeof error.affectedFileCount === 'number' && Number.isSafeInteger(error.affectedFileCount) && error.affectedFileCount >= 0) result.affectedFileCount = error.affectedFileCount;
  return result;
}

async function mapWithConcurrency<T, R>(items: readonly T[], mapper: (item: T, index: number) => Promise<R>, concurrency = 6): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
