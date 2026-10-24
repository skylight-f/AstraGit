import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { ListBullets } from '@phosphor-icons/react/dist/csr/ListBullets';
import { TreeStructure } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import type { DashboardClient, GitDiffSummary, ProjectGitAction, ProjectGitRepositorySnapshot, ProjectGitRepositoryWorkbenchItem, ProjectRecord } from '../apiClient.js';
import { loadGitCommitModelOptions } from './gitCommitModels.js';
import { ProjectGitDiffWindow, SideBySideDiff } from './ProjectGitDiffViewer.js';
import { GitConflictEditor } from './GitConflictEditor.js';
import { notifyProjectGitChanged, projectGitWorkbenchCacheEntry, readCachedProjectGitWorkbench, requestProjectGitWorkbench, subscribeProjectGitRefresh } from './projectGitWorkbenchState.js';
import { SourceRepositoryTree } from './SourceFileTree.js';
import { buildSourceCommitUnits, defaultSourcePushTarget, readSourceGitState, sourceRepositoryFiles, writeSourceGitState, type SourceGitState } from './sourceGitState.js';
import { previewForUnit, pushSourceResult, runSourceBatch, validateSourceReview, type SourceReviewRow } from './sourceGitBatch.js';
import { SourceCommitReview } from './SourceCommitReview.js';
import { SourceCommitOptions } from './SourceCommitOptions.js';
import { SourceRepositoryControls } from './SourceRepositoryControls.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { GitCommitTemplateControl } from './GitCommitTemplateControl.js';
import type { BusyState, ExecutionOutcome } from './gitWorkbenchTypes.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { formatVisibleApplicationError, reportApplicationError, VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { gitConflictMessage, gitFailureText, gitFailureTitle, gitPostActionRefreshError } from './gitOperationFeedback.js';
import './sourceGit.css';

