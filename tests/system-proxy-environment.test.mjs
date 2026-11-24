import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { createRelaunchEnvironment, createSystemProxyEnvironment, installSystemProxyEnvironment } from '../apps/desktop/src/main/systemProxyEnvironment.ts';

const execute = promisify(execFile);
const proxyUrl = 'http://127.0.0.1:48123';
const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

test('system proxy environment replaces stale shell routing while preserving unrelated settings', () => {
  const original = { PATH: '/fixture/bin', HTTPS_PROXY: 'http://old.example:3128', no_proxy: '*', NO_PROXY: '.example.com', NODE_USE_ENV_PROXY: '0', GIT_SSH_COMMAND: 'custom-ssh -F fixture' };
  const environment = createSystemProxyEnvironment(`${proxyUrl}/`, original);
  for (const key of proxyKeys) assert.equal(environment[key], proxyUrl);
  assert.equal(environment.NO_PROXY, 'localhost,127.0.0.1,::1');
  assert.equal(environment.no_proxy, environment.NO_PROXY);
  assert.equal(environment.NODE_USE_ENV_PROXY, '1');
  assert.equal(environment.PATH, original.PATH);
  assert.equal(environment.GIT_SSH_COMMAND, original.GIT_SSH_COMMAND);
  assert.equal(original.HTTPS_PROXY, 'http://old.example:3128');
  assert.equal(original.no_proxy, '*');
});

test('proxy environments reject nonlocal, credentialed, and malformed bridge addresses', () => {
  for (const value of ['https://127.0.0.1:1234', 'http://example.com:1234', 'http://127.0.0.1', 'http://user:secret@127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://127.0.0.1:1234/?query', 'http://127.0.0.1:1234/#fragment']) {
    assert.throws(() => createSystemProxyEnvironment(value, {}), /System proxy bridge/u, value);
  }
});

test('installing the HTTP proxy leaves Git using its default SSH transport', () => {
  const original = { HTTPS_PROXY: '', http_proxy: 'http://old:80', NO_PROXY: '*', NODE_USE_ENV_PROXY: '0', SSH_AUTH_SOCK: '/agent/socket' };
  const environment = { ...original };
  const installed = installSystemProxyEnvironment({ proxyUrl, environment });
  assert.equal(installed.environment, environment);
  for (const key of proxyKeys) assert.equal(environment[key], proxyUrl);
  for (const key of ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'ASTRAGIT_SYSTEM_PROXY_SSH_HELPER']) assert.ok(!(key in environment), key);
  assert.equal(environment.SSH_AUTH_SOCK, original.SSH_AUTH_SOCK);
  installed.restore();
  installed.restore();
  assert.deepEqual(environment, original);
});

test('explicit SSH transports remain untouched', () => {
  for (const transport of [{ GIT_SSH: '/custom/ssh', GIT_SSH_VARIANT: 'plink' }, { GIT_SSH_COMMAND: 'ssh -F custom-config' }]) {
    const environment = { ...transport };
    const installed = installSystemProxyEnvironment({ proxyUrl, environment });
    for (const [key, value] of Object.entries(transport)) assert.equal(environment[key], value);
    installed.restore();
    assert.deepEqual(environment, transport);
  }
});

test('starting with a legacy SSH helper clears it without restoring it on exit', () => {
  const oldHelper = join(tmpdir(), 'astragit-system-proxy-Ab12CD', 'ssh');
  for (const marker of [{}, { ASTRAGIT_SYSTEM_PROXY_SSH_HELPER: oldHelper }]) {
    const environment = { GIT_SSH: oldHelper, ...marker };
    const installed = installSystemProxyEnvironment({ proxyUrl, environment });
    assert.ok(!('GIT_SSH' in environment));
    assert.ok(!('GIT_SSH_COMMAND' in environment));
    assert.ok(!('ASTRAGIT_SYSTEM_PROXY_SSH_HELPER' in environment));
    installed.restore();
    assert.deepEqual(environment, {});
  }
});

test('Git uses core.sshCommand for upload-pack and receive-pack after a legacy upgrade', async () => {
  const environment = { ...process.env, GIT_SSH: join(tmpdir(), 'astragit-system-proxy-Ab12CD', 'ssh'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete environment.GIT_SSH_COMMAND;
  installSystemProxyEnvironment({ proxyUrl, environment });
  // Use Git's real transports against this checkout. A dry-run exercises the push handshake.
  const remote = 'ssh://git@astragit.invalid/repository';
  const git = (...args) => execute('git', args, { env: environment });
  const { stdout: head } = await git('rev-parse', 'HEAD');
  const { stdout: advertised } = await git('-c', "core.sshCommand=sh -c 'exec git upload-pack .'", '-c', 'ssh.variant=ssh', 'ls-remote', '--exit-code', remote, 'HEAD');
  assert.ok(advertised.trim().split('\n').includes(head.trim() + '\tHEAD'));
  await git('-c', "core.sshCommand=sh -c 'exec git receive-pack .'", '-c', 'ssh.variant=ssh', 'push', '--dry-run', '--no-verify', remote, 'HEAD:refs/heads/astragit-ssh-dry-run');
});

test('relaunching removes only application-owned routing and preserves the live process', () => {
  const oldHelper = join(tmpdir(), 'astragit-system-proxy-Ab12CD', 'ssh');
  const environment = { ...createSystemProxyEnvironment(proxyUrl, { ASTRAGIT_USER_DATA_DIR: '/fixture/profile' }), GIT_SSH: oldHelper, ASTRAGIT_SYSTEM_PROXY_SSH_HELPER: oldHelper, ASTRAGIT_SYSTEM_PROXY_URL: proxyUrl };
  const before = { ...environment };
  assert.deepEqual(createRelaunchEnvironment(environment), { ASTRAGIT_USER_DATA_DIR: '/fixture/profile' });
  assert.deepEqual(environment, before);
  const configured = { ...before, GIT_SSH: '/custom/ssh', GIT_SSH_COMMAND: 'custom-ssh -F company-config', HTTPS_PROXY: 'http://user-proxy.example:80' };
  const outgoing = createRelaunchEnvironment(configured);
  assert.equal(outgoing.GIT_SSH, configured.GIT_SSH);
  assert.equal(outgoing.GIT_SSH_COMMAND, configured.GIT_SSH_COMMAND);
  assert.equal(outgoing.HTTPS_PROXY, configured.HTTPS_PROXY);
});

test('legacy helper recognition handles macOS temp aliases while retaining similarly named user tools', () => {
  const helper = '/var/folders/fixture/T/astragit-system-proxy-Ab12CD/ssh';
  assert.equal(createRelaunchEnvironment({ GIT_SSH: helper }, '/private/var/folders/fixture/T').GIT_SSH, undefined);
  assert.equal(createRelaunchEnvironment({ GIT_SSH: '/private' + helper }, '/var/folders/fixture/T').GIT_SSH, undefined);
  for (const path of ['/custom/astragit-system-proxy-Ab12CD/ssh', '/var/folders/fixture/T/astragit-system-proxy-custom-tool/ssh', '/var/folders/fixture/T/ssh', 'ssh']) {
    assert.equal(createRelaunchEnvironment({ GIT_SSH: path }, '/var/folders/fixture/T').GIT_SSH, path);
  }
  const custom = { GIT_SSH: '/custom/ssh', HTTPS_PROXY: 'http://127.0.0.1:48123', NO_PROXY: 'localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '1' };
  assert.deepEqual(createRelaunchEnvironment(custom), custom, 'unmarked user proxy settings must not be guessed from localhost addresses');
});
