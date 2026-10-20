import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acceptConflictBlock, hasUnresolvedGitConflictMarkers, parseConflictBlocks } from '../packages/shared/src/gitConflictMarkers.ts';

const conflict = (current, incoming, options = {}) => {
  const { eol = '\n', size = 7, currentLabel = 'HEAD', incomingLabel = 'feature/topic', base, baseLabel = 'base', trailing = true } = options;
  const marker = char => char.repeat(size);
  return `${marker('<')} ${currentLabel}${eol}${current}${base === undefined ? '' : `${marker('|')} ${baseLabel}${eol}${base}`}${marker('=')}${eol}${incoming}${marker('>')} ${incomingLabel}${trailing ? eol : ''}`;
};

function onlyBlock(content, options) {
  const parsed = parseConflictBlocks(content, options);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.canComplete, false);
  return parsed.blocks[0];
}

test('each action replaces only its selected block and retains all context and other conflicts', () => {
  const first = conflict('const value = "current";\n', 'const value = "incoming";\n');
  const second = conflict('left();\n', 'right();\n');
  const content = `// 🛠 context\n${first}// between\n${second}// tail\n`;
  const parsed = parseConflictBlocks(content);
  assert.equal(parsed.blocks.length, 2);
  assert.deepEqual(parsed.issues, []);
  const [a, b] = parsed.blocks;
  assert.equal(a.start, '// 🛠 context\n'.length);
  assert.equal(a.raw, first);
  assert.equal(a.startLine, 2);
  assert.equal(a.currentStartLine, 3);
  assert.equal(a.incomingStartLine, 5);
  assert.equal(a.currentLabel, 'HEAD');
  assert.equal(a.incomingLabel, 'feature/topic');
  assert.equal(a.base, null);
  assert.equal(a.current, content.slice(a.currentStart, a.currentEnd));
  for (const choice of ['current', 'incoming', 'both']) {
    const replacement = choice === 'both' ? a.current + a.incoming : a[choice];
    assert.equal(acceptConflictBlock(content, a, choice), `// 🛠 context\n${replacement}// between\n${second}// tail\n`);
  }
  assert.equal(acceptConflictBlock(content, b, 'incoming'), `// 🛠 context\n${first}// between\nright();\n// tail\n`);
  const next = acceptConflictBlock(content, a, 'current');
  assert.equal(parseConflictBlocks(next).blocks.length, 1);
  assert.equal(acceptConflictBlock(next, onlyBlock(next), 'incoming'), '// 🛠 context\nconst value = "current";\n// between\nright();\n// tail\n');
});

test('CRLF, mixed source endings, blank lines and indentation are never normalized', () => {
  const current = '\tcurrent();\r\n\r\n';
  const incoming = '  incoming();\nnext();\r\n';
  const content = `before\r\n${conflict(current, incoming, { eol: '\r\n' })}after\n`;
  const block = onlyBlock(content);
  assert.equal(block.current, current);
  assert.equal(block.incoming, incoming);
  assert.equal(block.endMarkerLineEnding, '\r\n');
  assert.equal(acceptConflictBlock(content, block, 'both'), `before\r\n${current}${incoming}after\n`);
});

test('final marker without newline keeps nonempty accepted output unterminated', () => {
  const content = 'before\r\n' + conflict('current\r\n', 'incoming\r\n', { eol: '\r\n', trailing: false });
  const block = onlyBlock(content);
  assert.equal(block.end, content.length);
  assert.equal(block.endMarkerLineEnding, '');
  assert.equal(block.current, 'current\r\n', 'Parsed side text is still exact raw text.');
  assert.equal(acceptConflictBlock(content, block, 'current'), 'before\r\ncurrent');
  assert.equal(acceptConflictBlock(content, block, 'incoming'), 'before\r\nincoming');
  assert.equal(acceptConflictBlock(content, block, 'both'), 'before\r\ncurrent\r\nincoming');
  const contextWithoutFinalNewline = conflict('one\n', 'two\n') + 'last context';
  assert.equal(acceptConflictBlock(contextWithoutFinalNewline, onlyBlock(contextWithoutFinalNewline), 'incoming'), 'two\nlast context');
});

