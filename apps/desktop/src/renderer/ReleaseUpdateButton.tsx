import { useEffect, useState } from 'react';
import type { HomebrewUpdateIndicatorState } from '@astragit/shared';
import { reportApplicationError } from './ui/ApplicationErrorDialog.js';

export function ReleaseUpdateButton(props: { zh: boolean; disabled?: boolean }) {
  const [state, setState] = useState<HomebrewUpdateIndicatorState | null>(null);
  useEffect(() => {
    let live = true;
    void window.astraGit?.getUpdateIndicator?.().then(value => { if (live) setState(value); });
    const unsubscribe = window.astraGit?.onUpdateIndicator?.(value => { if (live) setState(value); });
    return () => { live = false; unsubscribe?.(); };
  }, []);
  if (!window.astraGit?.openUpdates) return null;
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const label = state?.phase === 'ready' ? text('更新已下载，等待重启', 'Update ready to restart')
    : state?.phase === 'downloaded' ? text('安装包已下载', 'Installer downloaded')
    : state?.phase === 'preparing' ? text('正在下载更新', 'Downloading update')
    : state?.phase === 'retrying' ? text('更新等待重试', 'Update waiting to retry')
    : state?.phase === 'available' || state?.phase === 'manual' ? text('有可用更新', 'Update available')
    : text('应用更新', 'App updates');
  return <button type="button" className="gitapp-settings-trigger gitapp-update-trigger" disabled={props.disabled}
    onClick={() => void window.astraGit!.openUpdates!(props.zh ? 'zh-CN' : 'en-US').catch(error => reportApplicationError(error, { language: props.zh ? 'zh-CN' : 'en' }))}>
    {label}
  </button>;
}
