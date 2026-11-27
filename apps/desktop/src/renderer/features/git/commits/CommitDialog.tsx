import type { ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';
import type { BusyState } from '../workbench/gitWorkbenchTypes.js';
import { repositoryDraftScope, type GitCommitDrafts } from './useGitCommitDrafts.js';
import { GitCommitTemplateControl } from './GitCommitTemplateControl.js';
import { stagedCommitUnits } from '../changes/sourceGitState.js';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { GitOperationDialog } from '../components/GitOperationDialog.js';

export function CommitDialog(props: {
  commitMessages: GitCommitDrafts;
  open: boolean;
  client: Pick<DashboardClient, 'loadProjectGitCommitTemplate'>;
  projectId: string;
  zh: boolean;
  repositories: ProjectGitRepositoryWorkbenchItem[];
  busy: BusyState;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const staged = stagedCommitUnits(props.repositories);
  if (!props.open) return null;
  return (
    <GitOperationDialog className="project-git-commit-dialog" onDismiss={props.onClose} dismissDisabled={props.busy !== null} role="dialog" aria-label={props.zh ? '提交已暂存变更' : 'Commit staged changes'}>
        <header>
          <strong>{props.zh ? '提交已暂存变更' : 'Commit staged changes'}</strong>
          <small>{props.zh ? '每个仓库会分别创建提交。' : 'Each repository will receive a separate commit.'}</small>
        </header>
        <main>
          {staged.map(({ repository, paths }) => {
            const draft = props.commitMessages.drafts[repository.id];
            const message = draft?.message ?? '';
            const scope = repositoryDraftScope(repository.snapshot);
            return <div key={repository.id}>
              <label>
                <strong>{repository.name}</strong> · {paths.length} {props.zh ? '个已暂存文件' : 'staged files'}
                <textarea value={message} disabled={props.busy !== null} onChange={event => props.commitMessages.write(repository.id, event.target.value, scope)} />
              </label>
              {draft?.scope && draft.scope !== scope && <small role="status">{props.zh ? '提交范围已变化，请核对提交说明。' : 'The commit scope changed. Review the message.'}</small>}
              <GitCommitTemplateControl client={props.client} projectId={props.projectId} repositoryId={repository.id} repositoryName={repository.name} value={message} zh={props.zh}
                disabled={props.busy !== null} active={props.open} autoFill={staged.length === 1}
                onApply={(next, expected) => props.commitMessages.write(repository.id, next, scope, expected)} />
            </div>;
          })}
        </main>
        <footer>
          <Button variant="secondary" onClick={props.onClose} disabled={props.busy !== null}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            busy={props.busy?.action === 'commit'}
            disabled={!staged.length || staged.some(({ repository }) => !props.commitMessages.drafts[repository.id]?.message.trim()) || props.busy !== null}
            onClick={async () => {
              for (const { repository } of staged) {
                const message = props.commitMessages.drafts[repository.id]!.message;
                const outcome = await props.onExecute(repository, { type: 'commit', message: message.trim() }, props.zh ? '提交已暂存变更' : 'Commit staged changes');
                if (outcome !== 'completed') return;
                props.commitMessages.clearCommitted(repository.id, message);
              }
              props.onClose();
            }}
          >
            {props.zh ? `提交 ${staged.length} 个仓库` : `Commit ${staged.length} repositories`}
          </Button>
        </footer>
      </GitOperationDialog>
  );
}
