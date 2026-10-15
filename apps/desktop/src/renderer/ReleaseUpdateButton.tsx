import { useEffect, useRef, useState } from 'react';
import type { ReleaseUpdateProgress, ReleaseUpdateStatus } from '@astragit/shared';

export function ReleaseUpdateButton(props: { zh: boolean; disabled?: boolean }) {
  const [update, setUpdate] = useState<ReleaseUpdateStatus | null>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [progress, setProgress] = useState<ReleaseUpdateProgress | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const label = (cn: string, en: string) => props.zh ? cn : en;
  useEffect(() => {
    if (!window.astraGit?.checkUpdate) return;
    let live = true;
    const check = () => void window.astraGit!.checkUpdate!().then(value => { if (live) setUpdate(value); }).catch(() => undefined);
    check(); const timer = setInterval(check, 4 * 60 * 60_000);
    const unsubscribe = window.astraGit.onUpdateProgress?.(value => { if (live) setProgress(value); });
    return () => { live = false; clearInterval(timer); unsubscribe?.(); };
  }, []);
  useEffect(() => { if (opened) dialog.current?.showModal(); else dialog.current?.close(); }, [opened]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(''); setProgress(null);
    try { await action(); }
    catch (reason) {
      setProgress(null);
      setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, ''));
    } finally { setBusy(false); }
  };
  if (!window.astraGit?.checkUpdate) return null;
  return <>
    <button type="button" className="gitapp-settings-trigger gitapp-update-trigger" disabled={props.disabled} onClick={() => setOpened(true)}>{update?.status === 'available' ? label('有可用更新', 'Update available') : label('应用更新', 'App updates')}</button>
    <dialog ref={dialog} className="gitapp-update-dialog" aria-labelledby="astragit-update-title" onCancel={event => { if (busy) event.preventDefault(); else setOpened(false); }}>
      <header><h2 id="astragit-update-title">AstraGit {label('更新', 'updates')}</h2><button type="button" disabled={busy} aria-label={label('关闭更新', 'Close updates')} onClick={() => setOpened(false)}>×</button></header>
      <p>{label('当前版本', 'Current version')} {update?.currentVersion ?? '…'}{update?.latestVersion ? ` · ${label('最新版本', 'Latest')} ${update.latestVersion}` : ''}</p>
      {update ? <p>{label('安装渠道', 'Install channel')}：{update.installMethod === 'homebrew' ? 'Homebrew · skylight-f/tap/astragit' : 'DMG'}</p> : null}
      <p>{update?.reason || (update?.status === 'available' ? label('有新版本可安装。', 'A new version is available.') : label('正在检查…', 'Checking…'))}</p>
      {progress ? <p role="status">{progress.phase === 'updating' ? label('正在同步 Homebrew…', 'Updating Homebrew…') : progress.phase === 'installing' ? label('Homebrew 正在安装…', 'Homebrew is installing…') : progress.phase === 'downloading' ? `${label('下载中', 'Downloading')} ${Math.floor(progress.receivedBytes / progress.totalBytes * 100)}%` : progress.phase === 'verifying' ? label('正在校验安装包…', 'Verifying package…') : label('安装包已校验。', 'Package verified.')}</p> : null}
      {error ? <p role="alert" className="source-git-error">{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={() => void run(async () => { const next = await window.astraGit!.checkUpdate!(); setUpdate(next); if (next.latestVersion !== update?.latestVersion) setPrepared(false); })}>{label('检查更新', 'Check for updates')}</button><button type="button" disabled={busy} onClick={() => void run(async () => { await window.astraGit!.openReleasePage!(); })}>{label('发布页', 'Releases')}</button>
        {update?.status === 'available' ? <button type="button" disabled={busy || props.disabled} onClick={() => void run(async () => { if (!prepared) { setUpdate(await window.astraGit!.downloadUpdate!()); setPrepared(true); } else if (update.automaticInstallEnabled) await window.astraGit!.installUpdate!(); else await window.astraGit!.openDownloadedUpdate!(); })}>{busy ? label('处理中…', 'Working…') : !prepared ? label('下载更新', 'Download update') : update.automaticInstallEnabled ? update.installMethod === 'homebrew' ? label('通过 Homebrew 升级并重启', 'Upgrade with Homebrew and restart') : label('重启并安装', 'Restart and install') : label('打开安装包', 'Open installer')}</button> : null}
      </footer>
    </dialog>
  </>;
}
