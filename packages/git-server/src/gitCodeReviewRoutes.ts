import type { FastifyInstance } from 'fastify';
import type { GitCodeReviewInput } from '@astragit/git-core';
import type { ProjectStore } from './projectStore.js';
import type { ProjectGitWorkbenchService } from './projectGitWorkbenchService.js';
import type { GitModelTextTask } from './gitModelTextGeneration.js';
import { captureReviewScope, collectReviewContext, parseReviewInput, parseReviewReport, reviewFailure } from './gitCodeReview.js';

export function registerGitCodeReviewRoutes(server: FastifyInstance, dependencies: {
  projects: ProjectStore;
  workbench: ProjectGitWorkbenchService;
  redact: (text: string) => { text: string; redacted: boolean };
  generate: (projectId: string, input: GitCodeReviewInput, task: GitModelTextTask, signal: AbortSignal) => Promise<{ message: string; model: string }>;
}) {
  const active = new Map<string, AbortController>();
  server.addHook('preClose', async () => { for (const controller of active.values()) controller.abort(); active.clear(); });
  server.post<{ Params: { projectId: string }; Body: { requestId?: unknown } }>('/api/projects/:projectId/git/code-review/cancel', async (request) => {
    const id = request.body?.requestId;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/u.test(id)) return { cancelled: false };
    const controller = active.get(`${request.params.projectId}:${id}`);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });
  for (const checkOnly of [false, true]) {
    server.post<{ Params: { projectId: string }; Body: unknown }>(`/api/projects/:projectId/git/code-review${checkOnly ? '/scope' : ''}`, { bodyLimit: 8000 }, async (request, reply) => {
      const controller = new AbortController();
      const disconnect = () => { if (!reply.raw.writableFinished) controller.abort(); };
      reply.raw.on('close', disconnect);
      reply.header('Cache-Control', 'no-store');
      let key = '';
      try {
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
        controller.signal.throwIfAborted();
        const result = await dependencies.generate(request.params.projectId, input, context.task, controller.signal);
        const after = await captureReviewScope(dependencies.projects, dependencies.workbench, request.params.projectId, input, controller.signal);
        if (after.scope.fingerprint !== capture.scope.fingerprint) throw reviewFailure('评审期间代码或范围已变化，请重新评审。');
        const report = parseReviewReport(dependencies.redact(result.message).text, context.repositories);
        return { ...capture.scope, ...report, limitations: context.limitations, model: result.model, reviewedAt: new Date().toISOString(), mode: input.mode };
      } catch (error) {
        const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
        // Git 原始错误可能包含机器路径、远端和凭据，不透传供应商或命令输出。
        const message = status !== 500 && error instanceof Error ? dependencies.redact(error.message).text : '无法完成代码评审，请刷新仓库或检查 AI 模型连接后重试。';
        return reply.code(status).send({ error: 'ASTRAGIT_CODE_REVIEW_FAILED', message });
      } finally { if (key && active.get(key) === controller) active.delete(key); reply.raw.off('close', disconnect); }
    });
  }
}
