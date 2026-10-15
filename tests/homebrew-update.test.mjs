import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHomebrewUpdateService } from '../apps/desktop/src/main/homebrewUpdateService.ts';
import { fetchHomebrewArtifact } from '../apps/desktop/src/main/homebrewDownload.ts';
import { verifyDownloadedArtifact } from '../apps/desktop/src/main/releaseArtifact.ts';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-brew-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appPath = join(root, 'Applications/AstraGit.app'); const cacheRoot = join(root, 'cache');
  await mkdir(appPath, { recursive: true }); await mkdir(cacheRoot);
  const cachePath = join(cacheRoot, 'release.dmg'); const bytes = Buffer.alloc(120_000, 43);
  const artifact = { arch: process.arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${process.arch}.dmg`, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, downloadUrl: `https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-${process.arch}.dmg` };
  const update = { status: 'available', currentVersion: '0.1.0', latestVersion: '0.2.0', installMethod: 'homebrew', artifact };
  const state = { caskVersion: '0.1.0', installed: '0.1.0', updateFailures: 0, updateCalls: 0, fetches: 0, keepStale: false, badHash: false, tap: 'skylight-f/tap' };
  const commands = [];
  const service = createHomebrewUpdateService({ appPath, version: update.currentVersion }, {
    platform: 'darwin', binary: async () => '/fixture/brew',
    inspectApp: async (path, versions) => { assert.equal(path, appPath); assert.ok(versions.includes(state.installed)); return { appPath, version: state.installed }; },
    run: async (file, args, options) => {
      assert.equal(file, '/fixture/brew'); commands.push([...args]);
      const result = stdout => ({ stdout, stderr: '' });
      assert.equal(options.env.HOMEBREW_NO_INSTALL_CLEANUP, '1');
      assert.equal(options.env.HOMEBREW_NO_UPGRADE_QUIT_CASKS, '1');
      if (args[0] !== 'update') assert.equal(options.env.HOMEBREW_NO_AUTO_UPDATE, '1');
      if (args[0] === 'list') return result(`astragit ${state.installed}`);
      if (args[0] === 'info') return result(JSON.stringify({ casks: [{ token: 'astragit', tap: state.tap, version: state.caskVersion, installed: state.installed, url: artifact.downloadUrl, sha256: state.badHash ? 'f'.repeat(64) : artifact.sha256, artifacts: [{ app: ['AstraGit.app'], target: appPath }] }] }));
      if (args[0] === 'update') {
        assert.equal(options.env.HOMEBREW_NO_AUTO_UPDATE, undefined);
        assert.equal(options.timeout, 5 * 60_000); state.updateCalls++;
        if (state.updateFailures-- > 0) throw Object.assign(new Error('network failed'), { stderr: 'Connection reset' });
        if (!state.keepStale) state.caskVersion = update.latestVersion;
        return result('');
      }
      if (args[0] === '--cache') return result(args.length === 1 ? cacheRoot : cachePath);
      if (args[0] === 'upgrade') {
        assert.ok(args.includes('--no-quit')); assert.ok(args.includes('--require-sha'));
        assert.ok(args.includes('--yes')); assert.equal(args.at(-1), 'skylight-f/tap/astragit');
        assert.deepEqual(await readFile(cachePath), bytes);
        state.installed = update.latestVersion; return result('');
      }
      assert.fail(`Unexpected command ${args.join(' ')}`);
    },
    fetchArtifact: async options => {
      assert.equal(options.brewPath, '/fixture/brew'); assert.equal(options.cask, 'skylight-f/tap/astragit');
      assert.equal(options.environment.HOMEBREW_NO_AUTO_UPDATE, '1');
      state.fetches++; await writeFile(options.cachePath, bytes);
    },
  });
  return { service, state, commands, root, appPath, cachePath, bytes, artifact, update };
}

test('Homebrew refresh retries stale metadata, owns prefetch and verifies cache again before upgrade', async t => {
  const f = await fixture(t); const progress = [];
  assert.equal(await f.service.isManaged(), true);
  f.state.updateFailures = 1;
  const prepared = await f.service.prepare(f.update, value => progress.push(value.phase));
  assert.equal(f.state.updateCalls, 2); assert.equal(f.state.fetches, 1);
  assert.ok(progress.includes('updating')); assert.equal(progress.at(-1), 'ready');
  assert.ok(!f.commands.some(args => args[0] === 'upgrade'));
  await f.service.validatePrepared(prepared);
  await writeFile(f.cachePath, Buffer.alloc(f.bytes.length, 1));
  await assert.rejects(f.service.validatePrepared(prepared), /SHA-256/u);
  await assert.rejects(f.service.install(prepared, () => {}), /SHA-256/u);
  assert.ok(!f.commands.some(args => args[0] === 'upgrade'));
  await writeFile(f.cachePath, f.bytes);
  assert.equal((await f.service.install(prepared, () => {})).version, '0.2.0');
  assert.equal(f.commands.filter(args => args[0] === 'upgrade').length, 1);
  await f.service.prepare(f.update, () => {});
  assert.equal(f.state.fetches, 1, 'An intact brew cache is reused.');
});

test('Homebrew lag, wrong hash and foreign tap never download or upgrade an unrelated package', async t => {
  const f = await fixture(t); f.state.keepStale = true;
  await assert.rejects(f.service.prepare(f.update, () => {}), /发布版本为 0\.2\.0.*当前 Cask 为 0\.1\.0/u);
  f.state.keepStale = false; f.state.badHash = true;
  await assert.rejects(f.service.prepare(f.update, () => {}), /SHA-256.*已停止安装/u);
  f.state.badHash = false; f.state.tap = 'foreign/tap';
  await assert.rejects(f.service.prepare(f.update, () => {}), /唯一有效/u);
  assert.equal(f.state.fetches, 0);
  assert.ok(!f.commands.some(args => args[0] === 'upgrade'));
});

test('real brew-fetch subprocess retries a connection failure, preserves partial content and reports byte progress', async t => {
  const f = await fixture(t); const executable = join(f.root, 'brew-fixture'); const attempts = join(f.root, 'attempts.json');
  await writeFile(executable, `#!${process.execPath}
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
assert.deepEqual(process.argv.slice(2), ['fetch','--cask','--retry','skylight-f/tap/astragit']);
const path=${JSON.stringify(f.cachePath)}; const counter=${JSON.stringify(attempts)};
const previous=await readFile(counter,'utf8').then(JSON.parse).catch(()=>0);
await writeFile(counter,JSON.stringify(previous+1));
if(!previous){await writeFile(path+'.incomplete',Buffer.alloc(60_000,43));process.stderr.write('curl: (28) Operation timed out');process.exit(1);}
assert.equal((await readFile(path+'.incomplete')).length,60_000);
await new Promise(resolve=>setTimeout(resolve,750));
await writeFile(path+'.incomplete',Buffer.alloc(120_000,43)); await rename(path+'.incomplete',path);
`, { mode: 0o755 });
  const progress = [];
  await fetchHomebrewArtifact({ brewPath: executable, cask: 'skylight-f/tap/astragit', cachePath: f.cachePath, artifact: f.artifact, environment: process.env, progress: value => progress.push(value) });
  assert.equal(JSON.parse(await readFile(attempts)), 2);
  assert.ok(progress.some(value => value.phase === 'reconnecting'));
  assert.ok(progress.some(value => value.phase === 'downloading' && value.receivedBytes === 60_000));
  await verifyDownloadedArtifact(f.cachePath, f.artifact);
});

test('structural brew-fetch errors do not enter automatic download retry', async t => {
  const f = await fixture(t); const executable = join(f.root, 'brew-bad-hash'); const attempts = join(f.root, 'attempts');
  await writeFile(executable, `#!${process.execPath}
import {appendFile} from 'node:fs/promises';
await appendFile(${JSON.stringify(attempts)},'attempt'+String.fromCharCode(10));
process.stderr.write('SHA256 mismatch');process.exit(1);
`, { mode: 0o755 });
  await assert.rejects(fetchHomebrewArtifact({ brewPath: executable, cask: 'skylight-f/tap/astragit', cachePath: f.cachePath, artifact: f.artifact, environment: process.env, progress: () => {} }), error => error.transient === false && /SHA256/u.test(error.message));
  assert.equal(await readFile(attempts, 'utf8'), 'attempt\n');
});
