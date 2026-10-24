import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { PassThrough } from 'node:stream';
import { getGitDiff, getGitStatus } from '@astragit/git-core';
import {
  ArtifactStore,
  AuditLogRepository,
  CommandDeliveryRepository,
  SettingRepository,
  createAstraGitDatabase,
  type AppendAuditLogInput,
} from '@astragit/storage';
import { createCodexAppServerManager, modelConnectionTemplates, type CodexAppServerManager, type CodexModelCapability, type SelectableConnectionModel } from '@astragit/ai-runtime';
import { GitCommandApplication, gitCommandHttpError } from './gitCommandApplication.js';
import { registerGitCommandRoutes } from './gitCommandRoutes.js';
import { executeWorkbenchCommand } from './workbenchCommandApplication.js';
import { createManualModel, createModelConnectionService } from './modelConnectionService.js';
import { createApplicationSecretStore, type SecretStore } from './securityCore.js';
import { ProjectStore, projectError, type GitAppProject } from './projectStore.js';
import { ProjectGitWorkbenchService, gitFailureDiagnostics, stableRepositoryId, type ProjectGitActionResponse, type ProjectGitWorkbenchSnapshot } from './projectGitWorkbenchService.js';
import { generateGitCommitMessage, type GitCommitMessageInput } from './gitCommitMessageGeneration.js';
import { createCommitCodexPool } from './gitCommitCodexGeneration.js';
import { readGitCommitContext, readCommitFingerprint } from './gitCommitContext.js';
import { sendNativeQueryRouteError } from './nativeQueryRouteError.js';
import { OperationHistoryStore } from './operationHistoryStore.js';
import { registerCommitSelectionRoutes } from './gitCommitSelectionRoutes.js';
import { RepositorySetupService } from './repositorySetupService.js';


export interface StartGitServerOptions {
  dataDirectory: string;
  projectRoot: string;
  host?: string;
  port?: number;
  apiToken: string;
  /** Desktop supplies Chromium networking; standalone hosts may use Node fetch. */
  fetch?: typeof fetch;
  /** Allows isolated hosts and tests to supply their own application credential store. */
  secretStore?: SecretStore;
  codexHome?: string;
  codexExternalAgentHome?: string;
  codexNativeEnabled?: boolean;
  currentCodexRuntimeCommandPath?: () => string;
}

export interface RunningGitServer {
  server: FastifyInstance;
  baseUrl: string;
  apiToken: string;
  projects: ProjectStore;
  hasActiveRepositorySetup(): boolean;
  resolveGitFileLocation(projectId: string, repositoryId: string, path: string, intent: import('@astragit/git-core').GitFileIntent): Promise<import('@astragit/git-core').GitFileLocation>;
  writeGitArchive(projectId: string, repositoryId: string, input: import('@astragit/git-core').GitArchiveInput, output: import('node:stream').Writable, signal?: AbortSignal): Promise<import('@astragit/git-core').GitArchiveResult>;
  previewGitArchive(projectId: string, repositoryId: string, input: import('@astragit/git-core').GitArchiveInput, signal?: AbortSignal): Promise<import('@astragit/git-core').GitArchivePreview>;
  close(): Promise<void>;
}

