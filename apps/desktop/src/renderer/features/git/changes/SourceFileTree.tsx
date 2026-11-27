import type { CSSProperties } from 'react';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Folder } from '@phosphor-icons/react/dist/csr/Folder';
import type { GitFileStatusSummary, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import { GitFileStatusIcon, gitFileStatusCategory, gitFileStatusLabel } from '../components/GitFileStatusIcon.js';
import { fileStagingState, stagingCheckboxState } from './gitFileStages.js';
import { repositoryColor } from '../repository/repositoryColor.js';

export function SourceCheckbox(props: { checked: boolean; mixed?: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <input type="checkbox" aria-checked={props.mixed ? 'mixed' : props.checked} aria-label={props.label} title={props.label}
    ref={input => { if (input) input.indeterminate = Boolean(props.mixed); }}
    checked={props.checked} disabled={props.disabled} onChange={event => {
      const next = event.currentTarget.checked;
      event.currentTarget.indeterminate = Boolean(props.mixed);
      props.onChange(next);
    }} />;
}

export function SourceRepositoryLabel({ repository, detail }: {
  repository: Pick<ProjectGitRepositoryWorkbenchItem, 'id' | 'name'>;
  detail: string | number;
}) {
  return <span className="source-git-repository-label">
    <span className="source-git-repository-color" aria-hidden="true" style={{ '--repository-color': repositoryColor(repository.id) } as CSSProperties} />
    <strong>{repository.name}</strong><small>{detail}</small>
  </span>;
}

interface Props {
  repository: ProjectGitRepositoryWorkbenchItem; files: GitFileStatusSummary[];
  focusedPath?: string; collapsed: string[]; view: 'tree' | 'flat';
  disabled: boolean; zh: boolean;
  onToggle: (paths: string[], checked: boolean) => void; onFocus: (path: string) => void;
  onSelectRepository: () => void; onCollapse: (key: string) => void;
}

/** 沿用 Zeus SourceGitChanges 的分组、仓库单行标题和平铺 / 树形选择。 */
export function SourceRepositoryTree(props: Props) {
  const { repository, files } = props;
  const key = `changes:${repository.id}`;
  const conflictPaths = new Set(repository.snapshot.conflictFiles);
  const selectable = files.filter(file => !conflictPaths.has(file.path));
  const collapsed = props.collapsed.includes(key);
  if (!files.length) return null;
  return <section className="source-git-repository" aria-label={repository.name}>
    <div className="source-git-repository-heading">
      <button type="button" className="source-git-icon source-git-expand" aria-label={`${collapsed ? props.zh ? '展开仓库' : 'Expand repository' : props.zh ? '收起仓库' : 'Collapse repository'} ${repository.name}`} aria-expanded={!collapsed} onClick={() => { props.onSelectRepository(); props.onCollapse(key); }}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
      <GroupStageCheckbox files={selectable} name={repository.name} zh={props.zh} disabled={props.disabled} onToggle={props.onToggle} />
      <button type="button" className="source-git-repository-focus" onClick={props.onSelectRepository} title={`${repository.name} · ${repository.relativePath} · ${repository.snapshot.branch}`}>
        <SourceRepositoryLabel repository={repository} detail={repository.snapshot.branch} />
      </button>
    </div>
    {collapsed ? null : <SourceChangeTree {...props} conflictPaths={conflictPaths} prefix="" collapsePrefix={key} />}
  </section>;
}
function GroupStageCheckbox({ files, name, zh, disabled, onToggle }: Pick<Props, 'files' | 'disabled' | 'zh' | 'onToggle'> & { name: string }) {
  if (!files.length) return null;
  const state = stagingCheckboxState(files);
  const label = state.checked ? (zh ? '取消暂存' : 'Unstage') : (zh ? '暂存全部显示文件' : 'Stage all displayed files');
  return <SourceCheckbox {...state} label={`${label} ${name}`} disabled={disabled} onChange={checked => {
    const targets = files.filter(file => fileStagingState(file) !== (checked ? 'staged' : 'unstaged'));
    onToggle(targets.map(file => file.path), checked);
  }} />;
}

function SourceChangeTree(props: Props & { conflictPaths: ReadonlySet<string>; prefix: string; collapsePrefix: string }) {
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
      return <div key={folder} className="source-git-directory">
        <div className="source-git-directory-heading">
          <button type="button" className="source-git-icon source-git-expand" aria-label={`${collapsed ? props.zh ? '展开目录' : 'Expand directory' : props.zh ? '收起目录' : 'Collapse directory'} ${path}`} aria-expanded={!collapsed} onClick={() => props.onCollapse(key)}>{collapsed ? <CaretRight /> : <CaretDown />}</button>
          <GroupStageCheckbox files={children.filter(file => !props.conflictPaths.has(file.path))} name={`${props.repository.name}/${path}`} zh={props.zh} disabled={props.disabled} onToggle={props.onToggle} />
          <Folder aria-hidden="true" /><span>{folder.slice(0, -1)}</span><small>{children.length}</small>
        </div>
        {collapsed ? null : <SourceChangeTree {...props} files={children} prefix={path} />}
      </div>;
    })}
    {files.sort((a, b) => a.path.localeCompare(b.path)).map(file => {
      const conflicted = props.conflictPaths.has(file.path);
      const staging = fileStagingState(file);
      const action = staging === 'staged' ? (props.zh ? '取消暂存' : 'Unstage') : staging === 'partial' ? (props.zh ? '暂存剩余改动' : 'Stage remaining changes') : (props.zh ? '暂存' : 'Stage');
      const category = conflicted ? 'conflict' : gitFileStatusCategory(file);
      const submodule = props.repository.snapshot.submodules?.some(module => module.path === file.path);
      return <div key={file.path} className={`source-git-file${props.focusedPath === file.path ? ' is-active' : ''}`}>
        {!conflicted ? <SourceCheckbox label={`${action} ${props.repository.name}/${file.path}`} checked={staging === 'staged'} mixed={staging === 'partial'} disabled={props.disabled} onChange={checked => props.onToggle([file.path], checked)} /> : null}
        <button type="button" data-git-file-select aria-current={props.focusedPath === file.path || undefined}
          onClick={event => { event.currentTarget.focus({ preventScroll: true }); props.onFocus(file.path); }}
          title={`${file.originalPath ? `${file.originalPath} → ` : ''}${file.path} · ${gitFileStatusLabel(category, props.zh)}`}>
          {submodule && !conflicted ? <Folder aria-hidden="true" /> : <GitFileStatusIcon category={category} zh={props.zh} />}
          <span className="source-git-file-name">{props.view === 'flat' ? file.path.slice(file.path.lastIndexOf('/') + 1) : file.path.slice(props.prefix.length)}</span>
          {props.view === 'flat' && file.path.includes('/') ? <span className="source-git-file-directory">{file.path.slice(0, file.path.lastIndexOf('/'))}</span> : null}
        </button>
        {!conflicted && staging === 'partial' && <small className="source-git-partial">{props.zh ? '部分暂存' : 'Partially staged'}</small>}
      </div>;
    })}
  </div>;
}
