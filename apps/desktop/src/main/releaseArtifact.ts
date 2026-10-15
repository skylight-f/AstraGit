import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, lstat } from 'node:fs/promises';
import { releasePageUrl, type ReleaseArtifact, type ReleaseUpdateProgress } from '@astragit/shared';

export async function verifyDownloadedArtifact(path: string, artifact: ReleaseArtifact) {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.sizeBytes) throw new Error('更新安装包大小不符。');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== artifact.sha256) throw new Error('更新安装包 SHA-256 校验失败。');
}
export async function downloadVerifiedArtifact(artifact: ReleaseArtifact, path: string, progress: (value: ReleaseUpdateProgress) => void, fetchRelease: typeof globalThis.fetch = globalThis.fetch) {
  progress({ phase: 'verifying', receivedBytes: 0, totalBytes: artifact.sizeBytes });
  if (await verifyDownloadedArtifact(path, artifact).then(() => true, () => false)) { progress({ phase: 'ready', receivedBytes: artifact.sizeBytes, totalBytes: artifact.sizeBytes }); return; }
  const temporary = `${path}.${randomUUID()}.partial`; const output = await open(temporary, 'wx', 0o600);
  let received = 0; let notifiedAt = 0; const hash = createHash('sha256');
  try {
    const source = new URL(artifact.downloadUrl);
    if (source.protocol !== 'https:' || !artifact.downloadUrl.startsWith(`${releasePageUrl}/download/`)) throw new Error('更新安装包来源无效。');
    const response = await fetchRelease(artifact.downloadUrl, { signal: AbortSignal.timeout(10 * 60_000) });
    // Electron net.fetch 的标准 Response 可以缺少 url；来源仍绑定固定发布仓库，最终字节必须匹配摘要。
    const destination = response.url ? new URL(response.url) : source;
    if (destination.protocol !== 'https:' || !(destination.hostname === 'github.com' || destination.hostname.endsWith('.githubusercontent.com')) || !response.ok || !response.body) throw new Error(`更新下载失败：HTTP ${response.status}`);
    for await (const chunk of response.body) {
      received += chunk.byteLength; if (received > artifact.sizeBytes) throw new Error('下载内容超过更新清单大小。');
      hash.update(chunk); await output.writeFile(chunk);
      if (Date.now() - notifiedAt > 150) { notifiedAt = Date.now(); progress({ phase: 'downloading', receivedBytes: received, totalBytes: artifact.sizeBytes }); }
    }
    progress({ phase: 'verifying', receivedBytes: received, totalBytes: artifact.sizeBytes });
    if (received !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256) throw new Error('更新安装包不完整或 SHA-256 不匹配。');
    await output.sync(); await output.close(); await rename(temporary, path);
    progress({ phase: 'ready', receivedBytes: received, totalBytes: artifact.sizeBytes });
  } finally { await output.close().catch(() => undefined); await rm(temporary, { force: true }); }
}
