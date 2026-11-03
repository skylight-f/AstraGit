import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const proxyEnvironmentKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'] as const;
const localBypass = 'localhost,127.0.0.1,::1';
const bridgeMarker = 'ASTRAGIT_SYSTEM_PROXY_URL';
const sshMarker = 'ASTRAGIT_SYSTEM_PROXY_SSH_HELPER';

function isApplicationSshHelper(value: string | undefined, marker: string | undefined, temporaryDirectory: string): boolean {
  if (!value || !isAbsolute(value) || basename(value) !== 'ssh' || !/^astragit-system-proxy-[A-Za-z0-9]{6}$/u.test(basename(dirname(value)))) return false;
  // New processes recognize the marker. Older releases only supplied GIT_SSH;
  // accept that legacy shape strictly inside this user's temporary directory.
  const canonical = (path: string) => resolve(path).replace(/^\/private(?=\/(?:var|tmp)(?:\/|$))/u, '');
  return value === marker || canonical(dirname(dirname(value))) === canonical(temporaryDirectory);
}

/** Long-lived update helpers and relaunched apps must not inherit this Main's temporary bridge. */
export function createRelaunchEnvironment(environment: NodeJS.ProcessEnv = process.env, temporaryDirectory = tmpdir()): NodeJS.ProcessEnv {
  const result = { ...environment };
  if (isApplicationSshHelper(result.GIT_SSH, result[sshMarker], temporaryDirectory)) delete result.GIT_SSH;
  const bridge = result[bridgeMarker];
  if (bridge) {
    for (const key of proxyEnvironmentKeys) if (result[key] === bridge) delete result[key];
    if (result.NO_PROXY === localBypass) delete result.NO_PROXY;
    if (result.no_proxy === localBypass) delete result.no_proxy;
    if (result.NODE_USE_ENV_PROXY === '1') delete result.NODE_USE_ENV_PROXY;
  }
  delete result[bridgeMarker];
  delete result[sshMarker];
  return result;
}

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
  const base = createRelaunchEnvironment(environment, options.temporaryDirectory);
  const values = createSystemProxyEnvironment(proxy.origin, base);
  values[bridgeMarker] = proxy.origin;
  const keys: string[] = [...proxyEnvironmentKeys, bridgeMarker, sshMarker];
  let helperDirectory: string | undefined;
  let sshHelperPath: string | undefined;
  try {
    // GIT_SSH has lower precedence than core.sshCommand. An explicitly selected
    // transport remains authoritative, including custom SSH executables.
    if ((options.platform ?? process.platform) === 'darwin' && !base.GIT_SSH && !base.GIT_SSH_COMMAND) {
      const sshPath = options.sshPath ?? '/usr/bin/ssh';
      const netcatPath = options.netcatPath ?? '/usr/bin/nc';
      validateExecutablePath(sshPath);
      validateExecutablePath(netcatPath);
      helperDirectory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(), 'astragit-system-proxy-'));
      await chmod(helperDirectory, 0o700);
      sshHelperPath = join(helperDirectory, 'ssh');
      await writeFile(sshHelperPath, createSshHelper(sshPath, netcatPath, proxy.host), { mode: 0o700 });
      values.GIT_SSH = sshHelperPath;
      values[sshMarker] = sshHelperPath;
    }
  } catch (error) {
    if (helperDirectory) await rm(helperDirectory, { recursive: true, force: true });
    throw error;
  }
  if (values.GIT_SSH !== environment.GIT_SSH) keys.push('GIT_SSH');
  const previous = new Map(keys.map(key => [key, base[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete environment[key];
    else environment[key] = values[key];
  }
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
