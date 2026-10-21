import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneGitFileSelection, selectGitFilePaths } from '../apps/desktop/src/renderer/git/gitFileSelection.ts';

const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
const select = input => selectGitFilePaths({ orderedPaths: files, selectedPaths: [], anchor: null, clickedPath: 'c.ts', ...input });

test('an ordinary row click replaces the current selection and sets a new range anchor', () => {
  assert.deepEqual(select({ selectedPaths: ['a.ts', 'b.ts'], anchor: 'a.ts' }), { selectedPaths: ['c.ts'], anchor: 'c.ts' });
});

test('Cmd or Ctrl toggles one row and returns selected rows in display order', () => {
  const added = select({ selectedPaths: ['e.ts', 'a.ts'], anchor: 'e.ts', additive: true });
  assert.deepEqual(added, { selectedPaths: ['a.ts', 'c.ts', 'e.ts'], anchor: 'c.ts' });
  assert.deepEqual(select({ ...added, additive: true }), { selectedPaths: ['a.ts', 'e.ts'], anchor: 'c.ts' });
});

test('Shift selects inclusive forward and backward ranges while retaining the first anchor', () => {
  const forward = select({ anchor: 'a.ts', selectedPaths: ['a.ts'] , range: true });
  assert.deepEqual(forward, { selectedPaths: ['a.ts', 'b.ts', 'c.ts'], anchor: 'a.ts' });
  assert.deepEqual(select({ ...forward, clickedPath: 'b.ts', range: true }), { selectedPaths: ['a.ts', 'b.ts'], anchor: 'a.ts' });
  assert.deepEqual(select({ anchor: 'e.ts', range: true }), { selectedPaths: ['c.ts', 'd.ts', 'e.ts'], anchor: 'e.ts' });
});

test('Cmd or Ctrl plus Shift appends a range without losing other visible selected rows', () => {
  assert.deepEqual(select({ selectedPaths: ['e.ts', 'a.ts'], anchor: 'b.ts', range: true, additive: true }), { selectedPaths: ['a.ts', 'b.ts', 'c.ts', 'e.ts'], anchor: 'b.ts' });
});

test('a stale or missing anchor falls back to the clicked row instead of another file', () => {
  assert.deepEqual(select({ selectedPaths: ['a.ts'], anchor: 'removed.ts', range: true }), { selectedPaths: ['c.ts'], anchor: 'c.ts' });
  assert.deepEqual(select({ selectedPaths: ['a.ts'], range: true, additive: true }), { selectedPaths: ['a.ts', 'c.ts'], anchor: 'c.ts' });
});

test('ranges and bulk selection stay within visible rows after filtering', () => {
  assert.deepEqual(select({ orderedPaths: ['a.ts', 'c.ts', 'e.ts'], selectedPaths: ['a.ts', 'b.ts', 'd.ts'], anchor: 'a.ts', clickedPath: 'e.ts', range: true }), { selectedPaths: ['a.ts', 'c.ts', 'e.ts'], anchor: 'a.ts' });
  assert.deepEqual(select({ orderedPaths: ['a.ts', 'c.ts'], selectedPaths: ['b.ts'], anchor: 'b.ts', range: true, additive: true }), { selectedPaths: ['c.ts'], anchor: 'c.ts' });
});

test('a click queued before its file disappears cannot inject a stale selection', () => {
  assert.deepEqual(select({ selectedPaths: ['a.ts', 'removed.ts'], anchor: 'removed.ts', clickedPath: 'removed.ts' }), { selectedPaths: ['a.ts'], anchor: null });
  assert.deepEqual(select({ selectedPaths: ['a.ts'], anchor: 'a.ts', clickedPath: 'removed.ts' }), { selectedPaths: ['a.ts'], anchor: 'a.ts' });
});

test('a toggled-off file remains the anchor for the next Shift selection', () => {
  const removed = select({ selectedPaths: ['a.ts', 'c.ts'], additive: true });
  assert.deepEqual(removed, { selectedPaths: ['a.ts'], anchor: 'c.ts' });
  assert.deepEqual(select({ ...removed, clickedPath: 'e.ts', range: true }), { selectedPaths: ['c.ts', 'd.ts', 'e.ts'], anchor: 'c.ts' });
});

test('pruning preserves exact Git paths, removes duplicates, and follows the caller display order', () => {
  assert.deepEqual(pruneGitFileSelection(['A.ts', 'a.ts', 'dir/file name.ts', 'a.ts', 'removed.ts'], ['dir/file name.ts', 'a.ts', 'a.ts', 'A.ts']), ['dir/file name.ts', 'a.ts', 'A.ts']);
});

test('selection helpers leave caller-owned arrays unchanged', () => {
  const orderedPaths = Object.freeze([...files]); const selectedPaths = Object.freeze(['e.ts', 'a.ts']);
  const input = Object.freeze({ orderedPaths, selectedPaths, anchor: 'a.ts', clickedPath: 'd.ts', range: true, additive: true });
  assert.deepEqual(selectGitFilePaths(input), { selectedPaths: files, anchor: 'a.ts' });
  assert.deepEqual(selectedPaths, ['e.ts', 'a.ts']); assert.deepEqual(orderedPaths, files);
  assert.deepEqual(select({ orderedPaths: [], selectedPaths: ['a.ts'], clickedPath: 'a.ts' }), { selectedPaths: [], anchor: null });
});
