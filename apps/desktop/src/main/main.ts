import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, powerMonitor, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGitServer, type RunningGitServer } from '@astragit/git-server';
import { resolveCliSearchPath } from '@astragit/ai-runtime';
import { createReleaseUpdateService } from './releaseUpdateService.js';
import { applicationIdentity } from './applicationIdentity.js';
import { createRepositoryFileLauncher } from './repositoryFileLauncher.js';
import { createPatchFileAccess } from './patchFileAccess.js';
import { createArchiveFileAccess } from './archiveFileAccess.js';
import { createHomebrewUpdateService } from './homebrewUpdateService.js';
import { createHomebrewUpdateController, type HomebrewUpdateController } from './homebrewUpdateController.js';
import { createAutomaticUpdateScheduler, type AutomaticUpdateScheduler } from './automaticUpdateScheduler.js';
import { execFile } from './releaseVerification.js';
import { startSystemProxyBridge, type SystemProxyBridge } from './systemProxyBridge.js';
import { installSystemProxyEnvironment, type InstalledSystemProxyEnvironment } from './systemProxyEnvironment.js';

let mainWindow: BrowserWindow | null = null;
let archiveFiles: ReturnType<typeof createArchiveFileAccess> | null = null;
let creatingWindow: Promise<void> | null = null;
let gitServer: RunningGitServer | null = null;
let serverInitialization: Promise<RunningGitServer> | null = null;
let bootstrapToken = '';
let shuttingDown = false;
let developmentStopRequested = false;
let setupQuitConfirmed = false;
let setupQuitPromptOpen = false;
let homebrewUpdates: HomebrewUpdateController | null = null;
let automaticUpdates: AutomaticUpdateScheduler | null = null;
let systemProxy: SystemProxyBridge | null = null;
let proxyEnvironment: InstalledSystemProxyEnvironment | null = null;
let networkInitialization: Promise<void> | null = null;
let updateSetup: Promise<void> | null = null;
let servicesClosing: Promise<void> | null = null;
let completeUpdateInitialization: () => void = () => {};
const updateInitialization = new Promise<void>((resolveReady) => { completeUpdateInitialization = resolveReady; });
let updateLanguage: 'zh-CN' | 'en-US' = 'zh-CN';
let upgradeHandoff = false;
let pendingUpgrade: { activate: () => void | Promise<void>; resolve: (accepted: boolean) => void; reject: (error: unknown) => void; result: Promise<boolean> } | null = null;
let activatingUpgrade = false;
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
    if (message && typeof message === 'object' && 'type' in message && message.type === 'astragit:dev-stop') { developmentStopRequested = true; app.quit(); }
  });
  process.on('disconnect', () => { developmentStopRequested = true; app.quit(); });
  process.on('SIGTERM', () => { developmentStopRequested = true; app.quit(); });
  process.on('SIGINT', () => { developmentStopRequested = true; app.quit(); });
}
const releaseUpdate = createReleaseUpdateService({
  appPath: resolve(process.execPath, '../../..'), executablePath: process.execPath, dataDirectory,
  version: app.getVersion(), packaged: app.isPackaged,
  // 使用 Chromium 网络栈，遵循 macOS 系统代理；避免 Node fetch 绕过桌面网络设置。
  fetch: (input, init) => net.fetch(input as string, init),
  // 下载进度由唯一更新控制器通过 download 回调接收。
  onProgress: () => {},
  confirmRestart: confirmUpdateRestart,
  quit: () => app.quit(),
  openDownloadedArtifact: async (path) => {
    await execFile(nativeUpdateProgressHelperPath(), ['--quarantine-download', path], { timeout: 10_000 });
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
});

function nativeUpdateProgressHelperPath(): string {
  const root = app.getAppPath();
  return basename(root) === 'app.asar'
    ? join(dirname(root), 'app.asar.unpacked/dist/native/AstraGitUpdateProgress')
    : join(root, 'dist/native/AstraGitUpdateProgress');
}

async function confirmUpdateRestart(): Promise<boolean> {
  const zh = updateLanguage === 'zh-CN';
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question', buttons: zh ? ['取消', '立即重启'] : ['Cancel', 'Restart Now'], defaultId: 0, cancelId: 0,
    title: zh ? '重启 AstraGit' : 'Restart AstraGit',
    message: zh ? '结束当前工作并重启以启用更新？' : 'Finish current work and restart to apply the update?',
    detail: zh ? '请先结束当前 Git 操作。提交草稿、项目配置和用户数据会保留。' : 'Finish active Git operations first. Commit drafts, projects and user data will be retained.',
  });
  return result.response === 1;
}

