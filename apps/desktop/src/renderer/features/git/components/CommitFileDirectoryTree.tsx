import { GitFileStatusIcon, gitFileStatusLabel } from './GitFileStatusIcon.js';
import { DotsThreeIcon as DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { GitContextMenu } from './GitContextMenu.js';
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CaretRightIcon as CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { FolderIcon as Folder } from '@phosphor-icons/react/dist/csr/Folder';
import type { ProjectGitCommitDetail } from '../../../api/apiClient.js';
import { reportApplicationError } from '../../../ui/ApplicationErrorDialog.js';

interface CommitFileTreeNode {
  name: string;
  path: string;
  children: Map<string, CommitFileTreeNode>;
  stats?: ProjectGitCommitDetail['files'][number];
  diff?: ProjectGitCommitDetail['diff']['fileDiffs'][number];
}

export function CommitFileDirectoryTree(props: { zh: boolean; files: ProjectGitCommitDetail['files']; fileDiffs: ProjectGitCommitDetail['diff']['fileDiffs']; selectedPath: string; onSelect: (path: string) => void; onOpen: (path: string) => void; onHistory?: (path: string, view: 'history' | 'blame') => void; onExport?: (path: string) => void; onExternal?: (path: string) => void }) {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; open: (path: string, view: 'history' | 'blame') => void; export?: () => void; external?: () => void } | null>(null);
  const tree = useMemo(() => buildCommitFileTree(props.files, props.fileDiffs), [props.files, props.fileDiffs]);
  return (
    <div className="project-git-commit-file-tree">
      {menu ? <GitContextMenu {...menu} title={menu.path} onClose={() => setMenu(null)} onError={reason => reportApplicationError(reason, { language: props.zh ? 'zh-CN' : 'en' })} items={[...(menu.external ? [{ label: props.zh ? '使用外部工具比较…' : 'Compare with external tool…', run: menu.external }] : []), { label: props.zh ? '文件历史…' : 'File history…', run: () => menu.open(menu.path, 'history') }, { label: props.zh ? '代码归属…' : 'Blame…', run: () => menu.open(menu.path, 'blame') }, ...(menu.export ? [{ label: props.zh ? '导出此文件补丁…' : 'Export file as patch…', run: menu.export }] : [])]} /> : null}
      {Array.from(tree.children.values()).map((node) => (
        <CommitFileTreeEntry key={node.path} node={node} depth={0} {...props} onMenu={(path, event) => { event.preventDefault(); event.stopPropagation(); if (!props.onHistory) return; const box = event.currentTarget.getBoundingClientRect(); setMenu({ path, open: props.onHistory, external: props.onExternal ? () => props.onExternal!(path) : undefined, export: props.onExport ? () => props.onExport!(path) : undefined, x: 'clientX' in event ? event.clientX : box.left, y: 'clientY' in event ? event.clientY : box.bottom }); }} />
      ))}
    </div>
  );
}

function CommitFileTreeEntry(props: Parameters<typeof CommitFileDirectoryTree>[0] & { node: CommitFileTreeNode; depth: number; onMenu: (path: string, event: ReactMouseEvent | ReactKeyboardEvent) => void }) {
  if (!props.node.stats) {
    return (
      <details className="project-git-commit-file-folder" open>
        <summary style={{ paddingLeft: `${props.depth * 12 + 5}px` }}>
          <CaretRight aria-hidden="true" />
          <Folder weight="duotone" aria-hidden="true" />
          <span>{props.node.name}</span>
        </summary>
        {Array.from(props.node.children.values()).map((child) => (
          <CommitFileTreeEntry key={child.path} {...props} node={child} depth={props.depth + 1} />
        ))}
      </details>
    );
  }
  const { stats, diff, name, path } = props.node;
  const category = diff?.changeType ?? 'other';
  const selected = path === props.selectedPath;
  const displayPath = stats.originalPath ? `${stats.originalPath} → ${path}` : path;
  const fileKind = diff?.isSubmodule ? (props.zh ? '子模块' : 'Submodule') : diff?.isBinary ? (props.zh ? '二进制' : 'Binary') : null;
  return (
    <div className="git-commit-file-row" onContextMenu={props.onHistory ? event => props.onMenu(props.node.path, event) : undefined}>
    <button
      type="button"
      onKeyDown={event => { if (props.onHistory && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) props.onMenu(props.node.path, event); }}
      className={selected ? 'is-current' : ''}
      aria-pressed={selected}
      title={`${displayPath} · ${gitFileStatusLabel(category, props.zh)}`}
      style={{ paddingLeft: `${props.depth * 12 + 7}px` }}
      onClick={() => props.onSelect(props.node.path)}
      onDoubleClick={() => props.onOpen(props.node.path)}
    >
      <GitFileStatusIcon category={category} zh={props.zh} />
      <span className="git-commit-file-name">{name}</span>
      <span className="git-commit-file-counts">
        {fileKind && <small className="git-commit-file-kind">{fileKind}</small>}
        {stats.additions > 0 && <span className="is-addition">+{stats.additions}</span>}
        {stats.deletions > 0 && <span className="is-deletion">−{stats.deletions}</span>}
      </span>
    </button>
    {props.onHistory ? <button type="button" className="git-commit-file-menu" aria-label={`${props.zh ? '文件操作' : 'File actions'} · ${props.node.path}`} aria-haspopup="menu" onClick={event => props.onMenu(props.node.path, event)}><DotsThree aria-hidden="true" /></button> : null}
    </div>
  );
}

function buildCommitFileTree(files: ProjectGitCommitDetail['files'], fileDiffs: ProjectGitCommitDetail['diff']['fileDiffs']): CommitFileTreeNode {
  const root: CommitFileTreeNode = { name: '', path: '', children: new Map() };
  const diffByPath = new Map(fileDiffs.map(diff => [diff.changeType === 'deleted' ? diff.oldPath : diff.newPath, diff]));
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    let current = root;
    const parts = file.path.split('/').filter(Boolean);
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const next: CommitFileTreeNode = current.children.get(part) ?? { name: part, path, children: new Map() };
      if (index === parts.length - 1) {
        next.stats = file;
        next.diff = diffByPath.get(file.path);
      }
      current.children.set(part, next);
      current = next;
    });
  }
  return root;
}
