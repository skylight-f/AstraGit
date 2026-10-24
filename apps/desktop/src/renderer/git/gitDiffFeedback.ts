import type { GitDiffSummary, GitFileDiff } from '../apiClient.js';

/** Prefer the selected target path; a rename source is only a fallback alias. */
export function gitDiffFileVersions(diff: GitDiffSummary | null, preferredStage: NonNullable<GitFileDiff['stage']>) {
  const path = diff?.files[0] || diff?.fileDiffs[0]?.newPath || diff?.fileDiffs[0]?.oldPath || '';
  const targets = diff?.fileDiffs.filter(file => (file.newPath || file.oldPath) === path) ?? [];
  const versions = targets.length ? targets : diff?.fileDiffs.filter(file => file.oldPath === path) ?? [];
  const file = versions.find(file => file.stage === preferredStage) ?? versions.find(file => file.stage === 'unstaged') ?? versions[0] ?? null;
  return { file, versions };
}

/** A failed or bounded read is never described as a clean file/repository. */
export function gitDiffUnavailableMessage(reason: NonNullable<GitDiffSummary['unavailableReason']>, zh: boolean) {
  const messages: Record<typeof reason, [string, string]> = {
    too_large: ['差异超过内置预览的大小或行数限制。文件清单已保留，请选择较小范围，或使用外部工具比较。', 'The diff exceeds the built-in size or line limit. The file list is retained. Narrow the scope or compare with an external tool.'],
    too_many_files: ['未跟踪文件超过整体预览的 200 个文件限制，未返回不完整补丁。请选择需要的文件预览或使用外部工具比较。', 'There are more than 200 untracked files. No incomplete patch was returned. Preview selected files or compare with an external tool.'],
    read_failed: ['无法完整读取差异，不能据此判断文件没有变动。请重新载入；若仍失败，请使用外部工具检查仓库。', 'The diff could not be read completely. This does not mean the files are unchanged. Reload, or inspect the repository with an external tool if it still fails.'],
    timeout: ['读取差异超时。文件清单已保留，请缩小范围后重新载入，或使用外部工具比较。', 'Reading the diff timed out. The file list is retained. Narrow the scope and reload, or compare with an external tool.'],
    encoding: ['差异内容或文件名不是有效 UTF-8，内置预览无法完整显示。请使用支持该编码的外部工具。', 'Diff contents or filenames are not valid UTF-8. Use an external tool supporting that encoding to view the complete diff.'],
    unsupported_files: ['所选范围包含内嵌仓库目录或特殊文件，无法作为普通文件生成整体差异。请打开对应仓库或使用外部工具检查。', 'The scope includes an embedded repository or a special file. Open that repository or inspect it with an external tool.'],
    conflicts: ['所选范围还有未解决的冲突，不能显示为普通文件差异。请在文件状态中选择冲突文件，使用右侧冲突编辑器处理。', 'The scope contains unresolved conflicts. Select a conflicted file in File status to resolve it in the conflict editor.'],
  };
  return (messages[reason] ?? messages.read_failed)[zh ? 0 : 1];
}
