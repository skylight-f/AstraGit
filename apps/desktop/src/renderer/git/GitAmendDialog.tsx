import { useEffect, useState } from 'react';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

/** Amend is always a single-repository action, independent of batch commit drafts. */
export function GitAmendDialog(props: {
  client: Pick<DashboardClient, 'loadProjectGitCommit'>;
  projectId: string;
  repository: ProjectGitRepositoryWorkbenchItem;
  zh: boolean;
  busy: boolean;
  rebaseStep?: boolean;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  // Freeze the reviewed branch/index. Polling must not silently change the target.
  const [repository] = useState(props.repository);
  const [rebaseStep] = useState(props.rebaseStep ? props.repository.snapshot.rebaseEdit : null);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const title = rebaseStep ? text('修订当前变基步骤', 'Amend current rebase step') : text('修订上次提交', 'Amend last commit');
  const staged = repository.snapshot.fileStatuses.filter(file => file.indexStatus !== ' ' && file.indexStatus !== '?');
  useEffect(() => {
    let live = true;
    void props.client.loadProjectGitCommit(props.projectId, repository.id, repository.snapshot.headSha).then(detail => {
      if (!live) return;
      setMessage(detail.fullMessage ?? detail.body); setLoaded(true);
    }).catch(reason => { if (live) setError(reason); });
    return () => { live = false; };
  }, [props.client, props.projectId, repository, rebaseStep]);
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={title} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-amend-dialog" data-modal-surface="dialog">
      <header><strong>{title}</strong><p>{repository.name} · {repository.snapshot.branch} · {repository.snapshot.headSha.slice(0, 12)}</p></header>
      {rebaseStep ? <p>{text('当前暂停在 edit 步骤。修订仅包含暂存内容；完成后仍需点击“继续”重放剩余计划。', 'This rebase is paused at an edit step. Only staged contents are included. Continue the rebase afterwards to replay the remaining plan.')}</p> : null}
      <p>{staged.length ? text(`将 ${staged.length} 个已暂存文件合入上次提交，未暂存内容保留。`, `Include ${staged.length} staged files in the last commit. Unstaged contents are kept.`) : text('没有暂存更改，仅修订提交说明。', 'No staged changes. Only the commit message will be amended.')}</p>
      {staged.length ? <ul className="git-amend-files">{staged.slice(0, 200).map(file => <li key={file.path}>{file.path}</li>)}{staged.length > 200 ? <li>{text(`还有 ${staged.length - 200} 个文件`, `${staged.length - 200} more files`)}</li> : null}</ul> : null}
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      <label>{text('提交说明', 'Commit message')}<textarea aria-label={text('修订提交说明', 'Amended commit message')} value={message} disabled={!loaded || props.busy} onChange={event => setMessage(event.target.value)} rows={7} /></label>
      <label className="git-checkout-stash"><input type="checkbox" checked={confirmed} disabled={props.busy} onChange={event => setConfirmed(event.target.checked)} />{rebaseStep ? text('确认修订当前暂停的提交，随后由我继续变基。', 'Amend the paused commit. I will continue the rebase afterwards.') : text('我确认替换上次提交；若已推送，其他使用者需要协调历史变更。', 'I confirm replacing the last commit. If it was pushed, coordinate the rewritten history with other users.')}</label>
      <footer><Button variant="secondary" autoFocus disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button disabled={props.busy || !loaded || (!rebaseStep && !message.trim()) || !confirmed || !repository.snapshot.indexFingerprint} busy={props.busy} onClick={async () => {
        const identity = { expectedHeadSha: repository.snapshot.headSha, expectedIndexFingerprint: repository.snapshot.indexFingerprint! };
        const action: ProjectGitAction = rebaseStep ? { type: 'amend_rebase_step', message, ...identity, expectedStepFingerprint: rebaseStep.fingerprint } : { type: 'amend_commit', message, ...identity, expectedBranch: repository.snapshot.branch };
        const outcome = await props.onExecute(repository, action, title);
        if (outcome === 'completed') props.onClose();
      }}>{text('修订提交', 'Amend commit')}</Button></footer>
    </section>
  </ModalPortal>;
}
