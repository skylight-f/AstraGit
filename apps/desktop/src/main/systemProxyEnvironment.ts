import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const proxyEnvironmentKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY'] as const;
const localBypass = 'localhost,127.0.0.1,::1';
const bridgeMarker = 'ASTRAGIT_SYSTEM_PROXY_URL';
const sshMarker = 'ASTRAGIT_SYSTEM_PROXY_SSH_HELPER';

function isApplicationSshHelper(value: string | undefined, marker: string | undefined, temporaryDirectory: string): boolean {
  if (!value || !isAbsolute(value) || basename(value) !== 'ssh' || !/^astragit-system-proxy-[A-Za-z0-9]{6}$/u.test(basename(dirname(value)))) return false;
  // Older releases installed an SSH helper, sometimes without an ownership marker.
  // Only recognize unmarked helpers inside this user's temporary directory.
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
}

export interface InstalledSystemProxyEnvironment {
  environment: NodeJS.ProcessEnv;
  /** Restore variables after all users of the proxy have stopped. */
  restore(): void;
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

export function installSystemProxyEnvironment(options: SystemProxyEnvironmentOptions): InstalledSystemProxyEnvironment {
  const environment = options.environment ?? process.env;
  const base = createRelaunchEnvironment(environment);
  const values = createSystemProxyEnvironment(options.proxyUrl, base);
  values[bridgeMarker] = values.HTTP_PROXY;
  const keys: string[] = [...proxyEnvironmentKeys, bridgeMarker, sshMarker];
  // Leave SSH transport selection to Git. Only remove a helper inherited from an older AstraGit.
  if (base.GIT_SSH !== environment.GIT_SSH) keys.push('GIT_SSH');
  const previous = new Map(keys.map(key => [key, base[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete environment[key];
    else environment[key] = values[key];
  }
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [key, value] of previous) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  };
  return { environment, restore };
}

function validateProxyUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('System proxy bridge must use an HTTP URL on 127.0.0.1 with an explicit port.');
  }
  return url;
}
