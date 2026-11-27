import type { GitFileStatusSummary, ProjectGitRepositoryWorkbenchItem, ProjectGitWorkbenchSnapshot } from '../../../api/apiClient.js';

export interface ProjectGitQueryClient {
  loadProjectGitWorkbench(projectId: string): Promise<ProjectGitWorkbenchSnapshot>;
}

interface ProjectGitWorkbenchCacheEntry {
  snapshot: ProjectGitWorkbenchSnapshot | null;
  request: Promise<ProjectGitWorkbenchSnapshot> | null;
}

const projectGitWorkbenchCacheLimit = 12;
const projectGitWorkbenchDiffTextBudget = 16 * 1024 * 1024;
const projectGitWorkbenchCache = new WeakMap<ProjectGitQueryClient, Map<string, ProjectGitWorkbenchCacheEntry>>();

export function projectGitWorkbenchCacheEntry(client: ProjectGitQueryClient, projectId: string): ProjectGitWorkbenchCacheEntry {
  let projectCache = projectGitWorkbenchCache.get(client);
  if (!projectCache) {
    projectCache = new Map();
    projectGitWorkbenchCache.set(client, projectCache);
  }
  const current = projectCache.get(projectId) ?? { snapshot: null, request: null };
  projectCache.delete(projectId);
  projectCache.set(projectId, current);

  // 多开项目时保留最近的快照，同时限制差异文本占用，正在读取的请求继续复用。
  let retained = 0;
  let diffTextLength = 0;
  for (const [id, entry] of [...projectCache].reverse()) {
    const length = entry.snapshot?.repositories.reduce((sum, { snapshot }) => (
      sum + snapshot.diff.diffText.length + snapshot.stagedDiff.diffText.length + snapshot.unstagedDiff.diffText.length
    ), 0) ?? 0;
    if (id !== projectId && !entry.request && (retained >= projectGitWorkbenchCacheLimit || (length > 0 && diffTextLength + length > projectGitWorkbenchDiffTextBudget))) {
      projectCache.delete(id);
      continue;
    }
    retained += 1;
    diffTextLength += length;
  }
  return current;
}

export function readCachedProjectGitWorkbench(client: ProjectGitQueryClient, projectId: string): ProjectGitWorkbenchSnapshot | null {
  return projectGitWorkbenchCacheEntry(client, projectId).snapshot;
}

export function requestProjectGitWorkbench(client: ProjectGitQueryClient, projectId: string): Promise<ProjectGitWorkbenchSnapshot> {
  const entry = projectGitWorkbenchCacheEntry(client, projectId);
  if (entry.request) return entry.request;
  const request = client
    .loadProjectGitWorkbench(projectId)
    .then((snapshot) => {
      if (entry.request === request) entry.snapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      if (entry.request === request) entry.request = null;
    });
  entry.request = request;
  return request;
}

/** 两个工作入口共享失效通知；外部文件变更按短窗口合并，避免频繁闪空列表。 */
export function subscribeProjectGitRefresh(projectId: string, refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 250);
  };
  const changed = (event: Event) => {
    if ((event as CustomEvent<string>).detail === projectId) schedule();
  };
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('astragit:git-workbench-changed', changed);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('focus', schedule);
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('astragit:git-workbench-changed', changed);
  };
}

export function notifyProjectGitChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent('astragit:git-workbench-changed', { detail: projectId }));
}

/** 已识别的嵌套仓库由自己的分组管理，不把目录占位项作为父仓库的新文件。 */
export function visibleRepositoryFiles(repository: ProjectGitRepositoryWorkbenchItem, repositories: ProjectGitRepositoryWorkbenchItem[]): GitFileStatusSummary[] {
  const nestedPaths = new Set(repositories.filter((item) => item.id !== repository.id).map((item) => item.relativePath));
  return repository.snapshot.fileStatuses.filter((file) => {
    if (file.indexStatus !== '?' || !file.path.endsWith('/')) return true;
    const path = [repository.relativePath === '.' ? '' : repository.relativePath, file.path.replace(/\/$/, '')].filter(Boolean).join('/');
    return !nestedPaths.has(path);
  });
}
