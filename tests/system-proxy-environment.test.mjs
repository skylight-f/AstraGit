import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { createSystemProxyEnvironment, installSystemProxyEnvironment } from '../apps/desktop/src/main/systemProxyEnvironment.ts';

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

test('installed environment restores original values and absent keys idempotently', async () => {
  const original = { HTTPS_PROXY: '', http_proxy: 'http://old:80', NO_PROXY: '*', NODE_USE_ENV_PROXY: '0', UNRELATED: 'preserved' };
  const environment = { ...original };
  const installed = await installSystemProxyEnvironment({ proxyUrl, environment, platform: 'linux' });
  assert.equal(installed.environment, environment);
  assert.equal(installed.sshHelperPath, undefined);
  for (const key of proxyKeys) assert.equal(environment[key], proxyUrl);
  installed.restore();
  assert.deepEqual(environment, original);
  installed.restore();
  await installed.close();
  await installed.close();
  assert.deepEqual(environment, original);
});

async function sshFixture(t, patch = {}) {
  const root = await mkdtemp(join(tmpdir(), "astragit proxy 'fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logPath = join(root, 'ssh-log.jsonl');
  const sshPath = join(root, "ssh command 'fixture");
  const netcatPath = join(root, "netcat command 'fixture");
  const netcatLogPath = join(root, 'netcat-log.json');
  await writeFile(sshPath, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.ASTRAGIT_SSH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === '-G') {
  if (process.env.ASTRAGIT_CONFIG_FAIL === '1') process.exit(1);
  console.log(process.env.ASTRAGIT_EFFECTIVE_SSH_CONFIG || 'hostname git.example\\nport 2222\\nproxycommand none\\nproxyjump none');
}
`, { mode: 0o700 });
  await writeFile(netcatPath, `#!${process.execPath}
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.ASTRAGIT_NETCAT_LOG, JSON.stringify(process.argv.slice(2)));
`, { mode: 0o700 });
  const environment = { ...process.env, ASTRAGIT_SSH_LOG: logPath, ASTRAGIT_NETCAT_LOG: netcatLogPath, ...patch };
  delete environment.GIT_SSH;
  delete environment.GIT_SSH_COMMAND;
  const installed = await installSystemProxyEnvironment({ proxyUrl, environment, platform: 'darwin', temporaryDirectory: root, sshPath, netcatPath });
  t.after(() => installed.close());
  const log = async () => (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse);
  return { root, environment, installed, log, sshPath, netcatLogPath };
}

test('SSH helper preserves host aliases, ports, options, and remote command boundaries', async t => {
  const fixture = await sshFixture(t);
  const args = ['-p', '2222', '-o', 'SendEnv=GIT_PROTOCOL', 'git@work-alias', "git-upload-pack 'repo with spaces.git'"];
  await execute(fixture.installed.sshHelperPath, args, { env: fixture.environment });
  const [inspection, connection] = await fixture.log();
  assert.deepEqual(inspection, ['-G', ...args]);
  assert.equal(connection[0], '-o');
  assert.ok(connection[1].startsWith('ProxyCommand='));
  assert.deepEqual(connection.slice(2), args);
  // Exercise both layers of shell quoting with executable paths containing
  // spaces and a quote, and OpenSSH's token substitution.
  const command = connection[1].slice('ProxyCommand='.length).replaceAll('%h', 'git.example').replaceAll('%p', '2222');
  await execute('/bin/sh', ['-c', command], { env: fixture.environment });
  assert.deepEqual(JSON.parse(await readFile(fixture.netcatLogPath, 'utf8')), ['-X', 'connect', '-x', '127.0.0.1:48123', 'git.example', '2222']);
  assert.equal((await stat(dirname(fixture.installed.sshHelperPath))).mode & 0o777, 0o700);
  assert.equal((await stat(fixture.installed.sshHelperPath)).mode & 0o777, 0o700);
  await fixture.installed.close();
  await assert.rejects(stat(fixture.installed.sshHelperPath), { code: 'ENOENT' });
});

test('SSH helper preserves effective ProxyJump and ProxyCommand user routing', async t => {
  for (const config of ['hostname git.internal\nproxyjump user@bastion:2222', 'hostname git.internal\nproxycommand custom-connect --target %h']) {
    const fixture = await sshFixture(t, { ASTRAGIT_EFFECTIVE_SSH_CONFIG: config });
    const args = ['-p', '2222', 'company-alias', 'git-upload-pack repo.git'];
    await execute(fixture.installed.sshHelperPath, args, { env: fixture.environment });
    assert.deepEqual(await fixture.log(), [['-G', ...args], args]);
  }
});

test('SSH configuration inspection failure does not silently fall back to direct networking', async t => {
  const fixture = await sshFixture(t, { ASTRAGIT_CONFIG_FAIL: '1' });
  await assert.rejects(execute(fixture.installed.sshHelperPath, ['company-alias'], { env: fixture.environment }), /could not inspect SSH proxy configuration/u);
  assert.deepEqual(await fixture.log(), [['-G', 'company-alias']]);
});

test('explicit SSH transports remain untouched', async () => {
  for (const transport of [{ GIT_SSH: '/custom/ssh', GIT_SSH_VARIANT: 'plink' }, { GIT_SSH_COMMAND: 'ssh -F custom-config' }]) {
    const environment = { ...transport };
    const installed = await installSystemProxyEnvironment({ proxyUrl, environment, platform: 'darwin' });
    assert.equal(installed.sshHelperPath, undefined);
    for (const [key, value] of Object.entries(transport)) assert.equal(environment[key], value);
    await installed.close();
    assert.deepEqual(environment, transport);
  }
});

test('Git retains explicit core.sshCommand precedence over the system SSH wrapper', async t => {
  const fixture = await sshFixture(t);
  const quotedPath = `'${fixture.sshPath.replaceAll("'", "'\\''")}'`;
  await assert.rejects(execute('git', ['-c', `core.sshCommand=${quotedPath}`, 'ls-remote', 'ssh://git@fixture.invalid/repo.git'], {
    cwd: fixture.root,
    env: { ...fixture.environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }));
  const commands = await fixture.log();
  assert.ok(commands.length > 0);
  assert.ok(commands.some(args => args.includes('git@fixture.invalid')));
  assert.ok(commands.every(args => args.every(argument => !argument.startsWith('ProxyCommand='))));
});
