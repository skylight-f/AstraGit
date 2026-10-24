import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { describeUserFacingError } from '../packages/shared/src/index.ts';
import { ArtifactStore, CommandDeliveryRepository, createAstraGitDatabase } from '../packages/storage/dist/index.js';
import { GitCommandApplication } from '../packages/git-server/dist/gitCommandApplication.js';
import { executeProjectGitAction, getProjectGitInteractiveRebasePreview, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, timeout = 5000) { const deadline = Date.now() + timeout; do { const value = await read(); if (value) return value; await delay(20); } while (Date.now() < deadline); throw new Error('Fixture did not reach the expected state'); }
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-workbench-command-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = [];
  let server; t.after(async () => { for (const close of cleanup) await close(); await server?.close(); await rm(root, { recursive: true, force: true }); });
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Command Test'); await git('config', 'user.email', 'command@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); const hooks = join(root, 'hooks'); await mkdir(hooks); await git('config', 'core.hooksPath', hooks);
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base'); const head = await git('rev-parse', 'HEAD');
  const data = join(root, 'data'); const options = { dataDirectory: data, projectRoot: root, apiToken: 'workbench-command-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  server = await startGitServer(options); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Workbench commands', localPath: cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const envelope = input => buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: input });
  const send = async (body, route = 'actions') => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  const restart = async () => { await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); };
  return { root, cwd, data, options, hooks, cleanup, git, head, project, repository, envelope, send, restart, get client() { return client; }, get server() { return server; } };
}

test('concurrent and restarted workbench commit requests replay one real Git commit without consuming later staged contents', async t => {
  const f = await fixture(t); const counter = join(f.root, 'commit-count'); const hook = join(f.hooks, 'post-commit'); await writeFile(hook, `#!/bin/sh\nprintf 'commit\\n' >> '${counter}'\n`); await chmod(hook, 0o755);
  await writeFile(join(f.cwd, 'file.txt'), 'first\n'); await f.git('add', '.'); const body = await f.envelope({ type: 'commit', message: 'once', selectionMode: 'staged' });
  const [first, duplicate] = await Promise.all([f.send(body), f.send(body)]); assert.equal(first.status, 200); assert.deepEqual(duplicate.value, first.value); const committed = await f.git('rev-parse', 'HEAD'); assert.equal(await f.git('rev-list', '--count', 'HEAD'), '2'); assert.equal(await readFile(counter, 'utf8'), 'commit\n');
  await writeFile(join(f.cwd, 'file.txt'), 'later staged\n'); await f.git('add', '.'); await f.restart(); const replayed = await f.send(body); assert.equal(replayed.status, 200); assert.deepEqual(replayed.value, first.value); assert.equal(await f.git('rev-parse', 'HEAD'), committed); assert.equal(await f.git('show', ':file.txt'), 'later staged'); assert.equal(await readFile(counter, 'utf8'), 'commit\n'); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(item => item.action === 'commit').length, 1);
});

test('blocked checkout receipts preserve verified paths and pre-write status instead of becoming unknown or rerunning after files change', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'target'); await writeFile(join(f.cwd, 'file.txt'), 'target\n'); await f.git('commit', '-am', 'target'); await f.git('switch', 'main'); await writeFile(join(f.cwd, 'file.txt'), 'local work\n');
  const action = { type: 'checkout', branchName: 'target', stashBeforeCheckout: false }; const body = await f.envelope(action); const first = await f.send(body); assert.equal(first.status, 400); assert.equal(first.value.error, 'ASTRAGIT_GIT_CHECKOUT_BLOCKED'); assert.equal(first.value.operationStatus, 'failed_before_write'); assert.deepEqual(first.value.affectedFiles, ['file.txt']); const explanation = describeUserFacingError({ code: first.value.error, ...first.value }); assert.equal(explanation.outcomeUnconfirmed, false); assert.match(explanation.message, /切换未执行/u);
  await f.git('restore', 'file.txt'); await f.restart(); assert.deepEqual((await f.send(body)).value, first.value); assert.equal(await f.git('branch', '--show-current'), 'main'); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(item => item.action === 'checkout').length, 1);
  assert.equal((await f.send(await f.envelope(action))).status, 200); assert.equal(await f.git('branch', '--show-current'), 'target');
});

