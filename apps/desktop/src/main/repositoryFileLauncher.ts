import type { GitFileIntent, GitFileLocation } from '@astragit/git-core';
import { userFacingErrorCause } from '@astragit/shared';

export function createRepositoryFileLauncher(options: {
  resolve: (projectId: string, repositoryId: string, path: string, intent: GitFileIntent) => Promise<GitFileLocation>;
  open: (path: string) => Promise<string>;
  openText?: (path: string) => Promise<void>;
  reveal: (path: string) => void;
}) {
  return async (request: unknown) => {
    try {
      if (!request || typeof request !== 'object') throw Object.assign(new Error('文件操作请求无效。'), { code: 'ASTRAGIT_GIT_FILE_ACTION_INVALID' });
      const value = request as Record<string, unknown>;
      if (typeof value.projectId !== 'string' || typeof value.repositoryId !== 'string' || typeof value.path !== 'string' || (value.intent !== 'open' && value.intent !== 'reveal' && value.intent !== 'edit-ignore-rule')) throw Object.assign(new Error('文件操作请求无效。'), { code: 'ASTRAGIT_GIT_FILE_ACTION_INVALID' });
      const location = await options.resolve(value.projectId, value.repositoryId, value.path, value.intent);
      if (value.intent === 'edit-ignore-rule') {
        if (!options.openText) throw Object.assign(new Error('Text editor is unavailable.'), { code: 'ASTRAGIT_GIT_FILE_ACTION_UNAVAILABLE' });
        await options.openText(location.path);
      } else if (value.intent === 'open') {
        const error = await options.open(location.path);
        if (error) throw Object.assign(new Error(error), { code: 'ASTRAGIT_GIT_FILE_OPEN_FAILED' });
      } else options.reveal(location.path);
      return { ok: true as const, missingFile: location.missingFile };
    } catch (error) { return { ok: false as const, error: userFacingErrorCause(error) }; }
  };
}
