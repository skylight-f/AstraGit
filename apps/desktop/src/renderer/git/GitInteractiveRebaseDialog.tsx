import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardClient, GitInteractiveRebasePreview, GitRebasePlanAction, GitRebasePlanStep, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitInteractiveRebase.css';

export interface GitInteractiveRebaseRequest { repository: ProjectGitRepositoryWorkbenchItem; baseRef?: string }
const actions: Array<[GitRebasePlanAction, string, string]> = [
  ['pick', '保留', 'Pick'], ['reword', '改说明', 'Reword'], ['edit', '暂停编辑', 'Edit'],
  ['squash', '合并到前项并编辑说明', 'Squash into previous'], ['fixup', '合并到前项并丢弃此说明', 'Fixup into previous'], ['drop', '删除提交', 'Drop'],
];

/** Presentation groups mirror native squash/fixup semantics. The service validates the plan again. */
export function rebaseMessageGroups(preview: GitInteractiveRebasePreview | null, steps: GitRebasePlanStep[]) {
  const messages = new Map(preview?.commits.map(commit => [commit.sha, commit.message]));
  const groups: Array<{ anchor: string; members: string[]; message: string; squash: boolean }> = [];
  let invalidFirst = false;
  for (const step of steps) {
    if (step.action === 'drop') continue;
    if (step.action === 'squash' || step.action === 'fixup') {
      const group = groups.at(-1);
      if (!group) { invalidFirst = true; continue; }
      group.members.push(step.sha);
      if (step.action === 'squash') { group.squash = true; group.message += '\n\n' + (messages.get(step.sha) ?? '').trimEnd(); }
    } else groups.push({ anchor: step.sha, members: [step.sha], message: (step.action === 'reword' ? step.message ?? '' : messages.get(step.sha) ?? '').trimEnd(), squash: false });
  }
  return { groups: groups.filter(group => group.squash), invalidFirst };
}

