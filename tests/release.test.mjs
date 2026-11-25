import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseReleaseManifest } from '../packages/shared/dist/index.js';
import { createReleaseUpdateService, downloadVerifiedArtifact } from '../apps/desktop/src/main/releaseUpdateService.ts';
import { readApplicationReleaseNotes } from '../apps/desktop/src/main/applicationReleaseNotes.ts';
import { formatReleaseChanges, selectAutomaticVersion } from '../scripts/prepare-automatic-release.mjs';
import { renderHomebrewCask } from '../scripts/homebrew-cask.mjs';
import { checkHomebrewTapAccess, loadHomebrewRelease, verifyHomebrewRelease } from '../scripts/sync-homebrew-tap.mjs';

test('Homebrew preflight verifies push access without updating a remote ref', () => {
  const calls = [];
  checkHomebrewTapAccess('.tmp/homebrew-tap', (command, args, options) => {
    assert.equal(command, 'git');
    assert.equal(options.cwd, resolve('.tmp/homebrew-tap'));
    assert.equal(options.timeout, 60_000);
    calls.push(args);
    return args[0] === 'remote' ? 'https://github.com/skylight-f/homebrew-tap\n' : '';
  });
  assert.deepEqual(calls, [
    ['remote', 'get-url', 'origin'], ['status', '--porcelain'],
    ['push', '--dry-run', 'origin', 'HEAD:refs/heads/main'],
  ]);
});

test('Homebrew preflight rejects readable taps with no push permission and explains the required credential', () => {
  assert.throws(() => checkHomebrewTapAccess('.tmp/homebrew-tap', (_command, args) => {
    if (args[0] === 'remote') return 'https://github.com/skylight-f/homebrew-tap';
    if (args[0] === 'status') return '';
    throw Object.assign(new Error('push failed'), { status: 128, stderr: 'remote: Permission to skylight-f/homebrew-tap.git denied to skylight-f. HTTP 403' });
  }), error => {
    for (const text of ['push', '403', 'HOMEBREW_TAP_TOKEN', 'Contents: Read and write']) assert.ok(error.message.includes(text), text);
    return true;
  });
});

test('Homebrew preflight rejects foreign origins or dirty checkouts before attempting push access', () => {
  for (const [origin, status] of [['https://github.com/foreign/tap', ''], ['https://github.com/skylight-f/homebrew-tap', ' M Casks/astragit.rb']]) {
    assert.throws(() => checkHomebrewTapAccess('.tmp/homebrew-tap', (_command, args) => {
      if (args[0] === 'remote') return origin;
      if (args[0] === 'status') return status;
      assert.fail('Invalid tap must not attempt push access.');
    }), /来源或检出状态无效/u);
  }
});

test('application release notes read the requested stable tag and isolate the changes section', async () => {
  const release = { tag_name: 'v0.2.0', draft: false, prerelease: false, body: "# AstraGit 0.2.0\r\n\r\n## What's Changed\r\n\r\n- Add folder scanning\r\n\r\n### Fixes\r\n\r\n- Preserve project settings\r\n\r\n## Installation\r\n\r\nDownload the installer." };
  const request = async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/skylight-f/AstraGit/releases/tags/v0.2.0');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    return Response.json(release);
  };
  assert.deepEqual(await readApplicationReleaseNotes('0.2.0', request), {
    version: '0.2.0', markdown: '- Add folder scanning\n\n### Fixes\n\n- Preserve project settings',
  });
  release.tag_name = 'v0.2.1';
  await assert.rejects(readApplicationReleaseNotes('0.2.0', request), /目标正式版本/u);
  release.prerelease = true;
  await assert.rejects(readApplicationReleaseNotes('latest', () => Response.json(release)), /目标正式版本/u);
  await assert.rejects(readApplicationReleaseNotes('../latest', () => assert.fail('Invalid versions must not request a URL.')), /版本号无效/u);
});

test('automatically generated release notes list actual changes without repeated release commits', () => {
  assert.equal(formatReleaseChanges('feat(projects): 扫描目录\nchore(release): v0.1.27\nfix(ui): 窗口样式\nfeat: 扫描目录'), '- 扫描目录\n- 窗口样式');
});

