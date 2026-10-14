import { type CommandEnvelope, type CommandScopeKind } from '@astragit/shared';
import { buildRendererCommandRequest, randomIdentity, type RendererCommandPayload } from '../../commandRequest.js';

export const workspaceGitClientCommandTypes = {
  workbenchAction: 'git.workbench.repository.action',
  projectSnapshotCreate: 'git.project.snapshot.create',
  projectPatchExport: 'git.project.patch.export',
} as const;

type WorkspaceGitClientCommandType = (typeof workspaceGitClientCommandTypes)[keyof typeof workspaceGitClientCommandTypes];
type WorkspaceGitClientScopeKind = Extract<CommandScopeKind, 'git_repository'>;
type WorkspaceGitCommandPayload = RendererCommandPayload;

/** 一次用户动作只构造一个不可变 Envelope。 */
export async function buildWorkspaceGitCommandRequest<TInput extends object>(input: {
  commandType: WorkspaceGitClientCommandType;
  scopeKind: WorkspaceGitClientScopeKind;
  scopeId: string;
  value: TInput;
  reconnectIdentity?: string;
}): Promise<{ command: CommandEnvelope<WorkspaceGitCommandPayload>; input: TInput }> {
  const operationIdentity = `workspace_git_operation_${randomIdentity()}`;
  return buildRendererCommandRequest({
    commandType: input.commandType,
    commandIdPrefix: 'command_workspace_git_',
    actorId: 'astragit-desktop-workspace-git',
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    operationIdentity,
    expectedRevision: null,
    value: input.value,
  });
}
