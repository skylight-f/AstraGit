import assert from 'node:assert/strict';
import test from 'node:test';
import { readSourceGitState } from '../apps/desktop/src/renderer/git/sourceGitState.ts';

test('interrupted pushes retain committed SHAs and can resume without repeating commits', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  const row = { repositoryId: 'repo', repositoryName: 'repo', branch: 'main', paths: ['file.txt'], mode: 'worktree', expectedHead: 'before', commitSha: 'after', message: 'feat: selected', remote: 'origin', targetBranch: 'main', dependsOn: [], pushRequested: true };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify({ lastResults: [
    { ...row, repositoryId: 'pushing', status: 'pushing' },
    { ...row, repositoryId: 'waiting', status: 'committed' },
    { ...row, repositoryId: 'commit-only', status: 'committed', pushRequested: false },
    { ...row, repositoryId: 'writing', status: 'committing', commitSha: undefined },
  ] }) } });
  const results = readSourceGitState('recovery-fixture').lastResults;
  assert.equal(results[0].status, 'push_blocked'); assert.equal(results[0].commitSha, 'after');
  assert.equal(results[1].status, 'push_blocked'); assert.equal(results[1].commitSha, 'after');
  assert.equal(results[2].status, 'committed'); assert.equal(results[3].status, 'unknown');
});