test('older boilerplate notes can display their published source commit subject', async () => {
  const sha = 'a'.repeat(40);
  const source = `https://github.com/skylight-f/AstraGit/commit/${sha}`;
  const original = `本版本包含 main 分支中通过检查的改动。[查看源码提交](${source})。`;
  let commitFound = true;
  const request = async url => {
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: 'v0.1.27', draft: false, prerelease: false, body: `## 更新内容\n\n${original}` });
    assert.ok(url.endsWith(`/git/commits/${sha}`));
    return Response.json({ sha: commitFound ? sha : 'b'.repeat(40), message: 'feat(release): Add Windows installer\n\nOther details' });
  };
  assert.deepEqual(await readApplicationReleaseNotes('latest', request), {
    version: '0.1.27', markdown: `- Add Windows installer\n\n[查看源码提交](${source})`,
  });
  commitFound = false;
  assert.equal((await readApplicationReleaseNotes('latest', request)).markdown, original);
});

test('release versions reserve existing tags and update manifests reject foreign apps, origins and invalid hashes', () => {
  assert.equal(selectAutomaticVersion('0.1.0', []), '0.1.0'); assert.equal(selectAutomaticVersion('0.1.0', ['v0.1.0', 'v0.1.2']), '0.1.3'); assert.equal(selectAutomaticVersion('0.2.0', ['v0.1.2']), '0.2.0');
  const artifact = { arch: 'arm64', kind: 'dmg', fileName: 'AstraGit-0.2.0-arm64.dmg', sha256: 'a'.repeat(64), sizeBytes: 200_000, downloadUrl: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-arm64.dmg' };
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts: [artifact] };
  assert.equal(parseReleaseManifest(manifest).version, '0.2.0');
  assert.throws(() => parseReleaseManifest({ ...manifest, appId: 'dev.hypha.zeus' }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, downloadUrl: 'https://example.com/app.dmg' }] }));
  assert.throws(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, sha256: 'bad' }] }));
});

