/** Independent text model for Git merge/diff3/zdiff3 conflict markers. Offsets are UTF-16, like textarea selections. */
export type ConflictBlockChoice = 'current' | 'incoming' | 'both';
export type ConflictMarkerIssueReason = 'invalid_marker' | 'marker_size_mismatch' | 'unexpected_marker' | 'nested_start' | 'missing_separator' | 'missing_end';
export interface ConflictMarkerIssue {
  reason: ConflictMarkerIssueReason;
  start: number;
  end: number;
  line: number;
}
export interface ConflictBlock {
  id: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  markerSize: number;
  current: string;
  incoming: string;
  base: string | null;
  currentLabel: string;
  incomingLabel: string;
  baseLabel: string | null;
  currentStart: number;
  currentEnd: number;
  incomingStart: number;
  incomingEnd: number;
  baseStart: number | null;
  baseEnd: number | null;
  currentStartLine: number;
  incomingStartLine: number;
  baseStartLine: number | null;
  /** Exact original block, including marker line endings, for stale-selection checks. */
  raw: string;
  endMarkerLineEnding: '\r\n' | '\n' | '';
}
export interface ConflictParseResult {
  blocks: ConflictBlock[];
  issues: ConflictMarkerIssue[];
  /** True for recognized or malformed marker candidates, not standalone separator-like source lines. */
  hasMarkers: boolean;
  /** No conflict block or malformed marker remains. This does not imply that a Git index conflict is already staged. */
  canComplete: boolean;
}
export interface ConflictParseOptions {
  /** A Git conflict-marker-size attribute, when known. Without it, infer consistent widths of at least seven. */
  markerSize?: number;
}
interface TextLine { start: number; end: number; text: string; ending: '\r\n' | '\n' | ''; number: number }
interface Marker { kind: '<' | '|' | '=' | '>'; size: number; label: string; valid: boolean }
interface PendingBlock {
  opening: TextLine;
  marker: Marker;
  base: TextLine | null;
  baseLabel: string | null;
  separator: TextLine | null;
  invalid: boolean;
}

/** Only complete, consistently delimited blocks are returned. Malformed input is reported and never rewritten. */
export function parseConflictBlocks(content: string, options: ConflictParseOptions = {}): ConflictParseResult {
  if (options.markerSize !== undefined && (!Number.isSafeInteger(options.markerSize) || options.markerSize < 1)) {
    throw Object.assign(new Error('Git conflict marker size must be a positive integer.'), { code: 'ASTRAGIT_GIT_CONFLICT_MARKER_SIZE_INVALID' });
  }
  const blocks: ConflictBlock[] = [];
  const issues: ConflictMarkerIssue[] = [];
  let pending: PendingBlock | null = null;
  let hasMarkers = false;
  const issue = (reason: ConflictMarkerIssueReason, line: TextLine): void => { issues.push({ reason, start: line.start, end: line.end, line: line.number }); };
  for (const line of textLines(content)) {
    const marker = readMarker(line.text, options.markerSize);
    if (!marker) continue;
    // A configured wider marker intentionally permits narrower marker-like source lines.
    if (options.markerSize !== undefined && marker.size < options.markerSize) continue;
    // A decorative equals line is ordinary source until a conflict start has established a marker grammar.
    if (!pending && marker.kind === '=') continue;
    hasMarkers = true;
    if (!marker.valid) {
      issue('invalid_marker', line);
      if (pending) pending.invalid = true;
      continue;
    }
    if (!pending) {
      if (marker.kind !== '<') { issue('unexpected_marker', line); continue; }
      if (options.markerSize !== undefined && marker.size !== options.markerSize) { issue('marker_size_mismatch', line); continue; }
      pending = { opening: line, marker, base: null, baseLabel: null, separator: null, invalid: false };
      continue;
    }
    // Other marker widths can be literal source in either side. An unmatched opening still reports missing_end.
    if (marker.size !== pending.marker.size) continue;
    if (marker.kind === '<') {
      issue('nested_start', line);
      pending.invalid = true;
      continue;
    }
    if (marker.kind === '|') {
      if (pending.base || pending.separator) { issue('unexpected_marker', line); pending.invalid = true; }
      else { pending.base = line; pending.baseLabel = marker.label; }
      continue;
    }
    if (marker.kind === '=') {
      if (pending.separator) { issue('unexpected_marker', line); pending.invalid = true; }
      else pending.separator = line;
      continue;
    }
    if (!pending.separator) {
      issue('missing_separator', line);
    } else if (!pending.invalid) {
      const currentStart = pending.opening.end;
      const currentEnd = (pending.base ?? pending.separator).start;
      const incomingStart = pending.separator.end;
      const incomingEnd = line.start;
      const baseStart = pending.base?.end ?? null;
      const baseEnd = pending.base ? pending.separator.start : null;
      const raw = content.slice(pending.opening.start, line.end);
      blocks.push({
        id: `${pending.opening.start}:${line.end}:${textFingerprint(raw)}`,
        start: pending.opening.start, end: line.end,
        startLine: pending.opening.number, endLine: line.number, markerSize: marker.size,
        current: content.slice(currentStart, currentEnd), incoming: content.slice(incomingStart, incomingEnd),
        base: baseStart === null || baseEnd === null ? null : content.slice(baseStart, baseEnd),
        currentLabel: pending.marker.label, incomingLabel: marker.label, baseLabel: pending.baseLabel,
        currentStart, currentEnd, incomingStart, incomingEnd, baseStart, baseEnd,
        currentStartLine: pending.opening.number + 1, incomingStartLine: pending.separator.number + 1, baseStartLine: pending.base ? pending.base.number + 1 : null,
        raw, endMarkerLineEnding: line.ending,
      });
    }
    pending = null;
  }
  if (pending) issue('missing_end', pending.opening);
  return { blocks, issues, hasMarkers, canComplete: blocks.length === 0 && issues.length === 0 };
}

