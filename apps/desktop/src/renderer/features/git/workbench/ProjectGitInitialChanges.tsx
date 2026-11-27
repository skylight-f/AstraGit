import type { ProjectGitInitialChanges as InitialChanges } from '@astragit/git-core';
import { Fragment } from 'react';
import { Button } from '../../../ui/Button.js';
import { VisibleApplicationError } from '../../../ui/ApplicationErrorDialog.js';
import { gitFileStagePaths } from '../changes/gitFileStages.js';
import { GitFileStatusIcon, gitFileStatusCategory } from '../components/GitFileStatusIcon.js';
import { GitPaneSeparator } from '../components/GitPaneSeparator.js';

export function ProjectGitInitialChanges(props: {
  changes: InitialChanges | null;
  error: unknown;
  zh: boolean;
  onRetry: () => void;
}) {
  const { changes, error, zh } = props;
  // Git reports unopened embedded repositories as untracked directory entries.
  const files = new Map(changes?.fileStatuses.filter(file => file.indexStatus !== '?' || !file.path.endsWith('/')).map(file => [file.path, file]));
  const conflicts = new Set(changes?.conflictFiles);
  const paths = gitFileStagePaths([...files.values()], changes?.conflictFiles ?? []);
  const count = new Set([...paths.staged, ...paths.unstaged]).size;
  return (
    <div className="project-git-browser-layout project-git-initial-layout" data-view="changes">
      <aside className="project-git-navigator" aria-label={zh ? 'Git 导航' : 'Git navigation'}>
        <section className="git-history-repositories">
          <header className="git-history-pane-heading">{zh ? '仓库' : 'Repositories'}</header>
          {changes ? <p className="project-git-stage-empty" title={changes.repositoryName}>{changes.repositoryName}</p> : null}
        </section>
      </aside>
      <GitPaneSeparator name="navigation" trailingMin={240} label={zh ? '调整 Git 导航宽度' : 'Resize Git navigation'} initial={20} min={12} max={40} />
      <div className="project-git-browser-content">
        <div className="git-content-toolbar">
          <strong>{zh ? '文件状态' : 'File Status'}</strong>
          {error != null ? (
            <div className="project-git-initial-feedback" role="alert">
              <VisibleApplicationError error={error} language={zh ? 'zh-CN' : 'en'} />
              <Button variant="secondary" size="compact" onClick={props.onRetry}>{zh ? '重新读取' : 'Reload'}</Button>
            </div>
          ) : (
            <span className="project-git-initial-feedback" role="status">
              {changes ? (zh ? '正在加载子仓库、差异和历史…' : 'Loading nested repositories, diffs, and history…')
                : zh ? '正在读取仓库变更…' : 'Reading repository changes…'}
            </span>
          )}
        </div>
        <div className="project-git-changes-layout project-git-navigator-layout" data-commit-active={false}>
          <aside className="project-git-change-tree">
            <header><strong>{zh ? '变更文件' : 'Changed files'}</strong>{changes ? <span>{count}</span> : null}</header>
            {changes && count === 0 ? (
              <p className="project-git-stage-empty">{zh ? '根仓库没有本地更改。' : 'No local changes in the root repository.'}</p>
            ) : changes ? (
              <div className="project-git-stage-panels">
                {(['staged', 'unstaged'] as const).map(stage => {
                  const title = stage === 'staged' ? (zh ? '已暂存' : 'Staged') : (zh ? '未暂存' : 'Unstaged');
                  return (
                    <Fragment key={stage}>
                      {stage === 'unstaged' ? <GitPaneSeparator name="stages" label={zh ? '调整已暂存与未暂存区域高度' : 'Resize staged and unstaged panels'} axis="y" initial={50} min={15} max={85} /> : null}
                      <section className="project-git-stage-panel" aria-label={title}>
                        <header><strong>{title}</strong><span>{paths[stage].length}</span></header>
                        <div className="project-git-stage-scroll">
                          {paths[stage].map(path => (
                            <div className="project-git-initial-file" key={path} title={path}>
                              <GitFileStatusIcon category={conflicts.has(path) ? 'conflict' : gitFileStatusCategory(files.get(path), stage)} zh={zh} />
                              <span>{path}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    </Fragment>
                  );
                })}
              </div>
            ) : null}
          </aside>
          <GitPaneSeparator name="files" trailingMin={240} label={zh ? '调整文件列表宽度' : 'Resize file list'} initial={30} min={15} max={65} />
          <div className="project-git-change-diff" />
        </div>
      </div>
    </div>
  );
}
