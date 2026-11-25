import { useMemo } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import type { GitCommitModelOption } from './features/git/gitApiClient.js';
import { ZeusSelect, type ZeusSelectOption } from './ZeusSelect.js';
import codexLogo from './git/assets/codex.png';
import mimoLogo from './git/assets/xiaomi-mimo.png';
import './modelSelect.css';

function modelIcon(item: GitCommitModelOption) {
  const modelId = item.id.slice(item.id.indexOf(':') + 1);
  const logo = item.sourceId === 'codex' ? codexLogo : /(?:^|%2f)mimo(?:[-_.]|$)/iu.test(modelId) ? mimoLogo : undefined;
  if (logo) return <img className="ai-model-select-logo" src={logo} alt="" />;
  const initial = Array.from(item.sourceName?.trim() ?? '')[0]?.toUpperCase();
  return <span className="ai-model-select-symbol">{initial || <Sparkle size={14} />}</span>;
}

/** 所有业务入口共用模型分组、搜索、选中反馈与管理操作。 */
export function ModelSelect({ items, value, onChange, zh, ariaLabel, disabled = false, loading = false, onRefresh, onOpenSettings }: {
  items: readonly GitCommitModelOption[];
  value: string;
  onChange: (value: string) => void;
  zh: boolean;
  ariaLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const options = useMemo(() => {
    const groups = new Map<string, ZeusSelectOption<string>[]>();
    for (const item of items) {
      const option: ZeusSelectOption<string> = { value: item.id, label: item.displayName ?? item.label, group: item.sourceName, icon: modelIcon(item), searchText: item.label };
      const key = item.sourceId ?? '';
      const group = groups.get(key);
      if (group) group.push(option);
      else groups.set(key, [option]);
    }
    return [...groups.values()].flat();
  }, [items]);
  const selected = items.find(item => item.id === value);
  const modelText = selected?.label ?? (loading ? (zh ? '正在加载模型…' : 'Loading models…') : (zh ? '请先配置模型' : 'Configure a model first'));
  return <ZeusSelect
    size="compact"
    className="ai-model-select"
    popoverClassName="ai-model-select-popover"
    popoverMinWidth={320}
    popoverMaxWidth={320}
    ariaLabel={ariaLabel}
    triggerLabel={modelText}
    triggerTitle={modelText}
    value={value}
    options={options}
    onChange={onChange}
    disabled={disabled}
    searchable
    searchPlaceholder={zh ? '搜索模型或供应商…' : 'Search models or providers…'}
    emptyLabel={loading ? (zh ? '正在加载模型…' : 'Loading models…') : items.length ? (zh ? '没有匹配的模型' : 'No matching models') : (zh ? '暂无可用模型，请先配置。' : 'No models available. Configure a model first.')}
    footer={close => <span className="ai-model-select-actions">
      <button type="button" disabled={loading} onClick={() => { close(); onRefresh(); }}><ArrowsClockwise size={14} aria-hidden="true" />{zh ? '刷新模型列表' : 'Refresh models'}</button>
      <button type="button" onClick={() => { close(); onOpenSettings(); }}><GearSix size={14} aria-hidden="true" />{zh ? '模型设置' : 'Model settings'}</button>
    </span>}
  />;
}
