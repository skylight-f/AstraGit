import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { localDataError, readLocalJson, writeLocalJson } from './localJsonFile.js';

const execFileAsync = promisify(execFile);

export interface SecretStore {
  setSecret(account: string, value: string): Promise<void>;
  getSecret(account: string): Promise<string | undefined>;
  deleteSecret(account: string): Promise<void>;
}

/** 独立应用使用独立 Keychain service，避免与 Zeus 主应用密钥混用。 */
export function createMacOSKeychainStore(options: { service?: string } = {}): SecretStore {
  const service = options.service ?? 'AstraGit';
  if (service.trim() !== service || service.length < 1 || service.length > 160 || Array.from(service).some((character) => (character.codePointAt(0) ?? 0) <= 31 || character.codePointAt(0) === 127)) {
    throw new Error('Invalid AstraGit Keychain service name');
  }
  const run = (args: string[]) => execFileAsync('security', args);
  const validateAccount = (account: string) => {
    if (!/^[a-z0-9_.:-]+$/iu.test(account)) throw new Error('Invalid AstraGit Keychain account name');
  };
  const missing = (error: unknown) => error instanceof Error && /could not be found|The specified item could not be found|SecKeychainSearchCopyNext/u.test(error.message);
  return {
    async setSecret(account, value) {
      validateAccount(account);
      try { await run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', value]); }
      catch { throw new Error('本应用钥匙串保存失败，请检查 macOS 钥匙串授权。'); }
    },
    async getSecret(account) {
      validateAccount(account);
      try {
        const { stdout } = await run(['find-generic-password', '-s', service, '-a', account, '-w']);
        return stdout.trim() || undefined;
      } catch (error) {
        if (missing(error)) return undefined;
        throw new Error('本应用钥匙串读取失败，请检查 macOS 钥匙串授权。');
      }
    },
    async deleteSecret(account) {
      validateAccount(account);
      try {
        await run(['delete-generic-password', '-s', service, '-a', account]);
      } catch (error) {
        if (!missing(error)) throw new Error('本应用钥匙串删除失败，请检查 macOS 钥匙串授权。');
      }
    },
  };
}

/** 文件回退：非 macOS 或 security 不可用时，密钥落在 0600 文件中。 */
export function createFileSecretStore(filePath: string): SecretStore {
  const readAll = (): Record<string, string> => {
    const parsed = readLocalJson(filePath);
    if (parsed === undefined) return Object.create(null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.values(parsed).every(value => typeof value === 'string')) throw localDataError(filePath, '校验');
    return Object.assign(Object.create(null), parsed);
  };
  const writeAll = (data: Record<string, string>) => {
    writeLocalJson(filePath, data);
  };
  return {
    async setSecret(account, value) {
      const data = readAll();
      data[account] = value;
      writeAll(data);
    },
    async getSecret(account) {
      return readAll()[account];
    },
    async deleteSecret(account) {
      const data = readAll();
      delete data[account];
      writeAll(data);
    },
  };
}

/** Existing fallback keys stay readable across restarts, without migration. */
export async function createApplicationSecretStore(dataDirectory: string, native = () => createMacOSKeychainStore()): Promise<SecretStore> {
  const filePath = join(dataDirectory, 'secrets.json');
  const fallback = createFileSecretStore(filePath);
  if (existsSync(filePath)) {
    await fallback.getSecret('probe');
    return fallback;
  }
  if (process.platform !== 'darwin') return fallback;
  try {
    const store = native();
    await store.getSecret('probe');
    return store;
  } catch { return fallback; }
}
