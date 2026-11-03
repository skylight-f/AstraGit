import assert from 'node:assert/strict';
import test from 'node:test';
import { gitFileStagePaths } from '../apps/desktop/src/renderer/git/gitFileStages.ts';

const file = (path, status, category = 'modified') => ({ path, indexStatus: status[0], workingTreeStatus: status[1], category });

test('all seven unmerged states appear only in unstaged files', () => {
  const files = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].map(status => file(`${status}.txt`, status, 'conflict'));
  const conflicts = files.map(file => file.path);
  assert.deepEqual(gitFileStagePaths(files, conflicts), { staged: [], unstaged: conflicts });
});

test('conflicts count alongside ordinary unstaged changes while partial staging keeps both versions', () => {
  const files = [file('staged.txt', 'M '), file('unstaged.txt', ' M'), file('partial.txt', 'MM'), file('new.txt', '??', 'untracked'), file('conflict.txt', 'UU', 'conflict')];
  assert.deepEqual(gitFileStagePaths(files, ['conflict.txt']), {
    staged: ['staged.txt', 'partial.txt'],
    unstaged: ['unstaged.txt', 'partial.txt', 'new.txt', 'conflict.txt'],
  });
});

test('the conflict list remains visible even when a status entry is missing and never duplicates paths', () => {
  assert.deepEqual(gitFileStagePaths([file('present.txt', 'UU', 'conflict')], ['present.txt', 'missing.txt', 'missing.txt']), {
    staged: [], unstaged: ['present.txt', 'missing.txt'],
  });
});

test('a resolved and staged file moves from unstaged to staged', () => {
  assert.deepEqual(gitFileStagePaths([file('resolved.txt', 'UU', 'conflict')], ['resolved.txt']), { staged: [], unstaged: ['resolved.txt'] });
  assert.deepEqual(gitFileStagePaths([file('resolved.txt', 'M ')], []), { staged: ['resolved.txt'], unstaged: [] });
});
