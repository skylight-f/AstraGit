import type { GitDiffHunk, GitFileDiff } from '../apiClient.js';

/** Git paths use C quoting; JSON's other control escapes must become octal. */
function quotePath(path: string): string {
  return JSON.stringify(path).replace(/\\u00([0-9a-f]{2})/giu, (_, hex: string) => `\\${parseInt(hex, 16).toString(8).padStart(3, '0')}`);
}
export function buildGitHunkPatch(file: GitFileDiff, hunk: GitDiffHunk): string {
  const oldPath = quotePath(`a/${file.oldPath || file.newPath}`);
  const newPath = quotePath(`b/${file.newPath || file.oldPath}`);
  const lines = hunk.lines.map(line => {
    if (line.type === 'addition') return `+${line.content}`;
    if (line.type === 'deletion') return `-${line.content}`;
    if (line.type === 'context') return ` ${line.content}`;
    return line.content;
  });
  return [`diff --git ${oldPath} ${newPath}`, file.changeType === 'added' ? '--- /dev/null' : `--- ${oldPath}`, file.changeType === 'deleted' ? '+++ /dev/null' : `+++ ${newPath}`, hunk.header, ...lines, ''].join('\n');
}
