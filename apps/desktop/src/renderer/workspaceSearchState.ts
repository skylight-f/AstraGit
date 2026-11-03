import type { ProjectRecord, ProjectGitWorkbenchSnapshot } from './apiClient.js';
import { visibleRepositoryFiles } from './git/projectGitWorkbenchState.js';

export type WorkspaceSearchDestination =
  | { kind: 'project'; projectId: string }
  | { kind: 'repository'; projectId: string; repositoryId: string }
  | { kind: 'file'; projectId: string; repositoryId: string; path: string; stage: 'staged' | 'unstaged' };
export type GitSearchNavigation = Exclude<WorkspaceSearchDestination, { kind: 'project' }> & { requestId: number };
export interface WorkspaceSearchResult { id: string; title: string; detail: string; destination: WorkspaceSearchDestination }

export function searchDestinationAvailable(snapshot: ProjectGitWorkbenchSnapshot, target: Exclude<WorkspaceSearchDestination, { kind: 'project' }>): boolean {
  if (snapshot.projectId !== target.projectId) return false;
  const repository = snapshot.repositories.find(item => item.id === target.repositoryId);
  if (!repository) return false;
  if (target.kind === 'repository') return true;
  const file = repository.snapshot.fileStatuses.find(item => item.path === target.path);
  if (!file) return false;
  const conflict = repository.snapshot.conflictFiles.includes(file.path);
  return target.stage === 'staged' ? !conflict && file.indexStatus !== ' ' && file.indexStatus !== '?' : conflict || file.workingTreeStatus !== ' ' || file.indexStatus === '?';
}

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

/** 只索引已有项目和当前项目的真实 Git 状态，不读取文件正文或修改仓库。 */
export function searchWorkspace(projects: readonly ProjectRecord[], snapshot: ProjectGitWorkbenchSnapshot | null, query: string, limit = 40): WorkspaceSearchResult[] {
  const tokens = normalized(query.trim()).split(/\s+/u).filter(Boolean);
  const matches: Array<{ item: WorkspaceSearchResult; score: number; order: number }> = [];
  let order = 0;
  function add(item: WorkspaceSearchResult, searchable: string) {
    const text = normalized(searchable), title = normalized(item.title);
    if (!tokens.every(token => text.includes(token))) return;
    const score = tokens.length && tokens.every(token => title.includes(token)) ? (title === normalized(query.trim()) ? 0 : 1) : 2;
    matches.push({ item, score, order: order++ });
  }
  for (const project of projects) add({ id: `project:${project.id}`, title: project.name, detail: project.localPath, destination: { kind: 'project', projectId: project.id } }, `${project.name} ${project.localPath}`);
  for (const repository of snapshot?.repositories ?? []) {
    const projectId = snapshot!.projectId;
    add({ id: `repository:${projectId}:${repository.id}`, title: repository.name, detail: `${snapshot!.projectName} · ${repository.relativePath} · ${repository.snapshot.branch}`, destination: { kind: 'repository', projectId, repositoryId: repository.id } }, `${repository.name} ${repository.relativePath} ${repository.snapshot.branch}`);
    if (!tokens.length) continue;
    const conflicts = new Set(repository.snapshot.conflictFiles);
    for (const file of visibleRepositoryFiles(repository, snapshot!.repositories)) {
      const stages: Array<'staged' | 'unstaged'> = [];
      if (!conflicts.has(file.path) && file.indexStatus !== ' ' && file.indexStatus !== '?') stages.push('staged');
      if (conflicts.has(file.path) || file.workingTreeStatus !== ' ' || file.indexStatus === '?') stages.push('unstaged');
      for (const stage of stages) add({ id: JSON.stringify([projectId, repository.id, stage, file.path]), title: file.path.split('/').at(-1) || file.path, detail: `${repository.name} · ${file.path}`, destination: { kind: 'file', projectId, repositoryId: repository.id, path: file.path, stage } }, `${repository.name} ${repository.relativePath} ${file.path} ${file.originalPath ?? ''}`);
    }
  }
  return matches.sort((a, b) => a.score - b.score || a.order - b.order).slice(0, Math.max(0, limit)).map(match => match.item);
}
