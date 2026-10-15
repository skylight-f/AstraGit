import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseReleaseManifest } from '../packages/shared/dist/index.js';
import { createReleaseUpdateService, downloadVerifiedArtifact } from '../apps/desktop/src/main/releaseUpdateService.ts';
import { cacheVerifiedArtifact } from '../apps/desktop/src/main/releaseArtifact.ts';
import { selectAutomaticVersion } from '../scripts/prepare-automatic-release.mjs';
import { renderHomebrewCask } from '../scripts/homebrew-cask.mjs';
import { verifyHomebrewRelease } from '../scripts/sync-homebrew-tap.mjs';
import { assertHomebrewRelease, parseHomebrewCask } from '../apps/desktop/src/main/homebrewUpdateService.ts';

test('release versions reserve existing tags and update manifests reject foreign apps, origins and invalid hashes', () => {
  assert.equal(selectAutomaticVersion('0.1.0', []), '0.1.0'); assert.equal(selectAutomaticVersion('0.1.0', ['v0.1.0', 'v0.1.2']), '0.1.3'); assert.equal(selectAutomaticVersion('0.2.0', ['v0.1.2']), '0.2.0');
  const artifact = { arch: 'arm64', kind: 'dmg', fileName: 'AstraGit-0.2.0-arm64.dmg', sha256: 'a'.repeat(64), sizeBytes: 200_000, downloadUrl: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-arm64.dmg' };
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts: [artifact] };
  assert.equal(parseReleaseManifest(manifest).version, '0.2.0');
  assert.throws(() => parseReleaseManifest({ ...manifest, appId: 'dev.hypha.zeus' }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, downloadUrl: 'https://example.com/app.dmg' }] }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, sha256: 'bad' }] }));
});

