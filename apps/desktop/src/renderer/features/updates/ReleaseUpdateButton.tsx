import { applicationUpdateLabel, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';

/** 标题栏仅在检测到新版本时提供更新入口。 */
export function ReleaseUpdateButton(props: { zh: boolean; update: ApplicationUpdates; onInspect: () => void }) {
  const { update } = props;
  if (!update.supported || !hasApplicationUpdate(update.state)) return null;
  const label = applicationUpdateLabel(update, props.zh);
  return <button type="button" className="gitapp-update-trigger" data-update-phase={update.state?.phase}
    title={`AstraGit ${update.state?.latestVersion} · ${label}`} onClick={props.onInspect}>
    {props.zh ? '查看更新' : 'View update'}
  </button>;
}
