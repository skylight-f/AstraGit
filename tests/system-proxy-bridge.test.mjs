import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { startSystemProxyBridge } from '../apps/desktop/src/main/systemProxyBridge.ts';

async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  t.after(close);
  return { port: server.address().port, close };
}

async function bridgeFixture(t, resolveProxy) {
  const bridge = await startSystemProxyBridge({ resolveProxy });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await bridge.close();
  };
  t.after(close);
  return { ...bridge, close };
}

async function originFixture(t) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const received = { method: request.method, url: request.url, body: Buffer.concat(chunks).toString('base64') };
    requests.push(received);
    response.writeHead(200, { 'content-type': 'application/json', 'x-astragit-test-origin': 'yes' });
    response.end(JSON.stringify(received));
  });
  return { ...(await listen(t, server)), requests };
}

async function httpProxyFixture(t, destinationPort, label = 'proxy') {
  const requests = [];
  const tunnels = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, label });
    const target = new URL(request.url);
    const upstream = http.request({
      hostname: '127.0.0.1', port: destinationPort, path: `${target.pathname}${target.search}`,
      method: request.method, headers: { ...request.headers, 'x-astragit-test-proxy': label }, agent: false,
    }, remote => {
      response.writeHead(remote.statusCode, remote.headers);
      remote.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  server.on('connect', (request, socket, head) => {
    tunnels.push(request.url);
    const remote = net.createConnection({ host: '127.0.0.1', port: destinationPort });
    remote.on('error', () => socket.destroy());
    socket.once('close', () => remote.destroy());
    remote.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
    });
  });
  return { ...(await listen(t, server)), requests, tunnels };
}

async function socks5Fixture(t, destinationPort) {
  const requests = [];
  const server = net.createServer(socket => {
    let pending = Buffer.alloc(0);
    let state = 'greeting';
    const receive = chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (state === 'greeting') {
        if (pending.length < 2 || pending.length < 2 + pending[1]) return;
        assert.equal(pending[0], 5);
        assert.ok(pending.subarray(2, 2 + pending[1]).includes(0));
        pending = pending.subarray(2 + pending[1]);
        socket.write(Buffer.from([5, 0]));
        state = 'request';
      }
      if (state !== 'request' || pending.length < 5) return;
      const addressType = pending[3];
      const addressLength = addressType === 3 ? pending[4] : addressType === 1 ? 4 : 16;
      const addressOffset = addressType === 3 ? 5 : 4;
      const packetLength = addressOffset + addressLength + 2;
      if (pending.length < packetLength) return;
      assert.deepEqual([...pending.subarray(0, 3)], [5, 1, 0]);
      const host = addressType === 3 ? pending.subarray(addressOffset, addressOffset + addressLength).toString() : pending.subarray(addressOffset, addressOffset + addressLength).join('.');
      requests.push({ addressType, host, port: pending.readUInt16BE(packetLength - 2) });
      const initialData = pending.subarray(packetLength);
      state = 'connected';
      socket.off('data', receive);
      socket.pause();
      const remote = net.createConnection({ host: '127.0.0.1', port: destinationPort });
      remote.on('error', () => socket.destroy());
      socket.once('close', () => remote.destroy());
      remote.once('connect', () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        if (initialData.length) remote.write(initialData);
        socket.pipe(remote).pipe(socket);
        socket.resume();
      });
    };
    socket.on('data', receive);
  });
  return { ...(await listen(t, server)), requests };
}

async function socks4Fixture(t, destinationPort) {
  const requests = [];
  const server = net.createServer(socket => {
    let pending = Buffer.alloc(0);
    const receive = chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 10) return;
      const userEnd = pending.indexOf(0, 8);
      const hostEnd = userEnd < 0 ? -1 : pending.indexOf(0, userEnd + 1);
      if (hostEnd < 0) return;
      assert.deepEqual([...pending.subarray(0, 2)], [4, 1]);
      requests.push({ address: [...pending.subarray(4, 8)], host: pending.subarray(userEnd + 1, hostEnd).toString(), port: pending.readUInt16BE(2) });
      const initialData = pending.subarray(hostEnd + 1);
      socket.off('data', receive);
      socket.pause();
      const remote = net.createConnection({ host: '127.0.0.1', port: destinationPort });
      remote.on('error', () => socket.destroy());
      socket.once('close', () => remote.destroy());
      remote.once('connect', () => {
        socket.write(Buffer.from([0, 90, 0, 0, 127, 0, 0, 1]));
        if (initialData.length) remote.write(initialData);
        socket.pipe(remote).pipe(socket);
        socket.resume();
      });
    };
    socket.on('data', receive);
  });
  return { ...(await listen(t, server)), requests };
}

