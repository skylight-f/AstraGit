import { FolderOpen } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { useEffect, useRef, useState } from 'react';
import type { ProjectDirectoryScan } from '@astragit/shared';
import type { DashboardClient } from '../../api/apiClient.js';
import { reportApplicationError, VisibleApplicationError } from '../../ui/ApplicationErrorDialog.js';
import { Button } from '../../ui/Button.js';
import { FormDialog } from '../../ui/FormDialog.js';

type Scan =
  | { phase: 'scanning'; root: string }
  | { phase: 'failed'; root: string; error: unknown }
  | ({ phase: 'ready' } & ProjectDirectoryScan);

export function ProjectFolderImport({ client, zh, disabled, onImported }: {
  client: DashboardClient;
  zh: boolean;
  disabled: boolean;
  onImported(): Promise<unknown>;
}) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<unknown>(null);
  const [added, setAdded] = useState<number | null>(null);
  const scanController = useRef<AbortController | null>(null);
  useEffect(() => () => scanController.current?.abort(), []);
  const text = (cn: string, en: string) => zh ? cn : en;
  const language = zh ? 'zh-CN' : 'en';
  const items = scan?.phase === 'ready' ? scan.items : [];
  const available = items.filter(item => !item.alreadyAdded);

  async function scanFolder(root: string) {
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    setScan({ phase: 'scanning', root });
    setSelected(new Set());
    setImportError(null);
    setAdded(null);
    try {
      const result = await client.scanProjectDirectory(root, controller.signal);
      if (controller.signal.aborted) return;
      setSelected(new Set(result.items.filter(item => !item.alreadyAdded).map(item => item.localPath)));
      setScan({ ...result, phase: 'ready' });
    } catch (error) {
      if (!controller.signal.aborted) setScan({ phase: 'failed', root, error });
    }
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const root = await window.astraGit?.chooseDirectory?.();
      if (root) void scanFolder(root);
    } catch (error) {
      reportApplicationError(error, { language });
    } finally {
      setPicking(false);
    }
  }

  function close() {
    scanController.current?.abort();
    setScan(null);
  }

  async function addProjects() {
    if (scan?.phase !== 'ready' || selected.size === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await client.importProjects(scan.root, [...selected]);
      await onImported();
      setAdded(result.added);
      close();
    } catch (error) {
      setImportError(error);
    } finally {
      setImporting(false);
    }
  }

  return <div className="gitapp-folder-import">
    {added !== null ? <span className="gitapp-folder-import-notice" role="status">
      {added === 0 ? text('所选项目已在列表中', 'Selected projects are already in the list') : text(`已添加 ${added} 个项目`, `Added ${added} ${added === 1 ? 'project' : 'projects'}`)}
    </span> : null}
    <Button size="compact" disabled={disabled || !window.astraGit?.chooseDirectory} busy={picking} onClick={() => void pickFolder()}>
      <FolderOpen size={16} aria-hidden="true" />
      {text('扫描文件夹…', 'Scan folder…')}
    </Button>
    {scan ? <FormDialog
      className="gitapp-folder-scan"
      title={text('扫描 Git 仓库', 'Scan for Git repositories')}
      zh={zh}
      busy={importing}
      submitDisabled={scan.phase !== 'ready' || selected.size === 0}
      submitLabel={selected.size > 0 ? text(`添加 ${selected.size} 个项目`, `Add ${selected.size} ${selected.size === 1 ? 'project' : 'projects'}`) : text('添加项目', 'Add projects')}
      onClose={close}
      onSubmit={event => { event.preventDefault(); void addProjects(); }}
    >
      <div className="gitapp-folder-scan-location">
        <FolderOpen size={20} aria-hidden="true" />
        <span title={scan.root}>{scan.root}</span>
        {scan.phase !== 'scanning' ? <Button size="compact" busy={picking} onClick={() => void pickFolder()}>{text('更换文件夹…', 'Choose another folder…')}</Button> : null}
      </div>
      {scan.phase === 'scanning' ? <p role="status">{text('正在查找 Git 仓库…', 'Finding Git repositories…')}</p> : null}
      {scan.phase === 'failed' ? <VisibleApplicationError error={scan.error} language={language} /> : null}
      {scan.phase === 'ready' && scan.skipped > 0 ? <p className="gitapp-folder-scan-note" role="status">
        {text(`已跳过 ${scan.skipped} 个无法读取的目录或仓库。`, `Skipped ${scan.skipped} unreadable folders or repositories.`)}
      </p> : null}
      {scan.phase === 'ready' && items.length === 0 ? <p role="status">{text('没有找到可添加的 Git 仓库。', 'No Git repositories found to add.')}</p> : null}
      {items.length > 0 ? <>
        <div className="gitapp-folder-scan-selection">
          <label>
            <input
              type="checkbox"
              disabled={available.length === 0}
              checked={available.length > 0 && selected.size === available.length}
              ref={input => { if (input) input.indeterminate = selected.size > 0 && selected.size < available.length; }}
              onChange={event => setSelected(event.target.checked ? new Set(available.map(item => item.localPath)) : new Set())}
            />
            {text('全选可添加项目', 'Select all new projects')}
          </label>
          <span role="status">{text(`已选 ${selected.size} / ${available.length}`, `${selected.size} of ${available.length} selected`)}</span>
        </div>
        <ul className="gitapp-folder-scan-results">
          {items.map(item => <li key={item.localPath}>
            <label className="gitapp-folder-scan-item">
              <input type="checkbox" disabled={item.alreadyAdded} checked={item.alreadyAdded || selected.has(item.localPath)} onChange={event => {
                const checked = event.target.checked;
                setSelected(previous => {
                  const next = new Set(previous);
                  if (checked) next.add(item.localPath);
                  else next.delete(item.localPath);
                  return next;
                });
              }} />
              <span className="gitapp-folder-scan-name">
                <strong>{item.name}</strong>
                <small title={item.localPath}>{item.localPath}</small>
              </span>
              {item.alreadyAdded ? <span className="gitapp-folder-scan-existing">{text('已添加', 'Already added')}</span> : null}
            </label>
          </li>)}
        </ul>
      </> : null}
      {importError ? <VisibleApplicationError error={importError} language={language} /> : null}
    </FormDialog> : null}
  </div>;
}
