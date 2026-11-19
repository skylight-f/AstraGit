import { useEffect, useMemo, useState } from 'react';
import { loadGitCommitModelOptions, type GitCommitModelsClient } from './gitCommitModels.js';

type ModelOptions = Pick<Awaited<ReturnType<typeof loadGitCommitModelOptions>>, 'items' | 'modelRef'>;

const emptyOptions: ModelOptions = { items: [], modelRef: '' };

export type GitCommitModelState = ReturnType<typeof useGitCommitModels>;

export function useGitCommitModels(client: GitCommitModelsClient, projectId: string | undefined, settingsRevision: number) {
  const [refreshRevision, setRefreshRevision] = useState(0);
  const request = useMemo(() => ({ client, projectId, settingsRevision, refreshRevision }), [client, projectId, settingsRevision, refreshRevision]);
  const [result, setResult] = useState<{ request: typeof request; options: ModelOptions }>();

  useEffect(() => {
    if (!request.projectId) return;
    let live = true;
    void loadGitCommitModelOptions(request.client, request.projectId)
      .then(({ items, modelRef }) => {
        if (live) setResult({ request, options: { items, modelRef } });
      })
      .catch(() => { if (live) setResult({ request, options: emptyOptions }); });
    return () => { live = false; };
  }, [request]);

  const options = result?.request === request ? result.options : emptyOptions;
  function selectModel(modelRef: string) {
    if (!projectId || !options.items.some(item => item.id === modelRef)) return;
    setResult({ request, options: { ...options, modelRef } });
    try { localStorage.setItem(`astragit.commit-model.${projectId}`, modelRef); } catch { return; }
  }

  return {
    ...options,
    loading: Boolean(projectId) && result?.request !== request,
    selectModel,
    refresh: () => setRefreshRevision(current => current + 1),
  };
}
