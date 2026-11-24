import { useCallback, useEffect, useState } from 'react';
import type { ProjectGitRepositorySnapshot } from '../apiClient.js';
import { readSourceGitState, type SourceBatchResult, type SourceCommitUnit } from './sourceGitState.js';
import { gitFileStagePaths } from './gitFileStages.js';

export const batchSummaryId = 'batch-summary';
export interface CommitDraft { message: string; scope?: string }
type Drafts = Record<string, CommitDraft>;
const memoryDrafts = new Map<string, Drafts>();

function stagedScope(branch: string, head: string, index: string | string[], gitlinks: SourceCommitUnit['gitlinks'] = []) {
  const parts = [branch, head, index];
  if (gitlinks.length) parts.push(gitlinks.map(link => link.path).sort());
  return JSON.stringify(parts);
}

export function repositoryDraftScope(snapshot: ProjectGitRepositorySnapshot, gitlinks: SourceCommitUnit['gitlinks'] = []) {
  const index = snapshot.indexFingerprint ?? gitFileStagePaths(snapshot.fileStatuses, snapshot.conflictFiles).staged.sort();
  return stagedScope(snapshot.branch, snapshot.headSha, index, gitlinks);
}

function batchScopeEntry(repositoryId: string, scope: string, gitlinks: SourceCommitUnit['gitlinks']) {
  return [repositoryId, scope, gitlinks.map(link => link.path)];
}

export function batchDraftScope(units: SourceCommitUnit[]) {
  return JSON.stringify(units.map(unit => batchScopeEntry(unit.repository.id, repositoryDraftScope(unit.repository.snapshot), unit.gitlinks)));
}

function stored(key: string): Record<string, unknown> {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* Memory remains available when storage is disabled. */ }
  return {};
}

function summaryWasCommitted(summary: CommitDraft, results: SourceBatchResult[]) {
  if (!results.length || !results.every(row => row.commitSha)) return false;
  if (!summary.scope) return results.every(row => row.message === summary.message);
  const scope = [];
  for (const row of results) {
    if (typeof row.expectedIndex !== 'string' || !Array.isArray(row.gitlinks)) return false;
    scope.push(batchScopeEntry(row.repositoryId, stagedScope(row.branch, row.expectedHead, row.expectedIndex), row.gitlinks));
  }
  return summary.scope === JSON.stringify(scope);
}

export function loadCommitDrafts(projectId: string): Drafts {
  const saved = stored(`astragit.git.commit-drafts.v2:${projectId}`);
  const results = readSourceGitState(projectId).lastResults;
  if (saved.drafts && typeof saved.drafts === 'object') {
    const drafts: Drafts = Object.fromEntries(Object.entries(saved.drafts).filter(([, draft]) => draft && typeof draft.message === 'string'));
    for (const row of results) {
      const draft = drafts[row.repositoryId];
      if (!row.commitSha || !draft || draft.message !== row.message) continue;
      if (!draft.scope || (row.expectedIndex && draft.scope === stagedScope(row.branch, row.expectedHead, row.expectedIndex, row.gitlinks))) delete drafts[row.repositoryId];
    }
    const summary = drafts[batchSummaryId];
    if (summary && summaryWasCommitted(summary, results)) delete drafts[batchSummaryId];
    return drafts;
  }
  const source = stored(`astragit.source-git.v1:${projectId}`);
  const oldDrafts = stored(`astragit.git.commit-drafts.v1:${projectId}`);
  const committedMessages = new Map(results.filter(row => row.commitSha).map(row => [row.repositoryId, row.message]));
  const drafts: Drafts = {};
  for (const [id, value] of Object.entries(oldDrafts)) {
    if (typeof value === 'string' && value && committedMessages.get(id) !== value) drafts[id] = { message: value };
  }
  if (source.drafts && typeof source.drafts === 'object') {
    for (const [id, value] of Object.entries(source.drafts)) {
      if (typeof value !== 'string' || !value) continue;
      if (committedMessages.get(id) === value) continue;
      const other = drafts[id]?.message;
      drafts[id] = { message: other && other !== value ? `${other}\n\n${value}` : value };
    }
  }
  if (typeof source.sharedMessage === 'string' && source.sharedMessage && !summaryWasCommitted({ message: source.sharedMessage }, results)) {
    drafts[batchSummaryId] = { message: source.sharedMessage };
  }
  return drafts;
}

export function useGitCommitDrafts(projectId: string) {
  const [drafts, setDrafts] = useState<Drafts>(() => memoryDrafts.get(projectId) ?? loadCommitDrafts(projectId));
  const [generationFeedback, setGenerationFeedback] = useState<Record<string, string>>({});
  useEffect(() => {
    memoryDrafts.set(projectId, drafts);
    try { localStorage.setItem(`astragit.git.commit-drafts.v2:${projectId}`, JSON.stringify({ drafts })); }
    catch { /* Keep the in-memory copy across view switches. */ }
  }, [projectId, drafts]);

  const write = useCallback((id: string, message: string, scope?: string, expected?: string) => {
    setDrafts(current => {
      if (expected !== undefined && (current[id]?.message ?? '') !== expected) return current;
      const next = { ...current };
      if (message) next[id] = { message, scope };
      else delete next[id];
      return next;
    });
  }, []);
  const clearCommitted = (id: string, expected: string) => {
    write(id, '', undefined, expected);
    setGenerationFeedback(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  return { drafts, write, clearCommitted, generationFeedback, setGenerationFeedback };
}
export type GitCommitDrafts = ReturnType<typeof useGitCommitDrafts>;

/** Track the reviewed repositories through local commits, independently of the later push. */
export function clearDraftsOnBatchCommit(units: SourceCommitUnit[], rows: Pick<SourceBatchResult, 'repositoryId' | 'message'>[], messages: Pick<GitCommitDrafts, 'drafts' | 'write' | 'clearCommitted'>) {
  const summary = messages.drafts[batchSummaryId];
  const matchesSummary = summary && (summary.scope === batchDraftScope(units) || rows.every(row => row.message === summary.message));
  const pending = new Set(rows.map(row => row.repositoryId));
  return (row: Pick<SourceBatchResult, 'repositoryId' | 'message'>) => {
    messages.clearCommitted(row.repositoryId, row.message);
    pending.delete(row.repositoryId);
    if (!matchesSummary) return;
    if (pending.size === 0) messages.clearCommitted(batchSummaryId, summary.message);
    else {
      const remainingUnits = units.filter(unit => pending.has(unit.repository.id));
      messages.write(batchSummaryId, summary.message, batchDraftScope(remainingUnits), summary.message);
    }
  };
}
