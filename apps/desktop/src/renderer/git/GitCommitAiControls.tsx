import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { MenuSurface } from '../ui/MenuSurface.js';
import type { GitCommitModelState } from './useGitCommitModels.js';
import './gitCommitAiControls.css';

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
          {models.items.map(item => (
            <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === models.modelRef} title={item.label} onClick={() => choose(() => models.selectModel(item.id))}>
              <span>{item.label}</span>{item.id === models.modelRef ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
          {models.items.length ? <hr role="separator" /> : null}
          <button type="button" role="menuitem" disabled={models.loading} onClick={() => choose(models.refresh)}>
            <ArrowsClockwise aria-hidden="true" /><span>{zh ? '刷新模型列表' : 'Refresh models'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => choose(onOpenSettings)}>
            <GearSix aria-hidden="true" /><span>{zh ? '模型设置' : 'Model settings'}</span>
          </button>
        </MenuSurface>,
        document.body,
      ) : null}
    </div>
  );
}
