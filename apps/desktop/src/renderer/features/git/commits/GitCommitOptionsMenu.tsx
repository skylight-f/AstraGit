import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import type { GitCommitOptions, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { MenuSurface } from '../../../ui/MenuSurface.js';
import { MotionPresence } from '../../../ui/MotionPresence.js';
import { gitPullRequestUrl } from './gitPullRequestUrl.js';
import './gitCommitOptions.css';

const optionLabels = {
  skipHooks: ['跳过提交钩子', 'Skip commit hooks'],
  signCommit: ['对提交进行 GPG 签名', 'GPG sign commit'],
  signoff: ['添加 Signed-off-by', 'Add Signed-off-by'],
} as const;
const optionKeys = Object.keys(optionLabels) as Array<keyof GitCommitOptions>;

export function GitCommitOptionsSummary({ options, zh }: { options?: GitCommitOptions; zh: boolean }) {
  const enabled = optionKeys.filter(key => options?.[key]).map(key => optionLabels[key][zh ? 0 : 1]);
  return enabled.length ? <small>{enabled.join(zh ? '、' : ', ')}</small> : null;
}

export function CommitOptionToggle({ checked, onChange, children, title }: { checked: boolean; onChange: () => void; children: ReactNode; title?: string }) {
  return <button type="button" role="menuitemcheckbox" aria-checked={checked} onClick={onChange} title={title}>
    {children}<CheckIcon aria-hidden="true" data-checked={checked} />
  </button>;
}

export function GitCommitOptionsMenu(props: {
  zh: boolean;
  disabled: boolean;
  repository?: ProjectGitRepositoryWorkbenchItem | null;
  options: GitCommitOptions;
  onChange: (options: GitCommitOptions) => void;
  onAmend?: (repository: ProjectGitRepositoryWorkbenchItem, options: GitCommitOptions) => void;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const { repository } = props;
  const snapshot = repository?.snapshot;
  const canAmend = Boolean(props.onAmend && snapshot?.headSha && snapshot.indexFingerprint && !snapshot.integrationState && !snapshot.conflictFiles.length);
  const requestUrl = snapshot ? gitPullRequestUrl(snapshot) : null;
  const count = optionKeys.filter(key => props.options[key]).length;
  const label = text('提交选项', 'Commit options');
  const host = trigger.current?.closest('[data-zeus-primitive="modal"], .macos-ai-app');
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);

  return <div className={props.className}>
    <Button ref={trigger} size="compact" variant="secondary" disabled={props.disabled} aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      {label}{count ? ` · ${count}` : ''}<CaretDownIcon size={12} aria-hidden="true" />
    </Button>
    {host ? createPortal(<MotionPresence>{open && !props.disabled ? <MenuSurface id={id} className="project-git-operations-menu git-commit-options-menu"
      aria-label={label} anchor={trigger.current ?? undefined} onClose={() => setOpen(false)}>
      <button type="button" role="menuitem" disabled={!canAmend} onClick={() => {
        setOpen(false);
        if (repository) props.onAmend?.(repository, props.options);
      }}>{text('修订上次提交…', 'Amend last commit…')}</button>
      {optionKeys.map(option => (
        <CommitOptionToggle key={option} checked={props.options[option] === true}
          title={option === 'skipHooks' ? text('跳过 pre-commit 和 commit-msg', 'Skip pre-commit and commit-msg') : undefined}
          onChange={() => props.onChange({ ...props.options, [option]: !props.options[option] })}>
          {optionLabels[option][props.zh ? 0 : 1]}
        </CommitOptionToggle>
      ))}
      <button type="button" role="menuitem" disabled={!requestUrl} title={requestUrl ? undefined : text('需要已推送到 GitHub 或 GitLab 的分支', 'Requires a branch published to GitHub or GitLab')} onClick={() => {
        setOpen(false);
        if (requestUrl) window.open(requestUrl, '_blank', 'noopener');
      }}>{text('创建拉取请求…', 'Create pull request…')}</button>
      {props.children ? <><hr role="separator" />{props.children}</> : null}
    </MenuSurface> : null}</MotionPresence>, host) : null}
  </div>;
}
