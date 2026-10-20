import { distributionAppName, astragitDistribution, astragitHomebrewCask } from './desktopDistribution.js';
import { execFile as execFileCallback } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { compareReleaseVersions, type ReleaseUpdateStatus as DesktopReleaseUpdateStatus } from '@astragit/shared';

const execFile = promisify(execFileCallback);
const caskToken = astragitHomebrewCask;
const commandOutputLimit = 8 * 1024 * 1024;

export interface HomebrewUpdateProgress {
  phase: 'updating' | 'downloading' | 'reconnecting' | 'verifying' | 'installing';
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  reconnectCount?: number;
}
export interface HomebrewInstalledUpdate { appPath: string; bundleId: string; version: string }
export interface HomebrewPreparedUpdate {
  update: DesktopReleaseUpdateStatus;
  brewPath: string;
  installed: HomebrewInstalledUpdate;
}
export interface HomebrewUpdateService {
  isManaged(): Promise<boolean>;
  /** Homebrew 完整负责更新、下载、校验和安装；成功后只等待用户重启。 */
  prepare(update: DesktopReleaseUpdateStatus, onProgress: (progress: HomebrewUpdateProgress) => void): Promise<HomebrewPreparedUpdate>;
  /** 重启前复验真实安装，不再执行第二次 upgrade。 */
  install(prepared: HomebrewPreparedUpdate, onProgress: (progress: HomebrewUpdateProgress) => void): Promise<HomebrewInstalledUpdate>;
  reconnectDownload(): boolean;
}
export class HomebrewUpdateError extends Error {
  constructor(message: string, readonly kind: 'transient_download' | 'structural') {
    super(message); this.name = 'HomebrewUpdateError';
    if (kind === 'transient_download') this.cause = { code: 'ASTRAGIT_UPDATE_DOWNLOAD_INTERRUPTED', message };
  }
}
export function isTransientHomebrewDownloadError(error: unknown): boolean {
  return error instanceof HomebrewUpdateError && error.kind === 'transient_download';
}
interface CreateHomebrewUpdateServiceOptions { currentAppPath: string; currentAppVersion: string; bundleId: string; testMode: boolean }
interface HomebrewCaskInfo { installedVersion: string | null; tap: string; appTarget: string | null }

export function createHomebrewUpdateService(options: CreateHomebrewUpdateServiceOptions): HomebrewUpdateService {
  let preparing: Promise<HomebrewPreparedUpdate> | null = null;
  async function prepare(update: DesktopReleaseUpdateStatus, onProgress: (progress: HomebrewUpdateProgress) => void): Promise<HomebrewPreparedUpdate> {
    if (process.platform !== 'darwin') throw new Error('Homebrew Cask 升级只支持 macOS。');
    if (update.currentVersion !== options.currentAppVersion) throw new Error('更新状态与当前 AstraGit App 版本不一致。');
    const brewPath = await resolveHomebrewBinary(options.testMode);
    if (!brewPath) throw new Error('未找到 Homebrew。请先安装 Homebrew，再重试 AstraGit 更新。');
    const current = await validateManagedCask(await inspectCask(brewPath), options);
    if (compareReleaseVersions(current.version, options.currentAppVersion) > 0) return { update, brewPath, installed: current };
    onProgress({ phase: 'installing' });
    // 与终端手动升级使用相同参数，交由 Homebrew 自行刷新元数据和处理安装包。
    await runBrew(brewPath, ['upgrade', '--cask', caskToken], true, 30 * 60_000);
    onProgress({ phase: 'verifying' });
    const installed = await validateManagedCask(await inspectCask(brewPath), options);
    if (compareReleaseVersions(installed.version, options.currentAppVersion) <= 0) {
      throw new Error(`Homebrew 已执行升级，但当前没有比运行版本 ${options.currentAppVersion} 更新的可安装版本（当前安装 ${installed.version}）。请稍后重新检查。`, {
        cause: { code: 'ASTRAGIT_UPDATE_HOMEBREW_NO_UPGRADE', message: 'Homebrew did not install a newer version' },
      });
    }
    return { update, brewPath, installed };
  }
  return {
    async isManaged() {
      if (!astragitDistribution.homebrewEnabled) return false;
      const brewPath = await resolveHomebrewBinary(options.testMode);
      if (!brewPath) return false;
      const { stdout } = await runBrew(brewPath, ['list', '--cask', '--versions']);
      if (!stdout.split(/\r?\n/u).some(line => [astragitDistribution.cask, caskToken].includes(line.trim().split(/\s/u)[0]))) return false;
      await validateManagedCask(await inspectCask(brewPath), options);
      return true;
    },
    prepare(update, onProgress) {
      if (preparing) return preparing;
      const pending = prepare(update, onProgress).finally(() => { if (preparing === pending) preparing = null; });
      preparing = pending;
      return pending;
    },
    async install(prepared, onProgress) {
      onProgress({ phase: 'verifying' });
      const installed = await validateManagedCask(await inspectCask(prepared.brewPath), options);
      if (compareReleaseVersions(installed.version, prepared.installed.version) < 0 || compareReleaseVersions(installed.version, options.currentAppVersion) <= 0) {
        throw new Error('Homebrew 安装后的 AstraGit App 版本已变化，已停止重启，请重新检查更新。', {
          cause: { code: 'ASTRAGIT_UPDATE_INSTALLED_IDENTITY_MISMATCH', message: 'Installed app changed before relaunch' },
        });
      }
      return installed;
    },
    // 升级是一个 Homebrew 命令，不再由应用终止或重连其下载子进程。
    reconnectDownload: () => false,
  };
}