test('Homebrew receipts reject foreign taps and drift between cask, release and selected architecture', () => {
  const raw = { token: 'astragit', tap: 'skylight-f/tap', version: '0.2.0', installed: '0.1.0', url: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-arm64.dmg', sha256: 'a'.repeat(64), artifacts: [{ app: ['AstraGit.app'], target: '/Applications/AstraGit.app' }] };
  const cask = parseHomebrewCask({ casks: [raw] });
  const update = { currentVersion: '0.1.0', latestVersion: '0.2.0', status: 'available', installMethod: 'homebrew', artifact: { arch: 'arm64', kind: 'dmg', fileName: 'AstraGit-0.2.0-arm64.dmg', downloadUrl: raw.url, sha256: raw.sha256, sizeBytes: 200_000 } };
  assertHomebrewRelease(cask, update);
  assert.throws(() => parseHomebrewCask({ casks: [{ ...raw, tap: 'foreign/tap' }] }));
  assert.throws(() => parseHomebrewCask({ casks: [{ ...raw, artifacts: [{ app: ['Zeus.app'], target: '/Applications/Zeus.app' }] }] }));
  assert.throws(() => parseHomebrewCask({ casks: [raw, raw] }));
  assert.throws(() => assertHomebrewRelease({ ...cask, version: '0.1.9' }, update), /Homebrew 仍为 0\.1\.9.*无需重新下载/u);
  assert.throws(() => assertHomebrewRelease({ ...cask, version: '0.2.1' }, update), /请重新检查并下载/u);
  assert.throws(() => assertHomebrewRelease({ ...cask, sha256: 'b'.repeat(64) }, update), /SHA-256.*已停止安装/u);
  assert.throws(() => assertHomebrewRelease(cask, { ...update, artifact: { ...update.artifact, arch: 'x64' } }));
});
test('Homebrew tap lag does not block downloads or quit the app, and installation retries reuse verified bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-homebrew-lag-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(120_000, 43); let downloads = 0; let syncs = 0; let confirmations = 0; let quits = 0; let offline = false;
  const artifact = { arch: process.arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${process.arch}.dmg`, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, downloadUrl: `https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-${process.arch}.dmg` };
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts: [artifact] };
  let cask = { version: '0.1.0', installedVersion: '0.1.0', tap: 'skylight-f/tap', url: artifact.downloadUrl, sha256: artifact.sha256, appTarget: '/Applications/AstraGit.app' };
  const service = createReleaseUpdateService({
    appPath: cask.appTarget, version: '0.1.0', dataDirectory: root, executablePath: '/unused', packaged: true,
    fetch: async url => {
      if (String(url).endsWith('/astragit-release-manifest.json')) {
        if (offline) throw new Error('simulated offline');
        return Response.json(manifest);
      }
      assert.equal(url, artifact.downloadUrl); downloads++; return new Response(bytes);
    },
    onProgress: () => {}, confirmRestart: async () => { confirmations++; return false; }, quit: () => { quits++; },
  }, { systemVersion: async () => '15.0', homebrew: {
    isManaged: async () => true,
    prepare: async (update, path) => {
      syncs++; assertHomebrewRelease(cask, update);
      assert.deepEqual(await readFile(path), bytes);
      return { update, brewPath: '/unused', cachePath: path };
    },
    install: async () => { assert.fail('The installer must not run without confirmation.'); },
  } });
  assert.equal((await service.prepare()).installMethod, 'homebrew');
  assert.equal(downloads, 1); assert.equal(syncs, 0, 'Download must not depend on tap readiness.');
  offline = true;
  await assert.rejects(service.install(), /无法完成更新检查.*simulated offline/u);
  assert.equal(confirmations, 0); assert.equal(quits, 0);
  offline = false;
  await assert.rejects(service.install(), /尚未同步/u);
  assert.equal(confirmations, 0); assert.equal(quits, 0);
  assert.deepEqual(await readFile(await service.downloaded()), bytes);
  cask = { ...cask, version: '0.2.0', sha256: 'f'.repeat(64) };
  await assert.rejects(service.install(), /SHA-256/u);
  assert.equal(confirmations, 0); assert.equal(quits, 0);
  cask = { ...cask, sha256: artifact.sha256 };
  assert.deepEqual(await service.install(), { accepted: false });
  assert.equal(confirmations, 1); assert.equal(quits, 0); assert.equal(downloads, 1);
});

test('Homebrew cache transfer preserves existing data on invalid downloads and publishes only verified bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-homebrew-cache-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(120_000, 44);
  const artifact = { sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
  const source = join(root, 'download.dmg'); const cache = join(root, 'brew-cache.dmg');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(source, bytes); await writeFile(cache, 'existing cached data');
  await assert.rejects(cacheVerifiedArtifact(source, cache, { ...artifact, sha256: 'f'.repeat(64) }), /SHA-256/u);
  assert.equal(await readFile(cache, 'utf8'), 'existing cached data');
  await cacheVerifiedArtifact(source, cache, artifact);
  assert.deepEqual(await readFile(cache), bytes);
  await cacheVerifiedArtifact(source, cache, artifact);
  await cacheVerifiedArtifact(source, source, artifact);
  assert.deepEqual((await readdir(root)).sort(), ['brew-cache.dmg', 'download.dmg']);
});

test('Homebrew publication binds both architecture hashes to the public release and rejects forged cask content', () => {
  const artifacts = ['arm64', 'x64'].map((arch, i) => ({ arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${arch}.dmg`, sha256: String(i + 1).repeat(64), sizeBytes: 200_000 + i, downloadUrl: `https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-${arch}.dmg` }));
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts };
  const bytes = Buffer.from(JSON.stringify(manifest)); const cask = Buffer.from(renderHomebrewCask(manifest));
  const asset = (name, body) => ({ name, size: body.length, digest: `sha256:${createHash('sha256').update(body).digest('hex')}` });
  const release = { tag_name: 'v0.2.0', draft: false, prerelease: false, html_url: 'https://github.com/skylight-f/AstraGit/releases/tag/v0.2.0', assets: [...artifacts.map(a => ({ name: a.fileName, size: a.sizeBytes, digest: `sha256:${a.sha256}`, browser_download_url: a.downloadUrl })), asset('astragit-release-manifest.json', bytes), asset('astragit.rb', cask)] };
  assert.equal(verifyHomebrewRelease(release, manifest, bytes, cask).version, '0.2.0');
  assert.throws(() => renderHomebrewCask({ ...manifest, artifacts: [artifacts[0]] }));
  assert.throws(() => verifyHomebrewRelease({ ...release, draft: true }, manifest, bytes, cask));
  const forged = Buffer.from(cask.toString().replace('AstraGit.app', 'Zeus.app'));
  const forgedRelease = { ...release, assets: release.assets.map(a => a.name === 'astragit.rb' ? asset(a.name, forged) : a) };
  assert.throws(() => verifyHomebrewRelease(forgedRelease, manifest, bytes, forged), /不一致/u);
});
test('update download verifies bytes, revalidates cached files and removes interrupted partial downloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-download-')); t.after(() => rm(root, { recursive: true, force: true }));
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const bytes = Buffer.alloc(120_000, 42); let calls = 0;
  const artifact = { arch: 'arm64', kind: 'dmg', fileName: 'AstraGit-0.2.0-arm64.dmg', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, downloadUrl: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-arm64.dmg' };
  globalThis.fetch = async () => { calls++; const response = new Response(bytes); Object.defineProperty(response, 'url', { value: 'https://release-assets.githubusercontent.com/asset' }); return response; };
  const path = join(root, artifact.fileName); const progress = [];
  await downloadVerifiedArtifact(artifact, path, value => progress.push(value)); assert.deepEqual(await readFile(path), bytes); assert.equal(progress.at(-1).phase, 'ready');
  await downloadVerifiedArtifact(artifact, path, () => {}); assert.equal(calls, 1, 'A matching cached artifact does not download again.');
  const electronPath = join(root, 'electron-response.dmg');
  globalThis.fetch = async () => { calls++; return new Response(bytes); };
  await downloadVerifiedArtifact(artifact, electronPath, () => {});
  assert.deepEqual(await readFile(electronPath), bytes);
  await rm(electronPath);
  await assert.rejects(downloadVerifiedArtifact({ ...artifact, sha256: 'a'.repeat(64) }, path, () => {}), /SHA-256/u);
  assert.deepEqual(await readFile(path), bytes); assert.deepEqual(await readdir(root), [artifact.fileName]);
});
