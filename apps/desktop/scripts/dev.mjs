import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// scripts/dev.mjs → 应用根目录为上级
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(desktop, '../..');
let child;
let server;
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* 进程可能已退出 */
    }
  }
  await server?.close();
  process.exitCode = code;
}

process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));

function run(command, args, env, cwd = desktop) {
  return new Promise((resolveExit, reject) => {
    child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: true });
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

try {
  const env = { ...process.env };
  env.ASTRAGIT_USER_DATA_DIR ||= resolve(desktop, '../../.tmp/electron-development-data');

  const code = await run('pnpm', ['build'], env, workspace);
  if (code !== 0 || stopping) {
    await stop(code);
  } else {
    server = await createServer({
      configFile: resolve(desktop, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 5179, strictPort: true },
    });
    await server.listen();
    const vite = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5179/';
    env.VITE_DEV_SERVER_URL = vite;
    // 直接调用本地 electron CLI，避免根目录 pnpm exec 解析不到 desktop 依赖。
    const electronCli = resolve(desktop, 'node_modules/electron/cli.js');
    await run(process.execPath, [electronCli, '.'], env);
    await stop(0);
  }
} catch (error) {
  console.error(error);
  await stop(1);
}
