import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

// Linux CI 验证 TypeScript；macOS 发行构建编译并打包当前架构的原生窗口。
if (process.platform !== 'darwin') {
  console.info('Native update helper is built by the macOS release job.');
} else {
  const desktop = resolve(import.meta.dirname, '..');
  const cache = resolve(desktop, '../../.tmp/swift-module-cache');
  await mkdir(resolve(desktop, 'dist/native'), { recursive: true });
  await mkdir(cache, { recursive: true });
  const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64';
  await new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('/usr/bin/xcrun', [
      'swiftc', '-parse-as-library', '-O', '-framework', 'AppKit', '-target', `${architecture}-apple-macos13.0`,
      resolve(desktop, 'native/UpdateProgressPanel.swift'), '-o', resolve(desktop, 'dist/native/AstraGitUpdateProgress'),
    ], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache, SWIFT_MODULE_CACHE_PATH: cache } });
    child.once('error', rejectBuild);
    child.once('exit', (code, signal) => code === 0 ? resolveBuild() : rejectBuild(new Error(`Native update helper build failed: ${signal ?? code}`)));
  });
}
