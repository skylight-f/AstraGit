import { generateStagedCommitDrafts } from '../apps/desktop/src/renderer/git/generateStagedCommitDrafts.ts';
import { repositoryDraftScope } from '../apps/desktop/src/renderer/git/useGitCommitDrafts.ts';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { loadGitCommitModelOptions, saveDisabledCodexModels } from '../apps/desktop/src/renderer/git/gitCommitModels.ts';

const execute = promisify(execFile);
test('disabled Codex models are filtered and an unavailable remembered model falls back', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const values = new Map([['astragit.commit-model.test-project', 'codex:disabled']]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });
  saveDisabledCodexModels(['codex:disabled']);
  const client = { loadGitCommitModels: async () => ({ items: [
    { id: 'codex:disabled', label: 'Codex · Disabled' },
    { id: 'codex:enabled', label: 'Codex · Enabled' },
    { id: 'provider:model', label: 'Provider · Model' },
  ], warning: '' }) };
  const result = await loadGitCommitModelOptions(client, 'test-project');
  assert.deepEqual(result.items.map(model => model.id), ['codex:enabled', 'provider:model']);
  assert.equal(result.modelRef, 'codex:enabled');
  saveDisabledCodexModels([]);
  assert.equal((await loadGitCommitModelOptions(client, 'test-project')).modelRef, 'codex:disabled');
});

test('AI drafts use the selected mode across project repositories and reject content changed during generation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-ai-selection-'));
  let server;
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, 'workspace'); const data = join(root, 'data');
  const repositories = [];
  for (const name of ['web', 'core']) {
    const path = join(workspace, name); await mkdir(path, { recursive: true });
    const git = async (...args) => (await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: path })).stdout.trim();
    await git('init', '--initial-branch=main'); await git('config', 'user.name', 'AstraGit Test'); await git('config', 'user.email', 'test@astragit.invalid');
    await writeFile(join(path, 'selected.txt'), 'baseline\n'); await writeFile(join(path, 'unchecked.txt'), 'baseline\n');
    await git('add', '.'); await git('commit', '-m', 'test: baseline');
    await writeFile(join(path, 'selected.txt'), `${name} staged\n`); await writeFile(join(path, 'unchecked.txt'), `${name} excluded staged\n`); await git('add', '.');
    await writeFile(join(path, 'selected.txt'), `${name} staged\n${name} later working tree\n`);
    repositories.push({ name, path, git, head: await git('rev-parse', 'HEAD'), index: await readFile(join(path, '.git/index')) });
  }
  const requests = []; let mutate = false;
  server = await startGitServer({ dataDirectory: data, projectRoot: workspace, apiToken: 'ai-scope-fixture', codexNativeEnabled: false,
    secretStore: createFileSecretStore(join(data, 'secrets.json')),
    fetch: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://model.astragit.invalid');
      const body = JSON.parse(init.body); requests.push(body);
      if (mutate) await writeFile(join(repositories[0].path, 'selected.txt'), 'changed during AI request\n');
      return Response.json({ ...(requests.length === 2 ? {} : { usage: { prompt_tokens: 70, completion_tokens: 9 } }), choices: [{ message: { content: 'feat: selected project changes' }, finish_reason: 'stop' }] });
    },
  });
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ localPath: workspace });
  const connection = await client.createModelConnection({ name: 'Fixture', templateId: 'custom', baseUrl: 'https://model.astragit.invalid/v1', apiKey: 'fixture-only' });
  await client.addManualModel(connection.id, 'fixture-model');
  const modelRef = (await client.loadGitCommitModels(project.id)).items[0].id;
  const snapshot = await client.loadProjectGitWorkbench(project.id);
  const selection = snapshot.repositories.map(repo => ({ repositoryId: repo.id, relativePath: repo.relativePath, paths: ['selected.txt'] }));
  const generate = selectionMode => client.generateGitCommitMessage(project.id, { ...selection[0], selection, selectionMode, language: 'en', modelRef });
  const staged = await generate('staged'); assert.equal(Object.keys(staged.fingerprints).length, 2);
  const stagedPrompt = JSON.parse(requests[0].messages[1].content);
  assert.match(stagedPrompt.stagedDiff, /web staged/u); assert.match(stagedPrompt.stagedDiff, /core staged/u);
  assert.doesNotMatch(stagedPrompt.stagedDiff, /later working tree|excluded staged/u);
  assert.match(requests[0].messages[0].content, /所选文件的已暂存改动/u);
  await generate('worktree');
  const worktreePrompt = JSON.parse(requests[1].messages[1].content);
  assert.match(worktreePrompt.stagedDiff, /web later working tree/u); assert.match(worktreePrompt.stagedDiff, /core later working tree/u);
  assert.doesNotMatch(worktreePrompt.stagedDiff, /excluded staged/u);
  mutate = true;
  await assert.rejects(() => generate('worktree'), /生成期间所选内容已变化/u);
  const usage = (await client.loadCommitUsage()).filter(row => row.projectId === project.id && row.providerId === connection.id && row.modelId === 'fixture-model');
  assert.equal(usage.reduce((sum, row) => sum + row.generations, 0), 3);
  assert.equal(usage.reduce((sum, row) => sum + row.reportedGenerations, 0), 2);
  assert.equal(usage.reduce((sum, row) => sum + row.totalTokens, 0), 158);
  for (const repo of repositories) {
    assert.equal(await repo.git('rev-parse', 'HEAD'), repo.head);
    assert.deepEqual(await readFile(join(repo.path, '.git/index')), repo.index, 'AI must not stage or commit any file.');
  }
});

