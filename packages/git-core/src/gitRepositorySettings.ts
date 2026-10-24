import { createHash } from 'node:crypto';
import { gitRemoteAddressIssue } from '@astragit/shared';

export interface ProjectGitRepositorySettings {
  fingerprint: string;
  identity: { name: string; email: string; localName: string | null; localEmail: string | null };
  commitTemplate: { path: string | null; localPath: string | null };
  remotes: Array<{ name: string; fetchUrls: string[]; pushUrls: string[]; editable: boolean }>;
}

export type RepositorySettingsAction =
  | { type: 'set_identity_field'; field: 'name' | 'email'; value: string | null; expectedSettingsFingerprint: string }
  | { type: 'configure_remote'; operation: 'add' | 'rename' | 'remove' | 'set_fetch_url' | 'set_push_url' | 'clear_push_url'; name: string; value?: string; expectedSettingsFingerprint: string };
type Run = (args: string[]) => Promise<{ stdout: string; stderr: string }>;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write' });
const hasControl = (text: string) => Array.from(text).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

function entries(raw: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const entry of raw.split('\0')) {
    if (!entry) continue;
    const separator = entry.indexOf('\n');
    const key = separator < 0 ? entry : entry.slice(0, separator);
    const value = separator < 0 ? '' : entry.slice(separator + 1);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

/** Only whitelisted settings leave this module; other config values remain private. */
export async function readRepositorySettings(run: Run, redact: (text: string) => string): Promise<ProjectGitRepositorySettings> {
  const [local, effective] = await Promise.all([run(['config', '--local', '--null', '--list']), run(['config', '--includes', '--null', '--list'])]);
  const localEntries = entries(local.stdout); const all = entries(effective.stdout);
  const names = new Set<string>();
  for (const key of all.keys()) { const match = /^remote\.(.+)\.[^.]+$/u.exec(key); if (match) names.add(match[1]!); }
  const last = (values: string[] | undefined) => values?.at(-1) ?? null;
  return {
    fingerprint: createHash('sha256').update(JSON.stringify([local.stdout, effective.stdout])).digest('hex'),
    identity: { name: last(all.get('user.name')) ?? '', email: last(all.get('user.email')) ?? '', localName: last(localEntries.get('user.name')), localEmail: last(localEntries.get('user.email')) },
    commitTemplate: { path: last(all.get('commit.template')), localPath: last(localEntries.get('commit.template')) },
    remotes: [...names].sort().map(name => {
      const belongs = (key: string) => /^remote\.(.+)\.[^.]+$/u.exec(key)?.[1] === name;
      return { name, fetchUrls: (all.get(`remote.${name}.url`) ?? []).map(redact), pushUrls: (all.get(`remote.${name}.pushurl`) ?? []).map(redact), editable: [...localEntries.keys()].some(belongs) && [...all].filter(([key]) => belongs(key)).every(([key, values]) => JSON.stringify(values) === JSON.stringify(localEntries.get(key))) };
    }),
  };
}

/** Each confirmed settings action invokes one Git write, with no network access. */
export async function executeRepositorySettings(run: Run, redact: (text: string) => string, action: RepositorySettingsAction): Promise<{ stdout: string; stderr: string }> {
  const settings = await readRepositorySettings(run, redact);
  if (settings.fingerprint !== action.expectedSettingsFingerprint) throw failure('ASTRAGIT_GIT_SETTINGS_STALE', '仓库配置已变化，请重新载入设置后核对。');
  if (action.type === 'set_identity_field') {
    if (action.field !== 'name' && action.field !== 'email') throw failure('ASTRAGIT_GIT_IDENTITY_INVALID', '不支持的提交身份字段。');
    const key = `user.${action.field}`;
    if (action.value === null) {
      if ((action.field === 'name' ? settings.identity.localName : settings.identity.localEmail) === null) return { stdout: '', stderr: '' };
      return run(['config', '--local', '--unset-all', '--', key]);
    }
    const value = action.value.trim();
    if (!value || value.length > 500 || value.includes('<') || value.includes('>') || hasControl(value)) throw failure('ASTRAGIT_GIT_IDENTITY_INVALID', '姓名或邮箱无效，请填写单行文字。');
    return run(['config', '--local', '--replace-all', '--', key, value]);
  }
  if (!['add', 'rename', 'remove', 'set_fetch_url', 'set_push_url', 'clear_push_url'].includes(action.operation)) throw failure('ASTRAGIT_GIT_SETTINGS_INVALID', '不支持的远程设置操作。');
  const name = action.name.trim();
  if (!name || name.startsWith('-') || name.length > 200 || hasControl(name)) throw failure('ASTRAGIT_GIT_REMOTE_NAME_INVALID', '远程名称无效。');
  await run(['check-ref-format', `refs/remotes/${name}/__astragit_validation`]);
  const remote = settings.remotes.find(item => item.name === name);
  if (action.operation === 'add' ? Boolean(remote) : !remote) throw failure('ASTRAGIT_GIT_REMOTE_CHANGED', '远程仓库不存在或名称已被使用，请重新载入设置。');
  if (remote && !remote.editable) throw failure('ASTRAGIT_GIT_REMOTE_INHERITED', '该远程来自仓库之外的配置，请在原配置中调整。');
  if (action.operation === 'remove') return run(['remote', 'remove', name]);
  if (action.operation === 'clear_push_url') {
    if (!remote!.pushUrls.length) return { stdout: '', stderr: '' };
    return run(['config', '--local', '--unset-all', '--', `remote.${name}.pushurl`]);
  }
  const value = (action.value ?? '').trim();
  if (action.operation === 'rename') {
    if (!value || value.startsWith('-') || value.length > 200 || hasControl(value)) throw failure('ASTRAGIT_GIT_REMOTE_NAME_INVALID', '远程名称无效。');
    await run(['check-ref-format', `refs/remotes/${value}/__astragit_validation`]);
    if (settings.remotes.some(item => item.name === value)) throw failure('ASTRAGIT_GIT_REMOTE_CHANGED', '远程名称已被使用。');
    return run(['remote', 'rename', name, value]);
  }
  const issue = gitRemoteAddressIssue(value);
  if (issue) throw failure(issue === 'credentials' ? 'ASTRAGIT_GIT_REMOTE_CREDENTIALS_IN_URL' : 'ASTRAGIT_GIT_REMOTE_URL_INVALID', '远程地址无效，请使用不含凭据的 Git 地址。');
  if (action.operation === 'add') return run(['remote', 'add', '--', name, value]);
  if (action.operation === 'set_fetch_url') {
    const configured = await run(['config', '--local', '--null', '--get-all', `remote.${name}.url`]);
    const first = configured.stdout.split('\0')[0];
    if (first === undefined || !first) throw failure('ASTRAGIT_GIT_REMOTE_CHANGED', '该远程没有可修改的本地主获取地址，请重新载入设置。');
    // A fixed-value filter preserves other URLs without interpreting URL characters as regex.
    return run(['config', '--local', '--fixed-value', '--replace-all', '--', `remote.${name}.url`, value, first]);
  }
  return run(['config', '--local', '--replace-all', '--', `remote.${name}.pushurl`, value]);
}
