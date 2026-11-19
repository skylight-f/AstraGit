import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createTemplateConfiguredModelDefinition, listSelectableConnectionModels, normalizeStoredModelConnections } from '../packages/ai-runtime/dist/index.js';

const execFileAsync = promisify(execFile);

test('text generation models remain selectable without tool-call support', () => {
  const model = createTemplateConfiguredModelDefinition('text-only', { templateId: 'custom', baseUrl: 'https://model.example/v1' });
  model.capability.tools.state = 'unsupported';
  const [choice] = listSelectableConnectionModels([{ id: 'connection', name: 'Text model', enabled: true, apiKeyConfigured: true, models: [model] }]);
  assert.equal(choice.available, true);
  assert.equal(choice.runtimeAdapter, 'http');
});

test('legacy mixed protocols are preserved until a provider protocol is selected', () => {
  const route = { templateId: 'custom', baseUrl: 'https://model.example/v1' };
  const models = [
    createTemplateConfiguredModelDefinition('chat', route),
    { ...createTemplateConfiguredModelDefinition('messages', route), protocolFamily: 'anthropic_messages', authenticationScheme: 'x_api_key', enabled: false },
  ];
  const [legacy] = normalizeStoredModelConnections([{ id: 'legacy', name: 'Legacy provider', ...route, models }]);
  assert.equal(legacy.protocolFamily, undefined);
  assert.deepEqual(legacy.models.map(model => model.protocolFamily), ['openai_completions', 'anthropic_messages']);
  const [updated] = normalizeStoredModelConnections([{ ...legacy, protocolFamily: 'openai_responses' }]);
  assert.deepEqual(updated.models.map(model => model.protocolFamily), ['openai_responses', 'openai_responses']);
  assert.equal(updated.models[1].authenticationScheme, 'protocol_default');
  assert.equal(updated.models[1].enabled, false);
});

