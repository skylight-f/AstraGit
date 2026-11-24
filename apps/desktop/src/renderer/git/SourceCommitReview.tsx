import { useEffect, useRef } from 'react';
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

export function SourceCommitReview(props: { rows: SourceReviewDraft[]; push: boolean; zh: boolean; busy: boolean; error: string; onChange: (rows: SourceReviewDraft[]) => void; onClose: () => void; onConfirm: (rows: SourceReviewRow[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const label = (cn: string, en: string) => props.zh ? cn : en;
  const change = (id: string, patch: Partial<SourceReviewDraft>) => props.onChange(props.rows.map(row => row.repositoryId === id ? { ...row, ...patch } : row));
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
    <div className="source-git-review-list">{props.rows.map((row, index) => <section key={row.repositoryId}>
      <h3>{index + 1}. {row.repositoryName}<small>{row.branch} · {row.relativePath}</small></h3>
      <p>{row.mode === 'staged' ? label('所选文件的已暂存内容', 'Selected staged content') : label('所选文件的全部工作区内容', 'Full working tree content of selected files')} · {row.paths.length} {label('个文件', 'files')}</p>
      <ul>{row.paths.map(path => <li key={path}>{path}{row.gitlinks.some(link => link.path === path) ? label('（子模块提交后的新引用）', ' (new submodule commit)') : ''}</li>)}</ul>
      <label>{label('提交说明', 'Commit message')}<textarea value={row.message} disabled={props.busy} onChange={event => change(row.repositoryId, { message: event.target.value })} /></label>
      {props.push && <div className="project-git-sync-dialog source-git-review-push">
        <RepositoryPushFields snapshot={row.snapshot} draft={row.pushDraft} selectedBranches={[row.branch]}
          zh={props.zh} disabled={props.busy || row.snapshot.detached}
          onChange={pushDraft => change(row.repositoryId, { pushDraft })} />
        {row.snapshot.detached && <p role="alert">{label('游离 HEAD 无法直接推送，请先创建分支。', 'Create a branch before pushing a detached HEAD.')}</p>}
      </div>}
    </section>)}</div>
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
