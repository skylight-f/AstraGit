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
import { createTemplateConfiguredModelDefinition, listSelectableConnectionModels } from '../packages/ai-runtime/dist/index.js';

const execFileAsync = promisify(execFile);

test('text generation models remain selectable without tool-call support', () => {
  const model = createTemplateConfiguredModelDefinition('text-only', { templateId: 'custom', baseUrl: 'https://model.example/v1' });
  model.capability.tools.state = 'unsupported';
  const [choice] = listSelectableConnectionModels([{ id: 'connection', name: 'Text model', enabled: true, apiKeyConfigured: true, models: [model] }]);
  assert.equal(choice.available, true);
  assert.equal(choice.runtimeAdapter, 'http');
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
  modelServer = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer test-key-astragit') {
      response.writeHead(401).end('{}');
      return;
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
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
  const modelUrl = `http://127.0.0.1:${modelServer.address().port}/v1`;
  async function start() {
    running = await startGitServer({
      dataDirectory: data, projectRoot: data, apiToken: 'astragit-test-token', codexNativeEnabled: false,
      secretStore: createFileSecretStore(join(data, 'secrets.json')),
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
  const refreshed = await json(`/api/model-connections/${connection.id}/refresh-models`, { method: 'POST' });
  assert.deepEqual(refreshed.addedModelIds, ['test-model']);
  assert.equal(refreshed.connection.models[0].enabled, false);
  await json(`/api/model-connections/${connection.id}`, { method: 'PATCH', body: {
    ...refreshed.connection, models: refreshed.connection.models.map((model) => ({ ...model, enabled: true })),
  } });
  const available = await json(`/api/projects/${project.id}/git/commit-models`);
  assert.equal(available.items.length, 1);
  const stream = await request(`/api/projects/${project.id}/git/commit-message`, { method: 'POST', body: { repositoryId: repo.id, relativePath: repo.relativePath, language: 'zh-CN', modelRef: available.items[0].id, stream: true } });
  const result = stream.trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.type === 'result');
  assert.equal(result?.message, 'docs: 补充独立应用说明', stream);
  assert.match(prompt.stagedDiff, /\+independent app/u);
  assert.deepEqual(prompt.files, ['README.md']);
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
  assert.equal(connections.items[0].models[0].id, 'test-model');
  const manual = await json(`/api/model-connections/${connection.id}/models`, { method: 'POST', body: { modelId: 'manual-model' } });
  assert.equal(manual.models.find((model) => model.id === 'manual-model').enabled, true);
  const operations = await json(`/api/projects/${project.id}/git/operations`);
  assert.deepEqual(operations.items.map((item) => item.action), ['commit', 'stage']);
  assert.ok(operations.items.every((item) => item.status === 'completed'));
  await json(`/api/projects/${project.id}`, { method: 'DELETE' });
  assert.ok((await stat(join(repository, '.git'))).isDirectory());
});
