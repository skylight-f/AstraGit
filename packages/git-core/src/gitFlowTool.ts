import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const names = ['git-flow', 'git-flow-init', 'git-flow-feature', 'git-flow-bugfix', 'git-flow-hotfix', 'git-flow-release', 'git-flow-support', 'git-flow-version', 'git-flow-log', 'git-flow-config', 'gitflow-common', 'gitflow-shFlags', 'LICENSE'];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const invalid = (details: string) => Object.assign(new Error('应用内置 Git Flow 资源不完整或校验失败，请修复应用后重试。'), { code: 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID', operationStatus: 'failed_before_write', operationStage: 'preflight', details });
export interface GitFlowTool { source: 'bundled' | 'system'; version: string; directory: string | null; fingerprint: string; arguments: string[] }
export const repositoryGitFlowDirectory = fileURLToPath(new URL('../../../vendor/git-flow-avh/', import.meta.url));
export async function verifyBundledGitFlow(directory: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const root = await lstat(directory); if (!root.isDirectory() || root.isSymbolicLink()) throw invalid('资源目录不是普通目录。');
    const manifestPath = join(directory, 'manifest.json'); const entry = await lstat(manifestPath);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 32_768) throw invalid('资源清单不是有效的普通文件。');
    const bytes = await readFile(manifestPath); const manifest = JSON.parse(bytes.toString('utf8')) as { schemaVersion?: unknown; version?: unknown; source?: unknown; sourceArchiveSha256?: unknown; files?: Record<string, { sha256?: unknown; upstreamSha256?: unknown; executable?: unknown }> };
    if (manifest.schemaVersion !== 1 || manifest.version !== '1.12.3' || manifest.source !== 'https://github.com/petervanderdoes/gitflow-avh/tree/1.12.3' || manifest.sourceArchiveSha256 !== '12fefdfa90c0cef2711af048334bb3f5fd15638803ccaf9e791153ce96439b27' || !manifest.files || Object.keys(manifest.files).length !== names.length || names.some(name => !Object.hasOwn(manifest.files!, name))) throw invalid('资源清单与固定上游版本不匹配。');
    if ((await readdir(directory)).some(name => ![...names, 'manifest.json', 'README.md'].includes(name))) throw invalid('资源目录含有未登记的文件。');
    for (const name of names) {
      signal?.throwIfAborted(); const expected = manifest.files[name]!; const path = join(directory, name); const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || expected.executable !== (name === 'git-flow') || typeof expected.upstreamSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expected.upstreamSha256) || typeof expected.sha256 !== 'string' || hash(await readFile(path)) !== expected.sha256 || (name === 'git-flow' && process.platform !== 'win32' && !(stat.mode & 0o111))) throw invalid(`资源文件校验失败：${name}`);
    }
    return { version: '1.12.3', directory: await realpath(directory), fingerprint: hash(bytes), files: names.length };
  } catch (error) {
    if (signal?.aborted) throw error;
    if ((error as { code?: string }).code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID') throw error;
    throw Object.assign(invalid('无法完整读取应用内置工具及许可文件。'), { cause: error });
  }
}
export async function resolveGitFlowTool(options: { toolMode?: 'bundled' | 'system'; directory?: string; signal?: AbortSignal } = {}): Promise<GitFlowTool> {
  if (options.toolMode === 'system') return { source: 'system', version: '', directory: null, fingerprint: 'system', arguments: ['flow'] };
  let directory = options.directory;
  if (!directory) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
      const candidate = join(resourcesPath, 'git-flow-avh');
      const developmentApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;
      if (!developmentApp) directory = candidate;
      try { await lstat(candidate); directory = candidate; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid('无法读取应用资源目录。'); }
    }
    directory ??= repositoryGitFlowDirectory;
  }
  const tool = await verifyBundledGitFlow(directory, options.signal);
  // A fresh private alias avoids the precedence of existing git-flow commands.
  // Only the internal absolute launcher path is shell-quoted; user options stay argv.
  const alias = `astragit-flow-${randomUUID().replaceAll('-', '')}`;
  const absolute = join(tool.directory, 'git-flow');
  const launcher = process.platform === 'win32' ? absolute.replaceAll('\\', '/') : absolute;
  const quoted = `'${launcher.replaceAll("'", "'\\''")}'`;
  return { source: 'bundled', version: tool.version, directory: tool.directory, fingerprint: `${tool.directory}:${tool.fingerprint}`, arguments: ['-c', `alias.${alias}=!exec ${quoted}`, alias] };
}
