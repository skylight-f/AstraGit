import { useState } from 'react';
import { Button } from '../ui/Button.js';
import { readGitLargeFilePreferences, saveGitLargeFilePreferences } from './gitLargeFilePreferences.js';

export function GitLargeFileWarningSettings(props: { zh: boolean; disabled: boolean }) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [preference, setPreference] = useState(readGitLargeFilePreferences);
  const [threshold, setThreshold] = useState(String(preference.thresholdMiB));
  const [feedback, setFeedback] = useState('');
  const value = Number(threshold);
  const valid = threshold.trim() !== '' && Number.isSafeInteger(value) && value >= 1 && value <= 1024;
  return <fieldset className="git-lfs-warning-settings" disabled={props.disabled}>
    <legend>{text('大文件暂存提醒（本应用）', 'Large-file staging warning (this app)')}</legend>
    <label className="git-lfs-check"><input type="checkbox" checked={preference.enabled} onChange={event => { setPreference(current => ({ ...current, enabled: event.target.checked })); setFeedback(''); }} />{text('暂存前提醒尚未由 LFS 跟踪的大文件', 'Warn before staging large files not tracked by LFS')}</label>
    <label>{text('提醒阈值（MiB，1–1024）', 'Warning threshold (MiB, 1–1024)')}<input type="number" min={1} max={1024} step={1} value={threshold} onChange={event => { setThreshold(event.target.value); setFeedback(''); }} aria-invalid={!valid || undefined} /></label>
    <small>{text('AstraGit 默认 10 MiB。关闭提醒不会绕过已声明 LFS 文件缺少 filters 的检查，也不会修改 Git 配置。', 'AstraGit defaults to 10 MiB. Disabling the warning does not bypass missing filters for declared LFS files or change Git configuration.')}</small>
    <Button variant="secondary" disabled={!valid} onClick={() => {
      const next = { ...preference, thresholdMiB: value };
      const persisted = saveGitLargeFilePreferences(next); setPreference(next);
      setFeedback(persisted ? text('提醒偏好已保存。', 'Warning preferences saved.') : text('仅本次会话生效：无法保存本机偏好。', 'Applied to this session only: local preferences could not be saved.'));
    }}>{text('保存提醒偏好', 'Save warning preferences')}</Button>
    {feedback ? <p role="status">{feedback}</p> : null}
  </fieldset>;
}
