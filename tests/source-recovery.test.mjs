import assert from 'node:assert/strict';
import test from 'node:test';
import { batchSummaryId, loadCommitDrafts } from '../apps/desktop/src/renderer/git/useGitCommitDrafts.ts';
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

test('draft migration keeps both manually edited texts and isolates the old batch message', t => {
  const values = new Map([
    ['astragit.git.commit-drafts.v1:project', { pim: 'staging edit' }],
    ['astragit.source-git.v1:project', { selected: { pim: ['legacy.txt'] }, drafts: { pim: 'project edit', eiam: 'eiam only' }, sharedMessage: 'batch only' }],
  ]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => JSON.stringify(values.get(key) ?? null) } });
  assert.deepEqual(loadCommitDrafts('project'), {
    pim: { message: 'staging edit\n\nproject edit' }, eiam: { message: 'eiam only' }, [batchSummaryId]: { message: 'batch only' },
  });
  values.set('astragit.git.commit-drafts.v2:project', { drafts: {} });
  assert.deepEqual(loadCommitDrafts('project'), {}, 'cleared drafts stay cleared');
  assert.deepEqual(loadCommitDrafts('another-project'), {});
});
