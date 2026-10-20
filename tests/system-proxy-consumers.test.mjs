import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHomebrewUpdateService } from '../apps/desktop/src/main/homebrewUpdateService.ts';
import { installSystemProxyEnvironment } from '../apps/desktop/src/main/systemProxyEnvironment.ts';
import { createCodexAppServerManager } from '../packages/ai-runtime/dist/index.js';

const proxyUrl = 'http://127.0.0.1:18897';
const bypass = 'localhost,127.0.0.1,::1';
const proxyEnvironment = {
  HTTP_PROXY: proxyUrl,
  http_proxy: proxyUrl,
  HTTPS_PROXY: proxyUrl,
  https_proxy: proxyUrl,
  ALL_PROXY: proxyUrl,
  all_proxy: proxyUrl,
  NO_PROXY: bypass,
  no_proxy: bypass,
  NODE_USE_ENV_PROXY: '1',
};
const proxyKeys = Object.keys(proxyEnvironment);

function setEnvironment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-proxy-consumers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function installProxyEnvironment(t) {
  const installed = await installSystemProxyEnvironment({ proxyUrl, platform: 'linux' });
  t.after(() => installed.close());
}

function assertProxyEnvironment(actual) {
  assert.deepEqual(actual, proxyEnvironment, 'Both proxy variable casings and local bypasses must survive the production spawn boundary.');
}

test('Homebrew receives the application proxy environment and a download failure never becomes a prepared update', { skip: process.platform !== 'darwin' }, async t => {
  const root = await temporaryDirectory(t);
  const appPath = join(root, 'Applications', 'AstraGit.app');
  const plistPath = join(appPath, 'Contents', 'Info.plist');
  await mkdir(join(appPath, 'Contents'), { recursive: true });
  const installedIdentity = { CFBundleIdentifier: 'com.astragit.desktop', CFBundleShortVersionString: '0.1.0', CFBundleVersion: '0.1.0' };
  await writeFile(plistPath, JSON.stringify(installedIdentity));
  const logPath = join(root, 'brew.jsonl');
  const brewPath = join(root, 'brew.mjs');
  await writeFile(brewPath, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const environment = Object.fromEntries(${JSON.stringify(proxyKeys)}.map(key => [key, process.env[key]]));
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, environment }) + '\\n');
if (args[0] === 'list') {
  console.log('astragit 0.1.0');
} else if (args[0] === 'info') {
  console.log(JSON.stringify({ casks: [{
    token: 'astragit', tap: 'skylight-f/tap', installed: '0.1.0',
    artifacts: [{ app: ['AstraGit.app'], target: ${JSON.stringify(appPath)} }]
  }] }));
} else if (args[0] === 'upgrade') {
  console.error('curl: (7) Failed to connect to fixture proxy: Connection refused');
  process.exitCode = 7;
} else {
  throw new Error('Unexpected Homebrew command: ' + args.join(' '));
}
`, { mode: 0o755 });
  setEnvironment(t, { ASTRAGIT_HOMEBREW_BIN: brewPath });
  await installProxyEnvironment(t);
  const service = createHomebrewUpdateService({
    currentAppPath: appPath,
    currentAppVersion: '0.1.0',
    bundleId: 'com.astragit.desktop',
    testMode: true,
  });
  assert.equal(await service.isManaged(), true);
  const phases = [];
  await assert.rejects(
    service.prepare({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      installMethod: 'homebrew',
      artifact: null,
      releasePageUrl: 'https://example.invalid/releases/v0.2.0',
      automaticInstallEnabled: false,
      reason: '',
    }, progress => phases.push(progress.phase)),
    /Failed to connect to fixture proxy/u,
  );
  const entries = (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(entries.map(entry => entry.args[0]), ['list', 'info', 'info', 'upgrade']);
  for (const entry of entries) assertProxyEnvironment(entry.environment);
  assert.deepEqual(entries.at(-1).args, ['upgrade', '--cask', 'skylight-f/tap/astragit']);
  assert.deepEqual(phases, ['installing'], 'Failed network work must not reach installation verification.');
  assert.deepEqual(JSON.parse(await readFile(plistPath, 'utf8')), installedIdentity);
});

async function codexFixture(t, failCatalog = false) {
  const root = await temporaryDirectory(t);
  const commandPath = join(root, 'codex.mjs');
  const environmentPath = join(root, 'codex-environment.json');
  const home = join(root, 'codex-home');
  const recorder = `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(environmentPath)}, JSON.stringify({
  args: process.argv.slice(2),
  environment: Object.fromEntries(${JSON.stringify(proxyKeys)}.map(key => [key, process.env[key]])),
  codexHome: process.env.CODEX_HOME
}));
`;
  const body = failCatalog ? `
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const response = request.method === 'initialize'
    ? { id: request.id, result: { userAgent: 'astragit-test', codexHome: process.env.CODEX_HOME } }
    : { id: request.id, error: { code: -32001, message: 'Model catalog proxy connection failed: ECONNREFUSED' } };
  process.stdout.write(JSON.stringify(response) + '\\n');
});
` : `await import(${JSON.stringify(new URL('./fixtures/codex-app-server.mjs', import.meta.url).href)});\n`;
  await writeFile(commandPath, recorder + body, { mode: 0o755 });
  await installProxyEnvironment(t);
  const manager = createCodexAppServerManager({
    codexHome: home,
    lightweightGeneration: true,
    runtimeEnvironment: { PATH: process.env.PATH ?? '' },
    requestTimeoutMs: 2_000,
    shutdownTimeoutMs: 500,
  });
  t.after(() => manager.close());
  return { manager, commandPath, home, environment: async () => JSON.parse(await readFile(environmentPath, 'utf8')) };
}

test('Codex native stdio startup inherits proxy variables while retaining its independent application home', async t => {
  const fixture = await codexFixture(t);
  try {
    const capabilities = await fixture.manager.ensureReady({ commandPath: fixture.commandPath });
    assert.deepEqual(capabilities.supportedModels, ['codex-test']);
    assert.equal(fixture.manager.getState().type, 'ready');
    const inherited = await fixture.environment();
    assertProxyEnvironment(inherited.environment);
    assert.deepEqual(inherited.args, ['app-server', '--listen', 'stdio://']);
    assert.equal(inherited.codexHome, fixture.home);
    assert.equal((await fixture.manager.readAccount()).signedIn, false);
  } finally {
    await fixture.manager.close();
  }
});

test('Codex catalog network failure remains unavailable even when the proxy environment reached its process', async t => {
  const fixture = await codexFixture(t, true);
  try {
    await assert.rejects(
      fixture.manager.ensureReady({ commandPath: fixture.commandPath }),
      /Model catalog proxy connection failed: ECONNREFUSED/u,
    );
    assert.notEqual(fixture.manager.getState().type, 'ready');
    assertProxyEnvironment((await fixture.environment()).environment);
  } finally {
    await fixture.manager.close();
  }
});
