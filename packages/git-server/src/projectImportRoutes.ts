import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import { scanGitProjectDirectories, verifyGitProjectDirectories } from '@astragit/git-core';
import type { ProjectDirectoryScan } from '@astragit/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { canonicalProjectPath, projectError, type ProjectStore } from './projectStore.js';

function isAbsoluteDirectoryPath(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && isAbsolute(value);
}

async function scanRoot(value: unknown): Promise<string> {
  if (!isAbsoluteDirectoryPath(value)) throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '请选择有效的绝对目录路径。');
  const root = await realpath(value).catch(() => null);
  if (!root || !(await stat(root).catch(() => null))?.isDirectory()) {
    throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '无法读取所选文件夹，请检查目录是否存在以及访问权限。');
  }
  if (dirname(root) === root) throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '请选择具体的项目文件夹。');
  return root;
}

export function registerProjectImportRoutes(server: FastifyInstance, projects: ProjectStore, sendError: (reply: FastifyReply, error: unknown) => unknown): void {
  server.post<{ Body: { root?: unknown } }>('/api/projects/scan', async (request, reply) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      const root = await scanRoot(request.body?.root);
      const { directories, skipped } = await scanGitProjectDirectories(root, controller.signal);
      const registered = new Set(projects.list().map(project => canonicalProjectPath(project.localPath)));
      return {
        root,
        items: directories.map(localPath => ({ localPath, name: basename(localPath), alreadyAdded: registered.has(localPath) })),
        skipped,
      } satisfies ProjectDirectoryScan;
    } catch (error) {
      if (!controller.signal.aborted) return sendError(reply, error);
    } finally {
      reply.raw.removeListener('close', abort);
    }
  });

  server.post<{ Body: { root?: unknown; paths?: unknown } }>('/api/projects/import', async (request, reply) => {
    try {
      const paths = request.body?.paths;
      if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isAbsoluteDirectoryPath)) {
        throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '请勾选要添加的 Git 仓库。');
      }
      const root = await scanRoot(request.body.root);
      const selected = [...new Set<string>(paths)];
      await verifyGitProjectDirectories(root, selected);
      return { added: projects.importDirectories(selected) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
