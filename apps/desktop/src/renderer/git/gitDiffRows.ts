import type { GitDiffHunk, GitDiffLine } from '../apiClient.js';

export interface InlineDiffChange {
  before: string;
  changed: string;
  after: string;
}

export interface DiffCell {
  content: string;
  number: number | null;
  kind: GitDiffLine['type'] | 'empty';
  highlight?: InlineDiffChange;
}

export interface AlignedDiffRow {
  left: DiffCell;
  right: DiffCell;
}

const emptyCell = (): DiffCell => ({ content: '', number: null, kind: 'empty' });

/** 沿用 Zeus 的连续变更块配对方式；补位不参与文件行号或原文。 */
export function alignedDiffRows(hunk: GitDiffHunk): AlignedDiffRow[] {
  const rows: AlignedDiffRow[] = [];
  for (let index = 0; index < hunk.lines.length;) {
    const line = hunk.lines[index]!;
    if (line.type === 'addition' || line.type === 'deletion') {
      const deleted: GitDiffLine[] = [];
      const added: GitDiffLine[] = [];
      while (index < hunk.lines.length && (hunk.lines[index]!.type === 'addition' || hunk.lines[index]!.type === 'deletion')) {
        const changed = hunk.lines[index++]!;
        (changed.type === 'deletion' ? deleted : added).push(changed);
      }
      for (let offset = 0; offset < Math.max(deleted.length, added.length); offset++) {
        const oldLine = deleted[offset];
        const newLine = added[offset];
        const left: DiffCell = oldLine ? { content: oldLine.content, number: oldLine.oldLineNumber, kind: 'deletion' } : emptyCell();
        const right: DiffCell = newLine ? { content: newLine.content, number: newLine.newLineNumber, kind: 'addition' } : emptyCell();
        if (oldLine && newLine && oldLine.content !== newLine.content) {
          const change = replacementHighlight(oldLine.content, newLine.content);
          left.highlight = change.left;
          right.highlight = change.right;
        }
        rows.push({ left, right });
      }
    } else {
      rows.push({
        left: { content: line.content, number: line.oldLineNumber, kind: line.type },
        right: { content: line.content, number: line.newLineNumber, kind: line.type },
      });
      index++;
    }
  }
  return rows;
}

/** 高亮替换行中变化的范围；按 Unicode 码点比较，完整保留空白和源码。 */
export function replacementHighlight(original: string, modified: string): { left: InlineDiffChange; right: InlineDiffChange } {
  const left = Array.from(original);
  const right = Array.from(modified);
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
  let end = 0;
  while (end < Math.min(left.length, right.length) - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const parts = (text: string[]): InlineDiffChange => ({
    before: text.slice(0, start).join(''),
    changed: text.slice(start, text.length - end).join(''),
    after: text.slice(text.length - end).join(''),
  });
  return { left: parts(left), right: parts(right) };
}
