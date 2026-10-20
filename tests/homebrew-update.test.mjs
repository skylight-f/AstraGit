import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHomebrewUpdateService } from '../apps/desktop/src/main/homebrewUpdateService.ts';

async function homebrewFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-direct-brew-'));
  const previous = { binary: process.env.ASTRAGIT_HOMEBREW_BIN, autoUpdate: process.env.HOMEBREW_NO_AUTO_UPDATE };
  t.after(async () => {
    if (previous.binary === undefined) delete process.env.ASTRAGIT_HOMEBREW_BIN; else process.env.ASTRAGIT_HOMEBREW_BIN = previous.binary;
    if (previous.autoUpdate === undefined) delete process.env.HOMEBREW_NO_AUTO_UPDATE; else process.env.HOMEBREW_NO_AUTO_UPDATE = previous.autoUpdate;
    await rm(root, { recursive: true, force: true });
  });
  delete process.env.HOMEBREW_NO_AUTO_UPDATE;
  const appPath = join(root, 'Applications/AstraGit.app');
  await mkdir(join(appPath, 'Contents'), { recursive: true });
  const artifact = { arch: process.arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${process.arch}.dmg`, sha256: 'a'.repeat(64), sizeBytes: 120_000, downloadUrl: `https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-${process.arch}.dmg` };
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', installMethod: 'homebrew', artifact, releasePageUrl: 'https://github.com/skylight-f/AstraGit/releases/tag/v0.2.0', automaticInstallEnabled: false, reason: '' };
  const statePath = join(root, 'state.json'); const logPath = join(root, 'commands.jsonl');
  const writeApp = (version, bundleId = 'com.astragit.desktop', bundleVersion = version) => writeFile(join(appPath, 'Contents/Info.plist'), JSON.stringify({ CFBundleIdentifier: bundleId, CFBundleShortVersionString: version, CFBundleVersion: bundleVersion }));
  await writeApp('0.1.0');
  const initial = { version: '0.1.0', installed: '0.1.0', upgradeVersion: '0.2.0', tap: 'skylight-f/tap', target: appPath, ownerPid: process.pid, expectedAutoUpdate: null };
  await writeFile(statePath, JSON.stringify(initial));
  const brew = join(root, 'brew');
  await writeFile(brew, `#!${process.execPath}
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
const statePath=${JSON.stringify(statePath)}, logPath=${JSON.stringify(logPath)}, app=${JSON.stringify(appPath)}, artifact=${JSON.stringify(artifact)};
const state=JSON.parse(await readFile(statePath,'utf8')); const args=process.argv.slice(2);
await appendFile(logPath,JSON.stringify({args, cwd:process.cwd(), ownerAlive:(()=>{try{process.kill(state.ownerPid,0);return true;}catch{return false;}})(), autoUpdate:process.env.HOMEBREW_NO_AUTO_UPDATE??null})+'\\n');
if(args[0]==='list'){assert.deepEqual(args,['list','--cask','--versions']);console.log('astragit '+state.installed);}
else if(args[0]==='info'){
 assert.deepEqual(args,['info','--cask','--json=v2','skylight-f/tap/astragit']);
 if(state.failInfo){console.error('fixture info failed');process.exit(1);}
 console.log(JSON.stringify({casks:[{token:'astragit',tap:state.tap,version:state.version,installed:state.installed,url:state.url??artifact.downloadUrl,sha256:state.sha256??artifact.sha256,artifacts:[{app:['AstraGit.app'],target:state.target}]}]}));
}else if(args[0]==='upgrade'){
 assert.deepEqual(args,['upgrade','--cask','skylight-f/tap/astragit']);
 assert.equal(process.env.HOMEBREW_NO_UPGRADE_QUIT_CASKS,'1');
 assert.equal(process.env.HOMEBREW_NO_AUTO_UPDATE??null,state.expectedAutoUpdate,'The application must leave brew auto-update policy to brew and the user environment.');
 if(state.delayMs)await new Promise(resolve=>setTimeout(resolve,state.delayMs));
 if(state.failUpgrade){console.error('fixture installation failed');process.exit(1);}
 if(state.noOp){console.log('Warning: Not upgrading astragit, the latest version is already installed');process.exit(0);}
 state.installed=state.receiptVersion??state.upgradeVersion;await writeFile(statePath,JSON.stringify(state));
 await writeFile(app+'/Contents/Info.plist',JSON.stringify({CFBundleIdentifier:state.bundleId??'com.astragit.desktop',CFBundleShortVersionString:state.diskVersion??state.upgradeVersion,CFBundleVersion:state.bundleVersion??state.diskVersion??state.upgradeVersion}));
}else{console.error('Unexpected command '+args.join(' '));process.exit(1);}
`, { mode: 0o755 });
  process.env.ASTRAGIT_HOMEBREW_BIN = brew;
  const state = async patch => { const value = JSON.parse(await readFile(statePath, 'utf8')); if (patch) { Object.assign(value, patch); await writeFile(statePath, JSON.stringify(value)); } return value; };
  const log = async () => (await readFile(logPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { root, appPath, brew, update, state, log, writeApp, service: createHomebrewUpdateService({ currentAppPath: appPath, currentAppVersion: '0.1.0', bundleId: 'com.astragit.desktop', testMode: true }) };
}

const macOS = { skip: process.platform !== 'darwin' };
const upgrades = log => log.filter(entry => entry.args[0] === 'upgrade');

test('Homebrew preparation runs the user upgrade command once; restart only revalidates the installed app', macOS, async t => {
  const f = await homebrewFixture(t);
  assert.equal(await f.service.isManaged(), true);
  const prepared = await f.service.prepare(f.update, () => {});
  const identity = { appPath: f.appPath, bundleId: 'com.astragit.desktop', version: '0.2.0' };
  assert.deepEqual(prepared, { update: f.update, brewPath: f.brew, installed: identity });
  assert.deepEqual(await f.service.install(prepared, () => {}), identity);
  const log = await f.log();
  assert.deepEqual(upgrades(log).map(entry => entry.args), [['upgrade', '--cask', 'skylight-f/tap/astragit']]);
  assert.equal(upgrades(log)[0].ownerAlive, true);
  assert.equal(upgrades(log)[0].autoUpdate, null);
  assert.ok(log.every(entry => ['list', 'info', 'upgrade'].includes(entry.args[0])), 'No separate update, fetch, cache or hashing command may gate the user command.');
});

test('stale metadata and different manifest URL or hash do not block brew from upgrading', macOS, async t => {
  const f = await homebrewFixture(t);
  await f.state({ version: '0.0.9', url: 'https://example.invalid/stale.dmg', sha256: 'f'.repeat(64) });
  const prepared = await f.service.prepare({ ...f.update, status: 'unavailable', artifact: null }, () => {});
  assert.equal(prepared.installed.version, '0.2.0');
  assert.equal(upgrades(await f.log()).length, 1);
});

test('a newer actual installation and external later upgrade are accepted after identity checks', macOS, async t => {
  const f = await homebrewFixture(t);
  await f.state({ upgradeVersion: '0.3.0' });
  const prepared = await f.service.prepare(f.update, () => {});
  assert.equal(prepared.installed.version, '0.3.0');
  await f.state({ installed: '0.4.0' }); await f.writeApp('0.4.0');
  assert.equal((await f.service.install(prepared, () => {})).version, '0.4.0', 'An external later brew upgrade is safe to relaunch after receipt and bundle revalidation.');
  assert.equal(upgrades(await f.log()).length, 1);
});

test('a slower tap may still provide a real upgrade behind the detected manifest', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ upgradeVersion: '0.1.9' });
  assert.equal((await f.service.prepare(f.update, () => {})).installed.version, '0.1.9');
});

test('a successful brew no-op with the running version does not become ready to restart', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ noOp: true });
  await assert.rejects(f.service.prepare(f.update, () => {}), /Homebrew.*(?:未提供|没有|未安装|未升级)|没有.*更新|未.*新版本/u);
  assert.equal(upgrades(await f.log()).length, 1);
  assert.equal((await f.state()).installed, '0.1.0');
});

test('concurrent prepare calls share one in-flight brew upgrade', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ delayMs: 200 });
  const [first, second] = await Promise.all([f.service.prepare(f.update, () => {}), f.service.prepare({ ...f.update }, () => {})]);
  assert.deepEqual(first.installed, second.installed);
  assert.equal(upgrades(await f.log()).length, 1);
});

test('foreign taps, different app targets and production test binaries cannot run upgrades', macOS, async t => {
  const f = await homebrewFixture(t);
  await f.state({ tap: 'foreign/tap' }); await assert.rejects(f.service.prepare(f.update, () => {}), /Tap/u);
  await f.state({ tap: 'skylight-f/tap', target: join(f.root, 'other/AstraGit.app') }); await assert.rejects(f.service.prepare(f.update, () => {}), /不是当前/u);
  await f.state({ target: f.appPath }); await f.writeApp('0.1.0', 'foreign.bundle'); await assert.rejects(f.service.prepare(f.update, () => {}), /身份/u);
  await assert.rejects(createHomebrewUpdateService({ currentAppPath: f.appPath, currentAppVersion: '0.1.0', bundleId: 'com.astragit.desktop', testMode: false }).isManaged(), /只允许隔离测试/u);
  assert.equal(upgrades(await f.log()).length, 0);
});

test('upgrade failures are reported once without an automatic retry and explicit retry can succeed', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ failUpgrade: true });
  await assert.rejects(f.service.prepare(f.update, () => {}), /fixture installation failed/u);
  assert.equal(upgrades(await f.log()).length, 1);
  assert.equal((await f.state()).installed, '0.1.0');
  await f.state({ failUpgrade: false });
  assert.equal((await f.service.prepare(f.update, () => {})).installed.version, '0.2.0');
  assert.equal(upgrades(await f.log()).length, 2);
});

test('receipt, bundle identity and on-disk versions must agree before the update becomes ready', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ diskVersion: '0.2.1' });
  await assert.rejects(f.service.prepare(f.update, () => {}), /版本.*不一致/u);
  await f.state({ installed: '0.1.0', diskVersion: '0.2.0', bundleId: 'foreign.bundle' }); await f.writeApp('0.1.0');
  await assert.rejects(f.service.prepare(f.update, () => {}), /身份.*不一致/u);
});

test('restart revalidation catches disk tampering without running another brew upgrade', macOS, async t => {
  const f = await homebrewFixture(t); const prepared = await f.service.prepare(f.update, () => {});
  await f.writeApp('0.2.0', 'foreign.bundle');
  await assert.rejects(f.service.install(prepared, () => {}), /身份.*不一致/u);
  assert.equal(upgrades(await f.log()).length, 1);
});

test('the user inherited Homebrew auto-update preference is preserved for the exact upgrade command', macOS, async t => {
  const f = await homebrewFixture(t); process.env.HOMEBREW_NO_AUTO_UPDATE = '1'; await f.state({ expectedAutoUpdate: '1' });
  await f.service.prepare(f.update, () => {});
  assert.equal(upgrades(await f.log())[0].autoUpdate, '1');
});

test('an update already installed by manual brew is ready without running upgrade again', macOS, async t => {
  const f = await homebrewFixture(t); await f.state({ installed: '0.2.0', version: '0.0.9' }); await f.writeApp('0.2.0');
  assert.equal(await f.service.isManaged(), true);
  const prepared = await f.service.prepare(f.update, () => {});
  assert.equal(prepared.installed.version, '0.2.0');
  assert.equal((await f.service.install(prepared, () => {})).version, '0.2.0');
  assert.equal(upgrades(await f.log()).length, 0, 'The old running process should only need a restart after a completed external upgrade.');
});
