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
import { GitCommandApplication } from './gitCommandApplication.js';
import { registerGitCommandRoutes } from './gitCommandRoutes.js';
import { createManualModel, createModelConnectionService } from './modelConnectionService.js';
import { createMacOSKeychainStore, createFileSecretStore, type SecretStore } from './securityCore.js';
import { ProjectStore, type GitAppProject } from './projectStore.js';
import { ProjectGitWorkbenchService, stableRepositoryId, type ProjectGitActionResponse, type ProjectGitWorkbenchSnapshot } from './projectGitWorkbenchService.js';
import { generateGitCommitMessage } from './gitCommitMessageGeneration.js';
import { createCommitCodexPool } from './gitCommitCodexGeneration.js';
import { readGitCommitContext, readCommitFingerprint } from './gitCommitContext.js';
import { sendNativeQueryRouteError } from './nativeQueryRouteError.js';
import { OperationHistoryStore } from './operationHistoryStore.js';
import { registerCommitSelectionRoutes } from './gitCommitSelectionRoutes.js';


export interface StartGitServerOptions {
  dataDirectory: string;
  projectRoot: string;
  host?: string;
  port?: number;
  apiToken: string;
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
  close(): Promise<void>;
}

export async function startGitServer(options: StartGitServerOptions): Promise<RunningGitServer> {
  const dataDirectory = options.dataDirectory;
  const projects = new ProjectStore(dataDirectory);
  const db = await createAstraGitDatabase(join(dataDirectory, 'git-app.db'));
  const settings = new SettingRepository(db);
  const auditLogs = new AuditLogRepository(db);
  const deliveries = new CommandDeliveryRepository(db);
  const artifacts = new ArtifactStore(db, join(dataDirectory, 'artifacts', 'content-addressed'), () => new Date().toISOString(), { writeFaultReporter: db });
  await artifacts.initialize();
  let secretStore = options.secretStore;
  if (!secretStore) {
    try {
      secretStore = createMacOSKeychainStore({ service: 'AstraGit' });
      await secretStore.getSecret('probe');
    } catch {
      secretStore = createFileSecretStore(join(dataDirectory, 'secrets.json'));
    }
  }
  const modelConnections = createModelConnectionService({
    settings,
    secretStore,
    save: () => db.save(),
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
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) applyCors(request, reply);
    return payload;
  });
  server.addHook('onClose', async () => {
    const results = await Promise.allSettled([commitCodexPool.close(), codexAppServerManager?.close()]);
    const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, 'AstraGit AI 服务关闭失败。');
  });

  // —— 项目 CRUD ——
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

  // —— 工作台查询 ——
  server.get('/api/projects/:projectId/git/workbench', async (request: FastifyRequest<{ Params: { projectId: string } }>, reply) => {
    try {
      return await workbench.loadWorkbench(request.params.projectId);
    } catch (error) {
      return sendNativeQueryRouteError(reply, error);
    }
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

  server.post('/api/projects/:projectId/git/workbench/repositories/:repositoryId/actions', async (request: FastifyRequest<{ Params: { projectId: string; repositoryId: string }; Body: unknown }>, reply) => {
    try {
      const body = request.body as { input?: unknown } | undefined;
      const input = body && typeof body === 'object' && 'input' in body ? body.input : body;
      return await workbench.execute(request.params.projectId, request.params.repositoryId, input);
    } catch (error) {
      return sendError(reply, error);
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
    if (!codexAppServerManager) return { available: false, signedIn: false, message: 'Codex 尚未启用。' };
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
        const input = {
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
          ...(selection ? { scope: 'selection' as const } : {}),
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
          return await generateGitCommitMessage(modelConnections, project.id, input, controller.signal);
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
  return reply.code(status).send({ error: code, message });
}

export type { GitAppProject, ProjectGitWorkbenchSnapshot, ProjectGitActionResponse };
export { ProjectStore, stableRepositoryId };
