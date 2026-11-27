export interface ConflictTextPosition { lineNumber: number; column: number }
export interface ConflictTextEdit {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  text: string;
}
interface RawLine { start: number; end: number }
interface RawLayout { bom: boolean; endings: string }

function rawLines(content: string): RawLine[] {
  const lines: RawLine[] = [];
  let start = content.startsWith('\uFEFF') ? 1 : 0;
  const endings = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = endings.exec(content))) {
    lines.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: content.length });
  return lines;
}

function offsetAt(lines: RawLine[], position: ConflictTextPosition): number {
  const line = lines[Math.max(0, Math.min(lines.length - 1, position.lineNumber - 1))]!;
  return Math.max(line.start, Math.min(line.end, line.start + position.column - 1));
}

/** Monaco 的行/列和 JavaScript 字符串均按 UTF-16 计数；原文件的换行宽度独立保留。 */
export function conflictRawOffsetAt(content: string, position: ConflictTextPosition): number {
  return offsetAt(rawLines(content), position);
}

export function conflictRawPositionMapper(content: string): (offset: number) => ConflictTextPosition {
  const lines = rawLines(content);
  return offset => {
    const bounded = Math.max(0, Math.min(content.length, Number.isFinite(offset) ? Math.floor(offset) : 0));
    let first = 0;
    let last = lines.length - 1;
    while (first < last) {
      const middle = Math.ceil((first + last) / 2);
      if (lines[middle]!.start <= bounded) first = middle; else last = middle - 1;
    }
    const line = lines[first]!;
    return { lineNumber: first + 1, column: Math.max(1, Math.min(bounded, line.end) - line.start + 1) };
  };
}

export function conflictRawPositionAt(content: string, offset: number): ConflictTextPosition {
  return conflictRawPositionMapper(content)(offset);
}

/** 所有 range 都指向编辑前的同一文本，因此从后向前 splice，不能使用模型归一化后的整段内容。 */
export function applyConflictRawEdits(content: string, changes: readonly ConflictTextEdit[]): string {
  const lines = rawLines(content);
  const edits = changes.map(change => ({
    start: offsetAt(lines, { lineNumber: change.range.startLineNumber, column: change.range.startColumn }),
    end: offsetAt(lines, { lineNumber: change.range.endLineNumber, column: change.range.endColumn }),
    text: change.text,
  })).sort((a, b) => b.start - a.start || b.end - a.end);
  let next = content;
  for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}

/** 只用于判断/同步模型显示；保存与 onChange 始终使用原始文本。 */
export function conflictModelText(content: string, eol: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n|\r|\n/g, eol);
}

function endingCode(ending: string): string {
  return ending === '\r\n' ? 'C' : ending === '\r' ? 'R' : 'L';
}
function endingText(code: string | undefined): string {
  return code === 'C' ? '\r\n' : code === 'R' ? '\r' : '\n';
}

/** 每个 Monaco alternative version 记录原始行尾布局；普通字符编辑共享布局，避免逐按键复制整文件。 */
export class ConflictRawTextHistory {
  content: string;
  private readonly versions = new Map<number, RawLayout>();
  private readonly layouts = new Map<string, RawLayout>();

  constructor(content: string, alternativeVersion: number) {
    this.content = content;
    this.synchronize(content, alternativeVersion);
  }

  synchronize(content: string, alternativeVersion: number): void {
    this.content = content;
    let codes = '';
    const endings = /\r\n|\r|\n/g;
    let match: RegExpExecArray | null;
    while ((match = endings.exec(content))) codes += endingCode(match[0]);
    const bom = content.startsWith('\uFEFF');
    const key = `${bom ? '1' : '0'}${codes}`;
    let layout = this.layouts.get(key);
    if (!layout) {
      layout = { bom, endings: codes };
      this.layouts.set(key, layout);
    }
    this.versions.set(alternativeVersion, layout);
  }

  apply(changes: readonly ConflictTextEdit[], alternativeVersion: number, restoringHistory: boolean): string {
    let next = applyConflictRawEdits(this.content, changes);
    const layout = restoringHistory ? this.versions.get(alternativeVersion) : undefined;
    if (layout) {
      let index = 0;
      next = next.replace(/^\uFEFF/, '').replace(/\r\n|\r|\n/g, () => endingText(layout.endings[index++]));
      if (layout.bom) next = '\uFEFF' + next;
    }
    this.synchronize(next, alternativeVersion);
    return next;
  }
}
