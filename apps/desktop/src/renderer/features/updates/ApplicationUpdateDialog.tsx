import { useId } from 'react';
import appIcon from '../../../../build/icon.png';
import { VisibleApplicationError } from '../../ui/ApplicationErrorDialog.js';
import { Button } from '../../ui/Button.js';
import { ModalPortal } from '../../ui/ModalPortal.js';
import { ApplicationReleaseNotes } from './ApplicationReleaseNotes.js';
import { applicationUpdateLabel, canPrepareApplicationUpdate, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';
import './applicationUpdateDialog.css';

export function ApplicationUpdateDialog({ zh, update, disabled, onDismiss }: {
  zh: boolean;
  update: ApplicationUpdates;
  disabled: boolean;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const detailId = useId();
  const text = (cn: string, en: string) => zh ? cn : en;
  const state = update.state;
  const upcoming = hasApplicationUpdate(state);
  const version = upcoming ? state?.latestVersion : state?.currentVersion;
  const ready = upcoming && state?.phase === 'ready';
  const restartBusy = update.busy === 'restart';
  const locked = disabled || update.busy !== null;
  const preparing = state?.phase === 'preparing' || state?.phase === 'retrying';
  const failed = state?.phase === 'failed';
  const title = ready
    ? text(`新版 ${version} 已就绪`, `Version ${version} is ready`)
    : version ? `AstraGit ${version}` : text('应用更新', 'App updates');
  const detail = ready
    ? state.method === 'homebrew'
      ? text('重启后，AstraGit 会切换到已安装的新版本。', 'Restart AstraGit to switch to the installed version.')
      : text('AstraGit 会退出并完成更新，安装结束后自动重新打开。', 'AstraGit will close to install the update, then reopen automatically.')
    : upcoming && !failed ? state?.detail
    : update.checked && !failed && !update.error && update.busy !== 'check' ? text('当前已是最新版本。', 'You are up to date.') : null;
  const busyDetail = disabled ? text('请先完成当前 Git 操作。', 'Finish the current Git operation first.') : null;
  const failure = update.error || (failed ? { message: state.detail, details: state.failure?.technicalDetail } : null);

  const primary = ready
    ? <Button variant="primary" busy={restartBusy} disabled={locked} onClick={() => void update.perform('restart')}>
        {restartBusy ? applicationUpdateLabel(update, zh) : text('立即重启更新', 'Restart to update')}
      </Button>
    : canPrepareApplicationUpdate(state)
      ? <Button variant="primary" busy={update.busy === 'prepare'} disabled={locked} onClick={() => void update.perform('prepare')}>
          {state?.method === 'homebrew' ? text('开始更新', 'Start update') : text('后台下载更新', 'Download update')}
        </Button>
      : state?.phase === 'manual' || state?.phase === 'downloaded'
        ? <Button variant="primary" disabled={locked} onClick={() => void update.openDetails().then(opened => { if (opened) onDismiss(); })}>
            {text('查看安装方式', 'Installation options')}
          </Button>
        : failed || !upcoming ? <Button variant="primary" busy={update.busy === 'check'} disabled={locked} onClick={() => void update.perform('check')}>
            {update.busy === 'check' ? text('正在检查…', 'Checking…') : failed ? text('重新检查', 'Check again') : text('检查更新', 'Check for updates')}
          </Button> : null;

  return <ModalPortal role="dialog" aria-labelledby={titleId} aria-describedby={detail ? detailId : undefined}
    rootClassName="gitapp-update-dialog-portal" backdropClassName="gitapp-update-dialog-backdrop"
    onDismiss={onDismiss} dismissDisabled={restartBusy}>
    <div className="gitapp-update-dialog" data-modal-surface="dialog">
      <header className="gitapp-update-dialog-heading">
        <div className="gitapp-update-dialog-mark" aria-hidden="true">
          <img src={appIcon} alt="" width={60} height={60} />
        </div>
        <h2 id={titleId}>{title}</h2>
      </header>
      <div className="gitapp-update-dialog-body">
        {version ? <ApplicationReleaseNotes version={version} zh={zh} upcoming={upcoming} markdown={upcoming ? state?.releaseNotes : undefined} inDialog /> : null}
      </div>
      <footer className="gitapp-update-dialog-footer">
        {detail ? <p id={detailId} role="status">{detail}</p> : null}
        {preparing ? <progress max={1} value={state?.progress} aria-label={text('更新进度', 'Update progress')} aria-valuetext={state?.progressText} /> : null}
        {failure ? <div role="alert"><VisibleApplicationError error={failure} language={zh ? 'zh-CN' : 'en'} /></div> : null}
        {busyDetail ? <p role="status">{busyDetail}</p> : null}
        <div className="gitapp-update-dialog-actions">
          <Button variant="secondary" data-modal-initial-focus disabled={restartBusy} onClick={onDismiss}>
            {upcoming ? text('稍后', 'Later') : text('关闭', 'Close')}
          </Button>
          {primary}
        </div>
      </footer>
    </div>
  </ModalPortal>;
}