test('isolated application stages changes, generates a draft, commits and restores local state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-app-'));
  const repository = join(root, 'repository');
  const data = join(root, 'app-data');
  let running;
  let modelServer;
  t.after(async () => {
    try {
      await running?.close();
      if (modelServer?.listening) await new Promise((resolve, reject) => modelServer.close((error) => error ? reject(error) : resolve()));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await mkdir(repository);
  const git = (...args) => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repository });
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'AstraGit Test');
  await git('config', 'user.email', 'test@astragit.invalid');
  await writeFile(join(repository, 'README.md'), 'first version\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'docs: initial version');
  const originalHead = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(repository, 'README.md'), 'first version\nindependent app\n');

  let prompt;
  const modelIds = ['test-model'];
  modelServer = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer test-key-astragit') {
      response.writeHead(401).end('{}');
      return;
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: modelIds.map(id => ({ id })) }));
      return;
    }
    if (request.url === '/v1/responses') {
      response.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'docs: Responses 接口测试' }] }] }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      prompt = JSON.parse(body.messages[1].content);
      response.end(JSON.stringify({ choices: [{ message: { content: 'docs: 补充独立应用说明' }, finish_reason: 'stop' }] }));
      return;
    }
    response.writeHead(404).end('{}');
  });
  await new Promise((resolve, reject) => { modelServer.once('error', reject); modelServer.listen(0, '127.0.0.1', resolve); });
  const modelOrigin = `http://127.0.0.1:${modelServer.address().port}`;
  const modelUrl = 'https://models.astragit.invalid/v1';
  const networkRequests = [];
  async function start() {
    running = await startGitServer({
      dataDirectory: data, projectRoot: data, apiToken: 'astragit-test-token', codexNativeEnabled: false,
      secretStore: createFileSecretStore(join(data, 'secrets.json')),
      fetch: async (input, init) => {
        const url = new URL(input);
        assert.equal(url.hostname, 'models.astragit.invalid');
        networkRequests.push(url.pathname);
        return fetch(`${modelOrigin}${url.pathname}`, init);
      },
    });
  }
  async function request(path, { method = 'GET', body, status = 200 } = {}) {
    const response = await fetch(`${running.baseUrl}${path}`, {
      method, headers: { 'x-astragit-api-token': 'astragit-test-token', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    return text;
  }
  async function json(path, options) { return JSON.parse(await request(path, options)); }

  await start();
  assert.equal((await fetch(`${running.baseUrl}/api/health`)).status, 401);
  assert.deepEqual(await json('/api/health'), { ok: true, service: 'astragit' });
  const project = await json('/api/projects', { method: 'POST', status: 201, body: { localPath: repository, name: 'Independent repository' } });
  const workbench = await json(`/api/projects/${project.id}/git/workbench`);
  const repo = workbench.repositories[0];
  const actions = `/api/projects/${project.id}/git/workbench/repositories/${repo.id}/actions`;
  const staged = await json(actions, { method: 'POST', body: { type: 'stage', paths: ['README.md'] } });
  assert.deepEqual(staged.snapshot.stagedDiff.files, ['README.md']);
  const connection = await json('/api/model-connections', { method: 'POST', status: 201, body: { name: 'Local mock', baseUrl: modelUrl, templateId: 'custom', apiKey: 'test-key-astragit', allowInsecureHttp: true } });
  assert.equal(connection.apiKey, undefined);
  const diagnostic = await json(`/api/model-connections/${connection.id}/diagnose`, { method: 'POST' });
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.discoveredModelCount, 1);
  assert.deepEqual((await json('/api/model-connections')).items[0].models, [], 'Testing a connection does not sync the catalog.');
  const refreshed = await json(`/api/model-connections/${connection.id}/refresh-models`, { method: 'POST' });
  assert.deepEqual(refreshed.addedModelIds, ['test-model']);
  assert.equal(refreshed.connection.models[0].enabled, false);
  const enabledConnection = await json(`/api/model-connections/${connection.id}`, { method: 'PATCH', body: {
    ...refreshed.connection, models: refreshed.connection.models.map((model) => ({ ...model, enabled: true })),
  } });
  const available = await json(`/api/projects/${project.id}/git/commit-models`);
  assert.equal(available.items.length, 1);
  assert.equal(available.items[0].sourceId, connection.id);
  assert.equal(available.items[0].sourceName, 'Local mock');
  assert.equal(available.items[0].displayName, 'test-model');
  const stream = await request(`/api/projects/${project.id}/git/commit-message`, { method: 'POST', body: { repositoryId: repo.id, relativePath: repo.relativePath, language: 'zh-CN', modelRef: available.items[0].id, stream: true } });
  const result = stream.trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.type === 'result');
  assert.equal(result?.message, 'docs: 补充独立应用说明', stream);
  assert.deepEqual(networkRequests, ['/v1/models', '/v1/models', '/v1/chat/completions'], 'Connection tests, catalog sync and draft generation must use the host network adapter.');
  assert.match(prompt.stagedDiff, /\+independent app/u);
  assert.deepEqual(prompt.files, ['README.md']);
  const switched = await json(`/api/model-connections/${connection.id}`, { method: 'PATCH', body: { ...enabledConnection, baseUrl: `${modelUrl}/chat/completions`, protocolFamily: 'openai_responses' } });
  assert.equal(switched.models[0].protocolFamily, 'openai_responses');
  assert.equal(switched.models[0].enabled, true);
  const responses = await json(`/api/projects/${project.id}/git/commit-message`, { method: 'POST', body: { repositoryId: repo.id, relativePath: repo.relativePath, language: 'zh-CN', modelRef: available.items[0].id } });
  assert.equal(responses.message, 'docs: Responses 接口测试');
  assert.equal(networkRequests.at(-1), '/v1/responses');
  modelIds.push('discovered-after-switch');
  const synced = await json(`/api/model-connections/${connection.id}/refresh-models`, { method: 'POST' });
  assert.deepEqual(synced.addedModelIds, ['discovered-after-switch']);
  assert.equal(synced.connection.models.find(model => model.id === 'discovered-after-switch').protocolFamily, 'openai_responses');
  assert.equal((await git('rev-parse', 'HEAD')).stdout.trim(), originalHead, 'Draft generation must not commit.');
  const committed = await json(actions, { method: 'POST', body: { type: 'commit', message: result.message, expectedHeadSha: originalHead, expectedBranch: 'main' } });
  assert.equal(committed.snapshot.clean, true);
  assert.equal((await git('log', '-1', '--format=%s')).stdout.trim(), result.message);
  assert.equal((await readFile(join(data, 'git-app.db'))).includes(Buffer.from('test-key-astragit')), false);
  await running.close();
  running = undefined;
  await start();
  assert.equal((await json('/api/projects'))[0].id, project.id);
  const connections = await json('/api/model-connections');
  assert.equal(connections.items[0].apiKeyConfigured, true);
  assert.equal(connections.items[0].protocolFamily, 'openai_responses');
  assert.equal(connections.items[0].models[0].id, 'test-model');
  const edited = await json(`/api/model-connections/${connection.id}`, { method: 'PATCH', body: { ...connections.items[0], name: 'Edited connection', baseUrl: 'https://models.astragit.invalid/v2' } });
  assert.equal(edited.apiKeyConfigured, true);
  assert.equal(edited.models[0].enabled, true);
  assert.equal(edited.baseUrl, 'https://models.astragit.invalid/v2');
  const manual = await json(`/api/model-connections/${connection.id}/models`, { method: 'POST', body: { modelId: 'manual-model' } });
  const manualModel = manual.models.find(model => model.id === 'manual-model');
  assert.equal(manualModel.enabled, true);
  assert.equal(manualModel.protocolFamily, 'openai_responses');
  const configured = await json(`/api/model-connections/${connection.id}/models`, { method: 'POST', body: { modelId: 'manual-responses', displayName: 'Manual Responses', enabled: false } });
  const configuredModel = configured.models.find((model) => model.id === 'manual-responses');
  assert.equal(configuredModel.displayName, 'Manual Responses');
  assert.equal(configuredModel.protocolFamily, 'openai_responses');
  assert.equal(configuredModel.enabled, false);
  const operations = await json(`/api/projects/${project.id}/git/operations`);
  assert.deepEqual(operations.items.map((item) => item.action), ['commit', 'stage']);
  assert.ok(operations.items.every((item) => item.status === 'completed'));
  await json(`/api/projects/${project.id}`, { method: 'DELETE' });
  assert.ok((await stat(join(repository, '.git'))).isDirectory());
});
