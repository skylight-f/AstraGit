import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHomebrewUpdateService, isTransientHomebrewDownloadError } from '../apps/desktop/src/main/homebrewUpdateService.ts';

export async function homebrewFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-astra-brew-'));
  const previous = process.env.ASTRAGIT_HOMEBREW_BIN;
  t.after(async () => { if (previous === undefined) delete process.env.ASTRAGIT_HOMEBREW_BIN; else process.env.ASTRAGIT_HOMEBREW_BIN = previous; await rm(root, { recursive: true, force: true }); });
  const appPath = join(root, 'Applications/AstraGit.app');
  const cachePath = join(root, 'cache/release.dmg');
  await mkdir(join(appPath, 'Contents'), { recursive: true });
  await mkdir(join(root, 'cache'));
  const bytes = Buffer.alloc(120_000, 43);
  const artifact = { arch: process.arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${process.arch}.dmg`, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, downloadUrl: `https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-${process.arch}.dmg` };
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', installMethod: 'direct', artifact, releasePageUrl: 'https://github.com/skylight-f/AstraGit/releases/tag/v0.2.0', automaticInstallEnabled: false, reason: '' };
  const statePath = join(root, 'state.json'); const logPath = join(root, 'commands.jsonl');
  const plist = version => JSON.stringify({ CFBundleIdentifier: 'com.astragit.desktop', CFBundleShortVersionString: version, CFBundleVersion: version });
  await writeFile(join(appPath, 'Contents/Info.plist'), plist('0.1.0'));
  const initial = { version: '0.1.0', installed: '0.1.0', keepStale: false, badHash: false, failInstall: false, fetchFailures: 0, fetches: 0, tap: 'skylight-f/tap', target: appPath, ownerPid: process.pid };
  await writeFile(statePath, JSON.stringify(initial));
  const brew = join(root, 'brew');
  await writeFile(brew, `#!${process.execPath}
import assert from 'node:assert/strict';
import {readFile,writeFile,appendFile,rename} from 'node:fs/promises';
const statePath=${JSON.stringify(statePath)}, logPath=${JSON.stringify(logPath)}, cache=${JSON.stringify(cachePath)}, app=${JSON.stringify(appPath)}, artifact=${JSON.stringify(artifact)};
const state=JSON.parse(await readFile(statePath,'utf8')); const args=process.argv.slice(2);
await appendFile(logPath,JSON.stringify({args,ownerAlive:(()=>{try{process.kill(state.ownerPid,0);return true;}catch{return false;}})()})+'\\n');
const save=()=>writeFile(statePath,JSON.stringify(state));
assert.equal(process.env.HOMEBREW_NO_UPGRADE_QUIT_CASKS,'1');
if(args[0]!=='update')assert.equal(process.env.HOMEBREW_NO_AUTO_UPDATE,'1');
if(args[0]==='list')console.log('astragit '+state.installed);
else if(args[0]==='info')console.log(JSON.stringify({casks:[{token:'astragit',tap:state.tap,version:state.version,installed:state.installed,url:artifact.downloadUrl,sha256:state.badHash?'f'.repeat(64):artifact.sha256,artifacts:[{app:['AstraGit.app'],target:state.target}]}]}));
else if(args[0]==='update'){if(!state.keepStale)state.version='0.2.0';await save();}
else if(args[0]==='--cache'){assert.deepEqual(args,['--cache','--cask','skylight-f/tap/astragit']);console.log(cache);}
else if(args[0]==='fetch'){
 assert.deepEqual(args,['fetch','--cask','--retry','skylight-f/tap/astragit']);state.fetches++;await save();
 if(state.fetchFailures-->0){await save();await writeFile(cache+'.incomplete',Buffer.alloc(60_000,43));console.error('curl: (28) Operation timed out');process.exit(1);}
 if(state.fetches>1)assert.equal((await readFile(cache+'.incomplete')).length,60_000);
 await writeFile(cache+'.incomplete',Buffer.alloc(60_000,43));await new Promise(resolve=>setTimeout(resolve,750));
 await writeFile(cache+'.incomplete',Buffer.alloc(120_000,43));await rename(cache+'.incomplete',cache);
}else if(args[0]==='upgrade'){
 assert.deepEqual(args,['upgrade','--cask','--no-quit','--yes','--require-sha','skylight-f/tap/astragit']);
 assert.deepEqual(await readFile(cache),Buffer.alloc(120_000,43));
 if(state.failInstall){console.error('fixture installation failed');process.exit(1);}
 state.installed='0.2.0';await save();
 await writeFile(app+'/Contents/Info.plist',JSON.stringify({CFBundleIdentifier:'com.astragit.desktop',CFBundleShortVersionString:'0.2.0',CFBundleVersion:'0.2.0'}));
}else {console.error('Unexpected command '+args.join(' '));process.exit(1);}
`, { mode: 0o755 });
  process.env.ASTRAGIT_HOMEBREW_BIN = brew;
  const state = async patch => { const value = JSON.parse(await readFile(statePath, 'utf8')); if (patch) { Object.assign(value, patch); await writeFile(statePath, JSON.stringify(value)); } return value; };
  return { root, appPath, cachePath, bytes, update, state, log: async () => (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse), service: createHomebrewUpdateService({ currentAppPath: appPath, currentAppVersion: '0.1.0', bundleId: 'com.astragit.desktop', testMode: true }) };
}

test('Astra command chain refreshes and fetches through brew, then upgrades while the old Main is still alive', { skip: process.platform !== 'darwin' }, async t => {
  const f = await homebrewFixture(t); await f.state({ fetchFailures: 1 });
  assert.equal(await f.service.isManaged(), true);
  const progress = [];
  const prepared = await f.service.prepare(f.update, value => progress.push(value));
  assert.ok(prepared.verifiedArtifact);
  assert.ok(progress.some(value => value.phase === 'reconnecting'));
  assert.ok(progress.some(value => value.downloadedBytes === 60_000));
  assert.equal((await f.state()).fetches, 2);
  assert.ok(!(await f.log()).some(value => value.args[0] === 'upgrade'));
  const installed = await f.service.install(prepared, () => {});
  assert.deepEqual(installed, { appPath: f.appPath, bundleId: 'com.astragit.desktop', version: '0.2.0' });
  assert.equal((await f.log()).find(value => value.args[0] === 'upgrade').ownerAlive, true);
  assert.equal((await f.log()).filter(value => value.args[0] === '--cache').length, 1, 'No extra global-cache query is added.');
});

test('Astra validation blocks stale metadata, foreign receipts and changed cache before upgrade', { skip: process.platform !== 'darwin' }, async t => {
  const f = await homebrewFixture(t);
  await f.state({ keepStale: true }); await assert.rejects(f.service.prepare(f.update, () => {}), /发布清单不一致/u);
  await f.state({ keepStale: false, tap: 'foreign/tap' }); await assert.rejects(f.service.isManaged(), /Tap/u);
  await f.state({ tap: 'skylight-f/tap', target: join(f.root, 'other/AstraGit.app') }); await assert.rejects(f.service.isManaged(), /不是当前/u);
  await f.state({ target: f.appPath });
  const prepared = await f.service.prepare(f.update, () => {});
  await writeFile(f.cachePath, Buffer.alloc(f.bytes.length, 1));
  await assert.rejects(f.service.install(prepared, () => {}), /已变化或不完整/u);
  assert.ok(!(await f.log()).some(value => value.args[0] === 'upgrade'));
});

test('Homebrew installation failures are not retried and test binaries are unavailable to production', { skip: process.platform !== 'darwin' }, async t => {
  const f = await homebrewFixture(t);
  await assert.rejects(createHomebrewUpdateService({ currentAppPath: f.appPath, currentAppVersion: '0.1.0', bundleId: 'com.astragit.desktop', testMode: false }).isManaged(), /只允许隔离测试/u);
  const prepared = await f.service.prepare(f.update, () => {});
  await f.state({ failInstall: true });
  await assert.rejects(f.service.install(prepared, () => {}), error => !isTransientHomebrewDownloadError(error) && /fixture installation failed/u.test(error.message));
  assert.equal((await f.log()).filter(value => value.args[0] === 'upgrade').length, 1);
  assert.equal((await f.state()).installed, '0.1.0');
});
