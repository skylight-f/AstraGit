import { VisibleApplicationError } from './ui/ApplicationErrorDialog.js';
import { Button } from './ui/Button.js';
import { applicationUpdateLabel, canPrepareApplicationUpdate, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';

export function ApplicationUpdateSettings(props: { zh: boolean; update: ApplicationUpdates; disabled: boolean }) {
  const { zh, update } = props;
  const text = (cn: string, en: string) => zh ? cn : en;
  const state = update.state;
  const downloading = state?.phase === 'preparing' || state?.phase === 'retrying';
  const locked = props.disabled || update.busy !== null;
  const status = update.busy === 'check' && !downloading ? text('正在检查更新…', 'Checking for updates…')
    : state?.phase === 'failed' ? text('更新未完成', 'Update incomplete')
    : hasApplicationUpdate(state) ? `${applicationUpdateLabel(update, zh)} · ${state!.latestVersion}`
    : update.checked ? text('当前已是最新版本', 'You are up to date')
    : state ? text('未发现待安装更新', 'No update is waiting to install') : text('正在读取更新状态…', 'Loading update status…');
  const detail = state?.phase === 'ready' ? text('更新已下载并通过校验，点击“重启并更新”后安装。', 'The update is downloaded and verified. Choose Restart and update to install it.')
    : state?.phase === 'preparing' ? text('正在后台下载并校验更新，你可以继续工作。', 'The update is downloading and being verified in the background. You can keep working.')
    : state?.phase === 'retrying' ? text('下载暂时中断，稍后会自动重试。', 'The download was interrupted and will retry automatically.')
    : state?.phase === 'manual' ? text('此版本需要手动安装，请查看安装方式。', 'This version requires manual installation. See Installation options.')
    : state?.phase === 'downloaded' ? text('安装包已下载并通过校验，请查看安装方式完成替换。', 'The installer is downloaded and verified. See Installation options to replace the app.')
    : state?.phase === 'available' ? text('发现新版本，可在后台下载更新。', 'A new version is available to download in the background.') : null;
  return <section className="gitapp-settings-section gitapp-update-settings" aria-label={text('应用更新', 'App updates')}>
    <header><h3>{text('应用更新', 'App updates')}</h3><span>AstraGit {state?.currentVersion ?? '—'}</span></header>
    <p>{text('自动检查新版本并在后台下载，下载完成后由你决定何时重启更新。', 'New versions are checked and downloaded in the background. Choose when to restart once the update is ready.')}</p>
    {!update.supported ? <p>{text('当前环境未连接桌面更新服务。', 'The desktop update service is unavailable in this environment.')}</p> : <>
      <div className="gitapp-update-status" role="status">
        <strong>{status}</strong>
        {state?.phase === 'failed' ? <VisibleApplicationError error={{ message: state.detail, details: state.failure?.technicalDetail }} language={zh ? 'zh-CN' : 'en'} /> : detail ? <p>{detail}</p> : null}
        {downloading ? <progress aria-label={text('更新下载进度', 'Update download progress')} max={1} value={state?.phase === 'preparing' && state.progress !== undefined ? state.progress : undefined} /> : null}
      </div>
      {update.error ? <p role="alert"><VisibleApplicationError error={update.error} language={zh ? 'zh-CN' : 'en'} /></p> : null}
      {props.disabled ? <p>{text('当前 Git 操作结束后可检查或安装更新。', 'Finish the current Git operation before checking or installing updates.')}</p> : null}
      <footer>
        <Button variant="secondary" disabled={locked || downloading} onClick={() => void update.perform('check')}>{text('检查更新', 'Check for updates')}</Button>
        {state?.phase === 'ready' ? <Button disabled={locked} onClick={() => void update.perform('restart')}>{text('重启并更新', 'Restart and update')}</Button>
          : canPrepareApplicationUpdate(state) ? <Button disabled={locked} onClick={() => void update.perform('prepare')}>{text('后台下载更新', 'Download in background')}</Button> : null}
        {hasApplicationUpdate(state) || state?.phase === 'failed' ? <Button variant="secondary" disabled={locked} onClick={() => void update.openDetails()}>{state?.phase === 'manual' || state?.phase === 'downloaded' ? text('查看安装方式', 'Installation options') : text('更新详情', 'Update details')}</Button> : null}
      </footer>
    </>}
  </section>;
}
