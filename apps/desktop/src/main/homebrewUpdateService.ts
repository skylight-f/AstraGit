import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { compareReleaseVersions, homebrewCask, homebrewTap, releasePageUrl, redactUserFacingErrorDetails, type ReleaseUpdateProgress, type ReleaseUpdateStatus } from '@astragit/shared';
import { execFile } from './releaseVerification.js';
import { verifyDownloadedArtifact } from './releaseArtifact.js';
import { fetchHomebrewArtifact } from './homebrewDownload.js';

export interface HomebrewCaskInfo { version: string; installedVersion: string | null; tap: string; url: string; sha256: string; appTarget: string }
export interface HomebrewPreparedUpdate { update: ReleaseUpdateStatus; brewPath: string; cachePath: string }
export function parseHomebrewCask(value: unknown): HomebrewCaskInfo {
  const data = value as { casks?: Array<{ token: string; tap: string; version: string; installed: string | null; url: string; sha256: string; artifacts: Array<{ app?: string[]; target?: string }> }> };
  const cask = data?.casks?.length === 1 ? data.casks[0] : null;
  const app = cask?.artifacts?.find(item => item.app?.length === 1 && item.app[0] === 'AstraGit.app');
  if (!cask || cask.token !== 'astragit' || cask.tap !== homebrewTap || !/^\d+\.\d+\.\d+$/u.test(cask.version) || (cask.installed !== null && !/^\d+\.\d+\.\d+$/u.test(cask.installed)) || typeof cask.url !== 'string' || !/^[a-f0-9]{64}$/u.test(cask.sha256) || !app?.target || !isAbsolute(app.target)) throw new Error('Homebrew 未返回本发行版唯一有效的 AstraGit Cask。');
  return { version: cask.version, installedVersion: cask.installed, tap: cask.tap, url: cask.url, sha256: cask.sha256, appTarget: resolve(app.target) };
}
export function assertHomebrewRelease(cask: HomebrewCaskInfo, update: ReleaseUpdateStatus) {
  const artifact = update.artifact;
  if (!artifact || update.status !== 'available' || update.installMethod !== 'homebrew' || artifact.fileName !== `AstraGit-${update.latestVersion}-${artifact.arch}.dmg` || artifact.downloadUrl !== `${releasePageUrl}/download/v${update.latestVersion}/${artifact.fileName}`) throw new Error('Homebrew 更新清单的版本、架构或来源无效。');
  if (cask.version !== update.latestVersion) {
    if (compareReleaseVersions(cask.version, update.latestVersion) < 0) throw new Error(`Homebrew 尚未同步：发布版本为 ${update.latestVersion}，当前 Cask 为 ${cask.version}。请稍后重试，应用保持运行。`);
    throw new Error(`Homebrew 已更新为 ${cask.version}，与本次 ${update.latestVersion} 不一致。请重新检查并下载最新更新。`);
  }
  if (cask.url !== artifact.downloadUrl || cask.sha256 !== artifact.sha256) throw new Error(`Homebrew ${cask.version} 的下载地址或 SHA-256 与发布清单不一致，已停止安装。请稍后重试或查看发布页。`);
}
export async function inspectHomebrewApp(path: string, versions: string[]) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Homebrew 登记的 AstraGit.app 不是普通应用目录。');
  const values = await Promise.all(['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key => (await execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(path, 'Contents/Info.plist')], { timeout: 10_000 })).stdout.trim()));
  if (values[0] !== 'com.astragit.desktop' || values[1] !== values[2] || !versions.includes(values[1]!)) throw new Error('Homebrew 应用身份或实际版本不匹配。');
  return { appPath: path, version: values[1]! };
}
export interface HomebrewUpdateDependencies {
  binary?: () => Promise<string | null>;
  run?: (file: string, args: string[], options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;
  inspectApp?: typeof inspectHomebrewApp;
  fetchArtifact?: typeof fetchHomebrewArtifact;
  platform?: NodeJS.Platform;
}
export function createHomebrewUpdateService(options: { appPath: string; version: string }, dependencies: HomebrewUpdateDependencies = {}) {
  const appPath = resolve(options.appPath);
  const environment = (autoUpdate = false): NodeJS.ProcessEnv => ({ ...process.env, HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_AUTO_UPDATE: autoUpdate ? undefined : '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_UPGRADE_QUIT_CASKS: '1', NONINTERACTIVE: '1' });
  const run = async (brew: string, args: string[], timeout = 60_000, autoUpdate = false) => {
    try { return await (dependencies.run ?? execFile)(brew, args, { timeout, maxBuffer: 8 * 1024 ** 2, env: environment(autoUpdate) }); }
    catch (error) {
      const failure = error as Error & { stderr?: string; stdout?: string };
      throw new Error(`Homebrew ${args[0]} 失败：${redactUserFacingErrorDetails((failure.stderr || failure.stdout || failure.message).trim().slice(-2_000))}`);
    }
  };
  async function binary() {
    if (dependencies.binary) return dependencies.binary();
    const candidates = process.arch === 'x64' ? ['/usr/local/bin/brew', '/opt/homebrew/bin/brew'] : ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
    for (const path of candidates) { try { await access(path, constants.X_OK); return path; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    return null;
  }
  async function inspect(brew: string) { return parseHomebrewCask(JSON.parse((await run(brew, ['info', '--cask', '--json=v2', homebrewCask])).stdout)); }
  async function managed(cask: HomebrewCaskInfo) {
    if (!cask.installedVersion) throw new Error('Homebrew 未登记已安装的 AstraGit，不能接管当前应用。');
    if (cask.appTarget !== appPath || await realpath(cask.appTarget) !== await realpath(appPath)) throw new Error('Homebrew 管理的是另一个 AstraGit 安装位置，请从该位置启动。');
    await (dependencies.inspectApp ?? inspectHomebrewApp)(appPath, [options.version, cask.installedVersion]);
  }
  return {
    async isManaged() {
      if ((dependencies.platform ?? process.platform) !== 'darwin') return false;
      const brew = await binary(); if (!brew) return false;
      const output = (await run(brew, ['list', '--cask', '--versions'])).stdout;
      if (!output.split(/\r?\n/u).some(line => ['astragit', homebrewCask].includes(line.trim().split(/\s/u)[0]!))) return false;
      await managed(await inspect(brew)); return true;
    },
    async prepare(update: ReleaseUpdateStatus, progress: (value: ReleaseUpdateProgress) => void): Promise<HomebrewPreparedUpdate> {
      if (!update.artifact || update.currentVersion !== options.version || update.artifact.arch !== process.arch) throw new Error('Homebrew 更新与当前应用版本或架构不一致。');
      const brewPath = await binary(); if (!brewPath) throw new Error('未找到 Homebrew。');
      let cask = await retryHomebrew(() => inspect(brewPath)); await managed(cask);
      if (cask.version !== update.latestVersion || cask.sha256 !== update.artifact?.sha256 || cask.url !== update.artifact.downloadUrl) {
        progress({ phase: 'updating', receivedBytes: 0, totalBytes: update.artifact?.sizeBytes ?? 0 });
        // Let Homebrew refresh its own metadata, matching Zeus's update flow.
        await retryHomebrew(() => run(brewPath, ['update'], 5 * 60_000, true));
        cask = await retryHomebrew(() => inspect(brewPath)); await managed(cask);
      }
      assertHomebrewRelease(cask, update);
      const [cache, root] = await Promise.all([retryHomebrew(() => run(brewPath, ['--cache', '--cask', homebrewCask])), run(brewPath, ['--cache'])]);
      const cachePath = cache.stdout.trim(); const cacheRoot = root.stdout.trim();
      const inside = relative(resolve(cacheRoot), resolve(cachePath));
      if (!isAbsolute(cachePath) || !isAbsolute(cacheRoot) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Homebrew 缓存位置无效。');
      await mkdir(dirname(cachePath), { recursive: true });
      progress({ phase: 'verifying', receivedBytes: 0, totalBytes: update.artifact.sizeBytes });
      if (!(await verifyDownloadedArtifact(cachePath, update.artifact).then(() => true, () => false))) {
        await (dependencies.fetchArtifact ?? fetchHomebrewArtifact)({ brewPath, cask: homebrewCask, cachePath, artifact: update.artifact, environment: environment(), progress });
        progress({ phase: 'verifying', receivedBytes: update.artifact.sizeBytes, totalBytes: update.artifact.sizeBytes });
      }
      await verifyDownloadedArtifact(cachePath, update.artifact);
      progress({ phase: 'ready', receivedBytes: update.artifact.sizeBytes, totalBytes: update.artifact.sizeBytes });
      return { update, brewPath, cachePath };
    },
    async validatePrepared(prepared: HomebrewPreparedUpdate) {
      if (await binary() !== prepared.brewPath) throw new Error('Homebrew 工具位置已变化。');
      const cask = await inspect(prepared.brewPath); await managed(cask); assertHomebrewRelease(cask, prepared.update);
      await verifyDownloadedArtifact(prepared.cachePath, prepared.update.artifact!);
    },
    async install(prepared: HomebrewPreparedUpdate, progress: (value: ReleaseUpdateProgress) => void) {
      if (await binary() !== prepared.brewPath) throw new Error('Homebrew 工具位置已变化。');
      const cask = await inspect(prepared.brewPath); await managed(cask); assertHomebrewRelease(cask, prepared.update);
      await verifyDownloadedArtifact(prepared.cachePath, prepared.update.artifact!);
      progress({ phase: 'installing', receivedBytes: prepared.update.artifact!.sizeBytes, totalBytes: prepared.update.artifact!.sizeBytes });
      if (cask.installedVersion !== prepared.update.latestVersion) await run(prepared.brewPath, ['upgrade', '--cask', '--no-quit', '--yes', '--require-sha', `--appdir=${dirname(appPath)}`, homebrewCask], 15 * 60_000);
      const after = await inspect(prepared.brewPath); await managed(after); assertHomebrewRelease(after, prepared.update);
      if (after.installedVersion !== prepared.update.latestVersion) throw new Error('Homebrew 升级后的安装收据版本不匹配。');
      return (dependencies.inspectApp ?? inspectHomebrewApp)(appPath, [prepared.update.latestVersion]);
    },
  };
}

async function retryHomebrew<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, attempt === 0 ? 400 : 1_200));
    }
  }
}
