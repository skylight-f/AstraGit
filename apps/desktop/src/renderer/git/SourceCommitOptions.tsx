import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';

/** 提交设置是表单浮层，保留原生下拉框键盘行为，不使用菜单的方向键/Tab 拦截。 */
export function SourceCommitOptions(props: { active: boolean; zh: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const title = props.zh ? '提交选项' : 'Commit options';
  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!props.active) { setOpen(false); return; }
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('select:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || root.current?.closest('[inert]')) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open, props.active]);

  return <div ref={root} className="source-git-options">
    <button ref={trigger} type="button" className="source-git-options-trigger" aria-expanded={open && props.active} aria-controls={open && props.active ? id : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
      {open ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}{title}
    </button>
    {open && props.active ? <div ref={panel} id={id} className="source-git-options-panel" role="dialog" aria-labelledby={`${id}-title`}>
      <header><strong id={`${id}-title`}>{title}</strong><button type="button" aria-label={props.zh ? '关闭提交选项' : 'Close commit options'} onClick={() => dismiss(true)}>{props.zh ? '关闭' : 'Close'}</button></header>
      {props.children}
    </div> : null}
  </div>;
}
