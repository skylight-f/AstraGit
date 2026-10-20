import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomebrewUpdateController } from '../apps/desktop/src/main/homebrewUpdateController.ts';

const waitFor = async predicate => { const until = Date.now() + 3000; while (!predicate()) { if (Date.now() > until) assert.fail('Update controller did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); } };
function fixture(t) {
  const events = []; const states = []; let action; let accepted = false; let quit = false; let fail = false; let prepares = 0;
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', artifact: { sha256: 'a'.repeat(64), sizeBytes: 120_000 }, automaticInstallEnabled: false, reason: 'Unsigned direct channel' };
  const controller = createHomebrewUpdateController({
    helperPath: '/unused', language: () => 'zh-CN', currentVersion: '0.1.0', loadUpdateStatus: async () => update,
    direct: { manualInstallReason: async () => assert.fail('Homebrew must not use direct installation'), download: async () => assert.fail('Homebrew must use its upgrade command') },
    homebrew: {
      isManaged: async () => true,
      prepare: async () => { prepares++; events.push('brew-upgrade'); return { update, brewPath: '/brew', installed: { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: '0.2.0' } }; },
      install: async () => { assert.equal(quit, false); events.push('verify-installed'); if (fail) throw new Error('installed app identity changed'); return { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: '0.2.0' }; },
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

test('native controller retains the installed brew update on cancel, then revalidates and arms relaunch before quitting', async t => {
  const f = fixture(t); await f.controller.showOrCheck();
  f.action('download'); await waitFor(() => f.controller.getIndicatorState().phase === 'ready');
  f.action('restart'); await waitFor(() => f.events.length === 2 && f.controller.getIndicatorState().phase === 'ready');
  assert.deepEqual(f.events, ['brew-upgrade', 'confirm']); assert.equal(f.prepares(), 1);
  f.accept(); f.action('restart'); await waitFor(() => f.events.includes('quit'));
  assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'confirm', 'verify-installed', 'native-relaunch', 'quit']);
  assert.equal(f.prepares(), 1, 'Cancel preserves the already installed brew update without upgrading again.');
});

test('native controller leaves the old application open if restart revalidation fails and never repeats the upgrade', async t => {
  const f = fixture(t); await f.controller.showOrCheck(); f.action('download');
  await waitFor(() => f.controller.getIndicatorState().phase === 'ready');
  f.accept(); f.fail(); f.action('restart'); await waitFor(() => f.controller.getIndicatorState().phase === 'failed');
  assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'verify-installed']);
  assert.equal(f.controller.getIndicatorState().failure.step, 'install');
  assert.equal(f.states.at(-1).canRetry, false);
  await f.controller.showOrCheck(); assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'verify-installed']);
});

test('automatic brew upgrade has one owner and reopening the native window reuses its installed result', async t => {
  const f = fixture(t);
  await f.controller.checkAutomatically(); assert.equal(f.controller.getIndicatorState().phase, 'ready');
  await f.controller.showOrCheck(); await f.controller.showOrCheck();
  assert.equal(f.prepares(), 1); assert.deepEqual(f.events, ['brew-upgrade']);
});

function actionFixture(t, input = {}) {
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', artifact: { sha256: 'b'.repeat(64), sizeBytes: 120_000 }, automaticInstallEnabled: true, ...input.update };
  const events = []; const states = []; let action; let hosts = 0; let closedHosts = 0; let prepares = 0; let accepted = false; let failPrepare = input.failPrepare; let checks = 0;
  const controller = createHomebrewUpdateController({
    helperPath: '/unused', language: () => 'zh-CN', currentVersion: '0.1.0',
    loadUpdateStatus: async () => { checks++; await input.waitForCheck; if (input.checkError) throw input.checkError; return update; },
    retryDelaysMs: input.retryDelaysMs,
    direct: {
      manualInstallReason: async () => input.manual ? 'Manual installation required' : null,
      download: async () => { events.push('direct-download'); if (input.downloadError) throw input.downloadError; return { accepted: true, update }; },
      install: async () => { events.push('direct-install'); input.onQuit?.(); return { accepted: true, restartAccepted: true }; },
    },
    homebrew: {
      isManaged: async () => !input.manual && !input.direct,
      prepare: async (_update, progress) => {
        prepares++; events.push('brew-upgrade');
        progress({ phase: 'downloading', downloadedBytes: 1, totalBytes: 2 });
        await input.waitForPrepare;
        if (failPrepare) throw new Error('Homebrew upgrade failed');
        return { update, brewPath: '/brew', installed: { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: input.installedVersion ?? '0.2.0' } };
      },
      install: async () => { events.push('verify-installed'); if (input.failInstall) throw new Error('installed app identity changed'); return { appPath: '/Applications/AstraGit.app', bundleId: 'com.astragit.desktop', version: input.installedVersion ?? '0.2.0' }; },
    },
    canInstall: () => {}, openDownloadPage: async () => events.push('open-release'),
    onInstallReady: async activate => { events.push('confirm'); if (!accepted) return false; await activate(); events.push('quit'); input.onQuit?.(); return true; },
    createHost: async () => {
      hosts++;
      await input.waitForHost;
      return {
        update: state => states.push(state), show: () => events.push('show'), close: () => { closedHosts++; }, hide: () => {}, onExit: () => () => {},
        onAction: listener => { action = listener; return () => {}; }, relaunchAfterProcessExit: () => events.push('relaunch'),
      };
    },
  });
  t.after(() => controller.close());
  return { controller, events, states, hosts: () => hosts, closedHosts: () => closedHosts, prepares: () => prepares, checks: () => checks, accept: () => { accepted = true; }, allowPrepare: () => { failPrepare = false; }, action: value => action(value), update };
}

test('explicit check upgrades silently; ready restart confirms and revalidates without another brew upgrade', async t => {
  const f = actionFixture(t);
  await f.controller.performAction('restart'); assert.deepEqual(f.events, []);
  const ready = await f.controller.performAction('check');
  assert.equal(ready.phase, 'ready'); assert.equal(f.hosts(), 0); assert.deepEqual(f.events, ['brew-upgrade']);
  await f.controller.performAction('prepare'); assert.equal(f.prepares(), 1);
  const cancelled = await f.controller.performAction('restart');
  assert.equal(cancelled.phase, 'ready'); assert.deepEqual(f.events, ['brew-upgrade', 'confirm']); assert.equal(f.hosts(), 0);
  f.accept(); await f.controller.performAction('restart');
  assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'confirm', 'verify-installed', 'relaunch', 'quit']); assert.equal(f.hosts(), 1);
  assert.ok(f.states.every(state => state.present === false), 'The explicit restart must not open an update-details window.');
});

