import { MenuSurface } from '../ui/MenuSurface.js';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModalPortal } from '../ui/ModalPortal.js';
import { Button } from '../ui/Button.js';

export interface GitMenuItem {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
}
export function GitContextMenu(props: { x: number; y: number; anchor?: HTMLElement; title: string; items: GitMenuItem[]; onClose: () => void; onError: (error: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  return createPortal(
    <MenuSurface onClose={props.onClose} anchor={props.anchor} ref={ref} className="project-git-context-menu" role="menu" aria-label={props.title} style={{ left: props.x, top: props.y }} onContextMenu={(event) => event.preventDefault()}>
      <strong>{props.title}</strong>
      {props.items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          data-danger={item.danger || undefined}
          onClick={() => {
            props.onClose();
            try {
              void Promise.resolve(item.run()).catch(props.onError);
            } catch (error) {
              props.onError(error);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </MenuSurface>,
    document.querySelector('.macos-ai-app') ?? document.body,
  );
}

export interface GitMenuConfirmation {
  title: string;
  description: string;
  paths?: readonly string[];
  field?: string;
  initialValue?: string;
  messageField?: string;
  checkboxLabel?: string;
  danger?: boolean;
  run: (input: { text: string; message: string; checked: boolean }) => Promise<boolean>;
}
export function GitMenuActionDialog(props: { value: GitMenuConfirmation; zh: boolean; onClose: () => void }) {
  const [text, setText] = useState(props.value.initialValue ?? '');
  const [message, setMessage] = useState('');
  const [checkedConfirmation, setCheckedConfirmation] = useState<GitMenuConfirmation | null>(null);
  const checked = checkedConfirmation === props.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const paths = props.value.paths;
  return (
    <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={busy} role="alertdialog" aria-label={props.value.title}>
      <section className="project-git-menu-action-dialog project-git-menu-confirmation" data-modal-surface="alertdialog">
        <header>
          <strong>{props.value.title}</strong>
        </header>
        <div className="project-git-menu-confirmation-body" role="region" aria-label={props.zh ? '操作详情' : 'Action details'} tabIndex={paths?.length ? 0 : undefined}>
          <p>{props.value.description}</p>
          {paths?.length ? <ul>{paths.map(path => <li key={path}>{path}</li>)}</ul> : null}
          {props.value.field ? (
            <label>
              {props.value.field}
              <input autoFocus value={text} disabled={busy} onChange={(event) => setText(event.currentTarget.value)} />
            </label>
          ) : null}
          {props.value.messageField ? (
            <label>
              {props.value.messageField}
              <textarea value={message} disabled={busy} onChange={(event) => setMessage(event.currentTarget.value)} />
            </label>
          ) : null}
          {props.value.checkboxLabel ? (
            <label className="git-checkout-stash">
              <input type="checkbox" checked={checked} disabled={busy} onChange={event => setCheckedConfirmation(event.currentTarget.checked ? props.value : null)} />
              {props.value.checkboxLabel}
            </label>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
        <footer>
          <Button variant="secondary" disabled={busy} onClick={props.onClose}>
            {props.zh ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant={props.value.danger ? 'danger' : 'primary'}
            busy={busy}
            disabled={busy || Boolean(props.value.field && !text.trim())}
            onClick={async () => {
              if (submitting.current) return;
              submitting.current = true;
              setBusy(true);
              setError('');
              try {
                if (await props.value.run({ text: text.trim(), message: message.trim(), checked })) props.onClose();
                else setError(props.zh ? '操作未完成，请处理错误后重试。' : 'The operation did not complete. Resolve the error and retry.');
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            {props.zh ? '确认' : 'Confirm'}
          </Button>
        </footer>
      </section>
    </ModalPortal>
  );
}
