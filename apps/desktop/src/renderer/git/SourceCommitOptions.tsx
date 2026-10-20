import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';

/** 提交设置是表单浮层，保留原生下拉框键盘行为，不使用菜单的方向键/Tab 拦截。 */
export function SourceCommitOptions(props: { active: boolean; zh: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selectPicker = useRef<HTMLSelectElement | null>(null);
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
      if (selectPicker.current) { selectPicker.current = null; return; }
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    // 系统选择器可能只把取消后的 keyup 交回网页，不能留下下一次 Esc 的屏蔽状态。
    const keyup = (event: KeyboardEvent) => { if (event.key === 'Escape') selectPicker.current = null; };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    return () => {
      selectPicker.current = null;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
    };
  }, [open, props.active]);

  return <div ref={root} className="source-git-options"
    onPointerDownCapture={event => { if (event.target instanceof HTMLSelectElement) selectPicker.current = event.target; }}
    onKeyDownCapture={event => {
      if (event.target instanceof HTMLSelectElement && (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown'))) selectPicker.current = event.target;
    }}
    onChangeCapture={event => { if (event.target instanceof HTMLSelectElement) selectPicker.current = null; }}
    onBlurCapture={event => {
      // 原生下拉框暂时将焦点交给系统时不关闭，只响应真实控件之间的移出。
      if (event.relatedTarget instanceof HTMLElement && event.relatedTarget !== document.body && !event.currentTarget.contains(event.relatedTarget)) { selectPicker.current = null; setOpen(false); }
    }}>
    <button ref={trigger} type="button" className="source-git-options-trigger" aria-expanded={open && props.active} aria-controls={open && props.active ? id : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
      {open ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}{title}
    </button>
    {open && props.active ? <div ref={panel} id={id} className="source-git-options-panel" role="dialog" aria-labelledby={`${id}-title`}>
      <header><strong id={`${id}-title`}>{title}</strong><button type="button" aria-label={props.zh ? '关闭提交选项' : 'Close commit options'} onClick={() => dismiss(true)}>{props.zh ? '关闭' : 'Close'}</button></header>
      {props.children}
    </div> : null}
  </div>;
}
