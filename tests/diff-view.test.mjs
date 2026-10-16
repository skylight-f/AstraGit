import assert from 'node:assert/strict';
import test from 'node:test';
import { alignedDiffRows, replacementHighlight } from '../apps/desktop/src/renderer/git/gitDiffRows.ts';

test('aligned replacements retain original content and authoritative line numbers with unequal block lengths', () => {
  const hunk = { lines: [
    { type: 'context', content: '  unchanged', oldLineNumber: 112, newLineNumber: 212 },
    { type: 'deletion', content: '<view enabled="false">', oldLineNumber: 113, newLineNumber: null },
    { type: 'deletion', content: '  removed extra row', oldLineNumber: 114, newLineNumber: null },
    { type: 'addition', content: '<view enabled="true">', oldLineNumber: null, newLineNumber: 213 },
    { type: 'context', content: '', oldLineNumber: 115, newLineNumber: 214 },
    { type: 'addition', content: 'x'.repeat(1000), oldLineNumber: null, newLineNumber: 215 },
    { type: 'metadata', content: '\\ No newline at end of file', oldLineNumber: null, newLineNumber: null },
  ] };
  const before = JSON.stringify(hunk);
  const rows = alignedDiffRows(hunk);
  for (const side of ['left', 'right']) {
    const number = side === 'left' ? 'oldLineNumber' : 'newLineNumber';
    assert.deepEqual(rows.map(row => row[side]).filter(cell => cell.number !== null).map(cell => [cell.number, cell.content]), hunk.lines.filter(line => line[number] !== null).map(line => [line[number], line.content]));
  }
  assert.equal(rows[1].left.number, 113);
  assert.equal(rows[1].right.number, 213, 'replacement lines share one display row');
  assert.equal(rows[2].right.kind, 'empty');
  assert.equal(rows[2].right.number, null, 'alignment placeholders are not source lines');
  assert.equal(rows[3].right.kind, 'context', 'a source blank line remains context');
  assert.equal(rows[4].right.content.length, 1000, 'long lines must remain complete');
  assert.equal(rows.at(-1).left.kind, 'metadata');
  assert.equal(JSON.stringify(hunk), before, 'view conversion does not mutate the patch used for staging');
});

test('inline highlights preserve Unicode, whitespace and literal source text', () => {
  for (const [original, modified] of [
    ['  const label = "😀旧值";\t', '  const label = "😁新值";\t'],
    ['<view hidden="true">', '<view hidden="false">'],
    ['', 'inserted'],
    ['deleted', ''],
    ['same', 'same'],
    ['abc', 'abXYZc'],
  ]) {
    const change = replacementHighlight(original, modified);
    assert.equal(change.left.before + change.left.changed + change.left.after, original);
    assert.equal(change.right.before + change.right.changed + change.right.after, modified);
    for (const part of [...Object.values(change.left), ...Object.values(change.right)]) assert.equal(part.isWellFormed(), true);
  }
  const change = replacementHighlight('const count = 1;', 'const count = 2;');
  assert.equal(change.left.changed, '1');
  assert.equal(change.right.changed, '2');
});