test('repeated prepare/check actions share one pending brew upgrade and cannot restart it', async t => {
  let release; const waitForPrepare = new Promise(resolve => { release = resolve; });
  const f = actionFixture(t, { waitForPrepare });
  const check = f.controller.performAction('check'); await waitFor(() => f.prepares() === 1);
  const prepare = f.controller.performAction('prepare'); const duplicate = f.controller.performAction('check');
  await f.controller.performAction('restart'); assert.deepEqual(f.events, ['brew-upgrade']); assert.equal(f.hosts(), 0);
  release(); await Promise.all([check, prepare, duplicate]);
  assert.equal(f.prepares(), 1); assert.equal(f.controller.getIndicatorState().phase, 'ready'); assert.equal(f.hosts(), 0);
});

test('failed brew upgrade is not automatically retried; explicit prepare may retry, while restart identity failure cannot replay upgrade', async t => {
  const f = actionFixture(t, { failPrepare: true, failInstall: true });
  const failed = await f.controller.performAction('check');
  assert.equal(failed.phase, 'failed'); assert.equal(failed.failure.step, 'install'); assert.equal(f.hosts(), 0);
  await f.controller.checkAutomatically();
  assert.equal(f.prepares(), 1, 'Automatic checks must not retry a failed brew upgrade.');
  await f.controller.showOrCheck();
  assert.equal(f.prepares(), 1, 'Opening the update window must not retry a failed brew upgrade.');
  assert.equal(f.states.at(-1).canRetry, true);
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
  assert.equal(ready.phase, 'ready'); assert.deepEqual(f.events, ['brew-upgrade']); assert.equal(f.checks(), 1); assert.equal(f.hosts(), 0);
  await f.controller.performAction('restart'); assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'verify-installed', 'relaunch', 'quit']);
});

test('failed check with no known update stays failed without announcing a version or opening a window', async t => {
  const f = actionFixture(t, { checkError: new Error('network check failed') });
  const failed = await f.controller.performAction('check');
  assert.equal(failed.phase, 'failed'); assert.equal(failed.failure.step, 'check'); assert.equal(failed.latestVersion, null); assert.equal(f.hosts(), 0); assert.deepEqual(f.events, []);
  await f.controller.performAction('prepare'); assert.equal(f.prepares(), 0);
});