export function GitInteractiveRebaseDialog(props: {
  request: GitInteractiveRebaseRequest;
  projectId: string;
  client: Pick<DashboardClient, 'loadProjectGitInteractiveRebasePreview'>;
  zh: boolean; busy: boolean; onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [repository] = useState(props.request.repository);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [baseRef, setBaseRef] = useState(props.request.baseRef ?? repository.snapshot.upstream ?? 'HEAD~1');
  const [ontoRef, setOntoRef] = useState('');
  const [preview, setPreview] = useState<GitInteractiveRebasePreview | null>(null);
  const [steps, setSteps] = useState<GitRebasePlanStep[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  const dragging = useRef<string | null>(null);
  const grouped = useMemo(() => rebaseMessageGroups(preview, steps), [preview, steps]);
  const commits = useMemo(() => new Map(preview?.commits.map(commit => [commit.sha, commit])), [preview]);
  const locked = props.busy || loading;
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort(); }; }, []);

  async function load() {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(null); setPreview(null); setSteps([]); setMessages({}); setConfirmed(false); setFlatten(false); setOverwrite(false); setReviewRequired(false);
    try {
      const value = await props.client.loadProjectGitInteractiveRebasePreview(props.projectId, repository.id, baseRef.trim(), ontoRef.trim() || undefined, request.signal);
      if (!live.current || request.signal.aborted) return;
      setPreview(value); setSteps(value.commits.map(commit => ({ sha: commit.sha, action: 'pick' })));
    } catch (reason) { if (live.current && !request.signal.aborted) setError(reason); }
    finally { if (live.current && controller.current === request) setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function invalidate() { setPreview(null); setConfirmed(false); setReviewRequired(false); }
  function move(sha: string, targetIndex: number) {
    setSteps(current => {
      const index = current.findIndex(step => step.sha === sha);
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length || index === targetIndex) return current;
      const next = [...current]; const [step] = next.splice(index, 1); next.splice(targetIndex, 0, step!); return next;
    }); setConfirmed(false);
  }
  const obstacles = Boolean(preview && (preview.untrackedObstacleCount || preview.nestedRepositories.some(item => item.effect === 'directory')));
  const canStart = !locked && !reviewRequired && preview && preview.commits.length > 0 && !preview.changedFileCount && !grouped.invalidFirst && confirmed && (!preview.mergeCount || flatten) && (!obstacles || overwrite);
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={text('交互变基', 'Interactive rebase')} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-interactive-rebase" data-modal-surface="dialog">
      <header><strong>{text('交互变基', 'Interactive rebase')}</strong><p>{repository.name} · {preview?.branch ?? repository.snapshot.branch}</p></header>
      <div className="git-rebase-scroll" aria-busy={loading}>
        <p>{text('整理来源基点之后、当前 HEAD 之前的提交。拖拽或用上下按钮排序；最上方最先重放。', 'Organize commits after the source base through the current HEAD. Drag or use the arrow buttons to reorder; the top commit replays first.')}</p>
        <div className="git-rebase-bases">
          <label>{text('来源基点（不包含此提交）', 'Source base (excluded)')}<input aria-label={text('来源基点', 'Source base')} value={baseRef} disabled={locked} onChange={event => { setBaseRef(event.target.value); invalidate(); }} /></label>
          <label>{text('新基点（留空为原基点）', 'New base (blank keeps source base)')}<input aria-label={text('新基点', 'New base')} value={ontoRef} disabled={locked} onChange={event => { setOntoRef(event.target.value); invalidate(); }} /></label>
          <Button variant="secondary" disabled={locked || !baseRef.trim()} busy={loading} onClick={() => void load()}>{text('载入计划', 'Load plan')}</Button>
        </div>
        {error ? <div role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
        {reviewRequired ? <p role="status">{text('上次执行未确认完成。请查看仓库状态；如需重新开始，先重新载入并核对计划。', 'The last execution was not confirmed complete. Review the repository state. Reload and review the plan before starting again.')}</p> : null}
        {preview ? <>
          <p className="git-rebase-identity"><code>{preview.headSha.slice(0, 12)}</code> → <code>{preview.ontoSha.slice(0, 12)}</code> {preview.ontoSubject} · {preview.commits.length} {text('个提交', 'commits')}</p>
          {preview.changedFileCount ? <div role="alert" className="git-rebase-warning"><strong>{text(`还有 ${preview.changedFileCount} 个未提交的跟踪修改，请先提交或贮藏。`, `${preview.changedFileCount} tracked files have uncommitted changes. Commit or stash them first.`)}</strong><ul>{preview.changedFiles.map(path => <li key={path}>{path}</li>)}</ul>{preview.changedFileCount > preview.changedFiles.length ? <small>{text('此处仅显示前 200 项。', 'Only the first 200 paths are shown.')}</small> : null}</div> : null}
          {preview.publishedCount ? <p className="git-rebase-warning">{text(`其中 ${preview.publishedCount} 个提交可从本地远程跟踪引用到达，可能已发布；请先协调历史改写。`, `${preview.publishedCount} commits are reachable from local remote-tracking refs and may already be published. Coordinate the history rewrite first.`)}</p> : null}
          {!steps.length ? <p>{text('此基点后没有可整理的提交，请选择更早的基点。', 'No commits follow this base. Choose an earlier base.')}</p> : null}
          {steps.length ? <p>{text(`保留 ${steps.filter(step => step.action !== 'drop').length} 项，删除 ${steps.filter(step => step.action === 'drop').length} 项；squash/fixup 会进一步合并保留项。`, `Retain ${steps.filter(step => step.action !== 'drop').length} entries and drop ${steps.filter(step => step.action === 'drop').length}. Squash/fixup further combine retained entries.`)}</p> : null}
          <ol className="git-rebase-steps" aria-label={text('提交重放顺序', 'Commit replay order')}>
            {steps.map((step, index) => {
              const commit = commits.get(step.sha)!;
              return <li key={step.sha} className={step.action === 'drop' ? 'is-dropped' : ''} onDragOver={event => { if (!locked && !reviewRequired && dragging.current) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!locked && !reviewRequired && dragging.current) move(dragging.current, index); dragging.current = null; }}>
                <div className="git-rebase-step-line">
                  <span draggable={!locked && !reviewRequired} className="git-rebase-drag" role="img" aria-label={text('拖拽调整顺序', 'Drag to reorder')} onDragStart={event => { dragging.current = step.sha; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', step.sha); }} onDragEnd={() => { dragging.current = null; }}>⠿</span>
                  <span className="git-rebase-order">{index + 1}</span><code>{step.sha.slice(0, 8)}</code>
                  <select aria-label={text(`提交 ${index + 1} 的操作`, `Action for commit ${index + 1}`)} value={step.action} disabled={locked || reviewRequired} onChange={event => { const action = event.target.value as GitRebasePlanAction; setSteps(current => current.map(value => value.sha === step.sha ? { sha: value.sha, action, ...(action === 'reword' ? { message: step.message ?? commit.message } : {}) } : value)); setConfirmed(false); }}>
                    {actions.map(([value, cn, en]) => <option key={value} value={value}>{text(cn, en)}</option>)}
                  </select>
                  <button type="button" disabled={locked || reviewRequired || index === 0} aria-label={text(`上移提交 ${index + 1}`, `Move commit ${index + 1} up`)} onClick={() => move(step.sha, index - 1)}>↑</button>
                  <button type="button" disabled={locked || reviewRequired || index === steps.length - 1} aria-label={text(`下移提交 ${index + 1}`, `Move commit ${index + 1} down`)} onClick={() => move(step.sha, index + 1)}>↓</button>
                </div>
                <details><summary>{commit.subject || text('（空说明）', '(empty message)')} <small>{commit.author}</small></summary><pre>{commit.message}</pre></details>
                {step.action === 'reword' ? <label>{text('完整新说明', 'Full replacement message')}<textarea value={step.message ?? ''} rows={4} disabled={locked || reviewRequired} onChange={event => { const message = event.target.value; setSteps(current => current.map(value => value.sha === step.sha ? { ...value, message } : value)); setConfirmed(false); }} /></label> : null}
                {step.action === 'edit' ? <small>{text('重放至此处暂停；可暂存文件并修订当前步骤，随后继续。', 'Pause here. Stage changes and amend the current step, then continue.')}{grouped.groups.some(group => group.anchor === step.sha) ? text('后续合并会采用下方已确认的合并组说明。', 'The later squash uses the reviewed combined message below.') : ''}</small> : null}
              </li>;
            })}
          </ol>
          {grouped.invalidFirst ? <p role="alert" className="git-rebase-warning">{text('第一个保留项不能向前合并，请改为保留、改说明或暂停编辑。', 'The first retained commit cannot be combined into a previous commit. Choose Pick, Reword or Edit.')}</p> : null}
          {grouped.groups.map(group => <label key={group.anchor} className="git-rebase-group-message">{text(`合并组说明 · ${group.anchor.slice(0, 8)} · ${group.members.length} 个提交`, `Combined message · ${group.anchor.slice(0, 8)} · ${group.members.length} commits`)}<textarea rows={5} value={messages[group.anchor] ?? group.message} disabled={locked || reviewRequired} onChange={event => { setMessages(current => ({ ...current, [group.anchor]: event.target.value })); setConfirmed(false); }} /></label>)}
          {preview.mergeCount ? <label className="git-rebase-warning git-rebase-check"><input type="checkbox" checked={flatten} disabled={locked || reviewRequired} onChange={event => setFlatten(event.target.checked)} />{text(`确认线性重放：移除 ${preview.mergeCount} 个合并节点；仅在合并提交中产生的改动也可能丢失。`, `Confirm linear replay: remove ${preview.mergeCount} merge nodes. Changes created only in merge commits may also be lost.`)}</label> : null}
          {obstacles ? <div className="git-rebase-warning"><strong>{text(`重放路径涉及 ${preview.untrackedObstacleCount} 个未跟踪或忽略障碍、${preview.nestedRepositoryCount} 个嵌套仓库。`, `Replay paths involve ${preview.untrackedObstacleCount} untracked or ignored obstacles and ${preview.nestedRepositoryCount} nested repositories.`)}</strong><ul>{preview.untrackedObstacles.map(path => <li key={path}>{path}</li>)}{preview.nestedRepositories.map(item => <li key={item.path}>{item.path} · {item.effect}</li>)}</ul><label className="git-rebase-check"><input type="checkbox" checked={overwrite} disabled={locked || reviewRequired} onChange={event => setOverwrite(event.target.checked)} />{text('我已备份所需内容，确认所列路径可能被覆盖或移除。Git 的额外保护仍可能拒绝操作。', 'I backed up needed contents and confirm these paths may be overwritten or removed. Additional Git checks may still refuse the operation.')}</label></div> : null}
          <label className="git-rebase-check"><input type="checkbox" checked={confirmed} disabled={locked || reviewRequired} onChange={event => setConfirmed(event.target.checked)} />{text('确认按上述计划重写当前历史；删除项的变更会被舍弃，不自动推送。', 'Rewrite this history using the reviewed plan. Dropped changes are discarded. Nothing is pushed automatically.')}</label>
        </> : null}
      </div>
      <footer><Button variant="secondary" disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button disabled={!canStart} busy={props.busy} onClick={async () => {
        if (!preview || !canStart) return;
        const outcome = await props.onExecute(repository, { type: 'interactive_rebase', baseSha: preview.baseSha, ontoSha: preview.ontoSha, expectedFingerprint: preview.fingerprint, steps, groupMessages: Object.fromEntries(grouped.groups.filter(group => messages[group.anchor] !== undefined).map(group => [group.anchor, messages[group.anchor]!])), allowFlattenMerges: flatten, allowOverwriteObstacles: overwrite }, text('交互变基', 'Interactive rebase'));
        if (!live.current) return;
        if (outcome === 'completed' || outcome === 'conflict') props.onClose(); else { setReviewRequired(true); setConfirmed(false); }
      }}>{text('开始交互变基', 'Start interactive rebase')}</Button></footer>
    </section>
  </ModalPortal>;
}
