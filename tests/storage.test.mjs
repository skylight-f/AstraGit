import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArtifactStore, CommandDeliveryRepository, SettingRepository, createAstraGitDatabase } from '../packages/storage/dist/index.js';
import { canonicalCommandInputJson, commandEnvelopeSchemaGeneration } from '../packages/shared/dist/index.js';
import { createHash } from 'node:crypto';
import { GitCommandApplication } from '../packages/git-server/dist/gitCommandApplication.js';
import { createCodexAppServerManager } from '../packages/ai-runtime/dist/index.js';

test('AstraGit initializes its own schema and preserves settings across restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-storage-'));
  let db;
  t.after(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });
  const file = join(root, 'git-app.db');
  db = await createAstraGitDatabase(file);
  const tables = db.select("SELECT name FROM sqlite_master WHERE type = 'table'").map((table) => table.name);
  assert.ok(tables.includes('settings') && tables.includes('command_inbox') && tables.includes('artifact_objects'));
  assert.ok(!tables.some((name) => /^(?:projects|tasks|conversations|digital_employees)$/u.test(name)));
  const settings = new SettingRepository(db);
  settings.setJson('models.connections', [{ id: 'own_connection', name: 'AstraGit model' }]);
  await db.save();
  await db.close();
  db = await createAstraGitDatabase(file);
  assert.equal(new SettingRepository(db).getJson('models.connections')[0].name, 'AstraGit model');
  const other = await createAstraGitDatabase(join(root, 'other-app', 'git-app.db'));
  try {
    assert.equal(new SettingRepository(other).getJson('models.connections'), undefined);
  } finally {
    await other.close();
  }
});

test('savepoint and durable rollback discard writes and commit notifications', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-transactions-'));
  const db = await createAstraGitDatabase(join(root, 'git-app.db'));
  t.after(async () => { await db.close(); await rm(root, { recursive: true, force: true }); });
  const settings = new SettingRepository(db);
  let notifications = 0;
  settings.setJson('outer', 'preserved');
  db.afterCommit(() => { notifications += 1; });
  assert.throws(() => db.transaction(() => {
    settings.setJson('inner', 'discarded');
    db.afterCommit(() => { notifications += 100; });
    throw new Error('Savepoint failed');
  }), /Savepoint failed/u);
  assert.equal(notifications, 0);
  await db.save();
  assert.equal(notifications, 1);
  assert.equal(settings.getJson('inner'), undefined);
  assert.equal(settings.getJson('outer'), 'preserved');
  assert.throws(() => db.durableTransactionSync(() => {
    settings.setJson('durable', 'discarded');
    db.afterCommit(() => { notifications += 100; });
    throw new Error('Durable operation failed');
  }), /Durable operation failed/u);
  assert.equal(settings.getJson('durable'), undefined);
  assert.equal(notifications, 1);
  db.durableTransactionSync(() => db.commitCriticalFactSync(() => settings.setJson('durable', 'committed')));
  assert.equal(settings.getJson('durable'), 'committed');
});

for (const generation of [commandEnvelopeSchemaGeneration, 'zeus-command-envelope-v1']) {
  test(`accepted ${generation} commands replay after restart without repeating the side effect`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'astragit-command-replay-'));
    let db;
    t.after(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });
    async function application() {
      db = await createAstraGitDatabase(join(root, 'git-app.db'));
      const artifacts = new ArtifactStore(db, join(root, 'artifacts'));
      await artifacts.initialize();
      return new GitCommandApplication({ db, artifacts, deliveries: new CommandDeliveryRepository(db), redactSensitiveText: (text) => ({ text }), now: () => new Date() });
    }
    const input = { projectId: 'own_project', value: 'test' };
    const inputSha256 = createHash('sha256').update(canonicalCommandInputJson(input)).digest('hex');
    const request = {
      command: {
        schemaGeneration: generation,
        commandId: 'astragit_test_command', commandType: 'git.operation.execute',
        actor: { kind: 'local_api', id: 'astragit-test' },
        scope: { kind: 'git_repository', id: 'own_repository' }, expectedRevision: null,
        idempotencyKey: 'git.operation.execute:own_operation', issuedAt: new Date().toISOString(),
        payload: { operationIdentity: 'own_operation', inputSha256 },
      }, input,
    };
    let effects = 0;
    let app = await application();
    const execute = () => app.executeExternal({
      parsed: app.parse({ value: request, commandType: 'git.operation.execute', scopeKind: 'git_repository', expectedScopeId: () => 'own_repository' }),
      destinationId: 'git', resourceId: 'own_repository', externalOperationId: 'own_operation',
      invoke: async () => { effects += 1; return { message: 'saved' }; },
      mutateAcceptedBusinessState: () => {},
    });
    assert.equal((await execute()).replayed, false);
    await db.close();
    app = await application();
    const replay = await execute();
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, { message: 'saved' });
    assert.equal(effects, 1);
  });
}

test('Codex cannot fall back to an inherited data directory', () => {
  assert.throws(() => createCodexAppServerManager({ codexHome: '' }), { code: 'ASTRAGIT_CODEX_HOME_INVALID' });
  assert.throws(() => createCodexAppServerManager({ codexHome: 'relative-home' }), { code: 'ASTRAGIT_CODEX_HOME_INVALID' });
});

test('Codex starts a CLI handshake with a new, independent home and AstraGit identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-codex-startup-'));
  const home = join(root, 'brand-new-home');
  const command = join(root, 'codex-test');
  await cp(new URL('./fixtures/codex-app-server.mjs', import.meta.url), command);
  await chmod(command, 0o755);
  const manager = createCodexAppServerManager({ codexHome: home, lightweightGeneration: true, runtimeEnvironment: { PATH: process.env.PATH ?? '' } });
  t.after(async () => { await manager.close(); await rm(root, { recursive: true, force: true }); });
  const capabilities = await manager.ensureReady({ commandPath: command });
  assert.deepEqual(capabilities.supportedModels, ['codex-test']);
  assert.equal((await stat(home)).mode & 0o777, 0o700);
  assert.equal(JSON.parse(await readFile(join(home, 'client-info.json'), 'utf8')).name, 'astragit');
  const account = await manager.readAccount();
  assert.equal(account.signedIn, false);
  assert.equal(account.requiresOpenaiAuth, true);
});
