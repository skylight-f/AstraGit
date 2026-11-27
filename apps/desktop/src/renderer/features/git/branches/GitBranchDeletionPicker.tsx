import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { buildBranchTree, type BranchTreeNode } from './gitBranchTree.js';

function branchLeaves(node: BranchTreeNode): string[] {
  return node.children.size ? [...node.children.values()].flatMap(branchLeaves) : [node.branch];
}

export function GitBranchDeletionPicker(props: {
  branches: string[];
  heads?: Record<string, string>;
  selected: Set<string>;
  initialBranch?: string;
  status: (branch: string) => string | null;
  onSelect: (branches: string[], checked: boolean) => void;
  locked: boolean;
  zh: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => {
    const filter = query.trim().toLocaleLowerCase();
    const branches = selectedOnly ? [...props.selected] : props.branches;
    return buildBranchTree(branches.filter(branch => branch.toLocaleLowerCase().includes(filter)));
  }, [props.branches, props.selected, query, selectedOnly]);
  const roots = [...tree.children.values()];
  const ungrouped = roots.filter(node => !node.children.size);
  useLayoutEffect(() => {
    if (props.initialBranch) list.current?.querySelector('.git-branch-choice input:checked')?.scrollIntoView({ block: 'nearest' });
  }, [props.initialBranch]);

  function group(name: string, path: string, nodes: BranchTreeNode[]) {
    const branches = nodes.flatMap(branchLeaves);
    const eligible = branches.filter(branch => !props.status(branch));
    const checked = eligible.filter(branch => props.selected.has(branch)).length;
    return <details className="git-branch-choice-group" key={path} open>
      <summary>
        <CaretRightIcon size={12} aria-hidden="true" />
        <input type="checkbox" aria-label={props.zh ? `选择分组 ${path || name}` : `Select group ${path || name}`}
          disabled={props.locked || !eligible.length} checked={eligible.length > 0 && checked === eligible.length}
          ref={input => { if (input) input.indeterminate = checked > 0 && checked < eligible.length; }}
          onChange={event => props.onSelect(eligible, event.currentTarget.checked)} />
        <strong>{name}</strong><small>{branches.length}</small>
      </summary>
      <div className="git-branch-choice-children">{nodes.map(renderBranch)}</div>
    </details>;
  }

  function renderBranch(node: BranchTreeNode): ReactNode {
    if (node.children.size) return group(node.name, node.branch, [...node.children.values()]);
    const branch = node.branch;
    const status = props.status(branch);
    const head = props.heads?.[branch];
    return <label key={branch} className="git-branch-choice">
      <input type="checkbox" aria-label={branch} checked={props.selected.has(branch)} disabled={props.locked || Boolean(status)}
        onChange={event => props.onSelect([branch], event.currentTarget.checked)} />
      <span className="git-branch-choice-name" title={branch}>{node.name}</span>
      {status ? <small className="git-branch-choice-status">{status}</small> : <code title={head}>{head?.slice(0, 12)}</code>}
    </label>;
  }

  const filterLabel = selectedOnly ? (props.zh ? '筛选已选分支' : 'Filter selected branches') : (props.zh ? '筛选分支' : 'Filter branches');
  const toggleLabel = props.zh ? '仅看已选分支' : 'Show selected branches only';
  return <div className="git-branch-picker">
    <div className="git-branch-picker-tools">
      <input type="search" aria-label={filterLabel} placeholder={filterLabel} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" title={toggleLabel} aria-pressed={selectedOnly}
        disabled={!selectedOnly && !props.selected.size} onClick={() => { setSelectedOnly(value => !value); setQuery(''); }}>
        {props.zh ? `已选 ${props.selected.size} / ${props.branches.length}` : `${props.selected.size} of ${props.branches.length} selected`}
      </button>
    </div>
    <div ref={list} className="git-branch-delete-list">
      {roots.filter(node => node.children.size).map(renderBranch)}
      {ungrouped.length > 0 && group(props.zh ? '无前缀' : 'No prefix', '', ungrouped)}
      {!roots.length && <p className="git-branch-picker-empty">{props.zh ? '没有匹配的分支' : 'No matching branches'}</p>}
    </div>
  </div>;
}
