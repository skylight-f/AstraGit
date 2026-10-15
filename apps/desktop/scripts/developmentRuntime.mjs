import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** A cached development identity, still running source through Vite, not ASAR. */
export async function developmentRuntime(workspace, desktop) {
  const vendorExecutable = require('electron');
  if (process.platform !== 'darwin') return vendorExecutable;
  const cache = join(workspace, '.tmp/development-runtime');
  const app = join(cache, 'AstraGit Development.app');
  const executable = join(app, 'Contents/MacOS/Electron');
  const icon = await readFile(join(desktop, 'build/icon.icns'));
  const identity = createHash('sha256').update(workspace).digest('hex').slice(0, 12);
  const stamp = JSON.stringify({ layout: 1, source: vendorExecutable, version: require('electron/package.json').version, arch: process.arch, icon: createHash('sha256').update(icon).digest('hex') });
  try { if (await readFile(join(cache, 'runtime.json'), 'utf8') === stamp) { await readFile(join(app, 'Contents/Info.plist')); return executable; } } catch { /* Prepare a fresh cache. */ }
  console.info('[dev] 准备独立的 AstraGit Development 运行环境（仅首次或 Electron 升级时）…');
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'prepare-'));
  try {
    const candidate = join(temporary, 'AstraGit Development.app');
    await cp(resolve(dirname(vendorExecutable), '../..'), candidate, { recursive: true, verbatimSymlinks: true });
    const plist = join(candidate, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({ CFBundleIdentifier: `com.astragit.development.${identity}`, CFBundleName: 'AstraGit Development', CFBundleDisplayName: 'AstraGit Development' })) {
      await execute('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
    }
    await writeFile(join(candidate, 'Contents/Resources/electron.icns'), icon);
    await execute('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate]);
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate]);
    await rm(app, { recursive: true, force: true });
    await rename(candidate, app);
    await writeFile(join(cache, 'runtime.json'), stamp);
    return executable;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
