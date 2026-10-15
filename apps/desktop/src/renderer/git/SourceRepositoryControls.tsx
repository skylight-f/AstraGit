import { useState } from 'react';
import { Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowUp } from '@phosphor-icons/react/dist/csr/ArrowUp';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import type { BusyState, ExecutionOutcome, OperationTone } from './gitWorkbenchTypes.js';
import { BranchSwitcher, CheckoutRevisionDialog, NewBranchDialog, PushDialog, StashDialog, UpdateProjectDialog } from './GitRepositoryControls.js';
import { ProjectGitDiffWindow } from './ProjectGitDiffViewer.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { MotionPresence } from '../ui/MotionPresence.js';

/** 与 Zeus 源码工具窗口共用仓库级联菜单及操作对话框，宿主使用 AstraGit API。 */
export function SourceRepositoryControls(props: {
  projectId: string; client: DashboardClient; zh: boolean;
  repositories: ProjectGitRepositoryWorkbenchItem[]; repository: ProjectGitRepositoryWorkbenchItem | null;
  busy: BusyState; locked: boolean;
  onSelectRepository(id: string): void; onCommit(): void;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<ExecutionOutcome>;
}) {
  const { zh, repository, repositories } = props;
  const [dialog, setDialog] = useState<'branch' | 'revision' | 'update' | 'push' | 'stash' | null>(null);
  const [baseRef, setBaseRef] = useState('');
  const [results, setResults] = useState<Array<{ repositoryId: string; repositoryName: string; tone: OperationTone; message: string }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ repositoryId: string; filePath: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree' } | null>(null);
  const busy = props.busy ?? (props.locked && repository ? { repositoryId: repository.id, action: 'commit' as const } : null);
  const execute: typeof props.onExecute = async (target, action, label) => {
    const outcome = await props.onExecute(target, action, label);
    setErrors(current => ({ ...current, [target.id]: outcome === 'completed' ? '' : zh ? '操作未完成，请查看项目提交中的错误详情。' : 'Operation incomplete. See the error in Project commits.' }));
    return outcome;
  };
  if (!repository) return null;
  return <>
    <div className="source-git-repository-actions">
      <BranchSwitcher cascadeRepositories zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} onSelectRepository={props.onSelectRepository} onExecute={execute}
        onOpenDiff={(target, filePath, options) => setPreview({ repositoryId: target.id, filePath, ...options })}
        onOpenUpdate={() => setDialog('update')} onOpenCommit={props.onCommit}
        onOpenPush={() => { setResults([]); setDialog('push'); }}
        onOpenNewBranch={ref => { setBaseRef(ref ?? ''); setDialog('branch'); }} onOpenRevision={() => setDialog('revision')} />
      <button type="button" className="source-git-icon" disabled={props.locked || repository.snapshot.clean || !!repository.snapshot.conflictFiles.length} aria-label={zh ? '贮藏当前仓库更改' : 'Stash repository changes'} title={zh ? '贮藏当前仓库更改' : 'Stash repository changes'} onClick={() => setDialog('stash')}><Archive /></button>
      <button type="button" className="source-git-icon" disabled={props.locked || !repository.snapshot.remotes.length} aria-label={zh ? '推送…' : 'Push…'} title={zh ? '推送…' : 'Push…'} onClick={() => { setResults([]); setDialog('push'); }}><ArrowUp /></button>
    </div>
    <MotionPresence>
      {dialog === 'branch' ? <NewBranchDialog open zh={zh} repositories={repositories} selectedRepository={repository} baseRef={baseRef} busy={busy} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'revision' ? <CheckoutRevisionDialog open zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'update' ? <UpdateProjectDialog open projectId={props.projectId} zh={zh} repositories={repositories} busy={busy} errorsByRepository={errors} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'stash' ? <StashDialog repository={repository} zh={zh} busy={busy} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'push' ? <PushDialog open zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} results={results} onClose={() => setDialog(null)} onPush={async (selections, forceWithLease, pushTags) => {
        const next: typeof results = [];
        for (const selection of selections) {
          const target = repositories.find(item => item.id === selection.repositoryId);
          if (!target) continue;
          const outcome = await execute(target, { type: 'push', remote: selection.remote, sourceBranch: selection.sourceBranch, targetBranch: selection.targetBranch, setUpstream: selection.setUpstream, forceWithLease, pushAllTags: pushTags }, zh ? '推送' : 'Push');
          next.push({ repositoryId: target.id, repositoryName: target.name, tone: outcome === 'completed' ? 'success' : 'error', message: outcome === 'completed' ? (zh ? '推送完成' : 'Push completed') : (zh ? '推送未完成，请查看错误详情。' : 'Push incomplete. See error details.') });
          setResults([...next]);
          if (outcome !== 'completed') break;
        }
      }} /> : null}
    </MotionPresence>
    {preview ? <ModalPortal role="dialog" aria-label={zh ? '分支差异' : 'Branch diff'} rootClassName="gitapp-diff-root" onDismiss={() => setPreview(null)}><div className="gitapp-diff-dialog" data-modal-surface="dialog"><header><strong>{preview.comparisonRef}</strong><button type="button" onClick={() => setPreview(null)}>{zh ? '关闭' : 'Close'}</button></header><ProjectGitDiffWindow client={props.client} projectId={props.projectId} {...preview} stage="combined" language={zh ? 'zh-CN' : 'en-US'} appearance="light" /></div></ModalPortal> : null}
  </>;
}
