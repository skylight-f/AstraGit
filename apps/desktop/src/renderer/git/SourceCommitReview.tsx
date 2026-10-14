import { useEffect, useRef } from 'react';
import type { SourceReviewRow } from './sourceGitBatch.js';

export function SourceCommitReview(props: { rows: SourceReviewRow[]; push: boolean; zh: boolean; busy: boolean; error: string; onChange: (rows: SourceReviewRow[]) => void; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const label = (cn: string, en: string) => props.zh ? cn : en;
  const change = (id: string, patch: Partial<SourceReviewRow>) => props.onChange(props.rows.map(row => row.repositoryId === id ? { ...row, ...patch } : row));
  return <dialog ref={dialog} className="source-git-review" aria-labelledby="source-review-title" onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <header><div><h2 id="source-review-title">{label('确认本项目的提交', 'Review project commits')}</h2><p>{label('每个仓库生成独立提交，按下列顺序执行。', 'Each repository gets a separate commit, in the order below.')}</p></div><button type="button" disabled={props.busy} onClick={props.onClose} aria-label={label('关闭预览', 'Close review')}>×</button></header>
    <div className="source-git-review-list">{props.rows.map((row, index) => <section key={row.repositoryId}>
      <h3>{index + 1}. {row.repositoryName}<small>{row.branch} · {row.relativePath}</small></h3>
      <p>{row.mode === 'staged' ? label('所选文件的已暂存内容', 'Selected staged content') : label('所选文件的全部工作区内容', 'Full working tree content of selected files')} · {row.paths.length} {label('个文件', 'files')}</p>
      <ul>{row.paths.map(path => <li key={path}>{path}{row.gitlinks.some(link => link.path === path) ? label('（子模块提交后的新引用）', ' (new submodule commit)') : ''}</li>)}</ul>
      <label>{label('提交说明', 'Commit message')}<textarea value={row.message} disabled={props.busy} onChange={event => change(row.repositoryId, { message: event.target.value })} /></label>
      {props.push ? <div className="source-git-push-target"><label>{label('远程仓库', 'Remote')}<select disabled={props.busy || row.detached} value={row.remote} onChange={event => change(row.repositoryId, { remote: event.target.value })}><option value="">{label('选择远程…', 'Select remote…')}</option>{row.remotes.map(remote => <option key={remote}>{remote}</option>)}</select></label><label>{label('目标分支', 'Target branch')}<input disabled={props.busy || row.detached} value={row.targetBranch} onChange={event => change(row.repositoryId, { targetBranch: event.target.value })} /></label>{row.detached ? <p role="alert">{label('游离 HEAD 无法直接推送，请先创建分支。', 'Create a branch before pushing a detached HEAD.')}</p> : null}</div> : null}
    </section>)}</div>
    {props.error ? <p className="source-git-error" role="alert">{props.error}</p> : null}
    <footer><button type="button" disabled={props.busy} onClick={props.onClose}>{label('返回修改', 'Back')}</button><button type="button" className="source-git-primary" disabled={props.busy || props.rows.some(row => !row.message.trim() || (props.push && (!row.remote || !row.targetBranch || row.detached)))} onClick={props.onConfirm}>{props.busy ? label('正在核对…', 'Checking…') : props.push ? label('确认提交并推送', 'Commit and push') : label('确认提交', 'Commit')}</button></footer>
  </dialog>;
}
