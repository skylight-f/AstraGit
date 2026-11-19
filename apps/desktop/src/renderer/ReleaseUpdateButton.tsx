import { applicationUpdateLabel, canPrepareApplicationUpdate, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';

/** 标题栏仅在检测到新版本时提供更新入口。 */
export function ReleaseUpdateButton(props: { zh: boolean; update: ApplicationUpdates; disabled?: boolean; onInspect: () => void }) {
  const { update } = props;
  if (!update.supported || !hasApplicationUpdate(update.state)) return null;
  const label = applicationUpdateLabel(update, props.zh);
  const action = update.state?.phase === 'ready' ? 'restart' : canPrepareApplicationUpdate(update.state) ? 'prepare' : null;
  return <button type="button" className="gitapp-update-trigger" data-update-phase={update.state?.phase}
    disabled={action !== null && (props.disabled || update.busy !== null)} title={`AstraGit ${update.state?.latestVersion} · ${label}`}
    onClick={() => {
      if (!action) props.onInspect();
      else void update.perform(action).then(accepted => { if (!accepted) props.onInspect(); });
    }}>{label}</button>;
}
