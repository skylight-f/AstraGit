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

const execute = promisify(execFile);
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
      return Response.json({ choices: [{ message: { content: 'feat: selected project changes' }, finish_reason: 'stop' }] });
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
  for (const repo of repositories) {
    assert.equal(await repo.git('rev-parse', 'HEAD'), repo.head);
    assert.deepEqual(await readFile(join(repo.path, '.git/index')), repo.index, 'AI must not stage or commit any file.');
  }
});
