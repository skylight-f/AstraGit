import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GitDiffHunk, GitDiffSummary, GitFileDiff } from './index.js';
import { GitHistoryReader } from './gitFileHistory.js';
import { gitFileSelection } from './gitFileTracking.js';
import { fingerprint } from './gitPatchOperations.js';
import { parseGitUnifiedDiff } from './gitUnifiedDiff.js';
import { quoteGitPath } from './gitQuotedPath.js';

export interface GitLineDiffInput { path: string; stage: 'staged' | 'unstaged' }
export interface GitLineSelection { hunk: number; lines: number[] }
export interface GitLineChange extends GitLineDiffInput { operation: 'stage' | 'unstage' | 'discard'; selection: GitLineSelection[]; expectedFingerprint: string }
export interface GitLineDiffPreview extends GitLineDiffInput { fingerprint: string; branch: string; headSha: string; diff: GitDiffSummary; readOnlyReason?: 'filter' | 'file-type' | 'binary' | 'metadata' }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
type Row = { content: string; newline: boolean };
const maximum = 8 * 1024 ** 2;
const maximumDiff = 2 * 1024 ** 2;
const fail = (suffix: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_LINES_${suffix}`, operationStatus: 'failed_before_write', operationStage: 'preflight', statusCode: suffix === 'CHANGED' ? 409 : 400, ...(details ? { details } : {}) });
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function parseGitLineDiffInput(value: unknown): GitLineDiffInput {
  const item = value as Partial<GitLineDiffInput> | null;
  if (!item || typeof item !== 'object' || typeof item.path !== 'string' || item.path.length > 16_384 || !['staged', 'unstaged'].includes(item.stage ?? '')) throw fail('INVALID', '请选择文件及已暂存或未暂存差异。');
  let path: string; try { path = gitFileSelection([item.path])[0]!; } catch { throw fail('PATH', '请选择仓库内的实际文件，不能操作 Git 元数据或仓库外路径。'); }
  return { path, stage: item.stage! };
}
export function parseGitLineChange(value: unknown): GitLineChange {
  const input = parseGitLineDiffInput(value); const item = value as GitLineChange;
  if (!['stage', 'unstage', 'discard'].includes(item.operation) || (item.operation === 'unstage' ? input.stage !== 'staged' : input.stage !== 'unstaged') || typeof item.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(item.expectedFingerprint) || !Array.isArray(item.selection) || !item.selection.length || item.selection.length > 10_000) throw fail('INVALID', '逐行操作、差异版本或所选行无效。');
  const seen = new Set<number>(); let total = 0;
  const selection = item.selection.map(row => {
    if (!row || !Number.isSafeInteger(row.hunk) || row.hunk < 0 || seen.has(row.hunk) || !Array.isArray(row.lines) || !row.lines.length || row.lines.some(line => !Number.isSafeInteger(line) || line < 0)) throw fail('INVALID', '逐行选择包含无效或重复的区块。');
    seen.add(row.hunk); const lines = [...new Set(row.lines)].sort((a, b) => a - b); total += lines.length;
    if (total > 100_000) throw fail('TOO_LARGE', '所选行过多，请分批处理。');
    return { hunk: row.hunk, lines };
  }).sort((a, b) => a.hunk - b.hunk);
  return { ...input, operation: item.operation, expectedFingerprint: item.expectedFingerprint, selection };
}
function utf8(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw fail('UNSUPPORTED', '转换后的文件内容不是有效 UTF-8，请使用整文件操作或外部工具。'); }
}
function rows(bytes: Buffer): Row[] {
  const text = utf8(bytes); if (!text) return [];
  const parts = text.split('\n'); const ends = parts.at(-1) === ''; if (ends) parts.pop();
  return parts.map((content, index) => ({ content, newline: index < parts.length - 1 || ends }));
}
function fromRows(value: Row[]): Buffer { return Buffer.from(value.map((row, index) => row.content + (index < value.length - 1 || row.newline ? '\n' : '')).join('')); }

/** Only this private runner may write Git objects, and only in its disposable store. */
async function isolatedStore<T>(cwd: string, reader: GitHistoryReader, runtime: Runtime, work: (run: (args: string[], input?: Uint8Array, allowed?: number[]) => Promise<Buffer>, directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'astragit-lines-')); const objects = join(directory, 'objects');
  try {
    await mkdir(objects); const realObjects = resolve(cwd, (await reader.text(['rev-parse', '--git-path', 'objects'])).replace(/\r?\n$/u, ''));
    const alternate = join(directory, 'original-objects'); await symlink(realObjects, alternate, process.platform === 'win32' ? 'junction' : 'dir');
    const run = (args: string[], input?: Uint8Array, allowed = [0]): Promise<Buffer> => new Promise((accept, reject) => {
      const child = execFile('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', '--literal-pathspecs', ...args], { cwd, signal: runtime.signal, timeout: 30_000, maxBuffer: maximum * 2, encoding: 'buffer', env: { ...process.env, ...runtime.env, GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_NAMESPACE: undefined, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LANG: 'C', LC_ALL: 'C' } }, (error, stdout, stderr) => {
        if (!error || typeof error.code === 'number' && allowed.includes(error.code)) accept(stdout);
        else reject(Object.assign(fail(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'TOO_LARGE' : 'READ', '无法完整读取或转换逐行差异，请查看 Git 详情。', stderr.toString('utf8')), { cause: error }));
      });
      child.stdin?.on('error', () => { /* The process callback reports failures, including closed stdin. */ }); child.stdin?.end(input);
    });
    return await work(run, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
type IsolatedRun = (args: string[], input?: Uint8Array, allowed?: number[]) => Promise<Buffer>;
async function rawDiff(run: IsolatedRun, directory: string, before: Buffer | null, after: Buffer | null, beforeMode: string, afterMode: string, suffix: string) {
  const left = before === null ? devNull : join(directory, `before-${suffix}`); const right = after === null ? devNull : join(directory, `after-${suffix}`);
  if (before !== null) { await writeFile(left, before); await chmod(left, beforeMode === '100755' ? 0o755 : 0o644); }
  if (after !== null) { await writeFile(right, after); await chmod(right, afterMode === '100755' ? 0o755 : 0o644); }
  const output = await run(['diff', '--no-index', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-algorithm=myers', '--src-prefix=a/', '--dst-prefix=b/', '--no-relative', '--unified=3', '--', left, right], undefined, [0, 1]);
  if (output.length > maximumDiff) throw fail('TOO_LARGE', '逐行差异超过 2 MiB，请使用整文件操作或外部工具。');
  return utf8(output);
}
function canonicalPatch(text: string, path: string): string {
  let hunk = false;
  return text.split('\n').map(line => {
    if (line.startsWith('diff --git ')) return `diff --git ${quoteGitPath('a/' + path)} ${quoteGitPath('b/' + path)}`;
    if (line.startsWith('@@ ')) hunk = true;
    if (!hunk && line.startsWith('--- ') && line !== '--- /dev/null') return '--- ' + quoteGitPath('a/' + path);
    if (!hunk && line.startsWith('+++ ') && line !== '+++ /dev/null') return '+++ ' + quoteGitPath('b/' + path);
    return line;
  }).join('\n');
}

async function worktreeFile(cwd: string, path: string, includeBytes: boolean) {
  const parts = path.split('/'); const identity: unknown[] = [];
  for (let index = 0; index < parts.length; index++) {
    let entry;
    try { entry = await lstat(join(cwd, ...parts.slice(0, index + 1))); }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return { bytes: null, mode: '', identity: [...identity, 'missing'], regular: true }; throw error; }
    identity.push([entry.dev, entry.ino, entry.mode, entry.size, entry.mtimeMs, entry.ctimeMs]);
    if (index < parts.length - 1) { if (entry.isSymbolicLink() || !entry.isDirectory()) throw fail('PATH', '逐行路径经过符号链接或已变化的目录，请重新选择实际仓库内文件。'); continue; }
    if (!entry.isFile()) return { bytes: null, mode: '', identity, regular: false };
    const mode = entry.mode & 0o111 ? '100755' : '100644';
    if (!includeBytes) return { bytes: null, mode, identity, regular: true };
    if (entry.size > maximum) throw fail('TOO_LARGE', '文件超过 8 MiB，不能完整核对逐行操作，请使用整文件操作或外部工具。');
    const handle = await open(join(cwd, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat(); if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev) throw fail('CHANGED', '文件在读取期间被替换，请重新读取差异。');
      const buffer = Buffer.alloc(maximum + 1); let length = 0;
      while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
      if (length > maximum) throw fail('TOO_LARGE', '文件超过 8 MiB，不能完整核对逐行操作。');
      const after = await handle.stat(); if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw fail('CHANGED', '文件在读取期间发生变化，请重新读取差异。');
      return { bytes: buffer.subarray(0, length), mode, identity, regular: true };
    } finally { await handle.close(); }
  }
  throw fail('PATH', '没有选择实际文件。');
}
async function state(cwd: string, input: GitLineDiffInput, reader: GitHistoryReader, runtime: Runtime) {
  const identity = await fingerprint(cwd, [], reader, runtime, false);
  const [config, attributes, index] = await Promise.all([
    reader.text(['config', '--null', '--list', '--includes']), reader.text(['check-attr', '-z', '--stdin', 'filter', 'diff', 'eol', 'text', 'working-tree-encoding'], input.path + '\0'),
    reader.text(['ls-files', '--stage', '-z', '--', input.path]),
  ]);
  const fields = attributes.split('\0'); const attrs = new Map<string, string>();
  for (let offset = 0; offset < fields.length - 1; offset += 3) { if (fields[offset] !== input.path) throw fail('READ', '文件属性清单不完整，请重新读取。'); attrs.set(fields[offset + 1]!, fields[offset + 2]!); }
  if (attrs.size !== 5) throw fail('READ', '文件属性清单不完整，请重新读取。');
  const filter = !['unspecified', 'unset'].includes(attrs.get('filter') ?? '');
  let fileMode = true;
  for (const record of config.split('\0').filter(Boolean)) {
    const split = record.indexOf('\n'); const key = split < 0 ? record : record.slice(0, split);
    if (key.toLowerCase() === 'core.filemode') fileMode = split < 0 || !['', 'false', 'no', 'off', '0'].includes(record.slice(split + 1).trim().toLowerCase());
  }
  const worktree = await worktreeFile(cwd, input.path, !filter);
  const key = digest(JSON.stringify([identity.fingerprint, config, attributes, index, [input.path, input.stage], worktree.identity, worktree.bytes === null ? null : digest(worktree.bytes)]));
  return { ...identity, key, filter, fileMode, binary: attrs.get('diff') === 'unset', index, worktree };
}
function indexEntry(text: string, path: string) {
  let entry: { mode: string; sha: string } | undefined;
  for (const value of text.split('\0').filter(Boolean)) {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]*)$/u.exec(value);
    if (!match || match[4] !== path) throw fail('PATH', '逐行操作只能选择一个实际文件，不能选择目录。');
    if (match[3] !== '0') throw fail('CONFLICT', '此文件仍有冲突，请使用冲突编辑器处理后再执行逐行操作。');
    entry = { mode: match[1]!, sha: match[2]! };
  }
  return entry;
}
async function treeEntry(reader: GitHistoryReader, head: string, path: string) {
  if (!head) return undefined;
  const value = await reader.text(['ls-tree', '--full-tree', '-z', head, '--', path]);
  if (!value) return undefined;
  const match = /^(\d{6}) (?:blob|commit|tree) ([a-f0-9]{40,64})\t([\s\S]*)\0$/u.exec(value);
  if (!match || match[3] !== path) throw fail('PATH', '逐行操作只能选择一个实际文件。');
  return { mode: match[1]!, sha: match[2]! };
}
type Context = { preview: GitLineDiffPreview; file?: GitFileDiff; before: Buffer | null; after: Buffer | null; beforeMode: string; afterMode: string; reader: GitHistoryReader; run: IsolatedRun; directory: string };
async function withContext<T>(cwd: string, value: GitLineDiffInput, runtime: Runtime, work: (context: Context) => Promise<T>): Promise<T> {
  const input = parseGitLineDiffInput(value); const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const first = await state(cwd, input, reader, runtime); const index = indexEntry(first.index, input.path); const head = await treeEntry(reader, first.headSha, input.path);
  if (!index && first.worktree.regular && first.worktree.mode) {
    const untracked = await reader.text(['ls-files', '--others', '--exclude-standard', '-z', '--', input.path]);
    if (!untracked.split('\0').includes(input.path)) throw fail('PATH', '所选文件已不在当前 Git 更改范围中，请重新选择。');
  }
  return isolatedStore(cwd, reader, runtime, async (run, directory) => {
    const source = input.stage === 'staged' ? head : index;
    let readOnlyReason: GitLineDiffPreview['readOnlyReason'] = first.filter ? 'filter' : !first.worktree.regular || [source, index].some(item => item && !['100644', '100755'].includes(item.mode)) ? 'file-type' : first.binary ? 'binary' : undefined;
    const blob = async (sha: string | undefined) => sha ? reader.run(['cat-file', 'blob', sha], undefined, undefined, maximum) : null;
    const before = readOnlyReason ? null : await blob(source?.sha);
    let after = readOnlyReason ? null : input.stage === 'staged' ? await blob(index?.sha) : first.worktree.bytes;
    const beforeMode = source?.mode ?? '';
    const afterMode = input.stage === 'staged' ? index?.mode ?? '' : first.worktree.mode ? first.fileMode ? first.worktree.mode : index?.mode ?? '100644' : '';
    if (!readOnlyReason && input.stage === 'unstaged' && after !== null) {
      const sha = (await run(['hash-object', '-w', '--path=' + input.path, '--stdin'], after)).toString('utf8').trim();
      if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw fail('READ', 'Git 未返回完整的转换结果。');
      after = await run(['cat-file', 'blob', sha]);
      if (after.length > maximum) throw fail('TOO_LARGE', '转换后的文件超过逐行核对范围，请使用整文件操作。');
    }
    const native = readOnlyReason ? '' : canonicalPatch(await rawDiff(run, directory, before, after, beforeMode, afterMode, 'original'), input.path);
    const files = parseGitUnifiedDiff(native); const file = files[0];
    if (files.length > 1) throw fail('READ', 'Git 返回了多个文件的逐行差异。');
    if (file && file.hunks.reduce((count, hunk) => count + hunk.lines.length, 0) > 100_000) throw fail('TOO_LARGE', '逐行差异超过十万行，请使用整文件操作或外部工具。');
    if (!readOnlyReason && file && !file.hunks.length) readOnlyReason = native.includes('GIT binary patch') ? 'binary' : 'metadata';
    if (!readOnlyReason) { if (before) utf8(before); if (after) utf8(after); }
    const last = await state(cwd, input, reader, runtime); if (first.key !== last.key) throw fail('CHANGED', '读取期间文件、分支、索引或配置已变化，请重新读取差异。');
    const preview: GitLineDiffPreview = { ...input, fingerprint: digest(JSON.stringify([first.key, native, readOnlyReason])), branch: first.branch, headSha: first.headSha, diff: { isRepository: true, files: files.map(item => item.newPath || item.oldPath), diffText: native, fileDiffs: files }, ...(readOnlyReason ? { readOnlyReason } : {}) };
    return work({ preview, file, before, after, beforeMode, afterMode, reader, run, directory });
  });
}
export function readGitLineDiff(cwd: string, input: GitLineDiffInput, runtime: Runtime = {}) { return withContext(cwd, input, runtime, async context => context.preview); }

function changedLines(hunk: GitDiffHunk, reverse: boolean) {
  const mapped = hunk.lines.flatMap((line, index) => line.type === 'metadata' ? [] : [{ index, kind: reverse ? line.type === 'addition' ? 'deletion' : line.type === 'deletion' ? 'addition' : 'context' : line.type, content: line.content, newline: hunk.lines[index + 1]?.type !== 'metadata' }]);
  if (!reverse) return mapped;
  const ordered: typeof mapped = []; let pending: typeof mapped = [];
  const flush = () => { ordered.push(...pending.filter(line => line.kind === 'deletion'), ...pending.filter(line => line.kind === 'addition')); pending = []; };
  for (const line of mapped) { if (line.kind === 'context') { flush(); ordered.push(line); } else pending.push(line); } flush(); return ordered;
}
function compose(file: GitFileDiff, base: Buffer | null, input: GitLineChange) {
  const selected = new Map(input.selection.map(row => [row.hunk, new Set(row.lines)]));
  for (const [index, lines] of selected) { const hunk = file.hunks[index]; if (!hunk || [...lines].some(line => !['addition', 'deletion'].includes(hunk.lines[line]?.type ?? ''))) throw fail('INVALID', '所选行已不属于当前差异，请重新选择实际增删行。'); }
  const original = rows(base ?? Buffer.alloc(0)); const output: Row[] = []; const reverse = input.operation !== 'stage'; let cursor = 0;
  for (let index = 0; index < file.hunks.length; index++) {
    const hunk = file.hunks[index]!; const start = reverse ? hunk.newStart : hunk.oldStart; const length = reverse ? hunk.newLines : hunk.oldLines; const begin = length ? start - 1 : start;
    if (begin < cursor || begin > original.length) throw fail('READ', '差异行号与实际文件内容不一致，请重新读取。');
    output.push(...original.slice(cursor, begin)); cursor = begin;
    for (const line of changedLines(hunk, reverse)) {
      const chosen = selected.get(index)?.has(line.index) === true;
      if (line.kind === 'addition') { if (chosen) output.push({ content: line.content, newline: line.newline }); }
      else {
        const actual = original[cursor++]; if (!actual || actual.content !== line.content) throw fail('CHANGED', '差异与实际文件内容不一致，本次未应用所选行。');
        if (line.kind === 'context' || !chosen) output.push(actual);
      }
    }
  }
  output.push(...original.slice(cursor)); return fromRows(output);
}
export async function prepareGitLineChanges(cwd: string, value: GitLineChange, runtime: Runtime = {}) {
  const input = parseGitLineChange(value);
  return withContext(cwd, input, runtime, async context => {
    if (context.preview.fingerprint !== input.expectedFingerprint) throw fail('CHANGED', '文件、分支、索引、属性或配置已变化，本次未应用所选行。请重新读取并选择。');
    if (context.preview.readOnlyReason) throw fail('UNSUPPORTED', '此文件的类型、属性或过滤器不支持逐行操作，请使用整文件操作或外部工具。');
    if (!context.file?.hunks.length) throw fail('EMPTY', '当前文件没有可操作的文本更改，请重新读取。');
    const reverse = input.operation !== 'stage'; const base = reverse ? context.after : context.before; const restored = reverse ? context.before : context.after;
    const next = compose(context.file, base, input); const missing = restored === null && next.length === 0;
    const mode = (reverse ? context.afterMode : context.beforeMode) || (reverse ? context.beforeMode : context.afterMode) || '100644';
    // Git apply performs its own worktree encoding/EOL conversion. Its patch
    // must contain canonical Git bytes, including for worktree-only discard.
    const source = base; const target: Buffer | null = missing ? null : next;
    if (source?.equals(target ?? Buffer.alloc(0)) && (source === null) === (target === null)) throw fail('EMPTY', '所选行没有产生实际更改，请重新选择。');
    const patch = canonicalPatch(await rawDiff(context.run, context.directory, source, target, mode, mode, 'selected'), input.path);
    if (!patch) throw fail('EMPTY', '所选行没有产生实际更改。');
    const args = ['apply', ...(input.operation === 'discard' ? [] : ['--cached']), '--whitespace=nowarn'];
    try { await context.reader.run([...args, '--check', '-'], Buffer.from(patch)); }
    catch (error) { throw fail('CHECK_FAILED', '所选行补丁未通过 Git 校验，本次未应用。请重新读取差异。', (error as { stderr?: string }).stderr); }
    const beforeWrite = await state(cwd, context.preview, context.reader, runtime);
    // Reuse the same complete identity calculation without creating a new diff.
    const current = digest(JSON.stringify([beforeWrite.key, context.preview.diff.diffText, context.preview.readOnlyReason]));
    if (current !== context.preview.fingerprint) throw fail('CHANGED', '校验期间文件、索引或配置已变化，本次未应用所选行。');
    return { args: [...args, '-'], bytes: Buffer.from(patch), preview: context.preview };
  });
}
