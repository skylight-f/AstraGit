import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getGitRepositoryContext, getGitStatus, getGitWorktreeClean } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { describeUserFacingError } from '../packages/shared/src/userFacingError.ts';

const exec = promisify(execFile);
async function fixture(t, name = 'repo', unborn = false) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-state-')); const selected = join(root, name); await mkdir(selected, { recursive: true }); const cwd = await realpath(selected); const global = join(root, 'global'); await writeFile(global, '');
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const rawAt = async (at, ...args) => (await exec('git', args, { cwd: at, env, maxBuffer: 32 * 1024 * 1024 })).stdout;
  const raw = (...args) => rawAt(cwd, ...args); const git = async (...args) => (await raw(...args)).trim();
  const write = async (path, data) => { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), data); };
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'State Test'); await git('config', 'user.email', 'state@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.autocrlf', 'false');
  if (!unborn) { await write('file.txt', 'base\n'); await git('add', '.'); await git('commit', '-qm', 'base'); }
  const action = (value, onCommand, override) => executeProjectGitAction(cwd, value, undefined, { ...env, ...override }, onCommand);
  return { root, cwd, env, raw, rawAt, git, write, action };
}
const code = (expected, inspect = () => {}) => error => { assert.equal(error.code ?? error.error, expected); inspect(error); return true; };

test('repository state distinguishes non-worktrees, missing folders, unborn branches and detached commits', async t => {
  const f = await fixture(t, 'repo', true); const outside = join(f.root, 'outside'); await mkdir(outside);
  assert.equal((await getGitRepositoryContext(outside)).isRepository, false); assert.equal((await getGitStatus(outside)).isRepository, false);
  await assert.rejects(() => getGitRepositoryContext(join(f.root, 'missing')), code('ASTRAGIT_GIT_STATE_LOCATION')); await assert.rejects(() => getGitStatus(join(f.root, 'missing')), code('ASTRAGIT_GIT_STATE_LOCATION'));
  const bare = join(f.root, 'bare'); await exec('git', ['init', '--bare', '-q', bare], { env: f.env }); assert.equal((await getGitRepositoryContext(bare)).isRepository, false);
  let context = await getGitRepositoryContext(f.cwd); assert.equal(context.branch, 'main'); assert.equal(context.detached, false); assert.equal(context.headSha, ''); assert.equal((await getGitStatus(f.cwd)).clean, true);
  await f.write('file.txt', 'base\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'base'); const head = await f.git('rev-parse', 'HEAD'); await f.git('switch', '--detach', head);
  context = await getGitRepositoryContext(f.cwd); assert.equal(context.detached, true); assert.equal(context.headSha, head); assert.equal((await getGitStatus(f.cwd)).branch, 'detached');
});

test('root folders and linked worktrees preserve leading/trailing whitespace and embedded newlines', async t => {
  const f = await fixture(t, ' repo \nline '); await f.git('branch', 'target'); await f.write('file.txt', 'local\n');
  let context = await getGitRepositoryContext(f.cwd); assert.equal(context.topLevel, f.cwd); assert.equal(context.worktrees[0].path, f.cwd); assert.deepEqual((await getGitStatus(f.cwd)).changedFiles, ['file.txt']);
  await f.write('file.txt', 'base\n'); const linked = join(await realpath(f.root), ' linked\nworktree '); await f.git('worktree', 'add', linked, 'target'); await f.git('worktree', 'lock', '--reason', 'lock\nreason', linked);
  context = await getGitRepositoryContext(f.cwd); const entry = context.worktrees.find(entry => entry.path === linked); assert.ok(entry); assert.equal(entry.branch, 'target'); assert.equal(entry.locked, true); assert.equal((await getGitRepositoryContext(linked)).topLevel, linked);
  await f.action({ type: 'checkout', branchName: 'main' }); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'main');
});

test('a corrupt index is a failed state read and prevents checkout before any switch or stash command', async t => {
  const f = await fixture(t); await f.git('branch', 'target'); await f.write('.git/index', 'broken index'); const trace = [];
  assert.equal((await getGitRepositoryContext(f.cwd)).isRepository, true);
  await assert.rejects(() => getGitStatus(f.cwd), code('ASTRAGIT_GIT_INDEX_CORRUPT')); await assert.rejects(() => getGitWorktreeClean(f.cwd), code('ASTRAGIT_GIT_INDEX_CORRUPT'));
  await assert.rejects(() => f.action({ type: 'checkout', branchName: 'target', stashBeforeCheckout: true }, async command => trace.push(command)), code('ASTRAGIT_GIT_INDEX_CORRUPT', error => { assert.equal(error.operationStage, 'preflight'); assert.equal(error.operationStatus, 'failed_before_write'); }));
  assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'main'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'base\n'); assert.equal(trace.some(command => /\bgit (?:switch|checkout|stash)\b/u.test(command)), false);
});

