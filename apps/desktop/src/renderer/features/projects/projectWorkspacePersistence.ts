const projectWorkspaceTabsStorageKey = 'astragit.workspace.project-tabs.v1';
const projectNavigationStoragePrefix = 'astragit.project-navigation.v1:';
const projectGroupsStorageKey = 'astragit.workspace.project-groups.v1';

export interface ProjectGroup {
  id: string;
  name: string;
  projectIds: string[];
}

export function readProjectGroups(storage = browserProjectWorkspaceStorage()): ProjectGroup[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(projectGroupsStorageKey) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const groups: ProjectGroup[] = [];
    const groupIds = new Set<string>();
    const assigned = new Set<string>();
    for (const group of saved) {
      if (!group || typeof group.id !== 'string' || !group.id || groupIds.has(group.id)
        || typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.projectIds)) continue;
      groupIds.add(group.id);
      const projectIds: string[] = [];
      for (const id of group.projectIds) {
        if (typeof id === 'string' && id && !assigned.has(id)) {
          assigned.add(id);
          projectIds.push(id);
        }
      }
      groups.push({ id: group.id, name: group.name.trim(), projectIds });
    }
    return groups;
  } catch {
    return [];
  }
}

export function writeProjectGroups(groups: ProjectGroup[], storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  storage.setItem(projectGroupsStorageKey, JSON.stringify(groups));
}

/** Editing one group also moves its selected projects out of their previous groups. */
export function updateProjectGroup(groups: ProjectGroup[], edited: ProjectGroup): ProjectGroup[] {
  const selected = new Set(edited.projectIds);
  const next = groups.map(group => group.id === edited.id
    ? edited
    : { ...group, projectIds: group.projectIds.filter(id => !selected.has(id)) });
  if (!groups.some(group => group.id === edited.id)) next.push(edited);
  return next;
}

type BranchTab = 'log' | 'stash' | 'console';
type StagingTab = 'changes' | 'ignored';
export type ProjectGitTab = BranchTab | StagingTab;
export interface ProjectNavigation {
  section: 'branch' | 'commit';
  branchTab: BranchTab;
  commitTab: 'source' | StagingTab;
}

const defaultNavigation: ProjectNavigation = { section: 'branch', branchTab: 'log', commitTab: 'source' };

export interface ProjectWorkspaceTabsState {
  projectIds: string[];
  activeProjectId: string | null;
}

function browserProjectWorkspaceStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function selectProjectTab(current: ProjectNavigation, tab: ProjectGitTab | 'source'): ProjectNavigation {
  if (tab === 'source' || tab === 'changes' || tab === 'ignored') return { ...current, section: 'commit', commitTab: tab };
  return { ...current, section: 'branch', branchTab: tab };
}

export function readProjectNavigation(projectId?: string, storage = browserProjectWorkspaceStorage()): ProjectNavigation {
  if (!projectId || !storage) return defaultNavigation;
  try {
    const saved = JSON.parse(storage.getItem(projectNavigationStoragePrefix + projectId) ?? 'null');
    if (saved?.section === 'commit' || saved?.section === 'branch') {
      return {
        section: saved.section,
        branchTab: saved.branchTab === 'stash' || saved.branchTab === 'console' ? saved.branchTab : 'log',
        commitTab: saved.commitTab === 'changes' || saved.commitTab === 'ignored' ? saved.commitTab : 'source',
      };
    }
    const tab = storage.getItem('astragit.project-git-tab-v2:' + projectId);
    const previous = selectProjectTab(defaultNavigation, tab === 'changes' || tab === 'ignored' || tab === 'stash' || tab === 'console' ? tab : 'log');
    const views = JSON.parse(storage.getItem('astragit.project-views.v1') ?? 'null');
    return views?.[projectId] === 'source' ? selectProjectTab(previous, 'source') : previous;
  } catch {
    return defaultNavigation;
  }
}

export function writeProjectNavigation(projectId: string, navigation: ProjectNavigation, storage = browserProjectWorkspaceStorage()): void {
  try {
    storage?.setItem(projectNavigationStoragePrefix + projectId, JSON.stringify(navigation));
  } catch {
    return;
  }
}

/** 只恢复可验证的项目 ID；本地缓存损坏时退回空状态。 */
export function readProjectWorkspaceTabs(storage = browserProjectWorkspaceStorage()): ProjectWorkspaceTabsState | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(projectWorkspaceTabsStorageKey) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.projectIds)) return null;
    const projectIds = Array.from(new Set(record.projectIds.filter((projectId): projectId is string => typeof projectId === 'string' && projectId.length > 0)));
    const activeProjectId = typeof record.activeProjectId === 'string' && record.activeProjectId.length > 0 ? record.activeProjectId : null;
    return { projectIds, activeProjectId };
  } catch {
    return null;
  }
}

/** 同步写入顺序与当前项目，确保激活项目始终属于已打开列表。 */
export function writeProjectWorkspaceTabs(state: ProjectWorkspaceTabsState, storage = browserProjectWorkspaceStorage()): void {
  if (!storage) return;
  const projectIds = Array.from(new Set(state.projectIds.filter(Boolean)));
  if (state.activeProjectId && !projectIds.includes(state.activeProjectId)) projectIds.push(state.activeProjectId);
  try {
    storage.setItem(projectWorkspaceTabsStorageKey, JSON.stringify({ projectIds, activeProjectId: state.activeProjectId } satisfies ProjectWorkspaceTabsState));
  } catch {
    // 存储不可用时保留当前窗口状态，不阻断项目切换。
  }
}

/** 按当前项目快照过滤已删除项目，并为首次启动补入当前项目。 */
export function resolveProjectWorkspaceTabs(projects: ReadonlyArray<{ id: string }>, fallbackActiveProjectId?: string, persisted: ProjectWorkspaceTabsState | null = readProjectWorkspaceTabs()): ProjectWorkspaceTabsState {
  const knownProjectIds = new Set(projects.map((project) => project.id));
  const projectIds = (persisted?.projectIds ?? []).filter((projectId) => knownProjectIds.has(projectId));
  const activeProjectId =
    (persisted?.activeProjectId && knownProjectIds.has(persisted.activeProjectId) ? persisted.activeProjectId : null) ??
    (fallbackActiveProjectId && knownProjectIds.has(fallbackActiveProjectId) ? fallbackActiveProjectId : null) ??
    projects[0]?.id ??
    null;
  if (activeProjectId && !projectIds.includes(activeProjectId)) projectIds.push(activeProjectId);
  return { projectIds, activeProjectId };
}
