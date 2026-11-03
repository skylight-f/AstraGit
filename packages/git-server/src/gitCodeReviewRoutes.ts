import type { FastifyInstance } from 'fastify';
import type { GitCodeReviewInput, GitCodeReviewEvent } from '@astragit/git-core';
import { PassThrough } from 'node:stream';
import type { ProjectStore } from './projectStore.js';
import type { ProjectGitWorkbenchService } from './projectGitWorkbenchService.js';
import type { GitModelTextTask, GitModelTextEvents } from './gitModelTextGeneration.js';
import { createReviewReportStream, createReviewThinkingStream } from './gitCodeReviewStream.js';
import { captureReviewScope, collectReviewContext, parseReviewInput, parseReviewReport, reviewFailure } from './gitCodeReview.js';

export function registerGitCodeReviewRoutes(server: FastifyInstance, dependencies: {
  projects: ProjectStore;
  workbench: ProjectGitWorkbenchService;
  redact: (text: string) => { text: string; redacted: boolean };
  generate: (projectId: string, input: GitCodeReviewInput, task: GitModelTextTask, signal: AbortSignal, events: GitModelTextEvents) => Promise<{ message: string; model: string }>;
}) {
  const active = new Map<string, AbortController>();
  server.addHook('preClose', async () => { for (const controller of active.values()) controller.abort(); active.clear(); });
  server.post<{ Params: { projectId: string }; Body: { requestId?: unknown } }>('/api/projects/:projectId/git/code-review/cancel', async (request, reply) => {
    reply.header('Connection', 'close');
    const id = request.body?.requestId;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/u.test(id)) return { cancelled: false };
    const controller = active.get(`${request.params.projectId}:${id}`);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });
  for (const checkOnly of [false, true]) {
    server.post<{ Params: { projectId: string }; Body: unknown }>(`/api/projects/:projectId/git/code-review${checkOnly ? '/scope' : ''}`, { bodyLimit: 8000 }, async (request, reply) => {
      const controller = new AbortController();
      const disconnect = () => {
        if (!reply.raw.writableFinished) { controller.abort(); stream?.destroy(); }
      };
      reply.raw.on('close', disconnect);
      reply.header('Cache-Control', 'no-store');
      let key = '';
      const streaming = !checkOnly && Boolean(request.body && (request.body as { stream?: unknown }).stream === true);
      const stream = streaming ? new PassThrough() : null;
      const emit = (event: GitCodeReviewEvent) => {
        if (stream && !stream.destroyed && !controller.signal.aborted) stream.write(`${JSON.stringify(event)}\n`);
      };
      const failure = (error: unknown) => {
        const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
        const message = status !== 500 && error instanceof Error ? dependencies.redact(error.message).text : '无法完成代码评审，请刷新仓库或检查 AI 模型连接后重试。';
        return { status, message };
      };
      const run = async () => {
        const input = parseReviewInput(request.body);
        if (!checkOnly) {
          const id = (request.body as { requestId?: unknown }).requestId;
          if (typeof id !== 'string' || !/^[\w-]{1,100}$/u.test(id)) throw reviewFailure('评审请求标识无效。', 400);
          key = `${request.params.projectId}:${id}`;
          if (active.has(key)) throw reviewFailure('评审请求正在执行，请勿重复提交。');
          active.set(key, controller);
        }
        const capture = await captureReviewScope(dependencies.projects, dependencies.workbench, request.params.projectId, input, controller.signal);
        if (checkOnly) return capture.scope;
        const context = await collectReviewContext(capture, input, dependencies.redact, controller.signal);
        emit({ type: 'scope', scope: { ...capture.scope, limitations: context.limitations } });
        const text = createReviewReportStream(context.repositories, dependencies.redact, emit);
        const thinking = createReviewThinkingStream(dependencies.redact, value => emit({ type: 'thinking', text: value }));
        controller.signal.throwIfAborted();
        let result: { message: string; model: string };
        try {
          result = await dependencies.generate(request.params.projectId, input, context.task, controller.signal, { onText: text, onThinking: value => thinking.push(value) });
        } finally { thinking.finish(); }
        const after = await captureReviewScope(dependencies.projects, dependencies.workbench, request.params.projectId, input, controller.signal);
        if (after.scope.fingerprint !== capture.scope.fingerprint) throw reviewFailure('评审期间代码或范围已变化，请重新评审。');
        const report = parseReviewReport(dependencies.redact(result.message).text, context.repositories);
        return { ...capture.scope, ...report, limitations: context.limitations, model: result.model, reviewedAt: new Date().toISOString(), mode: input.mode };
      };
      const cleanup = () => {
        if (key && active.get(key) === controller) active.delete(key);
        reply.raw.off('close', disconnect);
      };
      if (stream) {
        reply.type('application/x-ndjson').header('X-Accel-Buffering', 'no').header('Connection', 'close');
        const heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 15_000);
        void run().then(value => {
          emit({ type: 'result', report: value as Extract<GitCodeReviewEvent, { type: 'result' }>['report'] });
        }).catch(error => {
          emit({ type: 'error', message: failure(error).message });
          controller.abort();
        }).finally(() => { clearInterval(heartbeat); stream.end(); cleanup(); });
        return reply.send(stream);
      }
      try { return await run();
      } catch (error) {
        // Git 原始错误可能包含机器路径、远端和凭据，不透传供应商或命令输出。
        const { status, message } = failure(error);
        return reply.code(status).send({ error: 'ASTRAGIT_CODE_REVIEW_FAILED', message });
      } finally { cleanup(); }
    });
  }
}
