import type { ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../../../api/apiClient.js';
import type { GitMenuConfirmation } from '../components/GitContextMenu.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export function createApplyStashConfirmation(
  repository: ProjectGitRepositoryWorkbenchItem,
  stash: ProjectGitRepositoryWorkbenchItem['snapshot']['stashes'][number],
  zh: boolean,
  execute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>,
): GitMenuConfirmation {
  const title = zh ? '应用贮藏' : 'Apply stash';
  return {
    title,
    description: zh
      ? `将贮藏「${stash.subject}」应用到「${repository.name}」的工作区？\n${stash.ref}`
      : `Apply “${stash.subject}” to the working tree of “${repository.name}”?\n${stash.ref}`,
    checkboxLabel: zh ? '应用成功后删除贮藏' : 'Delete stash after successful application',
    run: async ({ checked }) => {
      const outcome = await execute(repository, {
        type: 'apply_stash', stashRef: stash.ref, expectedStashHash: stash.hash, pop: checked,
      }, title);
      return outcome !== null;
    },
  };
}
