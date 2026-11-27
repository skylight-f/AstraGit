import { CheckboxField, TextInput } from '../../../ui/FormControls.js';
import { useState } from 'react';
import { FormDialog } from '../../../ui/FormDialog.js';
import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import type { BusyState, ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';

export function StashDialog(props: {
  repository: ProjectGitRepositoryWorkbenchItem;
  zh: boolean;
  busy: BusyState;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [message, setMessage] = useState('');
  const [keepIndex, setKeepIndex] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const locked = submitting || props.busy !== null;
  return (
    <FormDialog
      title={props.zh ? `贮藏 ${props.repository.name} 的变更` : `Stash changes in ${props.repository.name}`}
      description={props.zh
        ? '将当前仓库的已跟踪修改和未跟踪文件移入贮藏。可选择保留已暂存的变更。'
        : 'Move tracked and untracked changes from the current repository into a stash. You can choose to keep staged changes.'}
      zh={props.zh}
      busy={locked}
      submitLabel={props.zh ? '贮藏' : 'Stash'}
      onClose={props.onClose}
      onSubmit={async event => {
        event.preventDefault();
        if (locked) return;
        setSubmitting(true);
        try {
          const outcome = await props.onExecute(
            props.repository,
            { type: 'stash', message: message.trim() || undefined, includeUntracked: true, keepIndex },
            props.zh ? '贮藏工作区变更' : 'Stash working tree changes',
          );
          if (outcome === 'completed') props.onClose();
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label>
        <span>{props.zh ? '贮藏说明' : 'Stash message'}</span>
        <TextInput data-modal-initial-focus value={message} placeholder={props.zh ? '可选' : 'Optional'} onChange={event => setMessage(event.currentTarget.value)} />
      </label>
      <CheckboxField
        checked={keepIndex}
        onChange={event => setKeepIndex(event.currentTarget.checked)}
        title={props.zh ? '保留当前已经暂存到索引中的修改' : 'Leave changes already staged in the index intact'}
      >
        {props.zh ? '保留已暂存的变更' : 'Keep staged changes'}
      </CheckboxField>
    </FormDialog>
  );
}
