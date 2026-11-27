import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { applicationUpdateLabel, hasApplicationUpdate, type ApplicationUpdates } from './useApplicationUpdates.js';

export function ReleaseUpdateButton({ zh, update, open, onInspect }: { zh: boolean; update: ApplicationUpdates; open: boolean; onInspect: () => void }) {
  if (!update.supported) return null;
  const upcoming = hasApplicationUpdate(update.state);
  const label = zh ? '应用更新' : 'App updates';
  const title = upcoming ? `AstraGit ${update.state?.latestVersion} · ${applicationUpdateLabel(update, zh)}` : label;
  return <button type="button" className="gitapp-rail-update" data-update-phase={update.state?.phase} data-update-available={upcoming || undefined}
    aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={title} onClick={onInspect}>
    <DownloadSimpleIcon size={18} aria-hidden="true" />
  </button>;
}
