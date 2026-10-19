/** 本机 API 传输端口：只负责 token、JSON 请求与 NDJSON 流，不承载会话导航追踪。 */
export interface LocalApiTransport {
  readonly protocol: 'astragit-local-api-v1';
  request<T>(path: string, init?: RequestInit): Promise<T>;
  requestStream<T>(path: string, init: RequestInit, onEvent: (event: T) => void): Promise<void>;
}

export interface LocalApiConnection {
  baseUrl: string;
  apiToken: string;
}

export interface AstraGitClientPerformanceSpan {
  traceId: string;
  attempt: number;
  operation: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number | null;
  responseWaitMs: number | null;
  responseParseMs: number | null;
  responseBytes: number | null;
}

export class AstraGitApiError extends Error {
  readonly retryAfterMs?: number;
  readonly status: number;
  readonly error: string | null;
  readonly recoveryRequired: boolean;
  readonly details?: string;
  readonly operationStage?: string;
  readonly operationStatus?: string;
  readonly blockedBy?: 'tracked' | 'untracked' | 'both';
  override readonly cause?: unknown;

  constructor(input: { status: number; error?: string | null; message: string; recoveryRequired?: boolean; cause?: unknown; retryAfterMs?: number; details?: string; operationStage?: string; operationStatus?: string; blockedBy?: 'tracked' | 'untracked' | 'both' }) {
    super(input.message);
    this.name = 'AstraGitApiError';
    this.status = input.status;
    this.error = input.error ?? null;
    this.recoveryRequired = input.recoveryRequired ?? false;
    if (input.details !== undefined) this.details = input.details;
    if (input.operationStage !== undefined) this.operationStage = input.operationStage;
    if (input.operationStatus !== undefined) this.operationStatus = input.operationStatus;
    if (input.blockedBy !== undefined) this.blockedBy = input.blockedBy;
    if (input.cause !== undefined) this.cause = input.cause;
    if (input.retryAfterMs !== undefined) this.retryAfterMs = input.retryAfterMs;
  }
}

const localApiReadTimeoutMs = 30_000;
const localApiMutationTimeoutMs = 150_000;

export function isLikelyLocalServerConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof AstraGitApiError) return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
  return false;
}

export function createLocalApiTransport(options: { getConnection(): LocalApiConnection; refreshConnection?: () => Promise<LocalApiConnection>; onPerformanceSpan?: (span: AstraGitClientPerformanceSpan) => void }): LocalApiTransport {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const traceId = createClientTraceId(path);
    try {
      return await requestOnce<T>(options.getConnection(), path, init, traceId, 1, options.onPerformanceSpan);
    } catch (error) {
      const method = (init?.method ?? 'GET').toUpperCase();
      const replayable = method === 'GET' || method === 'HEAD' || new Headers(init?.headers).has('idempotency-key');
      if (!replayable || !isLikelyLocalServerConnectionError(error) || !options.refreshConnection) throw error;
      const refreshed = await options.refreshConnection();
      return await requestOnce<T>(refreshed, path, init, traceId, 2, options.onPerformanceSpan);
    }
  };

  const requestStream = async <T>(path: string, init: RequestInit, onEvent: (event: T) => void): Promise<void> => {
    const connection = options.getConnection();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${connection.apiToken}`);
    headers.set('x-astragit-api-token', connection.apiToken);
    headers.set('content-type', 'application/json');
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    const response = await fetch(`${connection.baseUrl}${path}`, { ...init, headers, signal });
    if (!response.ok) throw await responseError(response, path);
    if (!response.body) throw new Error('生成响应为空。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        if (pending.length > 1_000_000) throw new Error('生成响应过大。');
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (line.trim()) onEvent(JSON.parse(line) as T);
        }
        if (done) break;
      }
      if (pending.trim()) onEvent(JSON.parse(pending) as T);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };

  return { protocol: 'astragit-local-api-v1', request, requestStream };
}

export function jsonRequest(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

async function requestOnce<T>(connection: LocalApiConnection, path: string, init: RequestInit | undefined, traceId: string, attempt: number, observer?: (span: AstraGitClientPerformanceSpan) => void): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${connection.apiToken}`);
  headers.set('x-astragit-api-token', connection.apiToken);
  if (init?.body) headers.set('content-type', 'application/json');
  const startedAt = performance.now();
  let status: number | null = null;
  try {
    const timeoutMs = (init?.method ?? 'GET').toUpperCase() === 'GET' ? localApiReadTimeoutMs : localApiMutationTimeoutMs;
    const result = await runWithReadTimeout({ ...init, headers }, path, timeoutMs, async (timedInit) => {
      const response = await fetch(`${connection.baseUrl}${path}`, timedInit);
      status = response.status;
      if (!response.ok) throw await responseError(response, path);
      if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
      return (await response.json()) as T;
    });
    observer?.({
      traceId,
      attempt,
      operation: `${init?.method ?? 'GET'} ${path}`,
      statusCode: status,
      success: true,
      durationMs: performance.now() - startedAt,
      responseWaitMs: null,
      responseParseMs: null,
      responseBytes: null,
    });
    return result;
  } catch (error) {
    observer?.({
      traceId,
      attempt,
      operation: `${init?.method ?? 'GET'} ${path}`,
      statusCode: status,
      success: false,
      durationMs: performance.now() - startedAt,
      responseWaitMs: null,
      responseParseMs: null,
      responseBytes: null,
    });
    throw error;
  }
}

async function runWithReadTimeout<T>(init: RequestInit, path: string, timeoutMs: number, run: (init: RequestInit) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    return await run({ ...init, signal });
  } catch (error) {
    if (controller.signal.aborted && !(init.signal && init.signal.aborted)) {
      const reading = ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
      throw new AstraGitApiError({ status: 0, message: reading ? `本机 API 读取超时：${path}` : `本机 API 操作请求超时，尚无法确认执行结果：${path}`, error: reading ? 'ASTRAGIT_LOCAL_API_READ_TIMEOUT' : 'ASTRAGIT_LOCAL_API_MUTATION_OUTCOME_UNKNOWN' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(response: Response, path: string): Promise<AstraGitApiError> {
  let payload: Record<string, unknown> | null = null;
  try {
    const value: unknown = await response.json();
    payload = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    payload = null;
  }
  const retryAfter = response.headers.get('retry-after');
  return new AstraGitApiError({
    status: response.status,
    error: typeof payload?.error === 'string' ? payload.error : null,
    message: typeof payload?.message === 'string' ? payload.message : `本机 API 请求失败：${path}`,
    recoveryRequired: payload?.recoveryRequired === true,
    ...(typeof payload?.details === 'string' ? { details: payload.details } : {}),
    ...(typeof payload?.operationStage === 'string' ? { operationStage: payload.operationStage } : {}),
    ...(typeof payload?.operationStatus === 'string' ? { operationStatus: payload.operationStatus } : {}),
    ...(['tracked', 'untracked', 'both'].includes(String(payload?.blockedBy)) ? { blockedBy: payload!.blockedBy as 'tracked' | 'untracked' | 'both' } : {}),
    ...(payload?.cause && typeof payload.cause === 'object' ? { cause: payload.cause } : {}),
    ...(retryAfter ? { retryAfterMs: Number(retryAfter) * 1000 } : {}),
  });
}

function createClientTraceId(path: string): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${path.replace(/[^\w]+/g, '').slice(-24)}`;
}
