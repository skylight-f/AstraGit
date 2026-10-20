import { applicationUpdateLabel, canPrepareApplicationUpdate, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';

/** 常规更新入口在设置；这里只显示已确认的新版本与准备进度。 */
export function ReleaseUpdateButton(props: { zh: boolean; update: ApplicationUpdates; disabled?: boolean; onInspect: () => void }) {
  const { update } = props;
  if (!update.supported || !hasApplicationUpdate(update.state)) return null;
  const label = applicationUpdateLabel(update, props.zh);
  return <button type="button" className="gitapp-settings-trigger gitapp-update-trigger" data-update-phase={update.state?.phase}
    disabled={props.disabled || update.busy !== null} title={`AstraGit ${update.state?.latestVersion} · ${label}`}
    onClick={() => {
      const action = update.state?.phase === 'ready' ? 'restart' : canPrepareApplicationUpdate(update.state) ? 'prepare' : null;
      if (!action) props.onInspect();
      else void update.perform(action).then(accepted => { if (!accepted) props.onInspect(); });
    }}>{label}</button>;
}
