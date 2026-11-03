import assert from 'node:assert/strict';
import test from 'node:test';
import { createCachedSecretStore } from '../packages/git-server/dist/securityCore.js';

test('parallel metadata and model queries share one native credential read per account', async () => {
  let calls = 0;
  let complete;
  const store = createCachedSecretStore({ getSecret: () => { calls++; return new Promise(resolve => { complete = resolve; }); }, setSecret: async () => {}, deleteSecret: async () => {} });
  const requests = Array.from({ length: 20 }, () => store.getSecret('model'));
  await Promise.resolve(); assert.equal(calls, 1);
  complete('fixture-key');
  assert.deepEqual(await Promise.all(requests), Array(20).fill('fixture-key'));
  assert.equal(await store.getSecret('model'), 'fixture-key'); assert.equal(calls, 1);
});

test('denied authorization is not automatically re-prompted and a successful save recovers the same session', async () => {
  let calls = 0;
  const store = createCachedSecretStore({ getSecret: async () => { calls++; throw new Error('authorization denied'); }, setSecret: async () => {}, deleteSecret: async () => {} });
  for (let i = 0; i < 5; i++) await assert.rejects(store.getSecret('model'), /authorization denied/u);
  assert.equal(calls, 1);
  await store.setSecret('model', 'replacement'); assert.equal(await store.getSecret('model'), 'replacement'); assert.equal(calls, 1);
  await store.deleteSecret('model'); assert.equal(await store.getSecret('model'), undefined); assert.equal(calls, 1);
});

test('a late native read cannot overwrite a subsequently saved credential', async () => {
  let complete;
  const store = createCachedSecretStore({ getSecret: () => new Promise(resolve => { complete = resolve; }), setSecret: async () => {}, deleteSecret: async () => {} });
  const reading = store.getSecret('model'); await Promise.resolve();
  await store.setSecret('model', 'new-key'); complete('old-key');
  assert.equal(await reading, 'old-key'); assert.equal(await store.getSecret('model'), 'new-key');
});
