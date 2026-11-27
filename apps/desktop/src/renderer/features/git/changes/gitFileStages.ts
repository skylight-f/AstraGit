import type { GitFileStatusSummary } from '../api/gitContracts.js';

export function fileStagingState(file: GitFileStatusSummary) {
  if (file.indexStatus === ' ' || file.indexStatus === '?') return 'unstaged';
  return file.workingTreeStatus === ' ' ? 'staged' : 'partial';
}

export function stagingCheckboxState(files: GitFileStatusSummary[]) {
  const checked = files.length > 0 && files.every(file => fileStagingState(file) === 'staged');
  return { checked, mixed: !checked && files.some(file => fileStagingState(file) !== 'unstaged') };
}

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
    if (fileStagingState(file) !== 'unstaged') staged.push(file.path);
    if (file.workingTreeStatus !== ' ' || file.indexStatus === '?') unstaged.add(file.path);
  }
  for (const path of conflicts) unstaged.add(path);
  return { staged, unstaged: [...unstaged] };
}
