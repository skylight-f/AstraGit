import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

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
      await run(['add-generic-password', '-U', '-s', service, '-a', account, '-w', value]);
    },
    async getSecret(account) {
      validateAccount(account);
      try {
        const { stdout } = await run(['find-generic-password', '-s', service, '-a', account, '-w']);
        return stdout.trim() || undefined;
      } catch (error) {
        if (missing(error)) return undefined;
        throw error;
      }
    },
    async deleteSecret(account) {
      validateAccount(account);
      try {
        await run(['delete-generic-password', '-s', service, '-a', account]);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    },
  };
}

/** 文件回退：非 macOS 或 security 不可用时，密钥落在 0600 文件中。 */
export function createFileSecretStore(filePath: string): SecretStore {
  const readAll = (): Record<string, string> => {
    if (!existsSync(filePath)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const writeAll = (data: Record<string, string>) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
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
