import type { GitCodeReviewEvent } from '@astragit/git-core';
import { parseReviewReport } from './gitCodeReview.js';

type Event = Extract<GitCodeReviewEvent, { type: 'summary' | 'impact' | 'check' | 'finding' }>;

/** 增量扫描 JSON：只在完整字段或问题对象闭合后解析、校验和发布。 */
export function createReviewReportStream(repositories: Array<{ repositoryId: string; files: string[] }>, redact: (text: string) => { text: string }, emit: (event: Event) => void) {
  let text = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = 0;
  let keyString = false;
  let expectingKey = true;
  let key = '';
  let itemStart = -1;
  const read = (start: number, end: number): unknown => {
    try { return JSON.parse(redact(text.slice(start, end)).text); }
    catch { throw Object.assign(new Error('模型返回的评审格式无效，已展示的问题已保留。'), { statusCode: 502 }); }
  };
  return (delta: string) => {
    const start = text.length;
    text += delta;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char !== '"') continue;
        inString = false;
        if (keyString) { key = String(read(stringStart, i + 1)); expectingKey = false; }
        else if ((depth === 1 && key === 'summary') || (depth === 2 && (key === 'impacts' || key === 'checks'))) {
          const value = read(stringStart, i + 1);
          if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error('模型返回的评审内容无效。'), { statusCode: 502 });
          emit({ type: key === 'summary' ? 'summary' : key === 'impacts' ? 'impact' : 'check', text: value.trim() });
        }
        continue;
      }
      if (char === '"' && depth) { inString = true; stringStart = i; keyString = depth === 1 && expectingKey; }
      else if (char === '{' || char === '[') {
        if (depth === 2 && key === 'findings' && char === '{') itemStart = i;
        depth++;
      } else if (char === '}' || char === ']') {
        if (depth === 3 && char === '}' && key === 'findings' && itemStart >= 0) {
          const finding = read(itemStart, i + 1);
          const report = parseReviewReport(JSON.stringify({ summary: 'partial', impacts: [], findings: [finding], checks: [] }), repositories);
          emit({ type: 'finding', finding: report.findings[0] });
          itemStart = -1;
        }
        depth--;
      } else if (char === ',' && depth === 1) expectingKey = true;
    }
  };
}

/** 保留未闭合的密钥 token，避免凭据跨分片时绕过脱敏。 */
export function createReviewThinkingStream(redact: (text: string) => { text: string }, emit: (text: string) => void) {
  let pending = '';
  return {
    push(delta: string) {
      pending += delta;
      const tail = pending.match(/(?:Bearer\s+)?[A-Za-z0-9._-]*$/u)?.[0] ?? '';
      const end = pending.length - tail.length;
      if (end) emit(redact(pending.slice(0, end)).text);
      pending = pending.slice(end);
    },
    finish() { if (pending) emit(redact(pending).text); pending = ''; },
  };
}
