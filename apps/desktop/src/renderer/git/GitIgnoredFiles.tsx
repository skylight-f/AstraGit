import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Folder } from '@phosphor-icons/react/dist/csr/Folder';
import { File } from '@phosphor-icons/react/dist/csr/File';
import { DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import type { DashboardClient, GitIgnoredItem, GitIgnoredPage, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitContextMenu } from './GitContextMenu.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { selectGitFilePaths, pruneGitFileSelection, type GitFileSelection } from './gitFileSelection.js';
import { gitTrackingNeedsReview } from './GitStopTrackingDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export function GitIgnoredFiles(props: {
  projectId: string; repository: ProjectGitRepositoryWorkbenchItem; client: Pick<DashboardClient, 'loadProjectGitIgnoredFiles'>; zh: boolean; query: string; busy: boolean;
  onOpenFile: (path: string, intent: 'open' | 'reveal' | 'edit-ignore-rule') => Promise<void>;
  onOpenChanges: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [parents, setParents] = useState(['']); const prefix = parents.at(-1)!;
  const [items, setItems] = useState<GitIgnoredItem[]>([]); const [page, setPage] = useState<GitIgnoredPage | null>(null);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null); const [reload, setReload] = useState(0);
  const [selection, setSelection] = useState<GitFileSelection>({ selectedPaths: [], anchor: null });
  const [focusedPath, setFocusedPath] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; item: GitIgnoredItem; paths: string[] } | null>(null);
  const [review, setReview] = useState<GitIgnoredItem[] | null>(null); const [reviewError, setReviewError] = useState<unknown>(null); const [reviewRequired, setReviewRequired] = useState(false);
  const request = useRef<AbortController | null>(null); const scope = useRef(''); const alive = useRef(true); const submitting = useRef(false);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const key = JSON.stringify([prefix, props.query]);
  const revision = JSON.stringify([props.repository.snapshot.headSha, props.repository.snapshot.indexFingerprint, props.repository.snapshot.fileStatuses]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    if (scope.current !== key) { setItems([]); setPage(null); setSelection({ selectedPaths: [], anchor: null }); setFocusedPath(''); }
    setMenu(null); setLoading(true); setLoadingMore(false); setError(null);
    void props.client.loadProjectGitIgnoredFiles(props.projectId, props.repository.id, { prefix, search: props.query }, controller.signal).then(value => {
      if (controller.signal.aborted) return; scope.current = key; setItems(value.items); setPage(value);
      const paths = value.items.map(item => item.path);
      setSelection(current => ({ selectedPaths: pruneGitFileSelection(current.selectedPaths, paths), anchor: current.anchor && paths.includes(current.anchor) ? current.anchor : null }));
      setFocusedPath(current => paths.includes(current) ? current : paths[0] ?? '');
    }).catch(reason => { if (!controller.signal.aborted) setError(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, props.repository.id, key, revision, reload]);
  const ready = !loading && !loadingMore && !error && scope.current === key;
  const ordered = items.map(item => item.path); const selected = pruneGitFileSelection(selection.selectedPaths, ordered);
  const focused = items.find(item => item.path === focusedPath);
  const enter = (item: GitIgnoredItem) => { if (item.directory) setParents(current => [...current, item.path.replace(/\/$/u, '')]); };
  async function more() {
    if (!page?.hasMore || !ready || !alive.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoadingMore(true); setError(null);
    try {
      const value = await props.client.loadProjectGitIgnoredFiles(props.projectId, props.repository.id, { prefix, search: props.query, offset: page.nextOffset, expectedFingerprint: page.fingerprint }, controller.signal);
      if (!controller.signal.aborted) { setItems(current => [...new Map([...current, ...value.items].map(item => [item.path, item])).values()]); setPage(value); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason); }
    finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }
  function choose(event: MouseEvent, path: string) {
    setSelection(current => selectGitFilePaths({ orderedPaths: ordered, selectedPaths: current.selectedPaths, anchor: current.anchor, clickedPath: path, range: event.shiftKey, additive: event.ctrlKey || event.metaKey })); setFocusedPath(path);
  }
  function openMenu(item: GitIgnoredItem, x: number, y: number) {
    const paths = selected.includes(item.path) ? selected : [item.path]; setSelection({ selectedPaths: paths, anchor: paths.length > 1 ? selection.anchor : item.path }); setFocusedPath(item.path); setMenu({ x, y, item, paths });
  }
  function reviewPaths(paths: string[]) { setReview(items.filter(item => paths.includes(item.path))); setReviewError(null); setReviewRequired(false); }
  async function forceStage() {
    if (!review?.length || props.busy || submitting.current || reviewRequired) return; submitting.current = true; setReviewError(null);
    try {
      const result = await props.onExecute(props.repository, { type: 'stage_ignored', paths: review.map(item => item.path) }, text('强制暂存已忽略项', 'Force stage ignored items'));
      if (!alive.current) return;
      if (result.outcome === 'completed') { setReview(null); setReload(value => value + 1); }
      else if (result.error) { setReviewError(result.error); setReviewRequired(gitTrackingNeedsReview(result.error)); }
    } catch (reason) { if (alive.current) { setReviewError(reason); setReviewRequired(true); } }
    finally { submitting.current = false; }
  }
  return <section className="git-ignored-surface" aria-label={text('已忽略文件', 'Ignored files')}>
    <header><Button variant="secondary" size="compact" disabled={parents.length < 2 || loading} onClick={() => setParents(current => current.slice(0, -1))}>{text('上级', 'Back')}</Button><strong title={prefix}>{prefix || text('仓库范围', 'Repository scope')}</strong><small>{page ? `${page.total} ${text('项（目录按项显示）', 'items (directories are single items)')}` : ''}</small><Button variant="secondary" size="compact" disabled={loading} onClick={() => setReload(value => value + 1)}>{text('刷新', 'Refresh')}</Button><Button size="compact" disabled={props.busy || !ready || !selected.length} onClick={() => reviewPaths(selected)}>{text(`强制暂存所选 (${selected.length})…`, `Force stage selected (${selected.length})…`)}</Button></header>
    {error ? <div role="alert" className="git-ignored-error"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
    <div className="git-ignored-layout">
      <div className="git-ignored-list" aria-busy={loading || loadingMore}>
        <label className="git-ignored-select-all"><input type="checkbox" disabled={!ready || !items.length} checked={items.length > 0 && selected.length === items.length} onChange={event => setSelection({ selectedPaths: event.target.checked ? ordered : [], anchor: null })} />{text('选择当前已加载项', 'Select loaded items')}</label>
        {loading && !items.length ? <p role="status">{text('正在读取忽略文件与匹配规则…', 'Loading ignored files and matching rules…')}</p> : null}
        {!loading && !error && !items.length ? <p>{text('当前范围没有匹配的忽略项。', 'No ignored items match this scope.')}</p> : null}
        {items.map(item => <div key={item.path} className={`git-ignored-row${selected.includes(item.path) ? ' is-selected' : ''}`} onContextMenu={event => { event.preventDefault(); openMenu(item, event.clientX, event.clientY); }}>
          <input type="checkbox" aria-label={text(`选择 ${item.path}`, `Select ${item.path}`)} checked={selected.includes(item.path)} onChange={event => { const checked = event.target.checked; setSelection(current => ({ selectedPaths: checked ? [...new Set([...current.selectedPaths, item.path])] : current.selectedPaths.filter(path => path !== item.path), anchor: item.path })); setFocusedPath(item.path); }} />
          <button type="button" className="git-ignored-file" title={item.path} aria-pressed={selected.includes(item.path)} onClick={event => choose(event, item.path)} onDoubleClick={() => item.directory ? enter(item) : void props.onOpenFile(item.path, 'open')} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); openMenu(item, bounds.left, bounds.bottom); } }}>{item.directory ? <Folder aria-hidden="true" /> : <File aria-hidden="true" />}<span>{item.path}</span></button>
          <code title={`${item.rule.source}:${item.rule.line} · ${item.rule.pattern}`}>{item.rule.pattern}</code>
          <button type="button" aria-label={text(`${item.path} 操作`, `Actions for ${item.path}`)} aria-haspopup="menu" aria-expanded={menu?.item.path === item.path} onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); openMenu(item, bounds.right, bounds.bottom); }}><DotsThree aria-hidden="true" /></button>
        </div>)}
        {page?.hasMore ? <Button variant="secondary" disabled={!ready} busy={loadingMore} onClick={() => void more()}>{text('加载更多', 'Load more')}</Button> : null}
      </div>
      <GitPaneSeparator name="ignored-list" label={text('调整忽略文件列表与规则详情高度', 'Resize ignored list and rule details')} axis="y" initial={76} min={30} max={88} />
      <aside className="git-ignored-detail">{focused ? <><strong>{focused.path}</strong><dl><dt>{text('匹配规则', 'Matching rule')}</dt><dd><code>{focused.rule.pattern}</code></dd><dt>{text('规则来源', 'Rule source')}</dt><dd>{focused.rule.source}:{focused.rule.line}</dd></dl><div><Button variant="secondary" size="compact" disabled={!ready} onClick={() => void props.onOpenFile(focused.path, 'edit-ignore-rule')}>{text('编辑匹配规则…', 'Edit matching rule…')}</Button><Button variant="secondary" size="compact" disabled={!ready} onClick={() => void props.onOpenFile(focused.path, 'reveal')}>{text('在 Finder 中定位', 'Reveal in Finder')}</Button>{focused.directory ? <Button size="compact" disabled={!ready} onClick={() => enter(focused)}>{text('进入目录', 'Browse directory')}</Button> : <Button size="compact" disabled={!ready} onClick={() => void props.onOpenFile(focused.path, 'open')}>{text('使用默认应用打开', 'Open with default app')}</Button>}</div></> : <p>{text('选择一项查看忽略规则及来源。', 'Select an item to inspect its ignore rule and source.')}</p>}</aside>
    </div>
    {menu ? <GitContextMenu x={menu.x} y={menu.y} title={menu.item.path} onClose={() => setMenu(null)} onError={setError} items={[
      ...(menu.item.directory ? [{ label: text('进入目录', 'Browse directory'), run: () => enter(menu.item) }] : [{ label: text('使用默认应用打开', 'Open with default app'), run: () => props.onOpenFile(menu.item.path, 'open') }]),
      { label: text('在 Finder 中定位', 'Reveal in Finder'), run: () => props.onOpenFile(menu.item.path, 'reveal') },
      { label: text('编辑匹配规则…', 'Edit matching rule…'), run: () => props.onOpenFile(menu.item.path, 'edit-ignore-rule') },
      { label: text(`强制暂存所选 (${menu.paths.length})…`, `Force stage selected (${menu.paths.length})…`), disabled: props.busy || !ready, run: () => reviewPaths(menu.paths) },
    ]} /> : null}
    {review ? <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="alertdialog" aria-label={text('强制暂存已忽略项', 'Force stage ignored items')} onDismiss={() => setReview(null)} dismissDisabled={props.busy}><section className="project-git-menu-action-dialog git-force-ignored-dialog" data-modal-surface="dialog"><header><strong>{text('强制暂存已忽略项', 'Force stage ignored items')}</strong></header><p>{text('将所选内容加入暂存区，忽略规则保留；不会自动提交。', 'Add the selected contents to the index, keeping ignore rules. No commit is created.')}</p><ul>{review.map(item => <li key={item.path}>{item.path}</li>)}</ul>{review.some(item => item.directory) ? <p>{text('目录操作也会暂存其中已跟踪文件的更改；内嵌仓库按 Git 原生目录规则处理。请先核对文件状态。', 'Directories also stage changes to tracked files inside them. Embedded repositories follow Git’s native directory behavior. Review File Status first.')}</p> : null}{reviewError ? <VisibleApplicationError error={reviewError} language={props.zh ? 'zh-CN' : 'en'} /> : null}{reviewRequired ? <p role="alert">{text('请取消并刷新核对当前状态，不能直接重复执行。', 'Cancel and refresh to verify the current state before trying again.')}</p> : null}<footer><Button variant="secondary" disabled={props.busy} onClick={() => { setReview(null); props.onOpenChanges(); }}>{text('查看文件状态', 'View File Status')}</Button><Button variant="secondary" autoFocus disabled={props.busy} onClick={() => setReview(null)}>{text('取消', 'Cancel')}</Button><Button disabled={props.busy || reviewRequired} busy={props.busy} onClick={() => void forceStage()}>{text('强制暂存', 'Force stage')}</Button></footer></section></ModalPortal> : null}
  </section>;
}
