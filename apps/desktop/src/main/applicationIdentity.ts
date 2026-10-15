import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export function applicationIdentity(options: {
  packaged: boolean;
  rendererUrl?: string;
  appPath: string;
  appDataPath: string;
  userDataDirectory?: string;
}): { development: boolean; name: string; dataDirectory: string } {
  const development = !options.packaged && Boolean(options.rendererUrl);
  const workspace = resolve(options.appPath, '../..');
  // Electron derives the macOS Safe Storage service from app.getName(). A
  // different dev executable must never request the installed app's key.
  const identity = createHash('sha256').update(workspace).digest('hex').slice(0, 12);
  return {
    development,
    name: development ? `AstraGit Development ${identity}` : 'AstraGit',
    dataDirectory: resolve(options.userDataDirectory ?? (development
      ? join(workspace, '.tmp/electron-development-data')
      : join(options.appDataPath, 'AstraGit'))),
  };
}
