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
  rendererReady: () => ipcRenderer.invoke('astragit:renderer-ready'),
  openUpdates: (language: 'zh-CN' | 'en-US') => ipcRenderer.invoke('astragit:update-open', language),
  getUpdateIndicator: () => ipcRenderer.invoke('astragit:update-indicator-get'),
  onUpdateIndicator: (listener: (state: HomebrewUpdateIndicatorState) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, state: HomebrewUpdateIndicatorState) => listener(state);
    ipcRenderer.on('astragit:update-indicator', callback);
    return () => ipcRenderer.removeListener('astragit:update-indicator', callback);
  },
});
