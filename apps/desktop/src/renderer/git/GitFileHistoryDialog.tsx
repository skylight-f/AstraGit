import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DashboardClient, GitFileHistoryEntry, GitFileHistoryPage, GitFileOriginLine, GitFileRevision, GitTrackedFilePage, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { SideBySideDiff } from './ProjectGitDiffViewer.js';
import './gitFileHistory.css';

export interface GitFileHistoryRequest {
  repository: ProjectGitRepositoryWorkbenchItem;
  path?: string;
  /** A commit-file entry keeps its selected revision, even when HEAD changes. */
  ref?: string;
  view?: 'history' | 'blame';
}
interface FileTarget { path: string; ref?: string; workingTree?: boolean; previousPath?: string; line?: number }
type HistoryClient = Pick<DashboardClient, 'loadProjectGitTrackedFiles' | 'loadProjectGitFileHistory' | 'loadProjectGitFileRevision'>;
type View = 'diff' | 'blame' | 'content';

/** A read-only file browser and log. This never stages files or changes branches. */
export function GitFileHistoryDialog(props: { request: GitFileHistoryRequest; projectId: string; client: HistoryClient; zh: boolean; onClose: () => void; onOpenCommit: (hash: string) => void }) {
  const [request] = useState(props.request);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [path, setPath] = useState(request.path ?? '');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<GitTrackedFilePage | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<unknown>(null);
  const [follow, setFollow] = useState(true);
  const [history, setHistory] = useState<GitFileHistoryPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [target, setTarget] = useState<FileTarget | null>(null);
  const [trail, setTrail] = useState<FileTarget[]>([]);
  const [view, setView] = useState<View>(request.view === 'blame' ? 'blame' : 'diff');
  const [revision, setRevision] = useState<GitFileRevision | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<unknown>(null);
  const [readKey, setReadKey] = useState('');
  const revisionKey = JSON.stringify([target, view]);
  const [reload, setReload] = useState(0);
  const listRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const [selectedHash, setSelectedHash] = useState('');
  const layout = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ files: { min: 18, max: 55 }, log: { min: 25, max: 75 } });
  useLayoutEffect(() => {
    const root = layout.current; const left = navigation.current;
    if (!root || !left) return;
    const measure = () => {
      const width = root.clientWidth; const height = left.clientHeight;
      if (!width || !height) return;
      const fileMinimum = Math.min(240, (width - 6) / 2); const detailMinimum = Math.min(300, (width - 6) / 2);
      const rowMinimum = Math.min(110, (height - 6) / 2);
      const next = { files: { min: fileMinimum / width * 100, max: (width - detailMinimum - 6) / width * 100 }, log: { min: rowMinimum / height * 100, max: (height - rowMinimum - 6) / height * 100 } };
      setBounds(current => ['files', 'log'].every(key => {
        const axis = key as keyof typeof next;
        return Math.abs(current[axis].min - next[axis].min) < .1 && Math.abs(current[axis].max - next[axis].max) < .1;
      }) ? current : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(root); observer.observe(left); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    setListLoading(true); setListError(null); setList(null);
    const timer = setTimeout(() => {
      void props.client.loadProjectGitTrackedFiles(props.projectId, request.repository.id, { ref: request.ref, search, limit: 100 }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setList(value); })
        .catch(reason => { if (!controller.signal.aborted) setListError(reason); })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [props.client, props.projectId, request, search, reload]);
  async function moreFiles() {
    if (!list || list.nextOffset === null || listLoading) return;
    const previous = list; const controller = new AbortController(); listRequest.current?.abort(); listRequest.current = controller;
    setListLoading(true); setListError(null);
    try {
      const next = await props.client.loadProjectGitTrackedFiles(props.projectId, request.repository.id, { ref: request.ref, search, offset: previous.nextOffset!, limit: 100, expectedFingerprint: previous.fingerprint }, controller.signal);
      if (!controller.signal.aborted) setList({ ...next, paths: [...previous.paths, ...next.paths] });
    } catch (reason) { if (!controller.signal.aborted) setListError(reason); }
    finally { if (!controller.signal.aborted) setListLoading(false); }
  }
  useEffect(() => {
    historyRequest.current?.abort();
    const controller = new AbortController(); historyRequest.current = controller;
    setHistory(null); setHistoryError(null); setTarget(null); setTrail([]); setSelectedHash('');
    if (!path) { setHistoryLoading(false); return () => controller.abort(); }
    setHistoryLoading(true);
    void props.client.loadProjectGitFileHistory(props.projectId, request.repository.id, { path, ref: request.ref, followRenames: follow, limit: 50 }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        setHistory(value);
        const first = value.items[0];
        if (request.view === 'blame') {
          setView('blame'); setTarget({ path, ref: value.revision || undefined, workingTree: !request.ref });
        } else if (first) choose(first);
        else { setView('content'); setTarget({ path, ref: value.revision || undefined, workingTree: !request.ref }); }
      })
      .catch(reason => { if (!controller.signal.aborted) setHistoryError(reason); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, request, path, follow, reload]);
  async function moreHistory() {
    if (!history?.revision || history.nextOffset === null || historyLoading) return;
    const previous = history; const controller = new AbortController(); historyRequest.current?.abort(); historyRequest.current = controller;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const next = await props.client.loadProjectGitFileHistory(props.projectId, request.repository.id, { path: previous.historyPath, ref: previous.revision, followRenames: follow, offset: previous.nextOffset!, limit: 50 }, controller.signal);
      if (!controller.signal.aborted) setHistory({ ...next, items: [...previous.items, ...next.items] });
    } catch (reason) { if (!controller.signal.aborted) setHistoryError(reason); }
    finally { if (!controller.signal.aborted) setHistoryLoading(false); }
  }
  useEffect(() => () => { listRequest.current?.abort(); historyRequest.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setReadKey(revisionKey); setRevision(null); setRevisionError(null);
    if (!target) { setRevisionLoading(false); return () => controller.abort(); }
    setRevisionLoading(true);
    void props.client.loadProjectGitFileRevision(props.projectId, request.repository.id, { ...target, withBlame: view === 'blame', includeDiff: view === 'diff' }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setRevision(value); })
      .catch(reason => { if (!controller.signal.aborted) setRevisionError(reason); })
      .finally(() => { if (!controller.signal.aborted) setRevisionLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, request, target, view, revisionKey]);
  function choose(entry: GitFileHistoryEntry) {
    setSelectedHash(entry.hash); setTrail([]);
    setTarget({ path: entry.path, ref: entry.hash, previousPath: entry.previousPath });
  }
  const selected = history?.items.find(item => item.hash === selectedHash || (!target?.workingTree && item.hash === target?.ref && item.path === target?.path));
  const openAnchor = (workingTree: boolean) => {
    if (!history) return;
    setSelectedHash(''); setTrail([]); setView('blame'); setTarget({ path, ref: history.revision || undefined, workingTree });
  };
  const reason = revision?.unavailableReason;
  const selectedDiff = revision?.diff?.fileDiffs.find(file => file.newPath === target?.path || file.oldPath === target?.path);
  const reasons: Record<NonNullable<GitFileRevision['unavailableReason']>, [string, string]> = {
    missing: ['此版本中没有该文件；删除提交仍可查看差异，或打开删除前的版本。', 'This file is absent in this revision. A deletion commit still has a diff; you can open its previous revision.'],
    directory: ['所选项是目录，请选择其中的文件。', 'This item is a directory. Select a file inside it.'],
    symlink: ['符号链接仅显示链接目标，不读取目标文件。', 'Only the symbolic link target is shown; its destination is not read.'],
    submodule: ['此项是子模块引用，请在对应仓库查看文件历史。', 'This item is a submodule reference. Browse its repository for file history.'],
    binary: ['二进制或非 UTF-8 内容无法显示逐行归属。', 'Line attribution is unavailable for binary or non-UTF-8 contents.'],
    too_large: ['文件超过 4 MiB，内置文本预览不可用。', 'This file exceeds the 4 MiB text preview limit.'],
    too_many_lines: ['文件超过 100,000 行，内置文本预览不可用。', 'This file exceeds the 100,000-line text preview limit.'],
    uncommitted_file: ['此文件尚无已提交版本，以下行标记为未提交。', 'This file has no committed version. Its lines are marked uncommitted.'],
    no_commits: ['此仓库尚无提交；工作区内容仍可查看，行归属标记为未提交。', 'This repository has no commits. Working contents remain readable, with uncommitted attribution.'],
  };
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={text('文件历史与代码归属', 'File history and blame')} onDismiss={props.onClose}>
    <section className="git-file-history-dialog" data-modal-surface="dialog">
      <header><div><strong>{text('文件历史与代码归属', 'File history and blame')}</strong><small>{request.repository.name} · {request.ref ? text(`所选版本 ${request.ref.slice(0, 12)}`, `Selected revision ${request.ref.slice(0, 12)}`) : text('当前仓库', 'Current repository')}</small></div><Button variant="secondary" size="compact" onClick={() => setReload(value => value + 1)}>{text('重新载入', 'Reload')}</Button><Button variant="secondary" size="compact" onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <div ref={layout} className="git-file-history-layout">
        <aside ref={navigation} className="git-file-history-navigation">
          <section className="git-file-history-files" aria-label={text('全部已跟踪文件', 'All tracked files')}>
            <header><strong>{text('已跟踪文件', 'Tracked files')}{list ? ` (${list.total})` : ''}</strong><input autoFocus={!request.path} type="search" aria-label={text('搜索仓库内文件', 'Search repository files')} placeholder={text('搜索文件，包含未修改文件…', 'Search files, including unchanged files…')} value={search} onChange={event => setSearch(event.target.value)} /></header>
            <div className="git-file-history-file-list">{list?.paths.map(item => <button type="button" className={item === path ? 'is-current' : ''} key={item} title={item} onClick={() => setPath(item)}>{item}</button>)}{list && !list.paths.length ? <p>{text('没有匹配的已跟踪文件。未跟踪文件可从文件状态菜单打开。', 'No tracked files match. Open untracked files from their File Status menu.')}</p> : null}{listLoading ? <p role="status">{text('正在读取文件列表…', 'Loading files…')}</p> : null}{listError ? <VisibleApplicationError error={listError} language={props.zh ? 'zh-CN' : 'en'} /> : null}{list?.nextOffset !== null && list ? <Button size="compact" variant="secondary" disabled={listLoading || Boolean(listError)} onClick={() => void moreFiles()}>{text('更多文件', 'More files')}</Button> : null}</div>
          </section>
          <GitPaneSeparator name="file-history-log" label={text('调整文件列表与历史高度', 'Resize files and history')} axis="y" initial={36} min={bounds.log.min} max={bounds.log.max} />
          <section className="git-file-history-log" aria-label={text('所选文件历史', 'Selected file history')}>
            <header><strong title={path}>{path || text('选择文件', 'Select a file')}</strong><label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />{text('追踪重命名', 'Follow renames')}</label></header>
            <div className="git-file-history-log-list">{history?.items.map(entry => <button type="button" className={entry.hash === selectedHash ? 'is-current' : ''} key={entry.hash} title={`${entry.hash}\n${entry.path}\n${entry.subject}`} onClick={() => choose(entry)}><strong>{entry.subject || text('无提交说明', 'No commit message')}</strong><span><code>{entry.shortHash}</code> · {entry.author} · {new Date(entry.authoredAt).toLocaleDateString(props.zh ? 'zh-CN' : 'en-US')}</span>{entry.previousPath ? <small>{entry.previousPath} → {entry.path}</small> : null}</button>)}{history && !history.items.length ? <p>{text('所选版本之前没有此文件的提交记录。', 'There is no file history before this revision.')}</p> : null}{historyLoading ? <p role="status">{text('正在读取文件历史…', 'Loading file history…')}</p> : null}{historyError ? <VisibleApplicationError error={historyError} language={props.zh ? 'zh-CN' : 'en'} /> : null}{history?.nextOffset !== null && history ? <Button size="compact" variant="secondary" disabled={historyLoading || Boolean(historyError)} onClick={() => void moreHistory()}>{text('更早记录', 'Earlier entries')}</Button> : null}</div>
          </section>
        </aside>
        <GitPaneSeparator name="file-history-files" label={text('调整文件历史侧栏宽度', 'Resize file history sidebar')} initial={30} min={bounds.files.min} max={bounds.files.max} />
        <section className="git-file-history-preview" aria-label={text('文件版本详情', 'File revision details')}>
          <header><strong title={target?.path}>{target?.path || text('选择文件查看历史', 'Select a file to view history')}</strong><small>{target ? target.workingTree ? text('工作区（包含未暂存修改）', 'Working tree (including unstaged changes)') : target.ref?.slice(0, 12) : ''}</small>
            <div className="git-file-history-actions">{trail.length ? <Button size="compact" variant="secondary" onClick={() => { setTarget(trail.at(-1)!); setTrail(current => current.slice(0, -1)); }}>{text('返回上一来源', 'Back to previous origin')}</Button> : null}
              {(['diff', 'blame', 'content'] as const).map(item => <Button size="compact" variant={view === item ? 'primary' : 'secondary'} key={item} disabled={!target} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'diff' ? text('差异', 'Diff') : item === 'blame' ? text('代码归属', 'Blame') : text('完整内容', 'Full contents')}</Button>)}
              {history ? <Button size="compact" variant="secondary" onClick={() => openAnchor(!request.ref)}>{request.ref ? text('所选基点归属', 'Selected base blame') : text('工作区归属', 'Working tree blame')}</Button> : null}
              {target?.ref && !target.workingTree ? <Button size="compact" variant="secondary" onClick={() => props.onOpenCommit(target.ref!)}>{text('查看提交', 'View commit')}</Button> : null}
              {selected?.changeType === 'D' && selected.parentHashes[0] ? <Button size="compact" variant="secondary" onClick={() => { setView('blame'); setSelectedHash(''); setTarget({ path: selected.previousPath ?? selected.path, ref: selected.parentHashes[0] }); }}>{text('删除前的版本', 'Revision before deletion')}</Button> : null}
            </div>
          </header>
          {target && (revisionLoading || readKey !== revisionKey) ? <p role="status">{text('正在读取固定版本…', 'Loading the selected revision…')}</p> : revisionError ? <VisibleApplicationError error={revisionError} language={props.zh ? 'zh-CN' : 'en'} /> : revision ? <>
            {reason ? <p className="git-file-history-notice" role="status">{reasons[reason][props.zh ? 0 : 1]}</p> : null}
            {view === 'diff' ? revision.diff ? <SideBySideDiff diff={selectedDiff ? { ...revision.diff, files: [selectedDiff.newPath || selectedDiff.oldPath], fileDiffs: [selectedDiff] } : revision.diff} zh={props.zh} title={revision.path} fill /> : <p>{text('此版本没有可显示的文本差异。', 'There is no text diff for this revision.')}</p> : view === 'blame' && revision.lines.length ? <FileOrigins lines={revision.lines} line={target?.line} zh={props.zh} onOpenCommit={props.onOpenCommit} onOrigin={line => { if (!target) return; setTrail(current => [...current, target]); setSelectedHash(''); setTarget({ path: line.filename, ref: line.commitHash, line: line.originalLine }); }} /> : revision.content !== null ? <pre className="git-file-history-content" tabIndex={0}>{revision.content || text('（空文件）', '(Empty file)')}</pre> : null}
          </> : <p>{text('从左侧选择文件或提交。', 'Choose a file or commit on the left.')}</p>}
        </section>
      </div>
    </section>
  </ModalPortal>;
}

/** Keep large blame files responsive; all rows retain their real line identities. */
function FileOrigins(props: { lines: GitFileOriginLine[]; line?: number; zh: boolean; onOrigin: (line: GitFileOriginLine) => void; onOpenCommit: (hash: string) => void }) {
  const viewport = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState({ top: 0, height: 500 });
  useLayoutEffect(() => {
    const root = viewport.current; if (!root) return;
    const measure = () => setVisible({ top: root.scrollTop, height: root.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(root);
    root.scrollTop = Math.max(0, (props.line ?? 1) - 4) * 28; measure();
    return () => observer.disconnect();
  }, [props.lines, props.line]);
  const first = Math.max(0, Math.floor(visible.top / 28) - 20); const last = Math.min(props.lines.length, Math.ceil((visible.top + visible.height) / 28) + 20);
  return <div ref={viewport} className="git-file-origins" tabIndex={0} aria-label={props.zh ? '逐行代码归属' : 'Line attribution'} onScroll={event => setVisible({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    <div className="git-file-origins-rows" style={{ paddingTop: first * 28, paddingBottom: (props.lines.length - last) * 28 }}>
      {props.lines.slice(first, last).map(line => {
        const uncommitted = /^0+$/u.test(line.commitHash);
        const date = line.authorTime ? new Date(line.authorTime * 1000).toLocaleString(props.zh ? 'zh-CN' : 'en-US') : '';
        return <div className={`git-file-origin-row${uncommitted ? ' is-uncommitted' : ''}${line.line === props.line ? ' is-current' : ''}`} key={line.line}>
          <span className="git-file-origin-author" title={`${line.author}\n${date}\n${line.subject}\n${line.filename}:${line.originalLine}`}><button type="button" disabled={uncommitted} onClick={() => props.onOpenCommit(line.commitHash)}>{uncommitted ? props.zh ? '未提交' : 'Uncommitted' : line.shortHash}</button><span>{line.author}</span>{line.authorTime ? <time dateTime={new Date(line.authorTime * 1000).toISOString()}>{new Date(line.authorTime * 1000).toLocaleDateString(props.zh ? 'zh-CN' : 'en-US')}</time> : null}</span>
          <button type="button" className="git-file-origin-source" disabled={uncommitted} title={props.zh ? `查看来源 ${line.filename}:${line.originalLine}` : `View origin ${line.filename}:${line.originalLine}`} onClick={() => props.onOrigin(line)}>{line.line}</button><code>{line.content || ' '}</code>
        </div>;
      })}
    </div>
  </div>;
}
