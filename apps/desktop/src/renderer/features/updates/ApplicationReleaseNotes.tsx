/// <reference types="vite/client" />

import { ArrowSquareOut } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import type { ReactNode } from 'react';
import { extractReleaseNotes, releasePageUrl, releaseRepository } from '@astragit/shared';

const bundledNotes = import.meta.glob<string>('../../../../../../releases/v*.md', { eager: true, query: '?raw', import: 'default' });

export function ApplicationReleaseNotes({ version, zh, upcoming = false, markdown }: { version: string; zh: boolean; upcoming?: boolean; markdown?: string }) {
  const file = bundledNotes[`../../../../../../releases/v${version}.md`];
  const notes = (file ? extractReleaseNotes(file) : '') || markdown;
  const title = upcoming ? (zh ? '新版更新内容' : 'New version release notes') : (zh ? '更新内容' : 'Release notes');
  const url = `${releasePageUrl}/tag/v${version}`;
  return <section className="gitapp-release-notes" aria-label={title}>
    <header>
      <h4>{title}</h4>
      <span className="gitapp-release-notes-version">v{version}</span>
      <a href={url} target="_blank" rel="noreferrer">
        {zh ? '查看发布页' : 'View release'} <ArrowSquareOut size={14} aria-hidden="true" />
      </a>
    </header>
    {notes ? <div className="gitapp-release-notes-body">{renderNotes(notes, url)}</div> :
      <p className="gitapp-release-notes-empty">{upcoming
        ? (zh ? '可在发布页查看此版本的完整说明。' : 'See the release page for this version’s full notes.')
        : (zh ? '此版本暂无内置发布说明。' : 'No release notes were bundled for this version.')}</p>}
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
