import { useEffect, useRef, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Folder } from '@phosphor-icons/react/dist/csr/Folder';
import { GitBranch } from '@phosphor-icons/react/dist/csr/GitBranch';
import type { GitFileStatusSummary, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { GitFileStatusIcon, gitFileStatusCategory } from './GitFileStatusIcon.js';

export function SourceCheckbox(props: { checked: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = props.mixed === true; }, [props.mixed]);
  return <input ref={input} type="checkbox" aria-label={props.label} checked={props.checked} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.checked)} />;
}
interface Node { name: string; path: string; children: Map<string, Node>; file?: GitFileStatusSummary }
function tree(files: GitFileStatusSummary[]) {
  const root: Node = { name: '', path: '', children: new Map() };
  for (const file of files) {
    let current = root;
    for (const part of file.path.split('/')) {
      const path = current.path ? `${current.path}/${part}` : part;
      const next = current.children.get(part) ?? { name: part, path, children: new Map() };
      current.children.set(part, next); current = next;
    }
    current.file = file;
  }
  return root;
}
interface Props {
  repository: ProjectGitRepositoryWorkbenchItem; files: GitFileStatusSummary[]; selected: string[];
  focusedPath?: string; focusedRepository?: string; collapsed: string[]; filter: string; disabled: boolean; zh: boolean;
  onToggle: (paths: string[], checked: boolean) => void; onFocus: (path: string) => void;
  onCollapse: (key: string) => void;
}
export function SourceRepositoryTree(props: Props) {
  const selected = new Set(props.selected);
  const repository = props.repository;
  const prefix = `${repository.id}:`;
  const chosen = props.files.filter(file => selected.has(file.path)).length;
  const filter = props.filter.trim().toLocaleLowerCase();
  const matchesRepository = repository.name.toLocaleLowerCase().includes(filter) || repository.relativePath.toLocaleLowerCase().includes(filter);
  const shown = props.files.filter(file => !filter || matchesRepository || file.path.toLocaleLowerCase().includes(filter));
  if (!shown.length) return null;
  const renderNode = (node: Node): ReactNode => {
    if (node.file) return <div key={node.path} className={`source-git-file${props.focusedRepository === repository.id && props.focusedPath === node.path ? ' is-active' : ''}`}>
      <SourceCheckbox label={props.zh ? `选择 ${repository.name}/${node.path}` : `Select ${repository.name}/${node.path}`} checked={selected.has(node.path)} disabled={props.disabled} onChange={checked => props.onToggle([node.path], checked)} />
      <button type="button" onClick={() => props.onFocus(node.path)} title={node.path}><GitFileStatusIcon category={gitFileStatusCategory(node.file)} zh={props.zh} /><span>{node.name}</span><small>{node.file.indexStatus !== ' ' && node.file.indexStatus !== '?' ? node.file.workingTreeStatus !== ' ' ? props.zh ? '部分暂存' : 'Partial' : props.zh ? '已暂存' : 'Staged' : props.zh ? '工作区' : 'Worktree'}</small></button>
    </div>;
    const paths = props.files.filter(file => file.path.startsWith(`${node.path}/`)).map(file => file.path);
    const count = paths.filter(path => selected.has(path)).length;
    const collapsed = props.collapsed.includes(prefix + node.path);
    return <div key={node.path} className="source-git-directory"><div className="source-git-directory-heading">
      <button type="button" className="source-git-expand" aria-label={`${collapsed ? props.zh ? '展开' : 'Expand' : props.zh ? '收起' : 'Collapse'} ${node.path}`} aria-expanded={!collapsed} onClick={() => props.onCollapse(prefix + node.path)}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
      <SourceCheckbox label={props.zh ? `选择目录 ${repository.name}/${node.path}` : `Select directory ${repository.name}/${node.path}`} checked={count === paths.length} mixed={count > 0 && count < paths.length} disabled={props.disabled} onChange={checked => props.onToggle(paths, checked)} />
      <Folder /><span>{node.name}</span>
    </div>{collapsed ? null : <div className="source-git-directory-children">{[...node.children.values()].map(renderNode)}</div>}</div>;
  };
  const collapsed = props.collapsed.includes(repository.id);
  return <section className="source-git-repository" aria-label={repository.name}>
    <div className={`source-git-repository-heading${props.focusedRepository === repository.id ? ' is-active' : ''}`}>
      <button type="button" className="source-git-expand" aria-label={`${collapsed ? props.zh ? '展开仓库' : 'Expand repository' : props.zh ? '收起仓库' : 'Collapse repository'} ${repository.name}`} aria-expanded={!collapsed} onClick={() => props.onCollapse(repository.id)}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
      <SourceCheckbox label={props.zh ? `选择仓库 ${repository.name}` : `Select repository ${repository.name}`} checked={chosen === props.files.length} mixed={chosen > 0 && chosen < props.files.length} disabled={props.disabled} onChange={checked => props.onToggle(props.files.map(file => file.path), checked)} />
      <button type="button" className="source-git-repository-focus" onClick={() => props.onFocus(shown[0]!.path)}><strong>{repository.name}</strong><small><GitBranch />{repository.snapshot.branch}</small><small>{repository.isSubmodule ? props.zh ? '子模块 · ' : 'Submodule · ' : ''}{repository.relativePath}</small></button>
      <span>{chosen}/{props.files.length}</span>
    </div>{collapsed ? null : <div className="source-git-repository-files">{[...tree(shown).children.values()].map(renderNode)}</div>}
  </section>;
}
