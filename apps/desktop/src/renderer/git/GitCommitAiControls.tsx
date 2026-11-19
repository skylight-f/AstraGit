import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { MenuSurface } from '../ui/MenuSurface.js';
import type { GitCommitModelOption } from '../features/git/gitApiClient.js';
import type { GitCommitModelState } from './useGitCommitModels.js';
import './gitCommitAiControls.css';

function groupModels(items: readonly GitCommitModelOption[]) {
  const groups = new Map<string, { name: string; items: GitCommitModelOption[] }>();
  for (const item of items) {
    const key = item.sourceId ?? '';
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { name: item.sourceName ?? '', items: [item] });
  }
  return [...groups.entries()];
}

export function GitCommitAiControls({ zh, models, modelDisabled, generating, disabled, title, onClick, onOpenSettings }: {
  zh: boolean;
  models: GitCommitModelState;
  modelDisabled: boolean;
  generating: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
  onOpenSettings: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const menuId = useId();
  const modelLabel = zh ? '生成提交说明的模型' : 'Commit message model';
  const selectedModel = models.items.find(item => item.id === models.modelRef);
  const modelText = selectedModel?.label ?? (models.loading ? (zh ? '正在加载模型…' : 'Loading models…') : (zh ? '请先配置模型' : 'Configure a model first'));
  const label = generating ? (zh ? '停止生成' : 'Stop generating') : (zh ? 'AI 生成' : 'Generate with AI');

  function choose(action: () => void) {
    anchor?.focus({ preventScroll: true });
    setAnchor(null);
    action();
  }

  return (
    <div className="git-commit-ai-tools">
      <button
        type="button"
        className="git-commit-model-trigger"
        aria-label={`${modelLabel} — ${modelText}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor ? menuId : undefined}
        title={modelText}
        data-placeholder={selectedModel === undefined}
        disabled={modelDisabled}
        onClick={event => setAnchor(anchor ? null : event.currentTarget)}
      >
        <span>{modelText}</span><CaretDown aria-hidden="true" />
      </button>
      <button type="button" className="git-commit-ai-button" data-generating={generating} disabled={disabled} title={generating ? label : models.modelRef ? title : undefined} onClick={onClick}>
        {generating ? <Stop weight="fill" aria-hidden="true" /> : <Sparkle aria-hidden="true" />}
        {label}
      </button>
      {anchor ? createPortal(
        <MenuSurface
          anchor={anchor}
          id={menuId}
          className="project-git-context-menu git-commit-model-menu"
          aria-label={modelLabel}
          onClose={() => setAnchor(null)}
        >
          {models.items.length ? <div className="git-commit-model-list" role="presentation">
            {groupModels(models.items).map(([id, group]) => {
              const initial = Array.from(group.name.trim())[0]?.toUpperCase();
              return <div key={id} className="git-commit-model-group" role="group" aria-label={group.name || modelLabel}>
                {group.name ? <div className="git-commit-model-group-title" aria-hidden="true" title={group.name}>{group.name}</div> : null}
                {group.items.map(item => (
                  <button key={item.id} className="git-commit-model-option" type="button" role="menuitemradio" aria-checked={item.id === models.modelRef} title={item.label} onClick={() => choose(() => models.selectModel(item.id))}>
                    <span className="git-commit-model-symbol" aria-hidden="true">{initial || <Sparkle />}</span>
                    <span className="git-commit-model-option-name">{item.displayName ?? item.label}</span>
                    {item.id === models.modelRef ? <Check weight="bold" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>;
            })}
          </div> : null}
          <div className="git-commit-model-actions" role="group" aria-label={zh ? '模型操作' : 'Model actions'}>
            <button type="button" role="menuitem" disabled={models.loading} onClick={() => choose(models.refresh)}>
              <ArrowsClockwise aria-hidden="true" /><span>{zh ? '刷新模型列表' : 'Refresh models'}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => choose(onOpenSettings)}>
              <GearSix aria-hidden="true" /><span>{zh ? '模型设置' : 'Model settings'}</span>
            </button>
          </div>
        </MenuSurface>,
        document.body,
      ) : null}
    </div>
  );
}
