import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { File } from '@phosphor-icons/react/dist/csr/File';
import { FolderOpen } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import type { DashboardClient, ProjectRecord, ProjectGitWorkbenchSnapshot } from './apiClient.js';
import { readCachedProjectGitWorkbench, requestProjectGitWorkbench } from './git/projectGitWorkbenchState.js';
import { searchWorkspace, type WorkspaceSearchDestination, type WorkspaceSearchResult } from './workspaceSearchState.js';

export function WorkspaceSearch(props: { client: Pick<DashboardClient, 'loadProjectGitWorkbench'>; projects: readonly ProjectRecord[]; project: ProjectRecord | null; zh: boolean; mac: boolean; disabled: boolean; onNavigate: (destination: WorkspaceSearchDestination) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<{ id: string; snapshot: ProjectGitWorkbenchSnapshot | null } | null>(null);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const selectionInFlight = useRef(false);
  const listId = useId();
  const projectId = props.project?.id;
  const snapshot = scope && scope.id === projectId ? scope.snapshot : null;
  const results = useMemo(() => searchWorkspace(props.projects, snapshot, query), [props.projects, snapshot, query]);
  const currentIndex = Math.min(selected, Math.max(0, results.length - 1));
  const label = props.zh ? '搜索项目、仓库或变更文件' : 'Search projects, repositories or changed files';
  useEffect(() => { setQuery(''); setSelected(0); }, [projectId]);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k' || props.disabled || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [props.disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [open]);
  useEffect(() => {
    if (!open || props.disabled) return;
    if (!projectId) { setLoading(false); setError(false); return; }
    let active = true;
    setScope({ id: projectId, snapshot: readCachedProjectGitWorkbench(props.client, projectId) });
    setLoading(true); setError(false);
    void requestProjectGitWorkbench(props.client, projectId).then(next => { if (active) setScope({ id: projectId, snapshot: next }); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, projectId, props.client, props.disabled, retry]);
  useEffect(() => { root.current?.querySelector<HTMLElement>(`[data-search-index="${currentIndex}"]`)?.scrollIntoView({ block: 'nearest' }); }, [currentIndex, results]);
  async function choose(result: WorkspaceSearchResult) {
    if (props.disabled || selectionInFlight.current) return;
    selectionInFlight.current = true;
    setSelecting(true); setError(false);
    try { await props.onNavigate(result.destination); setOpen(false); input.current?.blur(); }
    catch { setError(true); }
    finally { selectionInFlight.current = false; setSelecting(false); }
  }
  return <div className="gitapp-global-search" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <MagnifyingGlass size={15} aria-hidden="true" />
    <input ref={input} type="search" role="combobox" aria-label={label} placeholder={`${label}…`} value={query} disabled={props.disabled} readOnly={selecting} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && results.length ? `${listId}-${currentIndex}` : undefined} autoComplete="off" spellCheck={false}
      onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setSelected(0); setOpen(true); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setSelected(results.length ? (currentIndex + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length : 0); }
        else if (event.key === 'Enter' && open && results[currentIndex]) { event.preventDefault(); void choose(results[currentIndex]!); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); input.current?.blur(); }
      }} />
    <kbd aria-hidden="true">{props.mac ? '⌘ K' : 'Ctrl K'}</kbd>
    {open ? <div className="gitapp-search-popover">
      <div className="gitapp-search-status" role="status">{loading ? (props.zh ? '正在刷新当前项目…' : 'Refreshing current project…') : selecting ? (props.zh ? '正在定位…' : 'Opening…') : props.zh ? '项目 · 当前项目的仓库与变更文件' : 'Projects · Repositories and changed files in this project'}</div>
      {error ? <div className="gitapp-search-status" role="alert">{props.zh ? '读取或定位失败，请重试。' : 'Could not load or open the result. Try again.'} <button type="button" onClick={() => setRetry(value => value + 1)}>{props.zh ? '重试' : 'Retry'}</button></div> : null}
      <div id={listId} role="listbox" aria-label={label} aria-busy={loading || selecting}>
        {results.map((result, index) => {
          const kind = result.destination.kind;
          const badge = kind === 'project' ? (props.zh ? '项目' : 'Project') : kind === 'repository' ? (props.zh ? '仓库' : 'Repository') : result.destination.kind === 'file' && result.destination.stage === 'staged' ? (props.zh ? '已暂存' : 'Staged') : props.zh ? '未暂存' : 'Unstaged';
          return <div id={`${listId}-${index}`} key={result.id} role="option" aria-selected={index === currentIndex} data-search-index={index} onPointerDown={event => event.preventDefault()} onClick={() => void choose(result)}>
            {kind === 'project' ? <FolderOpen aria-hidden="true" /> : kind === 'repository' ? <GitBranch aria-hidden="true" /> : <File aria-hidden="true" />}
            <span><strong>{result.title}</strong><small>{result.detail}</small></span><em>{badge}</em>
          </div>;
        })}
      </div>
      {!results.length && !loading ? <p className="gitapp-search-status">{props.zh ? '没有匹配结果。' : 'No matches.'}</p> : null}
    </div> : null}
  </div>;
}
