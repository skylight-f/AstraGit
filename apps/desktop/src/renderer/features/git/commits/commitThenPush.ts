import { branchPushTarget, createPushDraft, type BranchPushTarget } from '../repository/pushTarget.js';
import type { DashboardClient, GitCommitOptions, ProjectGitAction, ProjectGitRepositorySnapshot } from '../../../api/apiClient.js';

export type CommitPushTarget = BranchPushTarget;
type ActionResponse = Awaited<ReturnType<DashboardClient['executeProjectGitAction']>>;

export function commitPushTarget(snapshot: ProjectGitRepositorySnapshot): CommitPushTarget | null {
  if (snapshot.detached || !snapshot.branch || snapshot.branch === 'HEAD' || !snapshot.remotes.length) return null;
  return branchPushTarget(createPushDraft(snapshot), snapshot.branch);
}

/** One user action, two native operations: a failed push must never repeat the commit. */
export async function commitThenPush(input: {
  snapshot: ProjectGitRepositorySnapshot;
  message: string;
  options?: GitCommitOptions;
  target: CommitPushTarget;
  execute: (action: ProjectGitAction) => Promise<ActionResponse>;
  onCommitted: (response: ActionResponse) => void;
  onPushing: (action: Extract<ProjectGitAction, { type: 'push' }>) => void;
}): Promise<ActionResponse> {
  const { snapshot, target } = input;
  const committed = await input.execute({ type: 'commit', message: input.message, ...(input.options ? { options: input.options } : {}), expectedHeadSha: snapshot.headSha, expectedBranch: target.sourceBranch });
  if (committed.result.outcome !== 'completed') return committed;
  input.onCommitted(committed);
  const push: Extract<ProjectGitAction, { type: 'push' }> = {
    type: 'push', ...target, expectedBranch: target.sourceBranch, expectedHeadSha: committed.result.headSha,
  };
  input.onPushing(push);
  // A hook or external operation may have moved HEAD; do not publish a different branch.
  if (!committed.result.headSha || committed.result.branch !== target.sourceBranch || committed.snapshot.detached || committed.snapshot.branch !== target.sourceBranch || committed.snapshot.headSha !== committed.result.headSha) {
    throw Object.assign(new Error('Repository changed after commit; refresh before pushing.'), { code: 'ASTRAGIT_GIT_SELECTION_CHANGED' });
  }
  return input.execute(push);
}