test('Windows updates select the exact stable x64 EXE with its published digest', async () => {
  const sha256 = 'c'.repeat(64);
  const asset = {
    name: 'AstraGit-0.2.0-win-x64-setup.exe', state: 'uploaded', size: 120_000, digest: 'sha256:' + sha256,
    browser_download_url: 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/AstraGit-0.2.0-win-x64-setup.exe',
  };
  const release = { tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [{ ...asset, name: 'AstraGit-0.2.0-x64.dmg' }, asset] };
  let registered = true;
  const service = createReleaseUpdateService({
    appPath: '', executablePath: 'C:\\AstraGit\\AstraGit.exe', dataDirectory: '', version: '0.1.0', packaged: true,
    onProgress: () => {}, confirmRestart: () => assert.fail('A check cannot request restart'), quit: () => assert.fail('A check cannot quit'),
    onWindowsInstallReady: () => assert.fail('A check cannot run the installer'),
    fetch: (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/skylight-f/AstraGit/releases/latest');
      assert.equal(options.redirect, 'error');
      return Response.json(release);
    },
  }, { platform: 'win32', arch: 'x64', readWindowsInstallScope: async () => registered ? 'currentuser' : null });

  const update = await service.check();
  assert.equal(update.status, 'available');
  assert.equal(update.artifact.kind, 'exe');
  assert.equal(update.artifact.sha256, sha256);
  assert.equal(update.automaticInstallEnabled, true);
  registered = false;
  assert.equal((await service.check()).automaticInstallEnabled, false);

  for (const invalid of [{ digest: null }, { browser_download_url: 'https://example.invalid/setup.exe' }, { state: 'new' }]) {
    release.assets = [{ ...asset, ...invalid }];
    assert.equal((await service.check()).artifact, null);
  }
  release.prerelease = true;
  assert.equal((await service.check()).status, 'unavailable');
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

function homebrewReleaseFixture() {
  const base = 'https://github.com/skylight-f/AstraGit/releases/download/v0.2.0';
  const artifacts = ['arm64', 'x64'].map((arch, i) => ({ arch, kind: 'dmg', fileName: `AstraGit-0.2.0-${arch}.dmg`, sha256: String(i + 1).repeat(64), sizeBytes: 200_000 + i, downloadUrl: `${base}/AstraGit-0.2.0-${arch}.dmg` }));
  const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository: 'skylight-f/AstraGit', version: '0.2.0', sourceCommit: 'b'.repeat(40), signed: false, notarized: false, minimumSystemVersion: '13.0', artifacts };
  const files = { 'astragit-release-manifest.json': Buffer.from(JSON.stringify(manifest)), 'astragit.rb': Buffer.from(renderHomebrewCask(manifest)) };
  const release = { tag_name: 'v0.2.0', draft: false, prerelease: false, html_url: 'https://github.com/skylight-f/AstraGit/releases/tag/v0.2.0', assets: [...artifacts.map(a => ({ name: a.fileName, size: a.sizeBytes, digest: `sha256:${a.sha256}`, browser_download_url: a.downloadUrl })), ...Object.entries(files).map(([name, body]) => ({ name, size: body.length, digest: `sha256:${createHash('sha256').update(body).digest('hex')}`, browser_download_url: `${base}/${name}` }))] };
  return { manifest, files, release, input: { tag: 'v0.2.0', sourceCommit: manifest.sourceCommit, token: 'fixture-token' } };
}

test('Homebrew sync authenticates API reads, keeps credentials off public downloads and binds the exact published tag and commit', async t => {
  const f = homebrewReleaseFixture();
  const requests = [];
  let tagCommit = f.manifest.sourceCommit;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, headers: new Headers(options.headers) });
    if (url.endsWith('/releases/tags/v0.2.0')) return Response.json(f.release);
    if (url.endsWith('/git/ref/tags/v0.2.0')) return Response.json({ object: { sha: tagCommit } });
    const name = url.split('/').at(-1);
    assert.ok(url.startsWith('https://github.com/skylight-f/AstraGit/releases/download/v0.2.0/'));
    assert.ok(f.files[name], `Unexpected request: ${url}`);
    return new Response(f.files[name]);
  });
  assert.deepEqual(await loadHomebrewRelease(f.input), { manifest: f.manifest, caskBytes: f.files['astragit.rb'] });
  assert.equal(requests.length, 4);
  for (const { url, headers } of requests) assert.equal(headers.get('authorization'), new URL(url).hostname === 'api.github.com' ? 'Bearer fixture-token' : null);
  await assert.rejects(loadHomebrewRelease({ ...f.input, sourceCommit: 'c'.repeat(40) }), /清单源码与本次发布提交不一致/u);
  tagCommit = 'c'.repeat(40);
  await assert.rejects(loadHomebrewRelease(f.input), /标签与本次发布提交不一致/u);
  f.release.tag_name = 'v0.3.0';
  await assert.rejects(loadHomebrewRelease(f.input), /标签不匹配/u);
});

test('Homebrew sync fails before networking without credentials or a valid release identity', async t => {
  const f = homebrewReleaseFixture();
  const network = t.mock.method(globalThis, 'fetch', () => assert.fail('Invalid input must not make a request.'));
  await assert.rejects(loadHomebrewRelease({ ...f.input, token: '' }), /缺少 GH_TOKEN/u);
  await assert.rejects(loadHomebrewRelease({ ...f.input, tag: undefined }), /RELEASE_TAG/u);
  await assert.rejects(loadHomebrewRelease({ ...f.input, sourceCommit: undefined }), /RELEASE_COMMIT/u);
  assert.equal(network.mock.callCount(), 0);
});

test('Homebrew failures report HTTP, rate limits, request IDs and transport errors without revealing the token', async t => {
  const f = homebrewReleaseFixture();
  let status = 403;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: `API rate limit exceeded: ${f.input.token}` }, { status, headers: { 'x-github-request-id': 'request-fixture', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000', 'retry-after': '60' } }));
  await assert.rejects(loadHomebrewRelease(f.input), error => {
    for (const expected of ['HTTP 403', '读取本次公开发行', 'request-fixture', 'x-ratelimit-remaining=0', 'x-ratelimit-reset=1900000000', 'retry-after=60', 'API rate limit exceeded', '[REDACTED]']) assert.ok(error.message.includes(expected), expected);
    assert.ok(!error.message.includes(f.input.token));
    return true;
  });
  status = 401;
  await assert.rejects(loadHomebrewRelease(f.input), /请检查 GH_TOKEN/u);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); });
  await assert.rejects(loadHomebrewRelease(f.input), /读取本次公开发行网络请求失败.*ECONNRESET/u);
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
