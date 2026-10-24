import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DashboardClient, GitTagItem, GitTagPage, GitTagTarget, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitTagManagement.css';

export interface GitTagManagementRequest { repository: ProjectGitRepositoryWorkbenchItem; mode?: 'create' | 'manage'; revision?: string; tagName?: string; remote?: string }
interface Review { action: ProjectGitAction; title: string; name: string; versions: Array<{ destination: string; object: string | null }>; destructive: boolean }

/** Only explicitly reviewed object versions reach the shared durable command path. */
export function GitTagManagementDialog(props: {
  request: GitTagManagementRequest; projectId: string;
  client: Pick<DashboardClient, 'loadRepositoryGitTags' | 'loadRepositoryGitTagTarget' | 'loadProjectGitWorkbench'>;
  zh: boolean; busy: boolean; onClose: () => void; onAbort: () => Promise<void>;
  onOpenCommit: (sha: string) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request); const repository = request.repository;
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [mode, setMode] = useState(request.mode ?? 'manage');
  const [location, setLocation] = useState(''); const [search, setSearch] = useState(request.tagName ?? '');
  const [loadedPage, setLoadedPage] = useState<{ identity: string; value: GitTagPage } | null>(null); const [selection, setSelection] = useState(request.tagName ?? '');
  const [loading, setLoading] = useState(false); const [loadingMore, setLoadingMore] = useState(false); const [reload, setReload] = useState(0);
  const queryIdentity = JSON.stringify([location, search, reload]);
  const page = loadedPage?.identity === queryIdentity ? loadedPage.value : null;
  const setPage = (value: GitTagPage | null) => setLoadedPage(value ? { identity: queryIdentity, value } : null);
  const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState('');
  const [name, setName] = useState(''); const [revision, setRevision] = useState(request.revision ?? 'HEAD');
  const [annotated, setAnnotated] = useState(true); const [message, setMessage] = useState('');
  const [target, setTarget] = useState<{ revision: string; value: GitTagTarget } | null>(null); const [targetLoading, setTargetLoading] = useState(false);
  const [remote, setRemote] = useState(request.remote ?? repository.snapshot.remotes[0] ?? '');
  const [review, setReview] = useState<Review | null>(null); const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false); const [preparing, setPreparing] = useState(false); const [aborting, setAborting] = useState(false); const [needsReview, setNeedsReview] = useState(false);
  const query = useRef<AbortController | null>(null); const alive = useRef(true); const gate = useRef(false);
  const split = useRef<HTMLDivElement>(null); const [bounds, setBounds] = useState({ min: 20, max: 55 });
  const disabled = props.busy || running || preparing;
  const closeDisabled = props.busy || running;
  const selected = selection ? page?.items.find(item => item.name === selection) : page?.items[0];
  useEffect(() => { alive.current = true; return () => { alive.current = false; query.current?.abort(); }; }, []);
  useLayoutEffect(() => {
    const layout = split.current; if (!layout) return;
    const measure = () => { const width = layout.getBoundingClientRect().width; if (width <= 0) return; const equal = Math.max(0, width - 6) / width * 50; const next = width < 426 ? { min: equal, max: equal } : { min: 160 / width * 100, max: Math.min(65, (width - 266) / width * 100) }; setBounds(current => Math.abs(current.min - next.min) < .1 && Math.abs(current.max - next.max) < .1 ? current : next); };
    const observer = new ResizeObserver(measure); observer.observe(layout); measure(); return () => observer.disconnect();
  }, [mode]);
  useEffect(() => {
    if (mode !== 'manage') return;
    const controller = new AbortController(); query.current?.abort(); query.current = controller; setPage(null); setLoading(true); setLoadingMore(false); setError(null); setReview(null); setConfirmed(false);
    const timer = setTimeout(() => { void props.client.loadRepositoryGitTags(props.projectId, repository.id, { ...(location ? { remote: location } : {}), search, limit: 100 }, controller.signal).then(value => { if (!controller.signal.aborted) setPage(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, props.projectId, repository.id, mode, location, search, reload]);
  useEffect(() => {
    if (mode !== 'create') return;
    const controller = new AbortController(); setTarget(null); setTargetLoading(true); setError(null);
    const timer = setTimeout(() => { void props.client.loadRepositoryGitTagTarget(props.projectId, repository.id, revision, controller.signal).then(value => { if (!controller.signal.aborted) setTarget({ revision, value }); }).catch(reason => { if (!controller.signal.aborted) setError(reason); }).finally(() => { if (!controller.signal.aborted) setTargetLoading(false); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, props.projectId, repository.id, mode, revision, reload]);
  async function more() {
    if (!page || page.nextOffset === null || disabled || loading || loadingMore) return;
    const previous = page; const controller = new AbortController(); query.current?.abort(); query.current = controller; setLoadingMore(true); setError(null);
    try { const next = await props.client.loadRepositoryGitTags(props.projectId, repository.id, { ...(location ? { remote: location } : {}), search, offset: previous.nextOffset!, limit: 100, expectedFingerprint: previous.fingerprint }, controller.signal); if (!controller.signal.aborted) setPage({ ...next, items: [...previous.items, ...next.items] }); }
    catch (reason) { if (!controller.signal.aborted) { setError(reason); setPage(null); setReview(null); } }
    finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }
  function changeMode(next: 'manage' | 'create') { if (disabled) return; setMode(next); setError(null); setFeedback(''); setReview(null); setConfirmed(false); setNeedsReview(false); }
  function prepareDelete(tag: GitTagItem) {
    if (disabled || gate.current || !page || needsReview) return;
    if (location) {
      if (!page.pushFingerprint || !tag.targets.some(target => target.objectSha)) return;
      setReview({ action: { type: 'delete_remote_tag', tagName: tag.name, remote: location, expectedRemotePushFingerprint: page.pushFingerprint, expectedTargets: tag.targets.map(target => target.objectSha) }, title: text('删除远程标签', 'Delete remote tag'), name: tag.name, destructive: true, versions: page.destinations.map((destination, index) => ({ destination, object: tag.targets[index]?.objectSha ?? null })) });
    } else if (tag.local) setReview({ action: { type: 'delete_tag', tagName: tag.name, expectedTagObjectSha: tag.local.objectSha }, title: text('删除本地标签', 'Delete local tag'), name: tag.name, destructive: true, versions: [{ destination: text('仅本地仓库', 'Local repository only'), object: tag.local.objectSha }] });
    setConfirmed(false); setError(null);
  }
  async function preparePush(tag: GitTagItem) {
    if (disabled || !tag.local || !remote || gate.current || needsReview) return;
    gate.current = true; setPreparing(true); setError(null);
    try {
      // Read current push configuration; this does not require listing all remote tags.
      const workbench = await props.client.loadProjectGitWorkbench(props.projectId);
      if (!alive.current) return;
      const current = workbench.repositories.find(item => item.id === repository.id);
      const destination = current?.snapshot.remoteDetails?.find(item => item.name === remote);
      if (!destination?.pushFingerprint || !destination.pushUrls?.length) throw new Error(text('该远程的推送地址不可用，请刷新仓库设置后重新选择。', 'The remote push destination is unavailable. Refresh repository settings and select it again.'));
      setReview({ action: { type: 'push_tag', tagName: tag.name, remote, expectedTagObjectSha: tag.local.objectSha, expectedRemotePushFingerprint: destination.pushFingerprint }, title: text('推送标签', 'Push tag'), name: tag.name, destructive: false, versions: destination.pushUrls.map(url => ({ destination: url, object: tag.local!.objectSha })) }); setConfirmed(false);
    } catch (reason) { if (alive.current) setError(reason); }
    finally { gate.current = false; if (alive.current) setPreparing(false); }
  }
  async function execute(action: ProjectGitAction, title: string) {
    if (disabled || gate.current) return;
    gate.current = true; setRunning(true); setError(null); setFeedback('');
    try {
      const result = await props.onExecute(repository, action, title); if (!alive.current) return;
      if (result.outcome !== 'completed') { setError(result.error ?? new Error(text('操作尚未完成，请重新读取标签并核对结果。', 'The operation did not complete. Reload tags and review the outcome.'))); setNeedsReview(true); return; }
      setReview(null); setConfirmed(false); setNeedsReview(false); setFeedback(text('操作已完成。', 'Operation completed.'));
      if (action.type === 'create_tag') { setSelection(action.tagName); setSearch(action.tagName); setMode('manage'); setLocation(''); }
      else if (action.type === 'delete_tag' || action.type === 'delete_remote_tag') setSelection('');
      setReload(value => value + 1);
    } catch (reason) { if (alive.current) { setError(reason); setNeedsReview(true); } }
    finally { gate.current = false; if (alive.current) setRunning(false); }
  }
  const createReady = mode === 'create' && name.length > 0 && name.length <= 4096 && target?.revision === revision && !targetLoading && !needsReview;
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={text('标签管理', 'Tag management')} onDismiss={props.onClose} dismissDisabled={closeDisabled}>
    <section className="git-tag-dialog" data-modal-surface="dialog">
      <header><div><strong>{text('标签管理', 'Tag management')}</strong><small>{repository.name}</small></div><Button variant="secondary" disabled={closeDisabled} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <nav aria-label={text('标签工具', 'Tag tools')}><Button variant={mode === 'manage' ? 'primary' : 'secondary'} disabled={disabled} onClick={() => changeMode('manage')}>{text('查看标签', 'Browse tags')}</Button><Button variant={mode === 'create' ? 'primary' : 'secondary'} disabled={disabled} onClick={() => changeMode('create')}>{text('创建标签', 'Create tag')}</Button><Button variant="secondary" disabled={disabled} onClick={() => { setNeedsReview(false); setReview(null); setConfirmed(false); setReload(value => value + 1); }}>{text('重新载入并核对', 'Reload and review')}</Button></nav>
      {mode === 'create' ? <form className="git-tag-create" onSubmit={event => { event.preventDefault(); if (createReady) void execute({ type: 'create_tag', tagName: name, revision, expectedTargetSha: target!.value.sha, annotated, ...(annotated ? { message } : {}) }, text('创建标签', 'Create tag')); }}>
        <label>{text('标签名称', 'Tag name')}<input autoFocus value={name} disabled={disabled} onChange={event => { setName(event.target.value); }} /></label>
        <label>{text('目标分支或提交', 'Target branch or commit')}<input value={revision} disabled={disabled} onChange={event => { setRevision(event.target.value); }} /></label>
        {targetLoading ? <p role="status">{text('正在核对目标提交…', 'Reviewing target commit…')}</p> : target?.revision === revision ? <p className="git-tag-target"><code>{target.value.sha}</code><span>{target.value.subject}</span></p> : null}
        <label>{text('标签类型', 'Tag type')}<select value={annotated ? 'annotated' : 'lightweight'} disabled={disabled} onChange={event => { setAnnotated(event.target.value === 'annotated'); }}><option value="annotated">{text('附注标签', 'Annotated tag')}</option><option value="lightweight">{text('轻量标签', 'Lightweight tag')}</option></select></label>
        {annotated ? <label>{text('标签说明（可选，默认使用标签名称）', 'Annotation (optional; defaults to tag name)')}<textarea rows={6} value={message} disabled={disabled} onChange={event => { setMessage(event.target.value); }} /></label> : <p>{text('轻量标签只记录目标版本，不包含附注。', 'A lightweight tag records the target revision without an annotation.')}</p>}
        <p>{text('创建后可在标签列表中选择远程并推送。', 'After creation, select a remote in the tag list to push the tag.')}</p><Button type="submit" variant="primary" disabled={disabled || !createReady} busy={running}>{text('创建标签', 'Create tag')}</Button>
      </form> : <>
        <div className="git-tag-filters"><label>{text('标签来源', 'Tag source')}<select value={location} disabled={disabled} onChange={event => { setLocation(event.target.value); setSelection(''); setReview(null); setNeedsReview(false); }}><option value="">{text('本地标签', 'Local tags')}</option>{repository.snapshot.remotes.map(item => <option key={item} value={item}>{text('远程', 'Remote')} · {item}</option>)}</select></label><label>{text('筛选标签', 'Filter tags')}<input type="search" value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setReview(null); }} placeholder={text('名称、对象版本或本地说明…', 'Name, object version or local subject…')} /></label></div>
        <div ref={split} className="git-tag-layout"><div className="git-tag-list" role="listbox" aria-label={text('标签列表', 'Tags')} aria-busy={loading} onKeyDown={event => {
          if (disabled || !page?.items.length || !(event.target instanceof HTMLElement) || !event.target.closest('[role="option"]')) return;
          const index = page.items.findIndex(item => item.name === selected?.name);
          const next = event.key === 'ArrowDown' ? Math.min(page.items.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? page.items.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setSelection(page.items[next]!.name); setReview(null); setConfirmed(false);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')[next]?.focus();
        }}>
          {loading ? <p role="status">{location ? text('正在读取远程推送目标上的标签…', 'Reading tags from remote push destinations…') : text('正在读取本地标签…', 'Reading local tags…')}</p> : page ? <><small>{text(`已显示 ${page.items.length} / ${page.total} 个标签`, `Showing ${page.items.length} / ${page.total} tags`)}</small>{page.items.map((item, index) => <button type="button" role="option" tabIndex={selected ? (selected.name === item.name ? 0 : -1) : index === 0 ? 0 : -1} aria-selected={selected?.name === item.name} key={item.name} disabled={disabled} className={selected?.name === item.name ? 'is-current' : ''} onClick={() => { setSelection(item.name); setReview(null); setConfirmed(false); }}><strong>{item.name}</strong><small>{location ? item.targets.map(version => version.objectSha?.slice(0, 8) ?? text('不存在', 'Absent')).join(' · ') : item.local?.objectType === 'tag' ? text('附注标签', 'Annotated tag') : text('轻量标签', 'Lightweight tag')}</small></button>)}{!page.items.length ? <p>{text('没有匹配的标签。', 'No matching tags.')}</p> : null}{page.nextOffset !== null ? <Button variant="secondary" disabled={disabled || loadingMore} busy={loadingMore} onClick={() => void more()}>{text('载入更多', 'Load more')}</Button> : null}</> : null}
        </div><GitPaneSeparator name="tag-list" label={text('调整标签列表宽度', 'Resize tag list')} initial={35} min={bounds.min} max={bounds.max} /><div className="git-tag-detail">
          {selected ? <><h3>{selected.name}</h3>{selected.local ? <><dl><dt>{text('本地标签对象', 'Local tag object')}</dt><dd><code>{selected.local.objectSha}</code></dd><dt>{text('对象类型', 'Object type')}</dt><dd>{selected.local.objectType}</dd>{selected.local.peeledSha ? <><dt>{text('指向对象', 'Tagged object')}</dt><dd><code>{selected.local.peeledSha}</code> · {selected.local.peeledType}</dd></> : null}{selected.local.subject ? <><dt>{text('本地说明', 'Local subject')}</dt><dd>{selected.local.subject}</dd></> : null}</dl>{selected.local.commitSha ? <Button variant="secondary" disabled={disabled} onClick={() => props.onOpenCommit(selected.local!.commitSha!)}>{text('查看目标提交', 'View target commit')}</Button> : null}</> : <p>{text('此标签仅存在于远程，尚无本地对象。', 'This tag exists only on the remote; its object is not available locally.')}</p>}
          {location && page ? <><h4>{text('远程推送目标', 'Remote push destinations')}</h4>{page.destinations.map((destination, index) => <div className="git-tag-version" key={index}><span>{destination}</span><code>{selected.targets[index]?.objectSha ?? text('此目标上不存在', 'Absent on this destination')}</code>{selected.targets[index]?.peeledSha ? <small>{text('指向：', 'Points to: ')}{selected.targets[index]?.peeledSha}</small> : null}</div>)}</> : null}
          {!review ? <div className="git-tag-actions">{!location ? <><label>{text('推送到', 'Push to')}<select value={remote} disabled={disabled || !repository.snapshot.remotes.length} onChange={event => setRemote(event.target.value)}>{repository.snapshot.remotes.map(item => <option key={item} value={item}>{item}</option>)}</select></label><Button variant="secondary" disabled={disabled || needsReview || !remote || !selected.local} busy={preparing} onClick={() => void preparePush(selected)}>{text('推送标签…', 'Push tag…')}</Button></> : null}<Button variant="danger" disabled={disabled || needsReview || !page || loading} onClick={() => prepareDelete(selected)}>{location ? text('删除远程标签…', 'Delete remote tag…') : text('删除本地标签…', 'Delete local tag…')}</Button></div> : null}
          </> : !loading ? <p>{selection ? text('所选标签不在当前列表中，请重新选择或清除筛选。', 'The selected tag is not in this list. Select it again or clear the filter.') : text('选择标签查看版本及操作。', 'Select a tag to view its versions and actions.')}</p> : null}
          {review ? <section className="git-tag-review" aria-label={text('确认标签操作', 'Confirm tag action')}><h4>{review.title} · {review.name}</h4>{review.versions.map((version, index) => <div className="git-tag-version" key={index}><span>{version.destination}</span><code>{version.object ?? text('不存在，将跳过', 'Absent; will be skipped')}</code></div>)}<p>{review.action.type === 'delete_remote_tag' ? text('只删除所列服务器上核对过的标签版本，保留本地标签。此操作会影响其他使用者。', 'Delete the reviewed tag versions from the listed servers and keep the local tag. This affects other users.') : review.action.type === 'delete_tag' ? text('只删除本地标签，保留远程标签。', 'Delete only the local tag and keep remote tags.') : text('仅推送这个标签；已有的不同远程标签不会被覆盖。', 'Push only this tag; a different existing remote tag will not be overwritten.')}</p>{review.destructive ? <label className="git-tag-confirm"><input type="checkbox" checked={confirmed} disabled={disabled || needsReview} onChange={event => setConfirmed(event.target.checked)} />{text('确认删除以上标签引用', 'Confirm deleting these tag refs')}</label> : null}<div className="git-tag-actions"><Button variant="secondary" disabled={disabled} onClick={() => { setReview(null); setConfirmed(false); }}>{text('返回', 'Back')}</Button><Button variant={review.destructive ? 'danger' : 'primary'} disabled={disabled || needsReview || (review.destructive && !confirmed)} busy={running} onClick={() => void execute(review.action, review.title)}>{review.title}</Button></div></section> : null}
        </div></div>
      </>}
      <footer>{feedback ? <p role="status">{feedback}</p> : null}{error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}{needsReview ? <p role="status">{text('请重新载入并核对标签状态后再操作；未确认结果时不会自动重试。', 'Reload and review tag state before continuing. Unconfirmed operations are not automatically retried.')}</p> : null}{running ? <Button variant="secondary" disabled={aborting} onClick={async () => { setAborting(true); try { await props.onAbort(); } catch (reason) { if (alive.current) setError(reason); } finally { if (alive.current) setAborting(false); } }}>{text('中止操作', 'Abort operation')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}
