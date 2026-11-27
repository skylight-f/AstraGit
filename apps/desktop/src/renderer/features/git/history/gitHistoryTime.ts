const commitHistoryDateOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
const commitHistoryDates = {
  zh: new Intl.DateTimeFormat('zh-CN', commitHistoryDateOptions),
  en: new Intl.DateTimeFormat('en-US', commitHistoryDateOptions),
};

export function formatCommitHistoryTime(value: string, zh: boolean): string {
  const timestamp = Date.parse(value);
  const week = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - timestamp >= week) return commitHistoryDates[zh ? 'zh' : 'en'].format(timestamp);
  return formatRelativeTime(value, zh);
}

export function formatRelativeTime(value: string, zh: boolean): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return zh ? '刚刚' : 'Just now';
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}
