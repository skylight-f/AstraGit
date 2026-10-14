import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { FolderOpen } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardClient, GitAppProject, ProjectRecord } from './apiClient.js';
import { ProjectGitWorkbench } from './git/ProjectGitWorkbench.js';
import { ProjectSourceChanges } from './git/ProjectSourceChanges.js';
import { ModelSettings } from './ModelSettings.js';
import { ReleaseUpdateButton } from './ReleaseUpdateButton.js';
import { Button } from './ui/Button.js';
import { ApplicationErrorDialogHost, reportApplicationError, useApplicationErrorDialog } from './ui/ApplicationErrorDialog.js';
import { resolveProjectWorkspaceTabs, writeProjectWorkspaceTabs } from './projectWorkspacePersistence.js';

import './styles.css';
import './ui/primitives.css';
import './agentdesk-theme.css';
import './app.css';

export interface AppProps {
  client: DashboardClient;
  language: 'zh-CN' | 'en-US';
}

interface ProjectSlot {
  id: string;
  projectId: string;
}

export function App(props: AppProps) {
  const zh = props.language === 'zh-CN';
  const [projects, setProjects] = useState<GitAppProject[] | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [slots, setSlots] = useState<ProjectSlot[]>([]);
  const [showList, setShowList] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const [draftName, setDraftName] = useState('');
  const [pickBusy, setPickBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettingsRevision, setModelSettingsRevision] = useState(0);
  const [projectViews, setProjectViews] = useState<Record<string, 'workbench' | 'source'>>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('astragit.project-views.v1') ?? '{}'); return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, view]) => view === 'source' || view === 'workbench')) : {}; } catch { return {}; }
  });
  const [sourceVisited, setSourceVisited] = useState<Record<string, boolean>>({});
  const [sourceBatchBusy, setSourceBatchBusy] = useState(false);
  const activeView = activeProject ? projectViews[activeProject.id] ?? 'workbench' : 'workbench';
  const switchProjectView = (view: 'workbench' | 'source') => {
    if (!activeProject) return;
    if (view === 'source') setSourceVisited(current => ({ ...current, [activeProject.id]: true }));
    setProjectViews(current => {
      const next = { ...current, [activeProject.id]: view };
      try { localStorage.setItem('astragit.project-views.v1', JSON.stringify(next)); } catch { /* 当前视图仍可切换。 */ }
      return next;
    });
  };
  const modelSettingsChanged = useCallback(() => setModelSettingsRevision((revision) => revision + 1), []);
  useApplicationErrorDialog(error, { language: zh ? 'zh-CN' : 'en' });

  const sortedProjects = useMemo(() => {
    if (!projects) return [];
    return [...projects].sort((a, b) => Date.parse(b.lastOpenedAt || b.createdAt || '0') - Date.parse(a.lastOpenedAt || a.createdAt || '0'));
  }, [projects]);

  const refresh = useCallback(async () => {
    try {
      const list = await props.client.loadProjects();
      setProjects(list);
      void window.astraGit?.rendererReady?.().catch(reason => console.error('[AstraGit] ready signal failed', reason));
      return list;
    } catch (reason) {
      console.error('[AstraGit] loadProjects failed', reason);
      setError(reason);
      setProjects([]);
      return [] as GitAppProject[];
    }
  }, [props.client]);

  const applyWorkbench = useCallback(
    async (project: GitAppProject, openInSlots: ReadonlyArray<ProjectSlot> = slots) => {
      const touched = await props.client.touchProject(project.id);
      setActiveProject(touched);
      setShowList(false);
      const base = slots.length ? slots : [...openInSlots];
      const nextSlots = base.some((slot) => slot.projectId === touched.id)
        ? base
        : [...base, { id: `project-slot-${base.length}-${touched.id}`, projectId: touched.id }];
      setSlots(nextSlots);
      writeProjectWorkspaceTabs({ projectIds: nextSlots.map((slot) => slot.projectId), activeProjectId: touched.id });
    },
    [projects, props.client, slots],
  );

  // 启动：恢复上次打开的项目页签
  useEffect(() => {
    void (async () => {
      const list = await refresh();
      const restored = resolveProjectWorkspaceTabs(list);
      if (!restored.activeProjectId) {
        setShowList(true);
        setActiveProject(null);
        setSlots([]);
        return;
      }
      const active = list.find((project) => project.id === restored.activeProjectId);
      if (!active) {
        setShowList(true);
        return;
      }
      const restoredSlots = restored.projectIds.map((projectId, index) => ({ id: `project-slot-${index}`, projectId }));
      setSlots(restoredSlots);
      try {
        await applyWorkbench(active, restoredSlots);
      } catch (reason) {
        setError(reason);
        setShowList(true);
      }
    })();
  }, []);

  // 项目列表变化时清理失效页签
  useEffect(() => {
    if (!projects) return;
    const known = new Set(projects.map((project) => project.id));
    setSlots((current) => {
      const next = current.filter((slot) => known.has(slot.projectId));
      if (activeProject && known.has(activeProject.id) && !next.some((slot) => slot.projectId === activeProject.id)) {
        next.push({ id: `project-slot-${next.length}-${activeProject.id}`, projectId: activeProject.id });
      }
      return next.length === current.length && next.every((slot, index) => slot.id === current[index]?.id && slot.projectId === current[index]?.projectId) ? current : next;
    });
    if (activeProject && known.has(activeProject.id)) {
      writeProjectWorkspaceTabs({
        projectIds: slots.map((slot) => slot.projectId).filter((id) => known.has(id)),
        activeProjectId: activeProject.id,
      });
    }
  }, [projects, activeProject, slots]);

  const openProject = useCallback(
    async (project: GitAppProject) => {
      try {
        await applyWorkbench(project);
      } catch (reason) {
        setError(reason);
      }
    },
    [applyWorkbench],
  );


  const closeSlot = (slotId: string) => {
    const current = slots;
    if (current.length <= 1) return;
    const index = current.findIndex((slot) => slot.id === slotId);
    if (index < 0) return;
    const closing = current[index]!;
    const next = current.filter((slot) => slot.id !== slotId);
    setSlots(next);
    const known = new Set((projects ?? []).map((project) => project.id));
    if (closing.projectId === activeProject?.id) {
      const replacement = next[Math.min(index, next.length - 1)];
      const replacementProject = replacement ? projects?.find((item) => item.id === replacement.projectId) : undefined;
      if (replacementProject) {
        void openProject(replacementProject);
        return;
      }
      setActiveProject(null);
      setShowList(true);
    }
    writeProjectWorkspaceTabs({
      projectIds: next.map((slot) => slot.projectId).filter((id) => known.has(id)),
      activeProjectId: activeProject && activeProject.id !== closing.projectId ? activeProject.id : (next.find((slot) => known.has(slot.projectId))?.projectId ?? null),
    });
  };

  const pickDirectory = async () => {
    setPickBusy(true);
    try {
      const path = await window.astraGit?.chooseDirectory?.();
      if (path) setDraftPath(path);
    } finally {
      setPickBusy(false);
    }
  };

  const addProject = async () => {
    if (!draftPath.trim()) {
      setError(new Error(zh ? '请先选择或填写本地目录。' : 'Choose or enter a local directory first.'));
      return;
    }
    setBusy(true);
    try {
      const created = await props.client.createProject({ name: draftName.trim() || undefined, localPath: draftPath.trim() });
      setDraftPath('');
      setDraftName('');
      const list = await refresh();
      await openProject(list.find((item) => item.id === created.id) ?? created);
    } catch (reason) {
      reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en' });
    } finally {
      setBusy(false);
    }
  };

  const removeProject = async (project: GitAppProject) => {
    if (!window.confirm(zh ? `从列表移除「${project.name}」？不会删除磁盘文件。` : `Remove "${project.name}" from the list? Files on disk are kept.`)) return;
    try {
      await props.client.removeProject(project.id);
      const list = await refresh();
      setSlots((current) => current.filter((slot) => slot.projectId !== project.id));
      if (activeProject?.id === project.id) {
        const nextActive = list[0];
        if (nextActive) await openProject(nextActive);
        else {
          setActiveProject(null);
          setShowList(true);
        }
      }
    } catch (reason) {
      setError(reason);
    }
  };

  const slotProjects = useMemo(() => {
    const map = new Map((projects ?? []).map((project) => [project.id, project]));
    return slots
      .map((slot) => ({ slot, project: map.get(slot.projectId) }))
      .filter((entry): entry is { slot: ProjectSlot; project: GitAppProject } => Boolean(entry.project));
  }, [projects, slots]);

  const inWorkbench = Boolean(activeProject) && !showList;

  return (
    <>
      {inWorkbench && activeProject ? (
        <div className="gitapp-shell gitapp-shell--workbench macos-ai-app zeus-shell theme-light">
          <header className="gitapp-tabbar" aria-label={zh ? '项目页签' : 'Project tabs'}>
            <nav className="gitapp-tabbar-slots" aria-label={zh ? '已打开的项目' : 'Open projects'}>
              {slotProjects.map(({ slot, project }) => {
                const active = project.id === activeProject.id;
                return (
                  <span key={slot.id} className={`gitapp-tab${active ? ' is-active' : ''}`} data-project-slot-id={slot.id}>
                    <button
                      type="button"
                      className="gitapp-tab-switch"
                      aria-label={zh ? `切换项目 ${project.name}` : `Switch project ${project.name}`}
                      title={zh ? '打开项目列表以切换' : 'Open project list to switch'}
                      disabled={sourceBatchBusy}
                      onClick={() => setShowList(true)}
                    >
                      <CaretDown size={11} weight="bold" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="gitapp-tab-body"
                      aria-pressed={active}
                      disabled={sourceBatchBusy && !active}
                      title={project.localPath}
                      onClick={() => {
                        if (!active) void openProject(project);
                      }}
                    >
                      <FolderOpen className="gitapp-tab-icon" size={15} weight="regular" aria-hidden="true" />
                      <span className="gitapp-tab-label">{project.name}</span>
                    </button>
                    <button
                      type="button"
                      className="gitapp-tab-close"
                      disabled={slots.length <= 1 || sourceBatchBusy}
                      aria-label={zh ? `关闭项目 ${project.name}` : `Close project ${project.name}`}
                      title={slots.length <= 1 ? (zh ? '至少保留一个项目' : 'Keep at least one project open') : zh ? `关闭 ${project.name}` : `Close ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeSlot(slot.id);
                      }}
                    >
                      <X size={13} weight="regular" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </nav>
            <button type="button" className="gitapp-tab-add" disabled={sourceBatchBusy} aria-label={zh ? '打开或添加项目' : 'Open or add project'} title={zh ? '打开或添加项目' : 'Open or add project'} onClick={() => setShowList(true)}>
              <Plus size={17} weight="regular" aria-hidden="true" />
            </button>
            <nav className="gitapp-view-switch" aria-label={zh ? '切换项目视图' : 'Project view'}>
              <button type="button" aria-pressed={activeView === 'workbench'} onClick={() => switchProjectView('workbench')}>{zh ? 'Git 工作台' : 'Git workbench'}</button>
              <button type="button" aria-pressed={activeView === 'source'} onClick={() => switchProjectView('source')}>{zh ? '源码更改' : 'Source changes'}</button>
            </nav>
            <div className="gitapp-tabbar-path" title={activeProject.localPath}>
              {activeProject.localPath}
            </div>
            <button type="button" className="gitapp-settings-trigger" onClick={() => setSettingsOpen(true)}>{zh ? 'AI 设置' : 'AI settings'}</button>
            <ReleaseUpdateButton zh={zh} disabled={sourceBatchBusy} />
          </header>

          <div className="gitapp-workbench-host" key={activeProject.id}>
            <div className="gitapp-view-pane" hidden={activeView !== 'workbench'}>
              <ProjectGitWorkbench project={activeProject} client={props.client} language={props.language} modelSettingsRevision={modelSettingsRevision} />
            </div>
            {sourceVisited[activeProject.id] || activeView === 'source' ? <div className="gitapp-view-pane" hidden={activeView !== 'source'}>
              <ProjectSourceChanges project={activeProject} client={props.client} language={props.language} active={activeView === 'source'} modelSettingsRevision={modelSettingsRevision} onBusyChange={setSourceBatchBusy} />
            </div> : null}
          </div>
          <ApplicationErrorDialogHost language={zh ? 'zh-CN' : 'en'} />
        </div>
      ) : (
        <div className="gitapp-shell gitapp-list-page macos-ai-app theme-light">
          <header className="gitapp-hero">
            <div className="gitapp-logo" aria-hidden="true">
              <span>AG</span>
            </div>
            <div>
              <h1>AstraGit</h1>
              <p>{zh ? '独立 Git 工作台 · AI 提交说明 · 无会话' : 'Standalone Git workbench · AI commits · no conversations'}</p>
            </div>
            {activeProject ? (
              <Button type="button" variant="secondary" className="gitapp-hero-back" onClick={() => setShowList(false)}>
                {zh ? '返回工作台' : 'Back to workbench'}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" className="gitapp-hero-settings" onClick={() => setSettingsOpen(true)}>{zh ? 'AI 设置' : 'AI settings'}</Button>
            <ReleaseUpdateButton zh={zh} />
          </header>

          <section className="gitapp-add" aria-label={zh ? '添加项目' : 'Add project'}>
            <label>
              <span>{zh ? '项目名称（可选）' : 'Name (optional)'}</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={zh ? '默认取目录名' : 'Defaults to folder name'} />
            </label>
            <label>
              <span>{zh ? '本地目录' : 'Local directory'}</span>
              <div className="gitapp-path-row">
                <input value={draftPath} onChange={(event) => setDraftPath(event.target.value)} placeholder="/Users/you/code/repo" spellCheck={false} />
                <Button type="button" variant="secondary" disabled={pickBusy} onClick={() => void pickDirectory()}>
                  {zh ? '浏览…' : 'Browse…'}
                </Button>
              </div>
            </label>
            <Button type="button" disabled={busy} onClick={() => void addProject()}>
              {busy ? (zh ? '打开中…' : 'Opening…') : zh ? '添加并打开' : 'Add & open'}
            </Button>
          </section>

          <section className="gitapp-projects" aria-label={zh ? '项目列表' : 'Projects'}>
            <div className="gitapp-section-title">
              <h2>{zh ? '项目' : 'Projects'}</h2>
              <button type="button" className="gitapp-linkish" onClick={() => void refresh()}>
                {zh ? '刷新' : 'Refresh'}
              </button>
            </div>
            {projects === null ? (
              <p className="gitapp-muted">{zh ? '正在加载项目…' : 'Loading projects…'}</p>
            ) : sortedProjects.length === 0 ? (
              <div className="gitapp-empty">
                <p>{zh ? '还没有项目' : 'No projects yet'}</p>
                <p className="gitapp-muted">{zh ? '选择一个本地 Git 目录，即可打开完整工作台。' : 'Pick a local Git directory to open the full workbench.'}</p>
              </div>
            ) : (
              <ul>
                {sortedProjects.map((project) => (
                  <li key={project.id}>
                    <button type="button" className="gitapp-project-card" onClick={() => void openProject(project)}>
                      <strong>{project.name}</strong>
                      <span>{project.localPath}</span>
                      <small>{zh ? '打开工作台 →' : 'Open workbench →'}</small>
                    </button>
                    <button type="button" className="gitapp-remove" onClick={() => void removeProject(project)} title={zh ? '从列表移除' : 'Remove from list'}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ApplicationErrorDialogHost language={zh ? 'zh-CN' : 'en'} />
        </div>
      )}
      {settingsOpen ? <ModelSettings client={props.client} language={props.language} onClose={() => setSettingsOpen(false)} onChanged={modelSettingsChanged} /> : null}
    </>
  );
}
