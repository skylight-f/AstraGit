import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const repository = 'skylight-f/AstraGit';
const versionPaths = ['package.json', 'apps/desktop/package.json', ...['shared', 'git-core', 'git-server', 'ai-runtime', 'storage'].map(name => `packages/${name}/package.json`)];
const releasePaths = [...versionPaths, 'pnpm-lock.yaml'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const compare = (a, b) => { const left = a.split('.').map(Number); const right = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i]; return 0; };
export function selectAutomaticVersion(current, tags) {
  if (!/^\d+\.\d+\.\d+$/u.test(current)) throw new Error('发行版本必须是稳定的三段数字。');
  const published = tags.filter(tag => /^v\d+\.\d+\.\d+$/u.test(tag)).map(tag => tag.slice(1)).sort(compare);
  const highest = published.at(-1); if (!highest || compare(current, highest) > 0) return current;
  const parts = highest.split('.').map(Number); return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}
export function prepareAutomaticRelease() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== repository || !process.env.GITHUB_OUTPUT) throw new Error('自动发布仅在 AstraGit 的 GitHub Actions 中执行。');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('只允许从 main 发布。');
  const trigger = git('rev-parse', 'HEAD');
  let source = trigger;
  if (!/^[a-f0-9]{40}$/u.test(trigger) || git('status', '--porcelain')) throw new Error('发布检出状态无效。');
  if (process.env.GITHUB_EVENT_NAME === 'push' && event.after !== trigger) throw new Error('发布来源不是本次推送。');
  const remote = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u)[0];
  if (remote !== trigger) {
    git('fetch', '--no-tags', 'origin', 'refs/heads/main');
    const head = git('rev-parse', 'FETCH_HEAD');
    const parent = git('show', '-s', '--format=%P', head);
    const trailer = git('show', '-s', '--format=%B', head).match(/^AstraGit-Release-Source: ([a-f0-9]{40})$/mu)?.[1];
    if (head !== remote || parent !== trigger || trailer !== trigger) return { ready: false, reason: 'main 已更新，跳过旧提交。' };
    git('checkout', '--detach', head); source = head;
  }
  const versions = versionPaths.map(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')).version);
  if (versions.some(version => version !== versions[0])) throw new Error('所有 AstraGit 包必须使用同一发行版本。');
  const tagHeads = new Map();
  for (const line of git('ls-remote', '--tags', 'origin').split('\n').filter(Boolean)) { const [sha, ref] = line.split(/\s+/u); const tag = ref.replace(/^refs\/tags\//u, '').replace(/\^\{\}$/u, ''); if (!tagHeads.has(tag) || ref.endsWith('^{}')) tagHeads.set(tag, sha); }
  const tags = [...tagHeads.keys()];
  const releases = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'], { encoding: 'utf8' })).flat();
  const commitMessage = git('show', '-s', '--format=%B', source);
  const trailer = commitMessage.match(/^AstraGit-Release-Source: ([a-f0-9]{40})$/mu)?.[1];
  const changes = git('diff-tree', '--no-commit-id', '--name-only', '-r', source).split('\n');
  const notesPath = `releases/v${versions[0]}.md`;
  const allowed = new Set([...releasePaths, notesPath]);
  const candidate = trailer && git('show', '-s', '--format=%P', source) === trailer && changes.length > 0 && changes.every(path => allowed.has(path)) && existsSync(resolve(root, notesPath));
  if (source !== trigger && !candidate) throw new Error('远端候选未通过尾注、父提交和文件范围校验。');
  if (candidate) {
    const tag = `v${versions[0]}`;
    if (releases.some(release => release.tag_name === tag && !release.draft)) return { ready: false, reason: `${tag} 已发布。` };
    if (tags.includes(tag) && git('ls-remote', 'origin', `refs/tags/${tag}^{}`).split(/\s+/u)[0] !== source && git('ls-remote', 'origin', `refs/tags/${tag}`).split(/\s+/u)[0] !== source) throw new Error('已有发行标签指向不同提交。');
    return { ready: true, commit: source, tag, version: versions[0] };
  }
  if (releases.some(release => !release.draft && !release.prerelease && tagHeads.get(release.tag_name) === source)) return { ready: false, reason: '该源码提交已有公开发行。' };
  // 只有源码门禁成功后才准备版本提交；失败重跑复用候选，不重复递增。
  const version = selectAutomaticVersion(versions[0], [...tags, ...releases.map(release => release.tag_name)]);
  const tag = `v${version}`;
  const note = resolve(root, `releases/${tag}.md`); mkdirSync(resolve(root, 'releases'), { recursive: true });
  if (!existsSync(note)) writeFileSync(note, `# AstraGit ${version}\n\n## 更新内容\n\n本版本包含 main 分支中通过检查的改动。[查看源码提交](https://github.com/${repository}/commit/${source})。\n\n## 安装与更新\n\n下载与 Mac 架构匹配的 DMG。应用内「应用更新」可以检查和下载更新；自动重启安装要求当前应用及新版使用同一 Developer ID 团队，且新版通过 Apple 公证。未配置签名、公证时需手动安装。\n\n项目、模型配置、草稿和用户数据独立存储于 AstraGit，不与 Zeus 共用。\n`, { flag: 'wx' });
  for (const path of versionPaths) { const file = resolve(root, path); const data = JSON.parse(readFileSync(file, 'utf8')); writeFileSync(file, JSON.stringify({ ...data, version }, null, 2) + '\n'); }
  // 注入式工作区的包版本也写入锁文件，版本递增后继续支持 frozen install。
  execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: root, stdio: 'inherit' });
  git('config', 'user.name', 'AstraGit Release Bot'); git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', '--', ...releasePaths, `releases/${tag}.md`);
  if (!git('diff', '--cached', '--name-only')) return { ready: true, commit: source, tag, version };
  git('diff', '--cached', '--check'); git('commit', '-m', `chore(release): ${tag}`, '-m', `AstraGit-Release-Source: ${source}`);
  const commit = git('rev-parse', 'HEAD');
  try { git('push', 'origin', 'HEAD:refs/heads/main'); } catch (error) { if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/u)[0] !== commit) throw error; }
  return { ready: true, commit, tag, version };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = prepareAutomaticRelease();
  for (const [key, value] of Object.entries(result)) if (key !== 'reason') appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.info(result.reason ?? `发行候选 ${result.tag} / ${result.commit}`);
}
