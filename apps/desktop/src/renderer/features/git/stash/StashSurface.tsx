import type { ExecutionOutcome } from '../workbench/gitWorkbenchTypes.js';
import type { BusyState } from '../workbench/gitWorkbenchTypes.js';
import { GitPaneSeparator } from '../components/GitPaneSeparator.js';
import { ArchiveIcon as Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { CircleNotchIcon as CircleNotch } from '@phosphor-icons/react/dist/csr/CircleNotch';
import type { ProjectGitAction, ProjectGitCommitDetail, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { Button } from '../../../ui/Button.js';
import { SideBySideDiff } from '../diff/ProjectGitDiffViewer.js';
import type { GitDiffOptions } from '../workbench/gitWorkbenchTypes.js';
import { CommitFileDirectoryTree } from '../components/CommitFileDirectoryTree.js';
import { formatRelativeTime } from '../history/gitHistoryTime.js';

export function StashSurface(props: {
  /** 仓库预览所属项目。 */
  projectId: string;
  zh: boolean;
  repository: ProjectGitRepositoryWorkbenchItem | null;
  stash: ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number] | null;
  detail: ProjectGitCommitDetail | null;
  loading: boolean;
  selectedFilePath: string;
  busy: BusyState;
  onSelectFile: (path: string) => void;
  onApplyStash: (repository: ProjectGitRepositoryWorkbenchItem, stash: ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number]) => void;
  onOpenDiff: (repository: ProjectGitRepositoryWorkbenchItem, filePath: string, options?: GitDiffOptions) => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const selectedDiff = props.detail?.diff.fileDiffs.find((file) => file.newPath === props.selectedFilePath || file.oldPath === props.selectedFilePath) ?? null;
  if (!props.repository || !props.stash) {
    return (
      <div className="project-git-empty-surface">
        <Archive aria-hidden="true" />
        <strong>{props.zh ? '没有可查看的贮藏' : 'No stash to inspect'}</strong>
        <span>{props.zh ? '左侧“贮藏区”会显示当前仓库中的贮藏。' : 'Stashes in the current repository appear in the sidebar.'}</span>
      </div>
    );
  }
  const repository = props.repository;
  const stash = props.stash;
  return (
    <section className="project-git-stash-surface" aria-label={props.zh ? '贮藏详情' : 'Stash details'}>
      <header className="project-git-stash-toolbar">
        <span className="project-git-stash-identity">
          <Archive aria-hidden="true" />
          <span>
            <strong>{displayStashSubject(stash.subject, props.zh)}</strong>
            <small>
              {stash.ref} · {stash.author} · {formatRelativeTime(stash.authoredAt, props.zh)}
            </small>
          </span>
        </span>
        <span className="project-git-stash-actions">
          <Button variant="secondary" size="compact" disabled={props.busy !== null} onClick={() => props.onApplyStash(repository, stash)}>
            {props.zh ? '应用' : 'Apply'}
          </Button>
          <Button variant="danger" size="compact" disabled={props.busy !== null} onClick={() => void props.onExecute(repository, { type: 'drop_stash', stashRef: stash.ref }, props.zh ? '删除 Stash' : 'Drop stash')}>
            {props.zh ? '删除' : 'Delete'}
          </Button>
        </span>
      </header>
      {props.loading ? (
        <div className="project-git-inspector-loading">
          <CircleNotch aria-hidden="true" />
          {props.zh ? '正在读取贮藏差异' : 'Loading stash diff'}
        </div>
      ) : props.detail ? (
        <div className="project-git-stash-diff-layout">
          <aside className="project-git-changed-files project-git-stash-files" aria-label={props.zh ? '贮藏中的变更文件' : 'Files changed in stash'}>
            <header>
              <strong>{props.zh ? `变更文件 (${props.detail.files.length})` : `Changed files (${props.detail.files.length})`}</strong>
            </header>
            <CommitFileDirectoryTree zh={props.zh} files={props.detail.files} fileDiffs={props.detail.diff.fileDiffs} selectedPath={props.selectedFilePath} onSelect={props.onSelectFile} onOpen={(path) => props.onOpenDiff(repository, path, { commitHash: stash.ref })} />
          </aside>
          <GitPaneSeparator name="stash-files" trailingMin={240} label={props.zh ? '调整贮藏文件列表宽度' : 'Resize stash file list'} initial={28} min={16} max={55} />
          <SideBySideDiff
            previewRequest={props.selectedFilePath ? { kind: 'project-git', projectId: props.projectId, repositoryId: props.repository.id, path: props.selectedFilePath, commitHash: props.stash.ref } : undefined}
            diff={selectedDiff || props.detail.diff.unavailableReason ? { ...props.detail.diff, files: props.selectedFilePath ? [props.selectedFilePath] : props.detail.diff.files, fileDiffs: selectedDiff ? [selectedDiff] : [] } : null}
            zh={props.zh}
            title={props.selectedFilePath}
          />
        </div>
      ) : (
        <p className="project-git-empty-copy">{props.zh ? '无法读取该贮藏的文件差异。' : 'The files and diff for this stash could not be loaded.'}</p>
      )}
    </section>
  );
}

function displayStashSubject(subject: string, zh: boolean): string {
  const cleaned = subject.replace(/^(?:On\s+[^:]+|WIP\s+on\s+[^:]+):\s*/iu, '').trim();
  return cleaned || (zh ? '未命名 Stash' : 'Untitled stash');
}
