import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { developmentRuntime } from './developmentRuntime.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(desktop, '../..');
const packages = ['shared', 'git-core', 'storage', 'ai-runtime', 'git-server'];
const env = { ...process.env };
env.ASTRAGIT_USER_DATA_DIR ||= join(workspace, '.tmp/electron-development-data');
delete env.ELECTRON_RUN_AS_NODE;
const sessionPath = join(workspace, '.tmp/dev-session.json');
const watchers = [];
let server;
let rendererHttp;
let electronExecutable;
let electron;
let buildProcess;
let pending = 0;
let building = false;
let debounce;
let stopping = false;
let stopPromise;
let ownsSession = false;
let sessionWrites = Promise.resolve();
const expectedExits = new WeakSet();

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child) {
  if (!child || exited(child)) return Promise.resolve();
  return new Promise(resolveExit => child.once('exit', resolveExit));
}

async function closeElectron() {
  const child = electron;
  if (!child || exited(child)) return;
  expectedExits.add(child);
  const closed = waitForExit(child);
  // Drain HTTP/Git operations, close SQLite and end AI services before restart.
  if (child.connected) child.send({ type: 'astragit:dev-stop' }, error => { if (error && !exited(child)) child.kill('SIGTERM'); });
  else child.kill('SIGTERM');
  const warning = setTimeout(() => console.warn('[dev] 正在等待应用结束当前操作并退出；不会强杀 Git 操作。'), 15_000);
  await closed;
  clearTimeout(warning);
  if (electron === child) electron = undefined;
}

