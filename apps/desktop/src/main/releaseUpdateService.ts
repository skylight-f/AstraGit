import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareReleaseVersions, parseReleaseManifest, releasePageUrl, type ReleaseUpdateProgress, type ReleaseUpdateStatus } from '@astragit/shared';
import { execFile, readSigningTeam, verifyReleaseApp } from './releaseVerification.js';
import { downloadVerifiedArtifact, verifyDownloadedArtifact } from './releaseArtifact.js';
import type { HomebrewUpdateProgress } from './homebrewUpdateService.js';

export interface ReleaseUpdateOptions {
  appPath: string; executablePath: string; dataDirectory: string; version: string; packaged: boolean;
  fetch?: typeof globalThis.fetch;
  onProgress: (progress: ReleaseUpdateProgress) => void;
  confirmRestart: () => Promise<boolean>; quit: () => void;
  openDownloadedArtifact?: (path: string) => Promise<void>;
}
export interface ReleaseUpdateDependencies {
  systemVersion?: () => Promise<string>;
}
/** 原生更新控制器使用的直接下载通道；Homebrew 由 Astra 同源服务负责。 */
export interface DirectReleaseUpdateService {
  manualInstallReason(update: ReleaseUpdateStatus): Promise<string | null>;
  download(onProgress: (progress: HomebrewUpdateProgress) => void): Promise<{ accepted: true; update: ReleaseUpdateStatus } | { accepted: false; reason: string }>;
  openDownloaded(): Promise<{ accepted: boolean }>;
  install(): Promise<{ accepted: boolean; restartAccepted?: boolean }>;
}
export function createReleaseUpdateService(options: ReleaseUpdateOptions, dependencies: ReleaseUpdateDependencies = {}) {
  let checked: ReleaseUpdateStatus | null = null;
  let pending: Promise<ReleaseUpdateStatus> | null = null;
  let download: Promise<ReleaseUpdateStatus> | null = null;
  let prepared: { status: ReleaseUpdateStatus; path: string } | null = null;
  let installing = false;
  const fetchRelease = options.fetch ?? globalThis.fetch;
  const systemVersion = dependencies.systemVersion ?? (async () => (await execFile('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim());
  const current: ReleaseUpdateStatus = { status: 'unavailable', currentVersion: options.version, latestVersion: '', releasePageUrl, artifact: null, automaticInstallEnabled: false, reason: '', installMethod: 'direct' };
  async function check(): Promise<ReleaseUpdateStatus> {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchRelease(`${releasePageUrl}/latest/download/astragit-release-manifest.json`, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': `AstraGit/${options.version}`, 'cache-control': 'no-cache' } });
        if (!response.ok) throw new Error(response.status === 404 ? '尚无公开发布的更新清单。' : `检查更新失败：HTTP ${response.status}`);
        const raw = await response.text(); if (raw.length > 128_000) throw new Error('更新清单过大。');
        const manifest = parseReleaseManifest(JSON.parse(raw));
        const artifact = manifest.artifacts.find(artifact => artifact.arch === process.arch) ?? null;
        const newer = compareReleaseVersions(manifest.version, options.version) > 0;
        const system = (await systemVersion()).split('.').map(Number);
        const required = manifest.minimumSystemVersion.split('.').map(Number);
        const systemSupported = system[0]! > required[0]! || (system[0] === required[0] && (system[1] ?? 0) >= (required[1] ?? 0));
        let installReason = '当前应用未使用 Developer ID 签名，需先手动安装签名版本。';
        let installable = false;
        if (options.packaged && process.platform === 'darwin' && basename(options.appPath) === 'AstraGit.app' && !options.appPath.startsWith('/Volumes/') && !options.appPath.includes('/AppTranslocation/')) {
          const appStat = await lstat(options.appPath);
          if (appStat.isDirectory() && !appStat.isSymbolicLink() && await readSigningTeam(options.appPath)) {
            try { await access(dirname(options.appPath), constants.W_OK); installable = manifest.signed && manifest.notarized; installReason = installable ? '' : '本次发布未同时通过 Developer ID 签名与公证，请手动安装。'; }
            catch { installReason = '应用所在目录不可写，请手动安装。'; }
          }
        }
        checked = { ...current, status: newer ? artifact && systemSupported ? 'available' : 'unavailable' : 'up_to_date', latestVersion: manifest.version, artifact, checkedAt: new Date().toISOString(), releasePageUrl: `${releasePageUrl}/tag/v${manifest.version}`, automaticInstallEnabled: installable && newer && systemSupported && Boolean(artifact), reason: !newer ? '已是最新版本。' : !systemSupported ? `新版要求 macOS ${manifest.minimumSystemVersion} 或更高版本。` : !artifact ? '本次发布没有匹配当前架构的安装包。' : installReason };
      } catch (reason) { checked = { ...current, reason: `无法完成更新检查：${reason instanceof Error ? reason.message : String(reason)}。请稍后重试或查看发布页。` }; }
      return checked;
    })().finally(() => { pending = null; });
    return pending;
  }
  async function prepare(onProgress = options.onProgress): Promise<ReleaseUpdateStatus> {
    if (download) return download;
    download = (async () => {
      const update = await check();
      if (!options.packaged || update.status !== 'available' || !update.artifact) throw new Error('当前没有可下载的匹配更新。');
      const directory = join(options.dataDirectory, 'updates/downloads', update.latestVersion);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, update.artifact.fileName);
      await downloadVerifiedArtifact(update.artifact, path, onProgress, fetchRelease);
      prepared = { status: update, path }; return update;
    })().finally(() => { download = null; });
    return download;
  }
  async function verifiedPrepared() {
    const update = await check();
    if (update.status === 'unavailable') throw new Error(update.reason || '暂时无法核对更新，请稍后重试。已下载的安装包会保留。');
    if (!prepared || update.status !== 'available' || prepared.status.installMethod !== update.installMethod || prepared.status.latestVersion !== update.latestVersion || prepared.status.artifact?.sha256 !== update.artifact?.sha256) throw new Error('当前更新与已下载的安装包不一致，请重新下载。');
    await verifyDownloadedArtifact(prepared.path, update.artifact!); return { ...prepared, status: update };
  }
  async function install() {
    if (installing) throw new Error('更新安装已在进行。');
    installing = true; let staged: string | null = null; let handedOff = false;
    try {
      const item = await verifiedPrepared();
      if (!item.status.automaticInstallEnabled) throw new Error(item.status.reason || '当前环境不支持自动安装。');
      const team = await readSigningTeam(options.appPath); if (!team) throw new Error('当前应用没有可信签发团队。');
      const transaction = randomUUID();
      const job = join(options.dataDirectory, 'updates', transaction); await mkdir(job, { recursive: true, mode: 0o700 });
      const mount = join(job, 'mount'); await mkdir(mount);
      staged = join(dirname(options.appPath), `.AstraGit.update-${transaction}.app`);
      await execFile('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, item.path], { timeout: 60_000 });
      try {
        const source = join(mount, 'AstraGit.app'); const sourceStat = await lstat(source);
        if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('安装包缺少有效 AstraGit.app。');
        await verifyReleaseApp(source, item.status.latestVersion, team);
        await execFile('/usr/bin/ditto', [source, staged], { timeout: 120_000 });
        await verifyReleaseApp(staged, item.status.latestVersion, team);
      } finally { await execFile('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 }); }
      if (!(await options.confirmRestart())) return { accepted: false };
      const bootstrapPath = join(job, 'installer.json');
      await writeFile(bootstrapPath, JSON.stringify({ transaction, mainPid: process.pid, target: resolve(options.appPath), staged, backup: join(dirname(options.appPath), `.AstraGit.backup-${transaction}.app`), executable: options.executablePath.slice(options.appPath.length + 1), dataDirectory: options.dataDirectory, oldVersion: options.version, version: item.status.latestVersion, team }), { mode: 0o600, flag: 'wx' });
      const child = spawn(options.executablePath, [fileURLToPath(new URL('./releaseInstaller.js', import.meta.url)), bootstrapPath], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      await new Promise<void>((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); }); child.unref();
      const readyPath = join(job, 'ready'); const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await stat(readyPath).catch(() => null)) { handedOff = true; options.quit(); return { accepted: true, restartAccepted: true }; }
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
      }
      if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch { /* 安装器可能已退出。 */ } }
      throw new Error('安装辅助进程未就绪，应用保持运行。');
    } finally { if (staged && !handedOff) await rm(staged, { recursive: true, force: true }); installing = false; }
  }
  return {
    check, prepare, install, status: () => checked, downloaded: async () => (await verifiedPrepared()).path,
    manualInstallReason: async (update: ReleaseUpdateStatus) => update.automaticInstallEnabled ? null : update.reason,
    download: async (onProgress: (progress: HomebrewUpdateProgress) => void) => ({ accepted: true as const, update: await prepare(progress => {
      if (progress.phase === 'ready') return;
      onProgress({ phase: progress.phase, downloadedBytes: progress.receivedBytes, totalBytes: progress.totalBytes });
    }) }),
    openDownloaded: async () => {
      if (!options.openDownloadedArtifact) throw new Error('安装包打开入口尚未就绪。');
      await options.openDownloadedArtifact((await verifiedPrepared()).path);
      return { accepted: true };
    },
  };
}

export { verifyDownloadedArtifact, downloadVerifiedArtifact } from './releaseArtifact.js';
