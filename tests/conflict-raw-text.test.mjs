import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConflictRawEdits, conflictModelText, conflictRawOffsetAt, conflictRawPositionAt, ConflictRawTextHistory } from '../apps/desktop/src/renderer/git/conflictRawText.ts';

const edit = (startLineNumber, startColumn, endLineNumber, endColumn, text) => ({ range: { startLineNumber, startColumn, endLineNumber, endColumn }, text });
const fullEdit = (previous, text) => {
  const lines = conflictModelText(previous, '\n').split('\n');
  return edit(1, 1, lines.length, lines.at(-1).length + 1, text);
};

test('range edits preserve unrelated CRLF/LF/CR and use UTF-16 columns for multiple changes', () => {
  const original = '\uFEFFtop\r\n🪐planet\nkeep\rfinal\r\n';
  const actual = applyConflictRawEdits(original, [edit(2, 3, 2, 9, 'world'), edit(1, 1, 1, 4, 'TOP')]);
  assert.equal(actual, '\uFEFFTOP\r\n🪐world\nkeep\rfinal\r\n');
  assert.equal(conflictRawOffsetAt(original, { lineNumber: 2, column: 3 }), original.indexOf('planet'));
});

test('cross-line replacement changes only its selected range including selected line endings', () => {
  const original = 'before\r\nleft\nright\r\nafter\n';
  assert.equal(applyConflictRawEdits(original, [edit(2, 3, 3, 3, 'X\nY')]), 'before\r\nleX\nYght\r\nafter\n');
});

test('raw offsets locate regions and reveal positions across mixed EOL without drifting', () => {
  const original = '\uFEFFa\r\nb\nc\r\nd';
  for (const [text, lineNumber] of [['a', 1], ['b', 2], ['c', 3], ['d', 4]]) {
    const offset = original.indexOf(text);
    const position = { lineNumber, column: 1 };
    assert.deepEqual(conflictRawPositionAt(original, offset), position);
    assert.equal(conflictRawOffsetAt(original, position), offset);
  }
  assert.deepEqual(conflictRawPositionAt(original, original.length), { lineNumber: 4, column: 2 });
});

test('undo and redo recover original mixed endings after normalized event text replaces deleted lines', () => {
  const original = 'a\r\nb\nc\r\nd';
  const history = new ConflictRawTextHistory(original, 1);
  const changed = history.apply([edit(1, 2, 4, 1, '\n')], 2, false);
  assert.equal(changed, 'a\nd');
  assert.equal(history.apply([fullEdit(changed, conflictModelText(original, '\n'))], 1, true), original);
  assert.equal(history.apply([fullEdit(original, changed)], 2, true), changed);
});

test('whole-file external choices retain their own EOL layout and native undo restores the previous raw file', () => {
  const original = '\uFEFFone\r\ntwo\nthree\r\n';
  const chosen = 'INCOMING\nsecond\r\n';
  const history = new ConflictRawTextHistory(original, 10);
  history.synchronize(chosen, 20);
  assert.equal(history.apply([fullEdit(chosen, conflictModelText(original, '\n'))], 10, true), original);
  assert.equal(history.apply([fullEdit(original, conflictModelText(chosen, '\n'))], 20, true), chosen);
});

test('EOL-only external updates replace raw state even when the normalized model version is unchanged', () => {
  const original = 'a\r\nb\nc';
  const history = new ConflictRawTextHistory(original, 1);
  const typed = history.apply([edit(3, 2, 3, 2, '!')], 2, false);
  const external = typed.replace(/\r\n|\n/g, '\r\n');
  assert.equal(conflictModelText(typed, '\n'), conflictModelText(external, '\n'));
  history.synchronize(external, 2);
  assert.equal(history.content, external);
  assert.equal(history.apply([edit(3, 2, 3, 3, '')], 1, true), original);
  assert.equal(history.apply([edit(3, 2, 3, 2, '!')], 2, true), external);
});
