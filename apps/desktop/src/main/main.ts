import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGitServer, type RunningGitServer } from '@astragit/git-server';
import { resolveCliSearchPath } from '@astragit/ai-runtime';
import { createReleaseUpdateService } from './releaseUpdateService.js';
import { applicationIdentity } from './applicationIdentity.js';

let mainWindow: BrowserWindow | null = null;
let creatingWindow: Promise<void> | null = null;
let gitServer: RunningGitServer | null = null;
let bootstrapToken = '';
let shuttingDown = false;
// Set identity before readiness: Electron uses this name for macOS Safe Storage
// as well as browser storage. Keep development and installed credentials apart.
const { development, name, dataDirectory } = applicationIdentity({
  packaged: app.isPackaged,
  rendererUrl: process.env.VITE_DEV_SERVER_URL,
  appPath: app.getAppPath(),
  appDataPath: app.getPath('appData'),
  userDataDirectory: process.env.ASTRAGIT_USER_DATA_DIR,
});
app.setName(name);
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
app.setPath('sessionData', dataDirectory);
// One Main/server owns each data directory, including after window close.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.exit(0);
const userDataPath = () => dataDirectory;
if (development) {
  // A normal quit drains requests and storage before the dev supervisor restarts.
  process.on('message', message => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'astragit:dev-stop') app.quit();
  });
  process.on('disconnect', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  process.on('SIGINT', () => app.quit());
}
const releaseUpdate = createReleaseUpdateService({
  appPath: resolve(process.execPath, '../../..'), executablePath: process.execPath, dataDirectory,
  version: app.getVersion(), packaged: app.isPackaged,
  // 使用 Chromium 网络栈，遵循 macOS 系统代理；避免 Node fetch 绕过桌面网络设置。
  fetch: (input, init) => net.fetch(input as string, init),
  onProgress: progress => mainWindow?.webContents.send('astragit:update-progress', progress),
  confirmRestart: async () => {
    const result = await dialog.showMessageBox(mainWindow!, { type: 'question', buttons: ['取消', '退出并安装'], defaultId: 0, cancelId: 0, title: '安装 AstraGit 更新', message: '更新已校验。退出 AstraGit 后安装并重新打开？', detail: '请先结束当前 Git 操作。提交草稿、项目配置和用户数据会保留。' });
    return result.response === 1;
  },
  quit: () => app.quit(),
});

function applicationIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'branding/icon.png') : join(app.getAppPath(), 'build/icon.png');
}

function applyApplicationDockIcon(): void {
  if (process.platform !== 'darwin') return;
  const icon = nativeImage.createFromPath(applicationIconPath());
  if (icon.isEmpty()) throw new Error('AstraGit 应用图标无法读取。');
  const dock = app.dock;
  if (!dock) throw new Error('AstraGit 无法访问 macOS Dock。');
  // 与 Astra 一致：直接使用透明 PNG，保留几何轮廓，避免系统额外底板和缩放。
  dock.setIcon(icon);
}

async function ensureServer(): Promise<{ baseUrl: string; apiToken: string }> {
  if (gitServer) return { baseUrl: gitServer.baseUrl, apiToken: gitServer.apiToken };
  const dataDirectory = userDataPath();
  bootstrapToken = randomBytes(24).toString('hex');
  gitServer = await startGitServer({
    dataDirectory,
    projectRoot: process.env.ASTRAGIT_PROJECT_ROOT ?? dataDirectory,
    apiToken: bootstrapToken,
    fetch: (input, init) => net.fetch(input as string, init),
    codexHome: process.env.ASTRAGIT_CODEX_HOME ?? join(dataDirectory, 'codex'),
    codexNativeEnabled: process.env.ASTRAGIT_CODEX_ENABLED !== '0',
    currentCodexRuntimeCommandPath: () => process.env.ASTRAGIT_CODEX_COMMAND ?? 'codex',
  });
  return { baseUrl: gitServer.baseUrl, apiToken: gitServer.apiToken };
}

async function createWindow(): Promise<void> {
  if (creatingWindow) return creatingWindow;
  creatingWindow = loadMainWindow().finally(() => { creatingWindow = null; });
  return creatingWindow;
}

async function loadMainWindow(): Promise<void> {
  const config = await ensureServer();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'AstraGit',
    icon: applicationIconPath(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const window = mainWindow;
  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });

  // 必须在加载页面前注册 IPC，避免渲染层首屏 invoke 早于 handler。
  ipcMain.removeHandler('astragit:get-bootstrap');
  ipcMain.removeHandler('astragit:choose-directory');

  ipcMain.handle('astragit:get-bootstrap', () => ({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    language: app.getLocale().startsWith('zh') ? 'zh-CN' : 'en-US',
  }));

  ipcMain.handle('astragit:choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return resolve(result.filePaths[0]);
  });

  const handle = (name: string, action: () => unknown) => {
    ipcMain.removeHandler(name);
    ipcMain.handle(name, event => { if (event.sender !== mainWindow?.webContents) throw new Error('更新请求来源无效。'); return action(); });
  };
  handle('astragit:update-check', releaseUpdate.check);
  handle('astragit:update-download', releaseUpdate.prepare);
  handle('astragit:update-install', releaseUpdate.install);
  handle('astragit:update-open', async () => { const error = await shell.openPath(await releaseUpdate.downloaded()); if (error) throw new Error(error); });
  handle('astragit:update-release-page', () => shell.openExternal('https://github.com/skylight-f/AstraGit/releases'));
  handle('astragit:renderer-ready', async () => {
    mkdirSync(join(dataDirectory, 'updates'), { recursive: true, mode: 0o700 });
    await writeFile(join(dataDirectory, 'updates/app-ready.json'), JSON.stringify({ pid: process.pid, version: app.getVersion(), readyAt: new Date().toISOString() }), { mode: 0o600 });
    if (development && process.connected) process.send?.({ type: 'astragit:dev-ready', baseUrl: config.baseUrl, applicationName: app.getName() });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//iu.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow?.webContents.getURL()) event.preventDefault(); });
  await mainWindow.loadURL(await resolveRendererUrl());
}

async function resolveRendererUrl(): Promise<string> {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) return process.env.VITE_DEV_SERVER_URL;
  return pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href;
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  applyApplicationDockIcon();
  // Finder does not inherit nvm/Homebrew/pnpm paths. Git hooks use this PATH too.
  process.env.PATH = await resolveCliSearchPath();
  if (!existsSync(userDataPath())) mkdirSync(userDataPath(), { recursive: true });
  await createWindow();
  app.on('activate', () => {
    if (!shuttingDown && BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  console.error('[AstraGit] 启动失败', error);
  app.exit(1);
});

app.on('second-instance', () => {
  if (shuttingDown) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (app.isReady()) void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (!gitServer && !shuttingDown) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  const server = gitServer!;
  gitServer = null;
  // Quit was already interrupted for asynchronous cleanup. Exit after the
  // service and SQLite have closed instead of re-entering native quit events.
  void server.close().then(
    () => app.exit(0),
    (error: unknown) => {
      console.error('[AstraGit] 退出清理失败', error);
      app.exit(1);
    },
  );
});