async function initializeUpdates(): Promise<void> {
  updateLanguage = app.getLocale().startsWith('zh') ? 'zh-CN' : 'en-US';
  homebrewUpdates = createHomebrewUpdateController({
    helperPath: nativeUpdateProgressHelperPath(), language: () => updateLanguage,
    currentVersion: app.getVersion(), loadUpdateStatus: releaseUpdate.check, direct: releaseUpdate,
    homebrew: createHomebrewUpdateService({ currentAppPath: resolve(process.execPath, '../../..'), currentAppVersion: app.getVersion(), bundleId: 'com.astragit.desktop', testMode: development }),
    openDownloadPage: async (value) => {
      const url = new URL(value);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/skylight-f/AstraGit/releases')) throw new Error('更新页面来源无效。');
      await shell.openExternal(url.toString());
    },
    canInstall: () => { if (development) throw new Error('开发应用不安装正式更新。'); if (gitServer?.hasActiveRepositorySetup()) throw new Error('仓库正在创建，请等待完成或停止任务后再更新。'); },
    onInstallReady: (activate) => {
      if (shuttingDown) return Promise.resolve(false);
      if (pendingUpgrade) return pendingUpgrade.result;
      let accept: (value: boolean) => void = () => {};
      let fail: (error: unknown) => void = () => {};
      const result = new Promise<boolean>((resolveDecision, rejectDecision) => { accept = resolveDecision; fail = rejectDecision; });
      pendingUpgrade = { activate, resolve: accept, reject: fail, result };
      setImmediate(() => app.quit());
      return result;
    },
  });
  if (!development) {
    automaticUpdates = createAutomaticUpdateScheduler({
      statePath: join(dataDirectory, 'updates/automatic-update-state.json'),
      intervalMs: 60 * 60_000, initialDelayMs: 15_000, controller: homebrewUpdates,
      onIndicatorChange: (state) => mainWindow?.webContents.send('astragit:update-indicator', state),
      notifyReady: () => false,
    });
    await automaticUpdates.start();
    powerMonitor.on('resume', () => automaticUpdates?.checkIfDue());
  } else {
    homebrewUpdates.onIndicatorState((state) => mainWindow?.webContents.send('astragit:update-indicator', state));
  }
  mainWindow?.webContents.send('astragit:update-indicator', homebrewUpdates.getIndicatorState());
}

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
  await ensureSystemProxy();
  if (shuttingDown) throw new Error('AstraGit 正在退出。');
  if (gitServer) return { baseUrl: gitServer.baseUrl, apiToken: gitServer.apiToken };
  const dataDirectory = userDataPath();
  bootstrapToken = randomBytes(24).toString('hex');
  serverInitialization ??= startGitServer({
    dataDirectory,
    projectRoot: process.env.ASTRAGIT_PROJECT_ROOT ?? dataDirectory,
    apiToken: bootstrapToken,
    fetch: (input, init) => net.fetch(input as string, init),
    codexHome: process.env.ASTRAGIT_CODEX_HOME ?? join(dataDirectory, 'codex'),
    codexNativeEnabled: process.env.ASTRAGIT_CODEX_ENABLED !== '0',
    currentCodexRuntimeCommandPath: () => process.env.ASTRAGIT_CODEX_COMMAND ?? 'codex',
  });
  gitServer = await serverInitialization;
  return { baseUrl: gitServer.baseUrl, apiToken: gitServer.apiToken };
}

function ensureSystemProxy(): Promise<void> {
  networkInitialization ??= (async () => {
    await session.defaultSession.setProxy({ mode: 'system' });
    systemProxy = await startSystemProxyBridge({ resolveProxy: url => session.defaultSession.resolveProxy(url) });
    try {
      // Install before constructing server/Codex managers or running Homebrew.
      proxyEnvironment = await installSystemProxyEnvironment({ proxyUrl: systemProxy.proxyUrl });
    } catch (error) {
      await systemProxy.close();
      systemProxy = null;
      throw error;
    }
  })();
  return networkInitialization;
}

