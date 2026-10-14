import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

export const execFile = promisify(execFileCallback);
export async function readSigningTeam(path: string): Promise<string | null> {
  const { stderr } = await execFile('/usr/bin/codesign', ['-dv', '--verbose=4', path], { timeout: 10_000 });
  return /^TeamIdentifier=([A-Z0-9]{10})$/mu.exec(stderr)?.[1] ?? null;
}
export async function verifyReleaseApp(path: string, version: string, team: string) {
  if (!/^[A-Z0-9]{10}$/u.test(team) || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('更新签发团队或版本无效。');
  const fields = await Promise.all(['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key => (await execFile('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(path, 'Contents/Info.plist')], { timeout: 10_000 })).stdout.trim()));
  if (fields[0] !== 'com.astragit.desktop' || fields[1] !== version || fields[2] !== version) throw new Error('更新应用身份或版本不匹配。');
  await execFile('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=anchor apple generic and notarized and identifier "com.astragit.desktop" and certificate leaf[subject.OU] = "${team}"`, path], { timeout: 60_000, maxBuffer: 8 * 1024 ** 2 });
  await execFile('/usr/sbin/spctl', ['--assess', '--type', 'execute', path], { timeout: 120_000 });
}
