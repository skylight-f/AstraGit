import { splitGitRemoteBranch } from '@astragit/shared';
import type { ProjectGitRepositorySnapshot } from '../apiClient.js';
import type { PushSelection } from './gitWorkbenchTypes.js';

type BranchDestination = Pick<PushSelection, 'targetBranch' | 'setUpstream'>;
export type BranchPushTarget = Omit<PushSelection, 'repositoryId'>;
export interface PushDestinationDraft {
  remote: string;
  overrides: Partial<Record<string, BranchDestination>>;
}

export function defaultRemote(snapshot: ProjectGitRepositorySnapshot): string {
  const tracked = splitGitRemoteBranch(snapshot.upstream ?? '', snapshot.remotes);
  return tracked?.remote ?? (snapshot.remotes.includes('origin') ? 'origin' : snapshot.remotes[0] ?? '');
}

export function createPushDraft(snapshot: ProjectGitRepositorySnapshot): PushDestinationDraft {
  return { remote: defaultRemote(snapshot), overrides: {} };
}

export function branchPushTarget(draft: PushDestinationDraft, sourceBranch: string): BranchPushTarget {
  // A feature branch can still track its base branch. Publish under its own name by default.
  const destination = draft.overrides[JSON.stringify([draft.remote, sourceBranch])] ?? { targetBranch: sourceBranch, setUpstream: true };
  return { remote: draft.remote, sourceBranch, ...destination };
}

export function changePushDestination(draft: PushDestinationDraft, sourceBranch: string, destination: BranchDestination): PushDestinationDraft {
  return { ...draft, overrides: { ...draft.overrides, [JSON.stringify([draft.remote, sourceBranch])]: destination } };
}
