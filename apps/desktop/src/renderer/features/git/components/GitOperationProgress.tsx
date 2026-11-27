import { useRef, useState } from 'react';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { reportApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import { Button } from '../../../ui/Button.js';

export type CancelGitAction = () => Promise<{ cancelled: boolean }>;

export function GitOperationProgress({ repositoryName, action }: {
  repositoryName?: string;
  action: string;
}) {
  return <span className="git-operation-notice-status git-operation-progress" role="status">
    <CircleNotchIcon className="project-git-spinner" aria-hidden="true" />
    <span>
      {repositoryName ? <strong title={repositoryName}>{repositoryName}</strong> : null}
      <span>{action}…</span>
    </span>
  </span>;
}

export function GitOperationStopButton({ zh, onStop, onStopError, stopping, disabled, size, title }: {
  zh: boolean;
  onStop: () => void | Promise<void | { cancelled: boolean }>;
  onStopError?: (reason: unknown) => void;
  stopping?: boolean;
  disabled?: boolean;
  size?: 'compact' | 'regular';
  title?: string;
}) {
  const stopRequested = useRef(false);
  const [requestPending, setRequestPending] = useState(false);
  const isStopping = stopping || requestPending;
  async function stop() {
    if (disabled || stopping || stopRequested.current) return;
    stopRequested.current = true;
    setRequestPending(true);
    try {
      // Keep the stop button locked after an accepted request until the operation finishes.
      const result = await onStop();
      if (result?.cancelled) return;
    } catch (reason) {
      if (onStopError) onStopError(reason);
      else reportApplicationError(reason, { language: zh ? 'zh-CN' : 'en' });
    }
    stopRequested.current = false;
    setRequestPending(false);
  }

  return <Button size={size} title={title} busy={isStopping} disabled={disabled} onClick={() => void stop()}
    onKeyDown={event => { if (event.key === 'Enter' && event.repeat) event.preventDefault(); }}>
    {isStopping ? (zh ? '正在终止…' : 'Stopping…') : (zh ? '终止' : 'Stop')}
  </Button>;
}
