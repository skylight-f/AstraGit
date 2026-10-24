import { randomUUID } from 'node:crypto';

type Run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
/** Append command-only config without parsing keys or values as key=value argv. */
export function gitCommandConfig(inherited: NodeJS.ProcessEnv, entries: Array<[string, string]>) {
  const count = Number(inherited.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) throw Object.assign(new Error('Git 命令配置数量无效。'), { code: 'ASTRAGIT_GIT_REMOTE_CONFIG_INVALID', operationStatus: 'failed_before_write' });
  const env: NodeJS.ProcessEnv = { ...inherited, GIT_CONFIG_COUNT: String(count + entries.length) };
  entries.forEach(([key, value], offset) => { env[`GIT_CONFIG_KEY_${count + offset}`] = key; env[`GIT_CONFIG_VALUE_${count + offset}`] = value; });
  return env;
}
/** Address one already-resolved push destination without applying URL rewrites a
 * second time. Keep remote transport settings and inherited command config.
 * Git's longest insteadOf match rewrites this private URL exactly once.
 */
export async function gitRemoteEndpoint(remote: string, url: string, run: Run, inherited: NodeJS.ProcessEnv) {
  const alias = `astragit-endpoint-${randomUUID()}`; const placeholder = `${alias}:`;
  const entries: Array<[string, string]> = [];
  const prefix = `remote.${remote}.`;
  let configured = '';
  try { configured = (await run(['config', '--null', '--get-regexp', `^remote\\.${remote.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.`])).stdout; }
  catch (error) { if ((error as { exitCode?: number; code?: unknown }).exitCode !== 1 && (error as { code?: unknown }).code !== 1) throw error; }
  for (const record of configured.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\n'); const key = record.slice(0, separator); if (separator < 0 || !key.startsWith(prefix)) continue;
    const option = key.slice(prefix.length);
    if (option === 'url' || option === 'pushurl' || option === 'mirror') continue;
    entries.push([`remote.${alias}.${option}`, record.slice(separator + 1)]);
  }
  entries.push([`url.${url}.insteadOf`, placeholder], [`remote.${alias}.url`, placeholder], [`remote.${alias}.pushurl`, placeholder], [`remote.${alias}.mirror`, 'false']);
  return { name: alias, env: gitCommandConfig(inherited, entries) };
}
