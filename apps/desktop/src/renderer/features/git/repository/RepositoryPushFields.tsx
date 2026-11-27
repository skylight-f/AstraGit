import { Select, TextInput } from '../../../ui/FormControls.js';
import { useId, useMemo, type ReactNode } from 'react';
import { splitGitRemoteBranch } from '@astragit/shared';
import type { ProjectGitRepositorySnapshot } from '../../../api/apiClient.js';
import { branchPushTarget, changePushDestination, type PushDestinationDraft } from './pushTarget.js';

export function RepositoryPushFields(props: {
  snapshot: ProjectGitRepositorySnapshot;
  draft: PushDestinationDraft;
  selectedBranches: string[];
  onChange: (draft: PushDestinationDraft) => void;
  onSelect?: (branches: string[], checked: boolean) => void;
  zh: boolean;
  disabled: boolean;
  children?: ReactNode;
}) {
  const optionsId = useId();
  const { snapshot, draft, selectedBranches, onSelect, zh } = props;
  // A commit can only publish the branch receiving that commit.
  const branches = onSelect ? snapshot.localBranches : selectedBranches;
  const selected = new Set(selectedBranches);
  const remoteBranches = useMemo(() => {
    const names = new Set<string>();
    for (const ref of snapshot.remoteBranches) {
      const parsed = splitGitRemoteBranch(ref, snapshot.remotes);
      if (parsed?.remote === draft.remote && parsed.branch !== 'HEAD') names.add(parsed.branch);
    }
    return names;
  }, [draft.remote, snapshot.remoteBranches, snapshot.remotes]);
  const pushUrl = snapshot.remoteDetails?.find(item => item.name === draft.remote)?.pushUrl;
  return <>
    <fieldset disabled={props.disabled} className="project-git-sync-fields">
      {props.children}
      <label>
        <span>{zh ? '推送到仓库' : 'Push to remote'}</span>
        <Select
          ariaLabel={zh ? '推送到仓库' : 'Push to remote'}
          value={draft.remote}
          disabled={props.disabled}
          onChange={value => props.onChange({ ...draft, remote: value })}
          options={snapshot.remotes.map(name => ({ value: name, label: name }))}
        />
      </label>
      {pushUrl && <p className="project-git-remote-url">{pushUrl}</p>}
    </fieldset>
    <fieldset disabled={props.disabled || !draft.remote} className="project-git-sync-options">
      <legend>{zh ? '要推送的分支' : 'Branches to push'}</legend>
      <div className="project-git-sync-table-scroll">
        <table className="project-git-sync-table">
          <thead><tr>
            {onSelect && <th>{zh ? '推送' : 'Push'}</th>}
            <th>{zh ? '本地分支' : 'Local branch'}</th>
            <th>{zh ? '远程分支' : 'Remote branch'}</th>
            <th>{zh ? '跟踪' : 'Track'}</th>
          </tr></thead>
          <tbody>{branches.map(branch => {
            const { targetBranch, setUpstream } = branchPushTarget(draft, branch);
            const showTarget = selected.has(branch) || remoteBranches.has(branch) || draft.overrides[JSON.stringify([draft.remote, branch])];
            return <tr key={branch}>
              {onSelect && <td><input type="checkbox" aria-label={(zh ? '推送分支 ' : 'Push branch ') + branch}
                checked={selected.has(branch)} onChange={event => onSelect([branch], event.currentTarget.checked)} /></td>}
              <th scope="row">{branch}{branch === snapshot.branch && !snapshot.detached && <small>{zh ? '当前' : 'Current'}</small>}</th>
              <td><TextInput aria-label={(zh ? '远程目标 ' : 'Remote target ') + branch} list={optionsId} value={showTarget ? targetBranch : ''}
                onChange={event => props.onChange(changePushDestination(draft, branch, { targetBranch: event.currentTarget.value, setUpstream }))} /></td>
              <td><input type="checkbox" aria-label={(zh ? '设置跟踪 ' : 'Set upstream ') + branch} checked={setUpstream}
                onChange={event => props.onChange(changePushDestination(draft, branch, { targetBranch, setUpstream: event.currentTarget.checked }))} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <datalist id={optionsId}>{Array.from(remoteBranches, name => <option key={name} value={name} />)}</datalist>
      {!branches.length && <p>{zh ? '当前仓库没有本地分支。' : 'No local branches in this repository.'}</p>}
      {onSelect && <label><input type="checkbox" checked={branches.length > 0 && branches.every(branch => selected.has(branch))}
        onChange={event => onSelect(branches, event.currentTarget.checked)} />{zh ? '全选当前仓库分支' : 'Select all branches in this repository'}</label>}
    </fieldset>
  </>;
}
