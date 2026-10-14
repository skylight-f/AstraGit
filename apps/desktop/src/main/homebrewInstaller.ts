import { spawn } from 'node:child_process';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHomebrewUpdateService, inspectHomebrewApp, type HomebrewPreparedUpdate } from './homebrewUpdateService.js';

const pause = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }
async function launch(target: string, dataDirectory: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, ASTRAGIT_USER_DATA_DIR: dataDirectory }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(join(target, 'Contents/MacOS/AstraGit'), [], { detached: true, stdio: 'ignore', env });
  await new Promise<void>((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); }); child.unref();
  if (!child.pid) throw new Error('Homebrew 升级后无法启动 AstraGit。'); return child.pid;
}
async function run() {
  const path = process.argv[2]; if (!path) throw new Error('缺少 Homebrew 更新交接文件。');
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 32_000 || (info.mode & 0o077)) throw new Error('Homebrew 交接文件无效。');
  const input = JSON.parse(await readFile(path, 'utf8')) as { transaction: string; mainPid: number; target: string; dataDirectory: string; prepared: HomebrewPreparedUpdate };
  const job = dirname(path);
  if (!/^[a-f0-9-]{36}$/u.test(input.transaction) || !Number.isSafeInteger(input.mainPid) || input.mainPid <= 1 || input.mainPid === process.pid || job !== join(resolve(input.dataDirectory), 'updates', input.transaction) || input.target !== resolve(input.target) || basename(input.target) !== 'AstraGit.app') throw new Error('Homebrew 交接身份无效。');
  const service = createHomebrewUpdateService({ appPath: input.target, version: input.prepared.update.currentVersion });
  if (!(await service.isManaged())) throw new Error('当前应用不再由 Homebrew 管理。');
  const result = (status: string, reason: string, pid?: number) => writeFile(join(job, 'result.json'), JSON.stringify({ status, reason, pid, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  await writeFile(join(job, 'ready'), String(process.pid), { mode: 0o600, flag: 'wx' });
  const deadline = Date.now() + 10 * 60_000;
  while (alive(input.mainPid) && Date.now() < deadline) await pause(250);
  if (alive(input.mainPid)) { await result('failed', '旧应用未退出，Homebrew 安装未开始。'); return; }
  try {
    await service.install(input.prepared, () => {});
    const pid = await launch(input.target, input.dataDirectory);
    const readyDeadline = Date.now() + 90_000;
    while (alive(pid) && Date.now() < readyDeadline) {
      try {
        const ready = JSON.parse(await readFile(join(input.dataDirectory, 'updates/app-ready.json'), 'utf8'));
        if (ready.pid === pid && ready.version === input.prepared.update.latestVersion) { await result('completed', 'Homebrew 已升级并启动新版 AstraGit。', pid); return; }
      } catch { /* 只接受新版进程产生的真实页面/API 就绪标记。 */ }
      await pause(250);
    }
    await result('failed', 'Homebrew 已执行升级，但新版未完成启动；请查看 brew 安装记录。', pid);
  } catch (error) {
    // 安装登记和恢复由 brew 管理，不手动改写 Caskroom 或用户数据。
    let pid: number | undefined;
    try { await inspectHomebrewApp(input.target, [input.prepared.update.currentVersion]); pid = await launch(input.target, input.dataDirectory); } catch { /* 磁盘身份不匹配时不自动启动。 */ }
    await result('failed', `Homebrew 更新失败：${error instanceof Error ? error.message : String(error)}`, pid); process.exitCode = 1;
  }
}
void run().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
