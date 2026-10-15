import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { redactUserFacingErrorDetails, type ReleaseArtifact, type ReleaseUpdateProgress } from '@astragit/shared';

export class HomebrewDownloadError extends Error {
  constructor(message: string, readonly transient: boolean) { super(message); this.name = 'HomebrewDownloadError'; }
}

function transientFailure(detail: string, code?: string): boolean {
  return ['EAI_AGAIN', 'ECONNABORTED', 'ECONNRESET', 'ENETDOWN', 'ENETUNREACH', 'ETIMEDOUT'].includes(code ?? '') || /curl:\s*\((?:5|6|7|18|28|35|47|52|55|56|92)\)|http[^\n]*(?:408|425|429|5\d\d)|could not resolve|connection (?:reset|refused|timed out)|network is unreachable|operation timed out|temporary failure/iu.test(detail);
}

/** Brew owns resumable downloads and cache; only transient network failures retry. */
export async function fetchHomebrewArtifact(options: {
  brewPath: string; cask: string; cachePath: string; artifact: ReleaseArtifact;
  environment: NodeJS.ProcessEnv; progress: (value: ReleaseUpdateProgress) => void;
}) {
  for (let attempt = 0; ; attempt++) {
    try { await fetchOnce(options); return; }
    catch (error) {
      if (!(error instanceof HomebrewDownloadError) || !error.transient || attempt >= 2) throw error;
      options.progress({ phase: 'reconnecting', receivedBytes: 0, totalBytes: options.artifact.sizeBytes });
      await new Promise(resolveWait => setTimeout(resolveWait, attempt === 0 ? 400 : 1_200));
    }
  }
}

async function fetchOnce(options: Parameters<typeof fetchHomebrewArtifact>[0]): Promise<void> {
  options.progress({ phase: 'downloading', receivedBytes: 0, totalBytes: options.artifact.sizeBytes });
  await new Promise<void>((resolveFetch, rejectFetch) => {
    const child = spawn(options.brewPath, ['fetch', '--cask', '--retry', options.cask], {
      env: options.environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; let finished = false; let timedOut = false; let lastBytes = -1;
    let forceTermination: ReturnType<typeof setTimeout> | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid || finished) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    const timeout = setTimeout(() => {
      timedOut = true; terminate('SIGTERM');
      forceTermination = setTimeout(() => terminate('SIGKILL'), 3_000);
      forceTermination.unref();
    }, 15 * 60_000);
    // Brew writes .incomplete before publishing its cache. File size reports
    // real progress even when a GUI-launched brew has no terminal progress bar.
    const timer = setInterval(() => {
      void stat(`${options.cachePath}.incomplete`).then(info => {
        if (finished || !info.isFile()) return;
        const receivedBytes = Math.min(info.size, options.artifact.sizeBytes);
        if (receivedBytes !== lastBytes) {
          lastBytes = receivedBytes;
          options.progress({ phase: 'downloading', receivedBytes, totalBytes: options.artifact.sizeBytes });
        }
      }).catch(() => undefined);
    }, 500);
    const cleanup = () => { finished = true; clearTimeout(timeout); clearInterval(timer); clearTimeout(forceTermination); };
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-8_192); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { cleanup(); rejectFetch(new HomebrewDownloadError(`Homebrew 下载无法启动：${error.message}`, transientFailure(error.message, (error as NodeJS.ErrnoException).code))); });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0 && !timedOut) { resolveFetch(); return; }
      const detail = redactUserFacingErrorDetails(output.trim().slice(-2_000)) || `退出状态 ${signal ?? code ?? 'unknown'}`;
      rejectFetch(new HomebrewDownloadError(timedOut ? 'Homebrew 下载超时，已保留缓存，可重试。' : `Homebrew 下载失败：${detail}`, timedOut || transientFailure(detail, signal ?? undefined)));
    });
  });
}
