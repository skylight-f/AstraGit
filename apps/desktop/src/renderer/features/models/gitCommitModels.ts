import type { GitApiClient } from '../git/api/gitApiClient.js';

export type GitCommitModelsClient = Pick<GitApiClient, 'loadGitCommitModels'>;

const disabledCodexModelsKey = 'astragit.codex.disabled-models.v1';

export function watchModelCatalog(refresh: () => void): () => void {
  const refreshVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  const timer = window.setInterval(refreshVisible, 60_000);
  window.addEventListener('focus', refreshVisible);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', refreshVisible);
  };
}

export function readDisabledCodexModels(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(disabledCodexModelsKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && id.startsWith('codex:')) : [];
  } catch { return []; }
}

export function saveDisabledCodexModels(ids: readonly string[]): void {
  localStorage.setItem(disabledCodexModelsKey, JSON.stringify(ids));
}

/** 两个提交入口共用模型偏好，未选择时使用最近一次记住的提交模型。 */
export async function loadGitCommitModelOptions(client: GitCommitModelsClient, projectId: string) {
  const models = await client.loadGitCommitModels(projectId);
  const disabledCodex = new Set(readDisabledCodexModels());
  const items = models.items.filter(model => !disabledCodex.has(model.id));
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(`astragit.commit-model.${projectId}`);
  } catch {
    /* 偏好不可用时退回第一个可用模型。 */
  }
  const preferred = items.find((model) => model.id === remembered)?.id;
  return { ...models, items, modelRef: preferred ?? items[0]?.id ?? '' };
}
