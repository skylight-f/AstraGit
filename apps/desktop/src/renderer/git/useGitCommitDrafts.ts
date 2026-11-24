import { useCallback, useEffect, useState } from 'react';
import type { ProjectGitRepositorySnapshot } from '../apiClient.js';
import type { SourceCommitUnit } from './sourceGitState.js';
import { gitFileStagePaths } from './gitFileStages.js';

export const batchSummaryId = 'batch-summary';
export interface CommitDraft { message: string; scope?: string }
type Drafts = Record<string, CommitDraft>;
const memoryDrafts = new Map<string, Drafts>();

export function repositoryDraftScope(snapshot: ProjectGitRepositorySnapshot, gitlinks: SourceCommitUnit['gitlinks'] = []) {
  const index = snapshot.indexFingerprint ?? gitFileStagePaths(snapshot.fileStatuses, snapshot.conflictFiles).staged.sort();
  const parts = [snapshot.branch, snapshot.headSha, index];
  if (gitlinks.length) parts.push(gitlinks.map(link => link.path).sort());
  return JSON.stringify(parts);
}

export function batchDraftScope(units: SourceCommitUnit[]) {
  return JSON.stringify(units.map(unit => [unit.repository.id, repositoryDraftScope(unit.repository.snapshot), unit.gitlinks.map(link => link.path)]));
}

function stored(key: string): Record<string, unknown> {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* Memory remains available when storage is disabled. */ }
  return {};
}

export function loadCommitDrafts(projectId: string): Drafts {
  const saved = stored(`astragit.git.commit-drafts.v2:${projectId}`);
  if (saved.drafts && typeof saved.drafts === 'object') {
    return Object.fromEntries(Object.entries(saved.drafts).filter(([, draft]) => draft && typeof draft.message === 'string'));
  }
  const source = stored(`astragit.source-git.v1:${projectId}`);
  const oldDrafts = stored(`astragit.git.commit-drafts.v1:${projectId}`);
  const drafts: Drafts = {};
  for (const [id, value] of Object.entries(oldDrafts)) {
    if (typeof value === 'string' && value) drafts[id] = { message: value };
  }
  if (source.drafts && typeof source.drafts === 'object') {
    for (const [id, value] of Object.entries(source.drafts)) {
      if (typeof value !== 'string' || !value) continue;
      const other = drafts[id]?.message;
      drafts[id] = { message: other && other !== value ? `${other}\n\n${value}` : value };
    }
  }
  if (typeof source.sharedMessage === 'string' && source.sharedMessage) drafts[batchSummaryId] = { message: source.sharedMessage };
  return drafts;
}

export function useGitCommitDrafts(projectId: string) {
  const [drafts, setDrafts] = useState<Drafts>(() => memoryDrafts.get(projectId) ?? loadCommitDrafts(projectId));
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
  return { drafts, write };
}
export type GitCommitDrafts = ReturnType<typeof useGitCommitDrafts>;
