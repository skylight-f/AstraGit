import { repositoryColor } from './repositoryColor.js';
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { FolderIcon as Folder } from '@phosphor-icons/react/dist/csr/Folder';
import type { ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';

// 子模块按仓库相对路径组织，目录节点只负责展开，不改变仓库选择。
export function RepositoryNavigationTree(props: { repositories: ProjectGitRepositoryWorkbenchItem[]; zh: boolean; selectedId?: string; onSelect: (id: string) => void }) {
  type Node = { name: string; path: string; children: Map<string, Node>; repository?: ProjectGitRepositoryWorkbenchItem };
  const root: Node = { name: '', path: '', children: new Map() };
  for (const repository of props.repositories) {
    const parts = repository.relativePath === '.' ? [repository.name] : repository.relativePath.split('/').filter(Boolean);
    let node = root;
    for (const name of parts) {
      if (!node.children.has(name)) node.children.set(name, { name, path: `${node.path}/${name}`, children: new Map() });
      node = node.children.get(name)!;
    }
    node.repository = repository;
  }
  const render = (node: Node): React.ReactNode => {
    const repository = node.repository;
    const snapshot = repository?.snapshot;
    const relation = !snapshot
      ? ''
      : snapshot.detached
        ? props.zh
          ? '分离 HEAD'
          : 'Detached HEAD'
        : !snapshot.upstream
          ? props.zh
            ? '未跟踪'
            : 'No upstream'
          : snapshot.ahead || snapshot.behind
            ? [snapshot.ahead ? `↑${snapshot.ahead}` : '', snapshot.behind ? `↓${snapshot.behind}` : ''].filter(Boolean).join(' ')
            : props.zh
              ? '已同步'
              : 'Synced';
    const row =
      repository && snapshot ? (
        <button
          data-git-context={JSON.stringify({ kind: 'repository', repositoryId: repository.id, ref: repository.name })}
          type="button"
          className="project-git-navigation-repository"
          aria-current={props.selectedId === repository.id ? 'true' : undefined}
          onClick={() => props.onSelect(repository.id)}
          title={`${repository.name} · ${repository.relativePath}\n${snapshot.branch} → ${snapshot.upstream ?? (props.zh ? '未设置远程跟踪分支' : 'No upstream')}\n${relation}`}
        >
          <span className="project-git-navigation-repository-color" style={{ backgroundColor: repositoryColor(repository.id) }} aria-hidden="true" />
          <span className="project-git-navigation-repository-label">
            <strong>{node.name}</strong>
            <small title={snapshot.detached ? snapshot.headSha : snapshot.branch}>{snapshot.detached ? snapshot.headSha.slice(0, 7) : snapshot.branch}</small>
          </span>
          <span className="git-tracking-badge" aria-label={relation}>
            {relation}
          </span>
        </button>
      ) : null;
    if (!node.children.size) return <div key={node.path}>{row}</div>;
    return (
      <details key={node.path} className="git-repository-directory" open>
        <summary>
          <CaretRight aria-hidden="true" />
          <Folder aria-hidden="true" />
          <span>{node.name}</span>
        </summary>
        <div className="git-repository-directory-children">
          {row}
          {[...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(render)}
        </div>
      </details>
    );
  };
  return <>{[...root.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(render)}</>;
}