export async function startGitServer(options: StartGitServerOptions): Promise<RunningGitServer> {
  const dataDirectory = options.dataDirectory;
  const secretStore = options.secretStore ?? await createApplicationSecretStore(dataDirectory);
  const projects = new ProjectStore(dataDirectory);
  const repositorySetup = new RepositorySetupService(dataDirectory, projects);
  const db = await createAstraGitDatabase(join(dataDirectory, 'git-app.db'));
  const settings = new SettingRepository(db);
  const auditLogs = new AuditLogRepository(db);
  const deliveries = new CommandDeliveryRepository(db);
  const artifacts = new ArtifactStore(db, join(dataDirectory, 'artifacts', 'content-addressed'), () => new Date().toISOString(), { writeFaultReporter: db });
  await artifacts.initialize();
  const modelConnections = createModelConnectionService({
    settings,
    secretStore,
    save: () => db.save(),
    fetch: options.fetch,
  });

  const redactSensitiveText = (value: string): { text: string; redacted: boolean } => {
    // 独立应用首版：剥掉疑似密钥形态的片段。
    const redacted = value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{8,}/gu, '[已脱敏]');
    return { text: redacted, redacted: redacted !== value };
  };

  const appendAuditLog = (input: Omit<AppendAuditLogInput, 'createdAt'> & { createdAt?: string }): void => {
    auditLogs.append({ ...input, createdAt: input.createdAt ?? new Date().toISOString() });
  };

  const operations = new OperationHistoryStore(dataDirectory);
  const workbench = new ProjectGitWorkbenchService(projects, operations);
  const gitCommands = new GitCommandApplication({
    db,
    deliveries,
    artifacts,
    redactSensitiveText,
    now: () => new Date(),
  });

  const commitCodexPool = createCommitCodexPool();
  const codexHome = options.codexHome ?? join(dataDirectory, 'codex');
  const codexNativeEnabled = options.codexNativeEnabled ?? false;
  const codexAppServerManager: CodexAppServerManager | null = codexNativeEnabled
    ? createCodexAppServerManager({
        codexHome,
        onDiagnostic: ({ stderrSummary }) => {
          const categories = ['stream', 'timeout', 'connection', 'reconnect', '401', '403', '429', 'error'].filter((word) => stderrSummary.toLowerCase().includes(word));
          if (categories.length) console.info(JSON.stringify({ event: 'git_commit_transport_diagnostic', categories }));
        },
      })
    : null;

  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  // 本机渲染层（Vite / file://）访问随机端口 API：必须处理 CORS 预检，
  // 且 OPTIONS 不能先被令牌鉴权拦成 401（否则浏览器只报 Failed to fetch）。
  const allowedOrigin = (value: unknown): string => {
    const origin = typeof value === 'string' ? value : '';
    if (!origin) return '';
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu.test(origin)) return origin;
    if (origin === 'null' || origin.startsWith('file://')) return 'null';
    return '';
  };
  const applyCors = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = allowedOrigin(request.headers.origin);
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'false');
    }
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'content-type,authorization,x-astragit-api-token,x-astragit-trace-id');
    reply.header('Access-Control-Max-Age', '600');
    return request.method === 'OPTIONS';
  };

  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (applyCors(request, reply)) {
      await reply.code(204).send();
      return;
    }
    const token = request.headers['x-astragit-api-token'];
    if (token !== options.apiToken) {
      await reply.code(401).send({ error: 'ASTRAGIT_UNAUTHORIZED', message: '本机 API 令牌无效。' });
    }
  });
  let closing = false;
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) applyCors(request, reply);
    // Drain in-flight replies without keeping their HTTP sockets alive during shutdown.
    if (closing) reply.header('connection', 'close');
    return payload;
  });
  server.addHook('preClose', async () => { closing = true; workbench.cancelReadQueries(); });
  server.addHook('onClose', async () => {
    const results = await Promise.allSettled([commitCodexPool.close(), codexAppServerManager?.close(), repositorySetup.close()]);
    const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'AstraGit AI 服务关闭失败。');
  });

  // —— 项目 CRUD ——
  server.get('/api/repository-setup', async () => repositorySetup.list());
  server.get('/api/repository-setup/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try { return repositorySetup.get(request.params.id); } catch (error) { return sendError(reply, error); }
  });
  server.post('/api/repository-setup', async (request, reply) => {
    try { return reply.code(202).send(repositorySetup.start(request.body)); } catch (error) { return sendError(reply, error); }
  });
  server.post('/api/repository-setup/:id/cancel', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try { return repositorySetup.cancel(request.params.id); } catch (error) { return sendError(reply, error); }
  });
  server.get('/api/projects', async (): Promise<GitAppProject[]> => projects.list());

  server.post('/api/projects', async (request: FastifyRequest<{ Body: { name?: unknown; localPath?: unknown } }>, reply) => {
    try {
      const body = request.body;
      if (typeof body?.localPath !== 'string' || !body.localPath.trim()) {
        return reply.code(400).send({ error: 'ASTRAGIT_PROJECT_PATH_INVALID', message: '请选择项目目录。' });
      }
      const project = projects.create({
        name: typeof body.name === 'string' && body.name.trim() ? body.name : '',
        localPath: body.localPath.trim(),
      });
      return reply.code(201).send(project);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.post('/api/projects/:projectId/touch', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    const project = projects.touch(request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'ASTRAGIT_PROJECT_NOT_FOUND', message: '项目不存在。' });
    return project;
  });

  server.delete('/api/projects/:projectId', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    if (!projects.remove(request.params.projectId)) return reply.code(404).send({ error: 'ASTRAGIT_PROJECT_NOT_FOUND', message: '项目不存在。' });
    return { ok: true };
  });

  const runWorkbenchCommand = (projectId: string, repositoryId: string, body: unknown) => executeWorkbenchCommand({
    application: gitCommands, workbench, projectId, repositoryId, body,
    onSettled: (action, outcome) => appendAuditLog({ actorType: 'local_api', action: 'git.workbench.action.settled', resourceType: 'git_repository', resourceId: repositoryId, payload: { projectId, action, outcome } }),
  });

  // —— 工作台查询 ——

  const fileHistoryBoolean = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw projectError('ASTRAGIT_GIT_FILE_HISTORY_INVALID', '文件历史布尔参数无效。');
  };

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/tracked-files', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, string | undefined> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { const q = request.query; return await workbench.loadTrackedFiles(request.params.projectId, request.params.repositoryId, { ref: q.ref, search: q.search, offset: q.offset === undefined ? undefined : Number(q.offset), limit: q.limit === undefined ? undefined : Number(q.limit), expectedFingerprint: q.expectedFingerprint }, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/file-history', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, string | undefined> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { const q = request.query; return await workbench.loadFileHistory(request.params.projectId, request.params.repositoryId, { path: q.path ?? '', ref: q.ref, offset: q.offset === undefined ? undefined : Number(q.offset), limit: q.limit === undefined ? undefined : Number(q.limit), followRenames: fileHistoryBoolean(q.followRenames) }, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/file-revision', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, string | undefined> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { const q = request.query; return await workbench.loadFileRevision(request.params.projectId, request.params.repositoryId, { path: q.path ?? '', ref: q.ref, workingTree: fileHistoryBoolean(q.workingTree), withBlame: fileHistoryBoolean(q.withBlame), includeDiff: fileHistoryBoolean(q.includeDiff), previousPath: q.previousPath, expectedFingerprint: q.expectedFingerprint }, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/interactive-rebase-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: { baseRef?: unknown; ontoRef?: unknown } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try {
      if (typeof request.body?.baseRef !== 'string' || (request.body.ontoRef !== undefined && typeof request.body.ontoRef !== 'string')) throw projectError('ASTRAGIT_GIT_REBASE_RANGE_INVALID', '请选择有效的变基基点。');
      return await workbench.loadInteractiveRebasePreview(request.params.projectId, request.params.repositoryId, request.body.baseRef, request.body.ontoRef as string | undefined, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  // Scope the larger message budget to the interactive rebase workflow only.
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/interactive-rebase', { bodyLimit: 40 * 1024 * 1024 }, async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: unknown } | undefined;
      const input = body && typeof body === 'object' && 'input' in body ? body.input : body;
      const value = input as { type?: unknown; kind?: unknown } | undefined;
      if (!value || (value.type !== 'interactive_rebase' && value.type !== 'amend_rebase_step' && !(value.kind === 'rebase' && ['continue_integration', 'abort_integration', 'skip_integration'].includes(String(value.type))))) throw projectError('ASTRAGIT_ACTION_UNSUPPORTED', '此接口只接受交互变基及其恢复操作。');
      if (!body || typeof body !== 'object' || !('command' in body)) throw projectError('ASTRAGIT_COMMAND_INVALID', '交互变基需要带有命令身份的请求。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, request.body);
    } catch (error) {
      const commandError = gitCommandHttpError(error);
      return commandError ? reply.code(commandError.statusCode).send(commandError.payload) : sendError(reply, error);
    }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/stop-tracking-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: { paths?: unknown } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try {
      const paths = request.body?.paths;
      if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) throw projectError('ASTRAGIT_GIT_TRACKING_PATH_INVALID', '请选择有效路径。');
      return await workbench.loadStopTrackingPreview(request.params.projectId, request.params.repositoryId, paths, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/ignored-files', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { prefix?: string; search?: string; offset?: string; limit?: string; expectedFingerprint?: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try {
      const query = request.query;
      return await workbench.loadIgnoredFiles(request.params.projectId, request.params.repositoryId, { prefix: query.prefix, search: query.search, offset: query.offset === undefined ? undefined : Number(query.offset), limit: query.limit === undefined ? undefined : Number(query.limit), expectedFingerprint: query.expectedFingerprint }, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/ignore-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { scope?: string } }>, reply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnected);
    try {
      const scope = request.query.scope;
      if (scope !== 'repository' && scope !== 'local' && scope !== 'global') throw projectError('ASTRAGIT_GIT_IGNORE_INVALID', '忽略范围无效。');
      return await workbench.loadIgnorePreview(request.params.projectId, request.params.repositoryId, scope, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/reset-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { revision?: string; mode?: string } }>, reply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnected);
    try {
      const mode = request.query.mode;
      if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw projectError('ASTRAGIT_GIT_RESET_MODE_INVALID', '重置方式无效。');
      return await workbench.loadResetPreview(request.params.projectId, request.params.repositoryId, request.query.revision ?? '', mode, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/skip-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { kind?: string } }>, reply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnected);
    try {
      const kind = request.query.kind;
      if (kind !== 'rebase' && kind !== 'cherry_pick' && kind !== 'revert' && kind !== 'am') throw projectError('ASTRAGIT_GIT_INTEGRATION_CHANGED', '当前整合不能跳过。');
      return await workbench.loadSkipPreview(request.params.projectId, request.params.repositoryId, kind, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/settings', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    try { return await workbench.loadSettings(request.params.projectId, request.params.repositoryId); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/commit-template', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) controller.abort(); };
    reply.raw.once('close', disconnected);
    try { return await workbench.loadCommitTemplate(request.params.projectId, request.params.repositoryId, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    try {
      return await workbench.loadWorkbench(request.params.projectId);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/line-diff', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.lineDiff(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/stage-preview', { bodyLimit: 4 * 1024 * 1024 }, async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.previewStage(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/flow', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadFlow(request.params.projectId, request.params.repositoryId, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/flow-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.previewFlow(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/flow', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: { type?: unknown }; command?: unknown } | undefined;
      if (!body || typeof body !== 'object' || !body.command || body.input?.type !== 'manage_flow') throw projectError('ASTRAGIT_COMMAND_INVALID', 'Git Flow 需要带命令身份的专用请求。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, body);
    } catch (error) { const result = gitCommandHttpError(error); return result ? reply.code(result.statusCode).send(result.payload) : sendError(reply, error); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/lfs', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadLfs(request.params.projectId, request.params.repositoryId, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/lfs-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.previewLfs(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/lfs', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: { type?: unknown }; command?: unknown } | undefined;
      if (!body || typeof body !== 'object' || !body.command || body.input?.type !== 'manage_lfs') throw projectError('ASTRAGIT_COMMAND_INVALID', 'Git LFS 需要带命令身份的专用请求。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, body);
    } catch (error) { const result = gitCommandHttpError(error); return result ? reply.code(result.statusCode).send(result.payload) : sendError(reply, error); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/external-tools', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadExternalToolSettings(request.params.projectId, request.params.repositoryId, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/external-tool-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.previewExternalTool(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/external-tool', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: { type?: unknown }; command?: unknown } | undefined;
      if (!body || typeof body !== 'object' || !body.command || body.input?.type !== 'external_tool') throw projectError('ASTRAGIT_COMMAND_INVALID', '外部工具需要带命令身份的专用请求。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, body);
    } catch (error) { const result = gitCommandHttpError(error); return result ? reply.code(result.statusCode).send(result.payload) : sendError(reply, error); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/submodules', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadSubmodules(request.params.projectId, request.params.repositoryId, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/submodule-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.previewSubmodule(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/tags', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, string | undefined> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { const q = request.query; return await workbench.loadTags(request.params.projectId, request.params.repositoryId, { remote: q.remote, search: q.search, offset: q.offset === undefined ? undefined : Number(q.offset), limit: q.limit === undefined ? undefined : Number(q.limit), expectedFingerprint: q.expectedFingerprint }, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });
  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/tag-target', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { revision?: string } }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadTagTarget(request.params.projectId, request.params.repositoryId, request.query.revision ?? 'HEAD', controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); } finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/history-query', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, string | undefined> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try {
      const q = request.query;
      return await workbench.searchHistory(request.params.projectId, request.params.repositoryId, { ref: q.ref, search: q.search, field: q.field as import('@astragit/git-core').GitHistorySearchField | undefined, order: q.order as 'topo' | 'date' | undefined, cursor: q.cursor, limit: q.limit === undefined ? undefined : Number(q.limit) }, controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/history', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { offset?: string; ref?: string } }>, reply) => {
    try {
      return await workbench.loadHistory(request.params.projectId, request.params.repositoryId, Number(request.query.offset ?? 0), request.query.ref);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/commits/:commitHash', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string; commitHash: string } }>, reply) => {
    try {
      return await workbench.loadCommit(request.params.projectId, request.params.repositoryId, request.params.commitHash);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/compare', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { ref?: string; mode?: string } }>, reply) => {
    try {
      return await workbench.loadComparison(request.params.projectId, request.params.repositoryId, request.query.ref ?? '', request.query.mode === 'working-tree' ? 'working-tree' : 'current');
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/compare-revisions', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: Record<string, unknown> }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try {
      const query = request.query;
      if (Object.keys(query).some(key => key !== 'from' && key !== 'to') || typeof query.from !== 'string' || typeof query.to !== 'string') throw projectError('ASTRAGIT_GIT_COMPARISON_INVALID', '请选择两个有效提交进行比较。');
      return await workbench.loadRevisionsComparison(request.params.projectId, request.params.repositoryId, [query.from, query.to], controller.signal);
    } catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/archive-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadArchivePreview(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/replay-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadCommitReplayPreview(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/replay-series-preview', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
    try { return await workbench.loadCommitReplaySeriesPreview(request.params.projectId, request.params.repositoryId, request.body, controller.signal); }
    catch (error) { return sendNativeQueryRouteError(reply, error); }
    finally { reply.raw.off('close', disconnected); }
  });

  server.get('/api/projects/:projectId/git/workbench/repositories/:repositoryId/conflict', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Querystring: { path?: string } }>, reply) => {
    try { return await workbench.readConflict(request.params.projectId, request.params.repositoryId, request.query.path ?? ''); }
    catch (error) { return sendError(reply, error); }
  });
  // UTF-8 文本最多 2 MiB；JSON 控制字符转义最多放大六倍，只放宽这一条路由。
  server.put('/api/projects/:projectId/git/workbench/repositories/:repositoryId/conflict', { bodyLimit: 12 * 1024 * 1024 + 64 * 1024 }, async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try { return await workbench.saveConflict(request.params.projectId, request.params.repositoryId, request.body); }
    catch (error) { return sendError(reply, error); }
  });

  server.get('/api/projects/:projectId/git/status', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    try {
      const project = workbench.requireProject(request.params.projectId);
      return await getGitStatus(project.localPath);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  server.get('/api/projects/:projectId/git/diff', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    try {
      const project = workbench.requireProject(request.params.projectId);
      return await getGitDiff(project.localPath);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
  });

  for (const kind of ['patch-preview', 'patch-export', 'mailbox-preview'] as const) {
    server.post(`/api/projects/:projectId/git/workbench/repositories/:repositoryId/${kind}`, { bodyLimit: 16 * 1024 * 1024 }, async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
      const controller = new AbortController(); const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); }; reply.raw.on('close', disconnected);
      try { return kind === 'patch-preview'
        ? await workbench.loadPatchPreview(request.params.projectId, request.params.repositoryId, request.body as import('@astragit/git-core').GitPatchInput, controller.signal)
        : kind === 'mailbox-preview' ? await workbench.loadMailboxPreview(request.params.projectId, request.params.repositoryId, request.body as import('@astragit/git-core').GitMailboxInput, controller.signal)
        : await workbench.exportPatch(request.params.projectId, request.params.repositoryId, request.body as import('@astragit/git-core').GitPatchExportInput, controller.signal);
      } catch (error) { return sendNativeQueryRouteError(reply, error); }
      finally { reply.raw.off('close', disconnected); }
    });
  }
  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/patch-import', { bodyLimit: 16 * 1024 * 1024 }, async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { command?: unknown; input?: { type?: unknown } } | null;
      if (!body?.command || !['import_patch', 'import_mailbox'].includes(String(body.input?.type))) throw projectError('ASTRAGIT_INVALID_ACTION', '补丁导入需使用有效命令身份。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, request.body);
    } catch (error) { const commandError = gitCommandHttpError(error); return commandError ? reply.code(commandError.statusCode).send(commandError.payload) : sendError(reply, error); }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/actions', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: unknown } | undefined;
      const input = body && typeof body === 'object' && 'input' in body ? body.input : body;
      if (input && typeof input === 'object' && 'type' in input && ['interactive_rebase', 'amend_rebase_step', 'import_patch', 'import_mailbox', 'external_tool', 'manage_lfs', 'manage_flow'].includes(String(input.type))) throw projectError('ASTRAGIT_ACTION_UNSUPPORTED', '此操作需使用带命令身份的专用接口。');
      return await runWorkbenchCommand(request.params.projectId, request.params.repositoryId, request.body);
    } catch (error) {
      const commandError = gitCommandHttpError(error);
      return commandError ? reply.code(commandError.statusCode).send(commandError.payload) : sendError(reply, error);
    }
  });

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/cancel', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string } }>, reply) => {
    try {
      return await workbench.cancel(request.params.projectId, request.params.repositoryId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // —— 高危确认流 ——
  registerGitCommandRoutes({
    server,
    application: gitCommands,
    projectRoot: options.projectRoot,
    projects: { getById: (id: string) => projects.getById(id) },
    redactSensitiveText,
    appendAuditLog,
    publishRealtimeEvent: () => undefined,
    save: () => db.save(),
    now: () => new Date(),
  });

  // —— 操作历史 ——
  server.get('/api/projects/:projectId/git/operations', async (request: FastifyRequest<{ Params: { projectId: string }; Querystring: { cursor?: string } }>, reply) => {
    try {
      workbench.requireProject(request.params.projectId);
      return operations.list(request.params.projectId, request.query.cursor);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // —— 模型连接 ——
  server.get('/api/model-connection-templates', async () => modelConnectionTemplates);

  server.get('/api/model-connections', async () => {
    const items = await modelConnections.list();
    return { items: items.map((item) => ({ ...item, apiKey: undefined })) };
  });

  server.post('/api/model-connections', async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    try {
      const body = request.body;
      const record = await modelConnections.create(body as never);
      return reply.code(201).send({ ...record, apiKey: undefined });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.patch('/api/model-connections/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>, reply) => {
    try {
      const record = await modelConnections.update(request.params.id, request.body as never);
      return { ...record, apiKey: undefined };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.delete('/api/model-connections/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      await modelConnections.remove(request.params.id);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.post('/api/model-connections/:id/refresh-models', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      return await modelConnections.refreshModels(request.params.id);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.post('/api/model-connections/:id/models', async (request: FastifyRequest<{ Params: { id: string }; Body: { modelId?: unknown } }>, reply) => {
    try {
      const connection = await modelConnections.get(request.params.id);
      if (!connection) return reply.code(404).send({ error: 'ASTRAGIT_MODEL_CONNECTION_NOT_FOUND', message: '模型连接不存在。' });
      const modelId = typeof request.body?.modelId === 'string' ? request.body.modelId.trim() : '';
      if (!modelId || connection.models.some((model) => model.id === modelId)) {
        return reply.code(400).send({ error: 'ASTRAGIT_MODEL_ID_INVALID', message: modelId ? '该模型已存在。' : '请输入模型 ID。' });
      }
      const model = createManualModel(modelId, connection);
      const updated = await modelConnections.update(connection.id, { ...connection, models: [...connection.models, model] });
      return { ...updated, apiKey: undefined };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // —— Codex 账户 ——
  server.get('/api/codex/account', async () => {
    if (!codexAppServerManager) return { available: false, signedIn: false, code: 'ASTRAGIT_CODEX_DISABLED', message: 'Codex 尚未启用。' };
    try {
      const capabilities = await codexAppServerManager.ensureReady({
        commandPath: options.currentCodexRuntimeCommandPath?.() ?? '',
        ...(options.codexExternalAgentHome ? { externalAgentHome: options.codexExternalAgentHome } : {}),
      });
      const account = await codexAppServerManager.readAccount();
      return { available: true, signedIn: account.signedIn, requiresOpenaiAuth: account.requiresOpenaiAuth, modelCount: capabilities.models.length, codexHome };
    } catch (error) {
      return { available: true, signedIn: false, message: error instanceof Error ? error.message : 'Codex 不可用。', codexHome };
    }
  });

  server.post('/api/codex/account/login/chatgpt', async (_request, reply) => {
    if (!codexAppServerManager) return reply.code(409).send({ error: 'ASTRAGIT_CODEX_DISABLED', message: 'Codex 尚未启用。' });
    try {
      await codexAppServerManager.ensureReady({
        commandPath: options.currentCodexRuntimeCommandPath?.() ?? '',
        ...(options.codexExternalAgentHome ? { externalAgentHome: options.codexExternalAgentHome } : {}),
      });
      const result = await codexAppServerManager.startChatGptLogin();
      return result;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.get('/api/codex/account/login/chatgpt/status', async (request: FastifyRequest<{ Querystring: { generationId?: string; loginId?: string } }>, reply) => {
    if (!codexAppServerManager) return reply.code(409).send({ error: 'ASTRAGIT_CODEX_DISABLED', message: 'Codex 尚未启用。' });
    if (!request.query.generationId || !request.query.loginId) return reply.code(400).send({ error: 'ASTRAGIT_CODEX_LOGIN_ID_REQUIRED', message: '登录身份无效。' });
    try {
      return await codexAppServerManager.readChatGptLoginStatus({ generationId: request.query.generationId, loginId: request.query.loginId });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // —— AI commit ——
  server.get('/api/projects/:projectId/git/commit-models', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    if (!projects.getById(request.params.projectId)) return reply.code(404).send({ error: 'ASTRAGIT_PROJECT_NOT_FOUND', message: '项目不存在。' });
    const items = (await modelConnections.listSelectableModels())
      .filter((model: SelectableConnectionModel) => model.available && model.enabled && model.runtimeAdapter === 'http')
      .map((model: SelectableConnectionModel) => ({ id: model.id, label: `${model.sourceName} · ${model.displayName}` }));
    let warning = '';
    try {
      if (!codexNativeEnabled || !codexAppServerManager) throw new Error('Codex 尚未启用。');
      const commandPath = options.currentCodexRuntimeCommandPath?.() ?? '';
      const capabilities = await codexAppServerManager.ensureReady({
        commandPath,
        ...(options.codexExternalAgentHome ? { externalAgentHome: options.codexExternalAgentHome } : {}),
      });
      const account = await codexAppServerManager.readAccount();
      if (!account.signedIn && account.requiresOpenaiAuth) throw new Error('请先登录 Codex，再刷新模型列表。');
      items.push(
        ...capabilities.models
          .filter((model: CodexModelCapability) => model.raw.hidden !== true)
          .map((model: CodexModelCapability) => ({ id: `codex:${model.model}`, label: `Codex · ${model.displayName || model.model}` })),
      );
    } catch (error) {
      warning = redactSensitiveText(error instanceof Error ? error.message : 'Codex 模型加载失败。').text;
    }
    if (codexNativeEnabled && items.some((item) => item.id.startsWith('codex:'))) {
      const commandPath = options.currentCodexRuntimeCommandPath?.() ?? '';
      void commitCodexPool.warm({ commandPath, codexHome, ...(options.codexExternalAgentHome ? { externalAgentHome: options.codexExternalAgentHome } : {}) }).catch(() => {
        console.info(JSON.stringify({ event: 'git_commit_prewarm_failed' }));
      });
    }
    return { items, warning };
  });

  registerCommitSelectionRoutes(server, workbench);

  server.post(
    '/api/projects/:projectId/git/commit-message',
    { bodyLimit: 512_000 },
    async (request: FastifyRequest<{ Params: { projectId: string }; Body: { repositoryId?: unknown; relativePath?: unknown; language?: unknown; modelRef?: unknown; stream?: boolean; selection?: unknown; selectionMode?: unknown } }>, reply) => {
      const project = projects.getById(request.params.projectId);
      if (!project) return reply.code(404).send({ error: 'ASTRAGIT_PROJECT_NOT_FOUND', message: '项目不存在。' });
      const body = request.body;
      if (
        typeof body?.repositoryId !== 'string' ||
        (body.selectionMode !== undefined && body.selectionMode !== 'worktree' && body.selectionMode !== 'staged') ||
        body.repositoryId.length > 200 ||
        (body.relativePath !== undefined && (typeof body.relativePath !== 'string' || body.relativePath.length > 4096)) ||
        (body.modelRef !== undefined && (typeof body.modelRef !== 'string' || !body.modelRef.trim() || body.modelRef.length > 2000))
      ) {
        return reply.code(400).send({ error: 'ASTRAGIT_COMMIT_MESSAGE_INPUT_INVALID', message: '已暂存改动内容无效或过大，请缩小提交范围。' });
      }
      if (typeof body.repositoryId === 'string' && body.repositoryId.startsWith('conversation:')) {
        return reply.code(400).send({ error: 'ASTRAGIT_COMMIT_MESSAGE_INPUT_INVALID', message: '独立应用不支持会话工作树。' });
      }
      type CommitSelection = { repositoryId: string; relativePath: string; paths: string[] };
      const validSelection = (value: unknown): value is CommitSelection => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const item = value as Record<string, unknown>;
        return (
          typeof item.repositoryId === 'string' &&
          item.repositoryId.length > 0 &&
          item.repositoryId.length <= 200 &&
          typeof item.relativePath === 'string' &&
          item.relativePath.length > 0 &&
          item.relativePath.length <= 4096 &&
          Array.isArray(item.paths) &&
          item.paths.length > 0 &&
          item.paths.length <= 2000 &&
          item.paths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 4096)
        );
      };
      if (
        body.selection !== undefined &&
        (!Array.isArray(body.selection) ||
          !body.selection.length ||
          body.selection.length > 20 ||
          !body.selection.every(validSelection) ||
          body.selection.reduce((count, item) => count + item.paths.length, 0) > 2000 ||
          new Set(body.selection.map((item) => item.repositoryId)).size !== body.selection.length)
      ) {
        return reply.code(400).send({ error: 'ASTRAGIT_COMMIT_MESSAGE_INPUT_INVALID', message: '所选提交范围无效或过大，请重新选择。' });
      }
      const selection = body.selection as CommitSelection[] | undefined;
      const selectionMode = body.selectionMode === 'staged' ? 'staged' : 'worktree';
      const controller = new AbortController();
      const stream = body.stream === true ? new PassThrough() : null;
      const disconnected = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.on('close', disconnected);
      const emit = (event: unknown) => {
        if (stream && !stream.destroyed && !controller.signal.aborted) stream.write(`${JSON.stringify(event)}\n`);
      };
      const generate = async () => {
        const targets: Array<{ repositoryId: string; relativePath?: string; paths?: string[] }> = selection ?? [
          { repositoryId: body.repositoryId as string, ...(typeof body.relativePath === 'string' ? { relativePath: body.relativePath } : {}) },
        ];
        const contexts = await Promise.all(
          targets.map(async (target) => {
            const repository = await workbench.resolveCommitTarget(project.id, target.repositoryId, target.relativePath);
            return { repositoryId: target.repositoryId, repository, context: await readGitCommitContext(repository.localPath, target.paths, selectionMode), paths: target.paths };
          }),
        );
        controller.signal.throwIfAborted();
        const multiple = contexts.length > 1;
        const budget = Math.floor(40_000 / contexts.length);
        const input: GitCommitMessageInput = {
          repositoryName: contexts.map(({ repository }) => repository.name).join(', '),
          stagedDiff: redactSensitiveText(
            contexts
              .map(({ repository, context }) => {
                const partial = context.stagedDiff.slice(0, budget);
                const diff = context.stagedDiff.length > budget ? `${partial.slice(0, partial.lastIndexOf('\n') + 1)}\n[此仓库其余逐行内容已截断]` : partial;
                return `${multiple ? `仓库：${repository.name}\n` : ''}${diff}`;
              })
              .join('\n\n'),
          ).text,
          files: contexts.flatMap(({ repository, context }) => context.files.map((file) => (multiple ? `${repository.name}/${file}` : file))),
          diffStat: redactSensitiveText(contexts.map(({ repository, context }) => `${multiple ? `仓库：${repository.name}\n` : ''}${context.diffStat.slice(0, Math.floor(20_000 / contexts.length))}`).join('\n')).text,
          recentCommits: contexts.flatMap(({ context }) => context.recentCommits.slice(0, Math.max(1, Math.floor(20 / contexts.length)))).map((message) => redactSensitiveText(message).text),
          truncated: contexts.some(({ context }) => context.truncated || context.stagedDiff.length > budget),
          language: body.language === 'en' ? ('en' as const) : ('zh-CN' as const),
          ...(selection ? { scope: 'selection' as const, selectionMode } : {}),
          ...(typeof body.modelRef === 'string' ? { modelRef: body.modelRef } : {}),
        };
        const run = async () => {
          if (input.modelRef?.startsWith('codex:')) {
            if (!codexNativeEnabled) throw new Error('Codex 尚未启用。');
            return await commitCodexPool.generate(input, {
              commandPath: options.currentCodexRuntimeCommandPath?.() ?? '',
              codexHome,
              ...(options.codexExternalAgentHome ? { externalAgentHome: options.codexExternalAgentHome } : {}),
              signal: controller.signal,
              onText: (text) => emit({ type: 'text', text }),
            });
          }
          return await generateGitCommitMessage(modelConnections, project.id, input, controller.signal, options.fetch);
        };
        const result = await run();
        const fingerprints = await Promise.all(contexts.map(({ repository, paths }) => readCommitFingerprint(repository.localPath, paths, selectionMode)));
        if (contexts.some(({ context }, index) => context.fingerprint !== fingerprints[index])) throw new Error(selection ? '生成期间所选内容已变化，请重新生成。' : '生成期间暂存内容已变化，请重新生成。');
        controller.signal.throwIfAborted();
        return { ...result, truncated: input.truncated, fingerprints: Object.fromEntries(contexts.map(({ repositoryId, context }) => [repositoryId, context.fingerprint])) };
      };
      if (stream) {
        reply.type('application/x-ndjson').header('Cache-Control', 'no-store');
        void generate()
          .then(
            (result) => emit({ type: 'result', ...result }),
            (error: unknown) => {
              emit({ type: 'error', message: error instanceof Error ? error.message : 'AI 生成失败。' });
            },
          )
          .finally(() => {
            stream.end();
            reply.raw.off('close', disconnected);
          });
        return reply.send(stream);
      }
      try {
        return await generate();
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
        return reply.code(status).send({ error: 'ASTRAGIT_COMMIT_MESSAGE_FAILED', message: error instanceof Error ? error.message : 'AI 生成失败。' });
      } finally {
        reply.raw.off('close', disconnected);
      }
    },
  );

  server.get('/api/health', async () => ({ ok: true, service: 'astragit' }));

  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  try {
    await server.listen({ host, port });
  } catch (error) {
    try {
      await server.close();
    } finally {
      await db.close();
    }
    throw error;
  }
  const address = server.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;

  return {
    server,
    baseUrl,
    apiToken: options.apiToken,
    projects,
    hasActiveRepositorySetup: () => repositorySetup.isBusy(),
    resolveGitFileLocation: (projectId, repositoryId, path, intent) => workbench.resolveFileLocation(projectId, repositoryId, path, intent),
    writeGitArchive: (projectId, repositoryId, input, output, signal) => workbench.writeArchive(projectId, repositoryId, input, output, signal),
    previewGitArchive: (projectId, repositoryId, input, signal) => workbench.loadArchivePreview(projectId, repositoryId, input, signal),
    async close() {
      try {
        await server.close();
      } finally {
        await db.close();
      }
    },
  };
}

function sendError(reply: FastifyReply, error: unknown): unknown {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'ASTRAGIT_SERVER_ERROR';
  const message = error instanceof Error ? error.message : '请求失败。';
  return reply.code(status).send({ error: code, message, ...gitFailureDiagnostics(error) });
}

export type { GitAppProject, ProjectGitWorkbenchSnapshot, ProjectGitActionResponse };
export { ProjectStore, stableRepositoryId };
