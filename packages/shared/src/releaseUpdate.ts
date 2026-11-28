export const releaseRepository = 'skylight-f/AstraGit';
export const releasePageUrl = `https://github.com/${releaseRepository}/releases`;
export const homebrewTap = 'skylight-f/tap';
export const homebrewRepository = 'skylight-f/homebrew-tap';
export const homebrewCask = `${homebrewTap}/astragit`;
export interface ReleaseArtifact { arch: 'arm64' | 'x64'; kind: 'dmg'; fileName: string; sha256: string; sizeBytes: number; downloadUrl: string }
export interface WindowsReleaseArtifact extends Omit<ReleaseArtifact, 'arch' | 'kind'> { arch: 'x64'; kind: 'exe' }
export type DesktopReleaseArtifact = ReleaseArtifact | WindowsReleaseArtifact;
export interface ReleaseManifest {
  schemaVersion: 1; appId: 'com.astragit.desktop'; repository: typeof releaseRepository;
  version: string; sourceCommit: string; signed: boolean; notarized: boolean; minimumSystemVersion: string;
  artifacts: ReleaseArtifact[];
  windowsArtifact?: WindowsReleaseArtifact;
  releaseNotes?: string;
}
export interface ReleaseUpdateStatus {
  status: 'up_to_date' | 'available' | 'unavailable'; currentVersion: string; latestVersion: string;
  releasePageUrl: string; artifact: DesktopReleaseArtifact | null; automaticInstallEnabled: boolean; reason: string;
  installMethod: 'homebrew' | 'direct';
  checkedAt?: string;
  releaseNotes?: string;
  error?: unknown;
}
export interface HomebrewUpdateIndicatorState {
  phase: 'idle' | 'available' | 'manual' | 'downloaded' | 'preparing' | 'retrying' | 'ready' | 'failed';
  /** Homebrew ready 已安装到磁盘；direct ready 仍等待重启安装。 */
  method?: 'homebrew' | 'direct';
  currentVersion: string;
  latestVersion: string | null;
  detail: string;
  updatedAt: string;
  progress?: number;
  progressText?: string;
  releaseNotes?: string;
  retryAt?: string;
  failure?: { step: 'check' | 'prepare' | 'download' | 'install'; title: string; technicalDetail?: string; canRetry: boolean };
}
export interface ReleaseUpdateProgress { phase: 'updating' | 'downloading' | 'reconnecting' | 'verifying' | 'installing' | 'ready'; receivedBytes: number; totalBytes: number; bytesPerSecond?: number }
export function compareReleaseVersions(left: string, right: string): number {
  if (![left, right].every(value => /^\d+\.\d+\.\d+$/u.test(value))) throw new Error('发行版本号无效。');
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  return 0;
}
function hasValidArtifactMetadata(artifact: DesktopReleaseArtifact, version: string, fileName: string): boolean {
  return artifact.fileName === fileName && typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(artifact.sha256)
    && Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes >= 100_000 && artifact.sizeBytes <= 2 * 1024 ** 3
    && artifact.downloadUrl === `${releasePageUrl}/download/v${version}/${fileName}`;
}
export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== 'object') throw new Error('更新清单无效。');
  const manifest = value as ReleaseManifest;
  if (manifest.schemaVersion !== 1 || manifest.appId !== 'com.astragit.desktop' || manifest.repository !== releaseRepository || !/^\d+\.\d+\.\d+$/u.test(manifest.version) || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit) || typeof manifest.signed !== 'boolean' || typeof manifest.notarized !== 'boolean' || !/^\d+\.\d+(?:\.\d+)?$/u.test(manifest.minimumSystemVersion) || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 2) throw new Error('更新清单的应用身份或版本无效。');
  for (const artifact of manifest.artifacts) {
    if (!artifact || !['arm64', 'x64'].includes(artifact.arch) || artifact.kind !== 'dmg' || !hasValidArtifactMetadata(artifact, manifest.version, `AstraGit-${manifest.version}-${artifact.arch}.dmg`)) throw new Error('更新安装包的来源、大小或摘要无效。');
  }
  if (new Set(manifest.artifacts.map(artifact => artifact.arch)).size !== manifest.artifacts.length) throw new Error('更新清单包含重复架构。');
  const windows = manifest.windowsArtifact;
  if (windows !== undefined && (!windows || windows.kind !== 'exe' || windows.arch !== 'x64' || !hasValidArtifactMetadata(windows, manifest.version, `AstraGit-${manifest.version}-win-x64-setup.exe`))) {
    throw new Error('Windows 更新安装包的来源、大小或摘要无效。');
  }
  return manifest;
}
