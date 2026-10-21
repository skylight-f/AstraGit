export interface GitFileSelection {
  selectedPaths: string[];
  anchor: string | null;
}

export interface GitFileSelectionInput {
  /** The current stage's visible files, in display order. */
  orderedPaths: readonly string[];
  selectedPaths: readonly string[];
  anchor: string | null;
  clickedPath: string;
  range?: boolean;
  additive?: boolean;
}

/** Remove stale or hidden paths and return the remaining selection in display order. */
export function pruneGitFileSelection(selectedPaths: readonly string[], orderedPaths: readonly string[]): string[] {
  const selected = new Set(selectedPaths);
  return [...new Set(orderedPaths)].filter((path) => selected.has(path));
}

/** Select UI rows only; staging, unstaging and other Git operations remain explicit actions. */
export function selectGitFilePaths(input: GitFileSelectionInput): GitFileSelection {
  const ordered = [...new Set(input.orderedPaths)];
  const selectedPaths = pruneGitFileSelection(input.selectedPaths, ordered);
  const clickedIndex = ordered.indexOf(input.clickedPath);
  const anchorIndex = input.anchor === null ? -1 : ordered.indexOf(input.anchor);

  // A refresh may remove the row before its queued click is handled.
  if (clickedIndex < 0) return { selectedPaths, anchor: anchorIndex < 0 ? null : input.anchor };

  if (input.range) {
    const start = anchorIndex < 0 ? clickedIndex : anchorIndex;
    const rangePaths = ordered.slice(Math.min(start, clickedIndex), Math.max(start, clickedIndex) + 1);
    return {
      selectedPaths: input.additive ? pruneGitFileSelection([...selectedPaths, ...rangePaths], ordered) : rangePaths,
      anchor: anchorIndex < 0 ? input.clickedPath : input.anchor,
    };
  }

  if (input.additive) {
    const toggledPaths = selectedPaths.includes(input.clickedPath) ? selectedPaths.filter((path) => path !== input.clickedPath) : [...selectedPaths, input.clickedPath];
    return { selectedPaths: pruneGitFileSelection(toggledPaths, ordered), anchor: input.clickedPath };
  }

  return { selectedPaths: [input.clickedPath], anchor: input.clickedPath };
}
