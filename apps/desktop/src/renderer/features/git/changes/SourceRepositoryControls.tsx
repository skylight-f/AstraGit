import { useState } from 'react';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import type { BusyState, ExecutionOutcome, OperationTone } from '../workbench/gitWorkbenchTypes.js';
import { BranchSwitcher, CheckoutRevisionDialog, NewBranchDialog, PushDialog, UpdateProjectDialog } from '../repository/GitRepositoryControls.js';
import { ProjectGitDiffWindow } from '../diff/ProjectGitDiffViewer.js';
import { ModalPortal } from '../../../ui/ModalPortal.js';
import { reportApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import { MotionPresence } from '../../../ui/MotionPresence.js';

/** 与 Zeus 源码工具窗口共用仓库级联菜单及操作对话框，宿主使用 AstraGit API。 */
export function SourceRepositoryControls(props: {
  projectId: string; client: DashboardClient; zh: boolean;
  repositories: ProjectGitRepositoryWorkbenchItem[]; repository: ProjectGitRepositoryWorkbenchItem | null;
  busy: BusyState; locked: boolean;
  errorsByRepository?: Record<string, string>;
  onSelectRepository(id: string): void; onCommit(): void;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<ExecutionOutcome>;
}) {
  const { zh, repository, repositories } = props;
  const [dialog, setDialog] = useState<'branch' | 'revision' | 'update' | 'push' | null>(null);
  const [baseRef, setBaseRef] = useState('');
  const [results, setResults] = useState<Array<{ repositoryId: string; repositoryName: string; tone: OperationTone; message: string }>>([]);
  const [preview, setPreview] = useState<{ repositoryId: string; filePath: string; comparisonRef?: string; comparisonMode?: 'current' | 'working-tree' } | null>(null);
  const busy = props.busy ?? (props.locked && repository ? { repositoryId: repository.id, action: 'commit' as const } : null);
  const execute: typeof props.onExecute = async (target, action, label) => {
    return props.onExecute(target, action, label);
  };
  if (!repository) return null;
  return <>
    <div className="source-git-repository-actions">
      <BranchSwitcher cascadeRepositories zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} onSelectRepository={props.onSelectRepository} onExecute={execute}
        onOpenDiff={(target, filePath, options) => setPreview({ repositoryId: target.id, filePath, ...options })}
        onOpenUpdate={() => setDialog('update')} onOpenCommit={props.onCommit}
        onOpenPush={() => { setResults([]); setDialog('push'); }}
        onOpenNewBranch={ref => { setBaseRef(ref ?? ''); setDialog('branch'); }} onOpenRevision={() => setDialog('revision')} />
    </div>
    <MotionPresence>
      {dialog === 'branch' ? <NewBranchDialog open zh={zh} repositories={repositories} selectedRepository={repository} baseRef={baseRef} busy={busy} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'revision' ? <CheckoutRevisionDialog open zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'update' ? <UpdateProjectDialog open projectId={props.projectId} zh={zh} repositories={repositories} busy={busy} errorsByRepository={props.errorsByRepository ?? {}} onClose={() => setDialog(null)} onExecute={execute} /> : null}
      {dialog === 'push' ? <PushDialog open zh={zh} repositories={repositories} selectedRepository={repository} busy={busy} onStop={id => {
        void props.client.cancelProjectGitAction(props.projectId, id).catch(error => reportApplicationError(error, { language: zh ? 'zh-CN' : 'en' }));
      }} results={results} onClose={() => setDialog(null)} onPush={async (selections, forceWithLease, pushTags) => {
        const next: typeof results = [];
        for (const selection of selections) {
          const target = repositories.find(item => item.id === selection.repositoryId);
          if (!target) continue;
          const outcome = await execute(target, { type: 'push', remote: selection.remote, sourceBranch: selection.sourceBranch, targetBranch: selection.targetBranch, setUpstream: selection.setUpstream, forceWithLease, pushAllTags: pushTags }, zh ? '推送' : 'Push');
          next.push({ repositoryId: target.id, repositoryName: target.name, tone: outcome === 'completed' ? 'success' : 'error', message: outcome === 'completed' ? (zh ? '推送完成' : 'Push completed') : (props.errorsByRepository?.[target.id] ?? (zh ? '推送未完成，请查看错误详情。' : 'Push incomplete. See error details.')) });
          setResults([...next]);
          if (outcome !== 'completed') break;
        }
      }} /> : null}
    </MotionPresence>
    {preview ? <ModalPortal role="dialog" aria-label={zh ? '分支差异' : 'Branch diff'} rootClassName="gitapp-diff-root" onDismiss={() => setPreview(null)}><div className="gitapp-diff-dialog" data-modal-surface="dialog"><header><strong>{preview.comparisonRef}</strong><button type="button" onClick={() => setPreview(null)}>{zh ? '关闭' : 'Close'}</button></header><ProjectGitDiffWindow client={props.client} projectId={props.projectId} {...preview} stage="combined" language={zh ? 'zh-CN' : 'en-US'} appearance="light" /></div></ModalPortal> : null}
  </>;
}