export function ProjectSourceChanges(props: { project: ProjectRecord; client: DashboardClient; language: 'zh-CN' | 'en-US'; active: boolean; modelSettingsRevision?: number; onBusyChange: (busy: boolean) => void }) {
  const { client, project, active, onBusyChange } = props;
  const currentProjectId = useRef(project.id);
  currentProjectId.current = project.id;
  const zh = props.language === 'zh-CN';
  const label = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState(() => readSourceGitState(project.id));
  const stateRef = useRef(state);
  const update = useCallback((change: Partial<SourceGitState> | ((current: SourceGitState) => SourceGitState)) => {
    const next = typeof change === 'function' ? change(stateRef.current) : { ...stateRef.current, ...change };
    stateRef.current = next; setState(next); writeSourceGitState(project.id, next);
  }, [project.id]);
  const [snapshot, setSnapshot] = useState(() => readCachedProjectGitWorkbench(client, project.id));
  const snapshotRef = useRef(snapshot);
  const [loading, setLoading] = useState(false);
  const refreshVersion = useRef(0);
  const [tab, setTab] = useState<'commit' | 'stash'>('commit');
  const [operation, setOperation] = useState<BusyState>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const commitLayout = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null);
  const [paneBounds, setPaneBounds] = useState({ min: 10, max: 88 });
  const shell = useRef<HTMLElement>(null);
  const detail = useRef<HTMLElement>(null);
  const [sidebarBounds, setSidebarBounds] = useState({ min: 20, max: 65 });
  const [resultsBounds, setResultsBounds] = useState({ min: 25, max: 85 });
  const [stashPreview, setStashPreview] = useState<{ repositoryId: string; commitHash: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const operationErrors = useRef<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stopped = useRef(false);
  const activeRepository = useRef<string | null>(null);
  const generation = useRef<AbortController | null>(null);
  const [generating, setGenerating] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [model, setModel] = useState('');
  const [modelWarning, setModelWarning] = useState('');
  const updateParents = state.updateParents;
  const [draftRepository, setDraftRepository] = useState('');
  const [templateSource, setTemplateSource] = useState('');
  const [review, setReview] = useState<{ rows: SourceReviewRow[]; push: boolean } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [diffTarget, setDiffTarget] = useState('');
  const [diffError, setDiffError] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setLoading(true);
    try {
      const value = await requestProjectGitWorkbench(client, project.id);
      if (currentProjectId.current !== project.id || version !== refreshVersion.current) return value;
      const previous = snapshotRef.current;
      snapshotRef.current = value;
      setSnapshot(value);
      update(current => ({ ...current, selected: Object.fromEntries(value.repositories.map(repository => {
        const old = previous?.repositories.find(item => item.id === repository.id);
        const changedHead = old && (old.snapshot.branch !== repository.snapshot.branch || old.snapshot.headSha !== repository.snapshot.headSha);
        const valid = new Set(repository.snapshot.fileStatuses.filter(file => !repository.snapshot.conflictFiles.includes(file.path)).map(file => file.path));
        return [repository.id, changedHead ? [] : (current.selected[repository.id] ?? []).filter(path => valid.has(path))];
      })) }));
      return value;
    } finally { if (currentProjectId.current === project.id && version === refreshVersion.current) setLoading(false); }
  }, [client, project.id, update]);
  useEffect(() => {
    if (!active) return;
    // 原生下拉菜单与草稿编辑期间不重绘列表；提交前仍重新读取并核对指纹。
    const load = () => { if (!busyRef.current && !generation.current && !document.querySelector('dialog[open], .git-pane-separator[data-dragging]') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) void refresh().catch(reason => setError(gitFailureText(reason))); };
    load(); const unsubscribe = subscribeProjectGitRefresh(project.id, load);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [active, project.id, refresh]);
  useEffect(() => {
    let live = true;
    void loadGitCommitModelOptions(client, project.id).then(value => { if (live) { setModels(value.items); setModel(value.modelRef); setModelWarning(value.warning); } }).catch(reason => { if (live) setModelWarning(formatVisibleApplicationError(reason, zh ? 'zh-CN' : 'en')); });
    return () => { live = false; };
  }, [client, project.id, props.modelSettingsRevision]);
  useEffect(() => () => { generation.current?.abort(); stopped.current = true; onBusyChange(false); }, [onBusyChange]);
  const repositories = snapshot?.repositories ?? [];
  const units = useMemo(() => buildSourceCommitUnits(snapshot?.repositories ?? [], state.selected, state.selectionMode, updateParents), [snapshot, state.selected, state.selectionMode, updateParents]);
  const filesCount = units.reduce((sum, unit) => sum + unit.paths.length, 0);
  const editorRepository = units.find(unit => unit.repository.id === draftRepository)?.repository.id ?? units[0]?.repository.id ?? '';
  const selectedMessage = state.messageMode === 'shared' ? state.sharedMessage : state.drafts[editorRepository] ?? '';
  const templateRepositories = units.length ? units.map(unit => unit.repository) : repositories;
  const templateRepositoryId = state.messageMode === 'individual' ? editorRepository : templateRepositories.length === 1 ? templateRepositories[0]!.id : templateRepositories.find(repository => repository.id === templateSource)?.id ?? '';
  const locked = busy || generating || reviewBusy || operation !== null;
  const hasFeedback = Boolean(feedback || (!model && modelWarning));
  useLayoutEffect(() => {
    const root = shell.current;
    const right = detail.current;
    if (!root || !right) return;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0) {
        const min = Math.min(45, 270 / width * 100);
        const max = Math.max(min, Math.min(70, (width - 280 - 6) / width * 100));
        setSidebarBounds(current => Math.abs(current.min - min) < 0.1 && Math.abs(current.max - max) < 0.1 ? current : { min, max });
      }
      const height = right.getBoundingClientRect().height;
      if (height > 0) {
        const min = Math.min(45, 150 / height * 100);
        const max = Math.max(min, Math.min(90, (height - 90 - 6) / height * 100));
        setResultsBounds(current => Math.abs(current.min - min) < 0.1 && Math.abs(current.max - max) < 0.1 ? current : { min, max });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(right);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const layout = commitLayout.current;
    const editor = composer.current;
    if (!layout || !editor) return;
    const controls = [...editor.children].filter((element) => !element.classList.contains('source-git-message'));
    const measure = () => {
      const height = layout.getBoundingClientRect().height;
      if (height <= 0) return;
      const style = getComputedStyle(editor);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gaps = (parseFloat(style.rowGap) || 0) * (editor.children.length - 1);
      // Keep the textarea, wrapped action buttons and optional draft/feedback controls usable.
      const minimumComposer = 48 + padding + gaps + controls.reduce((sum, control) => sum + control.getBoundingClientRect().height, 0);
      const min = Math.min(45, 55 / height * 100);
      const max = Math.max(min, Math.min(92, (height - minimumComposer - 6) / height * 100));
      setPaneBounds(current => Math.abs(current.min - min) < 0.1 && Math.abs(current.max - max) < 0.1 ? current : { min, max });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    controls.forEach(control => observer.observe(control));
    measure();
    return () => observer.disconnect();
  }, [tab, state.messageMode, hasFeedback]);
  const focusedId = state.focus?.repositoryId;
  const focusedPath = state.focus?.path;
  const focusedRepository = repositories.find(repository => repository.id === focusedId);
  const focusedConflict = Boolean(focusedPath && focusedRepository?.snapshot.conflictFiles.includes(focusedPath));
  const currentDiffTarget = JSON.stringify([focusedId, focusedPath, state.selectionMode]);
  useEffect(() => {
    if (!active || !focusedId || !focusedPath) return;
    const repository = snapshot?.repositories.find(repo => repo.id === focusedId);
    if (!repository || repository.snapshot.conflictFiles.includes(focusedPath) || !sourceRepositoryFiles(repository, snapshot!.repositories, state.selectionMode).some(file => file.path === focusedPath)) { setDiffTarget(currentDiffTarget); setDiff(null); setDiffError(''); setDiffLoading(false); return; }
    // Refresh the same file without unmounting its panes, scroll position or layout mode.
    const controller = new AbortController(); setDiffLoading(true); setDiffError('');
    void client.previewGitCommitSelection(project.id, [{ repositoryId: repository.id, relativePath: repository.relativePath, paths: [focusedPath] }], state.selectionMode, controller.signal).then(value => { if (!controller.signal.aborted) { setDiffTarget(currentDiffTarget); setDiff(value.repositories[0]?.diff ?? null); } }).catch(reason => { if (!controller.signal.aborted) { setDiffTarget(currentDiffTarget); setDiff(null); setDiffError(gitFailureText(reason)); } }).finally(() => { if (!controller.signal.aborted) setDiffLoading(false); });
    return () => controller.abort();
  }, [active, client, focusedId, focusedPath, project.id, snapshot, state.selectionMode, currentDiffTarget]);
  const toggle = (id: string, paths: string[], checked: boolean) => update(current => { const selected = new Set(current.selected[id]); for (const path of paths) { if (checked) selected.add(path); else selected.delete(path); } return { ...current, selected: { ...current.selected, [id]: [...selected] } }; });
  const setMessage = (message: string) => update(current => current.messageMode === 'shared' ? { ...current, sharedMessage: message } : { ...current, drafts: { ...current.drafts, [editorRepository]: message } });

  async function generate() {
    if (locked || !model || !units.length) return;
    const controller = new AbortController(); generation.current = controller; setGenerating(true); setError(''); setFeedback('');
    const original = stateRef.current;
    const ordinary = units.filter(unit => unit.ordinaryPaths.length);
    const selection = ordinary.map(unit => ({ repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths }));
    const references = units.filter(unit => unit.gitlinks.length).map(unit => `${unit.repository.name}: ${unit.gitlinks.map(link => link.path).join(', ')}`);
    const referencesMessage = references.length ? `\n\n${label('更新子模块引用', 'Update submodule references')}: ${references.join('; ')}` : '';
    let truncated = false;
    try {
      if (state.messageMode === 'shared') {
        if (!selection.length) update({ sharedMessage: `chore(deps): ${label('更新子模块引用', 'update submodule references')}${referencesMessage}` });
        else {
          const result = await client.generateGitCommitMessage(project.id, { ...selection[0]!, selection, selectionMode: state.selectionMode, language: zh ? 'zh-CN' : 'en', modelRef: model }, text => { if (!controller.signal.aborted) update({ sharedMessage: text }); }, controller.signal);
          controller.signal.throwIfAborted(); update({ sharedMessage: result.message + referencesMessage, fingerprints: result.fingerprints ?? {} });
          truncated = result.truncated === true;
        }
      } else {
        const drafts = { ...original.drafts }; const fingerprints: Record<string, string> = {};
        for (const unit of units) {
          const target = { repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths };
          const result = unit.ordinaryPaths.length ? await client.generateGitCommitMessage(project.id, { ...target, selection: [target], selectionMode: state.selectionMode, language: zh ? 'zh-CN' : 'en', modelRef: model }, undefined, controller.signal) : null;
          controller.signal.throwIfAborted(); drafts[unit.repository.id] = (result?.message ?? `chore(deps): ${label('更新子模块引用', 'update submodule references')}`) + (unit.gitlinks.length ? `\n\n${unit.gitlinks.map(link => link.path).join(', ')}` : ''); Object.assign(fingerprints, result?.fingerprints);
          truncated ||= result?.truncated === true;
        }
        update({ drafts, fingerprints });
      }
      setFeedback(label('已根据勾选内容生成，请检查提交说明。', 'Generated from selected content. Review before committing.') + (truncated ? label(' 部分大文件或生成文件仅提供摘要，请核对完整性。', ' Large or generated files were summarized; check completeness.') : ''));
    } catch (reason) {
      update({ sharedMessage: original.sharedMessage, drafts: original.drafts, fingerprints: original.fingerprints });
      if (controller.signal.aborted) setFeedback(label('已停止生成，已保留原提交说明。', 'Generation stopped. The original messages were preserved.'));
      else setError(gitFailureText(reason));
    } finally { generation.current = null; setGenerating(false); }
  }
  async function prepare(push: boolean) {
    if (locked || !units.length) return;
    setReviewBusy(true); setError(''); setReviewError('');
    try {
      const fresh = await refresh();
      const currentUnits = buildSourceCommitUnits(fresh.repositories, stateRef.current.selected, stateRef.current.selectionMode, updateParents);
      const targets = currentUnits.filter(unit => unit.ordinaryPaths.length).map(unit => ({ repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths }));
      const preview = targets.length ? await client.previewGitCommitSelection(project.id, targets, stateRef.current.selectionMode) : null;
      const rows: SourceReviewRow[] = currentUnits.map(unit => {
        const value = previewForUnit(unit, preview); const repository = unit.repository; const pushTarget = defaultSourcePushTarget(repository);
        if (repository.snapshot.conflictFiles.length || repository.snapshot.integrationState) throw new Error(`${repository.name}: ${label('请先在工作台解决冲突或完成合并。', 'Resolve conflicts or complete integration in the workbench first.')}`);
        if (value && !value.diff.diffText.trim() && !unit.gitlinks.length) throw new Error(`${repository.name}: ${label('所选内容没有可提交的差异。', 'No committable changes in the selection.')}`);
        return { repositoryId: repository.id, repositoryName: repository.name, relativePath: repository.relativePath, branch: value?.branch ?? repository.snapshot.branch, expectedHead: value?.headSha ?? repository.snapshot.headSha, fingerprint: value?.fingerprint, mode: stateRef.current.selectionMode, paths: unit.paths, ordinaryPaths: unit.ordinaryPaths, gitlinks: unit.gitlinks, dependsOn: unit.dependsOn, message: stateRef.current.messageMode === 'shared' ? stateRef.current.sharedMessage : stateRef.current.drafts[repository.id] ?? '', remote: pushTarget.remote, targetBranch: pushTarget.branch, remotes: repository.snapshot.remotes, detached: repository.snapshot.detached, status: 'queued' };
      });
      if (!rows.length) throw new Error(label('所选文件已无更改，请重新选择。', 'Selected files have no remaining changes.'));
      if (rows.some(row => row.fingerprint && stateRef.current.fingerprints[row.repositoryId] && row.fingerprint !== stateRef.current.fingerprints[row.repositoryId])) setReviewError(label('生成 AI 说明后文件已变化，请检查本次说明与文件列表后再确认。', 'Content changed after AI generation. Review the message and file list.'));
      setReview({ rows, push });
    } catch (reason) { setError(gitFailureText(reason)); }
    finally { setReviewBusy(false); }
  }
  async function confirm() {
    if (!review || busyRef.current || reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    let batchStarted = false;
    try {
      await validateSourceReview(client, project.id, review.rows, review.push);
      busyRef.current = true; setBusy(true); onBusyChange(true); stopped.current = false; setReview(null);
      batchStarted = true;
      await runSourceBatch({ client, projectId: project.id, rows: review.rows, push: review.push, stopped: () => stopped.current,
        onActive: id => { activeRepository.current = id; }, onResults: lastResults => update({ lastResults }),
        onCommitted: row => update(current => ({ ...current, selected: { ...current.selected, [row.repositoryId]: (current.selected[row.repositoryId] ?? []).filter(path => !row.paths.includes(path)) } })),
      });
      // 子模块成功、父仓库失败时保留新增引用供下次重新预览。
      for (const row of review.rows) if (row.gitlinks.length && !stateRef.current.lastResults.find(result => result.repositoryId === row.repositoryId)?.commitSha) toggle(row.repositoryId, row.gitlinks.map(link => link.path), true);
      notifyProjectGitChanged(project.id); await refresh();
    } catch (reason) { const message = gitFailureText(reason); if (batchStarted) setError(message); else setReviewError(message); }
    finally { activeRepository.current = null; busyRef.current = false; setBusy(false); onBusyChange(false); setReviewBusy(false); }
  }
  async function retryPush() {
    if (locked) return;
    busyRef.current = true; setBusy(true); onBusyChange(true); stopped.current = false; setError('');
    try {
      for (const row of [...stateRef.current.lastResults]) {
        if (stopped.current || !row.commitSha || !['push_failed', 'push_blocked'].includes(row.status)) continue;
        if (row.dependsOn.some(id => stateRef.current.lastResults.find(result => result.repositoryId === id)?.status !== 'done')) continue;
        activeRepository.current = row.repositoryId;
        try { await pushSourceResult(client, project.id, row); update(current => ({ ...current, lastResults: current.lastResults.map(result => result.repositoryId === row.repositoryId ? { ...result, status: 'done', error: undefined } : result) })); }
        catch (reason) { update(current => ({ ...current, lastResults: current.lastResults.map(result => result.repositoryId === row.repositoryId ? { ...result, status: 'push_failed', error: gitFailureText(reason) } : result) })); }
      }
      notifyProjectGitChanged(project.id); await refresh();
    } catch (reason) { setError(gitFailureText(reason)); }
    finally { activeRepository.current = null; busyRef.current = false; setBusy(false); onBusyChange(false); }
  }
  async function execute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, name: string): Promise<ExecutionOutcome> {
    if (busyRef.current || locked) return null;
    busyRef.current = true; setOperation({ repositoryId: repository.id, action: action.type }); onBusyChange(true); setError(''); setFeedback('');
    delete operationErrors.current[repository.id];
    refreshVersion.current += 1; projectGitWorkbenchCacheEntry(client, project.id).request = null;
    try {
      const result = await client.executeProjectGitAction(project.id, repository.id, action);
      if (snapshotRef.current) {
        const previous = snapshotRef.current.repositories.find(item => item.id === repository.id)?.snapshot;
        if (previous && (previous.branch !== result.snapshot.branch || previous.headSha !== result.snapshot.headSha)) {
          update(current => ({ ...current, selected: { ...current.selected, [repository.id]: [] } }));
        }
        const next = { ...snapshotRef.current, repositories: snapshotRef.current.repositories.map(item => item.id === repository.id ? { ...item, snapshot: result.snapshot } : item) };
        snapshotRef.current = next;
        setSnapshot(next);
      }
      notifyProjectGitChanged(project.id);
      try { await refresh(); } catch (reason) { setError(gitPostActionRefreshError(reason, result.result.outcome)); }
      if (result.result.outcome === 'conflict') {
        setTab('commit');
        selectRepository(repository.id);
        update(current => ({ ...current, focus: { repositoryId: repository.id, path: result.snapshot.conflictFiles[0] ?? '' } }));
        setFeedback(`${repository.name}: ${gitConflictMessage(action, result.result, result.snapshot, zh)} ${label('可切换到“仓库管理 → 文件状态”处理。', 'Switch to Repository management → File Status to resolve the conflicts.')}`);
      }
      return result.result.outcome;
    } catch (reason) {
      const summary = reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en', title: gitFailureTitle(action, name, repository.name, zh), detailTitle: label('Git 日志', 'Git log') });
      operationErrors.current[repository.id] = summary;
      setError(gitFailureText(reason));
      return null;
    }
    finally { busyRef.current = false; setOperation(null); onBusyChange(false); }
  }
  async function conflictSaved(repositoryId: string, path: string, result: { resolved: boolean; snapshot?: ProjectGitRepositorySnapshot }): Promise<void> {
    const projectId = project.id;
    if (currentProjectId.current !== projectId) {
      notifyProjectGitChanged(projectId);
      return;
    }
    refreshVersion.current += 1;
    const entry = projectGitWorkbenchCacheEntry(client, projectId);
    entry.request = null;
    const selectAfterSave = (saved: ProjectGitRepositorySnapshot) => {
      if (currentProjectId.current !== projectId || !result.resolved || saved.conflictFiles.includes(path)) return;
      update(current => {
        if (currentProjectId.current !== projectId || current.focus?.repositoryId !== repositoryId || current.focus.path !== path) return current;
        const repository = snapshotRef.current?.repositories.find(repository => repository.id === repositoryId);
        if (!repository) return current;
        const ordinary = sourceRepositoryFiles({ ...repository, snapshot: saved }, snapshotRef.current?.repositories ?? [], current.selectionMode);
        return { ...current, focus: { repositoryId, path: saved.conflictFiles[0] ?? ordinary.find(file => file.path === path)?.path ?? ordinary[0]?.path ?? '' } };
      });
    };
    if (result.snapshot && snapshotRef.current?.projectId === projectId) {
      const next = { ...snapshotRef.current, refreshedAt: new Date().toISOString(), repositories: snapshotRef.current.repositories.map(repository => repository.id === repositoryId ? { ...repository, snapshot: result.snapshot! } : repository) };
      snapshotRef.current = next;
      entry.snapshot = next;
      setSnapshot(next);
      selectAfterSave(result.snapshot);
    }
    try {
      const pending = refresh();
      const version = refreshVersion.current;
      const next = await pending;
      if (currentProjectId.current !== projectId || version !== refreshVersion.current) return;
      const repository = next.repositories.find(repository => repository.id === repositoryId);
      if (repository) selectAfterSave(repository.snapshot);
    } catch (reason) {
      if (currentProjectId.current !== projectId) return;
      const summary = reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en', title: label('冲突结果已保存，但刷新仓库失败', 'Conflict result was saved, but repository refresh failed') });
      setError(summary);
    } finally {
      notifyProjectGitChanged(projectId);
    }
  }
  const groupLabels = { conflicts: label('冲突', 'Conflicts'), changes: label('更改', 'Changes'), untracked: label('未版本控制的文件', 'Unversioned Files') };
  const filteredQuery = state.search.trim().toLocaleLowerCase();
  const fileGroups = (['conflicts', 'changes', 'untracked'] as const).map(group => ({
    group,
    repositories: repositories.map(repository => ({ repository, files: sourceRepositoryFiles(repository, repositories, state.selectionMode).filter(file => {
      const kind = repository.snapshot.conflictFiles.includes(file.path) ? 'conflicts' : file.indexStatus === '?' ? 'untracked' : 'changes';
      return kind === group && (!filteredQuery || `${repository.name}/${repository.relativePath}/${file.path}`.toLocaleLowerCase().includes(filteredQuery));
    }) })).filter(item => item.files.length),
  })).filter(item => item.repositories.length);
  const allPaths = repositories.flatMap(repository => sourceRepositoryFiles(repository, repositories, state.selectionMode));
  const repository = repositories.find(repository => repository.id === focusedId) ?? repositories[0] ?? null;
  const collapse = (key: string) => update(current => ({ ...current, collapsed: current.collapsed.includes(key) ? current.collapsed.filter(item => item !== key) : [...current.collapsed, key] }));
  const selectRepository = (repositoryId: string) => update({ focus: { repositoryId, path: '' } });
  const statuses = zh ? { queued: '等待提交', committing: '提交中', committed: '已提交', commit_failed: '提交失败', blocked: '未提交', pushing: '推送中', done: '已推送', push_failed: '推送失败', push_blocked: '待推送', unknown: '请核对结果' } : { queued: 'Queued', committing: 'Committing', committed: 'Committed', commit_failed: 'Commit failed', blocked: 'Blocked', pushing: 'Pushing', done: 'Pushed', push_failed: 'Push failed', push_blocked: 'Push pending', unknown: 'Check outcome' };
  return <main ref={shell} className="source-git-shell">
    <aside className="source-git-sidebar">
      <header className="source-git-heading"><strong>{label('更改', 'Changes')} <small>{allPaths.length}</small></strong></header>
      <div className="source-git-tabs" role="tablist" aria-label={label('更改工具窗口', 'Changes tool window')}>
        <button type="button" role="tab" aria-selected={tab === 'commit'} onClick={() => setTab('commit')}>{label('提交', 'Commit')}</button>
        <button type="button" role="tab" aria-selected={tab === 'stash'} onClick={() => setTab('stash')}>{label('贮藏', 'Stash')} <small>{repositories.reduce((count, repository) => count + repository.snapshot.stashes.length, 0)}</small></button>
        <button type="button" className="source-git-icon" disabled={locked || loading} onClick={() => void refresh().catch(reason => setError(gitFailureText(reason)))} aria-label={label('刷新项目更改', 'Refresh project changes')} title={label('刷新更改', 'Refresh changes')}><ArrowsClockwise className={loading ? 'is-spinning' : ''} /></button>
      </div>
      <SourceRepositoryControls projectId={project.id} client={client} zh={zh} repositories={repositories} repository={repository} busy={operation} locked={locked} errorsByRepository={operationErrors.current} onSelectRepository={selectRepository} onExecute={execute} onCommit={() => { setTab('commit'); messageInput.current?.focus(); }} />
      {tab === 'commit' ? <>
        <div className="source-git-file-tools">
          <label className="source-git-search"><MagnifyingGlass aria-hidden="true" /><input type="search" value={state.search} onChange={event => update({ search: event.target.value })} aria-label={label('筛选文件', 'Filter files')} placeholder={label('筛选文件…', 'Filter files…')} /></label>
          <span className="project-git-file-view-control" title={state.fileView === 'flat' ? label('平铺结构', 'Flat view') : label('树状结构', 'Tree view')}>
            {state.fileView === 'flat' ? <ListBullets aria-hidden="true" /> : <TreeStructure aria-hidden="true" />}<CaretDown aria-hidden="true" />
            <select className="project-git-file-view-select" aria-label={label('更改文件显示方式', 'Changed file view')} value={state.fileView} onChange={event => update({ fileView: event.target.value === 'flat' ? 'flat' : 'tree' })}><option value="tree">{label('树状结构', 'Tree view')}</option><option value="flat">{label('平铺结构', 'Flat view')}</option></select>
          </span>
          {state.selectionMode === 'staged' ? <small className="source-git-scope-badge" title={label('可在提交选项中切换内容范围', 'Change content scope in commit options')}>{label('仅已暂存', 'Staged only')}</small> : null}
        </div>
        <div ref={commitLayout} className="source-git-commit-layout">
        <div className="source-git-files" aria-busy={loading}>
          {fileGroups.map(({ group, repositories: groups }) => <section key={group} className="source-git-group" aria-label={groupLabels[group]}>
            <button type="button" className="source-git-group-heading" aria-expanded={!state.collapsed.includes(group)} onClick={() => collapse(group)}>{state.collapsed.includes(group) ? <CaretRight /> : <CaretDown />}<strong>{groupLabels[group]}</strong><small>{groups.reduce((count, item) => count + item.files.length, 0)}</small></button>
            {state.collapsed.includes(group) ? null : groups.map(({ repository, files }) => <SourceRepositoryTree key={repository.id} repository={repository} files={files} selected={state.selected[repository.id] ?? []} focusedPath={focusedPath} focusedRepository={focusedId} collapsed={state.collapsed} view={state.fileView} group={group} selectable={group !== 'conflicts'} disabled={locked} zh={zh} onToggle={(paths, checked) => toggle(repository.id, paths, checked)} onFocus={path => update({ focus: { repositoryId: repository.id, path } })} onSelectRepository={() => selectRepository(repository.id)} onCollapse={collapse} />)}
          </section>)}
          {!fileGroups.length ? <p className="source-git-empty">{!snapshot ? label('正在发现项目内仓库…', 'Discovering repositories…') : allPaths.length && filteredQuery ? label('没有匹配的更改文件', 'No matching changed files') : label('当前范围没有更改。', 'No changes in this scope.')}</p> : null}
        </div>
        <GitPaneSeparator name="source-files" label={label('调整文件列表与提交说明区域高度', 'Resize file list and commit message')} axis="y" initial={82} min={paneBounds.min} max={paneBounds.max} />
        <section ref={composer} className="source-git-composer">
          {state.messageMode === 'individual' ? <div className="source-git-draft-repository"><label>{label('仓库说明', 'Repository draft')} <select aria-label={label('编辑仓库说明', 'Repository draft')} value={editorRepository} disabled={locked} onChange={event => setDraftRepository(event.target.value)}>{units.map(unit => <option key={unit.repository.id} value={unit.repository.id}>{unit.repository.name}</option>)}</select></label></div> : null}
          <div className="source-git-template">
            {state.messageMode === 'shared' && templateRepositories.length > 1 ? <select aria-label={label('提交模板来源仓库', 'Commit template source repository')} value={templateRepositoryId} disabled={locked} onChange={event => setTemplateSource(event.target.value)}><option value="">{label('选择模板来源仓库', 'Choose a template repository')}</option>{templateRepositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select> : null}
            <GitCommitTemplateControl key={`${project.id}:${state.messageMode}:${templateRepositoryId}`} client={client} projectId={project.id} repositoryId={templateRepositoryId} repositoryName={templateRepositories.find(repository => repository.id === templateRepositoryId)?.name} value={selectedMessage} zh={zh} disabled={locked} active={active && tab === 'commit'} autoFill={state.messageMode === 'individual' || templateRepositories.length === 1} onApply={(message, expected) => update(current => current.messageMode !== state.messageMode ? current : current.messageMode === 'shared' ? current.sharedMessage === expected ? { ...current, sharedMessage: message } : current : (current.drafts[templateRepositoryId] ?? '') === expected ? { ...current, drafts: { ...current.drafts, [templateRepositoryId]: message } } : current)} />
          </div>
          <div className="source-git-message">
            <textarea ref={messageInput} rows={3} aria-label={label('项目提交说明', 'Project commit message')} value={selectedMessage} disabled={locked || (state.messageMode === 'individual' && !editorRepository)} onChange={event => setMessage(event.target.value)} placeholder={label('提交说明', 'Commit message')} />
            <button type="button" className="source-git-icon source-git-generate" aria-label={generating ? label('停止生成', 'Stop generation') : label('AI 填写', 'AI draft')} title={generating ? label('停止生成', 'Stop generation') : !units.length ? label('请先勾选要提交的文件', 'Select files to commit first') : `${label('根据勾选内容生成提交说明', 'Generate from selected content')} · ${models.find(item => item.id === model)?.label ?? model}`} disabled={busy || reviewBusy || operation !== null || (!generating && (!model || !units.length))} data-generating={generating} onClick={() => generating ? generation.current?.abort() : void generate()}>{generating ? <Stop weight="fill" /> : <Sparkle />}</button>
          </div>
          <div className="source-git-count">{label('已选择', 'Selected')} {filesCount} {label('个文件', 'files')}{units.length > 1 ? ` · ${units.length} ${label('个仓库', 'repositories')}` : ''}</div>
          <div className="source-git-actions"><button type="button" className="source-git-primary" disabled={locked || !units.length} onClick={() => void prepare(false)}>{label('提交…', 'Commit…')}</button><button type="button" disabled={locked || !units.length} onClick={() => void prepare(true)}>{label('提交并推送…', 'Commit and push…')}</button>{busy ? <button type="button" onClick={() => { stopped.current = true; if (activeRepository.current) void client.cancelProjectGitAction(project.id, activeRepository.current).catch(reason => setError(gitFailureText(reason))); }}>{label('停止批次', 'Stop batch')}</button> : null}
            <SourceCommitOptions active={active} zh={zh}>
              <label>{label('提交内容范围', 'Commit content mode')}<select aria-label={label('提交内容范围', 'Commit content mode')} value={state.selectionMode} disabled={locked} onChange={event => { update({ selectionMode: event.target.value === 'staged' ? 'staged' : 'worktree', fingerprints: {} }); setFeedback(''); }}><option value="worktree">{label('全部工作区更改', 'Full working tree changes')}</option><option value="staged">{label('仅已暂存内容', 'Staged content only')}</option></select></label>
              <label>{label('提交说明模式', 'Commit message mode')}<select aria-label={label('提交说明模式', 'Commit message mode')} value={state.messageMode} disabled={locked} onChange={event => update({ messageMode: event.target.value === 'individual' ? 'individual' : 'shared' })}><option value="shared">{label('共用提交说明', 'Shared message')}</option><option value="individual">{label('每个仓库单独填写', 'Message per repository')}</option></select></label>
              <label>{label('AI 模型', 'AI model')}<select aria-label={label('源码提交模型', 'Source commit model')} value={model} disabled={locked} onChange={event => { setModel(event.target.value); try { localStorage.setItem(`astragit.commit-model.${project.id}`, event.target.value); } catch { /* 使用当前模型。 */ } }}>{models.length ? models.map(value => <option key={value.id} value={value.id}>{value.label}</option>) : <option value="">{label('请在 AI 设置中配置模型', 'Configure a model in AI settings')}</option>}</select></label>
              {model && modelWarning ? <small>{modelWarning}</small> : null}
              <label className="source-git-parent-option"><input type="checkbox" checked={updateParents} disabled={locked || state.selectionMode === 'staged'} onChange={event => update({ updateParents: event.target.checked })} />{label('同时更新父仓库的子模块引用', 'Update parent submodule references')}</label>
              <small>{state.selectionMode === 'staged' ? label('只提交勾选文件的暂存版本，保留工作区后续修改。', 'Commits selected staged versions; preserves later working tree edits.') : label('勾选决定提交范围，包含所选文件未暂存内容。', 'Checkboxes set commit scope, including selected unstaged content.')}</small>
            </SourceCommitOptions>
          </div>
          {feedback || (!model && modelWarning) ? <p className="source-git-feedback" role="status">{feedback || modelWarning}</p> : null}
        </section>
        </div>
      </> : <div className="source-git-files source-git-stashes">
        {repositories.filter(repository => repository.snapshot.stashes.length).map(repository => <details key={repository.id} open><summary>{repository.name} <small>{repository.snapshot.stashes.length}</small></summary>{repository.snapshot.stashes.map(stash => <div key={stash.ref} className="source-git-stash"><button type="button" title={stash.subject} onClick={() => setStashPreview({ repositoryId: repository.id, commitHash: stash.ref })}><Archive /><span>{stash.subject}<small>{stash.ref}</small></span></button><button type="button" disabled={locked} onClick={() => void execute(repository, { type: 'apply_stash', stashRef: stash.ref }, label('应用贮藏', 'Apply stash'))}>{label('应用', 'Apply')}</button></div>)}</details>)}
        {!repositories.some(repository => repository.snapshot.stashes.length) ? <p className="source-git-empty">{label('没有贮藏的更改', 'No stashed changes')}</p> : null}
      </div>}
      {error ? <p className="source-git-error" role="alert"><VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} /></p> : null}
    </aside>
    <GitPaneSeparator name="source-sidebar" label={label('调整项目更改列表宽度', 'Resize project changes sidebar')} initial={32} min={sidebarBounds.min} max={sidebarBounds.max} />
    <section ref={detail} className={`source-git-detail${state.lastResults.length ? ' has-results' : ''}`}><div className="source-git-diff">{focusedConflict && focusedId && focusedPath ? <GitConflictEditor client={client} projectId={project.id} repositoryId={focusedId} filePath={focusedPath} zh={zh} disabled={locked} onSaved={result => conflictSaved(focusedId, focusedPath, result)} /> : focusedPath && (diffTarget !== currentDiffTarget || (diffLoading && !diff)) ? <p className="source-git-empty">{label('正在读取实际提交差异…', 'Loading selected commit diff…')}</p> : diffError && diffTarget === currentDiffTarget ? <p className="source-git-error" role="alert"><VisibleApplicationError error={diffError} language={zh ? 'zh-CN' : 'en'} /></p> : focusedPath && diff && diffTarget === currentDiffTarget ? <SideBySideDiff diff={diff} zh={zh} title={`${focusedRepository?.name ?? ''} / ${focusedPath}`} fill /> : <div className="source-git-empty"><h3>{label('选择文件查看差异', 'Select a file to see its diff')}</h3><p>{label('左侧按仓库分组勾选，查看文件不会改变勾选范围。', 'Select files by repository. Previewing a file preserves your selection.')}</p></div>}</div>
      {state.lastResults.length ? <><GitPaneSeparator name="source-results" label={label('调整差异与批次结果区域高度', 'Resize diff and batch results')} axis="y" initial={78} min={resultsBounds.min} max={resultsBounds.max} /><section className="source-git-results" aria-label={label('批次结果', 'Batch results')}><header><strong>{label('最近一次批次', 'Last batch')}</strong>{state.lastResults.some(result => ['push_failed', 'push_blocked'].includes(result.status) && result.commitSha) ? <button type="button" disabled={locked} onClick={() => void retryPush()}>{label('重试失败的推送', 'Retry failed pushes')}</button> : null}</header>{state.lastResults.map(result => <div key={result.repositoryId}><strong>{result.repositoryName}</strong><span>{statuses[result.status]}</span>{result.commitSha ? <code title={result.commitSha}>{result.commitSha.slice(0, 8)}</code> : null}{result.error ? <p><VisibleApplicationError error={result.error} language={zh ? 'zh-CN' : 'en'} /></p> : null}</div>)}</section></> : null}
    </section>
    {stashPreview ? <ModalPortal role="dialog" aria-label={label('贮藏差异', 'Stash diff')} rootClassName="gitapp-diff-root" onDismiss={() => setStashPreview(null)}><div className="gitapp-diff-dialog" data-modal-surface="dialog"><header><strong>{label('贮藏差异', 'Stash diff')}</strong><button type="button" onClick={() => setStashPreview(null)}>{label('关闭', 'Close')}</button></header><ProjectGitDiffWindow client={client} projectId={project.id} {...stashPreview} filePath="" stage="combined" language={props.language} appearance="light" /></div></ModalPortal> : null}
    {review ? <SourceCommitReview rows={review.rows} push={review.push} zh={zh} busy={reviewBusy} error={reviewError} onChange={rows => setReview({ ...review, rows })} onClose={() => setReview(null)} onConfirm={() => void confirm()} /> : null}
  </main>;
}
