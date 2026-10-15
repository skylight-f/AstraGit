import type { DashboardClient, GitCommitSelectionPreview } from '../apiClient.js';
import type { SourceBatchResult, SourceCommitUnit } from './sourceGitState.js';

export interface SourceReviewRow extends SourceBatchResult {
  relativePath: string; ordinaryPaths: string[]; gitlinks: SourceCommitUnit['gitlinks'];
  fingerprint?: string; remotes: string[]; detached: boolean;
}
type BatchClient = Pick<DashboardClient, 'previewGitCommitSelection' | 'loadProjectGitWorkbench' | 'executeProjectGitAction' | 'validateGitPushTargets'>;
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export async function validateSourceReview(client: BatchClient, projectId: string, rows: SourceReviewRow[], push: boolean) {
  if (!rows.length || rows.length > 20 || rows.reduce((sum, row) => sum + row.paths.length, 0) > 2000) throw new Error('请选择 1–20 个仓库、最多 2000 个文件。');
  if (rows.some(row => !row.message.trim())) throw new Error('请填写每个仓库的提交说明。');
  const ordinary = rows.filter(row => row.ordinaryPaths.length);
  const previews = ordinary.length ? (await client.previewGitCommitSelection(projectId, ordinary.map(row => ({ repositoryId: row.repositoryId, relativePath: row.relativePath, paths: row.ordinaryPaths })), rows[0]!.mode)).repositories : [];
  const snapshot = await client.loadProjectGitWorkbench(projectId);
  for (const row of rows) {
    const repository = snapshot.repositories.find(repo => repo.id === row.repositoryId);
    const preview = previews.find(repo => repo.repositoryId === row.repositoryId);
    if (!repository || repository.snapshot.headSha !== row.expectedHead || repository.snapshot.branch !== row.branch || repository.snapshot.conflictFiles.length || repository.snapshot.integrationState || (row.fingerprint && preview?.fingerprint !== row.fingerprint)) throw new Error(`${row.repositoryName} 的内容或分支已变化，请重新预览。`);
  }
  if (push) await client.validateGitPushTargets(projectId, rows.map(row => ({ repositoryId: row.repositoryId, relativePath: row.relativePath, remote: row.remote, sourceBranch: row.branch, targetBranch: row.targetBranch })));
}

/** 每仓库独立提交；先完成子模块，再提交父仓库引用。已完成提交只重试推送。 */
export async function runSourceBatch(input: {
  client: BatchClient; projectId: string; rows: SourceReviewRow[]; push: boolean;
  stopped: () => boolean; onResults: (results: SourceBatchResult[]) => void;
  onActive: (repositoryId: string | null) => void; onCommitted: (row: SourceReviewRow) => void;
}) {
  const { client, projectId, rows } = input;
  let results: SourceBatchResult[] = rows.map(row => ({ ...row, status: 'queued', pushRequested: input.push }));
  const update = (id: string, patch: Partial<SourceBatchResult>) => { results = results.map(row => row.repositoryId === id ? { ...row, ...patch } : row); input.onResults(results); };
  input.onResults(results);
  try {
    for (const row of rows) {
      if (input.stopped() || row.dependsOn.some(id => !results.find(result => result.repositoryId === id)?.commitSha)) {
        update(row.repositoryId, { status: 'blocked', error: input.stopped() ? '批次已停止，保留未提交文件。' : '子模块尚未成功提交。' }); continue;
      }
      input.onActive(row.repositoryId); update(row.repositoryId, { status: 'committing' });
      try {
        let fingerprint = row.fingerprint;
        if (row.gitlinks.length) {
          const current = await client.loadProjectGitWorkbench(projectId);
          const parent = current.repositories.find(repo => repo.id === row.repositoryId);
          if (parent?.snapshot.headSha !== row.expectedHead || parent.snapshot.branch !== row.branch) throw new Error('父仓库分支或提交已变化，请重新预览。');
          for (const link of row.gitlinks) {
            const child = current.repositories.find(repo => repo.id === link.repositoryId);
            if (child?.snapshot.headSha !== results.find(result => result.repositoryId === link.repositoryId)?.commitSha) throw new Error('子模块提交已变化，请重新预览引用。');
          }
          if (row.ordinaryPaths.length) {
            const ordinary = await client.previewGitCommitSelection(projectId, [{ repositoryId: row.repositoryId, relativePath: row.relativePath, paths: row.ordinaryPaths }], row.mode);
            if (ordinary.repositories[0]?.fingerprint !== row.fingerprint) throw new Error('父仓库所选文件已变化，请重新预览。');
          }
          const preview = await client.previewGitCommitSelection(projectId, [{ repositoryId: row.repositoryId, relativePath: row.relativePath, paths: row.paths }], row.mode);
          fingerprint = preview.repositories[0]?.fingerprint;
        }
        if (!fingerprint) throw new Error('提交内容无法核对，请重新预览。');
        const result = await client.executeProjectGitAction(projectId, row.repositoryId, { type: 'commit', paths: row.paths, selectionMode: row.mode, message: row.message, expectedFingerprint: fingerprint, expectedHeadSha: row.expectedHead, expectedBranch: row.branch });
        update(row.repositoryId, { status: 'committed', commitSha: result.result.headSha }); input.onCommitted(row);
      } catch (error) {
        let status: SourceBatchResult['status'] = 'unknown';
        try { const current = await client.loadProjectGitWorkbench(projectId); if (current.repositories.find(repo => repo.id === row.repositoryId)?.snapshot.headSha === row.expectedHead) status = 'commit_failed'; } catch { /* 无法核对写入结果时禁止自动重复提交。 */ }
        update(row.repositoryId, { status, error: message(error) + (status === 'unknown' ? ' 请到工作台核对提交和操作记录。' : '') });
      }
    }
    if (input.push) {
      for (const row of rows) {
        const result = results.find(result => result.repositoryId === row.repositoryId)!;
        if (!result.commitSha) continue;
        if (input.stopped() || row.dependsOn.some(id => results.find(result => result.repositoryId === id)?.status !== 'done')) {
          update(row.repositoryId, { status: 'push_blocked', error: input.stopped() ? '已提交，推送已停止。' : '子模块推送未完成，暂缓父仓库推送。' }); continue;
        }
        input.onActive(row.repositoryId); update(row.repositoryId, { status: 'pushing' });
        try {
          await pushSourceResult(client, projectId, result);
          update(row.repositoryId, { status: 'done', error: undefined });
        } catch (error) { update(row.repositoryId, { status: 'push_failed', error: message(error) }); }
      }
    }
  } finally { input.onActive(null); }
  return results;
}
export async function pushSourceResult(client: Pick<BatchClient, 'executeProjectGitAction'>, projectId: string, row: SourceBatchResult) {
  if (!row.commitSha || !row.remote || !row.targetBranch) throw new Error('没有可重试的提交或推送目标。');
  await client.executeProjectGitAction(projectId, row.repositoryId, { type: 'push', remote: row.remote, sourceBranch: row.branch, targetBranch: row.targetBranch, expectedHeadSha: row.commitSha, expectedBranch: row.branch });
}
export function previewForUnit(unit: SourceCommitUnit, preview: GitCommitSelectionPreview | null) {
  return preview?.repositories.find(repository => repository.repositoryId === unit.repository.id);
}