test('empty sections represent deletion without adding a blank line or retaining the base', () => {
  const deleteCurrent = `before\n${conflict('', 'incoming\n', { base: 'original\n' })}after\n`;
  const block = onlyBlock(deleteCurrent);
  assert.equal(block.current, '');
  assert.equal(block.base, 'original\n');
  assert.equal(acceptConflictBlock(deleteCurrent, block, 'current'), 'before\nafter\n');
  assert.equal(acceptConflictBlock(deleteCurrent, block, 'both'), 'before\nincoming\nafter\n');
  const deleteIncoming = conflict('current\n', '');
  assert.equal(acceptConflictBlock(deleteIncoming, onlyBlock(deleteIncoming), 'incoming'), '');
  const bothEmpty = conflict('', '', { base: '' });
  assert.equal(onlyBlock(bothEmpty).base, '');
  assert.equal(acceptConflictBlock(bothEmpty, onlyBlock(bothEmpty), 'both'), '');
});

test('diff3 and zdiff3 variable-width blocks expose exact base ranges and labels', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'astragit-conflict-model-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = ['current', 'base', 'incoming'].map(name => join(directory, name));
  await Promise.all([
    writeFile(paths[0], 'before\ncommon\ncurrent\ncommon suffix\nafter\n'),
    writeFile(paths[1], 'before\ncommon\nbase\ncommon suffix\nafter\n'),
    writeFile(paths[2], 'before\ncommon\nincoming\ncommon suffix\nafter\n'),
  ]);
  for (const style of ['diff3', 'zdiff3']) {
    const result = spawnSync('git', ['merge-file', '-p', `--${style}`, '--marker-size=11', '-L', 'ours label', '-L', 'ancestor label', '-L', 'theirs label', ...paths], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const block = onlyBlock(result.stdout, { markerSize: 11 });
    assert.equal(block.markerSize, 11);
    assert.equal(block.currentLabel, 'ours label');
    assert.equal(block.baseLabel, 'ancestor label');
    assert.equal(block.incomingLabel, 'theirs label');
    assert.match(block.current, /current\n/u);
    assert.match(block.base, /base\n/u);
    assert.match(block.incoming, /incoming\n/u);
    assert.equal(block.base, result.stdout.slice(block.baseStart, block.baseEnd));
    assert.equal(acceptConflictBlock(result.stdout, block, 'current'), await readFile(paths[0], 'utf8'));
    assert.equal(acceptConflictBlock(result.stdout, block, 'incoming'), await readFile(paths[2], 'utf8'));
  }
});

test('configured short marker widths work and wider Git markers do not consume narrower literal source markers', () => {
  const short = conflict('current\n', 'incoming\n', { size: 3 });
  const shortBlock = onlyBlock(short, { markerSize: 3 });
  assert.equal(acceptConflictBlock(short, shortBlock, 'current'), 'current\n');
  assert.equal(hasUnresolvedGitConflictMarkers(short, 3), true);
  const literal = conflict('literal left\n', 'literal right\n');
  const wide = conflict(`source before\n${literal}source after\n`, 'incoming\n', { size: 13 });
  const content = `${literal}// actual wide conflict follows\n${wide}`;
  const block = onlyBlock(content, { markerSize: 13 });
  assert.equal(block.current, `source before\n${literal}source after\n`);
  const resolved = acceptConflictBlock(content, block, 'current');
  assert.equal(resolved, `${literal}// actual wide conflict follows\nsource before\n${literal}source after\n`);
  assert.equal(hasUnresolvedGitConflictMarkers(resolved, 13), false, 'Narrower source markers are not the configured Git marker grammar.');
});

test('inline strings, indented text, operators and decorative separators are ordinary source', () => {
  const source = [
    'const marker = "<<<<<<< HEAD";',
    '  <<<<<<< an indented example',
    '=======',
    '======================',
    '// >>>>>>> incoming',
    'const shifted = left << right;',
    '<div data-value="||||||| base">text</div>',
    '',
  ].join('\n');
  const parsed = parseConflictBlocks(source);
  assert.deepEqual(parsed.blocks, []);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.hasMarkers, false);
  assert.equal(parsed.canComplete, true);
  assert.equal(hasUnresolvedGitConflictMarkers(source, 7), false);
});

