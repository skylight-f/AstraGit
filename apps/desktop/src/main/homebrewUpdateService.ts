import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homebrewCask, homebrewRepository, homebrewTap, releasePageUrl, type ReleaseUpdateProgress, type ReleaseUpdateStatus } from '@astragit/shared';
import { execFile } from './releaseVerification.js';
import { downloadVerifiedArtifact, verifyDownloadedArtifact } from './releaseArtifact.js';

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
  if (!artifact || update.status !== 'available' || update.installMethod !== 'homebrew' || cask.version !== update.latestVersion || cask.url !== artifact.downloadUrl || cask.sha256 !== artifact.sha256 || artifact.fileName !== `AstraGit-${update.latestVersion}-${artifact.arch}.dmg` || artifact.downloadUrl !== `${releasePageUrl}/download/v${update.latestVersion}/${artifact.fileName}`) throw new Error('Homebrew Cask 尚未同步或与发布清单不一致，请稍后重试。');
}
export async function inspectHomebrewApp(path: string, versions: string[]) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Homebrew 登记的 AstraGit.app 不是普通应用目录。');
  const values = await Promise.all(['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key => (await execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(path, 'Contents/Info.plist')], { timeout: 10_000 })).stdout.trim()));
  if (values[0] !== 'com.astragit.desktop' || values[1] !== values[2] || !versions.includes(values[1]!)) throw new Error('Homebrew 应用身份或实际版本不匹配。');
  return { appPath: path, version: values[1]! };
}
export function createHomebrewUpdateService(options: { appPath: string; version: string }) {
  const appPath = resolve(options.appPath);
  const environment = () => ({ ...process.env, HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_UPGRADE_QUIT_CASKS: '1', NONINTERACTIVE: '1' });
  const run = (brew: string, args: string[], timeout = 60_000) => execFile(brew, args, { timeout, maxBuffer: 8 * 1024 ** 2, env: environment() });
  async function binary() {
    const candidates = process.arch === 'x64' ? ['/usr/local/bin/brew', '/opt/homebrew/bin/brew'] : ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
    for (const path of candidates) { try { await access(path, constants.X_OK); return path; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    return null;
  }
  async function inspect(brew: string) { return parseHomebrewCask(JSON.parse((await run(brew, ['info', '--cask', '--json=v2', homebrewCask])).stdout)); }
  async function refreshTap(brew: string) {
    const directory = (await run(brew, ['--repo', homebrewTap])).stdout.trim();
    if (!isAbsolute(directory)) throw new Error('Homebrew Tap 目录无效。');
    const git = (args: string[], timeout = 20_000) => execFile('git', ['-C', directory, ...args], { timeout, maxBuffer: 1024 ** 2, env: { ...environment(), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' } });
    const [origin, branch, status] = await Promise.all([git(['remote', 'get-url', 'origin']), git(['branch', '--show-current']), git(['status', '--porcelain'])]);
    if (![ `https://github.com/${homebrewRepository}`, `https://github.com/${homebrewRepository}.git`, `git@github.com:${homebrewRepository}.git` ].includes(origin.stdout.trim()) || branch.stdout.trim() !== 'main' || status.stdout.trim()) throw new Error('Homebrew Tap 来源、分支或本地改动不允许自动同步。');
    // 只快进本应用所在的 Tap，不因其他 Tap 的网络故障阻断 AstraGit。
    try { await git(['fetch', 'origin', 'main']); }
    catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
      if (!failure.killed && !/Failed to connect|Could not resolve|Connection (?:reset|timed out)|network is unreachable/iu.test(failure.stderr ?? '')) throw error;
      // 网络不可达时使用已有 SSH 身份；不改写 remote，也不跳过主机或 TLS 校验。
      await git(['fetch', `git@github.com:${homebrewRepository}.git`, 'main']);
    }
    await git(['merge', '--ff-only', 'FETCH_HEAD']);
  }
  async function managed(cask: HomebrewCaskInfo) {
    if (!cask.installedVersion) throw new Error('Homebrew 未登记已安装的 AstraGit，不能接管当前应用。');
    if (cask.appTarget !== appPath || await realpath(cask.appTarget) !== await realpath(appPath)) throw new Error('Homebrew 管理的是另一个 AstraGit 安装位置，请从该位置启动。');
    await inspectHomebrewApp(appPath, [options.version, cask.installedVersion]);
  }
  return {
    async isManaged() {
      if (process.platform !== 'darwin') return false;
      const brew = await binary(); if (!brew) return false;
      const output = (await run(brew, ['list', '--cask', '--versions'])).stdout;
      if (!output.split(/\r?\n/u).some(line => ['astragit', homebrewCask].includes(line.trim().split(/\s/u)[0]!))) return false;
      await managed(await inspect(brew)); return true;
    },
    async prepare(update: ReleaseUpdateStatus, progress: (value: ReleaseUpdateProgress) => void, fetchRelease?: typeof globalThis.fetch): Promise<HomebrewPreparedUpdate> {
      if (!update.artifact || update.currentVersion !== options.version || update.artifact.arch !== process.arch) throw new Error('Homebrew 更新与当前应用版本或架构不一致。');
      const brewPath = await binary(); if (!brewPath) throw new Error('未找到 Homebrew。');
      let cask = await inspect(brewPath); await managed(cask);
      if (cask.version !== update.latestVersion || cask.sha256 !== update.artifact?.sha256 || cask.url !== update.artifact.downloadUrl) {
        progress({ phase: 'updating', receivedBytes: 0, totalBytes: update.artifact?.sizeBytes ?? 0 });
        await refreshTap(brewPath); cask = await inspect(brewPath); await managed(cask);
      }
      assertHomebrewRelease(cask, update);
      const [cache, root] = await Promise.all([run(brewPath, ['--cache', '--cask', homebrewCask]), run(brewPath, ['--cache'])]);
      const cachePath = cache.stdout.trim(); const cacheRoot = root.stdout.trim();
      const inside = relative(resolve(cacheRoot), resolve(cachePath));
      if (!isAbsolute(cachePath) || !isAbsolute(cacheRoot) || !inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Homebrew 缓存位置无效。');
      await mkdir(dirname(cachePath), { recursive: true });
      // 使用桌面系统网络栈预取至 brew 的真实缓存；brew 升级时再次校验并保留安装登记。
      await downloadVerifiedArtifact(update.artifact!, cachePath, progress, fetchRelease);
      return { update, brewPath, cachePath };
    },
    async install(prepared: HomebrewPreparedUpdate, progress: (value: ReleaseUpdateProgress) => void) {
      if (await binary() !== prepared.brewPath) throw new Error('Homebrew 工具位置已变化。');
      const cask = await inspect(prepared.brewPath); await managed(cask); assertHomebrewRelease(cask, prepared.update);
      await verifyDownloadedArtifact(prepared.cachePath, prepared.update.artifact!);
      progress({ phase: 'installing', receivedBytes: prepared.update.artifact!.sizeBytes, totalBytes: prepared.update.artifact!.sizeBytes });
      if (cask.installedVersion !== prepared.update.latestVersion) await run(prepared.brewPath, ['upgrade', '--cask', '--no-quit', '--yes', '--require-sha', `--appdir=${dirname(appPath)}`, homebrewCask], 15 * 60_000);
      const after = await inspect(prepared.brewPath); await managed(after); assertHomebrewRelease(after, prepared.update);
      if (after.installedVersion !== prepared.update.latestVersion) throw new Error('Homebrew 升级后的安装收据版本不匹配。');
      return inspectHomebrewApp(appPath, [prepared.update.latestVersion]);
    },
  };
}