test('a post-checkout hook failure replays its uncertain result without executing the hook again', async t => {
  const f = await fixture(t); await f.git('branch', 'target'); const counter = join(f.root, 'checkout-count'); const hook = join(f.hooks, 'post-checkout'); await writeFile(hook, `#!/bin/sh\nprintf 'checkout\\n' >> '${counter}'\necho 'post-checkout hook failed' >&2\nexit 1\n`); await chmod(hook, 0o755);
  const body = await f.envelope({ type: 'checkout', branchName: 'target', stashBeforeCheckout: false }); const first = await f.send(body); assert.notEqual(first.status, 200); assert.equal(first.value.operationStatus, 'unknown_after_write'); assert.equal(await f.git('branch', '--show-current'), 'target'); await writeFile(hook, '#!/bin/sh\nexit 0\n'); await f.restart(); assert.deepEqual((await f.send(body)).value, first.value); assert.equal(await readFile(counter, 'utf8'), 'checkout\n'); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(item => item.action === 'checkout').length, 1);
});

test('a conflicted stash pop is delivered once and replay cannot alter a subsequently staged resolution', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'stashed\n'); await f.git('stash', 'push', '-m', 'saved'); await writeFile(join(f.cwd, 'file.txt'), 'branch\n'); await f.git('commit', '-am', 'branch change');
  const body = await f.envelope({ type: 'apply_stash', stashRef: 'stash@{0}', pop: true }); const first = await f.send(body); assert.equal(first.status, 200); assert.equal(first.value.result.outcome, 'conflict'); assert.match(await f.git('stash', 'list'), /saved/u);
  await writeFile(join(f.cwd, 'file.txt'), 'resolved\n'); await f.git('add', 'file.txt'); await f.restart(); assert.deepEqual((await f.send(body)).value, first.value); assert.equal(await f.git('show', ':file.txt'), 'resolved'); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'resolved\n'); assert.match(await f.git('stash', 'list'), /saved/u); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(item => item.action === 'apply_stash').length, 1);
});

test('malformed envelopes never fall back to raw writes; unchanged legacy raw requests and current renderer calls remain usable', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'modified\n'); const body = await f.envelope({ type: 'stage', paths: ['file.txt'] });
  for (const invalid of [{ ...body, command: null }, { ...body, input: { type: 'stage', paths: ['another.txt'] } }, { ...body, command: { ...body.command, scope: { ...body.command.scope, id: 'another-repository' } } }]) assert.notEqual((await f.send(invalid)).status, 200);
  assert.equal(await f.git('show', ':file.txt'), 'base'); assert.equal((await f.send({ type: 'stage', paths: ['file.txt'] })).status, 200); assert.equal(await f.git('show', ':file.txt'), 'modified');
  await f.client.executeProjectGitAction(f.project.id, f.repository.id, { type: 'unstage', paths: ['file.txt'] }); assert.equal(await f.git('show', ':file.txt'), 'base'); const valid = await f.send(body); assert.equal(valid.status, 200); const changed = structuredClone(body); changed.command.actor.id = 'different-actor'; assert.equal((await f.send(changed)).status, 409);
});

