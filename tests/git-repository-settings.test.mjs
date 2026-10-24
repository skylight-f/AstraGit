import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySettings } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd })).stdout.trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-settings-')); const cwd = join(root, 'repository'); await mkdir(cwd);
  const globalFile = join(root, 'global-config'); const globalText = '[user]\n\tname = Inherited Name\n\temail = inherited@astragit.invalid\n[private]\n\tsentinel = do-not-expose-other-configuration\n';
  await writeFile(globalFile, globalText);
  const before = { global: process.env.GIT_CONFIG_GLOBAL, noSystem: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = globalFile; process.env.GIT_CONFIG_NOSYSTEM = '1';
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); if (before.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = before.global; if (before.noSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = before.noSystem; await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '--initial-branch=main'); await git(cwd, 'config', 'commit.gpgsign', 'false');
  return { root, cwd, globalFile, globalText, cleanup, action: async value => executeProjectGitAction(cwd, { ...value, expectedSettingsFingerprint: (await getProjectGitRepositorySettings(cwd)).fingerprint }) };
}

test('repository identity supports overrides and inheritance without changing global config or staging source files', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'keep.txt'), 'unchanged');
  const inherited = await getProjectGitRepositorySettings(f.cwd); assert.equal(inherited.identity.name, 'Inherited Name'); assert.equal(inherited.identity.localName, null);
  assert.ok(!JSON.stringify(inherited).includes('do-not-expose-other-configuration'));
  await f.action({ type: 'set_identity_field', field: 'name', value: 'Local Name' });
  await f.action({ type: 'set_identity_field', field: 'email', value: 'local@astragit.invalid' });
  const local = await getProjectGitRepositorySettings(f.cwd); assert.equal(local.identity.name, 'Local Name'); assert.equal(local.identity.localEmail, 'local@astragit.invalid');
  await f.action({ type: 'set_identity_field', field: 'name', value: '--global' }); assert.equal(await git(f.cwd, 'config', '--get', 'user.name'), '--global');
  await f.action({ type: 'set_identity_field', field: 'name', value: null });
  assert.equal((await getProjectGitRepositorySettings(f.cwd)).identity.name, 'Inherited Name');
  assert.equal(await readFile(f.globalFile, 'utf8'), f.globalText); assert.equal(await git(f.cwd, 'status', '--porcelain'), '?? keep.txt');
});

test('remote settings add, rename, edit URLs and remove local tracking configuration without contacting the server', async t => {
  const f = await fixture(t);
  await f.action({ type: 'configure_remote', operation: 'add', name: 'origin', value: 'https://example.invalid/team/repository.git' });
  await git(f.cwd, 'config', '--add', 'remote.origin.url', 'https://example.invalid/team/secondary.git');
  await f.action({ type: 'configure_remote', operation: 'set_fetch_url', name: 'origin', value: 'ssh://git@example.invalid/team/repository.git' });
  assert.equal(await git(f.cwd, 'config', '--get-all', 'remote.origin.url'), 'ssh://git@example.invalid/team/repository.git\nhttps://example.invalid/team/secondary.git');
  await f.action({ type: 'configure_remote', operation: 'set_push_url', name: 'origin', value: 'https://push.invalid/team/repository.git' });
  assert.equal((await getProjectGitRepositorySettings(f.cwd)).remotes[0].pushUrls[0], 'https://push.invalid/team/repository.git');
  await f.action({ type: 'configure_remote', operation: 'clear_push_url', name: 'origin' }); assert.deepEqual((await getProjectGitRepositorySettings(f.cwd)).remotes[0].pushUrls, []);
  await f.action({ type: 'configure_remote', operation: 'rename', name: 'origin', value: 'upstream' }); assert.equal(await git(f.cwd, 'remote'), 'upstream');
  await f.action({ type: 'configure_remote', operation: 'remove', name: 'upstream' }); assert.equal(await git(f.cwd, 'remote'), '');
  assert.equal(await readFile(f.globalFile, 'utf8'), f.globalText);
});

