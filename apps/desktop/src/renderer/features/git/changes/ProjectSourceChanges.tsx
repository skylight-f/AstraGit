import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type RefObject, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { ListBullets } from '@phosphor-icons/react/dist/csr/ListBullets';
import { TreeStructure } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { Archive } from '@phosphor-icons/react/dist/csr/Archive';
import type { DashboardClient, GitDiffSummary, ProjectGitAction, ProjectGitWorkbenchSnapshot, ProjectGitRepositorySnapshot, ProjectGitRepositoryWorkbenchItem, ProjectRecord } from '../../../api/apiClient.js';
import { GitCommitAiControls } from '../commits/GitCommitAiControls.js';
import type { GitCommitModelState } from '../../models/useGitCommitModels.js';
import { ProjectGitDiffWindow, SideBySideDiff } from '../diff/ProjectGitDiffViewer.js';
import { GitConflictEditor } from '../conflicts/GitConflictEditor.js';
import { GitContextMenu, GitMenuActionDialog, type GitMenuConfirmation, type GitMenuItem } from '../components/GitContextMenu.js';
import { createApplyStashConfirmation } from '../stash/applyStashConfirmation.js';
import { notifyProjectGitChanged, projectGitWorkbenchCacheEntry, requestProjectGitWorkbench, subscribeProjectGitRefresh } from '../workbench/projectGitWorkbenchState.js';
import { SourceRepositoryLabel, SourceRepositoryTree } from './SourceFileTree.js';
import { stagedCommitUnits, type SourceCommitUnit, readSourceGitState, sourceRepositoryFiles, writeSourceGitState, type SourceGitState } from './sourceGitState.js';
import { previewForUnit, pushSourceResult, runSourceBatch, validateSourceReview, type SourceReviewRow } from './sourceGitBatch.js';
import { batchDraftScope, batchSummaryId, clearDraftsOnBatchCommit, repositoryDraftScope, sourceReviewMessages, type GitCommitDrafts } from '../commits/useGitCommitDrafts.js';
import { navigateGitFileRows } from './gitFileSelection.js';
import { fileStagingState } from './gitFileStages.js';
import { createPushDraft } from '../repository/pushTarget.js';
import { SourceCommitReview, type SourceReviewDraft } from './SourceCommitReview.js';
import { SourceCommitOptions } from './SourceCommitOptions.js';
import { SourceRepositoryControls } from './SourceRepositoryControls.js';
import { GitPaneSeparator, workspacePaneReferenceWidth } from '../components/GitPaneSeparator.js';
import type { BusyState, ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';
import { reportApplicationError, VisibleApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import { gitConflictMessage, gitFailureText, gitFailureTitle, gitPostActionRefreshError } from '../workbench/gitOperationFeedback.js';
import './sourceGit.css';

type StashEntry = ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number];

export interface SourceCommitCommands {
  focusCommit(): void;
  refresh(): void;
}

export function ProjectSourceChanges(props: {
  project: ProjectRecord;
  client: DashboardClient;
  language: 'zh-CN' | 'en-US';
  active: boolean;
  commitModels: GitCommitModelState;
  onOpenModelSettings: () => void;
  onBusyChange: (busy: boolean) => void;
  commandsRef: Ref<SourceCommitCommands>;
  repositoryCommandBusy: boolean;
  snapshot: ProjectGitWorkbenchSnapshot | null;
  setSnapshot: Dispatch<SetStateAction<ProjectGitWorkbenchSnapshot | null>>;
  refreshVersion: RefObject<number>;
  commitMessages: GitCommitDrafts;
  selectedRepositoryId: string;
  onSelectRepository: (id: string) => void;
  generationPreview: { id: string; text: string } | null;
  generatingFor: string | null;
  onGenerate: (units: SourceCommitUnit[], summary?: boolean) => Promise<void>;
  onStopGeneration: () => void;
  onStageAction: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, title: string) => Promise<ExecutionOutcome>;
  onCommandTargetChange: (target: { repositoryId: string | undefined; locked: boolean }) => void;
}) {
  const { client, project, active, onBusyChange } = props;
  const { items: models, modelRef: model, loading: modelsLoading } = props.commitModels;
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
  const { snapshot, setSnapshot, refreshVersion, commitMessages } = props;
  const snapshotRef = useRef(snapshot);
  const [loading, setLoading] = useState(false);
  snapshotRef.current = snapshot;
  const lastRefresh = useRef(0);
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
  const [stashPreview, setStashPreview] = useState<{ repositoryId: string; ref: string; hash: string } | null>(null);
  const [stashMenu, setStashMenu] = useState<{ repositoryId: string; stash: StashEntry; x: number; y: number } | null>(null);
  const [stashConfirmation, setStashConfirmation] = useState<GitMenuConfirmation | null>(null);
  useEffect(() => {
    if (!active || tab !== 'stash') setStashMenu(null);
  }, [active, tab]);
  const [error, setError] = useState<unknown>(null);
  const operationErrors = useRef<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stopped = useRef(false);
  const activeRepository = useRef<string | null>(null);
  const generating = props.generatingFor !== null;
  const updateParents = state.updateParents;
  const [summary, setEditingSummary] = useState(false);
  const [review, setReview] = useState<{ rows: SourceReviewDraft[]; units: SourceCommitUnit[]; push: boolean; preferredRepositoryId?: string } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [diffTarget, setDiffTarget] = useState('');
  const [diffError, setDiffError] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    lastRefresh.current = version;
    setLoading(true);
    try {
      const value = await requestProjectGitWorkbench(client, project.id);
      if (currentProjectId.current !== project.id || version !== refreshVersion.current) return value;
      snapshotRef.current = value;
      setSnapshot(value);
      return value;
    } finally { if (currentProjectId.current === project.id && version === lastRefresh.current) setLoading(false); }
  }, [client, project.id, refreshVersion, setSnapshot]);
  useEffect(() => {
    if (!active) return;
    // 原生下拉菜单与草稿编辑期间不重绘列表；提交前仍重新读取并核对指纹。
    const load = () => { if (!busyRef.current && !generating && !props.repositoryCommandBusy && !document.querySelector('dialog[open], .git-pane-separator[data-dragging]') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) void refresh().catch(reason => setError(gitFailureText(reason))); };
    load(); const unsubscribe = subscribeProjectGitRefresh(project.id, load);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [active, project.id, refresh, generating, props.repositoryCommandBusy]);
  useEffect(() => () => { stopped.current = true; onBusyChange(false); }, [onBusyChange]);
  const repositories = snapshot?.repositories ?? [];
  const units = useMemo(() => stagedCommitUnits(snapshot?.repositories ?? [], updateParents), [snapshot, updateParents]);
  const filesCount = units.reduce((sum, unit) => sum + unit.paths.length, 0);
  const editor = repositories.find(item => item.id === props.selectedRepositoryId) ?? units[0]?.repository
    ?? repositories.find(item => item.id === state.focus?.repositoryId) ?? repositories[0];
  const editorId = summary ? batchSummaryId : editor?.id ?? '';
  const editorUnit = units.find(unit => unit.repository.id === editorId);
  const draft = commitMessages.drafts[editorId];
  const selectedMessage = props.generationPreview?.id === editorId ? props.generationPreview.text : draft?.message ?? '';
  const scope = summary ? batchDraftScope(units) : editor && repositoryDraftScope(editor.snapshot, editorUnit?.gitlinks);
  const staleDraft = Boolean(draft?.scope && scope && draft.scope !== scope);
  const sourceLocked = busy || generating || reviewBusy || review !== null || operation !== null;
  const locked = sourceLocked || props.repositoryCommandBusy;
  const editorFeedback = staleDraft
    ? label('提交范围已变化，可重新生成。', 'Staged content changed. You can regenerate the message.')
    : commitMessages.generationFeedback[editorId];
  const hasFeedback = Boolean(feedback || editorFeedback);
  const modelName = models.find(item => item.id === model)?.label;
  const aiActionTitle = (summary ? units.length > 0 : Boolean(editorUnit))
    ? `${summary ? label('生成批次摘要，并补齐各仓库的空白提交说明', 'Generate a batch summary and fill empty repository messages') : label('根据当前仓库已暂存内容生成说明', 'Generate from staged changes in this repository')} · ${modelName ?? model}`
    : label('请先暂存要提交的改动', 'Stage changes to commit first');
  useLayoutEffect(() => {
    const root = shell.current;
    const right = detail.current;
    if (!root || !right) return;
    const measure = () => {
      const width = workspacePaneReferenceWidth(root);
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
  }, [tab, hasFeedback]);
  const focusedId = editor?.id;
  const focusedPath = state.focus?.repositoryId === focusedId ? state.focus?.path : undefined;
  const focusedRepository = repositories.find(repository => repository.id === focusedId);
  const focusedConflict = Boolean(focusedPath && focusedRepository?.snapshot.conflictFiles.includes(focusedPath));
  const focusedFile = focusedRepository?.snapshot.fileStatuses.find(file => file.path === focusedPath);
  const diffMode = focusedFile && fileStagingState(focusedFile) !== 'unstaged' ? 'staged' : 'worktree';
  const currentDiffTarget = JSON.stringify([focusedId, focusedPath, diffMode]);
  useEffect(() => {
    if (!active || !focusedId || !focusedPath) return;
    const repository = snapshot?.repositories.find(repo => repo.id === focusedId);
    if (!repository || repository.snapshot.conflictFiles.includes(focusedPath) || !sourceRepositoryFiles(repository, snapshot!.repositories, 'worktree').some(file => file.path === focusedPath)) { setDiffTarget(currentDiffTarget); setDiff(null); setDiffError(''); setDiffLoading(false); return; }
    // Refresh the same file without unmounting its panes, scroll position or layout mode.
    const controller = new AbortController(); setDiffLoading(true); setDiffError('');
    void client.previewGitCommitSelection(project.id, [{ repositoryId: repository.id, relativePath: repository.relativePath, paths: [focusedPath] }], diffMode, controller.signal).then(value => { if (!controller.signal.aborted) { setDiffTarget(currentDiffTarget); setDiff(value.repositories[0]?.diff ?? null); } }).catch(reason => { if (!controller.signal.aborted) { setDiffTarget(currentDiffTarget); setDiff(null); setDiffError(gitFailureText(reason)); } }).finally(() => { if (!controller.signal.aborted) setDiffLoading(false); });
    return () => controller.abort();
  }, [active, client, focusedId, focusedPath, project.id, snapshot, diffMode, currentDiffTarget]);
  async function prepare(push: boolean) {
    if (locked || !units.length) return;
    setReviewBusy(true); setError(''); setReviewError('');
    try {
      const fresh = await refresh();
      const currentUnits = stagedCommitUnits(fresh.repositories, updateParents);
      const targets = currentUnits.filter(unit => unit.ordinaryPaths.length).map(unit => ({ repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths }));
      const preview = targets.length ? await client.previewGitCommitSelection(project.id, targets, 'staged') : null;
      const { messages, preferredRepositoryId, stale } = sourceReviewMessages(currentUnits, commitMessages.drafts, editorId);
      const rows: SourceReviewDraft[] = currentUnits.map(unit => {
        const value = previewForUnit(unit, preview);
        const { repository } = unit;
        if (value && (value.branch !== repository.snapshot.branch || value.detached !== repository.snapshot.detached)) throw new Error(`${repository.name}: ${label('仓库分支已变化，请重新预览。', 'The branch changed. Reopen the review.')}`);
        if (repository.snapshot.conflictFiles.length || repository.snapshot.integrationState) throw new Error(`${repository.name}: ${label('请先在工作台解决冲突或完成合并。', 'Resolve conflicts or complete integration in the workbench first.')}`);
        if (value && !value.diff.diffText.trim() && !unit.gitlinks.length) throw new Error(`${repository.name}: ${label('所选内容没有可提交的差异。', 'No committable changes in the selection.')}`);
        return {
          repositoryId: repository.id,
          repositoryName: repository.name,
          relativePath: repository.relativePath,
          branch: repository.snapshot.branch,
          expectedHead: value?.headSha ?? repository.snapshot.headSha,
          fingerprint: value?.fingerprint,
          expectedIndex: repository.snapshot.indexFingerprint,
          mode: 'staged',
          paths: unit.paths,
          ordinaryPaths: unit.ordinaryPaths,
          gitlinks: unit.gitlinks,
          dependsOn: unit.dependsOn,
          message: messages.get(repository.id) ?? '',
          snapshot: repository.snapshot,
          pushDraft: createPushDraft(repository.snapshot),
          status: 'queued',
        };
      });
      if (!rows.length) throw new Error(label('所选文件已无更改，请重新选择。', 'Selected files have no remaining changes.'));
      if (stale) setReviewError(label('填写说明后暂存内容已变化，请检查本次说明与文件列表后再确认。', 'Staged content changed after this message was written. Review the message and file list.'));
      setReview({ rows, units: currentUnits, push, preferredRepositoryId });
    } catch (reason) { setError(gitFailureText(reason)); }
    finally { setReviewBusy(false); }
  }
  async function confirm(rows: SourceReviewRow[]) {
    if (!review || busyRef.current || reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    let batchStarted = false;
    try {
      await validateSourceReview(client, project.id, rows, review.push);
      // Keep approved shared messages available if the batch only commits some repositories.
      for (const row of review.rows) {
        const saved = commitMessages.drafts[row.repositoryId]?.message ?? '';
        if (!saved.trim()) commitMessages.write(row.repositoryId, row.message, repositoryDraftScope(row.snapshot, row.gitlinks), saved);
      }
      busyRef.current = true; setBusy(true); onBusyChange(true); stopped.current = false; setReview(null);
      batchStarted = true;
      await runSourceBatch({ client, projectId: project.id, rows, push: review.push, stopped: () => stopped.current,
        onActive: id => { activeRepository.current = id; }, onResults: lastResults => update({ lastResults }),
        onCommitted: clearDraftsOnBatchCommit(review.units, rows, commitMessages),
      });
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
      ++refreshVersion.current;
      projectGitWorkbenchCacheEntry(client, project.id).request = null;
      if (snapshotRef.current) {
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
        const ordinary = sourceRepositoryFiles({ ...repository, snapshot: saved }, snapshotRef.current?.repositories ?? [], 'worktree');
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
  function previewStash(repositoryId: string, stash: StashEntry) {
    setStashPreview({ repositoryId, ref: stash.ref, hash: stash.hash });
  }

  function openStashMenu(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, repositoryId: string, stash: StashEntry) {
    if ('key' in event && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.querySelector('button')?.focus({ preventScroll: true });
    const position = 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: bounds.left, y: bounds.bottom + 4 };
    setStashMenu({ repositoryId, stash, ...position });
  }

  function confirmApplyStash(repository: ProjectGitRepositoryWorkbenchItem, stash: StashEntry) {
    setStashConfirmation(createApplyStashConfirmation(repository, stash, zh, execute));
  }

  function stashMenuItems(repository: ProjectGitRepositoryWorkbenchItem, stash: StashEntry): GitMenuItem[] {
    const target = { stashRef: stash.ref, expectedStashHash: stash.hash };
    function confirmAction(title: string, description: string, action: ProjectGitAction, danger = false): GitMenuItem {
      return {
        label: `${title}…`,
        disabled: locked,
        danger,
        run: () => setStashConfirmation({
          title,
          description: `${repository.name} · ${stash.ref} · ${stash.subject}\n${description}`,
          danger,
          run: async () => (await execute(repository, action, title)) !== null,
        }),
      };
    }

    return [
      { label: label('查看差异', 'View diff'), run: () => previewStash(repository.id, stash) },
      { label: label('应用贮藏…', 'Apply stash…'), disabled: locked, run: () => confirmApplyStash(repository, stash) },
      { label: label('复制贮藏引用', 'Copy stash reference'), run: () => navigator.clipboard.writeText(stash.ref) },
      confirmAction(label('删除贮藏', 'Drop stash'), label('将永久删除这条贮藏。', 'This permanently deletes the selected stash.'), { type: 'drop_stash', ...target }, true),
    ];
  }

  const filteredQuery = state.search.trim().toLocaleLowerCase();
  const changesByRepository = repositories.map(repository => ({
    repository,
    files: sourceRepositoryFiles(repository, repositories, state.stagedOnly ? 'staged' : 'worktree'),
  }));
  const changeCount = changesByRepository.reduce((total, { files }) => total + files.length, 0);
  const visibleRepositories = changesByRepository.map(({ repository, files }) => ({
    repository,
    files: filteredQuery ? files.filter(file => `${repository.name}/${repository.relativePath}/${file.path}`.toLocaleLowerCase().includes(filteredQuery)) : files,
  })).filter(({ files }) => files.length > 0);
  const repositoriesWithStashes = repositories.filter(repository => repository.snapshot.stashes.length > 0);
  const stashMenuRepository = stashMenu && repositoriesWithStashes.find(repository => repository.id === stashMenu.repositoryId);
  const stashRepository = repositoriesWithStashes.find(repository => repository.id === stashPreview?.repositoryId);
  const selectedStash = stashPreview && stashRepository
    ? stashRepository.snapshot.stashes.find(stash => stash.hash === stashPreview.hash && stash.ref === stashPreview.ref)
      ?? stashRepository.snapshot.stashes.find(stash => stash.hash === stashPreview.hash)
    : undefined;
  const repository = repositories.find(repository => repository.id === focusedId) ?? repositories[0] ?? null;
  const repositoryId = repository?.id;
  const { onCommandTargetChange } = props;
  useLayoutEffect(() => {
    onCommandTargetChange({ repositoryId, locked: sourceLocked });
  }, [onCommandTargetChange, repositoryId, sourceLocked]);
  const focusCommit = useCallback(() => {
    setTab('commit');
    requestAnimationFrame(() => messageInput.current?.focus());
  }, []);
  useImperativeHandle(props.commandsRef, () => ({
    focusCommit,
    refresh() { void refresh().catch(reason => setError(gitFailureText(reason))); },
  }), [focusCommit, refresh]);
  const collapse = (key: string) => update(current => ({ ...current, collapsed: current.collapsed.includes(key) ? current.collapsed.filter(item => item !== key) : [...current.collapsed, key] }));
  const selectRepository = (repositoryId: string, path = '') => {
    setEditingSummary(false);
    props.onSelectRepository(repositoryId);
    update({ focus: { repositoryId, path } });
  };
  const statuses = zh ? { queued: '等待提交', committing: '提交中', committed: '已提交', commit_failed: '提交失败', blocked: '未提交', pushing: '推送中', done: '已推送', push_failed: '推送失败', push_blocked: '待推送', unknown: '请核对结果' } : { queued: 'Queued', committing: 'Committing', committed: 'Committed', commit_failed: 'Commit failed', blocked: 'Blocked', pushing: 'Pushing', done: 'Pushed', push_failed: 'Push failed', push_blocked: 'Push pending', unknown: 'Check outcome' };
  return <main ref={shell} className="source-git-shell">
    <aside className="source-git-sidebar">
      <header className="source-git-heading">
        <strong>{label('更改', 'Changes')} <small>{changeCount}</small></strong>
        <div className="source-git-tabs" role="tablist" aria-label={label('更改工具窗口', 'Changes tool window')}>
          <button type="button" role="tab" aria-selected={tab === 'commit'} onClick={() => setTab('commit')}>{label('提交', 'Commit')}</button>
          <button type="button" role="tab" aria-selected={tab === 'stash'} onClick={() => setTab('stash')}>{label('贮藏', 'Stash')} <small>{repositoriesWithStashes.reduce((count, repository) => count + repository.snapshot.stashes.length, 0)}</small></button>
        </div>
        <button type="button" className="source-git-icon" disabled={locked || loading} onClick={() => void refresh().catch(reason => setError(gitFailureText(reason)))} aria-label={label('刷新项目更改', 'Refresh project changes')} title={label('刷新更改', 'Refresh changes')}><ArrowsClockwise className={loading ? 'is-spinning' : ''} /></button>
      </header>
      <SourceRepositoryControls projectId={project.id} client={client} zh={zh} repositories={repositories} repository={repository} busy={operation} locked={locked} errorsByRepository={operationErrors.current} onSelectRepository={selectRepository} onExecute={execute} onCommit={focusCommit} />
      {tab === 'commit' ? <>
        <div className="source-git-file-tools">
          <label className="source-git-search"><MagnifyingGlass aria-hidden="true" /><input type="search" value={state.search} onChange={event => update({ search: event.target.value })} aria-label={label('筛选文件', 'Filter files')} placeholder={label('筛选文件…', 'Filter files…')} /></label>
          <span className="project-git-file-view-control" title={state.fileView === 'flat' ? label('平铺结构', 'Flat view') : label('树状结构', 'Tree view')}>
            {state.fileView === 'flat' ? <ListBullets aria-hidden="true" /> : <TreeStructure aria-hidden="true" />}<CaretDown aria-hidden="true" />
            <select className="project-git-file-view-select" aria-label={label('更改文件显示方式', 'Changed file view')} value={state.fileView} onChange={event => update({ fileView: event.target.value === 'flat' ? 'flat' : 'tree' })}><option value="tree">{label('树状结构', 'Tree view')}</option><option value="flat">{label('平铺结构', 'Flat view')}</option></select>
          </span>
          {state.stagedOnly ? <small className="source-git-scope-badge" title={label('仅显示已暂存文件', 'Showing staged files only')}>{label('仅已暂存', 'Staged only')}</small> : null}
        </div>
        <div ref={commitLayout} className="source-git-commit-layout">
        <div className="source-git-files" aria-busy={loading} onKeyDown={navigateGitFileRows}>
          {visibleRepositories.map(({ repository, files }) => (
            <SourceRepositoryTree
              key={repository.id}
              repository={repository}
              files={files}
              focusedPath={focusedId === repository.id ? focusedPath : undefined}
              collapsed={state.collapsed}
              view={state.fileView}
              disabled={locked}
              zh={zh}
              onToggle={(paths, checked) => {
                setEditingSummary(false);
                props.onSelectRepository(repository.id);
                void props.onStageAction(repository, { type: checked ? 'stage' : 'unstage', paths }, checked ? label('暂存文件', 'Stage files') : label('取消暂存文件', 'Unstage files'));
              }}
              onFocus={path => selectRepository(repository.id, path)}
              onSelectRepository={() => selectRepository(repository.id)}
              onCollapse={collapse}
            />
          ))}
          {!visibleRepositories.length ? <p className="source-git-empty">{!snapshot ? label('正在发现项目内仓库…', 'Discovering repositories…') : changeCount && filteredQuery ? label('没有匹配的更改文件', 'No matching changed files') : label('当前范围没有更改。', 'No changes in this scope.')}</p> : null}
        </div>
        <GitPaneSeparator name="source-files" label={label('调整文件列表与提交说明区域高度', 'Resize file list and commit message')} axis="y" initial={82} min={paneBounds.min} max={paneBounds.max} />
        <section ref={composer} className="source-git-composer">
          <div className="source-git-draft-repository"><label>{label('提交说明', 'Commit message')} <select aria-label={label('编辑仓库说明', 'Repository draft')} value={editorId} disabled={locked} onChange={event => {
              if (event.target.value === batchSummaryId) setEditingSummary(true);
              else selectRepository(event.target.value);
            }}>
            {repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            {(units.length > 1 || summary || commitMessages.drafts[batchSummaryId]) && <option value={batchSummaryId}>{label('批次摘要', 'Batch summary')}</option>}
          </select></label></div>
          <GitCommitAiControls
            zh={zh}
            models={props.commitModels}
            modelDisabled={locked}
            generating={props.generatingFor === editorId}
            title={aiActionTitle}
            disabled={props.generatingFor !== editorId && (locked || modelsLoading || !model || (summary ? !units.length : !editorUnit))}
            onClick={() => generating ? props.onStopGeneration() : void props.onGenerate(summary ? units : editorUnit ? [editorUnit] : [], summary)}
            onOpenSettings={props.onOpenModelSettings}
          />
          <div className="source-git-message">
            <textarea ref={messageInput} rows={3} aria-label={label('项目提交说明', 'Project commit message')} value={selectedMessage} disabled={locked || !editorId} onChange={event => commitMessages.write(editorId, event.target.value, scope)} placeholder={label('提交说明', 'Commit message')} />
          </div>
          <div className="source-git-count">{summary && <span>{label('批次摘要单独保存 · ', 'Batch summary saved separately · ')}</span>}{label('待提交', 'To commit')} {filesCount} {label('个文件', 'files')}{units.length > 1 ? ` · ${units.length} ${label('个仓库', 'repositories')}` : ''}</div>
          <div className="source-git-actions">
            {busy ? <button type="button" onClick={() => { stopped.current = true; if (activeRepository.current) void client.cancelProjectGitAction(project.id, activeRepository.current).catch(reason => setError(gitFailureText(reason))); }}>{label('停止批次', 'Stop batch')}</button> : null}
            <SourceCommitOptions active={active} zh={zh}>
              <label className="source-git-parent-option"><input type="checkbox" checked={state.stagedOnly} disabled={locked} onChange={event => update({ stagedOnly: event.target.checked })} />{label('只显示已暂存文件', 'Show staged files only')}</label>
              <label className="source-git-parent-option"><input type="checkbox" checked={updateParents} disabled={locked} onChange={event => update({ updateParents: event.target.checked })} />{label('同时更新父仓库的子模块引用', 'Update parent submodule references')}</label>
              <small>{label('勾选或取消勾选会更新 Git 暂存区。只提交已暂存的改动。', 'Checkboxes update the Git index. Only staged changes are committed.')}</small>
            </SourceCommitOptions>
            <button type="button" disabled={locked || !units.length} onClick={() => void prepare(true)}>{label('提交并推送…', 'Commit and push…')}</button>
            <button type="button" className="source-git-primary" disabled={locked || !units.length} onClick={() => void prepare(false)}>{label('提交…', 'Commit…')}</button>
          </div>
          {hasFeedback ? <p className="source-git-feedback" role="status">{feedback || editorFeedback}</p> : null}
        </section>
        </div>
      </> : <div className="source-git-files source-git-stashes">
        {repositoriesWithStashes.map(repository => (
          <details key={repository.id} open>
            <summary className="source-git-repository-heading">
              <CaretRight className="source-git-stash-caret" aria-hidden="true" />
              <SourceRepositoryLabel repository={repository} detail={repository.snapshot.stashes.length} />
            </summary>
            <div className="source-git-file-tree">
              {repository.snapshot.stashes.map(stash => {
                const current = repository.id === stashRepository?.id && stash.ref === selectedStash?.ref;
                return (
                  <div key={stash.ref} className={`source-git-file source-git-stash${current ? ' is-active' : ''}`} onContextMenu={event => openStashMenu(event, repository.id, stash)}>
                    <button type="button" aria-current={current || undefined} aria-keyshortcuts="Shift+F10" title={`${stash.subject} · ${stash.ref}`}
                      onClick={() => previewStash(repository.id, stash)} onKeyDown={event => openStashMenu(event, repository.id, stash)}>
                      <Archive aria-hidden="true" />
                      <span>{stash.subject}</span>
                      <small className="source-git-stash-ref">{stash.ref}</small>
                    </button>
                    <button type="button" className="source-git-stash-apply" disabled={locked} onClick={() => confirmApplyStash(repository, stash)}>
                      {label('应用', 'Apply')}
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
        {!repositoriesWithStashes.length ? <p className="source-git-empty">{label('没有贮藏的更改', 'No stashed changes')}</p> : null}
      </div>}
      {error ? <p className="source-git-error" role="alert"><VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} /></p> : null}
    </aside>
    <GitPaneSeparator name="source-sidebar" trailingMin={280} label={label('调整项目更改列表宽度', 'Resize project changes sidebar')} initial={32} min={sidebarBounds.min} max={sidebarBounds.max} />
    <section ref={detail} className={`source-git-detail${state.lastResults.length ? ' has-results' : ''}`}>
      <div className="source-git-diff" hidden={tab !== 'commit'}>
        {focusedConflict && focusedId && focusedPath ? <GitConflictEditor client={client} projectId={project.id} repositoryId={focusedId} filePath={focusedPath} zh={zh} disabled={locked} onSaved={result => conflictSaved(focusedId, focusedPath, result)} /> : focusedPath && (diffTarget !== currentDiffTarget || (diffLoading && !diff)) ? <p className="source-git-empty">{label('正在读取实际提交差异…', 'Loading selected commit diff…')}</p> : diffError && diffTarget === currentDiffTarget ? <p className="source-git-error" role="alert"><VisibleApplicationError error={diffError} language={zh ? 'zh-CN' : 'en'} /></p> : focusedPath && diff && diffTarget === currentDiffTarget ? <SideBySideDiff diff={diff} zh={zh} title={`${focusedRepository?.name ?? ''} / ${focusedPath}`} fill /> : <div className="source-git-empty"><h3>{label('选择文件查看差异', 'Select a file to see its diff')}</h3><p>{label('左侧按仓库分组勾选，查看文件不会改变勾选范围。', 'Select files by repository. Previewing a file preserves your selection.')}</p></div>}
      </div>
      {tab === 'stash' ? (
        <div className="source-git-diff">
          {stashRepository && selectedStash ? (
            <ProjectGitDiffWindow
              key={JSON.stringify([project.id, stashRepository.id, selectedStash.hash, selectedStash.ref])}
              client={client}
              projectId={project.id}
              repositoryId={stashRepository.id}
              commitHash={selectedStash.ref}
              expectedCommitHash={selectedStash.hash}
              filePath=""
              stage="combined"
              language={props.language}
              appearance="light"
              embeddedTitle={`${stashRepository.name} / ${selectedStash.ref}`}
            />
          ) : <p className="source-git-empty">{label('选择贮藏条目查看差异', 'Select a stash to see its diff')}</p>}
        </div>
      ) : null}
      {state.lastResults.length ? <><GitPaneSeparator name="source-results" label={label('调整差异与批次结果区域高度', 'Resize diff and batch results')} axis="y" initial={78} min={resultsBounds.min} max={resultsBounds.max} /><section className="source-git-results" aria-label={label('批次结果', 'Batch results')}><header><strong>{label('最近一次批次', 'Last batch')}</strong>{state.lastResults.some(result => ['push_failed', 'push_blocked'].includes(result.status) && result.commitSha) ? <button type="button" disabled={locked} onClick={() => void retryPush()}>{label('重试失败的推送', 'Retry failed pushes')}</button> : null}</header>{state.lastResults.map(result => <div key={result.repositoryId}><strong>{result.repositoryName}</strong><span>{statuses[result.status]}</span>{result.commitSha ? <code title={result.commitSha}>{result.commitSha.slice(0, 8)}</code> : null}{result.error ? <p><VisibleApplicationError error={result.error} language={zh ? 'zh-CN' : 'en'} /></p> : null}</div>)}</section></> : null}
    </section>
    {active && tab === 'stash' && stashMenu && stashMenuRepository ? (
      <GitContextMenu x={stashMenu.x} y={stashMenu.y} title={`${stashMenuRepository.name} · ${stashMenu.stash.ref}`}
        items={stashMenuItems(stashMenuRepository, stashMenu.stash)} onClose={() => setStashMenu(null)} onError={reason => setError(gitFailureText(reason))} />
    ) : null}
    {stashConfirmation ? <GitMenuActionDialog value={stashConfirmation} zh={zh} onClose={() => setStashConfirmation(null)} /> : null}
    {review ? <SourceCommitReview rows={review.rows} preferredRepositoryId={review.preferredRepositoryId} push={review.push} zh={zh} busy={reviewBusy} error={reviewError} onChange={(edited, patch) => {
      if (patch.message !== undefined) {
        for (const row of edited) commitMessages.write(row.repositoryId, patch.message, repositoryDraftScope(row.snapshot, row.gitlinks));
      }
      const ids = new Set(edited.map(row => row.repositoryId));
      setReview(current => current && { ...current, rows: current.rows.map(row => ids.has(row.repositoryId) ? { ...row, ...patch } : row) });
    }} onClose={() => setReview(null)} onConfirm={rows => void confirm(rows)} /> : null}
  </main>;
}
