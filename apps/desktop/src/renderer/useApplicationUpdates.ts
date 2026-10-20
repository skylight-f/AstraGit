import { useCallback, useEffect, useRef, useState } from 'react';
import { compareReleaseVersions, type HomebrewUpdateIndicatorState } from '@astragit/shared';

export type ApplicationUpdateAction = 'check' | 'prepare' | 'restart';
export interface ApplicationUpdates {
  supported: boolean;
  state: HomebrewUpdateIndicatorState | null;
  busy: ApplicationUpdateAction | 'details' | null;
  error: unknown;
  checked: boolean;
  perform(action: ApplicationUpdateAction): Promise<boolean>;
  openDetails(): Promise<boolean>;
}

/** 更新调度、下载与安装由 Main 唯一控制；Renderer 只订阅状态及转发用户动作。 */
export function useApplicationUpdates(language: 'zh-CN' | 'en-US', blocked: boolean): ApplicationUpdates {
  const [state, setState] = useState<HomebrewUpdateIndicatorState | null>(null);
  const [busy, setBusy] = useState<ApplicationUpdates['busy']>(null);
  const [error, setError] = useState<unknown>(null);
  const [checked, setChecked] = useState(false);
  const inFlight = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.astraGit?.onUpdateIndicator?.(value => { revision.current += 1; if (live) setState(value); });
    const requestedAt = revision.current;
    void window.astraGit?.getUpdateIndicator?.().then(value => {
      if (live && revision.current === requestedAt) setState(value);
    }).catch(reason => { if (live) setError(reason); });
    return () => { live = false; unsubscribe?.(); };
  }, []);

  const perform = useCallback(async (action: ApplicationUpdateAction) => {
    if (blocked || inFlight.current || !window.astraGit?.performUpdateAction) return false;
    inFlight.current = true; setBusy(action); setError(null);
    try {
      const requestedAt = revision.current;
      const value = await window.astraGit.performUpdateAction(action, language);
      if (!value) throw new Error(language === 'zh-CN' ? '更新服务尚未就绪，请稍后重试。' : 'The update service is not ready. Try again shortly.');
      // 动作期间已收到推送时，以最新推送为准，避免晚到的 IPC 快照回退下载进度。
      if (revision.current === requestedAt) setState(value);
      if (action === 'check' && value.phase !== 'failed') setChecked(true);
      return value.phase !== 'failed';
    } catch (reason) { setError(reason); return false; }
    finally { inFlight.current = false; setBusy(null); }
  }, [blocked, language]);

  const openDetails = useCallback(async () => {
    if (blocked || inFlight.current || !window.astraGit?.openUpdates) return false;
    inFlight.current = true; setBusy('details'); setError(null);
    try { await window.astraGit.openUpdates(language); return true; }
    catch (reason) { setError(reason); return false; }
    finally { inFlight.current = false; setBusy(null); }
  }, [blocked, language]);

  return { supported: Boolean(window.astraGit?.performUpdateAction), state, busy, error, checked, perform, openDetails };
}

export function hasApplicationUpdate(state: HomebrewUpdateIndicatorState | null): boolean {
  if (!state?.latestVersion || state.phase === 'idle') return false;
  try { return compareReleaseVersions(state.latestVersion, state.currentVersion) > 0; }
  catch { return false; }
}

export function canPrepareApplicationUpdate(state: HomebrewUpdateIndicatorState | null): boolean {
  return state?.phase === 'available' || (state?.phase === 'failed' && state.failure?.canRetry === true && ['prepare', 'download'].includes(state.failure.step));
}

export function applicationUpdateLabel(update: Pick<ApplicationUpdates, 'state' | 'busy'>, zh: boolean): string {
  const text = (cn: string, en: string) => zh ? cn : en;
  if (update.busy === 'restart') return text('正在安装更新…', 'Installing update…');
  const state = update.state;
  if (state?.phase === 'ready') return text('重启并更新', 'Restart and update');
  if (state?.phase === 'preparing') {
    const progress = state.progress !== undefined && Number.isFinite(state.progress) ? ` ${Math.floor(Math.min(1, Math.max(0, state.progress)) * 100)}%` : '';
    return text('正在下载', 'Downloading') + progress;
  }
  if (state?.phase === 'retrying') return text('等待重试下载', 'Waiting to retry');
  if (state?.phase === 'downloaded') return text('安装包已下载', 'Installer downloaded');
  if (state?.phase === 'manual') return text('有可用更新', 'Update available');
  if (state?.phase === 'failed') return text('更新未完成', 'Update incomplete');
  return text('更新', 'Update');
}
