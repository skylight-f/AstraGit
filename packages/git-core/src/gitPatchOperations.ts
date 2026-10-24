import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';

export interface GitPatchInput { data: string; encoding: 'base64' | 'utf8'; target: 'worktree' | 'index' | 'both'; reverse?: boolean; strip?: number }
export interface GitPatchFile { path: string; additions: number | null; deletions: number | null }
export interface GitPatchPreview { fingerprint: string; patchSha256: string; byteLength: number; files: GitPatchFile[]; affectedPaths: string[]; applicable: boolean; diagnostics: string; target: GitPatchInput['target']; reverse: boolean; strip: number; branch: string; headSha: string }
export interface GitPatchExportInput { scope: 'staged' | 'unstaged' | 'worktree' | 'commit' | 'range' | 'series'; paths?: string[]; includeUntracked?: boolean; revision?: string; baseRef?: string; targetRef?: string; revisions?: string[] }
export interface GitPatchSeriesCommit { sha: string; subject: string; author: string; email: string; authoredAt: string; message: string; empty: boolean }
export interface GitRepositoryPatchExport { data: string; byteLength: number; sha256: string; files: GitPatchFile[]; affectedPaths: string[]; suggestedName: string; baseSha: string; targetSha: string; commits?: GitPatchSeriesCommit[]; mailboxFormat?: 'mboxrd' }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
const maximum = 8 * 1024 * 1024;
const fail = (code: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_PATCH_${code}`, operationStage: 'preflight', operationStatus: 'failed_before_write', ...(details ? { details } : {}) });
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function pathValue(path: string) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw fail('PATH_INVALID', '补丁涉及无效路径、Git 元数据或仓库外位置，不能应用。');
  return path;
}
export function patchBytes(input: GitPatchInput): Buffer {
  if (!input || typeof input !== 'object' || typeof input.data !== 'string' || !['utf8', 'base64'].includes(input.encoding) || !['worktree', 'index', 'both'].includes(input.target) || (input.reverse !== undefined && typeof input.reverse !== 'boolean') || (input.strip !== undefined && (!Number.isSafeInteger(input.strip) || input.strip < 0 || input.strip > 32))) throw fail('IMPORT_INVALID', '补丁内容、应用位置或路径层级无效。');
  if (input.data.length > maximum * 2) throw fail('TOO_LARGE', '补丁超过 8 MiB，无法在应用中完整核对。');
  const bytes = Buffer.from(input.data, input.encoding === 'utf8' ? 'utf8' : 'base64');
  if (!bytes.length || bytes.length > maximum || (input.encoding === 'base64' && bytes.toString('base64') !== input.data)) throw fail(bytes.length > maximum ? 'TOO_LARGE' : 'IMPORT_INVALID', '补丁为空、编码不完整或超过 8 MiB。');
  return bytes;
}
function applyArgs(input: GitPatchInput) { return ['apply', `-p${input.strip ?? 1}`, ...(input.reverse ? ['--reverse'] : []), ...(input.target === 'index' ? ['--cached'] : input.target === 'both' ? ['--index'] : []), '--whitespace=nowarn']; }
function parseStats(bytes: Buffer): GitPatchFile[] {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail('PATH_ENCODING', '补丁中的文件名不是有效 UTF-8，无法在内置预览中完整核对。'); }
  const result: GitPatchFile[] = [];
  for (const record of text.split('\0').filter(Boolean)) {
    const first = record.indexOf('\t'); const second = record.indexOf('\t', first + 1);
    if (first < 1 || second < first + 2) throw fail('IMPORT_INVALID', 'Git 返回了不完整的补丁文件清单。');
    const count = (value: string) => { if (value === '-') return null; if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw fail('IMPORT_INVALID', 'Git 返回了无效补丁行数。'); return Number(value); };
    result.push({ path: pathValue(record.slice(second + 1)), additions: count(record.slice(0, first)), deletions: count(record.slice(first + 1, second)) });
  }
  return result;
}
export async function inspectPatch(reader: GitHistoryReader, bytes: Buffer, input: GitPatchInput) {
  const forward = parseStats(await reader.run([...applyArgs(input), '--numstat', '-z', '-'], bytes));
  const backward = parseStats(await reader.run([...applyArgs({ ...input, reverse: !input.reverse }), '--numstat', '-z', '-'], bytes));
  if (!forward.length && !backward.length) throw fail('EMPTY', '补丁没有可应用的文件变动。');
  return { files: forward, paths: [...new Set([...forward, ...backward].map(file => file.path))].sort() };
}
export async function fingerprint(cwd: string, paths: string[], reader: GitHistoryReader, runtime: Runtime, captureFiles = true) {
  const digest = createHash('sha256').update(await realpath(cwd));
  const headSha = await reader.revision(); let branch = '';
  try { branch = (await reader.text(['symbolic-ref', '--quiet', '--short', 'HEAD'])).replace(/\r?\n$/u, ''); }
  catch (error) { if ((error as { exitCode?: number }).exitCode !== 1) throw error; }
  digest.update(JSON.stringify([headSha, branch, await reader.text(['ls-files', '--stage', '-z']), await reader.text(['ls-files', '-v', '-z'])]));
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge/git-rebase-todo', 'rebase-merge/done', 'rebase-apply/next', 'sequencer/todo']) {
    const absolute = resolve(cwd, (await reader.text(['rev-parse', '--git-path', name])).replace(/\r?\n$/u, ''));
    try { digest.update(name + '\0').update(await readFile(absolute)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
  }
  for (const path of captureFiles ? paths : []) {
    const parts = pathValue(path).split('/');
    for (let index = 0; index < parts.length; index++) {
      runtime.signal?.throwIfAborted(); const part = parts.slice(0, index + 1).join('/'); const absolute = join(cwd, part); digest.update(part + '\0');
      let entry; try { entry = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') { digest.update('missing'); break; } throw error; }
      digest.update(String(entry.mode));
      if (entry.isSymbolicLink()) { digest.update('link\0').update(await readlink(absolute)); if (index < parts.length - 1) throw fail('PATH_INVALID', '补丁路径的上级是符号链接，不能通过它改写其他位置。'); }
      else if (!entry.isDirectory() && index < parts.length - 1) { digest.update('blocked'); break; }
      else if (entry.isFile()) { digest.update(String(entry.size)); for await (const chunk of createReadStream(absolute, { signal: runtime.signal })) digest.update(chunk as Buffer); }
    }
  }
  return { fingerprint: digest.digest('hex'), branch, headSha };
}

export async function readPatchPreview(cwd: string, input: GitPatchInput, runtime: Runtime): Promise<GitPatchPreview> {
  const bytes = patchBytes(input); const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const { files, paths } = await inspectPatch(reader, bytes, input); const before = await fingerprint(cwd, paths, reader, runtime, input.target !== 'index');
  let applicable = true; let diagnostics = '';
  try { await reader.run([...applyArgs(input), '--check', '-'], bytes); }
  catch (error) { if ((error as { exitCode?: number }).exitCode === undefined) throw error; applicable = false; diagnostics = (error as { stderr?: string }).stderr ?? String(error); }
  const after = await fingerprint(cwd, paths, reader, runtime, input.target !== 'index');
  if (before.fingerprint !== after.fingerprint) throw fail('PREVIEW_CHANGED', '读取期间仓库或文件已变化，请重新预览补丁。');
  return { ...before, fingerprint: hash(JSON.stringify([before.fingerprint, hash(bytes), input.target, input.reverse === true, input.strip ?? 1])), patchSha256: hash(bytes), byteLength: bytes.length, files, affectedPaths: paths, applicable, diagnostics, target: input.target, reverse: input.reverse === true, strip: input.strip ?? 1 };
}

/** Returns a prepared native command only after re-reading the exact reviewed state. */
export async function preparePatchImport(cwd: string, input: GitPatchInput, expectedFingerprint: string, runtime: Runtime) {
  const preview = await readPatchPreview(cwd, input, runtime);
  if (!expectedFingerprint || expectedFingerprint !== preview.fingerprint) throw fail('PREVIEW_CHANGED', '仓库、文件、补丁内容或应用选项已变化，本次未应用，请重新预览。');
  if (!preview.applicable) throw fail('CHECK_FAILED', '补丁校验未通过，本次未应用。请查看具体文件及 Git 原因。', preview.diagnostics);
  return { preview, args: [...applyArgs(input), '-'], bytes: patchBytes(input) };
}

export async function exportGitPatch(cwd: string, input: GitPatchExportInput, runtime: Runtime): Promise<GitRepositoryPatchExport> {
  if (input?.scope === 'series') return exportCommitSeries(cwd, input, runtime);
  if (!input || !['staged', 'unstaged', 'worktree', 'commit', 'range'].includes(input.scope) || (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.length > 20_000)) || [input.revision, input.baseRef, input.targetRef].some(value => value !== undefined && (typeof value !== 'string' || value.length > 4096 || value.includes('\0'))) || (input.includeUntracked !== undefined && typeof input.includeUntracked !== 'boolean')) throw fail('EXPORT_INVALID', '请选择有效的补丁导出范围。');
  const paths = input.paths?.map(pathValue); if (paths && !paths.length) throw fail('EMPTY', '没有选中要导出的文件。');
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize(); const head = await reader.revision();
  const revision = input.scope === 'commit' ? await reader.revision(input.revision ?? 'HEAD') : '';
  const base = input.scope === 'range' ? await reader.revision(input.baseRef ?? '') : '';
  const target = input.scope === 'range' ? await reader.revision(input.targetRef ?? 'HEAD') : revision;
  if ((input.scope === 'commit' && !revision) || (input.scope === 'range' && (!base || !target))) throw fail('EXPORT_INVALID', '所选版本不存在或尚无提交。');
  const options = ['--binary', '--full-index', '--find-renames', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-relative', '--submodule=short'];
  const selectedPaths = async () => {
    if (!paths || (input.scope === 'worktree' && !head)) return paths;
    const args = input.scope === 'commit' ? ['show', '--format=', '--root', '--first-parent', '--name-status', '-z', '--find-renames', revision]
      : ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', ...(input.scope === 'staged' ? ['--cached'] : input.scope === 'range' ? [base, target] : input.scope === 'worktree' ? [head] : [])];
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await reader.run([...args, '--'])); } catch (error) { if (error instanceof TypeError) throw fail('PATH_ENCODING', '导出文件名不是有效 UTF-8，无法完整核对。'); throw error; }
    const fields = text.split('\0'); const selected = new Set(paths);
    for (let index = 0; index < fields.length - 1;) {
      const status = fields[index++]!.replace(/^\n+/u, ''); if (!/^[AMDTRCU][0-9]*$/u.test(status)) throw fail('EXPORT_INVALID', '无法完整读取导出文件路径。');
      const original = pathValue(fields[index++] ?? '');
      if (/^[RC]/u.test(status)) { const next = pathValue(fields[index++] ?? ''); if (status.startsWith('R') && paths.some(path => next === path || next.startsWith(path + '/'))) selected.add(original); }
    }
    return [...selected];
  };
  const generate = async () => {
    const selection = await selectedPaths();
    const args = input.scope === 'commit' ? ['show', '--format=', '--root', '--first-parent', ...options, revision, '--', ...(selection ?? [])]
      : input.scope === 'range' ? ['diff', ...options, base, target, '--', ...(selection ?? [])]
      : ['diff', ...options, ...(input.scope === 'staged' ? ['--cached'] : input.scope === 'worktree' && head ? [head] : []), '--', ...(selection ?? [])];
    const parts: Buffer[] = [];
    if (input.scope !== 'worktree' || head) parts.push(await reader.run(['--literal-pathspecs', ...args], undefined, undefined, maximum));
    const additions = input.scope === 'worktree' && !head ? await reader.text(['ls-files', '-z', '--cached', '--deduplicate', '--', ...(paths ?? [])]) : '';
    const untracked = input.includeUntracked && ['worktree', 'unstaged'].includes(input.scope) ? await reader.text(['ls-files', '-z', '--others', '--exclude-standard', '--', ...(paths ?? [])]) : '';
    for (const path of [...new Set((additions + untracked).split('\0').filter(Boolean))]) {
      pathValue(path); await fingerprint(cwd, [path], reader, runtime);
      parts.push(await reader.run(['diff', '--no-index', ...options, '--', '/dev/null', path], undefined, undefined, maximum, [0, 1]));
    }
    const bytes = Buffer.concat(parts); if (bytes.length > maximum) throw fail('TOO_LARGE', '补丁超过 8 MiB，请分批导出。'); return bytes;
  };
  const bytes = await generate(); if (!bytes.length) throw fail('EMPTY', '所选范围没有可导出的变动。');
  const details = await inspectPatch(reader, bytes, { data: '', encoding: 'base64', target: 'worktree' });
  if (!['commit', 'range'].includes(input.scope)) {
    const before = await fingerprint(cwd, details.paths, reader, runtime, input.scope !== 'staged'); const again = await generate(); const after = await fingerprint(cwd, details.paths, reader, runtime, input.scope !== 'staged');
    if (!bytes.equals(again) || before.fingerprint !== after.fingerprint) throw fail('EXPORT_CHANGED', '导出期间文件或暂存内容已变化，请重新生成并核对。');
  }
  return { data: bytes.toString('base64'), byteLength: bytes.length, sha256: hash(bytes), files: details.files, affectedPaths: details.paths, suggestedName: `astragit-${target ? target.slice(0, 12) : input.scope}.patch`, baseSha: base || (input.scope === 'commit' ? '' : head), targetSha: target };
}

/** Export an actual ordered mailbox, never flatten the selected commits. */
async function exportCommitSeries(cwd: string, input: GitPatchExportInput, runtime: Runtime): Promise<GitRepositoryPatchExport> {
  if ([input.baseRef, input.targetRef].some(value => value !== undefined && (typeof value !== 'string' || value.length > 4096 || value.includes('\0'))) || input.paths !== undefined || input.includeUntracked === true || (input.revisions !== undefined && (!Array.isArray(input.revisions) || !input.revisions.length || input.revisions.length > 2000 || input.revisions.some(ref => typeof ref !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(ref)) || new Set(input.revisions).size !== input.revisions.length))) throw fail('SERIES_INVALID', '请选择有效的提交序列；序列不能只导出部分文件或包含未提交文件。');
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const replacements = () => reader.text(['for-each-ref', '--format=%(refname)%00%(objectname)%00', 'refs/replace']);
  const before = await replacements(); let base = ''; let target = ''; let shas: string[] = [];
  if (input.revisions) {
    const wanted = new Set(input.revisions); let pending = '';
    await reader.run(['rev-list', '--topo-order', '--reverse', '--stdin'], input.revisions.join('\n') + '\n', chunk => {
      pending += chunk.toString('ascii'); let end: number;
      while ((end = pending.indexOf('\n')) >= 0) { const sha = pending.slice(0, end); pending = pending.slice(end + 1); if (wanted.has(sha)) shas.push(sha); }
      if (pending.length > 128) throw fail('SERIES_INVALID', 'Git 返回了不完整的提交顺序。');
    });
    if (pending.trim() || shas.length !== wanted.size) throw fail('SERIES_INVALID', '无法完整读取所选提交及其先后顺序。');
    target = shas.at(-1)!;
  } else {
    base = await reader.revision(input.baseRef ?? ''); target = await reader.revision(input.targetRef ?? 'HEAD');
    if (!base || !target) throw fail('SERIES_INVALID', '请选择有效的起止版本，起始版本本身不包含在序列内。');
    shas = (await reader.text(['rev-list', '--topo-order', '--reverse', '--max-count=2001', `${base}..${target}`, '--'])).trim().split('\n').filter(Boolean);
  }
  if (!shas.length) throw fail('EMPTY', '所选范围没有可导出的提交。');
  if (shas.length > 2000) throw fail('SERIES_TOO_LARGE', '所选序列超过 2000 个提交，请缩小范围。');
  const commits: GitPatchSeriesCommit[] = []; const files: GitPatchFile[] = []; const parts: Buffer[] = []; let size = 0;
  for (const sha of shas) {
    runtime.signal?.throwIfAborted();
    const metadata = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await reader.run(['show', '-s', '--encoding=UTF-8', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B%x00', sha], undefined, undefined, maximum)).split('\0');
    if (metadata.length !== 7 || metadata[0] !== sha) throw fail('SERIES_INVALID', '无法完整读取提交元数据。');
    if (metadata[1]!.split(' ').filter(Boolean).length > 1) throw fail('SERIES_MERGE', '邮箱补丁不能保留合并提交。请改用普通差异补丁，或只选择非合并提交。', sha);
    const entries = parseStats(await reader.run(['diff-tree', '--root', '--no-commit-id', '-r', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', sha, '--']));
    const patch = await reader.run(['format-patch', '--stdout', '--always', '--root', '-1', '--keep-subject', '--format=mboxrd', '--no-numbered', '--no-cover-letter', '--no-thread', '--no-notes', '--no-signature', '--no-base', '--no-add-header', '--add-header=X-AstraGit-Mailbox-Format: mboxrd', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-relative', '--submodule=short', sha, '--'], undefined, undefined, maximum);
    size += patch.length; if (size > maximum) throw fail('TOO_LARGE', '补丁超过 8 MiB，请分批导出。'); parts.push(patch); files.push(...entries);
    commits.push({ sha, author: metadata[2]!, email: metadata[3]!, authoredAt: metadata[4]!, message: metadata[5]!, subject: metadata[5]!.split('\n')[0]!, empty: entries.length === 0 });
  }
  if (before !== await replacements()) throw fail('EXPORT_CHANGED', '导出期间 Git 替代对象发生变化，请重新生成并核对。');
  const bytes = Buffer.concat(parts);
  return { data: bytes.toString('base64'), byteLength: bytes.length, sha256: hash(bytes), files, affectedPaths: [...new Set(files.map(file => file.path))].sort(), suggestedName: `astragit-${commits.length}-commits-${target.slice(0, 12)}.mbox`, baseSha: base, targetSha: target, commits, mailboxFormat: 'mboxrd' };
}
