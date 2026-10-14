import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareReleaseVersions, homebrewRepository, parseReleaseManifest, releaseRepository } from '../packages/shared/src/releaseUpdate.ts';
import { renderHomebrewCask } from './homebrew-cask.mjs';

export function verifyHomebrewRelease(release, manifest, bytes, caskBytes) {
  const parsed = parseReleaseManifest(manifest);
  if (release.draft || release.prerelease || release.tag_name !== `v${parsed.version}` || release.html_url !== `https://github.com/${releaseRepository}/releases/tag/v${parsed.version}`) throw new Error('Homebrew 只同步本仓库公开稳定发行。');
  for (const artifact of parsed.artifacts) {
    const asset = release.assets.find(a => a.name === artifact.fileName);
    if (!asset || asset.size !== artifact.sizeBytes || asset.digest !== `sha256:${artifact.sha256}` || asset.browser_download_url !== artifact.downloadUrl) throw new Error('Homebrew 产物与 GitHub 公开资产不一致。');
  }
  for (const [name, body] of [['astragit-release-manifest.json', bytes], ['astragit.rb', caskBytes]]) {
    const asset = release.assets.find(a => a.name === name);
    if (!asset || asset.size !== body.length || asset.digest !== `sha256:${createHash('sha256').update(body).digest('hex')}`) throw new Error('Homebrew 清单或 Cask 未通过 GitHub 摘要校验。');
  }
  if (caskBytes.toString('utf8') !== renderHomebrewCask(parsed)) throw new Error('公开 Cask 与更新清单不一致。');
  return parsed;
}
export async function syncHomebrewTap(directory) {
  const root = resolve(directory);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = git('remote', 'get-url', 'origin');
  if (![ `git@github.com:${homebrewRepository}.git`, `https://github.com/${homebrewRepository}.git`, `https://github.com/${homebrewRepository}` ].includes(origin) || git('status', '--porcelain')) throw new Error('Homebrew Tap 来源或检出状态无效。');
  const response = await fetch(`https://api.github.com/repos/${releaseRepository}/releases/latest`, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'AstraGit-Homebrew-Sync' } });
  if (!response.ok) throw new Error(`读取公开发行失败：${response.status}`);
  const release = await response.json();
  if (!/^v\d+\.\d+\.\d+$/u.test(release.tag_name)) throw new Error('公开发行标签无效。');
  const download = async name => {
    const url = `https://github.com/${releaseRepository}/releases/download/${release.tag_name}/${name}`;
    const asset = release.assets.find(a => a.name === name);
    if (!asset || asset.browser_download_url !== url || asset.size > 128_000) throw new Error('发行缺少匹配的 Homebrew 资产。');
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`读取 ${name} 失败：${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length > 128_000) throw new Error('Homebrew 资产过大。'); return bytes;
  };
  const [manifestBytes, caskBytes] = await Promise.all([download('astragit-release-manifest.json'), download('astragit.rb')]);
  const manifest = verifyHomebrewRelease(release, JSON.parse(manifestBytes), manifestBytes, caskBytes);
  const tagResponse = await fetch(`https://api.github.com/repos/${releaseRepository}/git/ref/tags/${release.tag_name}`, { signal: AbortSignal.timeout(30_000) });
  if (!tagResponse.ok || (await tagResponse.json()).object?.sha !== manifest.sourceCommit) throw new Error('发行标签与清单源码不一致。');
  const path = join(root, 'Casks/astragit.rb');
  const previous = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const version = previous.match(/^\s*version "(\d+\.\d+\.\d+)"$/mu)?.[1];
  if (version && compareReleaseVersions(version, manifest.version) > 0) throw new Error('Tap 已有更高版本，拒绝倒退。');
  if (previous === caskBytes.toString('utf8')) { console.info(`Homebrew AstraGit ${manifest.version} 已同步。`); return; }
  await mkdir(join(root, 'Casks'), { recursive: true }); await writeFile(path, caskBytes);
  git('diff', '--check'); git('config', 'user.name', 'AstraGit Homebrew Bot'); git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', '--', 'Casks/astragit.rb'); git('commit', '-m', `更新 AstraGit ${manifest.version} Cask`); git('push', 'origin', 'HEAD:main');
  console.info(`已自动同步 skylight-f/tap/astragit ${manifest.version}。`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2]; if (!directory) throw new Error('需要 Homebrew Tap 检出目录。');
  await syncHomebrewTap(directory);
}
