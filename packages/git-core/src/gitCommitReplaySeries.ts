import { createHash } from 'node:crypto';
import { GitHistoryReader } from './gitFileHistory.js';
import { getProjectGitCommitReplayPreview } from './index.js';
import { gitCommitReplayFailure as fail } from './gitCommitReplay.js';

export interface GitCommitReplaySeriesInput {
  revisions: string[];
  mainline?: number;
  commit: boolean;
  includeSourceId: boolean;
}
export interface GitCommitReplaySeriesPreview {
  input: GitCommitReplaySeriesInput;
  commits: Array<{ sha: string; subject: string; parentCount: number }>;
  hasMerges: boolean;
  maximumMainline: number;
  files: string[];
  fileCount: number;
  fingerprint: string;
  headSha: string;
  branch: string;
  detached: boolean;
  localChangeCount: number;
  stagedFileCount: number;
}

export function parseGitCommitReplaySeriesInput(input: unknown): GitCommitReplaySeriesInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID', '批量拣选选项无效。');
  const value = input as Record<string, unknown>;
  const { revisions, mainline } = value; const commit = value.commit === undefined ? true : value.commit; const includeSourceId = value.includeSourceId === undefined ? false : value.includeSourceId;
  if (Object.keys(value).some(key => !['revisions', 'mainline', 'commit', 'includeSourceId'].includes(key)) || !Array.isArray(revisions) || revisions.length < 2 || revisions.length > 200 || revisions.some(sha => typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sha)) || new Set(revisions).size !== revisions.length || typeof commit !== 'boolean' || typeof includeSourceId !== 'boolean' || includeSourceId && !commit || mainline !== undefined && (!Number.isSafeInteger(mainline) || (mainline as number) < 1)) throw fail('INVALID', '请选择 2–200 个不同的固定提交，并核对父级及提交选项。');
  return { revisions: revisions as string[], ...(mainline !== undefined ? { mainline: mainline as number } : {}), commit, includeSourceId };
}

/** Selected commits only, ordered by ancestry; omitted intermediate commits are never applied. */
export async function readGitCommitReplaySeriesPreview(cwd: string, value: unknown, runtime: { signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<GitCommitReplaySeriesPreview> {
  const input = parseGitCommitReplaySeriesInput(value); const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const wanted = new Set(input.revisions); const ordered: string[] = []; let pending = '';
  await reader.run(['rev-list', '--topo-order', '--reverse', '--stdin'], [...input.revisions].sort().join('\n') + '\n', chunk => {
    pending += chunk.toString('ascii'); let end: number;
    while ((end = pending.indexOf('\n')) >= 0) { const sha = pending.slice(0, end); pending = pending.slice(end + 1); if (wanted.has(sha)) ordered.push(sha); }
    if (pending.length > 128) throw fail('INVALID', '无法完整读取所选提交的先后顺序。');
  });
  if (pending.trim() || ordered.length !== wanted.size) throw fail('INVALID', '无法完整读取所选提交，请刷新历史后重新选择。');
  const parents = new Array<string[]>(ordered.length); let parentIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, ordered.length) }, async () => {
    while (parentIndex < ordered.length) { const index = parentIndex++; parents[index] = (await reader.text(['show', '-s', '--format=%P', ordered[index]!, '--'])).trim().split(/\s+/u).filter(Boolean); }
  }));
  const hasMerges = parents.some(list => list.length > 1); const mainline = input.mainline ?? (hasMerges ? 1 : undefined);
  // Native cherry-pick accepts one mainline option for the entire sequence.
  const maximumMainline = Math.min(...parents.filter(list => list.length > 0).map(list => list.length));
  if (mainline !== undefined && mainline > maximumMainline) throw fail('PARENT_INVALID', '批量拣选使用相同的父级序号；部分所选提交没有该父级，请调整选择或分别拣选。');
  const normalized = { revisions: ordered, ...(mainline !== undefined ? { mainline } : {}), commit: input.commit, includeSourceId: input.includeSourceId };
  const previews = new Array<Awaited<ReturnType<typeof getProjectGitCommitReplayPreview>>>(ordered.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ordered.length) }, async () => {
    while (next < ordered.length) {
      runtime.signal?.throwIfAborted(); const index = next++;
      previews[index] = await getProjectGitCommitReplayPreview(cwd, { kind: 'cherry_pick', revision: ordered[index]!, ...(parents[index]!.length > 1 ? { mainline } : {}), commit: input.commit, includeSourceId: input.includeSourceId }, runtime.signal, true);
      if (JSON.stringify(previews[index]!.parents.map(parent => parent.hash)) !== JSON.stringify(parents[index])) throw fail('PREVIEW_CHANGED', '读取期间提交父级发生变化，请重新核对。');
    }
  }));
  const first = previews[0]!;
  if (previews.some(preview => preview.headSha !== first.headSha || preview.branch !== first.branch || preview.detached !== first.detached)) throw fail('PREVIEW_CHANGED', '批量读取期间目标已变化，请重新核对。');
  const paths = new Set<string>();
  for (const preview of previews) for (const file of preview.files) paths.add(file.path);
  const files = [...paths].sort();
  return { input: normalized, commits: previews.map(preview => ({ sha: preview.sourceSha, subject: preview.sourceSubject, parentCount: preview.parents.length })), hasMerges, maximumMainline: Number.isFinite(maximumMainline) ? maximumMainline : 1, files, fileCount: files.length, fingerprint: createHash('sha256').update(JSON.stringify([normalized, previews.map(preview => preview.fingerprint)])).digest('hex'), headSha: first.headSha, branch: first.branch, detached: first.detached, localChangeCount: first.localChangeCount, stagedFileCount: first.stagedFileCount };
}

export function gitCommitReplaySeriesArguments(preview: GitCommitReplaySeriesPreview) {
  return ['cherry-pick', ...(preview.input.commit ? ['--no-edit'] : ['--no-commit']), ...(preview.input.mainline !== undefined ? ['--mainline', String(preview.input.mainline)] : []), ...(preview.input.includeSourceId ? ['-x'] : []), '--stdin'];
}
