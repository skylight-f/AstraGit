import type { GitFileStatusSummary } from '../features/git/gitContracts.js';

/** Unmerged index entries belong to the working tree until resolution is staged. */
export function gitFileStagePaths(files: readonly GitFileStatusSummary[], conflictFiles: readonly string[]): { staged: string[]; unstaged: string[] } {
  const conflicts = new Set(conflictFiles);
  const staged: string[] = [];
  const unstaged = new Set<string>();
  for (const file of files) {
    if (conflicts.has(file.path)) {
      unstaged.add(file.path);
      continue;
    }
    if (file.indexStatus !== ' ' && file.indexStatus !== '?') staged.push(file.path);
    if (file.workingTreeStatus !== ' ' || file.indexStatus === '?') unstaged.add(file.path);
  }
  for (const path of conflicts) unstaged.add(path);
  return { staged, unstaged: [...unstaged] };
}
