import { splitGitRemoteBranch } from '@astragit/shared';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositorySnapshot } from '../apiClient.js';

export type CommitPushTarget = { remote: string; sourceBranch: string; targetBranch: string; setUpstream: boolean };
type ActionResponse = Awaited<ReturnType<DashboardClient['executeProjectGitAction']>>;

export function commitPushTarget(snapshot: ProjectGitRepositorySnapshot): CommitPushTarget | null {
  if (snapshot.detached || !snapshot.branch || snapshot.branch === 'HEAD') return null;
  // Use the tracked destination, including differently named branches and remotes containing '/'.
  if (snapshot.upstream) {
    const tracked = splitGitRemoteBranch(snapshot.upstream, snapshot.remotes);
    return tracked ? { remote: tracked.remote, sourceBranch: snapshot.branch, targetBranch: tracked.branch, setUpstream: false } : null;
  }
  const remote = snapshot.remotes.includes('origin') ? 'origin' : snapshot.remotes.length === 1 ? snapshot.remotes[0] : null;
  return remote ? { remote, sourceBranch: snapshot.branch, targetBranch: snapshot.branch, setUpstream: true } : null;
}

/** One user action, two native operations: a failed push must never repeat the commit. */
export async function commitThenPush(input: {
  snapshot: ProjectGitRepositorySnapshot;
  message: string;
  target: CommitPushTarget;
  execute: (action: ProjectGitAction) => Promise<ActionResponse>;
  onCommitted: (response: ActionResponse) => void;
  onPushing: (action: Extract<ProjectGitAction, { type: 'push' }>) => void;
}): Promise<ActionResponse> {
  const { snapshot, target } = input;
  const committed = await input.execute({ type: 'commit', message: input.message, expectedHeadSha: snapshot.headSha, expectedBranch: target.sourceBranch });
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
