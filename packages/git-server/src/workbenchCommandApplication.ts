import { redactGitOutput } from '@astragit/git-core';
import { GitCommandApplication, gitCommandTypes } from './gitCommandApplication.js';
import { ProjectGitWorkbenchService, gitFailureDiagnostics, parseProjectGitAction, type ProjectGitActionResponse } from './projectGitWorkbenchService.js';
import { projectError } from './projectStore.js';

interface RecordedFailure {
  code: string;
  message: string;
  statusCode: number;
  diagnostics: ReturnType<typeof gitFailureDiagnostics>;
}
type SettledWorkbenchCommand = { kind: 'response'; response: ProjectGitActionResponse } | { kind: 'failure'; failure: RecordedFailure };

/** The receipt acknowledges delivery of a domain result, not success of the Git
 * action. A rejected checkout is replayed as the same rejection, with its verified
 * paths and outcome intact. Missing durable receipts remain unconfirmed.
 */
export async function executeWorkbenchCommand(input: {
  application: GitCommandApplication;
  workbench: ProjectGitWorkbenchService;
  projectId: string;
  repositoryId: string;
  body: unknown;
  onSettled(action: string, outcome: string): void;
}): Promise<ProjectGitActionResponse> {
  const { application, workbench, projectId, repositoryId, body } = input;
  const envelope = record(body);
  const value = envelope && 'input' in envelope ? envelope.input : body;
  const action = parseProjectGitAction(value);
  // Old callers without a command envelope retain the original non-replayable
  // contract. Every current renderer workbench action sends an envelope.
  if (!envelope || !('command' in envelope)) return workbench.execute(projectId, repositoryId, action);
  await workbench.resolveCommitTarget(projectId, repositoryId);
  const parsed = application.parse<Record<string, unknown>>({ value: body, commandType: gitCommandTypes.workbenchAction, scopeKind: 'git_repository', expectedScopeId: () => repositoryId });
  const rebase = action.type === 'interactive_rebase' || action.type === 'amend_rebase_step' || ((action.type === 'continue_integration' || action.type === 'skip_integration' || action.type === 'abort_integration') && action.kind === 'rebase');
  const delivered = await application.executeExternal<Record<string, unknown>, SettledWorkbenchCommand | ProjectGitActionResponse>({
    parsed,
    destinationId: rebase ? 'git-workbench:interactive-rebase' : 'git-workbench:repository-action',
    resourceId: `${projectId}:${repositoryId}`,
    externalOperationId: `${projectId}:${repositoryId}:${parsed.operationIdentity}`,
    invoke: async () => {
      try { return { kind: 'response', response: await workbench.execute(projectId, repositoryId, action) }; }
      catch (error) {
        const native = record(error);
        return { kind: 'failure', failure: {
          code: typeof native?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(native.code) ? native.code : 'ASTRAGIT_ACTION_FAILED',
          message: redactGitOutput(error instanceof Error ? error.message : String(error)).slice(0, 65_536),
          statusCode: typeof native?.statusCode === 'number' && native.statusCode >= 400 && native.statusCode <= 599 ? native.statusCode : 500,
          diagnostics: gitFailureDiagnostics(error),
        } };
      }
    },
    mutateAcceptedBusinessState: result => input.onSettled(action.type, 'kind' in result ? result.kind === 'response' ? result.response.result.outcome : String(result.failure.diagnostics.operationStatus ?? 'failed') : result.result.outcome),
  });
  const result = delivered.result;
  if ('kind' in result && result.kind === 'failure') throw Object.assign(projectError(result.failure.code, result.failure.message), { statusCode: result.failure.statusCode, ...result.failure.diagnostics });
  // Receipts written by the previous interactive-rebase implementation stored a
  // bare response. Keep them replayable without executing Git again.
  const response = 'kind' in result ? result.response : result;
  if (response.projectId !== projectId || response.repositoryId !== repositoryId) throw projectError('ASTRAGIT_COMMAND_RESULT_MISSING', '命令回执不属于当前仓库，请核对原操作结果，不要直接重复执行。');
  return response;
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
