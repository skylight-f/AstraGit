import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

/** 尺寸按比例保存；窗口缩放后仍保留可用的内容区域。 */
export function GitPaneSeparator(props: { name: string; label: string; axis?: 'x' | 'y'; initial: number; min?: number; max?: number; target?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const value = useRef(props.initial);
  const preferred = useRef(props.initial);
  const [displayedValue, setDisplayedValue] = useState(props.initial);
  const start = useRef<{ pointerId: number; coordinate: number; value: number; preferred: number; size: number; moved: boolean } | null>(null);
  const axis = props.axis ?? 'x';
  const minimum = props.min ?? 15;
  const maximum = props.max ?? 65;
  const storageKey = `astragit.git.panes.v1.${props.name}`;
  const container = () => (props.target ? element.current?.closest<HTMLElement>(props.target) : element.current?.parentElement);
  const apply = (next: number, save = false, preservePreference = false) => {
    value.current = Math.max(minimum, Math.min(maximum, next));
    if (!preservePreference) preferred.current = value.current;
    container()?.style.setProperty(`--git-${props.name}`, `${value.current}%`);
    setDisplayedValue(value.current);
    if (save) {
      try {
        localStorage.setItem(storageKey, String(preferred.current));
      } catch {
        /* 偏好存储不可用时继续允许拖拽。 */
      }
    }
  };
  useLayoutEffect(() => {
    let restored = props.initial;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null && Number.isFinite(Number(saved))) restored = Number(saved);
    } catch {
      /* 使用默认尺寸。 */
    }
    preferred.current = restored;
    apply(restored, false, true);
  }, [storageKey, props.initial, props.target]);
  useLayoutEffect(() => {
    // Responsive limits may change while dragging or hiding a pane. Keep its
    // current preference instead of restoring the previous saved drag position.
    apply(preferred.current, false, true);
  }, [minimum, maximum]);
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current || event.pointerId !== start.current.pointerId) return;
    const { pointerId, value: initialValue, preferred: initialPreference, moved } = start.current;
    start.current = null;
    element.current?.removeAttribute('data-dragging');
    if (element.current?.hasPointerCapture(pointerId)) element.current.releasePointerCapture(pointerId);
    // A click, or a drag back to its starting point, must not replace a saved
    // preference with the temporary size imposed by a smaller window.
    if (!moved || Math.abs(value.current - initialValue) < 0.0001) {
      preferred.current = initialPreference;
      apply(initialPreference, false, true);
    } else {
      apply(value.current, true);
    }
  };
  const cancel = (event?: PointerEvent<HTMLDivElement>) => {
    if (!start.current || (event && event.pointerId !== start.current.pointerId)) return;
    const { pointerId, preferred: previous } = start.current;
    start.current = null;
    element.current?.removeAttribute('data-dragging');
    if (element.current?.hasPointerCapture(pointerId)) element.current.releasePointerCapture(pointerId);
    preferred.current = previous;
    apply(previous, false, true);
  };
  const reset = () => {
    if (start.current) cancel();
    // Reset the preference itself; a small window only limits its current display.
    preferred.current = props.initial;
    apply(props.initial, true, true);
  };
  return (
    <div
      ref={element}
      className={`git-pane-separator is-${axis} git-separator-${props.name}`}
      role="separator"
      tabIndex={0}
      aria-label={props.label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={displayedValue}
      aria-valuetext={`${Math.round(displayedValue)}%`}
      aria-disabled={minimum === maximum || undefined}
      title={`${props.label} · 双击恢复默认`}
      onDoubleClick={reset}
      onPointerDown={(event) => {
        if (event.button !== 0 || start.current) return;
        const bounds = container()?.getBoundingClientRect();
        if (!bounds || minimum === maximum || bounds.width <= 0 || bounds.height <= 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        element.current?.setAttribute('data-dragging', 'true');
        start.current = { pointerId: event.pointerId, coordinate: axis === 'x' ? event.clientX : event.clientY, value: value.current, preferred: preferred.current, size: axis === 'x' ? bounds.width : bounds.height, moved: false };
      }}
      onPointerMove={(event) => {
        if (!start.current || event.pointerId !== start.current.pointerId) return;
        const delta = (axis === 'x' ? event.clientX : event.clientY) - start.current.coordinate;
        if (!start.current.moved && delta === 0) return;
        start.current.moved = true;
        apply(start.current.value + (delta / Math.max(1, start.current.size)) * 100);
      }}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && start.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        if (start.current) return;
        const previous = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const next = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (event.key === previous || event.key === next) {
          event.preventDefault();
          apply(value.current + (event.key === previous ? -2 : 2), true);
        } else if (event.key === 'Home' || event.key === 'Enter') {
          event.preventDefault();
          reset();
        }
      }}
    />
  );
}
