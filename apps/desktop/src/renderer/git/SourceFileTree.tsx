import { useEffect, useRef, type CSSProperties } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Folder } from '@phosphor-icons/react/dist/csr/Folder';
import type { GitFileStatusSummary, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { GitFileStatusIcon, gitFileStatusCategory, gitFileStatusLabel } from './GitFileStatusIcon.js';

export function SourceCheckbox(props: { checked: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = props.mixed === true; }, [props.mixed]);
  return <input ref={input} type="checkbox" aria-label={props.label} checked={props.checked} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.checked)} />;
}
import { repositoryColor } from './repositoryColor.js';

interface Props {
  repository: ProjectGitRepositoryWorkbenchItem; files: GitFileStatusSummary[]; selected: string[];
  focusedPath?: string; focusedRepository?: string; collapsed: string[]; view: 'tree' | 'flat';
  group: string; selectable: boolean; disabled: boolean; zh: boolean;
  onToggle: (paths: string[], checked: boolean) => void; onFocus: (path: string) => void;
  onSelectRepository: () => void; onCollapse: (key: string) => void;
}

/** 沿用 Zeus SourceGitChanges 的分组、仓库单行标题和平铺 / 树形选择。 */
export function SourceRepositoryTree(props: Props) {
  const { repository, files, selected } = props;
  const key = `${props.group}:${repository.id}`;
  const chosen = files.filter(file => selected.includes(file.path)).length;
  const collapsed = props.collapsed.includes(key);
  if (!files.length) return null;
  return <section className="source-git-repository" aria-label={repository.name}>
    <div className={`source-git-repository-heading${props.focusedRepository === repository.id ? ' is-active' : ''}`}>
      <button type="button" className="source-git-icon source-git-expand" aria-label={`${collapsed ? props.zh ? '展开仓库' : 'Expand repository' : props.zh ? '收起仓库' : 'Collapse repository'} ${repository.name}`} aria-expanded={!collapsed} onClick={() => { props.onSelectRepository(); props.onCollapse(key); }}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
      {props.selectable ? <SourceCheckbox label={props.zh ? `选择仓库 ${repository.name}` : `Select repository ${repository.name}`} checked={chosen === files.length} mixed={chosen > 0 && chosen < files.length} disabled={props.disabled} onChange={checked => props.onToggle(files.map(file => file.path), checked)} /> : null}
      <span className="source-git-repository-color" style={{ '--repository-color': repositoryColor(repository.id) } as CSSProperties} />
      <button type="button" className="source-git-repository-focus" onClick={props.onSelectRepository} title={`${repository.name} · ${repository.relativePath} · ${repository.snapshot.branch}`}><strong>{repository.name}</strong><small>{repository.snapshot.branch}</small></button>
    </div>
    {collapsed ? null : <SourceChangeTree {...props} prefix="" collapsePrefix={key} />}
  </section>;
}
function SourceChangeTree(props: Props & { prefix: string; collapsePrefix: string }) {
  const folders = new Map<string, GitFileStatusSummary[]>();
  const files: GitFileStatusSummary[] = [];
  for (const file of props.files) {
    const rest = file.path.slice(props.prefix.length);
    const slash = rest.indexOf('/');
    if (props.view === 'tree' && slash >= 0 && slash < rest.length - 1) {
      const folder = rest.slice(0, slash + 1);
      folders.set(folder, [...(folders.get(folder) ?? []), file]);
    } else files.push(file);
  }
  return <div className="source-git-file-tree" data-view={props.view}>
    {[...folders].sort(([a], [b]) => a.localeCompare(b)).map(([folder, children]) => {
      const path = props.prefix + folder;
      const key = `${props.collapsePrefix}:${path}`;
      const collapsed = props.collapsed.includes(key);
      const paths = children.map(file => file.path);
      const chosen = paths.filter(path => props.selected.includes(path)).length;
      return <div key={folder} className="source-git-directory">
        <div className="source-git-directory-heading">
          <button type="button" className="source-git-icon source-git-expand" aria-label={`${collapsed ? props.zh ? '展开目录' : 'Expand directory' : props.zh ? '收起目录' : 'Collapse directory'} ${path}`} aria-expanded={!collapsed} onClick={() => props.onCollapse(key)}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
          {props.selectable ? <SourceCheckbox label={`${props.zh ? '选择目录' : 'Select directory'} ${props.repository.name}/${path}`} checked={chosen === paths.length} mixed={chosen > 0 && chosen < paths.length} disabled={props.disabled} onChange={checked => props.onToggle(paths, checked)} /> : null}
          <Folder aria-hidden="true" /><span>{folder.slice(0, -1)}</span><small>{paths.length}</small>
        </div>
        {collapsed ? null : <SourceChangeTree {...props} files={children} prefix={path} />}
      </div>;
    })}
    {files.sort((a, b) => a.path.localeCompare(b.path)).map(file => <div key={file.path} className={`source-git-file${props.focusedRepository === props.repository.id && props.focusedPath === file.path ? ' is-active' : ''}`}>
      {props.selectable ? <SourceCheckbox label={`${props.zh ? '选择' : 'Select'} ${props.repository.name}/${file.path}`} checked={props.selected.includes(file.path)} disabled={props.disabled} onChange={checked => props.onToggle([file.path], checked)} /> : null}
      <button type="button" onClick={() => props.onFocus(file.path)} title={`${file.originalPath ? `${file.originalPath} → ` : ''}${file.path} · ${gitFileStatusLabel(gitFileStatusCategory(file), props.zh)}`}>
        {props.repository.snapshot.submodules?.some(module => module.path === file.path) ? <Folder aria-hidden="true" /> : <GitFileStatusIcon category={gitFileStatusCategory(file)} zh={props.zh} />}
        <span className="source-git-file-name">{props.view === 'flat' ? file.path.slice(file.path.lastIndexOf('/') + 1) : file.path.slice(props.prefix.length)}</span>
        {props.view === 'flat' && file.path.includes('/') ? <span className="source-git-file-directory">{file.path.slice(0, file.path.lastIndexOf('/'))}</span> : null}
      </button>
    </div>)}
  </div>;
}
