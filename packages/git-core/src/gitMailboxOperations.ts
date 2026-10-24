import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import { fingerprint, inspectPatch, patchBytes, type GitPatchFile } from './gitPatchOperations.js';

export interface GitMailboxInput { data: string; encoding: 'base64' | 'utf8'; threeWay?: boolean; keepSubject?: boolean; keepCR?: boolean; empty?: 'stop' | 'drop' | 'keep'; format?: 'auto' | 'mbox' | 'mboxrd' }
export interface GitMailboxCommit { number: number; author: string; email: string; subject: string; date: string; message: string; empty: boolean; files: GitPatchFile[] }
export interface GitMailboxPreview { fingerprint: string; patchSha256: string; byteLength: number; branch: string; headSha: string; commits: GitMailboxCommit[]; files: GitPatchFile[]; affectedPaths: string[]; applicable: boolean; diagnostics: string }
type Guard = () => Promise<{ integration: string | null; changed: string[] }>;
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
const fail = (code: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_MAILBOX_${code}`, operationStage: 'preflight', operationStatus: 'failed_before_write', ...(details ? { details } : {}) });
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function bytes(input: GitMailboxInput) {
  if (!input || ['threeWay', 'keepSubject', 'keepCR'].some(key => input[key as 'threeWay'] !== undefined && typeof input[key as 'threeWay'] !== 'boolean') || (input.empty !== undefined && !['stop', 'drop', 'keep'].includes(input.empty)) || (input.format !== undefined && !['auto', 'mbox', 'mboxrd'].includes(input.format))) throw fail('INVALID', '邮箱补丁选项无效。');
  return patchBytes({ ...input, target: 'worktree' });
}
function format(input: GitMailboxInput, source: Buffer) {
  if (input.format === 'mbox' || input.format === 'mboxrd') return input.format;
  const ends = [source.indexOf('\n\n'), source.indexOf('\r\n\r\n')].filter(end => end >= 0); const header = source.subarray(0, ends.length ? Math.min(...ends) : 0).toString('ascii');
  return /^X-AstraGit-Mailbox-Format: mboxrd\r?$/imu.test(header) ? 'mboxrd' : 'mbox';
}
export function mailboxArgs(input: GitMailboxInput, source = bytes(input)) { return ['am', input.threeWay === false ? '--no-3way' : '--3way', ...(input.keepSubject === false ? [] : ['--keep']), input.keepCR === false ? '--no-keep-cr' : '--keep-cr', '--utf8', '--no-scissors', '--no-message-id', `--empty=${input.empty ?? 'stop'}`, `--patch-format=${format(input, source)}`]; }

/** Mail parsing writes only to a private disposable folder, never the worktree. */
export async function readMailboxPreview(cwd: string, input: GitMailboxInput, runtime: Runtime, guard: Guard): Promise<GitMailboxPreview> {
  const source = bytes(input); const reader = new GitHistoryReader(cwd, runtime); await reader.initialize(); const directory = await mkdtemp(join(tmpdir(), 'astragit-mailbox-'));
  try {
    const count = Number((await reader.text(['mailsplit', '-b', ...(format(input, source) === 'mboxrd' ? ['--mboxrd'] : []), ...(input.keepCR === false ? [] : ['--keep-cr']), `-o${directory}`, '--'], source)).trim());
    if (!Number.isSafeInteger(count) || count < 1 || count > 2000) throw fail('INVALID', '邮箱补丁为空或超过 2000 封邮件，请缩小序列。');
    const commits: GitMailboxCommit[] = []; const files: GitPatchFile[] = []; const paths = new Set<string>();
    for (let index = 1; index <= count; index++) {
      runtime.signal?.throwIfAborted(); const mail = await readFile(join(directory, String(index).padStart(4, '0'))); const messagePath = join(directory, `message-${index}`); const patchPath = join(directory, `patch-${index}`);
      const headers = await reader.text(['mailinfo', ...(input.keepSubject === false ? [] : ['-k']), '--encoding=UTF-8', '--no-scissors', messagePath, patchPath], mail);
      const values = new Map<string, string>();
      for (const row of headers.split('\n').filter(Boolean)) { const colon = row.indexOf(': '); const key = row.slice(0, colon); if (colon < 0 || values.has(key)) throw fail('INVALID', '无法完整解析邮件作者和主题。'); values.set(key, row.slice(colon + 2)); }
      if (!values.get('Author') || !values.get('Email')) throw fail('INVALID', '邮件没有可确认的作者姓名和邮箱，请检查补丁来源。');
      const patch = await readFile(patchPath); const message = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(messagePath)); let entries: GitPatchFile[] = [];
      if (patch.length) { const inspected = await inspectPatch(reader, patch, { data: '', encoding: 'base64', target: 'worktree' }); entries = inspected.files; inspected.paths.forEach(path => paths.add(path)); }
      commits.push({ number: index, author: values.get('Author')!, email: values.get('Email')!, subject: values.get('Subject') ?? '', date: values.get('Date') ?? '', message: `${values.get('Subject') ?? ''}${message ? `\n\n${message}` : '\n'}`, empty: !entries.length, files: entries }); files.push(...entries);
    }
    const affectedPaths = [...paths].sort(); const state = await guard(); const before = await fingerprint(cwd, affectedPaths, reader, runtime);
    const indexPaths = new Set((await reader.text(['ls-files', '-z', '--cached', '--deduplicate'])).split('\0').filter(Boolean)); const obstacles: string[] = [];
    for (const path of affectedPaths) if (!indexPaths.has(path) && await lstat(join(cwd, path)).then(() => true, error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; })) obstacles.push(path);
    const after = await fingerprint(cwd, affectedPaths, reader, runtime); const next = await guard();
    if (before.fingerprint !== after.fingerprint || JSON.stringify(state) !== JSON.stringify(next)) throw fail('CHANGED', '预览期间仓库内容或整合状态已变化，请重新读取。');
    const diagnostics = [state.integration ? `请先完成或终止当前整合：${state.integration}` : '', state.changed.length ? `请先提交或贮藏以下本地修改：\n${state.changed.join('\n')}` : '', obstacles.length ? `补丁目标已有未跟踪文件或目录，请先处理：\n${obstacles.join('\n')}` : ''].filter(Boolean).join('\n');
    return { ...before, fingerprint: hash(JSON.stringify([before.fingerprint, state, obstacles, hash(source), mailboxArgs(input, source)])), patchSha256: hash(source), byteLength: source.length, commits, files, affectedPaths, applicable: !diagnostics, diagnostics };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function prepareMailboxImport(cwd: string, input: GitMailboxInput, expectedFingerprint: string, runtime: Runtime, guard: Guard) {
  const preview = await readMailboxPreview(cwd, input, runtime, guard);
  if (!expectedFingerprint || expectedFingerprint !== preview.fingerprint) throw fail('CHANGED', '仓库、邮件内容或导入选项已变化，本次未开始导入，请重新预览。');
  if (!preview.applicable) throw fail('BLOCKED', '当前仓库不能开始邮件补丁导入，请先处理本地修改或现有整合。', preview.diagnostics);
  return { preview, args: mailboxArgs(input), bytes: bytes(input) };
}
