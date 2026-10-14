import { contextBridge, ipcRenderer } from 'electron';
import type { ReleaseUpdateProgress } from '@astragit/shared';

const bootstrap = {
  getBootstrap: () => ipcRenderer.invoke('astragit:get-bootstrap') as Promise<{ baseUrl: string; apiToken: string; language: 'zh-CN' | 'en-US' } | null>,
  chooseDirectory: () => ipcRenderer.invoke('astragit:choose-directory') as Promise<string | null>,
};

// getBootstrap 通过 IPC 异步获取；preload 同步导出包装器供渲染层首屏使用。
contextBridge.exposeInMainWorld('astraGit', {
  getBootstrap: bootstrap.getBootstrap,
  chooseDirectory: bootstrap.chooseDirectory,
  rendererReady: () => ipcRenderer.invoke('astragit:renderer-ready'),
  checkUpdate: () => ipcRenderer.invoke('astragit:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('astragit:update-download'),
  installUpdate: () => ipcRenderer.invoke('astragit:update-install'),
  openDownloadedUpdate: () => ipcRenderer.invoke('astragit:update-open'),
  openReleasePage: () => ipcRenderer.invoke('astragit:update-release-page'),
  onUpdateProgress: (listener: (progress: ReleaseUpdateProgress) => void) => {
    const callback = (_event: Electron.IpcRendererEvent, progress: ReleaseUpdateProgress) => listener(progress);
    ipcRenderer.on('astragit:update-progress', callback);
    return () => ipcRenderer.removeListener('astragit:update-progress', callback);
  },
});
