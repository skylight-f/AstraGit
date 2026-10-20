import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { RequestError, Server } from 'proxy-chain';

export interface SystemProxyBridge {
  proxyUrl: string;
  close(): Promise<void>;
}

/** Keep Chromium's OS/PAC resolver authoritative for CLI HTTP and TCP tunnels. */
export async function startSystemProxyBridge(options: {
  resolveProxy: (url: string) => Promise<string>;
}): Promise<SystemProxyBridge> {
  // Never use Node's global agents: they may have inherited a shell proxy,
  // including this bridge, when NODE_USE_ENV_PROXY was enabled at startup.
  const httpAgent = new HttpAgent();
  const httpsAgent = new HttpsAgent();
  let closed = false;
  const server = new Server({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: async ({ request, hostname, port, isHttp }) => {
      if (closed) throw new RequestError('AstraGit system proxy is closing.', 503);
      // CONNECT is opaque TCP (HTTPS or SSH); use the system's HTTPS route.
      const target = new URL(isHttp ? request.url! : `https://${hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname}:${port}`);
      if (isLoopback(target.hostname) && port === server.port) {
        throw new RequestError('Recursive AstraGit proxy request.', 502);
      }
      let upstreamProxyUrl: string | null = null;
      if (!isLoopback(target.hostname)) {
        let policy: string;
        try {
          policy = await options.resolveProxy(target.href);
        } catch {
          throw new RequestError('Could not resolve the system proxy.', 502);
        }
        if (closed || request.destroyed) throw new RequestError('AstraGit proxy request was cancelled.', 503);
        upstreamProxyUrl = primaryProxy(policy);
        if (upstreamProxyUrl) {
          const upstream = new URL(upstreamProxyUrl);
          if (isLoopback(upstream.hostname) && Number(upstream.port) === server.port) {
            throw new RequestError('System proxy points back to AstraGit.', 502);
          }
        }
      }
      return { upstreamProxyUrl, httpAgent, httpsAgent };
    },
  });
  try {
    await server.listen();
  } catch (error) {
    httpAgent.destroy();
    httpsAgent.destroy();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    proxyUrl: `http://127.0.0.1:${server.port}`,
    close: () => {
      closed = true;
      closing ??= server.close(true).finally(() => {
        httpAgent.destroy();
        httpsAgent.destroy();
      });
      return closing;
    },
  };
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1'
    || /^127\.\d+\.\d+\.\d+$/u.test(host) || /^::ffff:7f[0-9a-f]{2}:/u.test(host);
}

function primaryProxy(policy: string): string | null {
  // Do not replay writes or silently fall back to DIRECT when a proxy fails.
  // A PAC list's first route is authoritative for this connection.
  const directive = policy.split(';')[0]?.trim() ?? '';
  if (directive === 'DIRECT') return null;
  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[0-9a-f:.]+\]|[a-z0-9._-]+):(\d+)$/iu.exec(directive);
  if (!match) throw new RequestError('Unsupported or empty system proxy configuration.', 502);
  const [, type, host, portText] = match;
  const port = Number(portText);
  if (port < 1 || port > 65535) throw new RequestError('Invalid system proxy port.', 502);
  // Chromium's PAC SOCKS token means SOCKS4; SOCKS5 keeps DNS at the proxy.
  const scheme = { PROXY: 'http', HTTP: 'http', HTTPS: 'https', SOCKS: 'socks4a', SOCKS4: 'socks4a', SOCKS5: 'socks5h' }[type!.toUpperCase()]!;
  try {
    return new URL(`${scheme}://${host}:${port}`).href;
  } catch {
    throw new RequestError('Invalid system proxy address.', 502);
  }
}