test('unreadable existing refs, missing commit objects, malformed config and broken gitdir files are not empty repositories', async t => {
  const f = await fixture(t); const ref = join(f.cwd, '.git/refs/heads/main'); const originalRef = await readFile(ref);
  await writeFile(ref, 'not-a-reference\n'); await assert.rejects(() => getGitRepositoryContext(f.cwd), code('ASTRAGIT_GIT_STATE_READ_FAILED')); await assert.rejects(() => getGitStatus(f.cwd), code('ASTRAGIT_GIT_STATE_READ_FAILED'));
  await writeFile(ref, 'f'.repeat(40) + '\n'); await assert.rejects(() => getGitRepositoryContext(f.cwd), code('ASTRAGIT_GIT_STATE_READ_FAILED')); await writeFile(ref, originalRef);
  const config = join(f.cwd, '.git/config'); await writeFile(config, Buffer.concat([await readFile(config), Buffer.from('\n[invalid\n')])); await assert.rejects(() => getGitRepositoryContext(f.cwd), code('ASTRAGIT_GIT_STATE_READ_FAILED'));
  const linked = join(f.root, 'broken-link'); await mkdir(linked); await writeFile(join(linked, '.git'), 'gitdir: /nonexistent/astragit-state-fixture\n'); await assert.rejects(() => getGitRepositoryContext(linked), code('ASTRAGIT_GIT_STATE_READ_FAILED'));
});

