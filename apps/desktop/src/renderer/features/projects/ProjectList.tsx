import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { FolderOpen } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { Folders } from '@phosphor-icons/react/dist/csr/Folders';
import { PencilSimple } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { useId, useState, type ReactNode } from 'react';
import type { GitAppProject } from '../../api/apiClient.js';
import { readProjectGroups, updateProjectGroup, writeProjectGroups, type ProjectGroup } from './projectWorkspacePersistence.js';
import { reportApplicationError } from '../../ui/ApplicationErrorDialog.js';
import { Button } from '../../ui/Button.js';
import { FormDialog } from '../../ui/FormDialog.js';

interface ProjectListActions {
  zh: boolean;
  onOpen(project: GitAppProject): void;
  onRemove(project: GitAppProject): void;
}

function ProjectSection({ name, projects, zh, onOpen, onRemove, onEdit }: ProjectListActions & {
  name?: string;
  projects: GitAppProject[];
  onEdit?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const listId = useId();
  return <section className="gitapp-projects" aria-label={name ?? (zh ? '项目列表' : 'Project list')}>
    {name && <header className="gitapp-group-heading">
      <button className="gitapp-group-toggle" type="button" aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed(value => !value)}>
        <CaretRight size={14} aria-hidden="true" /><strong>{name}</strong><span>{projects.length}</span>
      </button>
      {onEdit && <button type="button" className="gitapp-project-icon-button" aria-label={zh ? `编辑分组 ${name}` : `Edit group ${name}`} title={zh ? '编辑分组' : 'Edit group'} onClick={onEdit}><PencilSimple size={15} aria-hidden="true" /></button>}
    </header>}
    <ul id={listId} hidden={Boolean(name) && collapsed}>
      {projects.map(project => <li key={project.id}>
        <button type="button" className="gitapp-project-row" onClick={() => onOpen(project)}>
          <span className="gitapp-project-row-icon" aria-hidden="true"><FolderOpen size={16} /></span>
          <span className="gitapp-project-row-details">
            <strong title={project.name}>{project.name}</strong>
            <span title={project.localPath}>{project.localPath}</span>
          </span>
          <CaretRight size={14} aria-hidden="true" />
        </button>
        <button type="button" className="gitapp-project-icon-button gitapp-remove" onClick={() => onRemove(project)} aria-label={zh ? `从列表移除 ${project.name}` : `Remove ${project.name} from list`} title={zh ? '从列表移除' : 'Remove from list'}>
          <X size={15} aria-hidden="true" />
        </button>
      </li>)}
    </ul>
  </section>;
}

export function ProjectList({ projects, zh, actions, children, onOpen, onRemove }: ProjectListActions & {
  projects: GitAppProject[] | null;
  actions: ReactNode;
  children?: ReactNode;
}) {
  const [groups, setGroups] = useState(readProjectGroups);
  const [draft, setDraft] = useState<ProjectGroup | null>(null);
  const groupByProject = new Map<string, ProjectGroup>();
  for (const group of groups) {
    for (const id of group.projectIds) groupByProject.set(id, group);
  }
  const members = new Map(groups.map(group => [group.id, [] as GitAppProject[]]));
  const ungrouped: GitAppProject[] = [];
  for (const project of projects ?? []) {
    const group = groupByProject.get(project.id);
    (group ? members.get(group.id)! : ungrouped).push(project);
  }
  const existing = groups.find(group => group.id === draft?.id);
  const name = draft?.name.trim() ?? '';
  const duplicate = groups.some(group => group.id !== draft?.id && group.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const text = (cn: string, en: string) => zh ? cn : en;

  function save(next: ProjectGroup[]) {
    try {
      writeProjectGroups(next);
      setGroups(next);
      setDraft(null);
    } catch (error) {
      reportApplicationError(error, { language: zh ? 'zh-CN' : 'en' });
    }
  }

  return <div className="gitapp-shell gitapp-list-page macos-ai-app theme-light">
    <div className="gitapp-project-page-content">
      <header className="gitapp-project-toolbar">
        <h1>{text('项目', 'Projects')}</h1>
        <div className="gitapp-project-actions">
          <Button size="compact" onClick={() => setDraft({ id: crypto.randomUUID(), name: '', projectIds: [] })}>
            <Folders size={15} aria-hidden="true" />{text('新建分组', 'New group')}
          </Button>
          {actions}
        </div>
      </header>
      <div className="gitapp-project-scroll">
        {children}
        {projects === null || (!projects.length && !groups.length) ? <p className="gitapp-projects gitapp-project-list-status" role="status">
          {projects === null ? text('正在加载项目…', 'Loading projects…') : text('还没有项目', 'No projects yet')}
        </p> : <>
          {groups.map(group => <ProjectSection key={group.id} name={group.name} projects={members.get(group.id)!} zh={zh} onOpen={onOpen} onRemove={onRemove} onEdit={() => setDraft(group)} />)}
          {ungrouped.length > 0 && <ProjectSection name={groups.length ? text('未分组', 'Ungrouped') : undefined} projects={ungrouped} zh={zh} onOpen={onOpen} onRemove={onRemove} />}
        </>}
      </div>
    </div>
    {draft && <FormDialog
      className="gitapp-group-editor"
      title={existing ? text('编辑分组', 'Edit group') : text('新建分组', 'New group')}
      zh={zh} busy={false} submitDisabled={!name || duplicate}
      submitLabel={existing ? text('保存', 'Save') : text('创建', 'Create')}
      onClose={() => setDraft(null)}
      onSubmit={event => {
        event.preventDefault();
        if (name && !duplicate) save(updateProjectGroup(groups, { ...draft, name }));
      }}
    >
      <label>{text('分组名称', 'Group name')}
        <input autoFocus value={draft.name} required onChange={event => setDraft({ ...draft, name: event.target.value })} />
      </label>
      {duplicate && <span role="alert">{text('已有同名分组', 'A group with this name already exists')}</span>}
      {projects && projects.length > 0 && <fieldset className="gitapp-group-members">
        <legend>{text('组内项目', 'Projects in this group')}</legend>
        {projects.map(project => {
          const currentGroup = groupByProject.get(project.id);
          return <label key={project.id}>
            <input type="checkbox" checked={draft.projectIds.includes(project.id)} onChange={event => setDraft({
              ...draft, projectIds: event.target.checked ? [...draft.projectIds, project.id] : draft.projectIds.filter(id => id !== project.id),
            })} />
            <span><strong>{project.name}</strong><small title={project.localPath}>{project.localPath}</small></span>
            {currentGroup && currentGroup.id !== draft.id && <small title={currentGroup.name}>{currentGroup.name}</small>}
          </label>;
        })}
      </fieldset>}
      {existing && <Button size="compact" variant="danger" onClick={() => {
        if (window.confirm(text(`解散「${existing.name}」并将组内项目移到未分组？`, `Dissolve "${existing.name}" and move its projects to Ungrouped?`))) {
          save(groups.filter(group => group.id !== existing.id));
        }
      }}>{text('解散分组', 'Dissolve group')}</Button>}
    </FormDialog>}
  </div>;
}
