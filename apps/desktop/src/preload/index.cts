import { contextBridge, ipcRenderer } from 'electron';
import type { HomebrewUpdateIndicatorState } from '@astragit/shared';

const bootstrap = {
  getBootstrap: () => ipcRenderer.invoke('astragit:get-bootstrap') as Promise<{ baseUrl: string; apiToken: string; language: 'zh-CN' | 'en-US' } | null>,
  chooseDirectory: () => ipcRenderer.invoke('astragit:choose-directory') as Promise<string | null>,
};

// getBootstrap 通过 IPC 异步获取；preload 同步导出包装器供渲染层首屏使用。
contextBridge.exposeInMainWorld('astraGit', {
  getBootstrap: bootstrap.getBootstrap,
  chooseDirectory: bootstrap.chooseDirectory,
  choosePatchFile: () => ipcRenderer.invoke('astragit:patch-file-read'),
  savePatchFile: (request: { data: string; sha256: string; suggestedName: string }) => ipcRenderer.invoke('astragit:patch-file-save', request),
  saveSourceArchive: (request: unknown) => ipcRenderer.invoke('astragit:archive-file-save', request),
  cancelSourceArchive: (id: string) => ipcRenderer.invoke('astragit:archive-file-cancel', id),
  performFileAction: (request: { projectId: string; repositoryId: string; path: string; intent: 'open' | 'reveal' | 'edit-ignore-rule' }) => ipcRenderer.invoke('astragit:file-action', request),
  rendererReady: () => ipcRenderer.invoke('astragit:renderer-ready'),
  openUpdates: (language: 'zh-CN' | 'en-US') => ipcRenderer.invoke('astragit:update-open', language),
  performUpdateAction: (action: 'check' | 'prepare' | 'restart', language: 'zh-CN' | 'en-US') => ipcRenderer.invoke('astragit:update-action', action, language),
  getUpdateIndicator: () => ipcRenderer.invoke('astragit:update-indicator-get'),
  onUpdateIndicator: (listener: (state: HomebrewUpdateIndicatorState) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, state: HomebrewUpdateIndicatorState) => listener(state);
    ipcRenderer.on('astragit:update-indicator', callback);
    return () => ipcRenderer.removeListener('astragit:update-indicator', callback);
  },
});
