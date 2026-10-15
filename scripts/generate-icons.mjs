import { execFile as execute } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execute);
if (process.platform !== 'darwin') throw new Error('图标生成使用 macOS AppKit 与 iconutil，请在 macOS 执行。');
const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'apps/desktop/build');
const temporaryRoot = join(root, '.tmp');
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(join(temporaryRoot, 'astragit-icons-'));
try {
  const png = join(temporary, 'icon.png');
  await execFile('/usr/bin/swift', [join(root, 'scripts/render-icon.swift'), join(directory, 'icon.svg'), png, '1024'], { timeout: 120_000 });
  const iconset = join(temporary, 'AstraGit.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      await execFile('/usr/bin/sips', ['-z', String(pixels), String(pixels), png, '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
    }
  }
  const icns = join(temporary, 'icon.icns');
  await execFile('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns]);
  await rename(png, join(directory, 'icon.png'));
  await rename(icns, join(directory, 'icon.icns'));
  console.info('已从 build/icon.svg 生成 1024px 透明 PNG 与完整 macOS ICNS。');
} finally { await rm(temporary, { recursive: true, force: true }); }
