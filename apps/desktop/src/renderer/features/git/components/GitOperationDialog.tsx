import type { ReactNode } from 'react';
import { Button } from '../../../ui/Button.js';
import { ModalPortal, type ModalPortalProps } from '../../../ui/ModalPortal.js';

type GitOperationDialogProps = Omit<ModalPortalProps, 'rootClassName' | 'backdropClassName'> & {
  className: string;
};

export function GitOperationDialog({ className, children, ...portal }: GitOperationDialogProps) {
  return (
    <ModalPortal {...portal} rootClassName="project-git-modal-root">
      <section className={`git-operation-dialog ${className}`} data-modal-surface={portal.role}>
        {children}
      </section>
    </ModalPortal>
  );
}

export function GitOperationDialogHeader(props: {
  title: string;
  detail?: ReactNode;
  zh: boolean;
  closeDisabled?: boolean;
  onClose: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="git-operation-dialog-heading">
      <div>
        <h2>{props.title}</h2>
        {props.detail ? <p>{props.detail}</p> : null}
      </div>
      <div className="git-operation-dialog-heading-actions">
        {props.actions}
        <Button size="compact" disabled={props.closeDisabled} onClick={props.onClose}>
          {props.zh ? '关闭' : 'Close'}
        </Button>
      </div>
    </header>
  );
}