function closeServices(): Promise<void> {
  servicesClosing ??= (async () => {
    try {
      // A quit can arrive while a listener, helper or service is being created.
      await networkInitialization?.catch(() => {});
      await updateSetup?.catch(() => {});
      automaticUpdates?.stop();
      const consumers = await Promise.allSettled([
        archiveFiles?.close(),
        homebrewUpdates?.shutdown({ preserveHost: upgradeHandoff }),
        (async () => {
          const server = gitServer ?? await serverInitialization?.catch(() => null);
          gitServer = null;
          await server?.close();
        })(),
      ]);
      const failures = consumers.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'AstraGit 服务退出失败。');
    } finally {
      try { await systemProxy?.close(); }
      finally { await proxyEnvironment?.close(); }
    }
  })();
  return servicesClosing;
}

async function createWindow(): Promise<void> {
  if (creatingWindow) return creatingWindow;
  creatingWindow = loadMainWindow().finally(() => { creatingWindow = null; });
  return creatingWindow;
}

async function loadMainWindow(): Promise<void> {
  const config = await ensureServer();
  if (shuttingDown) return;
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

  const launchRepositoryFile = createRepositoryFileLauncher({ resolve: async (projectId, repositoryId, path, intent) => {
    if (!gitServer || shuttingDown) throw new Error('AstraGit 本地 Git 服务尚未就绪，请稍后再试。');
    return gitServer.resolveGitFileLocation(projectId, repositoryId, path, intent);
  }, open: path => shell.openPath(path), openText: async path => { await execFile('/usr/bin/open', ['-b', 'com.apple.TextEdit', path], { timeout: 10_000 }); }, reveal: path => shell.showItemInFolder(path) });
  ipcMain.removeHandler('astragit:file-action');
  ipcMain.handle('astragit:file-action', (event, request: unknown) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: { code: 'ASTRAGIT_GIT_FILE_ACTION_INVALID', message: '文件操作请求来源无效。' } };
    return launchRepositoryFile(request);
  });
  const patchFiles = createPatchFileAccess({
    chooseOpen: async () => { const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Git patch', extensions: ['patch', 'diff', 'mbox'] }, { name: 'All files', extensions: ['*'] }] }); return result.canceled ? null : result.filePaths[0] ?? null; },
    chooseSave: async name => { const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: [{ name: 'Git patch', extensions: ['patch', 'diff', 'mbox'] }] }); return result.canceled ? null : result.filePath ?? null; },
  });
  archiveFiles ??= createArchiveFileAccess({
    chooseSave: async (name, format) => { const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: [{ name: 'Source archive', extensions: format === 'tar.gz' ? ['gz', 'tgz'] : [format] }] }); return result.canceled ? null : result.filePath ?? null; },
    preview: (request, signal) => { if (!gitServer || shuttingDown) throw new Error('AstraGit 本地 Git 服务尚未就绪。'); return gitServer.previewGitArchive(request.projectId, request.repositoryId, request.input, signal); },
    generate: (request, output, signal) => { if (!gitServer || shuttingDown) throw new Error('AstraGit 本地 Git 服务尚未就绪。'); return gitServer.writeGitArchive(request.projectId, request.repositoryId, request.input, output, signal); },
  });
  for (const kind of ['save', 'cancel'] as const) {
    const name = `astragit:archive-file-${kind}`; ipcMain.removeHandler(name);
    ipcMain.handle(name, (event, request: unknown) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: { code: 'ASTRAGIT_GIT_ARCHIVE_INVALID', message: '源码存档请求来源无效。' } };
      return kind === 'save' ? archiveFiles!.save(request) : archiveFiles!.cancel(request);
    });
  }
  for (const kind of ['read', 'save'] as const) {
    const name = `astragit:patch-file-${kind}`; ipcMain.removeHandler(name);
    ipcMain.handle(name, (event, request: unknown) => {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: { code: 'ASTRAGIT_GIT_PATCH_FILE_INVALID', message: '补丁文件操作来源无效。' } };
      return kind === 'read' ? patchFiles.read() : patchFiles.save(request);
    });
  }

  const handle = (name: string, action: () => unknown) => {
    ipcMain.removeHandler(name);
    ipcMain.handle(name, event => { if (event.sender !== mainWindow?.webContents) throw new Error('更新请求来源无效。'); return action(); });
  };
  handle('astragit:update-indicator-get', async () => { await updateInitialization; return homebrewUpdates?.getIndicatorState() ?? null; });
  ipcMain.removeHandler('astragit:update-action');
  ipcMain.handle('astragit:update-action', async (event, action: unknown, language: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('更新请求来源无效。');
    if (action !== 'check' && action !== 'prepare' && action !== 'restart') throw new Error('更新动作无效。');
    if (language === 'zh-CN' || language === 'en-US') updateLanguage = language;
    await updateInitialization;
    return homebrewUpdates?.performAction(action) ?? null;
  });
  ipcMain.removeHandler('astragit:update-open');
  ipcMain.handle('astragit:update-open', async (event, language: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('更新请求来源无效。');
    if (language === 'zh-CN' || language === 'en-US') updateLanguage = language;
    await updateInitialization;
    if (!homebrewUpdates) throw new Error('更新服务尚未就绪。');
    await homebrewUpdates.showOrCheck();
  });
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
  if (shuttingDown) return;
  updateSetup = initializeUpdates();
  try { await updateSetup; } catch (error) { console.error('[AstraGit] 更新服务初始化失败', error); } finally { completeUpdateInitialization(); }
  app.on('activate', () => {
    if (!shuttingDown && BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch(async (error: unknown) => {
  if (shuttingDown) return;
  console.error('[AstraGit] 启动失败', error);
  shuttingDown = true;
  try { await closeServices(); } finally { app.exit(1); }
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
  if (!shuttingDown && gitServer?.hasActiveRepositorySetup() && !developmentStopRequested && !setupQuitConfirmed) {
    event.preventDefault();
    if (pendingUpgrade) { pendingUpgrade.resolve(false); pendingUpgrade = null; return; }
    if (setupQuitPromptOpen) return;
    setupQuitPromptOpen = true;
    const zh = app.getLocale().startsWith('zh');
    const options: Electron.MessageBoxOptions = {
      type: 'warning', title: zh ? '仓库仍在创建' : 'Repository setup is running',
      message: zh ? '停止仓库创建并退出 AstraGit？' : 'Stop repository setup and quit AstraGit?',
      detail: zh ? '退出将停止当前克隆或初始化。已生成的目录由 Git 决定保留，应用不会自动清理；再次打开后可核对任务记录。' : 'Quitting stops the current clone or initialization. Git may leave a partial directory; the app will not clean it up. Review the task record after reopening.',
      buttons: zh ? ['继续创建', '停止并退出'] : ['Keep running', 'Stop and quit'], defaultId: 0, cancelId: 0,
    };
    void (mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)).then(result => {
      if (result.response === 1) { setupQuitConfirmed = true; app.quit(); }
    }).catch(error => console.error('[AstraGit] 无法确认退出', error)).finally(() => { setupQuitPromptOpen = false; });
    return;
  }
  if (pendingUpgrade && !shuttingDown) {
    event.preventDefault();
    if (activatingUpgrade) return;
    activatingUpgrade = true;
    const handoff = pendingUpgrade;
    void (async () => {
      try {
        if (!(await confirmUpdateRestart())) { handoff.resolve(false); return; }
        // Astra 的退出接力顺序：确认 → brew 安装/复验 → 武装原生重启 → 退出旧 Main。
        await handoff.activate();
        upgradeHandoff = true;
        handoff.resolve(true);
        pendingUpgrade = null;
        app.quit();
      } catch (error) { handoff.reject(error); }
      finally { pendingUpgrade = null; activatingUpgrade = false; }
    })();
    return;
  }
  if (!gitServer && !networkInitialization && !shuttingDown) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  automaticUpdates?.stop();
  // Quit was already interrupted for asynchronous cleanup. Exit after the
  // service and SQLite have closed instead of re-entering native quit events.
  void closeServices().then(
    () => app.exit(0),
    (error: unknown) => {
      console.error('[AstraGit] 退出清理失败', error);
      app.exit(1);
    },
  );
});
