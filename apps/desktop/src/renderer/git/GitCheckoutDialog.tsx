import { useState } from 'react';
import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';

/** Local changes stay on the current branch as a named stash, as in SourceTree. */
export function GitCheckoutDialog(props: { repository: ProjectGitRepositoryWorkbenchItem; action: Extract<ProjectGitAction, { type: 'checkout' | 'create_branch' | 'checkout_revision' }>; zh: boolean; busy: boolean; onClose: () => void; onConfirm: (stash: boolean) => Promise<void> }) {
  const [stash, setStash] = useState(false);
  const { snapshot } = props.repository;
  const untracked = snapshot.fileStatuses.filter(file => file.indexStatus === '?').length;
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const title = props.action.type === 'create_branch' ? text('确认创建并切换分支', 'Confirm creating and switching branch') : props.action.type === 'checkout_revision' ? text('确认检出此版本', 'Confirm revision checkout') : text('确认分支切换', 'Confirm branch switch');
  const target = props.action.type === 'checkout_revision' ? props.action.revision : props.action.branchName;
  const confirm = props.action.type === 'create_branch' ? text('创建并切换', 'Create and switch') : props.action.type === 'checkout_revision' ? text('检出版本', 'Checkout revision') : text('切换分支', 'Switch branch');
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={title} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-checkout-dialog" data-modal-surface="dialog">
      <header><strong>{title}</strong><p>{props.repository.name} · {snapshot.branch} → {target}</p></header>
      {props.action.type === 'checkout_revision' ? <p>{text('将进入游离 HEAD 状态；如需保留此后创建的提交，请创建分支。', 'This enters detached HEAD. Create a branch to retain any commits you make afterward.')}</p> : null}
      <p>{snapshot.fileStatuses.length ? text(`当前有 ${snapshot.fileStatuses.length} 个变更文件${untracked ? `（含 ${untracked} 个未跟踪文件）` : ''}。普通切换将保留可兼容的修改；会覆盖文件时由 Git 阻止。`, `There are ${snapshot.fileStatuses.length} changed files${untracked ? ` (${untracked} untracked)` : ''}. A normal switch carries compatible changes; Git blocks changes that would overwrite files.`) : text('当前工作区干净。', 'The working tree is clean.')}</p>
      <label className="git-checkout-stash"><input type="checkbox" checked={stash} disabled={props.busy || !snapshot.fileStatuses.length} onChange={event => setStash(event.target.checked)} />{text('先贮藏本地修改（包含未跟踪文件）', 'Stash local changes first (including untracked files)')}</label>
      {stash ? <p>{text('将当前仓库的修改保存在贮藏中，再切换分支。贮藏会保留，可在目标分支手动核对后应用。子仓库内部的修改需在对应仓库单独处理。', 'Save this repository’s changes in a stash, then switch. The stash is retained for review and manual application. Changes inside subrepositories must be handled in those repositories.')}</p> : null}
      <footer><Button variant="secondary" disabled={props.busy} onClick={props.onClose} autoFocus>{text('取消', 'Cancel')}</Button><Button busy={props.busy} disabled={props.busy} onClick={() => void props.onConfirm(stash)}>{stash ? text('贮藏并继续', 'Stash and continue') : confirm}</Button></footer>
    </section>
  </ModalPortal>;
}
