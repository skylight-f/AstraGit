import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import { parseGitUnifiedDiff } from './gitUnifiedDiff.js';
import { userFacingErrorCause } from '@astragit/shared';
import type { GitDiffSummary, GitStatusSummary } from './index.js';

type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv };
export type GitDiffUnavailableReason = 'too_large' | 'too_many_files' | 'read_failed' | 'timeout' | 'encoding' | 'unsupported_files' | 'conflicts';
const maximumBytes = 10 * 1024 * 1024;
const maximumLines = 150_000;
const maximumUntracked = 200;
const failure = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message), { code, operationStage: 'read', ...(cause ? { cause } : {}) });

/** The renderer parses a standard patch; user diff formatting must not change its grammar. */
export const gitDisplayDiffOptions = [
  '--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '--find-renames',
  '--unified=3', '--inter-hunk-context=0',
  '--output-indicator-new=+', '--output-indicator-old=-', '--output-indicator-context= ',
  '--submodule=short', '--ignore-submodules=none',
];
// -U enables patch output even with --numstat; metadata must not inherit it.
export const gitDisplayDiffMetadataOptions = gitDisplayDiffOptions.filter(option => !option.startsWith('--unified=') && !option.startsWith('--inter-hunk-context='));
// stash show copies/reparses its diff argv. Avoid string-prefix arguments there:
// native Git can emit an unstable line prefix. Configuration preserves standard
// paths without passing borrowed prefix strings through stash's argument parser.
export const gitDisplayDiffConfig = ['-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.srcPrefix=a/', '-c', 'diff.dstPrefix=b/', '-c', 'diff.suppressBlankEmpty=false'];

export function gitDiffReader(cwd: string, runtime: Runtime = {}, indexFile?: string) {
  return new GitHistoryReader(cwd, { ...runtime, env: { ...runtime.env, GIT_DIFF_OPTS: undefined, GIT_EXTERNAL_DIFF: undefined } }, indexFile);
}

export function decodeGitDiffRead(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (cause) { throw failure('ASTRAGIT_GIT_DIFF_ENCODING', '差异或文件名不是有效的 UTF-8，无法完整显示。', cause); }
}

export async function readGitDiffMetadata(reader: GitHistoryReader, args: string[]): Promise<string> {
  try { return decodeGitDiffRead(await reader.run([...gitDisplayDiffConfig, ...args])); }
  catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === 'ASTRAGIT_CANCELLED' || code === 'ASTRAGIT_GIT_DIFF_ENCODING') throw cause;
    throw failure(code === 'ASTRAGIT_GIT_FILE_HISTORY_TOO_LARGE' ? 'ASTRAGIT_GIT_DIFF_TOO_LARGE' : code === 'ASTRAGIT_GIT_FILE_HISTORY_TIMEOUT' ? 'ASTRAGIT_GIT_DIFF_TIMEOUT' : 'ASTRAGIT_GIT_DIFF_READ_FAILED', '无法完整读取 Git 差异清单，请重新载入并查看 Git 详情。', cause);
  }
}

export function unavailableGitDiff(files: string[], unavailableReason: GitDiffUnavailableReason, error?: unknown): GitDiffSummary {
  return { isRepository: true, files: [...new Set(files)], diffText: '', fileDiffs: [], unavailableReason,
    ...(error ? { readError: userFacingErrorCause(failure('ASTRAGIT_GIT_DIFF_READ_FAILED', '未能完整读取 Git 差异，请查看 Git 详情。', error)) } : {}),
  };
}

function reasonForError(error: unknown): GitDiffUnavailableReason {
  switch ((error as { code?: string }).code) {
    case 'ASTRAGIT_GIT_FILE_HISTORY_TOO_LARGE': case 'ASTRAGIT_GIT_DIFF_TOO_LARGE': return 'too_large';
    case 'ASTRAGIT_GIT_FILE_HISTORY_TIMEOUT': case 'ASTRAGIT_GIT_DIFF_TIMEOUT': return 'timeout';
    case 'ASTRAGIT_GIT_DIFF_ENCODING': return 'encoding';
    default: return 'read_failed';
  }
}

function parseDisplayDiff(text: string, files: string[]): GitDiffSummary {
  if (Buffer.byteLength(text) > maximumBytes || text.split('\n').length > maximumLines) return unavailableGitDiff(files, 'too_large');
  // Unmerged/combined patches need the conflict editor, not ordinary hunk actions.
  if (/^(?:diff --(?:cc|combined) |\* Unmerged path )/mu.test(text)) return unavailableGitDiff(files, 'conflicts');
  const fileDiffs = parseGitUnifiedDiff(text);
  const parsed = new Set(fileDiffs.map(file => file.newPath || file.oldPath));
  const expected = new Set(files);
  const missing = files.filter(path => !parsed.has(path));
  const unexpected = [...parsed].filter(path => !expected.has(path));
  if (missing.length || unexpected.length) throw Object.assign(failure('ASTRAGIT_GIT_DIFF_READ_FAILED', 'Git 补丁与变更文件清单不一致，请重新读取。'), { details: `Missing patch paths: ${JSON.stringify(missing.slice(0, 200))}\nUnexpected patch paths: ${JSON.stringify(unexpected.slice(0, 200))}\nReturned diff headers: ${JSON.stringify(text.split('\n').filter(line => line.startsWith('diff ')).slice(0, 200))}` });
  return { isRepository: true, files: [...new Set(files)], diffText: text, fileDiffs };
}

