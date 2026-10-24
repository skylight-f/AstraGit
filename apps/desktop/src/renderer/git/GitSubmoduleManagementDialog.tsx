import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitSubmoduleChange, GitSubmodulePreview, GitSubmoduleState, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitSubmoduleManagement.css';

export function GitSubmoduleManagementDialog(props: {
  repository: ProjectGitRepositoryWorkbenchItem; projectId: string;
  client: Pick<DashboardClient, 'loadRepositoryGitSubmodules' | 'previewRepositoryGitSubmodule'>;
  zh: boolean; busy: boolean; initialPath?: string; onClose(): void; onAbort(): Promise<void>;
  onOpenRepository(path: string): void;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [state, setState] = useState<GitSubmoduleState | null>(null);
  const [operation, setOperation] = useState<GitSubmoduleChange['operation']>('update');
  const [path, setPath] = useState(props.initialPath ?? ''); const [url, setUrl] = useState(''); const [branch, setBranch] = useState('');
  const [keepFiles, setKeepFiles] = useState(true); const [recursive, setRecursive] = useState(false); const [remote, setRemote] = useState(false);
  const [strategy, setStrategy] = useState<'checkout' | 'merge' | 'rebase'>('checkout');
  const [adoptExisting, setAdoptExisting] = useState(false); const [allowLocal, setAllowLocal] = useState(false);
  const [preview, setPreview] = useState<GitSubmodulePreview | null>(null); const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [confirmed, setConfirmed] = useState(false); const [feedback, setFeedback] = useState('');
  const alive = useRef(true); const gate = useRef(false); const request = useRef<AbortController | null>(null);
  const choose = (nextPath: string, nextState = state) => {
    const module = nextState?.modules.find(item => item.path === nextPath);
    setPath(nextPath); setUrl(module?.url ?? ''); setBranch(module?.branch ?? ''); setPreview(null); setConfirmed(false); setError(null); setFeedback('');
  };
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true);
    try {
      const next = await props.client.loadRepositoryGitSubmodules(props.projectId, props.repository.id, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setState(next); setPreview(null); setConfirmed(false); setError(null);
      setPath(previous => next.modules.some(item => item.path === previous) ? previous : next.modules[0]?.path ?? '');
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [props.client, props.projectId, props.repository.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);
  const change: GitSubmoduleChange = {
    operation, path,
    ...(operation === 'add' || operation === 'set_url' ? { url } : {}),
    ...(operation === 'set_branch' || operation === 'add' && branch ? { branch: branch || null } : {}),
    ...(operation === 'remove' ? { keepFiles } : {}),
    ...(operation === 'sync' || operation === 'update' ? { recursive } : {}),
    ...(operation === 'update' ? { remote, strategy } : {}),
    ...(operation === 'add' ? { adoptExisting } : {}),
    ...(operation === 'add' || operation === 'update' ? { allowLocal } : {}),
  };
  const changeKey = changeIdentity(change);
  const currentChange = useRef(changeKey); currentChange.current = changeKey;
  const previousChange = useRef(changeKey);
  useEffect(() => { if (previousChange.current === changeKey) return; previousChange.current = changeKey; request.current?.abort(); setLoading(false); setPreview(null); setConfirmed(false); }, [changeKey]);
  const locked = saving || props.busy;
  const module = state?.modules.find(item => item.path === path);
  async function prepare() {
    if (locked || loading || gate.current) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setPreview(null); setError(null); setFeedback(''); const identity = changeKey;
    try {
      const value = await props.client.previewRepositoryGitSubmodule(props.projectId, props.repository.id, change, controller.signal);
      if (alive.current && !controller.signal.aborted && currentChange.current === identity) { setPreview(value); setConfirmed(false); }
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }
  async function perform() {
    if (!preview || locked || !confirmed || gate.current || changeIdentity(preview.change) !== changeKey) return;
    gate.current = true; setSaving(true); setError(null); setFeedback('');
    try {
      const result = await props.onExecute(props.repository, { type: 'manage_submodule', change: preview.change, expectedFingerprint: preview.fingerprint }, `${text('子模块', 'Submodule')} · ${operationLabel(operation, props.zh)}`);
      if (!alive.current) return;
      setPreview(null); setConfirmed(false);
      if (result.outcome === 'completed') { await load(); setFeedback(text('操作已完成。配置或引用变动请在文件状态中核对并提交。', 'Operation completed. Review and commit configuration or gitlink changes in File Status.')); }
      else { setError(result.error ?? new Error(text('操作未完成，请刷新父仓库与子仓库核对实际状态。', 'The operation did not complete. Reload the parent and child repositories to review their actual state.'))); }
    } catch (reason) { if (alive.current) { setError(reason); setPreview(null); setConfirmed(false); } }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  return <ModalPortal role="dialog" aria-label={text('子模块管理', 'Submodule management')} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={locked}>
    <section className="git-submodule-management" data-modal-surface="dialog">
      <header><div><strong>{text('子模块管理', 'Submodule management')} · {props.repository.name}</strong><p>{text('每次操作只处理当前选定模块；父仓库的配置与引用仍需自行提交。', 'Each operation acts on the selected module. Commit configuration and gitlink changes in the parent separately.')}</p></div><Button variant="secondary" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <div className="git-submodule-layout">
        <aside aria-label={text('已登记子模块', 'Registered submodules')}><Button variant="secondary" disabled={locked || loading} onClick={() => { setOperation('add'); choose(''); }}>{text('添加子模块…', 'Add submodule…')}</Button>
          {state?.modules.map(item => <button type="button" key={item.path} aria-pressed={item.path === path && operation !== 'add'} disabled={locked} onClick={() => { setOperation('update'); choose(item.path); }}><strong>{item.path}</strong><small>{item.initialized ? text('已初始化', 'Initialized') : text('未初始化', 'Not initialized')}{item.changedPaths.length ? ` · ${text('有本地内容', 'Local content')}` : ''}</small></button>)}
          {!state?.modules.length && !loading ? <p>{text('当前没有登记的子模块。', 'No registered submodules.')}</p> : null}
        </aside>
        <GitPaneSeparator name="submodule-list" label={text('调整子模块列表宽度', 'Resize submodule list')} initial={28} min={20} max={45} />
        <div className="git-submodule-content">
          <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
            <label>{text('操作', 'Operation')}<select value={operation} disabled={locked} onChange={event => { const next = event.target.value as GitSubmoduleChange['operation']; setOperation(next); if (next === 'add') choose(''); else if (module) choose(module.path); else choose(state?.modules[0]?.path ?? ''); }}>{(['update', 'add', 'set_url', 'set_branch', 'sync', 'absorb', 'deinit', 'remove'] as const).map(value => <option key={value} value={value}>{operationLabel(value, props.zh)}</option>)}</select></label>
            <label>{text('模块路径', 'Module path')}{operation === 'add' ? <input value={path} disabled={locked} onChange={event => setPath(event.target.value)} placeholder="apps/library" required /> : <select value={path} disabled={locked} onChange={event => choose(event.target.value)}>{state?.modules.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}</select>}</label>
            {operation === 'add' || operation === 'set_url' ? <label>{text('仓库地址', 'Repository URL')}<input value={url} disabled={locked} onChange={event => setUrl(event.target.value)} spellCheck={false} required /></label> : null}
            {operation === 'add' || operation === 'set_branch' ? <label>{text('跟踪分支（留空使用远程默认）', 'Tracking branch (empty uses remote default)')}<input value={branch} disabled={locked} onChange={event => setBranch(event.target.value)} spellCheck={false} />{operation === 'set_branch' ? <small>{text('“.” 跟随父仓库同名分支。本地 branch 配置优先于 .gitmodules；如有覆盖，请在本地配置中核对。', '“.” follows the parent branch name. A local branch setting takes precedence over .gitmodules; review any local override.')}</small> : null}</label> : null}
            {operation === 'update' ? <><label>{text('更新策略', 'Update strategy')}<select value={strategy} disabled={locked} onChange={event => setStrategy(event.target.value as typeof strategy)}><option value="checkout">{text('检出目标提交', 'Check out target commit')}</option><option value="merge">{text('合并到当前子模块分支', 'Merge into current module branch')}</option><option value="rebase">{text('变基当前子模块分支', 'Rebase current module branch')}</option></select></label><label className="git-submodule-check"><input type="checkbox" checked={remote} disabled={locked} onChange={event => setRemote(event.target.checked)} />{text('获取跟踪分支的最新提交（不使用父仓库固定版本）', 'Fetch the latest tracking branch commit instead of the parent’s recorded version')}</label></> : null}
            {operation === 'update' || operation === 'sync' ? <label className="git-submodule-check"><input type="checkbox" checked={recursive} disabled={locked} onChange={event => setRecursive(event.target.checked)} />{text('递归处理嵌套子模块', 'Include nested submodules recursively')}</label> : null}
            {operation === 'remove' ? <label className="git-submodule-check"><input type="checkbox" checked={keepFiles} disabled={locked} onChange={event => setKeepFiles(event.target.checked)} />{text('保留本地目录与其中的修改', 'Keep the local directory and its changes')}</label> : null}
            {operation === 'add' ? <label className="git-submodule-check"><input type="checkbox" checked={adoptExisting} disabled={locked} onChange={event => setAdoptExisting(event.target.checked)} />{text('目标已是 Git 仓库时，登记现有仓库', 'Register an existing Git repository at the destination')}</label> : null}
            {operation === 'add' || operation === 'update' ? <label className="git-submodule-check"><input type="checkbox" checked={allowLocal} disabled={locked} onChange={event => setAllowLocal(event.target.checked)} />{text('本次命令允许本地 file 协议', 'Allow the local file protocol for this command')}</label> : null}
            {module && operation !== 'add' ? <dl><dt>{text('父仓库记录', 'Recorded by parent')}</dt><dd>{module.recordedSha || text('缺失', 'Missing')}</dd><dt>HEAD</dt><dd>{module.checkedOutBranch ? `${module.checkedOutBranch} · ` : ''}{module.headSha || text('未检出', 'Not checked out')}</dd><dt>{text('共享地址 / 本地地址', 'Shared URL / local URL')}</dt><dd>{module.url}<br />{module.localUrl ?? text('未登记本地地址', 'No local URL registered')}</dd><dt>{text('共享分支 / 本地覆盖', 'Shared branch / local override')}</dt><dd>{module.branch ?? '—'} / {module.localBranch ?? '—'}</dd></dl> : null}
            <Button type="submit" variant="secondary" disabled={locked || loading || !path || (operation === 'add' || operation === 'set_url') && !url}>{text('预览影响', 'Preview effects')}</Button>
          </form>
          {loading ? <p role="status">{text('正在读取实际状态…', 'Reading actual state…')}</p> : null}
          {error ? <div role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
          {preview ? <section className="git-submodule-preview" aria-label={text('操作影响', 'Operation effects')}><h3>{text('请核对本次影响', 'Review this operation')}</h3><p>{preview.change.path}</p>{preview.existingHeadSha ? <p>{text('现有仓库 HEAD：', 'Existing repository HEAD: ')}{preview.existingHeadSha}</p> : null}<ul>{preview.effects.map(effect => <li key={effect}>{effectLabel(effect, props.zh)}</li>)}</ul><label className="git-submodule-check"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} />{text('已核对以上影响', 'I reviewed these effects')}</label><Button disabled={locked || !confirmed} onClick={() => void perform()}>{text('执行操作', 'Execute operation')}</Button></section> : null}
          {feedback ? <p role="status">{feedback}</p> : null}
        </div>
      </div>
      <footer>{module?.initialized ? <Button variant="secondary" disabled={locked} onClick={() => props.onOpenRepository(module.path)}>{text('打开子仓库文件状态', 'Open module File Status')}</Button> : null}<Button variant="secondary" disabled={locked || loading} onClick={() => void load()}>{text('重新载入', 'Reload')}</Button>{saving ? <Button variant="secondary" onClick={() => void props.onAbort().catch(setError)}>{text('中止操作并核对结果', 'Cancel and review outcome')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}
function operationLabel(value: GitSubmoduleChange['operation'], zh: boolean) {
  const labels = { absorb: ['整理 Git 元数据', 'Absorb Git metadata'], add: ['添加', 'Add'], remove: ['移除子模块', 'Remove submodule'], deinit: ['停用本地工作区', 'Deinitialize local worktree'], set_url: ['修改地址', 'Change URL'], set_branch: ['修改跟踪分支', 'Change tracking branch'], sync: ['同步共享地址到本地配置', 'Sync shared URL to local config'], update: ['初始化 / 更新', 'Initialize / update'] };
  return labels[value][zh ? 0 : 1];
}
function effectLabel(value: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    move_git_metadata_keep_worktree: ['将内嵌 Git 元数据迁入父仓库 .git/modules，并更新链接；工作区内容保留。', 'Move embedded Git metadata into the parent’s .git/modules and update links; retain worktree contents.'],
    adopt_existing: ['登记现有仓库当前提交，不重新克隆。', 'Register the existing repository’s current commit without cloning again.'],
    stage_gitlink_and_gitmodules: ['将子模块引用和 .gitmodules 变动放入父仓库暂存区，不自动提交。', 'Stage the gitlink and .gitmodules changes in the parent without committing.'],
    keep_worktree_remove_registration: ['移除父仓库登记，保留本地目录；它可能作为独立仓库继续显示。', 'Remove the parent registration and retain the directory; it may remain visible as an independent repository.'],
    remove_worktree_keep_object_database: ['移除模块工作区，保留 .git/modules 对象库以便历史检出。', 'Remove the module worktree and retain its .git/modules object database for historical checkouts.'],
    remove_worktree_keep_registration_and_objects: ['移除本地模块工作区和本地登记，保留父仓库版本记录、共享配置和对象库。', 'Remove the local worktree and registration; retain the parent gitlink, shared config and object database.'],
    edit_gitmodules_and_sync_local_url: ['修改 .gitmodules 并同步本地地址；不连接远程，共享配置变动尚未暂存。', 'Edit .gitmodules and sync the local URL without contacting the remote. Shared changes remain unstaged.'],
    edit_gitmodules_branch: ['只修改 .gitmodules 跟踪分支，不获取或检出提交；变动尚未暂存。', 'Edit the shared tracking branch without fetching or checking out commits; changes remain unstaged.'],
    sync_url_without_network: ['将共享地址同步到本地子模块配置，不获取远程提交。', 'Sync shared URLs to local submodule config without fetching commits.'],
    fetch_remote_branch: ['获取跟踪分支最新提交；完成后父仓库的子模块引用可能有变动。', 'Fetch the latest tracking branch commit. The parent gitlink may then differ.'],
    checkout_recorded_commit: ['使用父仓库暂存区记录的模块提交；缺失对象时可能需要下载。', 'Use the module commit recorded in the parent index; missing objects may require a download.'],
    checkout: ['检出目标版本，不使用 force；实际检出时通常进入分离 HEAD。', 'Check out the target without force, normally leaving a detached HEAD.'],
    merge: ['合并到子模块当前分支，可能暂停并留下冲突；届时打开子仓库处理。', 'Merge into the current module branch; conflicts may pause the operation. Open the module to resolve them.'],
    rebase: ['变基子模块当前分支，可能改写本地提交或暂停产生冲突。', 'Rebase the module branch, potentially rewriting local commits or pausing with conflicts.'],
  };
  return labels[value]?.[zh ? 0 : 1] ?? value;
}

function changeIdentity(value: GitSubmoduleChange) { return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))); }
