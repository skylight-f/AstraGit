import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { parseReviewReport } from '../packages/git-server/dist/gitCodeReview.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const execute = promisify(execFile);
const validReport = { summary: 'Review summary', impacts: ['Public API behavior changes.'], findings: [], checks: ['Run integration tests.'] };

test('review output rejects malformed reports and references outside the reviewed scope', () => {
  const scope = [{ repositoryId: 'web', files: ['src/a.ts'] }];
  assert.deepEqual(parseReviewReport(JSON.stringify(validReport), scope), validReport);
  for (const text of ['plain text', '{}', JSON.stringify({ ...validReport, findings: [{ severity: 'high', repositoryId: 'other', path: '../secret', title: 'Issue', detail: 'Evidence', suggestion: 'Fix' }] }), JSON.stringify({ ...validReport, impacts: [''] })]) assert.throws(() => parseReviewReport(text, scope), /格式或文件定位无效/u);
  const finding = { severity: 'medium', repositoryId: 'web', path: 'src/a.ts', line: 3, title: 'Issue', detail: 'Evidence and trigger', suggestion: 'Fix' };
  assert.equal(parseReviewReport(JSON.stringify({ ...validReport, findings: [finding] }), scope).findings[0].line, 3);
});

test('real review API covers project repositories, staged/worktree modes, stale reports, cancellation and read-only Git', async t => {
  const root = await mkdtemp(join(tmpdir(), 'astragit-code-review-'));
  let server;
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }); });
  const workspace = join(root, 'workspace'); const data = join(root, 'data');
  const fixtures = [];
  for (const name of ['web', 'core', 'clean']) {
    const path = join(workspace, name); await mkdir(path, { recursive: true });
    const git = async (...args) => (await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: path })).stdout.trim();
    await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Review Fixture'); await git('config', 'user.email', 'review@astragit.invalid');
    await writeFile(join(path, 'code.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'baseline');
    if (name !== 'clean') { await writeFile(join(path, 'code.ts'), `export const value = 2; // ${name} staged\n`); await git('add', '.'); await writeFile(join(path, 'code.ts'), `export const value = 3; // ${name} worktree\n`); await writeFile(join(path, 'new.ts'), `// ${name} untracked\n`); }
    fixtures.push({ name, path, git, head: await git('rev-parse', 'HEAD'), index: await readFile(join(path, '.git/index')) });
  }
  const calls = []; let behavior = 'normal'; let started; let cancelled;
  server = await startGitServer({ dataDirectory: data, projectRoot: workspace, apiToken: 'review-fixture', codexNativeEnabled: false, secretStore: createFileSecretStore(join(data, 'secrets.json')), fetch: async (_url, init) => {
    const body = JSON.parse(init.body); const payload = JSON.parse(body.messages[1].content); calls.push({ body, payload });
    if (behavior === 'new-file') await writeFile(join(fixtures[0].path, 'appeared.ts'), '// appeared during review\n');
    if (behavior === 'edit') await writeFile(join(fixtures[0].path, 'code.ts'), 'export const changed = true;\n');
    if (behavior === 'cancel') { started(); await new Promise((_, reject) => { const abort = () => { cancelled(); reject(new Error('aborted')); }; if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); }); }
    if (behavior === 'provider') return new Response('sensitive-provider-body', { status: 401 });
    const content = behavior === 'invalid' ? 'not a report' : JSON.stringify({ ...validReport, findings: [{ severity: 'medium', repositoryId: payload.repositories[0].repositoryId, path: 'code.ts', line: 1, title: 'Changed constant', detail: 'Fixture finding with evidence.', suggestion: 'Verify consumers.' }] });
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  } });
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ localPath: workspace });
  const connection = await client.createModelConnection({ name: 'Review fixture', templateId: 'custom', baseUrl: 'https://review.astragit.invalid/v1', apiKey: 'fixture-only' });
  await client.addManualModel(connection.id, 'fixture-model');
  const modelRef = (await client.loadGitCommitModels(project.id)).items[0].id;
  const input = { mode: 'worktree', language: 'en', modelRef };
  const before = await client.loadCodeReviewScope(project.id, input);
  assert.equal(before.repositories.length, 3); assert.equal(before.fileCount, 4); assert.equal(calls.length, 0);
  const report = await client.reviewProjectCode(project.id, input);
  assert.equal(report.fileCount, 4); assert.equal(report.fingerprint, before.fingerprint); assert.equal(report.findings.length, 1);
  assert.equal(calls[0].payload.repositories.length, 2); assert.match(calls[0].payload.repositories.map(repo => repo.diff).join('\n'), /web worktree[\s\S]*web untracked|web untracked[\s\S]*web worktree/u);
  const webId = before.repositories.find(repo => repo.name === 'web').id;
  await client.reviewProjectCode(project.id, { ...input, repositoryId: webId, mode: 'staged' });
  assert.equal(calls[1].payload.repositories.length, 1); assert.match(calls[1].payload.repositories[0].diff, /web staged/u); assert.doesNotMatch(calls[1].payload.repositories[0].diff, /worktree|untracked/u);
  const cleanId = before.repositories.find(repo => repo.name === 'clean').id;
  const count = calls.length;
  await assert.rejects(() => client.reviewProjectCode(project.id, { ...input, repositoryId: cleanId }), /没有可评审/u); assert.equal(calls.length, count);
  behavior = 'new-file'; await assert.rejects(() => client.reviewProjectCode(project.id, input), /评审期间代码或范围已变化/u);
  const after = await client.loadCodeReviewScope(project.id, input); assert.notEqual(after.fingerprint, report.fingerprint); assert.equal(after.fileCount, 5);
  behavior = 'edit'; await assert.rejects(() => client.reviewProjectCode(project.id, input), /评审期间代码或范围已变化/u);
  behavior = 'invalid'; await assert.rejects(() => client.reviewProjectCode(project.id, input), /格式或文件定位无效/u);
  behavior = 'provider'; await assert.rejects(() => client.reviewProjectCode(project.id, input), error => { assert.match(error.message, /HTTP 401/u); assert.doesNotMatch(error.message, /sensitive-provider-body/u); return true; });
  behavior = 'cancel';
  let resolveStarted; const didStart = new Promise(resolve => { resolveStarted = resolve; }); started = resolveStarted;
  let resolveCancelled; const didCancel = new Promise(resolve => { resolveCancelled = resolve; }); cancelled = resolveCancelled;
  const controller = new AbortController(); const pending = client.reviewProjectCode(project.id, input, controller.signal); const rejected = assert.rejects(pending, /abort/u);
  await didStart; controller.abort(); await rejected;
  let cancellationTimer;
  try { await Promise.race([didCancel, new Promise((_, reject) => { cancellationTimer = setTimeout(() => reject(new Error('Provider cancellation exceeded 3 seconds')), 3000); })]); }
  finally { clearTimeout(cancellationTimer); }
  for (const repo of fixtures) { assert.equal(await repo.git('rev-parse', 'HEAD'), repo.head); assert.deepEqual(await readFile(join(repo.path, '.git/index')), repo.index); }
});
