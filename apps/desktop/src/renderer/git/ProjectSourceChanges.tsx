import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import type { DashboardClient, GitDiffSummary, ProjectRecord } from '../apiClient.js';
import { loadGitCommitModelOptions } from './gitCommitModels.js';
import { SideBySideDiff } from './ProjectGitDiffViewer.js';
import { notifyProjectGitChanged, readCachedProjectGitWorkbench, requestProjectGitWorkbench, subscribeProjectGitRefresh } from './projectGitWorkbenchState.js';
import { SourceCheckbox, SourceRepositoryTree } from './SourceFileTree.js';
import { buildSourceCommitUnits, defaultSourcePushTarget, readSourceGitState, sourceRepositoryFiles, writeSourceGitState, type SourceGitState } from './sourceGitState.js';
import { previewForUnit, pushSourceResult, runSourceBatch, validateSourceReview, type SourceReviewRow } from './sourceGitBatch.js';
import { SourceCommitReview } from './SourceCommitReview.js';
import './sourceGit.css';

export function ProjectSourceChanges(props: { project: ProjectRecord; client: DashboardClient; language: 'zh-CN' | 'en-US'; active: boolean; modelSettingsRevision?: number; onBusyChange: (busy: boolean) => void }) {
  const { client, project, active, onBusyChange } = props;
  const zh = props.language === 'zh-CN';
  const label = (cn: string, en: string) => zh ? cn : en;
  const [state, setState] = useState(() => readSourceGitState(project.id));
  const stateRef = useRef(state);
  const update = useCallback((change: Partial<SourceGitState> | ((current: SourceGitState) => SourceGitState)) => {
    const next = typeof change === 'function' ? change(stateRef.current) : { ...stateRef.current, ...change };
    stateRef.current = next; setState(next); writeSourceGitState(project.id, next);
  }, [project.id]);
  const [snapshot, setSnapshot] = useState(() => readCachedProjectGitWorkbench(client, project.id));
  const [error, setError] = useState('');
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
  const [review, setReview] = useState<{ rows: SourceReviewRow[]; push: boolean } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [diffError, setDiffError] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const refresh = useCallback(async () => { const value = await requestProjectGitWorkbench(client, project.id); setSnapshot(value); return value; }, [client, project.id]);
  useEffect(() => {
    if (!active) return;
    // 原生下拉菜单与草稿编辑期间不重绘列表；提交前仍重新读取并核对指纹。
    const load = () => { if (!busyRef.current && !generation.current && !document.querySelector('dialog[open]') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) void refresh().catch(reason => setError(String(reason instanceof Error ? reason.message : reason))); };
    load(); const unsubscribe = subscribeProjectGitRefresh(project.id, load);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [active, project.id, refresh]);
  useEffect(() => {
    let live = true;
    void loadGitCommitModelOptions(client, project.id).then(value => { if (live) { setModels(value.items); setModel(value.modelRef); setModelWarning(value.warning); } }).catch(reason => { if (live) setModelWarning(String(reason)); });
    return () => { live = false; };
  }, [client, project.id, props.modelSettingsRevision]);
  useEffect(() => () => { generation.current?.abort(); stopped.current = true; onBusyChange(false); }, [onBusyChange]);
  const repositories = snapshot?.repositories ?? [];
  const units = useMemo(() => buildSourceCommitUnits(snapshot?.repositories ?? [], state.selected, state.selectionMode, updateParents), [snapshot, state.selected, state.selectionMode, updateParents]);
  const filesCount = units.reduce((sum, unit) => sum + unit.paths.length, 0);
  const editorRepository = units.find(unit => unit.repository.id === draftRepository)?.repository.id ?? units[0]?.repository.id ?? '';
  const selectedMessage = state.messageMode === 'shared' ? state.sharedMessage : state.drafts[editorRepository] ?? '';
  const locked = busy || generating || reviewBusy;
  const focusedId = state.focus?.repositoryId;
  const focusedPath = state.focus?.path;
  useEffect(() => {
    if (!active || !focusedId || !focusedPath) return;
    const repository = snapshot?.repositories.find(repo => repo.id === focusedId);
    if (!repository || !sourceRepositoryFiles(repository, snapshot!.repositories, state.selectionMode).some(file => file.path === focusedPath)) { setDiff(null); setDiffError(''); setDiffLoading(false); return; }
    const controller = new AbortController(); setDiffLoading(true); setDiffError(''); setDiff(null);
    void client.previewGitCommitSelection(project.id, [{ repositoryId: repository.id, relativePath: repository.relativePath, paths: [focusedPath] }], state.selectionMode, controller.signal).then(value => { if (!controller.signal.aborted) setDiff(value.repositories[0]?.diff ?? null); }).catch(reason => { if (!controller.signal.aborted) setDiffError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!controller.signal.aborted) setDiffLoading(false); });
    return () => controller.abort();
  }, [active, client, focusedId, focusedPath, project.id, snapshot, state.selectionMode]);
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
    try {
      if (state.messageMode === 'shared') {
        if (!selection.length) update({ sharedMessage: `chore(deps): ${label('更新子模块引用', 'update submodule references')}${referencesMessage}` });
        else {
          const result = await client.generateGitCommitMessage(project.id, { ...selection[0]!, selection, selectionMode: state.selectionMode, language: zh ? 'zh-CN' : 'en', modelRef: model }, text => { if (!controller.signal.aborted) update({ sharedMessage: text }); }, controller.signal);
          controller.signal.throwIfAborted(); update({ sharedMessage: result.message + referencesMessage, fingerprints: result.fingerprints ?? {} });
        }
      } else {
        const drafts = { ...original.drafts }; const fingerprints: Record<string, string> = {};
        for (const unit of units) {
          const target = { repositoryId: unit.repository.id, relativePath: unit.repository.relativePath, paths: unit.ordinaryPaths };
          const result = unit.ordinaryPaths.length ? await client.generateGitCommitMessage(project.id, { ...target, selection: [target], selectionMode: state.selectionMode, language: zh ? 'zh-CN' : 'en', modelRef: model }, undefined, controller.signal) : null;
          controller.signal.throwIfAborted(); drafts[unit.repository.id] = (result?.message ?? `chore(deps): ${label('更新子模块引用', 'update submodule references')}`) + (unit.gitlinks.length ? `\n\n${unit.gitlinks.map(link => link.path).join(', ')}` : ''); Object.assign(fingerprints, result?.fingerprints);
        }
        update({ drafts, fingerprints });
      }
      setFeedback(label('已根据勾选内容生成，请检查提交说明。', 'Generated from selected content. Review before committing.'));
    } catch (reason) {
      update({ sharedMessage: original.sharedMessage, drafts: original.drafts, fingerprints: original.fingerprints });
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setReviewBusy(false); }
  }
  async function confirm() {
    if (!review || busyRef.current || reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    try {
      await validateSourceReview(client, project.id, review.rows, review.push);
      busyRef.current = true; setBusy(true); onBusyChange(true); stopped.current = false; setReview(null);
      await runSourceBatch({ client, projectId: project.id, rows: review.rows, push: review.push, stopped: () => stopped.current,
        onActive: id => { activeRepository.current = id; }, onResults: lastResults => update({ lastResults }),
        onCommitted: row => update(current => ({ ...current, selected: { ...current.selected, [row.repositoryId]: (current.selected[row.repositoryId] ?? []).filter(path => !row.paths.includes(path)) } })),
      });
      // 子模块成功、父仓库失败时保留新增引用供下次重新预览。
      for (const row of review.rows) if (row.gitlinks.length && !stateRef.current.lastResults.find(result => result.repositoryId === row.repositoryId)?.commitSha) toggle(row.repositoryId, row.gitlinks.map(link => link.path), true);
      notifyProjectGitChanged(project.id); await refresh();
    } catch (reason) { setReviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false); setReviewBusy(false); }
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
        catch (reason) { update(current => ({ ...current, lastResults: current.lastResults.map(result => result.repositoryId === row.repositoryId ? { ...result, status: 'push_failed', error: reason instanceof Error ? reason.message : String(reason) } : result) })); }
      }
      notifyProjectGitChanged(project.id); await refresh();
    } finally { activeRepository.current = null; busyRef.current = false; setBusy(false); onBusyChange(false); }
  }
  const allPaths = repositories.flatMap(repository => sourceRepositoryFiles(repository, repositories, state.selectionMode).map(file => ({ id: repository.id, path: file.path })));
  const chosen = allPaths.filter(file => state.selected[file.id]?.includes(file.path)).length;
  const statuses = zh ? { queued: '等待提交', committing: '提交中', committed: '已提交', commit_failed: '提交失败', blocked: '未提交', pushing: '推送中', done: '已推送', push_failed: '推送失败', push_blocked: '待推送', unknown: '请核对结果' } : { queued: 'Queued', committing: 'Committing', committed: 'Committed', commit_failed: 'Commit failed', blocked: 'Blocked', pushing: 'Pushing', done: 'Pushed', push_failed: 'Push failed', push_blocked: 'Push pending', unknown: 'Check outcome' };
  return <main className="source-git-shell">
    <aside className="source-git-sidebar">
      <header className="source-git-heading"><div><h2>{label('源码更改', 'Source changes')}</h2><small>{label('当前项目', 'Current project')} · {project.name}</small></div><button type="button" disabled={locked} onClick={() => void refresh().catch(reason => setError(String(reason)))} aria-label={label('刷新源码更改', 'Refresh source changes')}><ArrowsClockwise size={19} /></button></header>
      <div className="source-git-scope"><select aria-label={label('提交内容范围', 'Commit content mode')} value={state.selectionMode} disabled={locked} onChange={event => { update({ selectionMode: event.target.value === 'staged' ? 'staged' : 'worktree', fingerprints: {} }); setFeedback(''); }}><option value="worktree">{label('全部工作区更改', 'Full working tree changes')}</option><option value="staged">{label('仅已暂存内容', 'Staged content only')}</option></select><input type="search" value={state.search} onChange={event => update({ search: event.target.value })} aria-label={label('筛选文件', 'Filter files')} placeholder={label('筛选文件或仓库…', 'Filter files or repositories…')} /></div>
      <div className="source-git-select-all"><SourceCheckbox label={label('选择本项目全部文件', 'Select all project files')} checked={allPaths.length > 0 && chosen === allPaths.length} mixed={chosen > 0 && chosen < allPaths.length} disabled={locked || !allPaths.length} onChange={checked => { for (const repository of repositories) toggle(repository.id, sourceRepositoryFiles(repository, repositories, state.selectionMode).map(file => file.path), checked); }} /><strong>{label('更改', 'Changes')} {allPaths.length}</strong><span>{repositories.filter(repository => sourceRepositoryFiles(repository, repositories, state.selectionMode).length).length} {label('个仓库', 'repositories')}</span></div>
      <div className="source-git-tree">{repositories.map(repository => <SourceRepositoryTree key={repository.id} repository={repository} files={sourceRepositoryFiles(repository, repositories, state.selectionMode)} selected={state.selected[repository.id] ?? []} focusedPath={focusedPath} focusedRepository={focusedId} collapsed={state.collapsed} filter={state.search} disabled={locked} zh={zh} onToggle={(paths, checked) => toggle(repository.id, paths, checked)} onFocus={path => update({ focus: { repositoryId: repository.id, path } })} onCollapse={key => update(current => ({ ...current, collapsed: current.collapsed.includes(key) ? current.collapsed.filter(item => item !== key) : [...current.collapsed, key] }))} />)}{!allPaths.length ? <p className="source-git-empty">{snapshot ? label('当前范围没有更改。', 'No changes in this scope.') : label('正在发现项目内仓库…', 'Discovering repositories…')}</p> : null}</div>
      <section className="source-git-composer"><div className="source-git-draft-options"><select aria-label={label('提交说明模式', 'Commit message mode')} value={state.messageMode} disabled={locked} onChange={event => update({ messageMode: event.target.value === 'individual' ? 'individual' : 'shared' })}><option value="shared">{label('共用提交说明', 'Shared message')}</option><option value="individual">{label('每个仓库单独填写', 'Message per repository')}</option></select>{state.messageMode === 'individual' ? <select aria-label={label('编辑仓库说明', 'Repository draft')} value={editorRepository} onChange={event => setDraftRepository(event.target.value)}>{units.map(unit => <option key={unit.repository.id} value={unit.repository.id}>{unit.repository.name}</option>)}</select> : null}</div>
        <textarea aria-label={label('源码更改提交说明', 'Source changes commit message')} value={selectedMessage} disabled={locked || (state.messageMode === 'individual' && !editorRepository)} onChange={event => setMessage(event.target.value)} placeholder={label('提交说明', 'Commit message')} />
        <div className="source-git-ai"><select aria-label={label('源码提交模型', 'Source commit model')} value={model} disabled={locked} onChange={event => { setModel(event.target.value); try { localStorage.setItem(`astragit.commit-model.${project.id}`, event.target.value); } catch { /* 使用当前模型。 */ } }}>{models.length ? models.map(value => <option key={value.id} value={value.id}>{value.label}</option>) : <option value="">{label('请在 AI 设置中配置模型', 'Configure a model in AI settings')}</option>}</select><button type="button" disabled={busy || reviewBusy || (!generating && (!model || !units.length))} onClick={() => generating ? generation.current?.abort() : void generate()}><Sparkle size={16} />{generating ? label('停止生成', 'Stop') : label('AI 填写', 'AI draft')}</button></div>
        <label className="source-git-parent-option"><input type="checkbox" checked={updateParents} disabled={locked || state.selectionMode === 'staged'} onChange={event => update({ updateParents: event.target.checked })} />{label('同时更新父仓库的子模块引用', 'Update parent submodule references')}</label>
        <small>{state.selectionMode === 'staged' ? label('只提交勾选文件的暂存版本，保留工作区后续修改。', 'Commits selected staged versions; preserves later working tree edits.') : label('勾选决定提交范围，包含所选文件未暂存内容。', 'Checkboxes set commit scope, including selected unstaged content.')}</small>
        {modelWarning || feedback ? <p className="source-git-feedback">{feedback || modelWarning}</p> : null}
        <p className="source-git-count">{label('已选择', 'Selected')} {filesCount} {label('个文件', 'files')} · {units.length} {label('个仓库', 'repositories')}</p><div className="source-git-actions"><button type="button" className="source-git-primary" disabled={locked || !units.length} onClick={() => void prepare(false)}>{label('提交…', 'Commit…')}</button><button type="button" disabled={locked || !units.length} onClick={() => void prepare(true)}>{label('提交并推送…', 'Commit and push…')}</button>{busy ? <button type="button" onClick={() => { stopped.current = true; if (activeRepository.current) void client.cancelProjectGitAction(project.id, activeRepository.current).catch(reason => setError(String(reason))); }}>{label('停止批次', 'Stop batch')}</button> : null}</div>
        {error ? <p className="source-git-error" role="alert">{error}</p> : null}
      </section>
    </aside>
    <section className="source-git-detail"><div className="source-git-diff">{diffLoading ? <p className="source-git-empty">{label('正在读取实际提交差异…', 'Loading selected commit diff…')}</p> : diffError ? <p className="source-git-error" role="alert">{diffError}</p> : focusedPath && diff ? <SideBySideDiff diff={diff} zh={zh} title={`${repositories.find(repository => repository.id === focusedId)?.name ?? ''} / ${focusedPath}`} fill /> : <div className="source-git-empty"><h3>{label('选择文件查看差异', 'Select a file to see its diff')}</h3><p>{label('左侧按仓库分组勾选，查看文件不会改变勾选范围。', 'Select files by repository. Previewing a file preserves your selection.')}</p></div>}</div>
      {state.lastResults.length ? <section className="source-git-results" aria-label={label('批次结果', 'Batch results')}><header><strong>{label('最近一次批次', 'Last batch')}</strong>{state.lastResults.some(result => ['push_failed', 'push_blocked'].includes(result.status) && result.commitSha) ? <button type="button" disabled={locked} onClick={() => void retryPush()}>{label('重试失败的推送', 'Retry failed pushes')}</button> : null}</header>{state.lastResults.map(result => <div key={result.repositoryId}><strong>{result.repositoryName}</strong><span>{statuses[result.status]}</span>{result.commitSha ? <code title={result.commitSha}>{result.commitSha.slice(0, 8)}</code> : null}{result.error ? <p>{result.error}</p> : null}</div>)}</section> : null}
    </section>
    {review ? <SourceCommitReview rows={review.rows} push={review.push} zh={zh} busy={reviewBusy} error={reviewError} onChange={rows => setReview({ ...review, rows })} onClose={() => setReview(null)} onConfirm={() => void confirm()} /> : null}
  </main>;
}
