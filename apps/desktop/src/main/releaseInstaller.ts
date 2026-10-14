import { spawn } from 'node:child_process';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { verifyReleaseApp } from './releaseVerification.js';

const pause = (ms: number) => new Promise(resolveWait => setTimeout(resolveWait, ms));
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }
async function waitExit(pid: number, timeout: number) { const deadline = Date.now() + timeout; while (Date.now() < deadline && alive(pid)) await pause(250); return !alive(pid); }
async function launch(target: string, executable: string, dataDirectory: string): Promise<number> {
  const environment: NodeJS.ProcessEnv = { ...process.env, ASTRAGIT_USER_DATA_DIR: dataDirectory }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(join(target, executable), [], { detached: true, stdio: 'ignore', env: environment });
  await new Promise<void>((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); }); child.unref();
  if (!child.pid) throw new Error('无法启动升级后的 AstraGit。'); return child.pid;
}
async function waitReady(pid: number, version: string, dataDirectory: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && alive(pid)) {
    try { const ready = JSON.parse(await readFile(join(dataDirectory, 'updates/app-ready.json'), 'utf8')); if (ready.pid === pid && ready.version === version) return true; } catch { /* 等待真实服务及界面就绪。 */ }
    await pause(250);
  }
  return false;
}
async function stop(pid: number) {
  if (!alive(pid)) return;
  process.kill(pid, 'SIGTERM'); if (await waitExit(pid, 10_000)) return;
  process.kill(pid, 'SIGKILL'); if (!(await waitExit(pid, 5000))) throw new Error('新版应用未能退出，保留备份并停止回滚。');
}
async function run() {
  const bootstrapPath = process.argv[2]; if (!bootstrapPath) throw new Error('缺少更新交接文件。');
  const info = await lstat(bootstrapPath); if (!info.isFile() || info.isSymbolicLink() || info.size > 32_000) throw new Error('更新交接文件无效。');
  const input = JSON.parse(await readFile(bootstrapPath, 'utf8')) as { transaction: string; mainPid: number; target: string; staged: string; backup: string; executable: string; dataDirectory: string; oldVersion: string; version: string; team: string };
  const job = dirname(bootstrapPath);
  if (!/^[a-f0-9-]{36}$/u.test(input.transaction) || !Number.isSafeInteger(input.mainPid) || input.mainPid <= 1 || input.mainPid === process.pid || typeof input.dataDirectory !== 'string' || job !== join(resolve(input.dataDirectory), 'updates', input.transaction)) throw new Error('更新交接身份无效。');
  const parent = dirname(resolve(input.target));
  if (basename(input.target) !== 'AstraGit.app' || input.staged !== join(parent, `.AstraGit.update-${input.transaction}.app`) || input.backup !== join(parent, `.AstraGit.backup-${input.transaction}.app`) || input.executable !== 'Contents/MacOS/AstraGit') throw new Error('更新交接路径无效。');
  for (const path of [input.target, input.staged, parent]) { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('更新目录不是普通目录。'); }
  if (await lstat(input.backup).catch(() => null)) throw new Error('更新备份已存在。');
  await verifyReleaseApp(input.staged, input.version, input.team);
  await writeFile(join(job, 'ready'), String(process.pid), { flag: 'wx', mode: 0o600 });
  const result = (status: string, reason: string) => writeFile(join(job, 'result.json'), JSON.stringify({ status, reason, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  if (!(await waitExit(input.mainPid, 10 * 60_000))) { await result('failed', '旧应用未退出，安装未开始。'); return; }
  let moved = false; let installed = false; let pid: number | null = null;
  try {
    // 旧版可以尚未公证，但必须仍属于当前可信签发团队；新版始终复验签名与公证。
    await verifyReleaseApp(input.staged, input.version, input.team);
    const { readSigningTeam } = await import('./releaseVerification.js');
    if (await readSigningTeam(input.target) !== input.team) throw new Error('当前应用签发团队已变化。');
    await rename(input.target, input.backup); moved = true;
    await rename(input.staged, input.target); installed = true;
    await verifyReleaseApp(input.target, input.version, input.team);
    pid = await launch(input.target, input.executable, input.dataDirectory);
    if (!(await waitReady(pid, input.version, input.dataDirectory))) throw new Error('新版界面与本地服务未能完成启动。');
    await result('completed', '新版 AstraGit 已启动，升级完成。');
    // 此备份只含旧应用；更新流程不迁移或删除用户数据。
    await rm(input.backup, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    try {
      if (pid) await stop(pid);
      if (installed) await rename(input.target, `${input.staged}.failed`);
      if (moved) { await rename(input.backup, input.target); pid = await launch(input.target, input.executable, input.dataDirectory); if (!(await waitReady(pid, input.oldVersion, input.dataDirectory))) throw new Error('旧应用已恢复，但未完成启动。'); }
      await result('rolled_back', `升级失败，已保留旧应用：${error instanceof Error ? error.message : String(error)}`);
    } catch (rollback) { await result('failed', `自动恢复未完成：${String(rollback)}；原始错误：${String(error)}`); }
    process.exitCode = 1;
  }
}
void run().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
