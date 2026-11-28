import { ShieldCheck } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { ProjectList } from '../features/projects/ProjectList.js';
import { CodeReviewPanel } from '../features/code-review/CodeReviewPanel.js';
import { closedWorkspaceWidth, GitPaneSeparator, readGitPanePreference } from '../features/git/components/GitPaneSeparator.js';
import { FolderOpen } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import { GitCommit } from '@phosphor-icons/react/dist/csr/GitCommit';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { desktopGitMenuCommands, type DesktopGitMenuCommand, type DesktopMenuCommand } from '@astragit/shared';
import type { DashboardClient, GitAppProject, ProjectRecord } from '../api/apiClient.js';
import { ProjectGitWorkbench } from '../features/git/workbench/ProjectGitWorkbench.js';
import { useGitCommitModels } from '../features/models/useGitCommitModels.js';
import { Settings, type SettingsSection } from '../features/settings/Settings.js';
import { useApplicationUpdates } from '../features/updates/useApplicationUpdates.js';
import { ApplicationUpdateDialog } from '../features/updates/ApplicationUpdateDialog.js';
import { readAutoFetchPreference, readLanguagePreference, resolveApplicationLanguage, saveAutoFetchPreference, saveLanguagePreference, type LanguagePreference } from '../features/settings/applicationPreferences.js';
import { ReleaseUpdateButton } from '../features/updates/ReleaseUpdateButton.js';
import { Button } from '../ui/Button.js';
import { MenuSurface } from '../ui/MenuSurface.js';
import { MotionPresence } from '../ui/MotionPresence.js';
import { ApplicationErrorDialogHost, reportApplicationError, useApplicationErrorDialog } from '../ui/ApplicationErrorDialog.js';
import { readProjectNavigation, resolveProjectWorkspaceTabs, selectProjectTab, writeProjectNavigation, writeProjectWorkspaceTabs, type ProjectGitTab, type ProjectNavigation } from '../features/projects/projectWorkspacePersistence.js';
import { useRepositorySetup } from '../features/projects/useRepositorySetup.js';
import { RepositorySetupForm } from '../features/projects/RepositorySetupForm.js';
import { ProjectFolderImport } from '../features/projects/ProjectFolderImport.js';
import { WorkspaceSearch } from '../features/search/WorkspaceSearch.js';
import type { GitSearchNavigation, WorkspaceSearchDestination } from '../features/search/workspaceSearchState.js';

import '../styles/styles.css';
import '../ui/primitives.css';
import '../styles/theme.css';
import './app.css';

export interface AppProps {
  client: DashboardClient;
  language: 'zh-CN' | 'en-US';
  customTitlebar?: boolean;
  development?: boolean;
}

interface ProjectSlot {
  id: string;
  projectId: string;
}

type ProjectTabDropTarget = { id: string; side: 'before' | 'after' };
type ProjectTabDragLayout = { sourceIndex: number; targets: Array<{ id: string; midpoint: number }> };

const reviewSplit = { initial: 68, min: 40, max: 78 };
const minimumReviewWidth = 280 + 6; // Panel and separator.

function toolbarMenuButton(host: HTMLElement | null, command: DesktopGitMenuCommand): HTMLButtonElement | null | undefined {
  return host?.querySelector<HTMLButtonElement>(`button[data-desktop-menu-command="${command}"]:not(:disabled)`);
}

function projectTabDropTarget(nav: HTMLElement, layout: ProjectTabDragLayout, x: number, y: number): ProjectTabDropTarget | null {
  const bounds = nav.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  const pointer = x - bounds.left + nav.scrollLeft;
  const next = layout.targets.findIndex(tab => pointer < tab.midpoint);
  const index = next < 0 ? layout.targets.length : next;
  if (index === layout.sourceIndex) return null;
  const target = layout.targets[index] ?? layout.targets.at(-1);
  return target ? { id: target.id, side: next < 0 ? 'after' : 'before' } : null;
}

