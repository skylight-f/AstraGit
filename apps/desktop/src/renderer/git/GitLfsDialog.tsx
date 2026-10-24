import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardClient, GitLfsChange, GitLfsPreview, GitLfsState, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import { GitLargeFileWarningSettings } from './GitLargeFileWarningSettings.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitLfs.css';

export interface GitLfsRequest { repository: ProjectGitRepositoryWorkbenchItem; change?: GitLfsChange }
export function GitLfsDialog(props: {
  request: GitLfsRequest; projectId: string; zh: boolean; busy: boolean;
  client: Pick<DashboardClient, 'loadRepositoryGitLfs' | 'previewRepositoryGitLfs'>;
  onClose(): void; onAbort(): Promise<void>;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const initial = props.request.change;
  const [operation, setOperation] = useState<GitLfsChange['operation']>(initial?.operation ?? 'track');
  const [directory, setDirectory] = useState(initial?.directory ?? ''); const [pattern, setPattern] = useState(initial?.pattern ?? '');
  const [literal, setLiteral] = useState(initial?.literal ?? false); const [lockable, setLockable] = useState('inherit'); const [skipHooks, setSkipHooks] = useState(false);
  const [remote, setRemote] = useState(''); const [include, setInclude] = useState(''); const [exclude, setExclude] = useState(''); const [allContent, setAllContent] = useState(false);
  const [state, setState] = useState<GitLfsState | null>(null); const [preview, setPreview] = useState<GitLfsPreview | null>(null);
  const [loading, setLoading] = useState(false); const [previewing, setPreviewing] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState('');
  const [tab, setTab] = useState<'patterns' | 'files' | 'status'>('patterns'); const [search, setSearch] = useState(''); const [limit, setLimit] = useState(200);
  const alive = useRef(true); const gate = useRef(false); const loadRequest = useRef<AbortController | null>(null); const previewRequest = useRef<AbortController | null>(null);
  const locked = props.busy || saving;
  const load = useCallback(async () => {
    loadRequest.current?.abort(); previewRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    setLoading(true); setPreview(null); setPreviewing(false);
    try {
      const value = await props.client.loadRepositoryGitLfs(props.projectId, props.request.repository.id, controller.signal);
      if (!alive.current || controller.signal.aborted) return false;
      setState(value); setError(null); setRemote(current => value.remotes.includes(current) ? current : value.remotes[0] ?? '');
      if (value.requiresInitialization) setOperation('install'); setSkipHooks(value.hookPresent);
      return true;
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); return false; }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [props.client, props.projectId, props.request.repository.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loadRequest.current?.abort(); previewRequest.current?.abort(); }; }, [load]);
  const change = useMemo<GitLfsChange>(() => operation === 'install' ? { operation, skipHooks }
    : operation === 'track' || operation === 'untrack' ? { operation, directory, pattern, ...(operation === 'track' ? { literal, ...(lockable === 'inherit' ? {} : { lockable: lockable === 'on' }) } : {}) }
    : { operation, remote, ...(['fetch', 'pull'].includes(operation) ? allContent ? { include: '', exclude: '' } : { ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) } : {}) }, [operation, directory, pattern, literal, lockable, skipHooks, remote, include, exclude, allContent]);
  const identity = JSON.stringify(change); const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => { previewRequest.current?.abort(); setPreview(null); setPreviewing(false); }, [identity]);
  async function prepare() {
    if (!state?.available || locked || loading || previewing) return;
    previewRequest.current?.abort(); const controller = new AbortController(); previewRequest.current = controller; const selected = identity;
    setPreviewing(true); setPreview(null); setError(null); setFeedback('');
    try {
      const value = await props.client.previewRepositoryGitLfs(props.projectId, props.request.repository.id, change, controller.signal);
      if (alive.current && !controller.signal.aborted && currentIdentity.current === selected) setPreview(value);
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setPreviewing(false); }
  }
  async function perform() {
    if (!preview || locked || gate.current) return; gate.current = true; setSaving(true); setError(null); setFeedback('');
    try {
      const result = await props.onExecute(props.request.repository, { type: 'manage_lfs', change: preview.change, expectedFingerprint: preview.fingerprint }, `Git LFS · ${actions.find(([value]) => value === operation)?.[1] ?? operation}`);
      if (!alive.current) return; setPreview(null);
      if (result.outcome === 'completed') {
        if (operation === 'install') setOperation('track'); const refreshed = await load();
        if (alive.current) setFeedback(refreshed ? text('操作已完成，已重新读取当前 LFS 状态。', 'Completed. Current LFS state was reloaded.') : text('操作已完成，但重新读取 LFS 状态失败。请查看错误并重新读取，不要重复执行写入。', 'The operation completed, but LFS state could not be reloaded. Review the error and reload instead of repeating the write.'));
      }
      else setError(result.error ?? new Error(text('结果未确认，请核对实际状态。', 'The result is unconfirmed. Review the actual state.')));
    } catch (reason) { if (alive.current) { setError(reason); setPreview(null); } }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  const network = ['fetch', 'pull', 'push'].includes(operation); const ruleOperation = operation === 'track' || operation === 'untrack';
  const query = search.toLocaleLowerCase(); const rules = state?.patterns.filter(rule => `${rule.pattern} ${rule.source}`.toLocaleLowerCase().includes(query)) ?? [];
  const files = state?.files.filter(file => file.name.toLocaleLowerCase().includes(query)) ?? [];
  const actions: Array<[GitLfsChange['operation'], string]> = [['install', text('初始化 / 修复当前仓库配置', 'Initialize / repair repository setup')], ['track', text('添加或更新跟踪规则', 'Add or update tracking rule')], ['untrack', text('取消所选规则的 LFS 跟踪', 'Remove LFS tracking rule')], ['fetch', text('只下载 LFS 对象', 'Fetch LFS objects only')], ['pull', text('下载并检出当前版本内容', 'Download and check out current content')], ['push', text('上传当前 HEAD 的 LFS 对象', 'Push LFS objects reachable from HEAD')]];
  return <ModalPortal role="dialog" aria-label={text('Git LFS 管理', 'Manage Git LFS')} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={locked}>
    <section className="git-lfs-dialog" data-modal-surface="dialog">
      <header><div><strong>Git LFS · {props.request.repository.name}</strong><small>{state?.version || text('独立系统工具', 'Independent system tool')}</small></div><Button variant="secondary" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      {loading ? <p role="status">{text('正在读取 LFS 配置与内容…', 'Reading LFS setup and contents…')}</p> : null}
      {state && !state.available ? <div className="git-lfs-notice"><strong>{text('未找到 Git LFS', 'Git LFS was not found')}</strong><p>{text('请先安装独立 Git LFS，再重新读取。macOS Homebrew 可使用：', 'Install Git LFS independently, then reload. With Homebrew on macOS:')}</p><code>brew install git-lfs</code></div> : null}
      {state?.requiresInitialization && state.available ? <p className="git-lfs-notice">{text('当前仓库需要明确初始化，之后才能读取跟踪规则与传输内容。打开此窗口不会自动配置仓库。', 'Initialize this repository explicitly before reading tracking rules or transferring contents. Opening this window does not configure the repository.')}</p> : null}
      <div className="git-lfs-layout">
        <aside><nav aria-label={text('LFS 内容', 'LFS contents')}>{(['patterns', 'files', 'status'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setLimit(200); }}>{value === 'patterns' ? text('规则', 'Rules') : value === 'files' ? text('文件', 'Files') : text('状态', 'Status')}</button>)}</nav>
          {tab !== 'status' ? <input type="search" aria-label={text('筛选 LFS 内容', 'Filter LFS contents')} placeholder={text('筛选规则或文件…', 'Filter rules or files…')} value={search} onChange={event => { setSearch(event.target.value); setLimit(200); }} /> : null}
          {state?.requiresInitialization ? <p>{text('初始化后显示实际清单。', 'The actual list is available after initialization.')}</p> : tab === 'patterns' ? <>{rules.slice(0, limit).map((rule, index) => <button type="button" key={`${rule.source}:${rule.pattern}:${index}`} className="git-lfs-item" disabled={locked || !rule.tracked || rule.inputPattern === undefined} title={rule.source} onClick={() => { setOperation('untrack'); setDirectory(rule.directory ?? ''); setPattern(rule.inputPattern!); setLiteral(false); }}><strong>{rule.pattern}</strong><small>{rule.source}{rule.lockable ? ` · ${text('可锁定', 'Lockable')}` : ''}{!rule.tracked ? ` · ${text('排除规则', 'Excluded')}` : ''}</small></button>)}{!rules.length ? <p>{text('没有匹配的 LFS 规则。', 'No matching LFS rules.')}</p> : null}</> : tab === 'files' ? <>{files.slice(0, limit).map(file => <div key={file.name} className="git-lfs-item"><strong>{file.name}</strong><small>{file.size.toLocaleString()} B · {file.downloaded ? text('对象已下载', 'Object downloaded') : text('对象待下载', 'Object not downloaded')} · {file.checkout ? text('完整内容', 'Full content') : text('指针文件', 'Pointer file')}</small><code title={file.oid}>{file.oid.slice(0, 12)}</code></div>)}{!files.length ? <p>{text('没有匹配的 LFS 文件。', 'No matching LFS files.')}</p> : null}</> : <pre>{state?.status || text('暂无状态信息。', 'No status information.')}</pre>}
          {(tab === 'patterns' ? rules.length : tab === 'files' ? files.length : 0) > limit ? <button type="button" onClick={() => setLimit(value => value + 200)}>{text('显示更多', 'Show more')}</button> : null}
        </aside>
        <GitPaneSeparator name="lfs-list" label={text('调整 LFS 列表宽度', 'Resize LFS list')} initial={34} min={20} max={55} />
        <div className="git-lfs-form"><fieldset aria-label={text('LFS 操作设置', 'LFS action settings')} disabled={locked || loading || !state?.available}>
          <label>{text('操作', 'Action')}<select value={operation} onChange={event => setOperation(event.target.value as GitLfsChange['operation'])}>{actions.map(([value, label]) => <option key={value} value={value} disabled={state?.requiresInitialization && value !== 'install'}>{label}</option>)}</select></label>
          {ruleOperation ? <><label>{text('规则目录（留空为仓库根目录）', 'Rule directory (empty for repository root)')}<input value={directory} onChange={event => setDirectory(event.target.value)} placeholder="assets" /></label><label>{text('文件名或匹配规则', 'Filename or pattern')}<input value={pattern} onChange={event => setPattern(event.target.value)} placeholder="*.psd" spellCheck={false} /></label>{operation === 'track' ? <><label className="git-lfs-check"><input type="checkbox" checked={literal} onChange={event => setLiteral(event.target.checked)} />{text('作为完整文件名，转义通配符', 'Treat as a literal filename, escaping wildcards')}</label><label>{text('文件锁定属性', 'Lockable attribute')}<select value={lockable} onChange={event => setLockable(event.target.value)}><option value="inherit">{text('保留现有属性', 'Keep existing attribute')}</option><option value="on">{text('标记为可锁定', 'Make lockable')}</option><option value="off">{text('移除可锁定属性', 'Remove lockable attribute')}</option></select></label></> : <small>{text('从左侧选择实际规则，可保留正确目录与特殊字符。', 'Select an actual rule on the left to retain its directory and special characters.')}</small>}<p>{text('规则更改不会自动暂存、转换已有历史或创建提交。请检查 .gitattributes，并按需暂存相应文件。', 'Rule changes do not stage files, rewrite existing history or create commits. Review .gitattributes and stage the relevant files as needed.')}</p></> : null}
          {operation === 'install' ? <><label className="git-lfs-check"><input type="checkbox" checked={skipHooks} onChange={event => setSkipHooks(event.target.checked)} />{text('保留现有 Git 钩子，只配置仓库 filters', 'Keep existing Git hooks; configure repository filters only')}</label><small>{state?.hookPath}</small><p>{skipHooks ? text('推送前需确认现有 pre-push 钩子已调用 git lfs pre-push。', 'Ensure the existing pre-push hook invokes git lfs pre-push before pushing.') : text('会尝试安装 LFS 的四个 Git 钩子，不强制覆盖自定义内容。若钩子被拒绝，请核对可能已经更新的 filters。', 'Installs the four LFS Git hooks without forcing custom-hook replacement. If a hook is refused, review filters that may already have changed.')}</p></> : null}
          {network ? <><label>{text('远程', 'Remote')}<select value={remote} onChange={event => setRemote(event.target.value)}>{state?.remotes.length ? state.remotes.map(value => <option key={value} value={value}>{value}</option>) : <option value="">{text('请先在仓库设置中添加远程', 'Add a remote in repository settings first')}</option>}</select></label>{operation !== 'push' ? <><label className="git-lfs-check"><input type="checkbox" checked={allContent} onChange={event => setAllContent(event.target.checked)} />{text('下载全部当前内容，忽略 Git 配置的包含/排除规则', 'Download all current contents, ignoring configured include/exclude rules')}</label><label>{text('包含规则（留空沿用 Git 配置）', 'Include patterns (empty uses Git configuration)')}<input disabled={allContent} value={include} onChange={event => setInclude(event.target.value)} placeholder="*.psd,assets/**" /></label><label>{text('排除规则（留空沿用 Git 配置）', 'Exclude patterns (empty uses Git configuration)')}<input disabled={allContent} value={exclude} onChange={event => setExclude(event.target.value)} /></label></> : null}<p>{operation === 'fetch' ? text('仅下载到 LFS 缓存，不改工作区文件。', 'Downloads to the LFS cache without checking out files.') : operation === 'pull' ? text('下载并检出当前版本内容，不执行 Git pull 或合并远程分支。', 'Downloads and checks out current content without Git pull or branch merging.') : text('只上传当前 HEAD 可达的 LFS 对象，不推送 Git 分支。', 'Uploads only LFS objects reachable from current HEAD, without pushing Git branches.')}</p></> : null}
          <Button variant="secondary" disabled={previewing || (ruleOperation && !pattern) || (network && !remote)} onClick={() => void prepare()}>{previewing ? text('正在核对…', 'Reviewing…') : text('预览操作范围', 'Review operation scope')}</Button>
        </fieldset>
        <GitLargeFileWarningSettings zh={props.zh} disabled={locked} />
        {error ? <div role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
        {preview ? <section className="git-lfs-preview"><strong>{actions.find(([value]) => value === preview.change.operation)?.[1]}</strong><p>{preview.state.branch || text('分离 HEAD', 'Detached HEAD')} · {preview.state.headSha.slice(0, 12) || text('尚无提交', 'No commits')}</p>{props.zh ? <ul>{preview.effects.map((effect, index) => <li key={index}>{effect}</li>)}</ul> : null}<Button disabled={locked || loading} onClick={() => void perform()}>{text('确认执行', 'Confirm operation')}</Button></section> : null}
        {feedback ? <p role="status">{feedback}</p> : null}
        </div>
      </div>
      <footer><Button variant="secondary" disabled={locked || loading} onClick={() => void load()}>{text('重新读取', 'Reload')}</Button>{saving ? <Button variant="secondary" onClick={() => void props.onAbort().catch(setError)}>{text('中止并核对结果', 'Cancel and review outcome')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}
