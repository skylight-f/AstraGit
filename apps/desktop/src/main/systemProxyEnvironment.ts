import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const proxyEnvironmentKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'] as const;
const localBypass = 'localhost,127.0.0.1,::1';

export interface SystemProxyEnvironmentOptions {
  proxyUrl: string;
  /** Tests can install into an isolated object instead of changing their host. */
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  temporaryDirectory?: string;
  sshPath?: string;
  netcatPath?: string;
}

export interface InstalledSystemProxyEnvironment {
  environment: NodeJS.ProcessEnv;
  sshHelperPath?: string;
  /** Restore variables after all users of the proxy have stopped. */
  restore(): void;
  /** Restore variables and remove the private SSH helper. Idempotent. */
  close(): Promise<void>;
}

/** Children use one stable bridge; the bridge resolves system routing per URL. */
export function createSystemProxyEnvironment(proxyUrl: string, baseEnvironment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const proxy = validateProxyUrl(proxyUrl).origin;
  return {
    ...baseEnvironment,
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy,
    http_proxy: proxy, https_proxy: proxy, all_proxy: proxy,
    // External exceptions come from the system resolver, never a stale shell.
    NO_PROXY: localBypass, no_proxy: localBypass,
    NODE_USE_ENV_PROXY: '1',
  };
}

export async function installSystemProxyEnvironment(options: SystemProxyEnvironmentOptions): Promise<InstalledSystemProxyEnvironment> {
  const proxy = validateProxyUrl(options.proxyUrl);
  const environment = options.environment ?? process.env;
  const values = createSystemProxyEnvironment(proxy.origin, environment);
  const keys: string[] = [...proxyEnvironmentKeys];
  let helperDirectory: string | undefined;
  let sshHelperPath: string | undefined;
  try {
    // GIT_SSH has lower precedence than core.sshCommand. An explicitly selected
    // transport remains authoritative, including custom SSH executables.
    if ((options.platform ?? process.platform) === 'darwin' && !environment.GIT_SSH && !environment.GIT_SSH_COMMAND) {
      const sshPath = options.sshPath ?? '/usr/bin/ssh';
      const netcatPath = options.netcatPath ?? '/usr/bin/nc';
      validateExecutablePath(sshPath);
      validateExecutablePath(netcatPath);
      helperDirectory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'astragit-system-proxy-'));
      await chmod(helperDirectory, 0o700);
      sshHelperPath = join(helperDirectory, 'ssh');
      await writeFile(sshHelperPath, createSshHelper(sshPath, netcatPath, proxy.host), { mode: 0o700 });
      values.GIT_SSH = sshHelperPath;
      keys.push('GIT_SSH');
    }
  } catch (error) {
    if (helperDirectory) await rm(helperDirectory, { recursive: true, force: true });
    throw error;
  }
  const previous = new Map(keys.map(key => [key, environment[key]]));
  for (const key of keys) environment[key] = values[key];
  let restored = false;
  let closePromise: Promise<void> | undefined;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [key, value] of previous) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  };
  return {
    environment,
    ...(sshHelperPath ? { sshHelperPath } : {}),
    restore,
    close: () => {
      restore();
      closePromise ??= helperDirectory ? rm(helperDirectory, { recursive: true, force: true }) : Promise.resolve();
      return closePromise;
    },
  };
}

function validateProxyUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('System proxy bridge must use an HTTP URL on 127.0.0.1 with an explicit port.');
  }
  return url;
}

function validateExecutablePath(value: string): void {
  if (!isAbsolute(value) || /[\0\r\n]/u.test(value)) throw new Error('SSH proxy helpers require absolute executable paths.');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createSshHelper(sshPath: string, netcatPath: string, proxyHost: string): string {
  // Quote once for the ProxyCommand shell and once for the wrapper's shell.
  const proxyCommand = [netcatPath, '-X', 'connect', '-x', proxyHost, '%h', '%p'].map(shellQuote).join(' ');
  return `#!/bin/sh
# Read effective configuration without opening an SSH connection or keys.
if ! astragit_ssh_config=$(${shellQuote(sshPath)} -G "$@" 2>/dev/null); then
  printf '%s\\n' 'AstraGit could not inspect SSH proxy configuration.' >&2
  exit 1
fi
astragit_custom_proxy=0
while IFS= read -r astragit_ssh_line; do
  case "$astragit_ssh_line" in
    'proxycommand none'|'proxyjump none') ;;
    proxycommand\\ *|proxyjump\\ *) astragit_custom_proxy=1 ;;
  esac
done <<ASTRAGIT_SSH_CONFIG
$astragit_ssh_config
ASTRAGIT_SSH_CONFIG
if [ "$astragit_custom_proxy" = 1 ]; then
  exec ${shellQuote(sshPath)} "$@"
fi
exec ${shellQuote(sshPath)} -o ${shellQuote(`ProxyCommand=${proxyCommand}`)} "$@"
`;
}