async function validateManagedCask(cask: HomebrewCaskInfo, options: CreateHomebrewUpdateServiceOptions): Promise<HomebrewInstalledUpdate> {
  if (cask.tap !== astragitDistribution.homebrewTap) throw new Error('AstraGit 只允许使用本发行版配置的 Homebrew Tap 升级。');
  if (!cask.installedVersion) throw new Error('当前 AstraGit 没有目标 Homebrew Cask 管理收据，不能自动接管安装。');
  if (cask.appTarget !== resolve(options.currentAppPath)) throw new Error('Homebrew Cask 管理的 AstraGit App 不是当前正在使用的日常正式应用。');
  return inspectInstalledApp(cask.appTarget, options.bundleId, cask.installedVersion);
}
async function inspectInstalledApp(appPath: string, expectedBundleId: string, receiptVersion: string): Promise<HomebrewInstalledUpdate> {
  const appStat = await stat(appPath).catch(() => null);
  if (!appStat?.isDirectory()) throw new Error('Homebrew 安装后的 AstraGit App 不存在。');
  const plist = join(appPath, 'Contents', 'Info.plist');
  const [bundleId, shortVersion, bundleVersion] = await Promise.all(['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(key => readPlistString(plist, key)));
  if (bundleId !== expectedBundleId || shortVersion !== bundleVersion || shortVersion !== receiptVersion) {
    throw new Error(`Homebrew 安装收据与真实 AstraGit App 身份或版本不一致：receipt=${receiptVersion} app=${shortVersion} (${bundleVersion})`, {
      cause: { code: 'ASTRAGIT_UPDATE_INSTALLED_IDENTITY_MISMATCH', message: 'Installed app does not match its Homebrew receipt' },
    });
  }
  return { appPath: resolve(appPath), bundleId, version: shortVersion! };
}
async function readPlistString(path: string, key: string): Promise<string> {
  const { stdout } = await execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  if (!stdout.trim()) throw new Error(`无法读取 Homebrew 安装后的 AstraGit App 身份字段 ${key}。`);
  return stdout.trim();
}
async function inspectCask(brewPath: string): Promise<HomebrewCaskInfo> {
  const { stdout } = await runBrew(brewPath, ['info', '--cask', '--json=v2', caskToken]);
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { throw new Error('Homebrew 返回的 AstraGit Cask 信息不是有效 JSON。'); }
  if (!isRecord(value) || !Array.isArray(value.casks) || value.casks.length !== 1 || !isRecord(value.casks[0])) throw new Error('Homebrew 没有返回唯一的 AstraGit Cask。');
  const cask = value.casks[0];
  let appTarget: string | null = null;
  for (const artifact of Array.isArray(cask.artifacts) ? cask.artifacts : []) {
    if (isRecord(artifact) && Array.isArray(artifact.app) && artifact.app.includes(`${distributionAppName}.app`) && typeof artifact.target === 'string') appTarget = resolve(artifact.target);
  }
  if (typeof cask.tap !== 'string') throw new Error('Homebrew AstraGit Cask 缺少必要版本或产物信息。');
  return { tap: cask.tap, installedVersion: typeof cask.installed === 'string' && cask.installed.trim() ? cask.installed.trim() : null, appTarget };
}
async function resolveHomebrewBinary(testMode: boolean): Promise<string | null> {
  const override = process.env.ASTRAGIT_HOMEBREW_BIN?.trim();
  if (override) {
    if (!testMode) throw new Error('ASTRAGIT_HOMEBREW_BIN 只允许隔离测试包使用。');
    const candidate = resolve(override);
    if (!isAbsolute(override) || !isUnderTemporaryDirectory(candidate)) throw new Error('隔离 Homebrew 替身必须位于系统临时目录。');
    await access(candidate, fsConstants.X_OK); return candidate;
  }
  for (const candidate of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    try { await access(candidate, fsConstants.X_OK); return candidate; }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
  }
  return null;
}
async function runBrew(brewPath: string, args: string[], upgrading = false, timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1', NONINTERACTIVE: '1' };
  if (upgrading) {
    // Cask 的 uninstall quit stanza 会退出当前 Main；由用户点击重启后统一交接。
    env.HOMEBREW_NO_UPGRADE_QUIT_CASKS = '1';
  } else env.HOMEBREW_NO_AUTO_UPDATE = '1';
  try { return await execFile(brewPath, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: commandOutputLimit, env }); }
  catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number; signal?: string };
    const output = (failure.stderr || failure.stdout || failure.message).trim();
    throw new HomebrewUpdateError(`Homebrew ${args[0] ?? '命令'} 失败${failure.code === undefined ? '' : ` (code ${failure.code})`}：${output}`, 'structural');
  }
}
function isUnderTemporaryDirectory(path: string): boolean {
  return [resolve(tmpdir()), resolve('/tmp')].some(root => { const part = relative(root, resolve(path)); return Boolean(part) && part !== '..' && !part.startsWith('../') && !isAbsolute(part); });
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