test('settings reject stale snapshots, credential URLs and invalid identities before configuration changes', async t => {
  const f = await fixture(t); const settings = await getProjectGitRepositorySettings(f.cwd);
  await git(f.cwd, 'config', 'user.name', 'External change'); const config = await readFile(join(f.cwd, '.git/config'), 'utf8');
  await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'set_identity_field', field: 'name', value: 'Overwrite', expectedSettingsFingerprint: settings.fingerprint }), error => error.code === 'ASTRAGIT_GIT_SETTINGS_STALE' && error.operationStatus === 'failed_before_write');
  await assert.rejects(() => f.action({ type: 'configure_remote', operation: 'add', name: 'origin', value: 'https://token:password@example.invalid/repo' }), error => error.code === 'ASTRAGIT_GIT_REMOTE_CREDENTIALS_IN_URL');
  await assert.rejects(() => f.action({ type: 'set_identity_field', field: 'email', value: 'invalid\nemail' }), error => error.code === 'ASTRAGIT_GIT_IDENTITY_INVALID');
  assert.equal(await readFile(join(f.cwd, '.git/config'), 'utf8'), config);
});

test('inherited remotes are visible and redacted while repository editing cannot rewrite their external configuration', async t => {
  const f = await fixture(t);
  await writeFile(f.globalFile, f.globalText + '[remote "external"]\n\turl = https://user:private-token@example.invalid/repo\n\tfetch = +refs/heads/*:refs/remotes/external/*\n');
  const global = await readFile(f.globalFile, 'utf8');
  const settings = await getProjectGitRepositorySettings(f.cwd); assert.equal(settings.remotes[0].editable, false); assert.ok(!JSON.stringify(settings).includes('private-token'));
  await assert.rejects(() => f.action({ type: 'configure_remote', operation: 'remove', name: 'external' }), error => error.code === 'ASTRAGIT_GIT_REMOTE_INHERITED');
  assert.equal(await readFile(f.globalFile, 'utf8'), global);
});

test('editing a credential-bearing local remote keeps credentials out of settings and operation commands', async t => {
  const f = await fixture(t);
  await git(f.cwd, 'remote', 'add', 'origin', 'https://user:private-local-token@example.invalid/repo.git');
  const settings = await getProjectGitRepositorySettings(f.cwd); assert.ok(!JSON.stringify(settings).includes('private-local-token'));
  const commands = [];
  await executeProjectGitAction(f.cwd, { type: 'configure_remote', operation: 'set_fetch_url', name: 'origin', value: 'https://example.invalid/repo.git', expectedSettingsFingerprint: settings.fingerprint }, undefined, undefined, async command => { commands.push(command); });
  assert.ok(!commands.join('\n').includes('private-local-token'));
  assert.equal(await git(f.cwd, 'remote', 'get-url', 'origin'), 'https://example.invalid/repo.git');
});

test('remote rename preserves tracking relationships and remote removal leaves the source repository unchanged', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'keep.txt'), 'committed'); await git(f.cwd, 'add', '.'); await git(f.cwd, 'commit', '-m', 'fixture'); const head = await git(f.cwd, 'rev-parse', 'HEAD');
  await f.action({ type: 'configure_remote', operation: 'add', name: 'origin', value: 'https://example.invalid/repo.git' });
  await git(f.cwd, 'update-ref', 'refs/remotes/origin/main', head); await git(f.cwd, 'branch', '--set-upstream-to=origin/main', 'main');
  await f.action({ type: 'configure_remote', operation: 'rename', name: 'origin', value: 'upstream' });
  assert.equal(await git(f.cwd, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'upstream/main');
  await f.action({ type: 'configure_remote', operation: 'remove', name: 'upstream' });
  assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), head); assert.equal(await readFile(join(f.cwd, 'keep.txt'), 'utf8'), 'committed');
});

test('HTTP settings route and guarded actions operate on the selected repository and enter the durable operation log', async t => {
  const f = await fixture(t); const data = join(f.root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'settings-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Settings fixture', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const settings = await client.loadProjectGitRepositorySettings(project.id, repository.id);
  await client.executeProjectGitAction(project.id, repository.id, { type: 'set_identity_field', field: 'name', value: 'HTTP Local', expectedSettingsFingerprint: settings.fingerprint });
  assert.equal((await client.loadProjectGitRepositorySettings(project.id, repository.id)).identity.localName, 'HTTP Local');
  assert.equal((await client.loadProjectGitOperations(project.id)).items[0].action, 'set_identity_field');
  await assert.rejects(() => client.loadProjectGitRepositorySettings(project.id, 'unknown-repository'));
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'set_identity_field', field: 'hooksPath', value: '/tmp/arbitrary', expectedSettingsFingerprint: settings.fingerprint }));
  assert.equal(await readFile(f.globalFile, 'utf8'), f.globalText);
});