/** Guard for the final Git resolution step: valid blocks and malformed marker candidates both remain unresolved. */
export function hasUnresolvedGitConflictMarkers(content: string, markerSize: number): boolean {
  const parsed = parseConflictBlocks(content, { markerSize });
  return parsed.hasMarkers || parsed.blocks.length > 0 || parsed.issues.length > 0;
}

/** Accept exactly one freshly validated block. Call parseConflictBlocks again after any manual edit or acceptance. */
export function acceptConflictBlock(content: string, block: ConflictBlock, choice: ConflictBlockChoice): string {
  if (choice !== 'current' && choice !== 'incoming' && choice !== 'both') {
    throw Object.assign(new Error('Invalid conflict resolution choice.'), { code: 'ASTRAGIT_GIT_CONFLICT_CHOICE_INVALID' });
  }
  const current = parseConflictBlocks(content, { markerSize: block.markerSize }).blocks.find(candidate => candidate.id === block.id && candidate.start === block.start && candidate.end === block.end && candidate.raw === block.raw);
  if (!current) throw Object.assign(new Error('冲突内容已经变化，请刷新冲突块后再操作。'), { code: 'ASTRAGIT_GIT_CONFLICT_BLOCK_STALE' });
  let replacement = choice === 'both' ? current.current + current.incoming : current[choice];
  // Keep an unterminated final file unterminated. Do not normalize any line ending within the chosen text.
  if (current.end === content.length && current.endMarkerLineEnding === '') replacement = replacement.replace(/\r?\n$/u, '');
  return content.slice(0, current.start) + replacement + content.slice(current.end);
}

function* textLines(content: string): Generator<TextLine> {
  let start = 0;
  let number = 1;
  while (start < content.length) {
    const newline = content.indexOf('\n', start);
    const end = newline < 0 ? content.length : newline + 1;
    const ending = newline < 0 ? '' : content[newline - 1] === '\r' ? '\r\n' : '\n';
    yield { start, end, text: content.slice(start, end - ending.length), ending, number };
    start = end;
    number += 1;
  }
}

function readMarker(text: string, configuredSize: number | undefined): Marker | null {
  const run = /^([<|=>])\1*/u.exec(text);
  if (!run || run[0].length < (configuredSize === undefined ? 7 : Math.min(7, configuredSize))) return null;
  const kind = run[1] as Marker['kind'];
  const suffix = text.slice(run[0].length);
  const valid = kind === '=' ? suffix === '' : suffix === '' || /^[ \t]/u.test(suffix);
  return { kind, size: run[0].length, label: suffix.trim(), valid };
}

function textFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}
