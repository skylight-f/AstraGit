import assert from 'node:assert/strict';
import test from 'node:test';
import { configureChromiumStorage } from '../apps/desktop/src/main/chromiumStoragePolicy.ts';

test('macOS uses the user-approved Astra browser storage policy without disabling sandbox or web security', () => {
  const switches = [];
  configureChromiumStorage({ appendSwitch: name => switches.push(name) }, 'darwin');
  assert.deepEqual(switches, ['use-mock-keychain']);
});

test('other operating systems retain their native browser storage backend', () => {
  const switches = [];
  for (const platform of ['linux', 'win32']) configureChromiumStorage({ appendSwitch: name => switches.push(name) }, platform);
  assert.deepEqual(switches, []);
});
