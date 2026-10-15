import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationIdentity } from '../apps/desktop/src/main/applicationIdentity.ts';

const paths = { appPath: '/workspace/AstraGit/apps/desktop', appDataPath: '/user/Library/Application Support' };

test('development restarts share an identity without using installed Safe Storage or data', () => {
  const options = { ...paths, packaged: false, rendererUrl: 'http://127.0.0.1:5179/' };
  const first = applicationIdentity(options);
  const restarted = applicationIdentity({ ...options, rendererUrl: 'http://127.0.0.1:5180/', userDataDirectory: '/tmp/review-data' });
  assert.equal(first.development, true);
  assert.match(first.name, /^AstraGit Development /u);
  assert.notEqual(`${first.name} Safe Storage`, 'AstraGit Safe Storage');
  assert.equal(first.name, restarted.name);
  assert.equal(first.dataDirectory, '/workspace/AstraGit/.tmp/electron-development-data');
  assert.equal(restarted.dataDirectory, '/tmp/review-data');
  const otherCheckout = applicationIdentity({ ...options, appPath: '/workspace/other-checkout/apps/desktop' });
  assert.notEqual(first.name, otherCheckout.name);
});

test('packaged identity and data are unchanged even if a Vite environment is inherited', () => {
  const identity = applicationIdentity({ ...paths, packaged: true, rendererUrl: 'http://127.0.0.1:5179/' });
  assert.equal(identity.development, false);
  assert.equal(identity.name, 'AstraGit');
  assert.equal(identity.dataDirectory, '/user/Library/Application Support/AstraGit');
  assert.equal(applicationIdentity({ ...paths, packaged: true, userDataDirectory: '/tmp/acceptance-data' }).dataDirectory, '/tmp/acceptance-data');
});
