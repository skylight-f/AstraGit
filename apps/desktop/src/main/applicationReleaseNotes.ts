import { releaseRepository, type ApplicationReleaseNotes } from '@astragit/shared';

const versionPattern = /^\d+\.\d+\.\d+$/u;
const changesHeading = /^(?:更新内容|更新日志|变更记录|改动说明|版本更新|what['’]s (?:new|changed)|release notes|changelog|changes|highlights)$/iu;
const installationHeading = /^(?:安装|安装与更新|下载安装|下载与安装|下载|installation(?: (?:and|&) updates?)?|downloads?|assets)$/iu;

function extractNotes(body: string): string {
  const lines = body.replace(/\r\n?/gu, '\n').trim().split('\n');
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/u.exec(line);
    return match ? [{ index, level: match[1]!.length, title: match[2]! }] : [];
  });
  const changes = headings.find(heading => changesHeading.test(heading.title));
  if (changes) {
    const end = headings.find(heading => heading.index > changes.index && heading.level <= changes.level);
    return lines.slice(changes.index + 1, end?.index).join('\n').trim();
  }
  const start = /^#\s+AstraGit\b/iu.test(lines[0] ?? '') ? 1 : 0;
  const end = headings.find(heading => heading.index >= start && installationHeading.test(heading.title));
  return lines.slice(start, end?.index).join('\n').trim();
}

async function readGitHubJson(fetchRelease: typeof fetch, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetchRelease(`https://api.github.com/repos/${releaseRepository}/${path}`, {
    headers: { accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`读取发布说明失败（HTTP ${response.status}）。`);
  const source = await response.text();
  if (source.length > 512_000) throw new Error('发布说明响应过大。');
  return JSON.parse(source);
}

async function summarizeLegacyRelease(notes: string, fetchRelease: typeof fetch, signal: AbortSignal): Promise<string> {
  const sourceUrl = /^本版本包含 main 分支中通过检查的改动。\[查看源码提交\]\(([^)]+)\)。$/u.exec(notes)?.[1];
  const prefix = `https://github.com/${releaseRepository}/commit/`;
  if (!sourceUrl?.startsWith(prefix)) return notes;
  const sha = sourceUrl.slice(prefix.length);
  if (!/^[a-f0-9]{40}$/u.test(sha)) return notes;
  try {
    const commit = await readGitHubJson(fetchRelease, `git/commits/${sha}`, signal) as { sha?: unknown; message?: unknown } | null;
    if (commit?.sha !== sha || typeof commit.message !== 'string') return notes;
    const subject = commit.message.split(/\r?\n/u, 1)[0]!.trim().replace(/^[a-z]+(?:\([^)]*\))?!?:\s+/iu, '');
    return subject ? `- ${subject.slice(0, 500)}\n\n[查看源码提交](${sourceUrl})` : notes;
  } catch {
    return notes;
  }
}

/** Release notes are fetched independently of update detection and installer verification. */
export async function readApplicationReleaseNotes(requested: unknown, fetchRelease: typeof fetch = fetch): Promise<ApplicationReleaseNotes> {
  if (typeof requested !== 'string' || (requested !== 'latest' && !versionPattern.test(requested))) throw new Error('发行版本号无效。');
  const endpoint = requested === 'latest' ? 'latest' : `tags/v${requested}`;
  const signal = AbortSignal.timeout(12_000);
  const release = await readGitHubJson(fetchRelease, `releases/${endpoint}`, signal) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; body?: unknown } | null;
  const version = typeof release?.tag_name === 'string' && release.tag_name.startsWith('v') ? release.tag_name.slice(1) : '';
  if (!versionPattern.test(version) || (requested !== 'latest' && version !== requested) || release?.draft !== false || release?.prerelease !== false) {
    throw new Error('返回的发布说明与目标正式版本不匹配。');
  }
  const markdown = typeof release.body === 'string' ? await summarizeLegacyRelease(extractNotes(release.body), fetchRelease, signal) : '';
  return { version, markdown };
}
