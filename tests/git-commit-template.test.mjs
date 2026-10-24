import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitCommitTemplate } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd })).stdout.trimEnd();
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-template-'))); const cwd = join(root, 'repository'); await mkdir(cwd);
  const globalFile = join(root, 'global.gitconfig'); const originalGlobal = '[user]\n\tname = Template Reviewer\n\temail = template@astragit.invalid\n'; await writeFile(globalFile, originalGlobal);
  const previous = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = globalFile; process.env.GIT_CONFIG_NOSYSTEM = '1';
  const closers = [];
  t.after(async () => { for (const close of closers) await close(); if (previous.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous.global; if (previous.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = previous.system; await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '-b', 'main'); await git(cwd, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'keep.txt'), 'original contents\n'); await git(cwd, 'add', 'keep.txt'); await git(cwd, 'commit', '-m', 'fixture');
  await writeFile(join(cwd, 'keep.txt'), 'local contents\n');
  return { root, cwd, globalFile, originalGlobal, closers, change: async (operation, value) => executeProjectGitAction(cwd, { type: 'configure_commit_template', operation, ...(value === undefined ? {} : { value }), expectedFingerprint: (await getProjectGitCommitTemplate(cwd)).fingerprint }) };
}

test('templates read effective local, global and included paths, preserve full preview and use Git comment rules', async t => {
  const f = await fixture(t); const path = join(f.root, 'global message.txt'); const content = 'feat: template subject\n\n# Instructions stay visible in settings\n\nDetails\n'; await writeFile(path, content);
  const objects = await readdir(join(f.cwd, '.git/objects')); const index = await readFile(join(f.cwd, '.git/index')); const head = await git(f.cwd, 'rev-parse', 'HEAD');
  assert.equal((await getProjectGitCommitTemplate(f.cwd)).source, 'none');
  await exec('git', ['config', '--file', f.globalFile, 'commit.template', path]);
  const inherited = await getProjectGitCommitTemplate(f.cwd); assert.equal(inherited.source, 'inherited'); assert.equal(inherited.content, content); assert.equal(inherited.message, 'feat: template subject\n\nDetails\n');
  const local = join(f.cwd, 'local message.txt'); await writeFile(local, 'fix: 本地模板\n; 本地说明\n# literal heading\n'); await git(f.cwd, 'config', 'core.commentChar', ';');
  await f.change('file', 'local message.txt'); const value = await getProjectGitCommitTemplate(f.cwd); assert.equal(value.source, 'local'); assert.equal(value.resolvedPath, local); assert.equal(value.message, 'fix: 本地模板\n# literal heading\n');
  assert.equal(await git(f.cwd, 'rev-parse', 'HEAD'), head); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.deepEqual(await readdir(join(f.cwd, '.git/objects')), objects); assert.equal(await readFile(join(f.cwd, 'keep.txt'), 'utf8'), 'local contents\n');
  const included = join(f.root, 'include.gitconfig'); await writeFile(included, '[commit]\n\ttemplate = '+path+'\n'); await git(f.cwd, 'config', '--unset-all', 'commit.template'); await git(f.cwd, 'config', 'include.path', included); assert.equal((await getProjectGitCommitTemplate(f.cwd)).source, 'inherited');
});

test('editing creates immutable repository templates while restoring inheritance leaves original files and global config untouched', async t => {
  const f = await fixture(t); const original = join(f.root, 'shared-template.txt'); await writeFile(original, 'Original shared template\n'); await exec('git', ['config', '--file', f.globalFile, 'commit.template', original]); const global = await readFile(f.globalFile);
  await f.change('content', 'feat: managed template\n\n# Guidance\n'); const first = await getProjectGitCommitTemplate(f.cwd); assert.equal(first.content, 'feat: managed template\n\n# Guidance\n'); assert.ok(first.resolvedPath.startsWith(join(f.cwd, '.git/astragit-commit-templates')+'/'));
  await f.change('content', 'fix: second version\n'); const second = await getProjectGitCommitTemplate(f.cwd); assert.notEqual(first.resolvedPath, second.resolvedPath); assert.equal(await readFile(first.resolvedPath, 'utf8'), first.content);
  await f.change('content', ''); const empty = await getProjectGitCommitTemplate(f.cwd); assert.equal(empty.source, 'local'); assert.equal(empty.content, ''); assert.equal(empty.message, ''); assert.equal(empty.problem, null);
  await f.change('inherit'); const inherited = await getProjectGitCommitTemplate(f.cwd); assert.equal(inherited.source, 'inherited'); assert.equal(inherited.resolvedPath, original); assert.equal(await readFile(original, 'utf8'), 'Original shared template\n'); assert.deepEqual(await readFile(f.globalFile), global); assert.equal(await git(f.cwd, 'status', '--porcelain'), ' M keep.txt');
});

test('changed file bytes or configuration invalidate template confirmation before any managed file or config write', async t => {
  const f = await fixture(t); const path = join(f.root, 'message.txt'); await writeFile(path, 'first\n'); await git(f.cwd, 'config', 'commit.template', path); const initial = await getProjectGitCommitTemplate(f.cwd); const config = await readFile(join(f.cwd, '.git/config'));
  await writeFile(path, 'changed\n'); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'configure_commit_template', operation: 'content', value: 'replacement', expectedFingerprint: initial.fingerprint }), error => error.code === 'ASTRAGIT_GIT_TEMPLATE_STALE' && error.operationStatus === 'failed_before_write');
  assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.equal(await readFile(path, 'utf8'), 'changed\n'); assert.ok(!(await readdir(join(f.cwd, '.git'))).includes('astragit-commit-templates'));
  const next = await getProjectGitCommitTemplate(f.cwd); await git(f.cwd, 'config', 'user.name', 'Other identity'); await assert.rejects(() => executeProjectGitAction(f.cwd, { type: 'configure_commit_template', operation: 'inherit', expectedFingerprint: next.fingerprint }), error => error.code === 'ASTRAGIT_GIT_TEMPLATE_STALE');
});

