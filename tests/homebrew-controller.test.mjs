import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomebrewUpdateController } from '../apps/desktop/src/main/homebrewUpdateController.ts';

const waitFor = async predicate => { const until = Date.now() + 3000; while (!predicate()) { if (Date.now() > until) assert.fail('Update controller did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); } };
function fixture(t) {
  const events = []; const states = []; let action; let accepted = false; let quit = false; let fail = false; let prepares = 0;
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', artifact: { sha256: 'a'.repeat(64), sizeBytes: 120_000 }, automaticInstallEnabled: false, reason: 'Unsigned direct channel' };
  const controller = createHomebrewUpdateController({
    helperPath: '/unused', language: () => 'zh-CN', currentVersion: '0.1.0', loadUpdateStatus: async () => update,
    direct: { manualInstallReason: async () => assert.fail('Homebrew must not use direct installation'), download: async () => assert.fail('Homebrew must use brew fetch') },
    homebrew: {
      isManaged: async () => true,
      prepare: async () => { prepares++; return { update, brewPath: '/brew', cachePath: '/cache', verifiedArtifact: {} }; },
      install: async () => { assert.equal(quit, false); events.push('brew-upgrade'); if (fail) throw new Error('installation failed'); return { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: '0.2.0' }; },
    },
    canInstall: () => {}, openDownloadPage: async () => assert.fail('No external navigation'),
    onInstallReady: async activate => { events.push('confirm'); if (!accepted) return false; await activate(); events.push('quit'); quit = true; return true; },
    createHost: async () => ({
      update: value => states.push(value), show: () => {}, close: () => {}, hide: () => {}, onExit: () => () => {},
      onAction: listener => { action = listener; return () => {}; },
      relaunchAfterProcessExit: input => { assert.equal(quit, false); assert.equal(input.pid, process.pid); assert.equal(input.version, '0.2.0'); events.push('native-relaunch'); },
    }),
  });
  t.after(() => controller.close());
  return { controller, events, states, action: value => action(value), accept: () => { accepted = true; }, fail: () => { fail = true; }, prepares: () => prepares };
}

test('native controller retains downloaded update on cancel, then installs and arms relaunch before quitting', async t => {
  const f = fixture(t); await f.controller.showOrCheck();
  f.action('download'); await waitFor(() => f.controller.getIndicatorState().phase === 'ready');
  f.action('restart'); await waitFor(() => f.events.length === 1 && f.controller.getIndicatorState().phase === 'ready');
  assert.deepEqual(f.events, ['confirm']); assert.equal(f.prepares(), 1);
  f.accept(); f.action('restart'); await waitFor(() => f.events.includes('quit'));
  assert.deepEqual(f.events, ['confirm', 'confirm', 'brew-upgrade', 'native-relaunch', 'quit']);
  assert.equal(f.prepares(), 1, 'Cancel preserves the same verified download.');
});

test('native controller leaves the old application open on installation failure and never retries installation automatically', async t => {
  const f = fixture(t); await f.controller.showOrCheck(); f.action('download');
  await waitFor(() => f.controller.getIndicatorState().phase === 'ready');
  f.accept(); f.fail(); f.action('restart'); await waitFor(() => f.controller.getIndicatorState().phase === 'failed');
  assert.deepEqual(f.events, ['confirm', 'brew-upgrade']);
  assert.equal(f.controller.getIndicatorState().failure.step, 'install');
  assert.equal(f.states.at(-1).canRetry, false);
  await f.controller.showOrCheck(); assert.deepEqual(f.events, ['confirm', 'brew-upgrade']);
});

test('automatic download has one owner and reopening the native window reuses its prepared result', async t => {
  const f = fixture(t);
  await f.controller.checkAutomatically(); assert.equal(f.controller.getIndicatorState().phase, 'ready');
  await f.controller.showOrCheck(); await f.controller.showOrCheck();
  assert.equal(f.prepares(), 1); assert.deepEqual(f.events, []);
});
