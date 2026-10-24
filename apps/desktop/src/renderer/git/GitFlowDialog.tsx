import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardClient, GitFlowChange, GitFlowConfiguration, GitFlowKind, GitFlowPreview, GitFlowState, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { GitPaneSeparator } from './GitPaneSeparator.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitFlow.css';

export interface GitFlowRequest { repository: ProjectGitRepositoryWorkbenchItem; change?: GitFlowChange }
const defaults: GitFlowConfiguration = { production: 'main', develop: 'develop', feature: 'feature/', bugfix: 'bugfix/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: '' };
export function GitFlowDialog(props: {
  request: GitFlowRequest; projectId: string; zh: boolean; busy: boolean;
  client: Pick<DashboardClient, 'loadRepositoryGitFlow' | 'previewRepositoryGitFlow'>;
  onClose(): void; onResolve(): void; onAbort(): Promise<void>;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const initial = props.request.change;
  const [operation, setOperation] = useState<GitFlowChange['operation']>(initial?.operation ?? 'start');
  const [kind, setKind] = useState<GitFlowKind>(initial && 'kind' in initial ? initial.kind : 'feature');
  const [name, setName] = useState(initial && 'name' in initial ? initial.name : '');
  const [configuration, setConfiguration] = useState(initial?.operation === 'init' ? initial.configuration : defaults);
  const [base, setBase] = useState(initial?.operation === 'start' ? initial.base ?? '' : '');
  const [fetch, setFetch] = useState(initial && 'fetch' in initial ? initial.fetch ?? false : false);
  const [keep, setKeep] = useState(initial?.operation === 'finish' ? initial.keepBranch ?? false : false);
  const [forceDelete, setForceDelete] = useState(initial?.operation === 'finish' ? initial.forceDelete ?? false : false); const [rebase, setRebase] = useState(initial?.operation === 'finish' ? initial.rebase ?? false : false);
  const [push, setPush] = useState(initial?.operation === 'finish' ? initial.pushAfter ?? false : false); const [skipTag, setSkipTag] = useState(initial?.operation === 'finish' ? initial.skipTag ?? false : false); const [message, setMessage] = useState(initial?.operation === 'finish' ? initial.tagMessage ?? '' : '');
  const [state, setState] = useState<GitFlowState | null>(null); const [preview, setPreview] = useState<GitFlowPreview | null>(null);
  const [loading, setLoading] = useState(false); const [previewing, setPreviewing] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState(''); const [limit, setLimit] = useState(200);
  const alive = useRef(true); const gate = useRef(false); const loader = useRef<AbortController | null>(null); const reviewer = useRef<AbortController | null>(null);
  const locked = props.busy || saving;
  const load = useCallback(async (retainForm = false) => {
    loader.current?.abort(); reviewer.current?.abort(); const controller = new AbortController(); loader.current = controller;
    setLoading(true); setPreview(null); setPreviewing(false);
    try {
      const value = await props.client.loadRepositoryGitFlow(props.projectId, props.request.repository.id, controller.signal);
      if (!alive.current || controller.signal.aborted) return false;
      setState(value); setError(null);
      if (!retainForm && !props.request.change) {
        setConfiguration(value.configuration);
        const current = value.branches.find(branch => branch.branch === value.branch);
        setOperation(!value.initialized ? 'init' : current ? 'finish' : 'start');
        if (current) { setKind(current.kind); setName(current.name); }
      }
      return true;
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); return false; }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [props.client, props.projectId, props.request.repository.id, props.request.change]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; loader.current?.abort(); reviewer.current?.abort(); }; }, [load]);
  const change = useMemo<GitFlowChange>(() => operation === 'init' ? { operation, configuration }
    : operation === 'start' ? { operation, kind, name, ...(base ? { base } : {}), fetch }
    : { operation, kind, name, keepBranch: keep, ...(!keep ? { forceDelete } : {}), fetch, pushAfter: push, ...(kind === 'feature' ? { rebase } : { skipTag, ...(!skipTag ? { tagMessage: message } : {}) }) }, [operation, configuration, kind, name, base, fetch, keep, forceDelete, push, rebase, skipTag, message]);
  const identity = JSON.stringify(change); const latestIdentity = useRef(identity); latestIdentity.current = identity;
  useEffect(() => { reviewer.current?.abort(); setPreview(null); setPreviewing(false); }, [identity]);
  async function prepare() {
    if (!state?.supported || locked || loading || previewing) return;
    reviewer.current?.abort(); const controller = new AbortController(); reviewer.current = controller; const selected = identity;
    setPreviewing(true); setPreview(null); setError(null); setFeedback('');
    try {
      const value = await props.client.previewRepositoryGitFlow(props.projectId, props.request.repository.id, change, controller.signal);
      if (alive.current && !controller.signal.aborted && latestIdentity.current === selected) setPreview(value);
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setPreviewing(false); }
  }
  async function perform() {
    if (!preview || locked || loading || gate.current) return; gate.current = true; setSaving(true); setError(null); setFeedback('');
    const selected = preview;
    try {
      const result = await props.onExecute(props.request.repository, { type: 'manage_flow', change: selected.change, expectedFingerprint: selected.fingerprint }, `Git Flow · ${selected.change.operation}`);
      if (!alive.current) return; setPreview(null);
      const refreshed = await load(result.outcome !== 'completed'); if (!alive.current) return;
      if (result.outcome === 'completed') setFeedback(refreshed ? text('Git Flow 操作已完成，已读取实际分支与标签状态。', 'Git Flow completed. Actual branch and tag state was reloaded.') : text('操作已完成，但刷新失败。请重新读取，不要重复执行。', 'The operation completed, but reload failed. Reload instead of repeating the operation.'));
      else if (result.error) setError(result.error);
      else setFeedback(text('结果未确认，请核对分支、标签及冲突状态后再继续。', 'The result is unconfirmed. Review branches, tags and conflicts before continuing.'));
    } catch (reason) { if (alive.current) { setError(reason); setPreview(null); } }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  const fields: Array<[keyof GitFlowConfiguration, string]> = [['production', text('生产分支', 'Production branch')], ['develop', text('开发分支', 'Development branch')], ['feature', 'Feature'], ['bugfix', 'Bugfix'], ['release', 'Release'], ['hotfix', 'Hotfix'], ['support', 'Support'], ['versionTag', text('版本标签前缀', 'Version tag prefix')]];
  const branches = state?.branches.filter(branch => branch.kind === kind) ?? [];
  const chooseBranch = (value: NonNullable<GitFlowState['branches']>[number]) => { setKind(value.kind); setName(value.name); setOperation('finish'); };
  return <ModalPortal role="dialog" aria-label="Git Flow" rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={locked}>
    <section className="git-flow-dialog" data-modal-surface="dialog">
      <header><div><strong>Git Flow · {props.request.repository.name}</strong><small>{text('应用内置工具', 'Bundled tool')}{state?.version ? ` · ${state.version}` : ''}</small></div><Button variant="secondary" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      {loading ? <p role="status">{text('正在读取 Git Flow…', 'Reading Git Flow…')}</p> : null}
      {state && (!state.available || !state.supported) ? <div className="git-flow-notice"><strong>{text('内置 Git Flow 不可用', 'Bundled Git Flow is unavailable')}</strong><p>{text('请修复或重新安装 AstraGit，再重新读取。', 'Repair or reinstall AstraGit, then reload.')}</p></div> : null}
      {state?.integration.length ? <div className="git-flow-notice"><p>{text('当前整合尚未完成。Git Flow 先前可能已更新生产分支或标签；请先处理冲突并继续整合，再回来重新预览原分支。中止当前整合不会撤销之前的步骤。', 'An integration is active. Git Flow may already have updated production or tags. Resolve conflicts and continue the integration, then return and preview the original branch. Aborting this integration does not undo earlier steps.')}</p><Button variant="secondary" disabled={locked} onClick={props.onResolve}>{text('查看冲突与整合状态', 'Review conflicts and integration')}</Button></div> : null}
      <div className="git-flow-layout">
        <aside aria-label={text('Git Flow 分支', 'Git Flow branches')}><strong>{text('当前分支', 'Current branch')}</strong><p>{state?.branch || text('尚无提交或分离 HEAD', 'No commits or detached HEAD')}</p><strong>{text('待完成分支', 'Flow branches')}</strong>
          {(state?.branches ?? []).slice(0, limit).map(branch => <button type="button" key={`${branch.kind}:${branch.branch}`} disabled={locked} aria-pressed={operation === 'finish' && kind === branch.kind && name === branch.name} onClick={() => chooseBranch(branch)}><strong>{branch.branch}</strong><small>{branch.kind} · {branch.base} · {branch.sha.slice(0, 8)}</small></button>)}
          {!state?.branches.length ? <p>{text('没有待完成的 Git Flow 分支。', 'No flow branches are pending.')}</p> : null}
          {(state?.branches.length ?? 0) > limit ? <Button variant="secondary" onClick={() => setLimit(value => value + 200)}>{text('显示更多', 'Show more')}</Button> : null}
        </aside>
        <GitPaneSeparator name="flow-list" label={text('调整 Git Flow 分支列表宽度', 'Resize Git Flow branch list')} initial={32} min={20} max={55} />
        <div className="git-flow-form"><fieldset disabled={locked || loading || !state?.supported}>
          <label>{text('操作', 'Action')}<select value={operation} onChange={event => setOperation(event.target.value as GitFlowChange['operation'])}><option value="init">{text('初始化 / 调整 Git Flow 配置', 'Initialize / adjust Git Flow configuration')}</option><option value="start" disabled={!state?.initialized}>{text('开始分支', 'Start branch')}</option><option value="finish" disabled={!state?.initialized}>{text('完成分支', 'Finish branch')}</option></select></label>
          {operation === 'init' ? <><div className="git-flow-config">{fields.map(([key, label]) => <label key={key}>{label}{!['production', 'develop', 'versionTag'].includes(key) ? text(' 前缀', ' prefix') : ''}<input value={configuration[key]} spellCheck={false} onChange={event => setConfiguration(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div><p>{text('只调整当前仓库的配置。开发分支不存在时从生产分支创建；无提交的仓库会创建空初始提交。已有提交的生产分支必须实际存在。', 'Changes repository configuration only. A missing development branch is created from production. An unborn repository gets an empty initial commit. In an existing history, production must be an existing local branch.')}</p></> : <>
            <label>{text('分支类型', 'Branch type')}<select value={kind} onChange={event => { setKind(event.target.value as GitFlowKind); setBase(''); setName(''); }}><option value="feature">Feature</option><option value="release">Release</option><option value="hotfix">Hotfix</option></select></label>
            <label>{text('名称（不含前缀）', 'Name (without prefix)')}{operation === 'finish' ? <select value={branches.some(branch => branch.name === name) ? name : ''} onChange={event => setName(event.target.value)}><option value="">{text('请选择分支', 'Select a branch')}</option>{branches.map(branch => <option key={branch.branch} value={branch.name}>{branch.branch}</option>)}</select> : <input value={name} spellCheck={false} onChange={event => setName(event.target.value)} />}</label>
            {operation === 'start' ? <label>{text('起点分支', 'Base branch')}<select value={base} onChange={event => setBase(event.target.value)}><option value="">{text('默认', 'Default')} · {kind === 'hotfix' ? state?.configuration.production : state?.configuration.develop}</option>{state?.localBranches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label> : <>
              <label className="git-flow-check"><input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)} />{text('完成后保留本地分支', 'Keep the local branch after finishing')}</label>
              {!keep ? <label className="git-flow-check"><input type="checkbox" checked={forceDelete} onChange={event => setForceDelete(event.target.checked)} />{text('强制删除本地分支（需确认放弃其独有提交）', 'Force local branch deletion (confirm discarding unique commits)')}</label> : null}
              {kind === 'feature' ? <label className="git-flow-check"><input type="checkbox" checked={rebase} onChange={event => setRebase(event.target.checked)} />{text('合并前先变基到起点分支', 'Rebase onto the base branch before merging')}</label> : <><label className="git-flow-check"><input type="checkbox" checked={skipTag} onChange={event => setSkipTag(event.target.checked)} />{text('不创建版本标签', 'Do not create a version tag')}</label>{!skipTag ? <label>{text('版本标签说明', 'Version tag message')}<textarea rows={3} value={message} placeholder={text('创建新标签时必填；恢复时已有标签将核对并保留', 'Required for a new tag; an existing tag is checked and retained on resume')} onChange={event => setMessage(event.target.value)} /></label> : null}</>}
              <label className="git-flow-check"><input type="checkbox" checked={push} onChange={event => setPush(event.target.checked)} />{text('完成后推送相关分支及本次版本标签', 'Push the affected branches and this version tag after finishing')}</label>
              <p>{text('远程工作分支保留。流程中途冲突时，已完成的合并或标签不会自动撤销。', 'Remote flow branches are retained. A conflict does not automatically undo earlier completed merges or tags.')}</p>
            </>}
            <label className="git-flow-check"><input type="checkbox" checked={fetch} onChange={event => setFetch(event.target.checked)} />{text('操作前抓取基础分支', 'Fetch base branches before the operation')}</label>
          </>}
          <Button variant="secondary" disabled={previewing || Boolean(state?.integration.length) || (operation !== 'init' && !name)} onClick={() => void prepare()}>{previewing ? text('正在核对…', 'Reviewing…') : text('预览操作范围', 'Review operation scope')}</Button>
        </fieldset>
        {preview ? <section className="git-flow-preview"><strong>{text('确认 Git Flow 操作', 'Confirm Git Flow operation')}</strong><dl><dt>{text('分支', 'Branch')}</dt><dd>{preview.branch}</dd><dt>{text('涉及基础分支', 'Base branches')}</dt><dd>{preview.targets.join(' · ')}</dd>{preview.tag ? <><dt>{text('版本标签', 'Version tag')}</dt><dd>{preview.tag}</dd></> : null}</dl>{preview.createsInitialCommit ? <p>{text('将创建空初始提交。', 'An empty initial commit will be created.')}</p> : null}{preview.createsDevelop ? <p>{text('将创建开发分支。', 'The development branch will be created.')}</p> : null}{preview.fetchesBranch ? <p>{text('此工作分支已有远程跟踪记录，原生 Git Flow 完成时仍会抓取该远程分支进行核对。', 'This flow branch has a remote-tracking ref. Native Git Flow still fetches it during finish to check for remote changes.')}</p> : null}{preview.change.operation !== 'init' && (preview.change.fetch || preview.change.operation === 'finish' && preview.change.pushAfter || preview.fetchesBranch) ? <div><p>{text('远程', 'Remote')}：{preview.state.remote}</p>{preview.state.remoteUrls.map((url, index) => <p key={index}>{url}</p>)}</div> : null}<Button disabled={locked || loading} onClick={() => void perform()}>{text('确认执行', 'Confirm operation')}</Button></section> : null}
        {error ? <div role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}{feedback ? <p role="status">{feedback}</p> : null}
        </div>
      </div>
      <footer><Button variant="secondary" disabled={locked || loading} onClick={() => void load(true)}>{text('重新读取', 'Reload')}</Button>{saving ? <Button variant="secondary" onClick={() => void props.onAbort().catch(setError)}>{text('中止并核对结果', 'Cancel and review outcome')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}
