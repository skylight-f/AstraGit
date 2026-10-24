import { useEffect, useState } from 'react';
import type { DashboardClient, GitRevisionComparison, ProjectGitCommitDetail } from '../apiClient.js';

/** A parent choice belongs to one immutable merge, never the next selected row. */
export function useGitCommitParentComparison(input: {
  projectId: string;
  repositoryId?: string;
  detail: ProjectGitCommitDetail | null;
  client: Pick<DashboardClient, 'loadProjectGitRevisionsDiff'>;
}) {
  const scope = JSON.stringify([input.projectId, input.repositoryId, input.detail?.commit.hash]);
  const parents = input.detail?.parentHashes ?? [];
  const [choice, setChoice] = useState<{ scope: string; parent: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const parent = choice?.scope === scope && parents.includes(choice.parent) ? choice.parent : parents[0] ?? '';
  const alternate = parents.length > 1 && parent !== parents[0];
  const key = JSON.stringify([scope, parent, revision]);
  const [state, setState] = useState<{ key: string; comparison?: GitRevisionComparison; error?: unknown } | null>(null);
  const current = state?.key === key ? state : null;
  const commit = input.detail?.commit.hash;
  useEffect(() => {
    if (!alternate || !input.repositoryId || !commit) return;
    const controller = new AbortController();
    void input.client.loadProjectGitRevisionsDiff(input.projectId, input.repositoryId, [parent, commit], controller.signal)
      .then(comparison => { if (!controller.signal.aborted) setState({ key, comparison }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error }); });
    return () => controller.abort();
  }, [input.client, input.projectId, input.repositoryId, commit, parent, alternate, key]);
  const detail = alternate && input.detail ? {
    ...input.detail,
    files: current?.comparison?.files ?? [],
    diff: current?.comparison ? { ...current.comparison.diff, comparisonParent: parent } : { isRepository: true, files: [], diffText: '', fileDiffs: [] },
  } : input.detail;
  return {
    detail,
    parent,
    isMerge: parents.length > 1,
    loading: alternate && !current,
    error: alternate ? current?.error : undefined,
    select(parent: string) { if (parents.includes(parent)) setChoice({ scope, parent }); },
    reload() { setRevision(value => value + 1); },
  };
}