test('malformed, nested, mismatched or orphan markers never create an accept-ready block', () => {
  const samples = [
    ['<<<<<<< HEAD\ncurrent\n=======\nincoming\n', 'missing_end'],
    ['<<<<<<< HEAD\ncurrent\n>>>>>>> incoming\n', 'missing_separator'],
    ['<<<<<<< HEAD\ncurrent\n========\nincoming\n>>>>>>>> incoming\n', 'missing_end'],
    ['<<<<<<<HEAD\ncurrent\n=======\nincoming\n>>>>>>> incoming\n', 'invalid_marker'],
    ['<<<<<<< HEAD\ncurrent\n======= unexpected label\nincoming\n>>>>>>> incoming\n', 'invalid_marker'],
    ['<<<<<<< HEAD\ncurrent\n=======\nincoming\n=======\n>>>>>>> incoming\n', 'unexpected_marker'],
    ['<<<<<<< HEAD\nouter\n<<<<<<< nested\ninner\n=======\nother\n>>>>>>> nested\n>>>>>>> outer\n', 'nested_start'],
    ['||||||| base\noriginal\n', 'unexpected_marker'],
    ['>>>>>>> incoming\n', 'unexpected_marker'],
  ];
  for (const [content, reason] of samples) {
    const original = content;
    const parsed = parseConflictBlocks(content);
    assert.equal(parsed.blocks.length, 0, content);
    assert.equal(parsed.canComplete, false, content);
    assert.equal(parsed.hasMarkers, true, content);
    assert.ok(parsed.issues.some(issue => issue.reason === reason), content);
    assert.equal(hasUnresolvedGitConflictMarkers(content, 7), true, content);
    assert.equal(content, original);
  }
});

test('manual edits require fresh offsets, and tampered side data cannot replace source outside the parsed block', () => {
  const content = `prefix\n${conflict('old current\n', 'incoming\n')}suffix\n`;
  const block = onlyBlock(content);
  assert.throws(() => acceptConflictBlock('new prefix\n' + content, block, 'current'), error => error.code === 'ASTRAGIT_GIT_CONFLICT_BLOCK_STALE');
  const changed = content.replace('old current', 'new current');
  assert.throws(() => acceptConflictBlock(changed, block, 'current'), error => error.code === 'ASTRAGIT_GIT_CONFLICT_BLOCK_STALE');
  assert.equal(acceptConflictBlock(changed, onlyBlock(changed), 'current'), 'prefix\nnew current\nsuffix\n');
  assert.equal(acceptConflictBlock(content, { ...block, current: 'injected replacement' }, 'current'), 'prefix\nold current\nsuffix\n');
  assert.throws(() => acceptConflictBlock(content, block, 'unknown'), error => error.code === 'ASTRAGIT_GIT_CONFLICT_CHOICE_INVALID');
});

test('duplicate conflict text gets distinct identities and resolving one never resolves the other implicitly', () => {
  const same = conflict('current\n', 'incoming\n');
  const content = same + same;
  const [first, second] = parseConflictBlocks(content).blocks;
  assert.notEqual(first.id, second.id);
  const next = acceptConflictBlock(content, second, 'incoming');
  assert.equal(next, same + 'incoming\n');
  const remaining = parseConflictBlocks(next);
  assert.equal(remaining.blocks.length, 1);
  assert.equal(remaining.blocks[0].id, first.id);
  assert.equal(hasUnresolvedGitConflictMarkers(next, 7), true);
  assert.equal(parseConflictBlocks(acceptConflictBlock(next, remaining.blocks[0], 'both')).canComplete, true);
});


test('configured marker size must be a positive integer instead of silently disabling detection', () => {
  for (const markerSize of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => parseConflictBlocks('plain text', { markerSize }), error => error.code === 'ASTRAGIT_GIT_CONFLICT_MARKER_SIZE_INVALID');
  }
});