function localDnsMapping(t, hostname) {
  const originalLookup = dns.lookup;
  let lookups = 0;
  dns.lookup = (requestedHostname, options, callback) => {
    if (requestedHostname !== hostname) return originalLookup(requestedHostname, options, callback);
    lookups += 1;
    const done = typeof options === 'function' ? options : callback;
    queueMicrotask(() => typeof options === 'object' && options.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4));
  };
  t.after(() => { dns.lookup = originalLookup; });
  return () => lookups;
}

function requestViaBridge(proxyUrl, targetUrl, options = {}) {
  const bridge = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: bridge.hostname, port: bridge.port, path: targetUrl, method: options.method ?? 'GET',
      headers: { host: new URL(targetUrl).host, connection: 'close', ...options.headers }, agent: false,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.once('error', reject);
    request.setTimeout(4_000, () => request.destroy(new Error('Proxy test request timed out.')));
    request.end(options.body);
  });
}

function openTunnel(proxyUrl, target) {
  const bridge = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: bridge.hostname, port: Number(bridge.port) });
    let pending = Buffer.alloc(0);
    const receive = chunk => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.pause();
      socket.off('data', receive);
      const headers = pending.subarray(0, end).toString();
      if (!/^HTTP\/1\.[01] 200 /u.test(headers)) {
        socket.destroy();
        reject(new Error(`CONNECT rejected: ${headers}`));
        return;
      }
      if (pending.length > end + 4) socket.unshift(pending.subarray(end + 4));
      socket.setTimeout(0);
      resolve(socket);
    };
    socket.once('error', reject);
    socket.setTimeout(4_000, () => socket.destroy(new Error('CONNECT test timed out.')));
    socket.on('data', receive);
    socket.once('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  });
}

async function readHttpThroughTunnel(socket, path = '/tunnel') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('end', () => resolve(Buffer.concat(chunks).toString()));
    socket.resume();
    socket.write(`GET ${path} HTTP/1.1\r\nHost: remote.invalid\r\nConnection: close\r\n\r\n`);
  });
}

