import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseReleaseManifest } from '../packages/shared/dist/index.js';
import { downloadVerifiedArtifact } from '../apps/desktop/src/main/releaseUpdateService.ts';
import { selectAutomaticVersion } from '../scripts/prepare-automatic-release.mjs';
import { renderHomebrewCask } from '../scripts/homebrew-cask.mjs';
import { verifyHomebrewRelease } from '../scripts/sync-homebrew-tap.mjs';

test('release versions reserve existing tags and update manifests reject foreign apps, origins and invalid hashes', () => {
  assert.equal(selectAutomaticVersion('0.1.0', []), '0.1.0'); assert.equal(selectAutomaticVersion('0.1.0', ['v0.1.0', 'v0.1.2']), '0.1.3'); assert.equal(selectAutomaticVersion('0.2.0', ['v0.1.2']), '0.2.0');
  const artifact = { arch: 'arm64', kind: 'dmg', fileName: 'AstraGit-0.2.0-arm64.dmg', sha256: 'a'.repeat(64), sizeBytes: 200_000, downloadUrl: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-arm64.dmg' };
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts: [artifact] };
  assert.equal(parseReleaseManifest(manifest).version, '0.2.0');
  assert.throws(() => parseReleaseManifest({ ...manifest, appId: 'dev.hypha.zeus' }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, downloadUrl: 'https://example.com/app.dmg' }] }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, sha256: 'bad' }] }));
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
