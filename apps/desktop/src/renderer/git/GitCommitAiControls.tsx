import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { ModelSelect } from '../ModelSelect.js';
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
  const modelLabel = zh ? '生成提交说明的模型' : 'Commit message model';
  const label = generating ? (zh ? '停止生成' : 'Stop generating') : (zh ? 'AI 生成' : 'Generate with AI');

  return (
    <div className="git-commit-ai-tools">
      <ModelSelect
        zh={zh}
        ariaLabel={modelLabel}
        items={models.items}
        value={models.modelRef}
        disabled={modelDisabled}
        loading={models.loading}
        onChange={models.selectModel}
        onRefresh={models.refresh}
        onOpenSettings={onOpenSettings}
      />
      <button type="button" className="git-commit-ai-button" data-generating={generating} disabled={disabled} title={generating ? label : models.modelRef ? title : undefined} onClick={onClick}>
        {generating ? <Stop weight="fill" aria-hidden="true" /> : <Sparkle aria-hidden="true" />}
        {label}
      </button>
    </div>
  );
}