test('missing, oversized, binary and nonregular templates report explicit problems and cannot become local defaults', async t => {
  const f = await fixture(t); const cases = [['missing', null, 'ASTRAGIT_GIT_TEMPLATE_READ_FAILED'], ['large', 'x'.repeat(30_001), 'ASTRAGIT_GIT_TEMPLATE_TOO_LARGE'], ['binary', Buffer.from([255, 254, 0]), 'ASTRAGIT_GIT_TEMPLATE_INVALID'], ['null-byte', 'subject\0body', 'ASTRAGIT_GIT_TEMPLATE_INVALID']];
  for (const [name, content, code] of cases) {
    const path = join(f.root, name); if (content !== null) await writeFile(path, content); await git(f.cwd, 'config', 'commit.template', path); const broken = await getProjectGitCommitTemplate(f.cwd); assert.equal(broken.problem, code); assert.equal(broken.content, '');
    const config = await readFile(join(f.cwd, '.git/config')); await assert.rejects(() => f.change('file', path), error => error.code === code); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config);
  }
  await assert.rejects(() => f.change('file', f.root), error => error.code === 'ASTRAGIT_GIT_TEMPLATE_INVALID');
  const fifo = join(f.root, 'template-pipe'); await exec('mkfifo', [fifo]); await assert.rejects(() => f.change('file', fifo), error => error.code === 'ASTRAGIT_GIT_TEMPLATE_INVALID');
  await f.change('content', 'fixed\n'); assert.equal((await getProjectGitCommitTemplate(f.cwd)).message, 'fixed\n');
});

test('managed template directories and files cannot redirect writes through symbolic links', async t => {
  const f = await fixture(t); const outside = join(f.root, 'outside'); await mkdir(outside); await symlink(outside, join(f.cwd, '.git/astragit-commit-templates'));
  await assert.rejects(() => f.change('content', 'new template'), error => error.code === 'ASTRAGIT_GIT_TEMPLATE_INVALID'); assert.deepEqual(await readdir(outside), []); assert.equal((await getProjectGitCommitTemplate(f.cwd)).source, 'none');
});

test('linked worktrees share the repository-local template while relative file reads use their own worktree root', async t => {
  const f = await fixture(t); const other = join(f.root, 'linked'); await git(f.cwd, 'worktree', 'add', '-b', 'linked', other); await writeFile(join(other, 'template.txt'), 'linked root template\n');
  await executeProjectGitAction(other, { type: 'configure_commit_template', operation: 'file', value: 'template.txt', expectedFingerprint: (await getProjectGitCommitTemplate(other)).fingerprint }); assert.equal((await getProjectGitCommitTemplate(other)).message, 'linked root template\n'); assert.equal((await getProjectGitCommitTemplate(f.cwd)).problem, 'ASTRAGIT_GIT_TEMPLATE_READ_FAILED');
  await executeProjectGitAction(other, { type: 'configure_commit_template', operation: 'content', value: 'shared managed template\n', expectedFingerprint: (await getProjectGitCommitTemplate(other)).fingerprint }); const managed = await getProjectGitCommitTemplate(other); assert.equal((await getProjectGitCommitTemplate(f.cwd)).message, managed.message); assert.ok(!relative(join(f.cwd, '.git'), managed.resolvedPath).startsWith('..'));
});

test('HTTP templates are repository-owned read queries and confirmed configuration enters the durable operation log', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'template-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.closers.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Template fixture', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const initial = await client.loadProjectGitCommitTemplate(project.id, repository.id); assert.equal(initial.source, 'none');
  await client.executeProjectGitAction(project.id, repository.id, { type: 'configure_commit_template', operation: 'content', value: 'feat: HTTP template\n# note\n', expectedFingerprint: initial.fingerprint }); const saved = await client.loadProjectGitCommitTemplate(project.id, repository.id); assert.equal(saved.message, 'feat: HTTP template\n'); assert.equal((await client.loadProjectGitOperations(project.id)).items[0].action, 'configure_commit_template');
  await assert.rejects(() => client.loadProjectGitCommitTemplate(project.id, 'other-repository'));
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'configure_commit_template', operation: 'inherit', value: 'unexpected', expectedFingerprint: saved.fingerprint }));
  assert.equal(await readFile(f.globalFile, 'utf8'), f.originalGlobal); assert.equal(await readFile(join(f.cwd, 'keep.txt'), 'utf8'), 'local contents\n');
});
