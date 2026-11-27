import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

const columns = [
  { label: ['图表', 'Graph'], min: 32, initial: 'min(112px, 25%)' },
  { label: ['描述', 'Description'], min: 72, initial: '1fr' },
  { label: ['提交', 'Commit'], min: 40, initial: '58px' },
  { label: ['作者', 'Author'], min: 40, initial: '12%' },
  { label: ['日期', 'Date'], min: 52, initial: 'min(112px, 22%)' },
] as const;

type Layouts = Partial<Record<number, number[]>>;
const storageKey = 'astragit.git.history-column-widths.v1';

function readLayouts(): Layouts {
  const layouts: Layouts = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    for (const count of [3, 5]) {
      const widths = saved?.[count];
      if (Array.isArray(widths) && widths.length === count && widths.every(n => Number.isFinite(n) && n > 0)) layouts[count] = widths;
    }
  } catch { /* Use the default columns when preferences are unavailable. */ }
  return layouts;
}

function tracks(count: number, widths?: number[]) {
  return columns.slice(0, count).map((column, index) =>
    `minmax(${column.min}px, ${widths ? `${widths[index]}fr` : column.initial})`,
  ).join(' ');
}

function resizePair(widths: number[], index: number, delta: number) {
  const next = [...widths];
  const shift = Math.max(columns[index]!.min - widths[index]!, Math.min(delta, widths[index + 1]! - columns[index + 1]!.min));
  next[index] = widths[index]! + shift;
  next[index + 1] = widths[index + 1]! - shift;
  return next;
}

export function GitHistoryTable({ zh, scrollRef, pinned, children }: {
  zh: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  pinned: ReactNode;
  children: ReactNode;
}) {
  const header = useRef<HTMLElement>(null);
  const [layouts, setLayouts] = useState(readLayouts);
  const [preview, setPreview] = useState<number[] | null>(null);
  const [measured, setMeasured] = useState<number[]>([]);
  const drag = useRef<{ id: number; x: number; index: number; widths: number[] } | null>(null);

  function measure() {
    return Array.from(header.current?.children ?? [], cell => cell.getBoundingClientRect().width).filter(width => width > 0);
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => setMeasured(measure()));
    for (const cell of header.current!.children) observer.observe(cell);
    return () => observer.disconnect();
  }, []);

  function save(count: number, widths?: number[]) {
    const next = { ...layouts };
    if (widths) next[count] = widths;
    else delete next[count];
    setLayouts(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the session layout. */ }
  }
  function cancel() {
    drag.current = null;
    setPreview(null);
  }
  const style = {
    '--git-history-wide-tracks': tracks(5, preview?.length === 5 ? preview : layouts[5]),
    '--git-history-compact-tracks': tracks(3, preview?.length === 3 ? preview : layouts[3]),
  } as CSSProperties;

  return <main className="project-git-commit-list">
    <div className="project-git-commit-scroll" ref={scrollRef}>
      <div className="git-history-table" style={style}>
        <div className="git-history-pinned">
          <header className="project-git-list-header" ref={header}>
            {columns.map((column, index) => {
              const label = column.label[zh ? 0 : 1];
              const next = columns[index + 1];
              const resizeLabel = next && (zh ? `调整${label}与${next.label[0]}列宽` : `Resize ${label} and ${next.label[1]} columns`);
              return <div className="git-history-column" key={column.label[1]}>
                <span>{label}</span>
                {next && <span
                  className="git-history-column-divider" role="separator" tabIndex={0} aria-orientation="vertical"
                  aria-label={resizeLabel} aria-valuemin={column.min} aria-valuenow={Math.round(measured[index] ?? column.min)}
                  aria-valuemax={Math.round((measured[index] ?? column.min) + (measured[index + 1] ?? next.min) - next.min)}
                  aria-valuetext={`${Math.round(measured[index] ?? column.min)} px`}
                  title={zh ? `${resizeLabel} · 双击恢复默认列宽` : `${resizeLabel} · Double-click to reset columns`}
                  data-dragging={drag.current?.index === index || undefined}
                  onPointerDown={event => {
                    if (event.button !== 0 || drag.current) return;
                    const widths = measure();
                    if (index + 1 >= widths.length) return;
                    event.preventDefault();
                    event.currentTarget.focus({ preventScroll: true });
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { id: event.pointerId, x: event.clientX, index, widths };
                  }}
                  onPointerMove={event => {
                    const start = drag.current;
                    if (start?.id === event.pointerId) setPreview(resizePair(start.widths, start.index, event.clientX - start.x));
                  }}
                  onPointerUp={event => {
                    const start = drag.current;
                    if (start?.id !== event.pointerId) return;
                    const delta = event.clientX - start.x;
                    if (delta) save(start.widths.length, resizePair(start.widths, start.index, delta));
                    cancel();
                  }}
                  onLostPointerCapture={cancel} onPointerCancel={cancel}
                  onDoubleClick={() => save(measure().length)}
                  onKeyDown={event => {
                    if (event.key === 'Escape' && drag.current) {
                      cancel();
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    if (drag.current || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
                    event.preventDefault();
                    const widths = measure();
                    save(widths.length, event.key === 'Home' ? undefined : resizePair(widths, index, event.key === 'ArrowLeft' ? -8 : 8));
                  }}
                />}
              </div>;
            })}
          </header>
          {pinned}
        </div>
        <div className="project-git-commit-rows">{children}</div>
      </div>
    </div>
  </main>;
}
