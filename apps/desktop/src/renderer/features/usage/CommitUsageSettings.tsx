import { useEffect, useState } from 'react';
import { CommitUsageCalendar, usageCalendarDays, type UsageTotals as Totals } from './CommitUsageCalendar.js';
import type { CommitUsageRow } from '@astragit/shared';
import type { DashboardClient } from '../../api/apiClient.js';
import { VisibleApplicationError } from '../../ui/ApplicationErrorDialog.js';

const dimensions = ['project', 'model', 'provider'] as const;
type Dimension = typeof dimensions[number];

function emptyTotals(): Totals {
  return { generations: 0, reportedGenerations: 0, totalTokens: 0 };
}

function addTotals(total: Totals, row: Totals) {
  total.generations += row.generations;
  total.reportedGenerations += row.reportedGenerations;
  total.totalTokens += row.totalTokens;
}

export function CommitUsageSettings({ client, zh }: { client: DashboardClient; zh: boolean }) {
  const [rows, setRows] = useState<CommitUsageRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [metric, setMetric] = useState<'generations' | 'totalTokens'>('generations');
  const [selectedDay, setSelectedDay] = useState('');
  const days = usageCalendarDays(new Date());
  const daily = new Map<string, Totals>();
  const [dimension, setDimension] = useState<Dimension>('project');
  const [filters, setFilters] = useState({ project: '', model: '', provider: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    client.loadCommitUsage().then(value => {
      if (!cancelled) { setRows(value); setError(null); }
    }, reason => { if (!cancelled) setError(reason); });
    return () => { cancelled = true; };
  }, [client, revision]);
  const labels = zh ? { project: '项目', model: '模型', provider: '供应商' } : { project: 'Project', model: 'Model', provider: 'Provider' };
  const number = new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US');
  const groups = new Map<string, Totals & { name: string }>();
  const total = emptyTotals();
  for (const row of rows ?? []) {
    if (dimensions.some(key => filters[key] && filters[key] !== row[`${key}Id`])) continue;
    if (row.day < days[0].day || row.day > days[days.length - 1].day) continue;
    const dayTotal = daily.get(row.day) ?? emptyTotals();
    addTotals(dayTotal, row);
    daily.set(row.day, dayTotal);
    if (selectedDay && row.day !== selectedDay) continue;
    const id = row[`${dimension}Id`];
    const group = groups.get(id) ?? { name: row[`${dimension}Name`], ...emptyTotals() };
    addTotals(group, row);
    groups.set(id, group);
    addTotals(total, row);
  }
  const values = (item: Totals) => <>
    <td>{number.format(item.generations)}</td>
    <td>{item.reportedGenerations || !item.generations ? number.format(item.totalTokens) : '—'}</td>
    <td>{number.format(item.generations - item.reportedGenerations)}</td>
  </>;
  return <section className="gitapp-settings-section gitapp-commit-usage">
    <header><h2>{zh ? 'AI 提交说明用量' : 'AI commit message usage'}</h2>
      <button type="button" onClick={() => setRevision(value => value + 1)}>{zh ? '刷新' : 'Refresh'}</button></header>
    <p>{zh ? '从升级后开始统计。每生成一份提交说明计一次，Token 合计采用供应商实际返回的用量。' : 'Tracking starts with this version. Each generated draft counts once. Token totals use the usage reported by providers.'}</p>
    {error ? <div role="alert"><VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} /></div> : null}
    {rows === null ? !error && <p role="status">{zh ? '正在读取用量…' : 'Loading usage…'}</p> : <>
      <div className="gitapp-usage-filters">{dimensions.map(key => {
        const options = new Map(rows.map(row => [row[`${key}Id`], row[`${key}Name`]]));
        return <label key={key}>{labels[key]}<select value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })}>
          <option value="">{zh ? '全部' : 'All'}</option>
          {[...options].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>;
      })}<label>{zh ? '分组方式' : 'Group by'}<select value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>
        {dimensions.map(key => <option key={key} value={key}>{labels[key]}</option>)}
      </select></label></div>
      <div className="gitapp-usage-chart-card">
        <header><h3>{zh ? '过去一年' : 'Past year'}</h3><div className="gitapp-usage-metrics" role="group" aria-label={zh ? '热力图指标' : 'Heatmap metric'}>
          <button type="button" aria-pressed={metric === 'generations'} onClick={() => setMetric('generations')}>{zh ? '生成次数' : 'Drafts'}</button>
          <button type="button" aria-pressed={metric === 'totalTokens'} onClick={() => setMetric('totalTokens')}>Token</button>
        </div></header>
        <CommitUsageCalendar days={days} totals={daily} metric={metric} zh={zh} selected={selectedDay} onSelect={setSelectedDay} />
      </div>
      <header><h3>{selectedDay || (zh ? '全年明细' : 'Year breakdown')}</h3>
        {selectedDay && <button type="button" onClick={() => setSelectedDay('')}>{zh ? '查看全年' : 'Show full year'}</button>}
      </header>
      <table><thead><tr><th scope="col">{labels[dimension]}</th><th scope="col">{zh ? '生成次数' : 'Drafts'}</th>
        <th scope="col">{zh ? '已报告 Token' : 'Reported tokens'}</th><th scope="col">{zh ? '未报告用量的次数' : 'Drafts without usage'}</th></tr></thead>
        <tbody>{[...groups].sort((a, b) => b[1].generations - a[1].generations || a[1].name.localeCompare(b[1].name)).map(([id, item]) =>
          <tr key={id}><th scope="row">{item.name}</th>{values(item)}</tr>)}</tbody>
        <tfoot><tr><th scope="row">{zh ? '合计' : 'Total'}</th>{values(total)}</tr></tfoot>
      </table>
      {!total.generations && <p>{zh ? '当前范围暂无生成记录。' : 'No drafts recorded for this selection.'}</p>}
    </>}
  </section>;
}
