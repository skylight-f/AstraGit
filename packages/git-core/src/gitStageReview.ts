import { createHash } from 'node:crypto';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import { gitFileSelection } from './gitFileTracking.js';

export const defaultGitLargeFileThreshold = 10 * 1024 * 1024;
export interface GitLargeFileReview { thresholdBytes?: number; skipWarning?: boolean; expectedFingerprint?: string }
export interface GitStagePreviewInput { paths: string[]; forceIgnored?: boolean; thresholdBytes?: number }
export interface GitStagePreview {
  fingerprint: string; paths: string[]; forceIgnored: boolean; thresholdBytes: number; headSha: string; branch: string;
  largeFiles: Array<{ path: string; byteLength: number }>; totalBytes: number;
  lfsSetupRequired: boolean; lfsFiles: string[];
}
type Runtime = { env?: NodeJS.ProcessEnv; signal?: AbortSignal };
const fail = (suffix: string, message: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_STAGE_${suffix}`, operationStage: 'preflight', operationStatus: 'failed_before_write', statusCode: ['CHANGED', 'LARGE_FILES'].includes(suffix) ? 409 : 400 });
function threshold(value: unknown) {
  if (value === undefined) return defaultGitLargeFileThreshold;
  if (!Number.isSafeInteger(value) || (value as number) < 1024 * 1024 || (value as number) > 1024 ** 3) throw fail('INVALID', '大文件提醒阈值应在 1 MiB 到 1 GiB 之间。');
  return value as number;
}
export function parseGitLargeFileReview(value: unknown): GitLargeFileReview | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID', '大文件暂存确认无效。');
  const input = value as Record<string, unknown>;
  if (input.skipWarning !== undefined && typeof input.skipWarning !== 'boolean') throw fail('INVALID', '大文件提醒开关必须为布尔值。');
  if (input.expectedFingerprint !== undefined && (typeof input.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint))) throw fail('INVALID', '大文件暂存确认版本无效。');
  return { thresholdBytes: threshold(input.thresholdBytes), ...(input.skipWarning === undefined ? {} : { skipWarning: input.skipWarning as boolean }), ...(input.expectedFingerprint ? { expectedFingerprint: input.expectedFingerprint as string } : {}) };
}
export function parseGitStagePreviewInput(value: unknown): GitStagePreviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID', '暂存范围无效。');
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 20_000 || input.paths.some(path => typeof path !== 'string' || path.length > 16_384)) throw fail('INVALID', '请选择有效的仓库文件范围。');
  if (input.forceIgnored !== undefined && typeof input.forceIgnored !== 'boolean') throw fail('INVALID', '强制暂存开关必须为布尔值。');
  const paths = [...new Set((input.paths as string[]).map(path => path === '.' ? path : gitFileSelection([path])[0]!))].sort();
  return { paths, thresholdBytes: threshold(input.thresholdBytes), forceIgnored: input.forceIgnored === true };
}
async function inspect(cwd: string, path: string) {
  const absolute = resolve(cwd, path); const scope = relative(cwd, absolute);
  if (isAbsolute(scope) || scope === '..' || scope.startsWith('../')) throw fail('PATH', '暂存路径位于仓库外。');
  const parts = path.replace(/\/$/u, '').split('/');
  for (let index = 0; index < parts.length; index++) {
    let entry;
    try { entry = await lstat(join(cwd, ...parts.slice(0, index + 1))); }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return { identity: [path, 'missing'], size: 0, regular: false }; throw error; }
    if (index < parts.length - 1) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw fail('PATH', '暂存路径经过符号链接或已变化的目录，请重新选择实际仓库内的文件。');
    } else {
      const identity = [path, entry.dev, entry.ino, entry.mode, entry.size, entry.mtimeMs, entry.ctimeMs, entry.isSymbolicLink() ? await readlink(absolute) : ''];
      return { identity, size: entry.isFile() ? entry.size : 0, regular: entry.isFile() };
    }
  }
  throw fail('PATH', '暂存路径无效。');
}
async function collect(cwd: string, input: GitStagePreviewInput, runtime: Runtime) {
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const [headSha, branch, index, flags, config] = await Promise.all([
    reader.revision(), reader.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, undefined, undefined, [0, 1]).then(value => value.toString('utf8').replace(/\r?\n$/u, '')),
    reader.text(['ls-files', '--stage', '-z']), reader.text(['ls-files', '-v', '-z']), reader.text(['config', '--null', '--list', '--includes']),
  ]);
  const candidates = new Set<string>();
  for (let offset = 0; offset < input.paths.length; offset += 128) {
    const raw = await reader.run(['ls-files', '--cached', '--others', '--deduplicate', ...(input.forceIgnored ? [] : ['--exclude-standard']), '-z', '--', ...input.paths.slice(offset, offset + 128)]);
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); } catch { throw fail('PATH', '暂存清单包含非 UTF-8 文件名，无法完整核对。'); }
    for (const path of text.split('\0').filter(Boolean)) candidates.add(path);
    if (candidates.size > 100_000) throw fail('TOO_LARGE', '暂存范围超过十万项，请按目录分批暂存。');
  }
  const metadata: unknown[] = []; const sizes = new Map<string, number>();
  for (const path of [...candidates].sort()) {
    runtime.signal?.throwIfAborted(); gitFileSelection([path]); const value = await inspect(cwd, path); metadata.push(value.identity);
    if (value.regular) sizes.set(path, value.size);
  }
  const largeFiles: GitStagePreview['largeFiles'] = []; const lfsFiles: string[] = []; let attributes = '';
  if (sizes.size) {
    attributes = await reader.text(['check-attr', '-z', '--stdin', 'filter'], [...sizes.keys()].join('\0') + '\0');
    const fields = attributes.split('\0'); if (fields.at(-1) === '') fields.pop();
    if (fields.length !== sizes.size * 3) throw fail('READ', 'Git 未返回完整的大文件属性信息。');
    for (let position = 0; position < fields.length; position += 3) {
      const [path, name, value] = fields.slice(position, position + 3);
      if (name !== 'filter' || !sizes.has(path!)) throw fail('READ', 'Git 返回了无效的大文件属性信息。');
      if (value === 'lfs') lfsFiles.push(path!);
      else if (sizes.get(path!)! >= input.thresholdBytes!) largeFiles.push({ path: path!, byteLength: sizes.get(path!)! });
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([await realpath(cwd), input, headSha, branch, index, flags, config, metadata, attributes])).digest('hex');
  const filterValues = new Map(config.split('\0').filter(Boolean).map(record => { const split = record.indexOf('\n'); return [record.slice(0, split).toLowerCase(), record.slice(split + 1)] as const; }));
  const lfsSetupRequired = lfsFiles.length > 0 && !filterValues.get('filter.lfs.clean')?.trim() && !filterValues.get('filter.lfs.process')?.trim();
  return { fingerprint, paths: input.paths, forceIgnored: input.forceIgnored === true, thresholdBytes: input.thresholdBytes!, headSha, branch, largeFiles, totalBytes: largeFiles.reduce((sum, file) => sum + file.byteLength, 0), lfsSetupRequired, lfsFiles };
}
/** Stat and Git attribute identities avoid hashing gigabytes merely to show a warning. */
export async function readGitStagePreview(cwd: string, value: unknown, runtime: Runtime = {}): Promise<GitStagePreview> {
  const input = parseGitStagePreviewInput(value); cwd = await realpath(cwd);
  const before = await collect(cwd, input, runtime); const after = await collect(cwd, input, runtime);
  if (before.fingerprint !== after.fingerprint) throw fail('CHANGED', '读取期间暂存范围、文件或属性已变化，请重新确认。');
  return after;
}
export function validateGitStageReview(preview: GitStagePreview, review: GitLargeFileReview | undefined) {
  if (review?.expectedFingerprint && review.expectedFingerprint !== preview.fingerprint) throw fail('CHANGED', '暂存范围、文件、属性或分支已变化，本次未暂存，请重新确认。');
  if (preview.lfsSetupRequired) throw Object.assign(fail('LFS_SETUP', '所选文件声明使用 LFS，但当前 Git 尚未配置 LFS clean/process。请先初始化 LFS，再暂存。'), { affectedFiles: preview.lfsFiles.slice(0, 200), affectedFileCount: preview.lfsFiles.length });
  if (preview.largeFiles.length && !review?.expectedFingerprint && !review?.skipWarning) throw Object.assign(fail('LARGE_FILES', '所选范围包含尚未由 LFS 跟踪的大文件。请先选择 LFS，或确认按普通 Git 暂存。'), { affectedFiles: preview.largeFiles.map(file => file.path).slice(0, 200), affectedFileCount: preview.largeFiles.length });
}
