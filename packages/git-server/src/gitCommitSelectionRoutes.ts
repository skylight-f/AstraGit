import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getGitRepositoryContext, parseGitUnifiedDiff, readSelectedGitCommitChanges, validateProjectGitPushTarget, type GitCommitSelectionMode } from '@astragit/git-core';
import type { ProjectGitWorkbenchService } from './projectGitWorkbenchService.js';
import { sendNativeQueryRouteError } from './nativeQueryRouteError.js';

type Target = { repositoryId: string; relativePath: string; paths: string[] };
export function parseCommitSelection(value: unknown): Target[] {
  if (!Array.isArray(value) || !value.length || value.length > 20 || value.some(target => {
    if (!target || typeof target !== 'object') return true;
    const item = target as Record<string, unknown>;
    return typeof item.repositoryId !== 'string' || !item.repositoryId || item.repositoryId.length > 200 ||
      typeof item.relativePath !== 'string' || !item.relativePath || item.relativePath.length > 4096 ||
      !Array.isArray(item.paths) || !item.paths.length || item.paths.length > 2000 ||
      item.paths.some(path => typeof path !== 'string' || !path || path.length > 4096);
  })) throw Object.assign(new Error('所选提交范围无效或过大，请重新选择。'), { code: 'ASTRAGIT_COMMIT_SELECTION_INVALID' });
  const targets = value as Target[];
  if (new Set(targets.map(target => target.repositoryId)).size !== targets.length || targets.reduce((sum, target) => sum + target.paths.length, 0) > 2000) throw Object.assign(new Error('提交范围包含重复仓库或过多文件。'), { code: 'ASTRAGIT_COMMIT_SELECTION_INVALID' });
  return targets;
}

export function registerCommitSelectionRoutes(server: FastifyInstance, workbench: ProjectGitWorkbenchService) {
  server.post('/api/projects/:projectId/git/commit-selection/push-targets', async (request: FastifyRequest<{ Params: { projectId: string }; Body: { targets?: unknown } }>, reply) => {
    try {
      const targets = request.body?.targets;
      if (!Array.isArray(targets) || !targets.length || targets.length > 20) throw new Error('推送目标无效。');
      await Promise.all(targets.map(async (value: unknown) => {
        if (!value || typeof value !== 'object') throw new Error('推送目标无效。');
        const target = value as Record<string, unknown>;
        if (['repositoryId', 'relativePath', 'remote', 'sourceBranch', 'targetBranch'].some(key => typeof target[key] !== 'string' || !(target[key] as string).trim() || (target[key] as string).length > 4096)) throw new Error('请选择每个仓库的远程与目标分支。');
        const repository = await workbench.resolveCommitTarget(request.params.projectId, target.repositoryId as string, target.relativePath as string);
        await validateProjectGitPushTarget(repository.localPath, target.remote as string, target.sourceBranch as string, target.targetBranch as string);
      }));
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && !('code' in error)) Object.assign(error, { code: 'ASTRAGIT_PUSH_TARGET_INVALID' });
      return sendNativeQueryRouteError(reply, error);
    }
  });
  server.post('/api/projects/:projectId/git/commit-selection', { bodyLimit: 512_000 }, async (request: FastifyRequest<{ Params: { projectId: string }; Body: { selection?: unknown; selectionMode?: unknown } }>, reply) => {
    try {
      const targets = parseCommitSelection(request.body?.selection);
      if (request.body.selectionMode !== undefined && request.body.selectionMode !== 'worktree' && request.body.selectionMode !== 'staged') throw Object.assign(new Error('提交内容类型无效。'), { code: 'ASTRAGIT_COMMIT_SELECTION_INVALID' });
      const mode: GitCommitSelectionMode = request.body.selectionMode === 'staged' ? 'staged' : 'worktree';
      const previews = await Promise.all(targets.map(async target => {
        const repository = await workbench.resolveCommitTarget(request.params.projectId, target.repositoryId, target.relativePath);
        const changes = await readSelectedGitCommitChanges(repository.localPath, target.paths, mode);
        const context = await getGitRepositoryContext(repository.localPath);
        if (context.headSha !== changes.head) throw Object.assign(new Error('仓库提交已变化，请重新读取。'), { code: 'ASTRAGIT_COMMIT_SELECTION_STALE' });
        const truncated = changes.diff.length > 200_000;
        const partial = changes.diff.slice(0, 200_000);
        const diffText = truncated ? partial.slice(0, partial.lastIndexOf('\n') + 1) : partial;
        return { ...target, name: repository.name, fingerprint: changes.fingerprint, headSha: context.headSha, branch: context.branch, detached: context.detached,
          diff: { isRepository: true, files: changes.files, diffText, fileDiffs: parseGitUnifiedDiff(diffText) }, truncated };
      }));
      return { projectId: request.params.projectId, selectionMode: mode, repositories: previews };
    } catch (error) {
      if (error instanceof Error && !('code' in error)) Object.assign(error, { code: 'ASTRAGIT_COMMIT_SELECTION_INVALID' });
      return sendNativeQueryRouteError(reply, error);
    }
  });
}
