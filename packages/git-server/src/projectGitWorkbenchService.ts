import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  discoverGitRepositories,
  executeProjectGitAction,
  getProjectGitCommitDetail,
  getProjectGitComparisonDiff,
  getProjectGitHistory,
  getProjectGitRepositorySnapshot,
  redactGitOutput,
  type DiscoveredGitRepository,
  type GitDiffSummary,
  type ProjectGitAction,
  type ProjectGitActionResult,
  type ProjectGitCommitDetail,
  type ProjectGitRepositorySnapshot,
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

interface ResolvedProjectGitRepository {
  id: string;
  project: ProjectGitProjectIdentity;
  repository: DiscoveredGitRepository;
}

/** 工作台服务：只从简化项目列表解析可信路径，再发现仓库。 */
export class ProjectGitWorkbenchService {
  private readonly activeRepositories = new Map<string, AbortController>();

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
        const _details = isRecord(error) && typeof error.details === 'string' ? error.details : undefined;
        if (actionSignal.aborted) throw projectError('ASTRAGIT_CANCELLED', `Git 操作已中止，请刷新核对仓库状态。\n${message}`);
        // git-core 仍使用 ASTRAGIT_GIT_* 错误码；应用自有错误使用 ASTRAGIT_*。
        if ((code.startsWith('ASTRAGIT_GIT_') && code !== 'ASTRAGIT_GIT_COMMAND_FAILED') || (code.startsWith('ASTRAGIT_') && code !== 'ASTRAGIT_COMMAND_FAILED')) throw projectError(code, message);
        throw projectError('ASTRAGIT_ACTION_FAILED', message);
      });
      const output = redactGitOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
      this.operations.update(operation.id, {
        status: result.outcome,
        durationMs: Date.now() - Date.parse(operation.startedAt),
        output: output.slice(0, 65_536),
        commands,
        limitations: output.length > 65_536 ? ['output_truncated'] : [],
      });
      return {
        projectId: resolved.project.id,
        repositoryId: resolved.id,
        repositoryName: resolved.repository.name,
        result,
        snapshot: await getProjectGitRepositorySnapshot(resolved.repository.localPath),
      };
    } catch (error) {
      if (operation.status === 'running') {
        const output = redactGitOutput(error instanceof Error ? error.message : String(error));
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
        const rejectedBeforeChange = new Set(['ASTRAGIT_GIT_BRANCH_INVALID', 'ASTRAGIT_GIT_BRANCH_REQUIRED', 'ASTRAGIT_GIT_BRANCH_NOT_FOUND', 'ASTRAGIT_GIT_CHECKOUT_BLOCKED', 'ASTRAGIT_GIT_CHECKOUT_BRANCH_IN_USE', 'ASTRAGIT_GIT_CHECKOUT_CONFLICTED']).has(code);
        this.operations.update(operation.id, {
          status: commands.length && !rejectedBeforeChange ? 'unknown_after_write' : 'failed_before_write',
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

  private async resolveRepository(projectId: string, repositoryId: string): Promise<ResolvedProjectGitRepository> {
    const project = this.requireProject(projectId);
    const normalizedRepositoryId = repositoryId.trim();
    if (!normalizedRepositoryId) throw projectError('ASTRAGIT_REPOSITORY_REQUIRED', '必须选择一个项目仓库。');
    const repositories = await discoverGitRepositories(project.localPath);
    const repository = repositories.find((candidate) => stableRepositoryId(project.id, candidate.relativePath) === normalizedRepositoryId);
    if (!repository) throw projectError('ASTRAGIT_REPOSITORY_NOT_FOUND', '所选仓库已不属于当前项目，请刷新 Git 工作台。');
    return { id: normalizedRepositoryId, project, repository };
  }
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

function parseProjectGitAction(value: unknown): ProjectGitAction {
  if (!isRecord(value) || typeof value.type !== 'string') throw projectGitError('ASTRAGIT_ACTION_INVALID', '必须选择受支持的 Git 动作。');
  const stringValue = (key: string): string | undefined => (typeof value[key] === 'string' ? value[key].trim() || undefined : undefined);
  const paths = (): string[] => {
    const candidate = value.paths;
    if (!Array.isArray(candidate) || candidate.some((path) => typeof path !== 'string')) throw projectGitError('ASTRAGIT_PATH_INVALID', 'Git 路径必须是字符串数组。');
    return candidate;
  };
  switch (value.type) {
    case 'subtree':
      if (value.operation !== 'add' && value.operation !== 'pull' && value.operation !== 'push') throw projectGitError('ASTRAGIT_ACTION_INVALID', '不支持的子树操作。');
      return { type: 'subtree', operation: value.operation, path: typeof value.path === 'string' ? value.path : '', remote: stringValue('remote') ?? '', branch: stringValue('branch') ?? '' };
    case 'submodule_update':
      return { type: 'submodule_update', path: typeof value.path === 'string' ? value.path : '' };
    case 'continue_integration':
    case 'abort_integration':
      if (value.kind !== 'merge' && value.kind !== 'rebase') throw projectGitError('ASTRAGIT_ACTION_INVALID', '恢复动作必须指定合并或变基。');
      return { type: value.type, kind: value.kind };
    case 'fetch':
      return { type: 'fetch', remote: stringValue('remote') };
    case 'discard':
      return { type: 'discard', paths: paths() };
    case 'rename_branch':
      return { type: 'rename_branch', branchName: stringValue('branchName') ?? '', newName: stringValue('newName') ?? '' };
    case 'create_tag':
      return { type: 'create_tag', tagName: stringValue('tagName') ?? '', revision: stringValue('revision') ?? '', message: stringValue('message') };
    case 'push_tag':
      return { type: 'push_tag', tagName: stringValue('tagName') ?? '', remote: stringValue('remote') ?? '' };
    case 'delete_tag':
      return { type: 'delete_tag', tagName: stringValue('tagName') ?? '' };
    case 'stage':
      return { type: 'stage', paths: paths() };
    case 'unstage':
      return { type: 'unstage', paths: paths() };
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
      return { type: 'checkout', branchName: stringValue('branchName') ?? '', smart: value.smart === true };
    case 'checkout_revision':
      return { type: 'checkout_revision', revision: stringValue('revision') ?? '', smart: value.smart === true };
    case 'create_branch':
      return { type: 'create_branch', branchName: stringValue('branchName') ?? '', baseRef: stringValue('baseRef'), trackRemote: value.trackRemote === true, smart: value.smart === true };
    case 'delete_branch':
      return { type: 'delete_branch', branchName: stringValue('branchName') ?? '' };
    case 'revert':
      return { type: 'revert', revision: stringValue('revision') ?? '' };
    case 'cherry_pick':
      return { type: 'cherry_pick', revision: stringValue('revision') ?? '' };
    case 'merge':
      return { type: 'merge', branchName: stringValue('branchName') ?? '' };
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
