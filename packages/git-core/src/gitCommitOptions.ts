export interface GitCommitOptions {
  skipHooks?: boolean;
  signCommit?: boolean;
  signoff?: boolean;
}

const commitOptionFlags = {
  skipHooks: '--no-verify',
  signCommit: '--gpg-sign',
  signoff: '--signoff',
} as const;

export function parseGitCommitOptions(value: unknown): GitCommitOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, flag]) => !Object.hasOwn(commitOptionFlags, key) || typeof flag !== 'boolean')) {
    throw Object.assign(new Error('提交选项无效。'), { code: 'ASTRAGIT_INVALID_ACTION' });
  }
  return { ...value };
}

export function gitCommitOptionArgs(options?: GitCommitOptions): string[] {
  if (!options) return [];
  return (Object.keys(commitOptionFlags) as Array<keyof GitCommitOptions>)
    .filter(key => options[key] === true)
    .map(key => commitOptionFlags[key]);
}
