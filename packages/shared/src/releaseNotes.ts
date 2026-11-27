const changesHeading = /^(?:更新内容|更新日志|变更记录|改动说明|版本更新|what['’]s (?:new|changed)|release notes|changelog|changes|highlights)$/iu;
const installationHeading = /^(?:安装|安装与更新|下载安装|下载与安装|下载|installation(?: (?:and|&) updates?)?|downloads?|assets)$/iu;

export function boundedReleaseNotes(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 32_000 ? value.trim() || undefined : undefined;
}

export function extractReleaseNotes(body: string): string {
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
