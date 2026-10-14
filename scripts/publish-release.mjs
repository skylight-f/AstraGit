import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'release');
const repository = 'skylight-f/AstraGit';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== repository) throw new Error('公开发布仅允许在 AstraGit 的 Actions 中执行。');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', cwd: root }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', cwd: root }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (tag !== process.env.RELEASE_TAG || sourceCommit !== process.env.RELEASE_COMMIT || !/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('发布提交、版本或标签不一致。');
if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u)[0] !== sourceCommit) throw new Error('main 已更新，拒绝发布过时的候选。');
const metadata = [];
for (const arch of ['arm64', 'x64']) {
  const record = JSON.parse(await readFile(join(output, `artifact-${arch}.json`), 'utf8'));
  if (record.version !== version || record.artifact.arch !== arch || record.artifact.fileName !== `AstraGit-${version}-${arch}.dmg` || typeof record.signed !== 'boolean' || typeof record.notarized !== 'boolean') throw new Error('构建产物元数据无效。');
  const bytes = await readFile(join(output, record.artifact.fileName));
  if (bytes.length !== record.artifact.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== record.artifact.sha256) throw new Error('上传前产物校验失败。');
  metadata.push(record);
}
const manifest = { schemaVersion: 1, appId: 'com.astragit.desktop', repository, version, sourceCommit, signed: metadata.every(record => record.signed), notarized: metadata.every(record => record.notarized), minimumSystemVersion: '13.0', artifacts: metadata.map(record => ({ ...record.artifact, downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${record.artifact.fileName}` })) };
if (process.env.REQUIRE_APPLE_DISTRIBUTION === 'true' && (!manifest.signed || !manifest.notarized)) throw new Error('发行产物未满足强制签名与公证要求。');
const manifestPath = join(output, 'astragit-release-manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const notes = join(root, 'releases', `${tag}.md`); await readFile(notes);
const releases = JSON.parse(gh('api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp')).flat();
let release = releases.find(release => release.tag_name === tag);
if (release && !release.draft) { console.info(`${tag} 已公开发布，不覆盖既有产物。`); process.exit(0); }
const existingTag = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`);
if (existingTag) { const actual = existingTag.split('\n').at(-1).split(/\s+/u)[0]; if (actual !== sourceCommit) throw new Error('已有标签指向不同提交，拒绝覆盖。'); }
else { git('tag', tag, sourceCommit); git('push', 'origin', `refs/tags/${tag}`); }
if (!release) {
  // 草稿不能依赖 published-by-tag 查询；直接使用创建接口返回的真实 ID。
  release = JSON.parse(execFileSync('gh', ['api', '--method', 'POST', `repos/${repository}/releases`, '--input', '-'], {
    cwd: root, encoding: 'utf8', input: JSON.stringify({ tag_name: tag, target_commitish: sourceCommit, draft: true, name: `AstraGit ${version}`, body: await readFile(notes, 'utf8') }),
  }));
}
// 重跑仅替换仍为草稿的包；两架构与清单都上传并检查后才公开。
const assets = [...manifest.artifacts.map(artifact => join(output, artifact.fileName)), manifestPath];
gh('release', 'upload', tag, '--repo', repository, '--clobber', ...assets);
const publishedAssets = JSON.parse(gh('api', `repos/${repository}/releases/${release.id}/assets`));
for (const path of assets) { const fileName = path.split('/').at(-1); const asset = publishedAssets.find(asset => asset.name === fileName); if (!asset || asset.size !== (await readFile(path)).length) throw new Error('Release 资产未完整上传。'); }
gh('release', 'edit', tag, '--repo', repository, '--draft=false', '--latest');
console.info(`已发布 https://github.com/${repository}/releases/tag/${tag}`);