test('old bare interactive-rebase receipts remain replayable after the workbench result format changes', async t => {
  const f = await fixture(t); for (const name of ['A', 'B']) { await writeFile(join(f.cwd, `${name}.txt`), name); await f.git('add', '.'); await f.git('commit', '-m', name); }
  const preview = await getProjectGitInteractiveRebasePreview(f.cwd, f.head); const action = { type: 'interactive_rebase', baseSha: preview.baseSha, ontoSha: preview.ontoSha, expectedFingerprint: preview.fingerprint, steps: preview.commits.map((commit, index) => ({ sha: commit.sha, action: index === 0 ? 'edit' : 'pick' })) }; const body = await f.envelope(action); await f.server.close();
  const result = await executeProjectGitAction(f.cwd, action, undefined, env); const snapshot = await getProjectGitRepositorySnapshot(f.cwd); const legacy = { projectId: f.project.id, repositoryId: f.repository.id, repositoryName: f.repository.name, result, snapshot };
  const db = await createAstraGitDatabase(join(f.data, 'git-app.db')); try { const artifacts = new ArtifactStore(db, join(f.data, 'artifacts', 'content-addressed')); await artifacts.initialize(); const app = new GitCommandApplication({ db, artifacts, deliveries: new CommandDeliveryRepository(db), redactSensitiveText: text => ({ text }), now: () => new Date() }); const parsed = app.parse({ value: body, commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', expectedScopeId: () => f.repository.id }); await app.executeExternal({ parsed, destinationId: 'git-workbench:interactive-rebase', resourceId: `${f.project.id}:${f.repository.id}`, externalOperationId: `${f.project.id}:${f.repository.id}:${parsed.operationIdentity}`, invoke: async () => legacy, mutateAcceptedBusinessState: () => {} }); } finally { await db.close(); }
  await f.restart(); const replay = await f.send(body, 'interactive-rebase'); assert.equal(replay.status, 200); assert.deepEqual(replay.value, legacy); assert.equal((await getProjectGitRepositorySnapshot(f.cwd)).rebaseEdit.originalCommitSha, preview.commits[0].sha); assert.equal((await f.client.loadProjectGitOperations(f.project.id)).items.filter(item => item.action === 'interactive_rebase').length, 0); await f.client.executeProjectGitAction(f.project.id, f.repository.id, { type: 'abort_integration', kind: 'rebase' });
});

test('process death after native Git starts leaves a durable unknown receipt that cannot execute again', { timeout: 20_000 }, async t => {
  const f = await fixture(t); await f.server.close(); const marker = join(f.root, 'git-pid'); const release = join(f.root, 'release-hook'); const hook = join(f.hooks, 'pre-commit'); await writeFile(hook, `#!/bin/sh\nprintf '%s' "$PPID" > '${marker}'\nwhile [ ! -e '${release}' ]; do /bin/sleep 0.05; done\n`); await chmod(hook, 0o755); await writeFile(join(f.cwd, 'file.txt'), 'pending\n'); await f.git('add', '.');
  const serverModule = new URL('../packages/git-server/dist/index.js', import.meta.url).href; const secretModule = new URL('../packages/git-server/dist/securityCore.js', import.meta.url).href; const script = `import {startGitServer} from ${JSON.stringify(serverModule)}; import {createFileSecretStore} from ${JSON.stringify(secretModule)}; const server=await startGitServer({dataDirectory:${JSON.stringify(f.data)},projectRoot:${JSON.stringify(f.root)},apiToken:'workbench-command-tests',secretStore:createFileSecretStore(${JSON.stringify(join(f.data, 'secrets.json'))}),codexNativeEnabled:false});process.stdout.write(server.baseUrl+'\\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let gitPid = null; const closed = new Promise(resolve => child.once('close', resolve)); f.cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; if (gitPid) { try { process.kill(-gitPid, 'SIGKILL'); } catch {} } }); let output = ''; child.stdout.on('data', chunk => { output += chunk; }); const url = await until(() => output.includes('\n') && output.trim().split('\n')[0]);
  const body = await f.envelope({ type: 'commit', message: 'must run once', selectionMode: 'staged' }); const pending = fetch(`${url}/api/projects/${f.project.id}/git/workbench/repositories/${f.repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': 'workbench-command-tests' }, body: JSON.stringify(body) }).then(response => response.json()).catch(error => error);
  gitPid = Number(await until(() => readFile(marker, 'utf8').catch(() => null))); assert.ok(Number.isSafeInteger(gitPid) && gitPid > 1); const group = (await exec('ps', ['-p', String(gitPid), '-o', 'pgid=,command='])).stdout.trim(); assert.equal(Number(group.split(/\s+/u)[0]), gitPid); assert.match(group, /git .*commit/u); child.kill('SIGKILL'); await closed; process.kill(-gitPid, 'SIGKILL'); gitPid = null; await pending;
  await f.restart(); const replay = await f.send(body); assert.equal(replay.status, 409); assert.equal(replay.value.error, 'ASTRAGIT_COMMAND_DELIVERY_REPLAY_BLOCKED'); assert.equal(await f.git('rev-parse', 'HEAD'), f.head); assert.equal(await f.git('rev-list', '--count', 'HEAD'), '1'); assert.ok((await f.client.loadProjectGitOperations(f.project.id)).items.some(item => item.action === 'commit' && item.status === 'unknown_after_write'));
});
