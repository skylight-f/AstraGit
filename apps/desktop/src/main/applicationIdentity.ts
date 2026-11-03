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
  const installedDirectory = resolve(options.appDataPath, 'AstraGit');
  const dataDirectory = resolve(options.userDataDirectory ?? (development ? join(workspace, '.tmp/electron-development-data') : installedDirectory));
  const isolatedProfile = !development && Boolean(options.userDataDirectory) && dataDirectory !== installedDirectory;
  const profileIdentity = createHash('sha256').update(dataDirectory).digest('hex').slice(0, 12);
  return {
    development,
    // 正式包的隔离验收也不能向已安装版本的 Safe Storage 条目取钥匙。
    name: development ? `AstraGit Development ${identity}` : isolatedProfile ? `AstraGit Profile ${profileIdentity}` : 'AstraGit',
    dataDirectory,
  };
}
