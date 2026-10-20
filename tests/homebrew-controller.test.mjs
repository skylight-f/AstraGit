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

function actionFixture(t, input = {}) {
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', artifact: { sha256: 'b'.repeat(64), sizeBytes: 120_000 }, automaticInstallEnabled: true, ...input.update };
  const events = []; const states = []; let action; let hosts = 0; let prepares = 0; let accepted = false; let failPrepare = input.failPrepare; let checks = 0;
  const controller = createHomebrewUpdateController({
    helperPath: '/unused', language: () => 'zh-CN', currentVersion: '0.1.0',
    loadUpdateStatus: async () => { checks++; if (input.checkError) throw input.checkError; return update; },
    direct: {
      manualInstallReason: async () => input.manual ? 'Manual installation required' : null,
      download: async () => { events.push('direct-download'); return { accepted: true, update }; },
      install: async () => { events.push('direct-install'); return { accepted: true, restartAccepted: true }; },
    },
    homebrew: {
      isManaged: async () => !input.manual,
      prepare: async (_update, progress) => {
        prepares++; events.push('prepare');
        progress({ phase: 'downloading', downloadedBytes: 1, totalBytes: 2 });
        await input.waitForPrepare;
        if (failPrepare) throw new Error('download checksum did not match');
        return { update, brewPath: '/brew', cachePath: '/cache', verifiedArtifact: {} };
      },
      install: async () => { events.push('brew-upgrade'); if (input.failInstall) throw new Error('installation failed'); return { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: '0.2.0' }; },
    },
    canInstall: () => {}, openDownloadPage: async () => events.push('open-release'),
    onInstallReady: async activate => { events.push('confirm'); if (!accepted) return false; await activate(); events.push('quit'); return true; },
    createHost: async () => {
      hosts++;
      return {
        update: state => states.push(state), show: () => events.push('show'), close: () => {}, hide: () => {}, onExit: () => () => {},
        onAction: listener => { action = listener; return () => {}; }, relaunchAfterProcessExit: () => events.push('relaunch'),
      };
    },
  });
  t.after(() => controller.close());
  return { controller, events, states, hosts: () => hosts, prepares: () => prepares, checks: () => checks, accept: () => { accepted = true; }, allowPrepare: () => { failPrepare = false; }, action: value => action(value), update };
}

test('explicit check prepares silently; only explicit ready restart confirms and installs once', async t => {
  const f = actionFixture(t);
  await f.controller.performAction('restart'); assert.deepEqual(f.events, []);
  const ready = await f.controller.performAction('check');
  assert.equal(ready.phase, 'ready'); assert.equal(f.hosts(), 0); assert.deepEqual(f.events, ['prepare']);
  await f.controller.performAction('prepare'); assert.equal(f.prepares(), 1);
  const cancelled = await f.controller.performAction('restart');
  assert.equal(cancelled.phase, 'ready'); assert.deepEqual(f.events, ['prepare', 'confirm']); assert.equal(f.hosts(), 0);
  f.accept(); await f.controller.performAction('restart');
  assert.deepEqual(f.events, ['prepare', 'confirm', 'confirm', 'brew-upgrade', 'relaunch', 'quit']); assert.equal(f.hosts(), 1);
  assert.ok(f.states.every(state => state.present === false), 'The explicit restart must not open an update-details window.');
});

test('repeated prepare/check actions reuse the one download and never install while downloading', async t => {
  let release; const waitForPrepare = new Promise(resolve => { release = resolve; });
  const f = actionFixture(t, { waitForPrepare });
  const check = f.controller.performAction('check'); await waitFor(() => f.prepares() === 1);
  const prepare = f.controller.performAction('prepare'); const duplicate = f.controller.performAction('check');
  await f.controller.performAction('restart'); assert.deepEqual(f.events, ['prepare']); assert.equal(f.hosts(), 0);
  release(); await Promise.all([check, prepare, duplicate]);
  assert.equal(f.prepares(), 1); assert.equal(f.controller.getIndicatorState().phase, 'ready'); assert.equal(f.hosts(), 0);
});

test('prepare can explicitly retry download failure but cannot retry installation failure', async t => {
  const f = actionFixture(t, { failPrepare: true, failInstall: true });
  const failed = await f.controller.performAction('check');
  assert.equal(failed.phase, 'failed'); assert.equal(failed.failure.step, 'download'); assert.equal(f.hosts(), 0);
  f.allowPrepare(); await f.controller.performAction('prepare'); assert.equal(f.prepares(), 2);
  f.accept(); await f.controller.performAction('restart');
  assert.equal(f.controller.getIndicatorState().failure.step, 'install');
  const count = f.events.length; await f.controller.performAction('prepare'); await f.controller.performAction('restart');
  assert.equal(f.events.length, count); assert.equal(f.prepares(), 2);
  await f.controller.checkAutomatically({ blockedPrepareVersion: '0.2.0' });
  assert.equal(f.controller.getIndicatorState().failure.step, 'install'); assert.equal(f.events.length, count);
});

test('manual and downloaded updates keep their manual path and cannot be restarted by the update action', async t => {
  const f = actionFixture(t, { manual: true });
  const manual = await f.controller.performAction('check');
  assert.equal(manual.phase, 'manual'); assert.deepEqual(f.events, []); assert.equal(f.hosts(), 0);
  await f.controller.performAction('prepare'); await f.controller.performAction('restart'); assert.deepEqual(f.events, []);
  await f.controller.showOrCheck(); f.action('download'); await waitFor(() => f.controller.getIndicatorState().phase === 'downloaded');
  const count = f.events.length; await f.controller.performAction('restart'); assert.equal(f.events.length, count); assert.ok(f.events.includes('direct-download')); assert.ok(!f.events.includes('direct-install'));
});

test('restored ready indicator is revalidated and prepared before a later explicit restart', async t => {
  const f = actionFixture(t);
  f.controller.restoreIndicatorState({ phase: 'ready', currentVersion: '0.1.0', latestVersion: '0.2.0', detail: 'Persisted ready', updatedAt: new Date().toISOString() });
  f.accept(); const ready = await f.controller.performAction('restart');
  assert.equal(ready.phase, 'ready'); assert.deepEqual(f.events, ['prepare']); assert.equal(f.checks(), 1); assert.equal(f.hosts(), 0);
  await f.controller.performAction('restart'); assert.deepEqual(f.events, ['prepare', 'confirm', 'brew-upgrade', 'relaunch', 'quit']);
});

test('failed check with no known update stays failed without announcing a version or opening a window', async t => {
  const f = actionFixture(t, { checkError: new Error('network check failed') });
  const failed = await f.controller.performAction('check');
  assert.equal(failed.phase, 'failed'); assert.equal(failed.failure.step, 'check'); assert.equal(failed.latestVersion, null); assert.equal(f.hosts(), 0); assert.deepEqual(f.events, []);
  await f.controller.performAction('prepare'); assert.equal(f.prepares(), 0);
});