/** No partial stdout is usable, even if it contains a syntactically valid first hunk. */
export async function readGitDisplayDiff(reader: GitHistoryReader, args: string[], files: string[], noIndex = false): Promise<GitDiffSummary> {
  try { return parseDisplayDiff(decodeGitDiffRead(await reader.run([...gitDisplayDiffConfig, ...args], undefined, undefined, maximumBytes, noIndex ? [0, 1] : [0])), files); }
  catch (error) {
    if ((error as { code?: string }).code === 'ASTRAGIT_CANCELLED' || reader.runtime.signal?.aborted) throw error;
    return unavailableGitDiff(files, reasonForError(error), error);
  }
}

export function combineGitDisplayDiffs(parts: GitDiffSummary[], files: string[]): GitDiffSummary {
  const unavailable = parts.find(part => part.unavailableReason);
  if (unavailable?.unavailableReason) return { ...unavailable, files: [...new Set(files)] };
  try { return parseDisplayDiff(parts.map(part => part.diffText).filter(Boolean).join('\n'), files); }
  catch (error) { return unavailableGitDiff(files, reasonForError(error), error); }
}

/** Workspace snapshots keep usable status/metadata even when the patch is unavailable. */
export async function readWorkspaceGitDiffs(cwd: string, parseStatus: (text: string) => Pick<GitStatusSummary, 'fileStatuses'>, runtime: Runtime = {}) {
  let reader = gitDiffReader(cwd, runtime);
  let root: string;
  try { root = (await reader.text(['rev-parse', '--show-toplevel'])).replace(/\r?\n$/u, ''); }
  catch (error) {
    if (runtime.signal?.aborted || (error as { code?: string }).code === 'ASTRAGIT_CANCELLED') throw error;
    if ((error as { exitCode?: number }).exitCode === 128 && /^fatal: (?:not a git repository|this operation must be run in a work tree)/mu.test((error as { stderr?: string }).stderr ?? '')) return null;
    throw failure('ASTRAGIT_GIT_DIFF_READ_FAILED', '无法读取仓库位置，请检查目录权限及 Git 详情。', error);
  }
  reader = gitDiffReader(root, runtime);
  const [unstagedNames, stagedNames, porcelain] = await Promise.all([
    readGitDiffMetadata(reader, ['diff', ...gitDisplayDiffMetadataOptions, '--name-only', '-z', '--', '.']),
    readGitDiffMetadata(reader, ['diff', ...gitDisplayDiffMetadataOptions, '--cached', '--name-only', '-z', '--', '.']),
    readGitDiffMetadata(reader, ['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none']),
  ]);
  const untracked = parseStatus(porcelain).fileStatuses.filter(file => file.indexStatus === '?').map(file => file.path);
  const unstagedFiles = unstagedNames.split('\0').filter(Boolean);
  const stagedFiles = stagedNames.split('\0').filter(Boolean);
  const files = [...new Set([...unstagedFiles, ...stagedFiles, ...untracked])];
  const [unstaged, staged] = await Promise.all([
    readGitDisplayDiff(reader, ['diff', ...gitDisplayDiffOptions, '--', '.'], unstagedFiles),
    readGitDisplayDiff(reader, ['diff', ...gitDisplayDiffOptions, '--cached', '--', '.'], stagedFiles),
  ]);
  const parts: Array<{ stage: NonNullable<GitDiffSummary['fileDiffs'][number]['stage']>; diff: GitDiffSummary }> = [{ stage: 'unstaged', diff: unstaged }, { stage: 'staged', diff: staged }];
  if (untracked.length > maximumUntracked) parts.push({ stage: 'untracked', diff: unavailableGitDiff(untracked, 'too_many_files') });
  else if (!parts.some(part => part.diff.unavailableReason)) {
    let bytes = parts.reduce((sum, part) => sum + Buffer.byteLength(part.diff.diffText), 0);
    for (const path of untracked) {
      runtime.signal?.throwIfAborted();
      try {
        // Embedded repositories are directory status entries, not ordinary untracked files.
        const entry = await lstat(join(root, path));
        if (!entry.isFile() && !entry.isSymbolicLink()) { parts.push({ stage: 'untracked', diff: unavailableGitDiff(untracked, 'unsupported_files') }); break; }
        const diff = await readGitDisplayDiff(reader, ['diff', ...gitDisplayDiffOptions, '--no-index', '--', '/dev/null', path], [path], true);
        parts.push({ stage: 'untracked', diff }); bytes += Buffer.byteLength(diff.diffText);
        if (diff.unavailableReason) break;
        if (bytes > maximumBytes) { parts.push({ stage: 'untracked', diff: unavailableGitDiff(untracked, 'too_large') }); break; }
      } catch (error) {
        if (runtime.signal?.aborted) throw error;
        parts.push({ stage: 'untracked', diff: unavailableGitDiff(untracked, reasonForError(error), error) }); break;
      }
    }
  }
  const diff = combineGitDisplayDiffs(parts.map(part => part.diff), files);
  if (!diff.unavailableReason) diff.fileDiffs = parts.flatMap(part => part.diff.fileDiffs.map(file => ({ ...file, stage: part.stage })));
  return { diff, stagedDiff: staged, unstagedDiff: unstaged };
}
