import type { DashboardClient } from '../../../api/apiClient.js';
import type { SourceCommitUnit } from '../changes/sourceGitState.js';
import { batchDraftScope, batchSummaryId, repositoryDraftScope, type CommitDraft } from './useGitCommitDrafts.js';

export async function generateStagedCommitDrafts(input: {
  client: Pick<DashboardClient, 'generateGitCommitMessage'>;
  projectId: string; units: SourceCommitUnit[]; summary: boolean;
  drafts: Record<string, CommitDraft>; language: 'zh-CN' | 'en'; model: string;
  signal: AbortSignal; onText: (text: string) => void;
}) {
  const { units, summary, drafts, signal } = input;
  if (!units.length || (!summary && units.length !== 1)) throw new Error('请选择要生成说明的仓库。');
  async function generate(targets: SourceCommitUnit[], onText?: (text: string) => void) {
    signal.throwIfAborted();
    const repository = targets[0]!.repository;
    const selection = targets.filter(unit => unit.ordinaryPaths.length).map(unit => ({
      repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths,
    }));
    const links = targets.flatMap(unit => unit.gitlinks.map(link => `${unit.repository.name}/${link.path}`));
    const references = links.length ? `${input.language === 'zh-CN' ? '更新子模块引用' : 'Update submodule references'}: ${links.join(', ')}` : '';
    const result = selection.length ? await input.client.generateGitCommitMessage(input.projectId, {
      repositoryId: repository.id, relativePath: repository.relativePath,
      ...(targets.length > 1 || links.length ? { selection } : {}),
      selectionMode: 'staged', language: input.language, modelRef: input.model,
    }, onText, signal) : null;
    signal.throwIfAborted();
    return { message: result ? [result.message, references].filter(Boolean).join('\n\n') : `chore(deps): ${references}`, truncated: result?.truncated === true };
  }
  const first = units[0]!;
  const id = summary ? batchSummaryId : first.repository.id;
  const result = await generate(units, input.onText);
  const scope = summary ? batchDraftScope(units) : repositoryDraftScope(first.repository.snapshot, first.gitlinks);
  const messages = [{ id, message: result.message, scope, expected: drafts[id]?.message ?? '' }];
  let truncated = result.truncated;
  if (summary) {
    for (const unit of units) {
      if (drafts[unit.repository.id]?.message) continue;
      const individual = units.length === 1 ? result : await generate([unit]);
      messages.push({ id: unit.repository.id, message: individual.message, scope: repositoryDraftScope(unit.repository.snapshot, unit.gitlinks), expected: '' });
      truncated ||= individual.truncated;
    }
  }
  return { messages, truncated };
}
