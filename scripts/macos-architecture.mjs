import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** lipo -verify_arch consumes trailing arguments as architectures, so the input must come first. */
export async function verifyMachOArchitecture(filePath, architecture) {
  const target = architecture === 'x64' ? 'x86_64' : architecture === 'arm64' ? 'arm64' : null;
  if (!target) throw new Error(`Unsupported macOS architecture: ${String(architecture)}`);
  await execute('/usr/bin/lipo', [filePath, '-verify_arch', target]);
}
