import { Select, TextInput } from '../../../ui/FormControls.js';
import type { ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';
import type { BusyState } from '../workbench/gitWorkbenchTypes.js';
import { useState } from 'react';
import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { GitOperationDialog } from '../components/GitOperationDialog.js';

export function SubtreeManagementDialog(props: {
  repository: ProjectGitRepositoryWorkbenchItem;
  zh: boolean;
  busy: BusyState;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [operation, setOperation] = useState<'add' | 'pull' | 'push'>('add');
  const [path, setPath] = useState('');
  const [remote, setRemote] = useState(props.repository.snapshot.remotes[0] ?? '');
  const [branch, setBranch] = useState('');
  return (
    <GitOperationDialog className="project-git-subtree-dialog" onDismiss={props.onClose} dismissDisabled={props.busy !== null} role="dialog" aria-label={props.zh ? '管理子树' : 'Manage subtree'}>
        <h2>{props.zh ? '管理子树' : 'Manage subtree'}</h2>
        <p>{props.zh ? '添加和拉取使用 squash 合并，需要干净的工作区。操作前会确认目标仓库与分支。' : 'Add and pull use squash and require a clean working tree. Confirm the target before executing.'}</p>
        <label>
          {props.zh ? '操作' : 'Action'}
          <Select
            ariaLabel={props.zh ? '操作' : 'Action'}
            value={operation}
            onChange={value => setOperation(value as 'add' | 'pull' | 'push')}
            options={[
              { value: 'add', label: props.zh ? '添加' : 'Add' },
              { value: 'pull', label: props.zh ? '拉取' : 'Pull' },
              { value: 'push', label: props.zh ? '推送' : 'Push' },
            ]}
          />
        </label>
        <label>
          {props.zh ? '子树路径' : 'Subtree path'}
          <TextInput value={path} onChange={(event) => setPath(event.currentTarget.value)} placeholder="packages/example" list="project-git-subtree-paths" />
        </label>
        <datalist id="project-git-subtree-paths">
          {props.repository.subtreePaths?.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <label>
          {props.zh ? '远端' : 'Remote'}
          <Select ariaLabel={props.zh ? '远端' : 'Remote'} value={remote} onChange={setRemote} options={props.repository.snapshot.remotes.map((value) => ({ value, label: value }))} />
        </label>
        <label>
          {props.zh ? '远端分支' : 'Remote branch'}
          <TextInput value={branch} onChange={(event) => setBranch(event.currentTarget.value)} placeholder="main" />
        </label>
        <footer>
          <Button variant="secondary" disabled={props.busy !== null} onClick={props.onClose}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            disabled={props.busy !== null || !path || !remote || !branch}
            onClick={() =>
              void props.onExecute(props.repository, { type: 'subtree', operation, path, remote, branch }, props.zh ? '子树操作' : 'Subtree operation').then((result) => {
                if (result === 'completed') props.onClose();
              })
            }
          >
            {props.zh ? '执行' : 'Execute'}
          </Button>
        </footer>
      </GitOperationDialog>
  );
}
