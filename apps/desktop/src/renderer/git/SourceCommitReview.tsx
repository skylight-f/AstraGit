import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react/dist/csr/X';
import type { ProjectGitRepositorySnapshot } from '../apiClient.js';
import { RepositoryPushFields } from './RepositoryPushFields.js';
import { branchPushTarget, type PushDestinationDraft } from './pushTarget.js';
import type { SourceReviewRow } from './sourceGitBatch.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { Button } from '../ui/Button.js';

export interface SourceReviewDraft extends Omit<SourceReviewRow, 'remote' | 'targetBranch' | 'setUpstream'> {
  snapshot: ProjectGitRepositorySnapshot;
  pushDraft: PushDestinationDraft;
}

export function SourceCommitReview(props: {
  rows: SourceReviewDraft[];
  preferredRepositoryId?: string;
  push: boolean;
  zh: boolean;
  busy: boolean;
  error: string;
  onChange: (rows: SourceReviewDraft[], patch: Partial<Pick<SourceReviewDraft, 'message' | 'pushDraft'>>) => void;
  onClose: () => void;
  onConfirm: (rows: SourceReviewRow[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Keep the opening groups stable even if two drafts temporarily match while typing.
  const [messageGroups] = useState(() => {
    const groups = new Map<string, number[]>();
    props.rows.forEach((row, index) => {
      const group = groups.get(row.message);
      if (group) group.push(index);
      else groups.set(row.message, [index]);
    });
    return [...groups.values()];
  });
  const [selectedGroup, setSelectedGroup] = useState(() => {
    const selected = props.rows.findIndex(row => row.repositoryId === props.preferredRepositoryId && row.message.trim());
    const firstFilled = selected >= 0 ? selected : props.rows.findIndex(row => row.message.trim());
    return Math.max(0, messageGroups.findIndex(group => group.includes(firstFilled)));
  });
  const messageRows = messageGroups[selectedGroup].map(index => props.rows[index]);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const label = (cn: string, en: string) => props.zh ? cn : en;
  return <dialog ref={dialog} className="source-git-review" aria-labelledby="source-review-title" onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <header>
      <div>
        <h2 id="source-review-title">{label('确认本项目的提交', 'Review project commits')}</h2>
        <p>{label('每个仓库生成独立提交，按下列顺序执行。', 'Each repository gets a separate commit, in the order below.')}</p>
      </div>
      <Button size="compact" className="source-git-review-close" disabled={props.busy} onClick={props.onClose} aria-label={label('关闭预览', 'Close review')}>
        <X aria-hidden="true" />
      </Button>
    </header>
    <div className="source-git-review-list">
      <section className="source-git-review-message">
        {messageGroups.length > 1 && <label>{label('适用仓库', 'Repositories')}
          <select value={selectedGroup} disabled={props.busy} onChange={event => setSelectedGroup(Number(event.target.value))}>
            {messageGroups.map((group, index) => <option key={index} value={index}>
              {group.map(i => props.rows[i].repositoryName).join(props.zh ? '、' : ', ')}
              {props.rows[group[0]].message.trim() ? '' : label('（待填写）', ' (message required)')}
            </option>)}
          </select>
        </label>}
        <label>{messageRows.length > 1 ? label('共用提交说明', 'Shared commit message') : label('提交说明', 'Commit message')}
          <textarea rows={4} value={messageRows[0].message} disabled={props.busy}
            onChange={event => props.onChange(messageRows, { message: event.target.value })} />
        </label>
      </section>
      {props.rows.map((row, index) => <section key={row.repositoryId}>
        <h3>{index + 1}. {row.repositoryName}<small>{row.branch} · {row.relativePath}</small></h3>
        <p>{row.mode === 'staged' ? label('所选文件的已暂存内容', 'Selected staged content') : label('所选文件的全部工作区内容', 'Full working tree content of selected files')} · {row.paths.length} {label('个文件', 'files')}</p>
        <ul>{row.paths.map(path => <li key={path}>{path}{row.gitlinks.some(link => link.path === path) ? label('（子模块提交后的新引用）', ' (new submodule commit)') : ''}</li>)}</ul>
        {props.push && <div className="project-git-sync-dialog source-git-review-push">
          <RepositoryPushFields snapshot={row.snapshot} draft={row.pushDraft} selectedBranches={[row.branch]}
            zh={props.zh} disabled={props.busy || row.snapshot.detached}
            onChange={pushDraft => props.onChange([row], { pushDraft })} />
          {row.snapshot.detached && <p role="alert">{label('游离 HEAD 无法直接推送，请先创建分支。', 'Create a branch before pushing a detached HEAD.')}</p>}
        </div>}
      </section>)}
    </div>
    {props.error ? <p className="source-git-error" role="alert"><VisibleApplicationError error={props.error} language={props.zh ? 'zh-CN' : 'en'} /></p> : null}
    <footer>
      <Button size="compact" disabled={props.busy} onClick={props.onClose}>{label('返回修改', 'Back')}</Button>
      <Button
        size="compact"
        variant="primary"
        busy={props.busy}
        disabled={props.rows.some(row => !row.message.trim() || (props.push && (row.snapshot.detached || !row.pushDraft.remote || !branchPushTarget(row.pushDraft, row.branch).targetBranch.trim())))}
        onClick={() => props.onConfirm(props.rows.map(({ snapshot: _snapshot, pushDraft, ...row }) => {
          const { remote, targetBranch, setUpstream } = branchPushTarget(pushDraft, row.branch);
          return { ...row, remote, targetBranch: targetBranch.trim(), setUpstream };
        }))}
      >
        {props.busy ? label('正在核对…', 'Checking…') : props.push ? label('确认提交并推送', 'Commit and push') : label('确认提交', 'Commit')}
      </Button>
    </footer>
  </dialog>;
}
