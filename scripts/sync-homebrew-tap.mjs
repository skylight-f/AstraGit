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
async function fetchHomebrewResource(url, token, label) {
  const api = new URL(url).origin === 'https://api.github.com';
  const redact = value => String(value).replaceAll(token, '[REDACTED]');
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'user-agent': 'AstraGit-Homebrew-Sync',
        // 公开下载会跳转到资产 CDN，认证仅用于 GitHub API。
        ...(api ? { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {}),
      },
    });
  } catch (error) {
    throw new Error(`${label}网络请求失败（${url}）：${redact(error.cause?.code || error.message)}`);
  }
  if (response.ok) return response;
  const diagnostics = [`${label}失败：HTTP ${response.status}（${url}）`];
  for (const name of ['x-github-request-id', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
    const value = response.headers.get(name);
    if (value) diagnostics.push(`${name}=${redact(value)}`);
  }
  if (response.status === 401) diagnostics.push('请检查 GH_TOKEN 是否有效以及是否可读取 AstraGit 发行。');
  if (response.status === 403 || response.status === 429) {
    diagnostics.push(response.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub API 配额已耗尽，请在 x-ratelimit-reset 指定的时间后重试。' : '请检查令牌权限或 GitHub 限流信息，并遵守 retry-after 后重试。');
  }
  try {
    const body = await response.text();
    let message = body;
    if (api) { try { message = JSON.parse(body).message || body; } catch { /* 保留非 JSON 错误正文。 */ } }
    if (message) diagnostics.push(redact(message).replace(/\s+/gu, ' ').slice(0, 1000));
  } catch { /* 错误正文读取失败时仍保留状态与响应头。 */ }
  throw new Error(diagnostics.join('\n'));
}

export async function loadHomebrewRelease({ tag, sourceCommit, token }) {
  if (!token?.trim()) throw new Error('Homebrew 同步缺少 GH_TOKEN（或 GITHUB_TOKEN），拒绝匿名请求 GitHub API。');
  if (!/^v\d+\.\d+\.\d+$/u.test(tag) || !/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('Homebrew 同步需要有效的 RELEASE_TAG 和 RELEASE_COMMIT。');
  const response = await fetchHomebrewResource(`https://api.github.com/repos/${releaseRepository}/releases/tags/${tag}`, token, '读取本次公开发行');
  const release = await response.json();
  if (release.tag_name !== tag || release.draft || release.prerelease) throw new Error('本次发行标签不匹配或尚非公开稳定发行。');
  const download = async name => {
    const url = `https://github.com/${releaseRepository}/releases/download/${release.tag_name}/${name}`;
    const asset = release.assets.find(a => a.name === name);
    if (!asset || asset.browser_download_url !== url || asset.size > 128_000) throw new Error('发行缺少匹配的 Homebrew 资产。');
    const r = await fetchHomebrewResource(url, token, `读取 ${name}`);
    const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length > 128_000) throw new Error('Homebrew 资产过大。'); return bytes;
  };
  const [manifestBytes, caskBytes] = await Promise.all([download('astragit-release-manifest.json'), download('astragit.rb')]);
  const manifest = verifyHomebrewRelease(release, JSON.parse(manifestBytes), manifestBytes, caskBytes);
  if (manifest.sourceCommit !== sourceCommit) throw new Error(`发行清单源码与本次发布提交不一致：expected=${sourceCommit} actual=${manifest.sourceCommit}`);
  const tagResponse = await fetchHomebrewResource(`https://api.github.com/repos/${releaseRepository}/git/ref/tags/${tag}`, token, '核对发行标签');
  if ((await tagResponse.json()).object?.sha !== sourceCommit) throw new Error('发行标签与本次发布提交不一致。');
  return { manifest, caskBytes };
}

function homebrewGit(root, execute = execFileSync) {
  return (...args) => {
    try {
      return execute('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
    } catch (error) {
      const output = String(error.stderr || error.message).trim();
      const permission = /(?:403|permission.*denied|write access.*not granted|authentication failed)/iu.test(output)
        ? ' HOMEBREW_TAP_TOKEN 无法写入 skylight-f/homebrew-tap；请授予目标仓库 Contents: Read and write 权限后重试。'
        : '';
      throw new Error(`Homebrew Git ${args[0]} 失败（exit=${error.status ?? 'unknown'}）：${output}${permission}`);
    }
  };
}

/** 检出成功只证明可读；通过 receive-pack 校验当前凭据的推送权限，不移动远端引用。 */
export function checkHomebrewTapAccess(directory, execute = execFileSync) {
  const root = resolve(directory);
  const git = homebrewGit(root, execute);
  const origin = git('remote', 'get-url', 'origin');
  if (![ `git@github.com:${homebrewRepository}.git`, `https://github.com/${homebrewRepository}.git`, `https://github.com/${homebrewRepository}` ].includes(origin) || git('status', '--porcelain')) throw new Error('Homebrew Tap 来源或检出状态无效。');
  git('push', '--dry-run', 'origin', 'HEAD:refs/heads/main');
}

export async function syncHomebrewTap(directory) {
  checkHomebrewTapAccess(directory);
  const { manifest, caskBytes } = await loadHomebrewRelease({ tag: process.env.RELEASE_TAG, sourceCommit: process.env.RELEASE_COMMIT, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  const root = resolve(directory);
  const git = homebrewGit(root);
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
  const checkAccess = process.argv[2] === '--check-access';
  const directory = process.argv[checkAccess ? 3 : 2]; if (!directory) throw new Error('需要 Homebrew Tap 检出目录。');
  if (checkAccess) {
    checkHomebrewTapAccess(directory);
    console.info('Homebrew Tap 来源、工作区和推送权限校验通过（dry-run，未修改远端引用）。');
  } else await syncHomebrewTap(directory);
}