for (const version of ['0.1.9', '0.3.0']) {
  test(`the ready indicator uses actual installed ${version} and manifest drift cannot replay brew upgrade`, async t => {
    const input = { installedVersion: version };
    const f = actionFixture(t, input);
    const ready = await f.controller.performAction('check');
    assert.equal(ready.phase, 'ready'); assert.equal(ready.latestVersion, version); assert.equal(ready.method, 'homebrew');
    f.update.latestVersion = '99.0.0'; f.update.artifact.sha256 = 'c'.repeat(64);
    input.checkError = new Error('A later manifest request failed');
    await f.controller.checkAutomatically();
    assert.equal(f.controller.getIndicatorState().phase, 'ready', 'Offline checks must preserve an already verified Homebrew installation.');
    assert.equal(f.controller.getIndicatorState().latestVersion, version);
    assert.equal(f.prepares(), 1); const checksBeforeRestart = f.checks();
    f.accept(); await f.controller.performAction('restart');
    assert.deepEqual(f.events, ['brew-upgrade', 'confirm', 'verify-installed', 'relaunch', 'quit']);
    assert.equal(f.checks(), checksBeforeRestart, 'Restart must not add a manifest request after an offline automatic check.');
    assert.equal(f.prepares(), 1);
  });
}

test('Homebrew upgrades a detected version without needing a direct-channel artifact', async t => {
  const f = actionFixture(t, { update: { status: 'unavailable', artifact: null, latestVersion: '0.2.0' } });
  const ready = await f.controller.performAction('check');
  assert.equal(ready.phase, 'ready'); assert.equal(ready.method, 'homebrew'); assert.equal(f.prepares(), 1);
  assert.deepEqual(f.events, ['brew-upgrade']);
});

test('shutdown drains an active brew command and blocks new work without reopening its UI', async t => {
  let release;
  const waitForPrepare = new Promise(resolve => { release = resolve; });
  const f = actionFixture(t, { waitForPrepare });
  const check = f.controller.performAction('check');
  await waitFor(() => f.prepares() === 1);
  let drained = false;
  const shutdown = f.controller.shutdown().then(() => { drained = true; });
  await Promise.all([f.controller.showOrCheck(), f.controller.performAction('prepare'), f.controller.checkAutomatically()]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false, 'The application must keep its bridge alive until brew finishes.');
  assert.equal(f.prepares(), 1);
  assert.equal(f.checks(), 1);
  assert.equal(f.hosts(), 0);
  release();
  await Promise.all([check, shutdown]);
  assert.equal(drained, true);
  assert.equal(f.hosts(), 0);
  assert.deepEqual(f.events, ['brew-upgrade']);
});

test('shutdown during a release check does not start a later automatic brew upgrade', async t => {
  let release;
  const waitForCheck = new Promise(resolve => { release = resolve; });
  const f = actionFixture(t, { waitForCheck });
  const check = f.controller.checkAutomatically();
  await waitFor(() => f.checks() === 1);
  const shutdown = f.controller.shutdown();
  release();
  await Promise.all([check, shutdown]);
  assert.equal(f.prepares(), 0);
  assert.equal(f.hosts(), 0);
  assert.equal(await f.controller.checkAutomatically(), false);
});

test('shutdown cancels a five-minute retry delay and prevents another download', { timeout: 3_000 }, async t => {
  const f = actionFixture(t, {
    direct: true,
    retryDelaysMs: [5 * 60_000],
    downloadError: new Error('fixture network disconnected', { cause: { code: 'ASTRAGIT_UPDATE_DOWNLOAD_INTERRUPTED' } }),
  });
  const check = f.controller.checkAutomatically();
  await waitFor(() => f.controller.getIndicatorState().phase === 'retrying');
  await f.controller.shutdown();
  await check;
  assert.deepEqual(f.events, ['direct-download']);
  assert.equal(f.hosts(), 0);
});

test('shutdown closes a late native host before it can show a window or start checking', async t => {
  let release;
  const waitForHost = new Promise(resolve => { release = resolve; });
  const f = actionFixture(t, { waitForHost });
  const show = f.controller.showOrCheck();
  await waitFor(() => f.hosts() === 1);
  const shutdown = f.controller.shutdown();
  release();
  await Promise.all([show, shutdown]);
  assert.equal(f.closedHosts(), 1);
  assert.equal(f.checks(), 0);
  assert.deepEqual(f.states, []);
  assert.ok(!f.events.includes('show'));
});

for (const direct of [false, true]) {
  test(`shutdown triggered by ${direct ? 'direct' : 'Homebrew'} restart drains without awaiting its own quit handler`, { timeout: 3_000 }, async t => {
    let shutdown;
    const input = { direct };
    const f = actionFixture(t, input);
    await f.controller.performAction('check');
    f.accept();
    input.onQuit = () => { shutdown = f.controller.shutdown({ preserveHost: !direct }); };
    await f.controller.performAction('restart');
    assert.ok(shutdown);
    await shutdown;
    if (!direct) {
      assert.ok(f.events.includes('relaunch'));
      assert.equal(f.closedHosts(), 0, 'The armed helper must outlive the old Main process.');
      await f.controller.shutdown();
      assert.equal(f.closedHosts(), 0, 'Repeated shutdown must preserve the original handoff decision.');
    }
  });
}
