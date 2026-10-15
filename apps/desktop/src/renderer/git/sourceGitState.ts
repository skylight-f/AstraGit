import type { GitCommitSelectionMode, GitFileStatusSummary, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';

export type SourceResultStatus = 'queued' | 'committing' | 'committed' | 'commit_failed' | 'blocked' | 'pushing' | 'done' | 'push_failed' | 'push_blocked' | 'unknown';
export interface SourceBatchResult {
  repositoryId: string; repositoryName: string; branch: string; paths: string[]; mode: GitCommitSelectionMode;
  expectedHead: string; commitSha?: string; message: string; remote: string; targetBranch: string;
  dependsOn: string[]; status: SourceResultStatus; error?: string;
  pushRequested?: boolean;
}
export interface SourceGitState {
  selected: Record<string, string[]>; sharedMessage: string; drafts: Record<string, string>;
  messageMode: 'shared' | 'individual'; selectionMode: GitCommitSelectionMode;
  updateParents: boolean; fileView: 'tree' | 'flat';
  focus: { repositoryId: string; path: string } | null; collapsed: string[]; search: string;
  fingerprints: Record<string, string>; lastResults: SourceBatchResult[];
}
const sourceStates = new Map<string, SourceGitState>();
export function readSourceGitState(projectId: string): SourceGitState {
  const empty: SourceGitState = { selected: {}, sharedMessage: '', drafts: {}, messageMode: 'shared', selectionMode: 'worktree', updateParents: false, fileView: 'tree', focus: null, collapsed: [], search: '', fingerprints: {}, lastResults: [] };
  if (sourceStates.has(projectId)) return sourceStates.get(projectId)!;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`astragit.source-git.v1:${projectId}`) ?? 'null');
    if (!value || typeof value !== 'object') return empty;
    const data = value as Partial<SourceGitState>;
    const strings = (record: unknown): Record<string, string> => record && typeof record === 'object' ? Object.fromEntries(Object.entries(record).filter(([key, value]) => key.length < 220 && typeof value === 'string' && value.length <= 30_000)) : {};
    return {
      ...empty,
      selected: data.selected && typeof data.selected === 'object' ? Object.fromEntries(Object.entries(data.selected).slice(0, 100).filter(([, paths]) => Array.isArray(paths)).map(([key, paths]) => [key, paths.filter(path => typeof path === 'string' && path.length < 4096).slice(0, 2000)])) : {},
      sharedMessage: typeof data.sharedMessage === 'string' ? data.sharedMessage.slice(0, 30_000) : '',
      drafts: strings(data.drafts), fingerprints: strings(data.fingerprints),
      messageMode: data.messageMode === 'individual' ? 'individual' : 'shared', selectionMode: data.selectionMode === 'staged' ? 'staged' : 'worktree',
      updateParents: data.updateParents === true, fileView: data.fileView === 'flat' ? 'flat' : 'tree',
      focus: data.focus && typeof data.focus.repositoryId === 'string' && typeof data.focus.path === 'string' ? data.focus : null,
      collapsed: Array.isArray(data.collapsed) ? data.collapsed.filter(value => typeof value === 'string').slice(0, 2000) : [],
      search: typeof data.search === 'string' ? data.search.slice(0, 200) : '',
      lastResults: Array.isArray(data.lastResults) ? data.lastResults.filter(result => result && typeof result.repositoryId === 'string' && typeof result.status === 'string' && Array.isArray(result.paths) && Array.isArray(result.dependsOn)).slice(0, 20).map(result => {
        if (result.commitSha && (result.status === 'pushing' || (result.status === 'committed' && result.pushRequested))) return { ...result, status: 'push_blocked' as const, error: '提交已完成，推送流程已中断；可重试推送，不会重复提交。' };
        return ['queued', 'committing', 'pushing'].includes(result.status) ? { ...result, status: 'unknown' as const, error: '操作已中断，请在工作台核对提交与操作记录。' } : result;
      }) : [],
    };
  } catch { return empty; }
}
export function writeSourceGitState(projectId: string, state: SourceGitState) {
  sourceStates.set(projectId, state);
  try { localStorage.setItem(`astragit.source-git.v1:${projectId}`, JSON.stringify(state)); } catch { /* 存储不可用时仍保留进程内状态。 */ }
}
export function sourceRepositoryFiles(repository: ProjectGitRepositoryWorkbenchItem, repositories: ProjectGitRepositoryWorkbenchItem[], mode: GitCommitSelectionMode): GitFileStatusSummary[] {
  const nested = new Set(repositories.filter(item => item.id !== repository.id).map(item => item.relativePath));
  return repository.snapshot.fileStatuses.filter(file => {
    if (mode === 'staged' && (file.indexStatus === ' ' || file.indexStatus === '?')) return false;
    if (file.indexStatus !== '?' || !file.path.endsWith('/')) return true;
    const path = [repository.relativePath === '.' ? '' : repository.relativePath, file.path.replace(/\/$/u, '')].filter(Boolean).join('/');
    return !nested.has(path);
  });
}
export interface SourceCommitUnit {
  repository: ProjectGitRepositoryWorkbenchItem; paths: string[]; ordinaryPaths: string[];
  gitlinks: Array<{ path: string; repositoryId: string }>; dependsOn: string[];
}
/** 仓库关系来自 Git 子模块元数据；普通嵌套仓库不会被当作子模块。 */
export function buildSourceCommitUnits(repositories: ProjectGitRepositoryWorkbenchItem[], selected: Record<string, string[]>, mode: GitCommitSelectionMode, updateParents: boolean): SourceCommitUnit[] {
  const units = new Map<string, SourceCommitUnit>();
  for (const repository of repositories) {
    const eligible = new Set(sourceRepositoryFiles(repository, repositories, mode).map(file => file.path));
    const paths = [...new Set(selected[repository.id] ?? [])].filter(path => eligible.has(path));
    if (paths.length) units.set(repository.id, { repository, paths, ordinaryPaths: [...paths], gitlinks: [], dependsOn: [] });
  }
  if (mode === 'worktree') {
    for (const unit of units.values()) {
      for (const parent of repositories) {
        const module = parent.snapshot.submodules?.find(module => [parent.relativePath === '.' ? '' : parent.relativePath, module.path].filter(Boolean).join('/') === unit.repository.relativePath);
        if (!module || !unit.repository.isSubmodule) continue;
        if (!updateParents && !units.get(parent.id)?.paths.includes(module.path)) continue;
        const parentUnit = units.get(parent.id) ?? { repository: parent, paths: [], ordinaryPaths: [], gitlinks: [], dependsOn: [] };
        if (!parentUnit.paths.includes(module.path)) parentUnit.paths.push(module.path);
        parentUnit.ordinaryPaths = parentUnit.paths.filter(path => path !== module.path && !parentUnit.gitlinks.some(link => link.path === path));
        if (!parentUnit.dependsOn.includes(unit.repository.id)) parentUnit.dependsOn.push(unit.repository.id);
        if (!parentUnit.gitlinks.some(link => link.path === module.path)) parentUnit.gitlinks.push({ path: module.path, repositoryId: unit.repository.id });
        units.set(parent.id, parentUnit);
      }
    }
  } else {
    // 暂存模式保持既有 gitlink 版本；其关联子仓库仍需先推送，避免发布不可获取的引用。
    for (const unit of units.values()) {
      if (!unit.repository.isSubmodule) continue;
      for (const parent of repositories) {
        const module = parent.snapshot.submodules?.find(module => [parent.relativePath === '.' ? '' : parent.relativePath, module.path].filter(Boolean).join('/') === unit.repository.relativePath);
        const parentUnit = units.get(parent.id);
        if (module && parentUnit?.paths.includes(module.path) && !parentUnit.dependsOn.includes(unit.repository.id)) parentUnit.dependsOn.push(unit.repository.id);
      }
    }
  }
  const ordered: SourceCommitUnit[] = [];
  const seen = new Set<string>();
  const visit = (unit: SourceCommitUnit) => {
    if (seen.has(unit.repository.id)) return;
    seen.add(unit.repository.id);
    for (const id of unit.dependsOn) { const dependency = units.get(id); if (dependency) visit(dependency); }
    ordered.push(unit);
  };
  for (const unit of units.values()) visit(unit);
  return ordered;
}

export function defaultSourcePushTarget(repository: ProjectGitRepositoryWorkbenchItem): { remote: string; branch: string } {
  const upstream = repository.snapshot.upstream ?? '';
  const remote = [...repository.snapshot.remotes].sort((a, b) => b.length - a.length).find(remote => upstream.startsWith(`${remote}/`)) ?? '';
  return { remote, branch: remote ? upstream.slice(remote.length + 1) : repository.snapshot.detached ? '' : repository.snapshot.branch };
}
