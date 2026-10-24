import { userFacingErrorCause } from '@astragit/shared';
import type { FastifyReply } from 'fastify';

/** 保持历史 Native 查询接口的错误码与 HTTP 映射，不让各领域路由重复猜测状态码。 */
export function sendNativeQueryRouteError(reply: FastifyReply, error: unknown): unknown {
  const candidate = isRecord(error) ? error : null;
  const code = typeof candidate?.code === 'string' ? candidate.code : 'ASTRAGIT_NATIVE_CONVERSATION_API_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const explicitStatusCode = typeof candidate?.statusCode === 'number' && candidate.statusCode >= 400 && candidate.statusCode <= 599 ? candidate.statusCode : null;
  const statusCode =
    explicitStatusCode ??
    (code.endsWith('_NOT_FOUND')
      ? 404
      : code.includes('CONFLICT') ||
          code.includes('LOGIN_REQUIRED') ||
          code.includes('CHOICE_REQUIRED') ||
          code.includes('READ_ONLY') ||
          code.includes('NOT_EDITABLE') ||
          code.includes('NOT_QUEUED') ||
          code.includes('NOT_ACTIVE') ||
          (code.startsWith('ASTRAGIT_ASYNC_QUESTION_') && !code.endsWith('_INVALID')) ||
          code.includes('NOT_INTERRUPTED') ||
          code.includes('IN_PROGRESS') ||
          code.includes('MISMATCH') ||
          code.includes('EXCEEDS_POLICY') ||
          code.includes('EXCEEDS_REQUEST') ||
          code.includes('ATTACHMENT_UNAVAILABLE') ||
          code.includes('CONTEXT_CHANGED') ||
          code.includes('NATIVE_DISABLED') ||
          code.includes('NOT_AVAILABLE') ||
          code.includes('STALE')
          || code.endsWith('_CHANGED')
          || code === 'ASTRAGIT_GIT_STOP_TRACKING_NOT_TRACKED'
          || code === 'ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED'
        ? 409
        : code.startsWith('ASTRAGIT_INVALID_') || code.endsWith('_INVALID') || code.endsWith('_REQUIRED') || code.includes('_UNSUPPORTED')
          ? 400
          : 500);
  return reply
    .code(statusCode)
    .send({ error: code, message, ...queryDiagnostics(error), ...(candidate?.cause ? { cause: userFacingErrorCause(candidate.cause) } : {}), ...(code.includes('STALE') || code.includes('RECOVERY_REQUIRED') ? { recoveryRequired: true } : {}) });
}

function queryDiagnostics(error: unknown) {
  const value = userFacingErrorCause(error);
  return { ...(value.details ? { details: value.details } : {}), ...(value.operationStatus ? { operationStatus: value.operationStatus } : {}), ...(value.affectedFiles ? { affectedFiles: value.affectedFiles } : {}), ...(value.affectedFileCount !== undefined ? { affectedFileCount: value.affectedFileCount } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
