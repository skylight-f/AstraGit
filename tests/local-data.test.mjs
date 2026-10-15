import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectStore } from '../packages/git-server/dist/projectStore.js';
import { OperationHistoryStore } from '../packages/git-server/dist/operationHistoryStore.js';
import { createApplicationSecretStore, createFileSecretStore, createMacOSKeychainStore } from '../packages/git-server/dist/securityCore.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-local-data-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('malformed project, history and credential data is preserved instead of replaced by empty stores', async t => {
  const root = await fixture(t);
  for (const malformed of ['{broken', '{}', '[{"id":"partial"}]']) {
    const path = join(root, 'projects.json');
    await writeFile(path, malformed);
    const store = new ProjectStore(root);
    assert.throws(() => store.list(), { code: 'ASTRAGIT_LOCAL_DATA_READ_FAILED' });
    assert.throws(() => store.create({ name: 'New project', localPath: root }), { code: 'ASTRAGIT_LOCAL_DATA_READ_FAILED' });
    assert.equal(await readFile(path, 'utf8'), malformed);
  }
  const historyPath = join(root, 'git-operation-history.json');
  await writeFile(historyPath, '{broken');
  const history = new OperationHistoryStore(root);
  assert.throws(() => history.list('project'), { code: 'ASTRAGIT_LOCAL_DATA_READ_FAILED' });
  assert.throws(() => history.start('project', 'repo', 'Repo', 'commit'), { code: 'ASTRAGIT_LOCAL_DATA_READ_FAILED' });
  assert.equal(await readFile(historyPath, 'utf8'), '{broken');
  const secretPath = join(root, 'secrets.json');
  await writeFile(secretPath, '{broken');
  const secrets = createFileSecretStore(secretPath);
  await assert.rejects(() => secrets.setSecret('account', 'fixture-key'), { code: 'ASTRAGIT_LOCAL_DATA_READ_FAILED' });
  assert.equal(await readFile(secretPath, 'utf8'), '{broken');
});

test('project aliases reuse identity and failed writes do not create phantom projects', async t => {
  const root = await fixture(t);
  const projectPath = join(root, 'project');
  const otherPath = join(root, 'other');
  await mkdir(projectPath); await mkdir(otherPath);
  const alias = join(root, 'alias');
  await symlink(projectPath, alias, 'dir');
  const store = new ProjectStore(root);
  const first = store.create({ name: 'Original', localPath: projectPath });
  assert.equal(store.create({ name: 'Alias', localPath: alias }).id, first.id);
  assert.equal(store.list().length, 1);
  const file = join(root, 'projects.json');
  await rename(file, `${file}.saved`); await mkdir(file);
  assert.throws(() => store.create({ name: 'Other', localPath: otherPath }), { code: 'ASTRAGIT_LOCAL_DATA_WRITE_FAILED' });
  assert.equal(store.list().length, 1);
  await rm(file, { recursive: true }); await rename(`${file}.saved`, file);
  store.create({ name: 'Other', localPath: otherPath });
  assert.equal(new ProjectStore(root).list().length, 2);
});

test('failed operation-history persistence does not claim a completed Git operation', async t => {
  const root = await fixture(t);
  const store = new OperationHistoryStore(root);
  const operation = store.start('project', 'repo', 'Repo', 'stage');
  const file = join(root, 'git-operation-history.json');
  await rename(file, `${file}.saved`); await mkdir(file);
  assert.throws(() => store.update(operation.id, { status: 'completed' }), { code: 'ASTRAGIT_LOCAL_DATA_WRITE_FAILED' });
  assert.equal(operation.status, 'running');
  assert.equal(store.list('project').items[0].status, 'running');
  assert.throws(() => store.start('project', 'repo', 'Repo', 'commit'), { code: 'ASTRAGIT_LOCAL_DATA_WRITE_FAILED' });
  assert.equal(store.list('project').total, 1);
  await rm(file, { recursive: true }); await rename(`${file}.saved`, file);
  store.update(operation.id, { status: 'completed' });
  assert.equal(operation.status, 'completed');
  assert.equal(new OperationHistoryStore(root).list('project').items[0].status, 'completed');
});

test('existing fallback credentials remain readable on restart and writes enforce 0600', async t => {
  const root = await fixture(t);
  const file = join(root, 'secrets.json');
  const store = createFileSecretStore(file);
  await store.setSecret('first', 'fixture-key-one');
  await chmod(file, 0o644);
  await store.setSecret('second', 'fixture-key-two');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  let nativeCalls = 0;
  const restarted = await createApplicationSecretStore(root, () => { nativeCalls += 1; throw new Error('No native store needed'); });
  assert.equal(nativeCalls, 0);
  assert.equal(await restarted.getSecret('first'), 'fixture-key-one');
  assert.equal(await restarted.getSecret('second'), 'fixture-key-two');
  await restarted.deleteSecret('first');
  assert.equal(await createFileSecretStore(file).getSecret('first'), undefined);
});

test('keychain command failure never echoes API keys through its error message', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'security'), '#!/bin/sh\nprintf "access denied\\n" >&2\nexit 1\n', { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${root}:${previousPath}`;
  try {
    await assert.rejects(() => createMacOSKeychainStore().setSecret('test-account', 'owned-test-credential'), error => {
      assert.match(error.message, /钥匙串保存失败/u);
      assert.ok(!JSON.stringify({ message: error.message, cause: error.cause }).includes('owned-test-credential'));
      return true;
    });
  } finally { process.env.PATH = previousPath; }
});
