import { ArrowSquareOut } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { useEffect, useState, type ReactNode } from 'react';
import { releasePageUrl, releaseRepository, type ApplicationReleaseNotes as ReleaseNotes } from '@astragit/shared';

export function ApplicationReleaseNotes({ requested, zh }: { requested: string; zh: boolean }) {
  const [notes, setNotes] = useState<ReleaseNotes | null>();
  const load = window.astraGit?.loadReleaseNotes;
  useEffect(() => {
    let live = true;
    void load?.(requested).then(value => { if (live) setNotes(value); }, () => { if (live) setNotes(null); });
    return () => { live = false; };
  }, [load, requested]);

  const version = notes?.version ?? (requested === 'latest' ? null : requested);
  const url = version ? `${releasePageUrl}/tag/v${version}` : `${releasePageUrl}/latest`;
  return <section className="gitapp-release-notes" aria-label={zh ? '更新内容' : 'Release notes'}>
    <header>
      <h4>{zh ? '更新内容' : 'Release notes'}</h4>
      {version ? <span className="gitapp-release-notes-version">v{version}</span> : null}
      <a href={url} target="_blank" rel="noreferrer">
        {zh ? '查看发布页' : 'View release'} <ArrowSquareOut size={14} aria-hidden="true" />
      </a>
    </header>
    {notes?.markdown ? <div className="gitapp-release-notes-body">{renderNotes(notes.markdown, url)}</div> :
      <p className="gitapp-release-notes-empty" role="status">{!load || notes === null
        ? (zh ? '暂时无法读取发布说明。' : 'Release notes are temporarily unavailable.')
        : notes ? (zh ? '此版本暂无发布说明。' : 'No release notes were provided for this version.')
          : (zh ? '正在读取发布说明…' : 'Loading release notes…')}</p>}
  </section>;
}

function renderNotes(markdown: string, baseUrl: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  for (const [index, block] of markdown.split(/\n[\t ]*\n/u).entries()) {
    const text = block.trim();
    if (!text) continue;
    const lines = text.split('\n');
    const list = lines.map(line => /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/u.exec(line));
    if (list.every(item => item !== null)) {
      const List = /^\s*\d+[.)]\s/u.test(lines[0]!) ? 'ol' : 'ul';
      blocks.push(<List key={index}>{list.map((item, position) => <li key={position}>{inlineNotes(item[1]!, baseUrl)}</li>)}</List>);
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/u.exec(text);
    blocks.push(heading ? <h5 key={index}>{inlineNotes(heading[1]!, baseUrl)}</h5> : <p key={index}>{inlineNotes(text, baseUrl)}</p>);
  }
  return blocks;
}

function inlineNotes(text: string, baseUrl: string): ReactNode[] {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/(!?)\[([^\]\n]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*/gu)) {
    const { index } = match;
    if (index > cursor) content.push(text.slice(cursor, index));
    const [, image, label, href, code, bold] = match;
    if (code) content.push(<code key={index}>{code}</code>);
    else if (bold) content.push(<strong key={index}>{bold}</strong>);
    else {
      const url = !image && href ? releaseNoteLink(href, baseUrl) : null;
      content.push(url ? <a key={index} href={url} target="_blank" rel="noreferrer">{label}</a> : label);
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) content.push(text.slice(cursor));
  return content;
}

function releaseNoteLink(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    return url.origin === 'https://github.com' &&
      !url.username && !url.password &&
      url.pathname.toLowerCase().startsWith(`/${releaseRepository.toLowerCase()}/`)
      ? url.href : null;
  } catch {
    return null;
  }
}