test('batch AI keeps a hand-edited repo message and generates each empty draft from its own index', async () => {
  const units = ['pim', 'web-base', 'eiam'].map(id => ({
    repository: { id, name: id, relativePath: id, snapshot: { branch: 'main', headSha: 'head', indexFingerprint: id } },
    ordinaryPaths: ['partial.txt'], gitlinks: [],
  }));
  const calls = [];
  const client = { async generateGitCommitMessage(_project, request) {
    calls.push(request);
    return { message: request.selection ? 'batch only' : request.repositoryId, truncated: false };
  } };
  const controller = new AbortController();
  const input = { client, projectId: 'project', units, summary: true, drafts: { pim: { message: 'hand edit' } },
    language: 'zh-CN', model: 'model', signal: controller.signal, onText() {} };
  const { messages } = await generateStagedCommitDrafts(input);
  assert.deepEqual(calls.map(call => [call.selectionMode, call.selection?.map(target => target.repositoryId) ?? call.repositoryId]), [
    ['staged', ['pim', 'web-base', 'eiam']], ['staged', 'web-base'], ['staged', 'eiam'],
  ]);
  assert.deepEqual(messages.map(({ id, message }) => [id, message]), [['batch-summary', 'batch only'], ['web-base', 'web-base'], ['eiam', 'eiam']]);
  assert.ok(messages.every(draft => draft.expected === ''));
  await assert.rejects(generateStagedCommitDrafts({ ...input, client: { async generateGitCommitMessage() {
    controller.abort(); return { message: 'incomplete' };
  } } }), { name: 'AbortError' });
  assert.deepEqual(input.drafts, { pim: { message: 'hand edit' } });
});

test('a parent draft records planned submodule updates in both generation modes', async () => {
  const snapshot = { branch: 'main', headSha: 'head', indexFingerprint: 'index' };
  const gitlinks = [{ path: 'apps/pim', repositoryId: 'pim' }];
  const unit = { repository: { id: 'parent', name: 'parent', snapshot }, ordinaryPaths: [], gitlinks };
  const ordinaryScope = repositoryDraftScope(snapshot);
  assert.equal(ordinaryScope, repositoryDraftScope(snapshot, []));
  for (const summary of [false, true]) {
    const { messages } = await generateStagedCommitDrafts({ client: {}, projectId: 'project', units: [unit],
      summary, drafts: {}, language: 'zh-CN', model: 'model', signal: new AbortController().signal, onText() {} });
    const draft = messages.find(message => message.id === 'parent');
    assert.match(draft.message, /apps\/pim/u);
    assert.equal(draft.scope, repositoryDraftScope(snapshot, gitlinks));
    assert.notEqual(draft.scope, ordinaryScope);
  }
});

test('daily commit usage keeps reported zero distinct from unknown and includes Anthropic cache tokens', async () => {
  const { reportedGenerationTokens } = await import('../packages/git-server/dist/gitModelTextGeneration.js');
  assert.equal(reportedGenerationTokens({ input_tokens: 70, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 }, 'anthropic_messages'), 108);
  assert.equal(reportedGenerationTokens({ totalTokens: 0, inputTokens: 2, outputTokens: 1 }, 'codex'), 0);
  assert.equal(reportedGenerationTokens({ prompt_tokens: 200 }, 'openai_completions'), null);
  const { usageCalendarDays } = await import('../apps/desktop/src/renderer/CommitUsageCalendar.tsx');
  const year = usageCalendarDays(new Date(2024, 11, 1));
  assert.equal(year[0].day, '2023-12-02');
  assert.equal(year.at(-1).day, '2024-12-01');
  assert.equal(year.length, 366);
  assert.equal(year.find(day => day.day === '2024-02-29').weekday, 3);
});

test('daily commit usage persists independent dimension totals and usage coverage', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { AstraGitDatabase, CommitUsageStore } = await import('../packages/storage/dist/index.js');
  const { migrateCommitUsage } = await import('../packages/storage/dist/commitUsageStore.js');
  const db = new AstraGitDatabase(new DatabaseSync(':memory:'));
  try {
    db.durableTransactionSync(() => migrateCommitUsage(db));
    const store = new CommitUsageStore(db);
    const project = { id: 'app', name: 'App' };
    const usage = { providerId: 'provider', providerName: 'First', modelId: 'm', modelName: 'Model', totalTokens: 42 };
    const date = new Date(2024, 1, 29, 23, 59);
    store.record(project, usage, date);
    store.record(project, { ...usage, totalTokens: null }, date);
    store.record(project, { ...usage, providerId: 'second' }, date);
    store.record(project, { ...usage, modelId: 'second' }, date);
    store.record({ ...project, id: 'second' }, usage, date);
    store.record(project, usage, new Date(2024, 2, 1));
    const rows = new CommitUsageStore(db).list();
    assert.equal(rows.length, 5);
    const row = rows.find(row => row.day === '2024-02-29' && row.projectId === 'app' && row.providerId === 'provider' && row.modelId === 'm');
    assert.deepEqual([row.generations, row.reportedGenerations, row.totalTokens], [2, 1, 42]);
  } finally { await db.close(); }
});