export function App(props: AppProps) {
  const [languagePreference, setLanguagePreference] = useState(readLanguagePreference);
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(readAutoFetchPreference);
  const language = resolveApplicationLanguage(languagePreference, props.language);
  const zh = language === 'zh-CN';
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const changeAutoFetch = (enabled: boolean) => {
    try { saveAutoFetchPreference(enabled); setAutoFetchEnabled(enabled); }
    catch (reason) { reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en' }); }
  };
  const changeLanguage = (value: LanguagePreference) => {
    try { saveLanguagePreference(value); setLanguagePreference(value); }
    catch (reason) { reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en' }); }
  };
  const [projects, setProjects] = useState<GitAppProject[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewVisited, setReviewVisited] = useState(false);
  const contentLayout = useRef<HTMLDivElement>(null);
  const [reviewBounds, setReviewBounds] = useState({ min: reviewSplit.min, max: reviewSplit.max });
  const [reviewWindowGrowth, setReviewWindowGrowth] = useState<number | null>(null);
  const tabList = useRef<HTMLElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [projectNavigation, setProjectNavigation] = useState<Partial<Record<string, ProjectNavigation>>>({});
  const [slots, setSlots] = useState<ProjectSlot[]>([]);
  const [gitCommandHost, setGitCommandHost] = useState<HTMLDivElement | null>(null);
  const [showList, setShowList] = useState(false);
  const [projectAddMode, setProjectAddMode] = useState<'clone' | 'init' | null>(null);
  const [projectAddMenuOpen, setProjectAddMenuOpen] = useState(false);
  const projectAddButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<unknown>(null);
  const [openingLocalProject, setOpeningLocalProject] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchNavigation, setSearchNavigation] = useState<GitSearchNavigation | null>(null);
  const searchRequestId = useRef(0);
  const finishSearchNavigation = useCallback((requestId: number) => setSearchNavigation(current => current?.requestId === requestId ? null : current), []);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const openSettings = (section: SettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const [modelSettingsRevision, setModelSettingsRevision] = useState(0);
  const [sourceVisited, setSourceVisited] = useState<Record<string, boolean>>({});
  const [sourceChangesBusy, setSourceChangesBusy] = useState(false);
  const [sourceToolbarBusy, setSourceToolbarBusy] = useState(false);
  const sourceBatchBusy = sourceChangesBusy || sourceToolbarBusy;
  const tabDrag = useRef<{ id: string; pointerId: number; button: HTMLButtonElement; x: number; y: number; layout?: ProjectTabDragLayout } | null>(null);
  const dragEndedAt = useRef(-Infinity);
  const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<ProjectTabDropTarget | null>(null);
  const [tabAnnouncement, setTabAnnouncement] = useState('');
  const workspaceInitialized = useRef(false);
  const projectOpenVersion = useRef(0);
  const pendingProjectId = useRef<string | null>(null);
  const activeProjectId = activeProject?.id;
  const commitModels = useGitCommitModels(props.client, showList ? undefined : activeProjectId, modelSettingsRevision);
  const savedNavigation = useMemo(() => readProjectNavigation(activeProjectId), [activeProjectId]);
  const navigation = (activeProjectId && projectNavigation[activeProjectId]) || savedNavigation;
  const activeTab = navigation.section === 'branch' ? navigation.branchTab : navigation.commitTab;
  const sourceVisible = activeTab === 'source';
  const changeGitTab = useCallback((tab: ProjectGitTab | 'source') => {
    if (!activeProjectId) return;
    setProjectNavigation(current => ({
      ...current,
      [activeProjectId]: selectProjectTab(current[activeProjectId] ?? savedNavigation, tab),
    }));
  }, [activeProjectId, savedNavigation]);
  useEffect(() => {
    if (activeProjectId) writeProjectNavigation(activeProjectId, navigation);
  }, [activeProjectId, navigation]);
  useEffect(() => {
    if (activeProjectId && sourceVisible) setSourceVisited(current => current[activeProjectId] ? current : { ...current, [activeProjectId]: true });
  }, [activeProjectId, sourceVisible]);
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
    async (project: GitAppProject, openInSlots: ReadonlyArray<ProjectSlot> = []) => {
      const version = ++projectOpenVersion.current;
      pendingProjectId.current = project.id;
      let touched: ProjectRecord;
      try { touched = await props.client.touchProject(project.id); }
      catch (reason) { if (version !== projectOpenVersion.current) return; throw reason; }
      finally { if (version === projectOpenVersion.current) pendingProjectId.current = null; }
      if (version !== projectOpenVersion.current) return;
      setActiveProject(touched);
      setShowList(false);
      // touchProject 等待期间可能发生拖拽或关闭；合并到最新页签顺序。
      setSlots(current => {
        const base = current.length ? current : [...openInSlots];
        return base.some(slot => slot.projectId === touched.id) ? base : [...base, { id: `project-slot-${touched.id}`, projectId: touched.id }];
      });
    },
    [props.client],
  );

  // 启动：恢复上次打开的项目页签
  useEffect(() => {
    // Fast Refresh re-runs effects. Restore only once per mounted App so a
    // component save keeps the current list/settings/workbench navigation.
    if (workspaceInitialized.current) return;
    workspaceInitialized.current = true;
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

  const repositorySetup = useRepositorySetup(props.client, async id => {
    const list = await refresh();
    const project = list.find(project => project.id === id);
    if (project) await openProject(project);
  });
  const repositorySetupKind = repositorySetup.job?.kind ?? repositorySetup.draft?.kind ?? 'clone';
  const updateDisabled = sourceBatchBusy || repositorySetup.busy;
  const applicationUpdates = useApplicationUpdates(language, updateDisabled);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const inspectUpdate = () => setUpdateDialogOpen(true);

  const endTabDrag = () => {
    const drag = tabDrag.current;
    tabDrag.current = null;
    if (drag?.layout) dragEndedAt.current = performance.now();
    if (drag?.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
    setDraggingSlotId(null);
    setTabDropTarget(null);
  };

  const moveSlot = (sourceId: string, targetId: string, side: 'before' | 'after') => {
    if (sourceBatchBusy || sourceId === targetId) return;
    setSlots(current => {
      const source = current.find(slot => slot.id === sourceId);
      if (!source || !current.some(slot => slot.id === targetId)) return current;
      const next = current.filter(slot => slot.id !== sourceId);
      const index = next.findIndex(slot => slot.id === targetId) + (side === 'after' ? 1 : 0);
      next.splice(index, 0, source);
      return next.every((slot, position) => slot === current[position]) ? current : next;
    });
  };


  const closeSlot = (slotId: string) => {
    const current = slots;
    if (current.length <= 1) return;
    const index = current.findIndex((slot) => slot.id === slotId);
    if (index < 0) return;
    const closing = current[index]!;
    if (pendingProjectId.current === closing.projectId) { projectOpenVersion.current += 1; pendingProjectId.current = null; }
    const next = current.filter((slot) => slot.id !== slotId);
    setSlots(next);
    const known = new Set((projects ?? []).map((project) => project.id));
    if (closing.projectId === activeProject?.id) {
      const replacement = next[Math.min(index, next.length - 1)];
      const replacementProject = replacement ? projects?.find((item) => item.id === replacement.projectId) : undefined;
      if (replacementProject) {
        setActiveProject(replacementProject);
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

  const openLocalProject = async () => {
    setOpeningLocalProject(true);
    try {
      const localPath = await window.astraGit?.chooseDirectory?.();
      if (!localPath) return;
      const project = await props.client.createProject({ localPath });
      await refresh();
      await openProject(project);
    } catch (reason) {
      reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en' });
    } finally {
      setOpeningLocalProject(false);
      requestAnimationFrame(() => projectAddButton.current?.focus());
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
  const tabDropOrder = tabDropTarget
    ? slotProjects.findIndex(({ slot }) => slot.id === tabDropTarget.id) * 2 + (tabDropTarget.side === 'before' ? -1 : 1)
    : null;

  const inWorkbench = Boolean(activeProject) && !showList;
  const commitView = navigation.section === 'commit';
  const viewSwitchDisabled = !activeProject || sourceBatchBusy || repositorySetup.busy;
  useEffect(() => {
    const list = tabList.current;
    if (!list || !inWorkbench || settingsOpen) return;
    const reveal = () => list.querySelector('.gitapp-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    reveal();
    return () => observer.disconnect();
  }, [activeProjectId, inWorkbench, settingsOpen]);
  const showReview = !settingsOpen && reviewOpen && Boolean(activeProject);
  const reviewVisible = showReview && reviewWindowGrowth !== null;
  useLayoutEffect(() => {
    const layout = contentLayout.current;
    const resizeWindow = window.astraGit?.setReviewWindowWidth;
    if (!showReview || !layout) {
      setReviewWindowGrowth(null);
      void resizeWindow?.(0).catch(reason => console.warn('[AstraGit] 无法还原评审窗口宽度', reason));
      return;
    }
    if (!resizeWindow) { setReviewWindowGrowth(0); return; }
    const preferred = readGitPanePreference('review-main', reviewSplit.initial);
    const split = Math.max(reviewSplit.min, Math.min(reviewSplit.max, preferred));
    const originalWidth = layout.clientWidth;
    const dockWidth = Math.max(minimumReviewWidth, originalWidth * (1 - split / 100));
    let current = true;
    let observer: ResizeObserver | undefined;
    void resizeWindow(dockWidth).then(growth => {
      if (!current) return;
      const measureGrowth = () => setReviewWindowGrowth(Math.min(growth, Math.max(0, layout.clientWidth - originalWidth)));
      measureGrowth();
      if (growth > 0) {
        observer = new ResizeObserver(measureGrowth);
        observer.observe(layout);
      }
    }).catch(reason => {
      console.warn('[AstraGit] 无法扩展评审窗口宽度', reason);
      if (current) setReviewWindowGrowth(0);
    });
    return () => { current = false; observer?.disconnect(); };
  }, [showReview]);
  useLayoutEffect(() => {
    const layout = contentLayout.current;
    if (!reviewVisible || !layout) return;
    const measure = () => {
      const width = closedWorkspaceWidth(layout);
      if (width <= 0) return;
      const growth = layout.clientWidth - width;
      const required = Array.from(layout.style)
        .filter(key => key.startsWith('--base-review-room-'))
        .map(key => parseFloat(layout.style.getPropertyValue(key)));
      const available = Math.max(0, 100 * (width - minimumReviewWidth) / width);
      const min = Math.min(available, Math.max(reviewSplit.min, 100 * (Math.max(0, ...required) - growth) / width));
      const max = Math.max(min, Math.min(available, reviewSplit.max));
      setReviewBounds(previous => previous.min === min && previous.max === max ? previous : { min, max });
    };
    const resize = new ResizeObserver(measure);
    const columns = new MutationObserver(measure);
    resize.observe(layout);
    columns.observe(layout, { attributes: true, attributeFilter: ['style'] });
    measure();
    return () => { resize.disconnect(); columns.disconnect(); };
  }, [reviewVisible, reviewWindowGrowth]);
  const showProjectTab = (tab: ProjectGitTab | 'source') => {
    if (viewSwitchDisabled) return;
    setSearchNavigation(null);
    changeGitTab(tab);
    setShowList(false);
    setSettingsOpen(false);
  };
  async function navigateSearch(destination: WorkspaceSearchDestination) {
    if (sourceBatchBusy || repositorySetup.busy) return;
    if (destination.kind === 'project') {
      const project = projects?.find(item => item.id === destination.projectId);
      if (!project) throw new Error('Project no longer available');
      await applyWorkbench(project);
    } else {
      if (destination.projectId !== activeProject?.id) throw new Error('Project changed during search');
      setShowList(false);
      setSearchNavigation({ ...destination, requestId: ++searchRequestId.current });
    }
    setSettingsOpen(false);
  }

  const canManageProjects = !updateDisabled && !openingLocalProject;
  const activeSlotId = slots.find(slot => slot.projectId === activeProject?.id)?.id;
  const canCloseProject = canManageProjects && Boolean(activeSlotId) && slots.length > 1 && inWorkbench && !settingsOpen;
  const canRunGitMenu = inWorkbench && !settingsOpen && !viewSwitchDisabled;
  const canReview = Boolean(activeProject) && !settingsOpen;
  const onDesktopMenuCommand = useEffectEvent((command: DesktopMenuCommand) => {
    if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
    switch (command) {
      case 'settings': openSettings(); break;
      case 'updates': openSettings('updates'); break;
      case 'open-local-project': if (canManageProjects) void openLocalProject(); break;
      case 'project-list':
        if (canManageProjects) { setProjectAddMode(null); setProjectAddMenuOpen(false); setSettingsOpen(false); setShowList(true); }
        break;
      case 'close-project': if (canCloseProject && activeSlotId) closeSlot(activeSlotId); break;
      case 'source': case 'changes': showProjectTab(command); break;
      case 'history': showProjectTab('log'); break;
      case 'review': if (canReview) reviewButton.current?.click(); break;
      case 'search': {
        const input = document.querySelector<HTMLInputElement>('.gitapp-titlebar input[type="search"]:not(:disabled)');
        input?.focus(); input?.select();
        break;
      }
      default:
        if (canRunGitMenu) toolbarMenuButton(gitCommandHost, command)?.click();
    }
  });
  useEffect(() => window.astraGit?.onDesktopMenuCommand?.(onDesktopMenuCommand), []);
  useEffect(() => {
    const send = window.astraGit?.setDesktopMenuState;
    if (!send) return;
    let previous = '';
    const sync = () => {
      const enabled: DesktopMenuCommand[] = ['settings', 'updates'];
      if (canManageProjects) enabled.push('open-local-project', 'project-list');
      if (canCloseProject) enabled.push('close-project');
      if (!viewSwitchDisabled) enabled.push('source', 'changes', 'history');
      if (!updateDisabled) enabled.push('search');
      if (canReview) enabled.push('review');
      if (canRunGitMenu) enabled.push(...desktopGitMenuCommands.filter(command => toolbarMenuButton(gitCommandHost, command)));
      const next = enabled.join(',');
      if (next === previous) return;
      previous = next;
      void send({ enabled, language }).catch(() => {});
    };
    sync();
    if (!gitCommandHost || !canRunGitMenu) return;
    const observer = new MutationObserver(sync);
    observer.observe(gitCommandHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [language, canManageProjects, canCloseProject, canRunGitMenu, canReview, gitCommandHost, updateDisabled, viewSwitchDisabled]);

  return (
    <>
      <div className={`gitapp-frame${props.customTitlebar ? ' has-native-traffic-lights' : ''}`} style={{ '--base-review-window-growth': `${reviewVisible ? reviewWindowGrowth : 0}px` } as CSSProperties}>
        <header className="gitapp-titlebar" aria-label={zh ? '标题栏' : 'Title bar'}>
          <div className="gitapp-titlebar-leading">
            <strong className="gitapp-titlebar-brand">
              AstraGit
              {props.development ? <span className="gitapp-titlebar-development">Development</span> : null}
            </strong>
          </div>
          <WorkspaceSearch client={props.client} projects={sortedProjects} project={activeProject} zh={zh} mac={props.customTitlebar === true} disabled={sourceBatchBusy || repositorySetup.busy} onNavigate={navigateSearch} />
          <div className="gitapp-titlebar-actions"><button ref={reviewButton} type="button" disabled={!activeProject || settingsOpen} aria-label={zh ? '代码评审' : 'Code review'} title={zh ? '代码评审' : 'Code review'} aria-expanded={reviewVisible} aria-controls="gitapp-code-review" onClick={() => { setReviewVisited(true); setReviewOpen(value => !value); }}><ShieldCheck size={20} /><span>{zh ? '评审' : 'Review'}</span></button></div>
        </header>
      <div className="gitapp-layout">
        <nav className="gitapp-activity-rail" aria-label={zh ? '应用操作栏' : 'Application actions'}>
          <button type="button" aria-label={zh ? '项目提交视图' : 'Project commits view'} title={zh ? '提交' : 'Commit'} aria-current={!settingsOpen && inWorkbench && commitView ? 'page' : undefined} disabled={viewSwitchDisabled} onClick={() => showProjectTab(navigation.commitTab)}>
            <GitCommit size={20} aria-hidden="true" />
          </button>
          <button type="button" aria-label={zh ? '分支视图' : 'Branch view'} title={zh ? '分支' : 'Branch'} aria-current={!settingsOpen && inWorkbench && !commitView ? 'page' : undefined} disabled={viewSwitchDisabled} onClick={() => showProjectTab(navigation.branchTab === 'stash' ? 'log' : navigation.branchTab)}>
            <GitBranch size={20} aria-hidden="true" />
          </button>
          <ReleaseUpdateButton zh={zh} update={applicationUpdates} open={updateDialogOpen} onInspect={inspectUpdate} />
          <button type="button" className="gitapp-rail-settings" aria-label={zh ? '设置' : 'Settings'} title={zh ? '设置' : 'Settings'} aria-current={settingsOpen ? 'page' : undefined} onClick={() => { if (settingsOpen) setSettingsOpen(false); else openSettings(); }}>
            <GearSix size={20} aria-hidden="true" />
          </button>
        </nav>
      <div ref={contentLayout} className={`gitapp-content-layout${reviewVisible ? ' has-review' : ''}`}>
      <div className="gitapp-workspace-pane" hidden={settingsOpen}>
      {inWorkbench && activeProject ? (
        <div className="gitapp-shell gitapp-shell--workbench macos-ai-app zeus-shell theme-light">
          <div className="gitapp-workbench-header">
            <header className="gitapp-tabbar" aria-label={zh ? '项目页签' : 'Project tabs'}>
              <nav ref={tabList} className="gitapp-tabbar-slots" aria-label={zh ? '已打开的项目' : 'Open projects'}>
                {slotProjects.map(({ slot, project }, position) => {
                  const active = project.id === activeProject.id;
                  const dragging = draggingSlotId === slot.id;
                  return (
                    <span key={slot.id} className={`gitapp-tab${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`} data-project-slot-id={slot.id} style={{ order: dragging ? tabDropOrder ?? position * 2 : position * 2 }}>
                      <button
                        type="button"
                        className="gitapp-tab-body"
                        aria-pressed={active}
                        aria-description={zh ? '拖拽排序，或按 Alt + Shift + 左右方向键调整顺序' : 'Drag to reorder, or press Alt + Shift + Left or Right'}
                        disabled={sourceBatchBusy && !active}
                        data-reorderable={!sourceBatchBusy && slots.length > 1}
                        draggable={false}
                        title={project.localPath}
                        onPointerDown={event => {
                          if (event.button !== 0 || sourceBatchBusy || slots.length <= 1) return;
                          tabDrag.current = { id: slot.id, pointerId: event.pointerId, button: event.currentTarget, x: event.clientX, y: event.clientY };
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={event => {
                          const drag = tabDrag.current;
                          if (!drag || drag.pointerId !== event.pointerId || sourceBatchBusy) return;
                          if (!drag.layout && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
                          event.preventDefault();
                          const nav = event.currentTarget.closest('nav')!;
                          const bounds = nav.getBoundingClientRect();
                          if (!drag.layout) {
                            // Capture the original positions so moving the placeholder does not move the drop thresholds.
                            const tabs = Array.from(nav.querySelectorAll<HTMLElement>('[data-project-slot-id]'));
                            drag.layout = {
                              sourceIndex: tabs.findIndex(tab => tab.dataset.projectSlotId === drag.id),
                              targets: tabs.filter(tab => tab.dataset.projectSlotId !== drag.id).map(tab => {
                                const rect = tab.getBoundingClientRect();
                                return { id: tab.dataset.projectSlotId!, midpoint: rect.left + rect.width / 2 - bounds.left + nav.scrollLeft };
                              }),
                            };
                            setDraggingSlotId(drag.id);
                          }
                          if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
                            if (event.clientX < bounds.left + 28) nav.scrollBy({ left: -18 });
                            else if (event.clientX > bounds.right - 28) nav.scrollBy({ left: 18 });
                          }
                          const target = projectTabDropTarget(nav, drag.layout, event.clientX, event.clientY);
                          setTabDropTarget(current => current?.id === target?.id && current?.side === target?.side ? current : target);
                        }}
                        onPointerUp={event => {
                          const drag = tabDrag.current;
                          if (!drag || drag.pointerId !== event.pointerId) return;
                          const target = drag.layout && projectTabDropTarget(event.currentTarget.closest('nav')!, drag.layout, event.clientX, event.clientY);
                          if (target && !sourceBatchBusy) {
                            moveSlot(drag.id, target.id, target.side);
                            setTabAnnouncement(zh ? '已调整项目标签顺序' : 'Project tab order changed');
                          }
                          endTabDrag();
                        }}
                        onPointerCancel={endTabDrag}
                        onLostPointerCapture={endTabDrag}
                        onKeyDown={event => {
                          if (event.key === 'Escape' && tabDrag.current) { event.preventDefault(); endTabDrag(); return; }
                          if (sourceBatchBusy || !event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                          event.preventDefault();
                          const index = slots.findIndex(item => item.id === slot.id);
                          const target = slots[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                          if (!target) return;
                          moveSlot(slot.id, target.id, event.key === 'ArrowLeft' ? 'before' : 'after');
                          const button = event.currentTarget;
                          requestAnimationFrame(() => { button.focus(); button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
                          setTabAnnouncement(zh ? `${project.name} 已向${event.key === 'ArrowLeft' ? '左' : '右'}移动` : `${project.name} moved ${event.key === 'ArrowLeft' ? 'left' : 'right'}`);
                        }}
                        onClick={() => {
                          if (tabDrag.current?.layout || performance.now() - dragEndedAt.current < 200) return;
                          if (!active) void openProject(project);
                        }}
                      >
                        <FolderOpen className="gitapp-tab-icon" size={16} weight="regular" aria-hidden="true" />
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
                        <X size={12} weight="regular" aria-hidden="true" />
                      </button>
                      {dragging ? <span className="gitapp-tab-placeholder" aria-hidden="true">{project.name}</span> : null}
                    </span>
                  );
                })}
              </nav>
              <span className="gitapp-tab-announcement" role="status" aria-live="polite">{tabAnnouncement}</span>
              <button type="button" className="gitapp-tab-add" disabled={sourceBatchBusy} aria-label={zh ? '打开或添加项目' : 'Open or add project'} title={zh ? '打开或添加项目' : 'Open or add project'} onClick={() => { setProjectAddMode(null); setProjectAddMenuOpen(false); setShowList(true); }}>
                <Plus size={16} weight="regular" aria-hidden="true" />
              </button>
              {repositorySetup.busy ? <Button variant="secondary" size="compact" onClick={() => { setProjectAddMode(repositorySetupKind); setProjectAddMenuOpen(false); setShowList(true); }}>{zh ? '仓库创建中…' : 'Repository setup…'}</Button> : null}
            </header>
            <div className="gitapp-workbench-commands" ref={setGitCommandHost} />
          </div>

          <div className="gitapp-workbench-host" key={activeProject.id}>
            <ProjectGitWorkbench
              project={activeProject}
              autoFetchEnabled={autoFetchEnabled && !settingsOpen}
              client={props.client}
              language={language}
              tab={activeTab === 'source' ? navigation.branchTab : activeTab}
              onTabChange={changeGitTab}
              commitModels={commitModels}
              onOpenModelSettings={() => openSettings('models')}
              navigationRequest={searchNavigation}
              onNavigationHandled={finishSearchNavigation}
              commandHost={gitCommandHost}
              commitViewNavigation={commitView ? (
                <nav className="gitapp-commit-viewbar" aria-label={zh ? '提交视图' : 'Commit views'}>
                  <button type="button" aria-pressed={sourceVisible} disabled={viewSwitchDisabled} onClick={() => showProjectTab('source')}>{zh ? '项目提交' : 'Project commits'}</button>
                  <button type="button" aria-pressed={!sourceVisible} disabled={viewSwitchDisabled} onClick={() => showProjectTab('changes')}>{zh ? '暂存与未暂存' : 'Staged and unstaged'}</button>
                </nav>
              ) : undefined}
              sourceView={sourceVisited[activeProject.id] || sourceVisible ? {
                visible: sourceVisible,
                active: !settingsOpen && sourceVisible,
                onBusyChange: setSourceChangesBusy,
                onToolbarBusyChange: setSourceToolbarBusy,
              } : undefined}
            />
          </div>
        </div>
      ) : (
        <ProjectList
          projects={projects === null ? null : sortedProjects}
          zh={zh}
          onOpen={openProject}
          onRemove={removeProject}
          actions={<>
            {activeProject ? (
              <Button size="compact" onClick={() => { setProjectAddMenuOpen(false); setShowList(false); }}>
                <ArrowLeft size={16} aria-hidden="true" />
                {zh ? '返回工作台' : 'Back to workbench'}
              </Button>
            ) : null}
            {projectAddMode !== repositorySetupKind && (repositorySetup.busy || repositorySetup.job || repositorySetup.error) ? (
              <Button size="compact" onClick={() => setProjectAddMode(repositorySetupKind)}>
                {repositorySetup.busy ? (zh ? '查看创建进度' : 'View setup progress') : zh ? '查看创建结果' : 'View setup result'}
              </Button>
            ) : null}
            <Button size="compact" aria-label={zh ? '刷新项目' : 'Refresh projects'} title={zh ? '刷新项目' : 'Refresh projects'} onClick={() => void refresh()}>
              <ArrowClockwise size={16} aria-hidden="true" />
            </Button>
            <ProjectFolderImport client={props.client} zh={zh} disabled={openingLocalProject} onImported={refresh} />
            <Button ref={projectAddButton} size="compact" variant="primary" busy={openingLocalProject} aria-haspopup="menu" aria-expanded={projectAddMenuOpen} onClick={() => setProjectAddMenuOpen(value => !value)}>
              <Plus size={16} aria-hidden="true" />
              {zh ? '添加项目' : 'Add project'}
              <CaretDown size={12} aria-hidden="true" />
            </Button>
            {projectAddMenuOpen ? (
              <MenuSurface className="gitapp-project-add-menu" aria-label={zh ? '添加项目' : 'Add project'} anchor={projectAddButton.current ?? undefined} onClose={() => setProjectAddMenuOpen(false)}>
                <button type="button" role="menuitem" disabled={!window.astraGit?.chooseDirectory} onClick={() => { setProjectAddMenuOpen(false); void openLocalProject(); }}>
                  {zh ? '打开本地项目' : 'Open local project'}
                </button>
                {([
                  ['clone', zh ? '克隆仓库' : 'Clone repository'],
                  ['init', zh ? '初始化仓库' : 'Initialize repository'],
                ] as const).map(([mode, label]) => (
                  <button type="button" role="menuitem" key={mode} onClick={() => { setProjectAddMode(mode); setProjectAddMenuOpen(false); }}>{label}</button>
                ))}
              </MenuSurface>
            ) : null}
          </>}
        >
          {projectAddMode ? (
            <div className="gitapp-project-editor">
              <button type="button" className="gitapp-project-icon-button gitapp-project-editor-close" aria-label={zh ? '收起表单' : 'Hide form'} title={zh ? '收起表单' : 'Hide form'} onClick={() => { setProjectAddMode(null); projectAddButton.current?.focus(); }}>
                <X size={16} aria-hidden="true" />
              </button>
              <RepositorySetupForm key={projectAddMode} kind={projectAddMode} zh={zh} setup={repositorySetup} />
            </div>
          ) : null}
        </ProjectList>
      )}
      </div>
      {reviewVisible ? <GitPaneSeparator name="review-main" label={zh ? '调整代码评审宽度' : 'Resize code review'} initial={reviewSplit.initial} min={reviewBounds.min} max={reviewBounds.max} /> : null}
      {reviewVisited && activeProject ? <CodeReviewPanel key={activeProject.id} client={props.client} project={activeProject} zh={zh} active={reviewVisible} modelSettingsRevision={modelSettingsRevision} onSettings={() => openSettings('models')} onClose={() => { setReviewOpen(false); reviewButton.current?.focus(); }} onNavigate={navigateSearch} /> : null}
      {settingsOpen ? <Settings client={props.client} language={language} languagePreference={languagePreference} onLanguageChange={changeLanguage} autoFetchEnabled={autoFetchEnabled} onAutoFetchChange={changeAutoFetch} onModelsChanged={modelSettingsChanged} section={settingsSection} onSectionChange={setSettingsSection} update={applicationUpdates} updateDisabled={updateDisabled} onInspectUpdate={inspectUpdate} /> : null}
      </div>
      </div>
      </div>
      <MotionPresence>{updateDialogOpen ? <ApplicationUpdateDialog zh={zh} update={applicationUpdates} disabled={updateDisabled} onDismiss={() => setUpdateDialogOpen(false)} /> : null}</MotionPresence>
      <ApplicationErrorDialogHost language={zh ? 'zh-CN' : 'en'} />
    </>
  );
}
