export const releaseRepository = 'skylight-f/AstraGit';
export const releasePageUrl = `https://github.com/${releaseRepository}/releases`;
export interface ReleaseArtifact { arch: 'arm64' | 'x64'; kind: 'dmg'; fileName: string; sha256: string; sizeBytes: number; downloadUrl: string }
export interface ReleaseManifest {
  schemaVersion: 1; appId: 'com.astragit.desktop'; repository: typeof releaseRepository;
  version: string; sourceCommit: string; signed: boolean; notarized: boolean; minimumSystemVersion: string;
  artifacts: ReleaseArtifact[];
}
export interface ReleaseUpdateStatus {
  status: 'up_to_date' | 'available' | 'unavailable'; currentVersion: string; latestVersion: string;
  releasePageUrl: string; artifact: ReleaseArtifact | null; automaticInstallEnabled: boolean; reason: string;
}
export interface ReleaseUpdateProgress { phase: 'downloading' | 'verifying' | 'ready'; receivedBytes: number; totalBytes: number }
export function compareReleaseVersions(left: string, right: string): number {
  if (![left, right].every(value => /^\d+\.\d+\.\d+$/u.test(value))) throw new Error('发行版本号无效。');
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  return 0;
}
export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== 'object') throw new Error('更新清单无效。');
  const manifest = value as ReleaseManifest;
  if (manifest.schemaVersion !== 1 || manifest.appId !== 'com.astragit.desktop' || manifest.repository !== releaseRepository || !/^\d+\.\d+\.\d+$/u.test(manifest.version) || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit) || typeof manifest.signed !== 'boolean' || typeof manifest.notarized !== 'boolean' || !/^\d+\.\d+(?:\.\d+)?$/u.test(manifest.minimumSystemVersion) || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length || manifest.artifacts.length > 2) throw new Error('更新清单的应用身份或版本无效。');
  for (const artifact of manifest.artifacts) {
    if (!artifact || !['arm64', 'x64'].includes(artifact.arch) || artifact.kind !== 'dmg' || artifact.fileName !== `AstraGit-${manifest.version}-${artifact.arch}.dmg` || !/^[a-f0-9]{64}$/u.test(artifact.sha256) || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 100_000 || artifact.sizeBytes > 2 * 1024 ** 3 || artifact.downloadUrl !== `${releasePageUrl}/download/v${manifest.version}/${artifact.fileName}`) throw new Error('更新安装包的来源、大小或摘要无效。');
  }
  if (new Set(manifest.artifacts.map(artifact => artifact.arch)).size !== manifest.artifacts.length) throw new Error('更新清单包含重复架构。');
  return manifest;
}