test('HTTP bridge preserves request bodies and resolves PAC routes for every destination', async t => {
  const origin = await originFixture(t);
  const first = await httpProxyFixture(t, origin.port, 'first');
  const second = await httpProxyFixture(t, origin.port, 'second');
  const resolved = [];
  let primary = first;
  const bridge = await bridgeFixture(t, async value => {
    resolved.push(value);
    const proxy = new URL(value).pathname.startsWith('/secondary') ? second : primary;
    return `PROXY 127.0.0.1:${proxy.port}`;
  });
  const body = Buffer.from([0, 1, 2, 255, 10, 13, 128]);
  const firstUrl = `http://remote.invalid:${origin.port}/primary?query=one`;
  const result = await requestViaBridge(bridge.proxyUrl, firstUrl, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-astragit-test-origin'], 'yes');
  assert.deepEqual(JSON.parse(result.body), { method: 'POST', url: '/primary?query=one', body: body.toString('base64') });
  const secondUrl = `http://other.invalid:${origin.port}/secondary`;
  assert.equal((await requestViaBridge(bridge.proxyUrl, secondUrl)).status, 200);
  primary = second;
  assert.equal((await requestViaBridge(bridge.proxyUrl, firstUrl)).status, 200);
  assert.deepEqual(first.requests.map(item => item.url), [firstUrl]);
  assert.deepEqual(second.requests.map(item => item.url), [secondUrl, firstUrl]);
  assert.deepEqual(resolved, [firstUrl, secondUrl, firstUrl]);
});

test('HTTP CONNECT relays an opaque stream through the resolved upstream proxy', async t => {
  const origin = await originFixture(t);
  const upstream = await httpProxyFixture(t, origin.port);
  const resolved = [];
  const bridge = await bridgeFixture(t, async value => { resolved.push(value); return `PROXY 127.0.0.1:${upstream.port}`; });
  const target = `remote.invalid:${origin.port}`;
  const socket = await openTunnel(bridge.proxyUrl, target);
  const response = await readHttpThroughTunnel(socket, '/connect?value=preserved');
  assert.match(response, /^HTTP\/1\.1 200 /u);
  assert.equal(origin.requests[0].url, '/connect?value=preserved');
  assert.deepEqual(upstream.tunnels, [target]);
  assert.equal(new URL(resolved[0]).hostname, 'remote.invalid');
  assert.equal(new URL(resolved[0]).port, String(origin.port));
});

test('SOCKS5 HTTP and CONNECT keep destination DNS resolution at the upstream proxy', async t => {
  const origin = await originFixture(t);
  const upstream = await socks5Fixture(t, origin.port);
  const bridge = await bridgeFixture(t, async () => `SOCKS5 127.0.0.1:${upstream.port}`);
  const result = await requestViaBridge(bridge.proxyUrl, `http://dns-only-at-proxy.invalid:${origin.port}/socks-http`);
  assert.equal(result.status, 200);
  const socket = await openTunnel(bridge.proxyUrl, `ssh-alias.invalid:${origin.port}`);
  assert.match(await readHttpThroughTunnel(socket, '/socks-connect'), /^HTTP\/1\.1 200 /u);
  assert.deepEqual(upstream.requests, [
    { addressType: 3, host: 'dns-only-at-proxy.invalid', port: origin.port },
    { addressType: 3, host: 'ssh-alias.invalid', port: origin.port },
  ]);
});

test('the PAC SOCKS token uses SOCKS4a remote hostname resolution', async t => {
  const origin = await originFixture(t);
  const upstream = await socks4Fixture(t, origin.port);
  const bridge = await bridgeFixture(t, async () => `SOCKS 127.0.0.1:${upstream.port}`);
  const result = await requestViaBridge(bridge.proxyUrl, `http://socks4-dns.invalid:${origin.port}/socks4`);
  assert.equal(result.status, 200);
  assert.deepEqual(upstream.requests, [{ address: [0, 0, 0, 1], host: 'socks4-dns.invalid', port: origin.port }]);
});

test('DIRECT from the system resolver reaches the destination without an upstream proxy', async t => {
  const origin = await originFixture(t);
  const lookups = localDnsMapping(t, 'system-direct.invalid');
  const resolved = [];
  const bridge = await bridgeFixture(t, async value => { resolved.push(value); return 'DIRECT; PROXY unavailable.invalid:443'; });
  const target = `http://system-direct.invalid:${origin.port}/system-direct`;
  assert.equal((await requestViaBridge(bridge.proxyUrl, target)).status, 200);
  assert.deepEqual(resolved, [target]);
  assert.equal(origin.requests[0].url, '/system-direct');
  assert.ok(lookups() > 0);
});

test('loopback destinations remain direct regardless of system proxy configuration', async t => {
  const origin = await originFixture(t);
  const upstream = await httpProxyFixture(t, origin.port);
  const bridge = await bridgeFixture(t, async () => `PROXY 127.0.0.1:${upstream.port}`);
  const result = await requestViaBridge(bridge.proxyUrl, `http://127.0.0.1:${origin.port}/local-api`);
  assert.equal(result.status, 200);
  assert.equal(origin.requests[0].url, '/local-api');
  assert.deepEqual(upstream.requests, []);
});

test('failed first PAC proxy never leaks a request through a later DIRECT entry', async t => {
  const origin = await originFixture(t);
  const unavailable = await listen(t, net.createServer());
  await unavailable.close();
  const directLookups = localDnsMapping(t, 'must-not-connect.invalid');
  const bridge = await bridgeFixture(t, async () => `PROXY 127.0.0.1:${unavailable.port}; DIRECT`);
  const result = await requestViaBridge(bridge.proxyUrl, `http://must-not-connect.invalid:${origin.port}/private`);
  assert.ok(result.status >= 500 && result.status < 600, `Expected an upstream failure, received ${result.status}`);
  assert.equal(directLookups(), 0);
  assert.deepEqual(origin.requests, []);
});

test('invalid or empty proxy resolutions fail without contacting the destination', async t => {
  for (const resolution of ['', 'QUIC proxy.invalid:443', 'SOCKS5 missing-port', 'PROXY 127.0.0.1:0']) {
    const bridge = await bridgeFixture(t, async () => resolution);
    const result = await requestViaBridge(bridge.proxyUrl, 'http://remote.invalid/request');
    assert.equal(result.status, 502, `Unexpected result for ${JSON.stringify(resolution)}`);
  }
});

test('the bridge rejects recursive destinations and itself as an upstream proxy', async t => {
  let upstreamUrl;
  const bridge = await bridgeFixture(t, async () => `PROXY ${new URL(upstreamUrl).host}`);
  upstreamUrl = bridge.proxyUrl;
  assert.equal((await requestViaBridge(bridge.proxyUrl, 'http://remote.invalid/recursive-upstream')).status, 502);
  assert.equal((await requestViaBridge(bridge.proxyUrl, `${bridge.proxyUrl}/recursive-target`)).status, 502);
});

test('closing the bridge terminates active CONNECT tunnels', async t => {
  const echo = await listen(t, net.createServer(socket => socket.on('data', chunk => socket.write(chunk))));
  const upstream = await httpProxyFixture(t, echo.port);
  const bridge = await bridgeFixture(t, async () => `PROXY 127.0.0.1:${upstream.port}`);
  const socket = await openTunnel(bridge.proxyUrl, `long-lived.invalid:${echo.port}`);
  t.after(() => socket.destroy());
  const echoed = new Promise((resolve, reject) => { socket.once('data', resolve); socket.once('error', reject); });
  socket.resume();
  socket.write('still-connected');
  assert.equal((await echoed).toString(), 'still-connected');
  const disconnected = new Promise(resolve => socket.once('close', resolve));
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Bridge did not close its active tunnel.')), 2_000);
  });
  try {
    await Promise.race([Promise.all([bridge.close(), disconnected]), deadline]);
    assert.equal(socket.destroyed, true);
  } finally { clearTimeout(timeout); socket.destroy(); }
});
