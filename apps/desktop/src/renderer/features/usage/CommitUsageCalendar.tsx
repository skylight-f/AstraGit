import type { CSSProperties, KeyboardEvent } from 'react';
import { commitUsageDay } from '@astragit/shared';
import type { CommitUsageRow } from '@astragit/shared';

export type UsageTotals = Pick<CommitUsageRow, 'generations' | 'reportedGenerations' | 'totalTokens'>;
type Metric = 'generations' | 'totalTokens';

export function usageCalendarDays(today: Date) {
  const first = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1, 12);
  const startOffset = (first.getDay() + 6) % 7;
  const days: { day: string; month: number; week: number; weekday: number }[] = [];
  const end = commitUsageDay(today);
  for (const date = new Date(first); commitUsageDay(date) <= end; date.setDate(date.getDate() + 1)) {
    const index = startOffset + days.length;
    days.push({ day: commitUsageDay(date), month: date.getMonth(), week: Math.floor(index / 7), weekday: index % 7 });
  }
  return days;
}

export function CommitUsageCalendar(props: {
  days: ReturnType<typeof usageCalendarDays>; totals: Map<string, UsageTotals>; metric: Metric;
  selected: string; onSelect: (day: string) => void; zh: boolean;
}) {
  const { days, totals, metric, selected, onSelect, zh } = props;
  const weeks = days[days.length - 1].week + 1;
  const highest = Math.max(1, ...days.map(({ day }) => totals.get(day)?.[metric] ?? 0));
  const format = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US');
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = days[Math.max(0, Math.min(days.length - 1, index + offsets[event.key]))];
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-day="${next.day}"]`)?.focus();
  };
  return <div className="gitapp-usage-calendar">
    <div className="gitapp-usage-calendar-scroll">
      <div className="gitapp-usage-grid" style={{ '--weeks': weeks } as CSSProperties} role="group" aria-label={zh ? '过去一年的每日用量' : 'Daily usage over the past year'}>
        {days.map(({ day, month, week }, index) => {
          if (index && days[index - 1].month === month) return null;
          // A partial first month can share a week with the next month.
          if (!index && days[7]?.month !== month) return null;
          return <span key={day} className="gitapp-usage-month" style={{ gridColumn: week + 2, gridRow: 1 }}>
            {zh ? `${month + 1}月` : new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(2000, month, 1))}
          </span>;
        })}
        {(zh ? ['一', '三', '五', '日'] : ['M', 'W', 'F', 'S']).map((label, index) =>
          <span key={label} className="gitapp-usage-weekday" style={{ gridColumn: 1, gridRow: index * 2 + 2 }}>{label}</span>)}
        {days.map(({ day, week, weekday }, index) => {
          const usage = totals.get(day);
          const count = usage?.generations ?? 0;
          const tokens = usage && !usage.reportedGenerations ? '—' : format.format(usage?.totalTokens ?? 0);
          const missing = count - (usage?.reportedGenerations ?? 0);
          const description = zh ? `${day} · 生成 ${count} 次 · 已报告 ${tokens} Token · ${missing} 次未报告用量`
            : `${day} · ${count} drafts · ${tokens} reported tokens · ${missing} without usage`;
          const level = Math.ceil((usage?.[metric] ?? 0) / highest * 4);
          return <button type="button" key={day} data-day={day} data-level={level}
            data-unknown={metric === 'totalTokens' && count > 0 && !usage?.reportedGenerations || undefined}
            aria-label={description} title={description} aria-pressed={day === selected}
            tabIndex={day === (selected || days[days.length - 1].day) ? 0 : -1}
            style={{ gridColumn: week + 2, gridRow: weekday + 2 }}
            onKeyDown={event => move(event, index)} onClick={() => onSelect(day === selected ? '' : day)} />;
        })}
      </div>
    </div>
    <div className="gitapp-usage-legend"><span>{zh ? '少' : 'Less'}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}<span>{zh ? '多' : 'More'}</span>
      {metric === 'totalTokens' && <><i data-unknown="true" /><span>{zh ? '用量未知' : 'Unknown usage'}</span></>}
    </div>
  </div>;
}
