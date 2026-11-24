import assert from 'node:assert/strict';
import test from 'node:test';
import { batchDraftScope, batchSummaryId, clearDraftsOnBatchCommit, loadCommitDrafts } from '../apps/desktop/src/renderer/git/useGitCommitDrafts.ts';
import { readSourceGitState } from '../apps/desktop/src/renderer/git/sourceGitState.ts';
import { runSourceBatch } from '../apps/desktop/src/renderer/git/sourceGitBatch.ts';

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
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.has(key) ? JSON.stringify(values.get(key)) : null } });
  assert.deepEqual(loadCommitDrafts('project'), {
    pim: { message: 'staging edit\n\nproject edit' }, eiam: { message: 'eiam only' }, [batchSummaryId]: { message: 'batch only' },
  });
  values.set('astragit.git.commit-drafts.v2:project', { drafts: {} });
  assert.deepEqual(loadCommitDrafts('project'), {}, 'cleared drafts stay cleared');
  assert.deepEqual(loadCommitDrafts('another-project'), {});
});

test('a partial project commit retains pending drafts and clears the summary when the retry commits, even if pushing fails', async () => {
  const units = ['core', 'web'].map(id => ({
    repository: { id, snapshot: { branch: 'main', headSha: 'before', indexFingerprint: id } }, gitlinks: [],
  }));
  const rows = units.map(({ repository }) => ({
    repositoryId: repository.id, message: repository.id, expectedHead: 'before', fingerprint: 'index',
    branch: 'main', remote: 'origin', targetBranch: 'main', dependsOn: [], gitlinks: [], paths: ['file'],
  }));
  const drafts = { core: { message: 'core' }, web: { message: 'web' }, other: { message: 'next' },
    [batchSummaryId]: { message: 'batch summary', scope: batchDraftScope(units) } };
  const messages = {
    drafts,
    clearCommitted(id, expected) { if (drafts[id]?.message === expected) delete drafts[id]; },
    write(id, message, scope, expected) { if (drafts[id]?.message === expected) drafts[id] = { message, scope }; },
  };
  let failWeb = true;
  const summariesAtPush = [];
  const client = {
    async executeProjectGitAction(_project, id, action) {
      if (action.type === 'push') summariesAtPush.push(drafts[batchSummaryId]?.message);
      if (action.type === 'push' || (failWeb && id === 'web')) throw new Error('failed');
      return { result: { outcome: 'completed', headSha: id + '-commit' } };
    },
    async loadProjectGitWorkbench() { return { repositories: units.map(unit => unit.repository) }; },
  };
  const run = (units, rows) => runSourceBatch({ client, projectId: 'project', rows, push: true, stopped: () => false,
    onResults() {}, onActive() {}, onCommitted: clearDraftsOnBatchCommit(units, rows, messages) });
  assert.deepEqual((await run(units, rows)).map(row => row.status), ['push_failed', 'commit_failed']);
  assert.equal(drafts.core, undefined);
  assert.equal(drafts.web.message, 'web');
  assert.equal(drafts[batchSummaryId].message, 'batch summary');
  failWeb = false;
  assert.equal((await run(units.slice(1), rows.slice(1)))[0].status, 'push_failed');
  assert.deepEqual(summariesAtPush, ['batch summary', undefined]);
  assert.deepEqual(drafts, { other: { message: 'next' } });
});

test('reopening a project discards confirmed legacy messages and completed scoped summaries while preserving newer drafts', t => {
  const results = ['core', 'web'].map(repositoryId => ({ repositoryId, message: 'shared', status: 'done',
    commitSha: 'after', branch: 'main', expectedHead: 'before', expectedIndex: 'index', paths: [], dependsOn: [], gitlinks: [] }));
  const source = { sharedMessage: 'shared', drafts: { core: 'shared', web: 'next change' }, lastResults: results };
  const values = new Map([['astragit.source-git.v1:finished', source]]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.has(key) ? JSON.stringify(values.get(key)) : null } });
  assert.deepEqual(loadCommitDrafts('finished'), { web: { message: 'next change' } });
  results[1].commitSha = '';
  assert.equal(loadCommitDrafts('finished')[batchSummaryId].message, 'shared');
  results[1].commitSha = 'after';
  const scope = batchDraftScope(results.map(row => ({ repository: { id: row.repositoryId,
    snapshot: { branch: row.branch, headSha: row.expectedHead, indexFingerprint: row.expectedIndex } }, gitlinks: [] })));
  const summary = { message: 'generated summary', scope };
  const nextDraft = { message: 'shared', scope: JSON.stringify(['main', 'after', 'new-index']) };
  values.set('astragit.git.commit-drafts.v2:finished', { drafts: { core: { message: 'shared' }, web: nextDraft, [batchSummaryId]: summary } });
  assert.deepEqual(loadCommitDrafts('finished'), { web: nextDraft });
  results[1].expectedIndex = 'different index';
  assert.deepEqual(loadCommitDrafts('finished')[batchSummaryId], summary);
});