function stop(code) {
  if (stopPromise) return stopPromise;
  stopping = true;
  clearTimeout(debounce);
  watchers.forEach(watcher => watcher.close());
  stopPromise = (async () => {
    const compiling = buildProcess;
    if (compiling?.pid && !exited(compiling)) {
      // This group contains only pnpm/TypeScript compilation processes.
      if (process.platform === 'win32') compiling.kill('SIGTERM');
      else { try { process.kill(-compiling.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
      await waitForExit(compiling);
    }
    await closeElectron();
    await server?.close();
    if (rendererHttp?.listening) await new Promise((resolveClose, reject) => rendererHttp.close(error => error ? reject(error) : resolveClose()));
    await sessionWrites;
    if (ownsSession) await rm(sessionPath, { force: true });
    process.exitCode = code;
  })();
  return stopPromise;
}

process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));

function runBuild(args, cwd = desktop) {
  return new Promise((resolveExit, reject) => {
    const child = spawn('pnpm', args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
    buildProcess = child;
    child.once('error', reject);
    child.once('exit', code => {
      if (buildProcess === child) buildProcess = undefined;
      resolveExit(code ?? 1);
    });
  });
}

async function compile() {
  // pnpm builds dependencies in order AND syncs injected workspace packages.
  // Bare tsc --watch would leave injected copies stale on a fresh install.
  if (await runBuild(['--filter', '@astragit/git-server...', '-r', 'build'], workspace)) return false;
  if (stopping || await runBuild(['exec', 'tsc', '-p', 'tsconfig.main.json'])) return false;
  if (stopping || await runBuild(['exec', 'tsc', '-p', 'tsconfig.preload.json'])) return false;
  return !stopping;
}

function startElectron() {
  if (stopping) return;
  const child = spawn(electronExecutable, ['.'], { cwd: desktop, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  electron = child;
  child.on('message', message => {
    if (!message || message.type !== 'astragit:dev-ready' || stopping || child !== electron) return;
    console.info(`[dev] 就绪 Main PID=${child.pid} Renderer=${env.VITE_DEV_SERVER_URL} API=${message.baseUrl} 身份=${message.applicationName}`);
    // No API token or model credentials are written to development status.
    sessionWrites = sessionWrites.then(() => writeFile(sessionPath, JSON.stringify({
      controllerPid: process.pid, mainPid: child.pid, rendererUrl: env.VITE_DEV_SERVER_URL, applicationName: message.applicationName,
      baseUrl: message.baseUrl, dataDirectory: env.ASTRAGIT_USER_DATA_DIR, readyAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 })).catch(error => console.error('[dev] 无法保存开发状态', error));
  });
  child.once('error', error => { console.error('[dev] Electron 启动失败', error); void stop(1); });
  child.once('exit', (code, signal) => {
    if (electron === child) electron = undefined;
    if (!stopping && !expectedExits.has(child)) {
      console.info(`[dev] 应用已退出 (${signal ?? code})，关闭开发服务。`);
      void stop(code ?? 1);
    }
  });
}

async function rebuild() {
  if (building || stopping) return;
  building = true;
  try {
    while (pending && !stopping) {
      const revision = pending;
      console.info('[dev] 编译 Main / preload / 本地服务…');
      const ok = await compile();
      if (stopping) break;
      if (pending !== revision) continue;
      pending = 0;
      if (!ok) {
        console.error('[dev] 编译失败，当前应用保持运行；修复保存后自动重试。');
        break;
      }
      await closeElectron();
      // A save during graceful shutdown needs compilation before launch too.
      if (pending || stopping) continue;
      startElectron();
    }
  } catch (error) {
    console.error('[dev] 开发启动失败', error);
    await stop(1);
  } finally {
    building = false;
    if (pending && !stopping) void rebuild();
  }
}

function changed(path) {
  if (stopping) return;
  pending += 1;
  clearTimeout(debounce);
  console.info(`[dev] 更改 ${relative(workspace, path)}`);
  debounce = setTimeout(() => void rebuild(), 350);
}

function watchSources(directory) {
  const watcher = watch(directory, { recursive: true }, (_event, file) => {
    if (file && /\.(?:[cm]?tsx?|[cm]?js|json)$/u.test(file)) changed(join(directory, file));
  });
  watcher.on('error', error => { console.error('[dev] 源码监听失败', error); void stop(1); });
  watchers.push(watcher);
}

function watchConfigs(directory, names) {
  const watcher = watch(directory, (_event, file) => {
    if (file && names.includes(file)) changed(join(directory, file));
  });
  watcher.on('error', error => { console.error('[dev] 配置监听失败', error); void stop(1); });
  watchers.push(watcher);
}

async function start() {
  await mkdir(dirname(sessionPath), { recursive: true });
  electronExecutable = await developmentRuntime(workspace, desktop);
  if (stopping) return;
  // Middleware mode leaves signal handling to this supervisor. Standalone
  // Vite otherwise calls process.exit() before Electron cleanup has finished.
  rendererHttp = createHttpServer((request, response) => server.middlewares(request, response));
  server = await createServer({
    configFile: join(desktop, 'vite.config.ts'),
    server: { middlewareMode: true, ws: { server: rendererHttp } },
  });
  if (stopping) await server.close();
  else {
    await new Promise((resolveListen, reject) => {
      rendererHttp.once('error', reject);
      rendererHttp.listen(server.config.server.port, '127.0.0.1', () => {
        rendererHttp.off('error', reject);
        resolveListen();
      });
    });
    if (stopping) await rendererHttp.close();
    else {
      env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${rendererHttp.address().port}/`;
      ownsSession = true;
      await rm(sessionPath, { force: true });
      watchSources(join(desktop, 'src/main'));
      watchSources(join(desktop, 'src/preload'));
      watchConfigs(join(desktop, 'build'), ['icon.png', 'icon.icns']);
      watchConfigs(desktop, ['tsconfig.main.json', 'tsconfig.preload.json', 'package.json']);
      watchConfigs(workspace, ['tsconfig.base.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package.json']);
      for (const name of packages) {
        const directory = join(workspace, 'packages', name);
        watchSources(join(directory, 'src'));
        watchConfigs(directory, ['tsconfig.json', 'package.json']);
      }
      console.info(`[dev] Renderer 热更新：${env.VITE_DEV_SERVER_URL}`);
      console.info(`[dev] 开发数据：${env.ASTRAGIT_USER_DATA_DIR}`);
      console.info(`[dev] 开发运行环境：${electronExecutable}`);
      pending = 1;
      await rebuild();
    }
  }
}

try { await start(); } catch (error) {
  console.error('[dev] 开发启动失败', error);
  await stop(1);
}