test('status larger than the previous one-MiB buffer remains complete and does not refresh the index', async t => {
  const f = await fixture(t); const folder = 'a'.repeat(240) + '/' + 'b'.repeat(240); await mkdir(join(f.cwd, folder), { recursive: true }); const index = await readFile(join(f.cwd, '.git/index'));
  for (let start = 0; start < 2000; start += 100) await Promise.all(Array.from({ length: 100 }, (_, offset) => f.write(`${folder}/${String(start + offset).padStart(4, '0')}-${'c'.repeat(170)}.txt`, '')));
  const status = await getGitStatus(f.cwd); assert.equal(status.isRepository, true); assert.equal(status.clean, false); assert.equal(status.fileStatuses.length, 2000); assert.ok(Buffer.byteLength(await f.raw('status', '--porcelain=v1', '-z', '-uall')) > 1024 * 1024); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('clean checks use literal exclusion paths rather than treating bracketed folder names as patterns', async t => {
  const f = await fixture(t); await f.write('[temp]/keep.txt', 'ignored scope\n'); assert.equal(await getGitWorktreeClean(f.cwd, ['[temp]']), true); await f.write('t/keep.txt', 'must count\n'); assert.equal(await getGitWorktreeClean(f.cwd, ['[temp]']), false);
});

test('Git directory overrides cannot redirect an action away from the selected repository', async t => {
  const f = await fixture(t); const foreign = join(f.root, 'foreign'); await mkdir(foreign); await f.rawAt(foreign, 'init', '-q', '--initial-branch=foreign'); await writeFile(join(foreign, 'foreign.txt'), 'do not change\n'); await f.rawAt(foreign, 'add', '.'); await f.rawAt(foreign, '-c', 'user.name=Foreign', '-c', 'user.email=foreign@astragit.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'foreign');
  await f.git('branch', 'target'); const index = await readFile(join(foreign, '.git/index')); const head = await f.rawAt(foreign, 'rev-parse', 'HEAD');
  const result = await f.action({ type: 'checkout', branchName: 'target' }, undefined, { GIT_DIR: join(foreign, '.git'), GIT_COMMON_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign, GIT_INDEX_FILE: join(foreign, '.git/index') });
  assert.equal(result.branch, 'target'); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'target'); assert.equal(await f.rawAt(foreign, 'rev-parse', 'HEAD'), head); assert.deepEqual(await readFile(join(foreign, '.git/index')), index); assert.equal(await f.rawAt(foreign, 'symbolic-ref', '--short', 'HEAD'), 'foreign\n');
});

test('post-checkout unreadable status reports an unconfirmed outcome and retains the native cause', async t => {
  const f = await fixture(t); await f.git('switch', '-qc', 'target'); await f.write('file.txt', 'target\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'target'); await f.git('switch', 'main');
  await f.write('.git/hooks/post-checkout', '#!/bin/sh\nprintf broken > .git/index\nexit 0\n'); await chmod(join(f.cwd, '.git/hooks/post-checkout'), 0o755);
  await assert.rejects(() => f.action({ type: 'checkout', branchName: 'target' }), code('ASTRAGIT_GIT_ACTION_STATE_READ_FAILED', error => { assert.equal(error.operationStatus, 'unknown_after_write'); assert.equal(error.operationStage, 'refresh'); assert.equal(error.cause.code, 'ASTRAGIT_GIT_INDEX_CORRUPT'); }));
  assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'target'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'target\n');
});

test('smart update stops restoration and preserves its stash when post-update state cannot be read', async t => {
  for (const failedMerge of [false, true]) await t.test(failedMerge ? 'merge failed' : 'merge completed', async child => {
    const f = await fixture(child); const remote = join(f.root, 'remote.git'); await exec('git', ['init', '--bare', '-q', '--initial-branch=main', remote], { env: f.env }); await f.git('remote', 'add', 'origin', remote); await f.git('push', '-u', 'origin', 'main');
    const worker = join(f.root, 'worker'); await exec('git', ['clone', '-q', remote, worker], { env: f.env }); await writeFile(join(worker, 'remote.txt'), 'remote\n'); await f.rawAt(worker, 'add', '.'); await f.rawAt(worker, '-c', 'user.name=Remote', '-c', 'user.email=remote@astragit.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'remote'); await f.rawAt(worker, 'push', 'origin', 'main');
    if (failedMerge) { await f.write('local.txt', 'local committed\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'local'); }
    const hook = failedMerge ? 'pre-merge-commit' : 'post-merge'; await f.write(`.git/hooks/${hook}`, `#!/bin/sh\nprintf broken > .git/index\nexit ${failedMerge ? 1 : 0}\n`); await chmod(join(f.cwd, `.git/hooks/${hook}`), 0o755); await f.write('file.txt', 'keep local stash\n'); const trace = []; let saved;
    await assert.rejects(() => f.action({ type: 'update', strategy: 'merge', smart: true }, async command => trace.push(command)), code('ASTRAGIT_GIT_SMART_STATUS_UNCONFIRMED', error => { saved = error.savedStash; assert.match(saved, /^[a-f0-9]{40,64}$/u); assert.equal(error.operationStatus, 'unknown_after_write'); assert.equal(error.cause.code, 'ASTRAGIT_GIT_INDEX_CORRUPT'); }));
    assert.equal(await f.git('rev-parse', 'refs/stash'), saved); assert.equal(await f.git('show', `${saved}:file.txt`), 'keep local stash'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'base\n'); assert.equal(trace.some(command => /\bstash (?:apply|drop)\b/u.test(command)), false);
  });
});

test('state cancellation is propagated rather than reported as a clean or missing repository', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort(); await assert.rejects(() => getGitStatus(f.cwd, controller.signal), error => error.name === 'AbortError'); await assert.rejects(() => getGitRepositoryContext(f.cwd, controller.signal), error => error.name === 'AbortError');
});

test('HTTP state failures retain an index diagnosis and never return a clean success body', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'state-reader-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'State Test', localPath: f.cwd }); await client.loadProjectGitWorkbench(project.id); await f.write('.git/index', 'broken index');
  const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/status`, { headers: { 'x-astragit-api-token': server.apiToken } }); assert.equal(response.status, 500); const body = await response.json(); assert.equal(body.error, 'ASTRAGIT_GIT_INDEX_CORRUPT'); assert.notEqual(body.clean, true); await assert.rejects(() => client.loadProjectGitWorkbench(project.id), code('ASTRAGIT_GIT_INDEX_CORRUPT'));
});

test('state errors and unconfirmed smart restoration retain distinct bilingual next steps', () => {
  for (const language of ['zh-CN', 'en']) {
    for (const value of ['ASTRAGIT_GIT_STATE_READ_FAILED', 'ASTRAGIT_GIT_STATE_LOCATION', 'ASTRAGIT_GIT_STATE_ACCESS_DENIED', 'ASTRAGIT_GIT_STATE_OWNERSHIP', 'ASTRAGIT_GIT_INDEX_CORRUPT', 'ASTRAGIT_GIT_STATE_TOO_LARGE', 'ASTRAGIT_GIT_STATE_TIMEOUT', 'ASTRAGIT_GIT_STATE_ENCODING']) {
      const result = describeUserFacingError({ code: value, message: 'native read failed', operationStatus: 'failed_before_write', cause: { code: 'ASTRAGIT_GIT_FILE_HISTORY_FAILED', message: 'internal reader failed' } }, language); assert.ok(result.message.length > 20); assert.doesNotMatch(result.message, /native read failed|文件历史|file history/iu); assert.equal(result.outcomeUnconfirmed, false);
    }
    const unconfirmed = describeUserFacingError({ code: 'ASTRAGIT_GIT_SMART_STATUS_UNCONFIRMED', message: 'unconfirmed', operationStatus: 'unknown_after_write', cause: { code: 'ASTRAGIT_GIT_INDEX_CORRUPT', message: 'bad index' } }, language); assert.equal(unconfirmed.outcomeUnconfirmed, true); assert.match(unconfirmed.message, language === 'zh-CN' ? /贮藏|状态/u : /stash|state/u);
  }
});
