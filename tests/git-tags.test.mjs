import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitTags, getProjectGitTagTarget, getProjectGitRepositorySnapshot } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

const exec = promisify(execFile);
process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
const env = { ...process.env, LC_ALL: 'C' };
const raw = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout;
const git = async (cwd, ...args) => (await raw(cwd, ...args)).trim();
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-tags-')); const cwd = join(root, 'local'); await mkdir(cwd);
  const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  await git(cwd, 'init', '--initial-branch=main'); await git(cwd, 'config', 'user.name', 'Tag Test'); await git(cwd, 'config', 'user.email', 'tag@astragit.invalid'); await git(cwd, 'config', 'commit.gpgsign', 'false'); await git(cwd, 'config', 'tag.gpgsign', 'false');
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git(cwd, 'add', '.'); await git(cwd, 'commit', '-m', 'base');
  const remote = join(root, 'remote=one.git'); await git(root, 'clone', '--bare', cwd, remote); await git(remote, 'config', 'core.hooksPath', join(remote, 'hooks')); await git(cwd, 'remote', 'add', 'origin', remote);
  const run = (action, signal, extraEnv = env) => executeProjectGitAction(cwd, action, signal, extraEnv);
  const create = (tagName, annotated = true, message = 'tag annotation') => run({ type: 'create_tag', tagName, revision: 'HEAD', annotated, ...(annotated ? { message } : {}) });
  const remotePage = (remoteName = 'origin') => getProjectGitTags(cwd, { remote: remoteName });
  const deletion = async (tagName, remoteName = 'origin') => { const page = await remotePage(remoteName); const tag = page.items.find(item => item.name === tagName); assert.ok(tag); return { type: 'delete_remote_tag', remote: remoteName, tagName, expectedTargets: tag.targets.map(target => target.objectSha), expectedRemotePushFingerprint: page.pushFingerprint }; };
  return { root, cwd, remote, cleanup, run, create, remotePage, deletion };
}
async function serverClient(f) {
  const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'tag-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options);
  f.cleanup.push(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Tags', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  return { get server() { return server; }, get client() { return client; }, project, repository, restart: async () => { await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); } };
}

test('annotation bytes are retained, lightweight ignores signing defaults, and creation never replaces an existing tag', async t => {
  const f = await fixture(t); const message = '\n# literal annotation\nbody\n\n'; await f.create('release/中文', true, message);
  assert.equal((await raw(f.cwd, 'cat-file', 'tag', 'refs/tags/release/中文')).split('\n\n').slice(1).join('\n\n'), message);
  await git(f.cwd, 'config', 'tag.gpgsign', 'true'); await f.create('light', false); assert.equal(await git(f.cwd, 'cat-file', '-t', 'refs/tags/light'), 'commit');
  await assert.rejects(() => f.create('light'), error => error.code === 'ASTRAGIT_GIT_TAG_EXISTS');
  const target = await getProjectGitTagTarget(f.cwd, 'HEAD'); await writeFile(join(f.cwd, 'file.txt'), 'next\n'); await git(f.cwd, 'add', '.'); await git(f.cwd, 'commit', '-m', 'next');
  await assert.rejects(() => f.run({ type: 'create_tag', tagName: 'stale', revision: 'HEAD', expectedTargetSha: target.sha, annotated: false }), error => error.code === 'ASTRAGIT_GIT_TAG_TARGET_CHANGED');
  await assert.rejects(() => git(f.cwd, 'show-ref', '--verify', 'refs/tags/stale'));
});

test('local tag reads distinguish object, peeled and commit identities, including nested and noncommit tags', async t => {
  const f = await fixture(t); await f.create('annotation'); await f.create('plain', false); await git(f.cwd, 'tag', '-a', 'nested', 'annotation', '-m', 'outer');
  const blob = await git(f.cwd, 'rev-parse', 'HEAD:file.txt'); await git(f.cwd, 'tag', 'blob', blob); await git(f.cwd, 'update-ref', 'refs/tags/-dash', 'HEAD'); await git(f.cwd, 'tag', 'wide\u2003space');
  const before = await git(f.cwd, 'status', '--porcelain=v1'); const page = await getProjectGitTags(f.cwd, { limit: 2 }); assert.equal(page.total, 6); assert.equal(page.nextOffset, 2);
  const next = await getProjectGitTags(f.cwd, { offset: 2, limit: 20, expectedFingerprint: page.fingerprint }); const items = [...page.items, ...next.items];
  assert.equal(items.find(item => item.name === 'annotation').local.objectType, 'tag'); assert.equal(items.find(item => item.name === 'annotation').local.peeledType, 'commit'); assert.equal(items.find(item => item.name === 'plain').local.objectType, 'commit');
  assert.equal(items.find(item => item.name === 'nested').local.commitSha, await git(f.cwd, 'rev-parse', 'HEAD')); assert.equal(items.find(item => item.name === 'blob').local.commitSha, undefined); assert.equal(items.find(item => item.name === 'blob').local.objectSha, blob);
  assert.equal(await git(f.cwd, 'status', '--porcelain=v1'), before); await f.create('added', false);
  await assert.rejects(() => getProjectGitTags(f.cwd, { offset: 2, expectedFingerprint: page.fingerprint }), error => error.code === 'ASTRAGIT_GIT_TAG_LIST_CHANGED');
  await assert.rejects(() => getProjectGitTags(f.cwd, { offset: 2 }), error => error.code === 'ASTRAGIT_GIT_TAG_QUERY_INVALID');
});

test('tag push freezes the tag object and push destination and does not follow unrelated annotated tags', async t => {
  const f = await fixture(t); await f.create('selected'); await f.create('unrelated'); await git(f.cwd, 'config', 'push.followTags', 'true'); await git(f.cwd, 'config', 'remote.origin.mirror', 'true'); const page = await getProjectGitTags(f.cwd); const selected = page.items.find(item => item.name === 'selected'); const snapshot = await getProjectGitRepositorySnapshot(f.cwd);
  const action = { type: 'push_tag', tagName: 'selected', remote: 'origin', expectedTagObjectSha: selected.local.objectSha, expectedRemotePushFingerprint: snapshot.remoteDetails[0].pushFingerprint };
  await f.run(action); assert.equal(await git(f.remote, 'rev-parse', 'refs/tags/selected'), selected.local.objectSha); await assert.rejects(() => git(f.remote, 'show-ref', '--verify', 'refs/tags/unrelated'));
  await git(f.cwd, 'tag', '-f', '-a', 'selected', '-m', 'replacement'); await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_TAG_LOCAL_CHANGED');
  await assert.rejects(async () => f.run({ ...action, expectedTagObjectSha: await git(f.cwd, 'rev-parse', 'refs/tags/selected') })); assert.equal(await git(f.remote, 'rev-parse', 'refs/tags/selected'), selected.local.objectSha);
  await git(f.cwd, 'remote', 'set-url', '--push', 'origin', join(f.root, 'changed.git')); await assert.rejects(async () => f.run({ ...action, expectedTagObjectSha: await git(f.cwd, 'rev-parse', 'refs/tags/selected') }), error => error.code === 'ASTRAGIT_GIT_TAG_REMOTE_CHANGED');
});

test('local deletion compares the raw tag object and symbolic tag deletion never removes the referred branch', async t => {
  const f = await fixture(t); await f.create('reviewed'); const old = await git(f.cwd, 'rev-parse', 'refs/tags/reviewed'); await git(f.cwd, 'tag', '-f', '-a', 'reviewed', '-m', 'changed on the same commit');
  await assert.rejects(() => f.run({ type: 'delete_tag', tagName: 'reviewed', expectedTagObjectSha: old }), error => error.code === 'ASTRAGIT_GIT_TAG_LOCAL_CHANGED');
  const current = await git(f.cwd, 'rev-parse', 'refs/tags/reviewed'); await f.run({ type: 'delete_tag', tagName: 'reviewed', expectedTagObjectSha: current }); await assert.rejects(() => git(f.cwd, 'show-ref', '--verify', 'refs/tags/reviewed'));
  const head = await git(f.cwd, 'rev-parse', 'HEAD'); await git(f.cwd, 'symbolic-ref', 'refs/tags/symbolic', 'refs/heads/main'); await f.run({ type: 'delete_tag', tagName: 'symbolic', expectedTagObjectSha: head }); assert.equal(await git(f.cwd, 'rev-parse', 'refs/heads/main'), head);
  await git(f.cwd, 'update-ref', 'refs/tags/-dash', head); await f.run({ type: 'delete_tag', tagName: '-dash', expectedTagObjectSha: head });
});

test('remote listing reads actual push destinations, preserves absent targets and supports remote-only tags', async t => {
  const f = await fixture(t); const other = join(f.root, 'second.git'); await git(f.root, 'clone', '--bare', f.remote, other); await f.create('only-first'); await git(f.cwd, 'push', f.remote, 'refs/tags/only-first'); const object = await git(f.cwd, 'rev-parse', 'refs/tags/only-first'); await f.run({ type: 'delete_tag', tagName: 'only-first', expectedTagObjectSha: object });
  await git(f.cwd, 'remote', 'set-url', 'origin', join(f.root, 'fetch-is-unreachable.git')); await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', f.remote); await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', other);
  const page = await f.remotePage(); const item = page.items[0]; assert.equal(item.name, 'only-first'); assert.equal(item.local, undefined); assert.equal(item.targets[0].objectSha, object); assert.ok(item.targets[0].peeledSha); assert.equal(item.targets[1].objectSha, null); assert.equal(page.destinations.length, 2);
  assert.equal((await getProjectGitTags(f.cwd, { remote: 'origin', search: object.slice(0, 12) })).total, 1);
  await f.run(await f.deletion('only-first')); await assert.rejects(() => git(f.remote, 'show-ref', '--verify', 'refs/tags/only-first')); assert.equal((await f.remotePage()).total, 0);
});

test('remote deletion refuses a changed annotation even if the peeled commit is unchanged', async t => {
  const f = await fixture(t); await f.create('protected'); await git(f.cwd, 'push', 'origin', 'refs/tags/protected'); const action = await f.deletion('protected'); await git(f.cwd, 'tag', '-f', '-a', 'protected', '-m', 'new annotation'); await git(f.cwd, 'push', '--force', 'origin', 'refs/tags/protected'); const current = await git(f.remote, 'rev-parse', 'refs/tags/protected');
  await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_TAG_REMOTE_VERSION_CHANGED' && error.operationStatus === 'failed_before_write'); assert.equal(await git(f.remote, 'rev-parse', 'refs/tags/protected'), current);
});

test('multiple push destinations delete their own reviewed versions; local tags remain', async t => {
  const f = await fixture(t); const second = join(f.root, 'second.git'); await git(f.root, 'clone', '--bare', f.remote, second); await f.create('multi'); await git(f.cwd, 'push', f.remote, 'refs/tags/multi'); await git(f.cwd, 'tag', '-f', '-a', 'multi', '-m', 'second version'); await git(f.cwd, 'push', second, 'refs/tags/multi');
  await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', f.remote); await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', second); const action = await f.deletion('multi'); assert.notEqual(action.expectedTargets[0], action.expectedTargets[1]); await f.run(action);
  for (const path of [f.remote, second]) await assert.rejects(() => git(path, 'show-ref', '--verify', 'refs/tags/multi')); assert.equal(await git(f.cwd, 'rev-parse', 'refs/tags/multi'), action.expectedTargets[1]);
});

test('changed push URLs refuse writes; protected servers and partial remote results have distinct outcomes', async t => {
  const f = await fixture(t); await f.create('review'); await git(f.cwd, 'push', 'origin', 'refs/tags/review'); const action = await f.deletion('review'); const second = join(f.root, 'second.git'); await git(f.root, 'clone', '--bare', f.remote, second); await git(second, 'config', 'core.hooksPath', join(second, 'hooks')); await writeFile(join(second, 'hooks/pre-receive'), '#!/bin/sh\necho protected-tag >&2\nexit 1\n', { mode: 0o755 });
  await git(f.cwd, 'remote', 'set-url', '--push', 'origin', second); await assert.rejects(() => f.run(action), error => error.code === 'ASTRAGIT_GIT_TAG_REMOTE_CHANGED'); await assert.rejects(async () => f.run(await f.deletion('review')), error => error.code === 'ASTRAGIT_GIT_TAG_REMOTE_REJECTED');
  await git(f.cwd, 'remote', 'set-url', '--push', 'origin', f.remote); await git(f.cwd, 'remote', 'set-url', '--add', '--push', 'origin', second); const multiple = await f.deletion('review'); await assert.rejects(() => f.run(multiple), error => error.code === 'ASTRAGIT_GIT_TAG_REMOTE_OUTCOME_UNKNOWN' && error.operationStatus === 'unknown_after_write' && /completed=1/u.test(error.details));
  await assert.rejects(() => git(f.remote, 'show-ref', '--verify', 'refs/tags/review')); assert.equal(await git(second, 'rev-parse', 'refs/tags/review'), multiple.expectedTargets[1]); assert.ok(await git(f.cwd, 'rev-parse', 'refs/tags/review'));
});

test('resolved URLs are rewritten once while endpoint aliases retain uploadpack, receivepack and inherited command config', async t => {
  const f = await fixture(t); await f.create('transport'); await git(f.cwd, 'push', 'origin', 'refs/tags/transport'); const wrong = join(f.root, 'must-not-contact.git'); await git(f.root, 'clone', '--bare', f.remote, wrong);
  await git(f.cwd, 'config', `url.${f.remote}.insteadOf`, 'tag-test:'); await git(f.cwd, 'config', `url.${wrong}.insteadOf`, f.remote); await git(f.cwd, 'remote', 'set-url', 'origin', 'tag-test:');
  const uploaded = join(f.root, 'upload'); const received = join(f.root, 'receive'); const upload = join(f.root, 'upload.sh'); const receive = join(f.root, 'receive.sh');
  const inherited = join(f.root, 'inherited'); const hooks = join(f.root, 'client-hooks'); await mkdir(hooks); await git(f.cwd, 'config', 'core.hooksPath', hooks); await writeFile(join(hooks, 'pre-push'), `#!/bin/sh\ngit config --get astragit.test.inherited > ${quote(inherited)}\n`, { mode: 0o755 });
  await writeFile(upload, `#!/bin/sh\necho used > ${quote(uploaded)}\nexec git-upload-pack "$@"\n`, { mode: 0o755 }); await writeFile(receive, `#!/bin/sh\necho used > ${quote(received)}\nexec git-receive-pack "$@"\n`, { mode: 0o755 }); await git(f.cwd, 'config', 'remote.origin.uploadpack', quote(upload)); await git(f.cwd, 'config', 'remote.origin.receivepack', quote(receive));
  const action = await f.deletion('transport'); assert.equal((await readFile(uploaded, 'utf8')).trim(), 'used'); await f.run(action, undefined, { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'astragit.test.inherited', GIT_CONFIG_VALUE_0: 'kept' }); assert.equal((await readFile(received, 'utf8')).trim(), 'used'); assert.equal((await readFile(inherited, 'utf8')).trim(), 'kept');
  await assert.rejects(() => git(f.remote, 'show-ref', '--verify', 'refs/tags/transport')); assert.ok(await git(wrong, 'rev-parse', 'refs/tags/transport')); assert.equal(await git(f.cwd, 'config', '--get-regexp', '^remote\\.astragit-endpoint-').catch(() => ''), '');
});

test('HTTP tag reads create no write records and typed create, push and deletion pass through durable commands', async t => {
  const f = await fixture(t); const { client, project, repository } = await serverClient(f); const target = await client.loadRepositoryGitTagTarget(project.id, repository.id, 'HEAD'); assert.equal(target.sha, repository.snapshot.headSha);
  assert.equal((await client.loadRepositoryGitTags(project.id, repository.id, {})).total, 0); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
  await client.executeProjectGitAction(project.id, repository.id, { type: 'create_tag', tagName: 'http', annotated: false, revision: 'HEAD', expectedTargetSha: target.sha }); const local = await client.loadRepositoryGitTags(project.id, repository.id, {}); assert.equal(local.items[0].local.objectType, 'commit');
  await client.executeProjectGitAction(project.id, repository.id, { type: 'push_tag', tagName: 'http', remote: 'origin', expectedTagObjectSha: local.items[0].local.objectSha, expectedRemotePushFingerprint: repository.snapshot.remoteDetails[0].pushFingerprint }); const remote = await client.loadRepositoryGitTags(project.id, repository.id, { remote: 'origin' });
  await client.executeProjectGitAction(project.id, repository.id, { type: 'delete_remote_tag', tagName: 'http', remote: 'origin', expectedRemotePushFingerprint: remote.pushFingerprint, expectedTargets: remote.items[0].targets.map(target => target.objectSha) });
  assert.equal((await client.loadRepositoryGitTags(project.id, repository.id, { remote: 'origin' })).total, 0); assert.equal((await client.loadRepositoryGitTags(project.id, repository.id, {})).total, 1); const operations = (await client.loadProjectGitOperations(project.id)).items; assert.equal(operations.length, 3); assert.ok(operations.every(item => item.status === 'completed'));
  await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, { type: 'create_tag', tagName: 'bad', revision: 'HEAD', annotated: 'false' }));
});

test('HTTP tag names and target refs preserve valid Unicode whitespace instead of silently selecting another ref', async t => {
  const f = await fixture(t); const h = await serverClient(f); const name = '\u2003release\u2003'; const action = { type: 'create_tag', tagName: name, annotated: false, revision: 'HEAD' };
  await h.client.executeProjectGitAction(h.project.id, h.repository.id, action); assert.equal((await h.client.loadRepositoryGitTags(h.project.id, h.repository.id, {})).items[0].name, name);
  const ref = `refs/tags/${name}`; assert.equal((await h.client.loadRepositoryGitTagTarget(h.project.id, h.repository.id, ref)).sha, h.repository.snapshot.headSha);
  await h.client.executeProjectGitAction(h.project.id, h.repository.id, { ...action, tagName: 'from-unicode', revision: ref });
  await h.client.executeProjectGitAction(h.project.id, h.repository.id, { type: 'delete_tag', tagName: name, expectedTagObjectSha: h.repository.snapshot.headSha }); await assert.rejects(() => git(f.cwd, 'show-ref', '--verify', ref));
  await assert.rejects(() => h.client.executeProjectGitAction(h.project.id, h.repository.id, { ...action, tagName: 'invalid-message', message: 123 }), error => error.error === 'ASTRAGIT_GIT_TAG_OPTIONS_INVALID');
});

test('tag confirmation refuses invalid names, missing targets and unreviewed remote versions before writes', async t => {
  const f = await fixture(t);
  for (const tagName of ['bad name', 'bad..name', '-option', 'bad\nname', 'bad.lock']) await assert.rejects(() => f.create(tagName, false), error => error.code === 'ASTRAGIT_GIT_TAG_INVALID' && error.operationStatus === 'failed_before_write');
  await assert.rejects(() => getProjectGitTagTarget(f.cwd, 'missing'), error => error.code === 'ASTRAGIT_GIT_TAG_TARGET_INVALID');
  await assert.rejects(async () => f.run({ type: 'delete_remote_tag', tagName: 'missing', remote: 'origin', expectedRemotePushFingerprint: (await getProjectGitRepositorySnapshot(f.cwd)).remoteDetails[0].pushFingerprint, expectedTargets: [] }), error => error.code === 'ASTRAGIT_GIT_TAG_REVIEW_REQUIRED');
  assert.equal((await getProjectGitTags(f.cwd)).total, 0);
});

test('replayed remote tag deletion remains a saved result after a new tag is created and the service restarts', async t => {
  const f = await fixture(t); await f.create('once'); await git(f.cwd, 'push', 'origin', 'refs/tags/once'); const h = await serverClient(f); const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: h.repository.id, value: await f.deletion('once') });
  const send = async () => { const response = await fetch(`${h.server.baseUrl}/api/projects/${h.project.id}/git/workbench/repositories/${h.repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': h.server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); await git(f.cwd, 'push', 'origin', 'refs/tags/once'); const object = await git(f.remote, 'rev-parse', 'refs/tags/once'); await h.restart(); assert.deepEqual(await send(), first); assert.equal(await git(f.remote, 'rev-parse', 'refs/tags/once'), object); assert.equal((await h.client.loadProjectGitOperations(h.project.id)).items.filter(item => item.action === 'delete_remote_tag').length, 1);
});

test('cancelling an in-flight tag deletion requires checking server state and never repeats the write automatically', async t => {
  const f = await fixture(t); await f.create('cancel'); await git(f.cwd, 'push', 'origin', 'refs/tags/cancel'); const action = await f.deletion('cancel'); const marker = join(f.root, 'server-started');
  await writeFile(join(f.remote, 'hooks/pre-receive'), `#!/bin/sh\necho started > ${quote(marker)}\nsleep 20\nexit 1\n`, { mode: 0o755 }); const controller = new AbortController(); const pending = f.run(action, controller.signal).then(value => ({ value }), error => ({ error }));
  let started = false; for (let index = 0; index < 200; index++) { if (await readFile(marker, 'utf8').catch(() => '')) { started = true; break; } await new Promise(resolve => setTimeout(resolve, 20)); } assert.ok(started); controller.abort(); const result = await pending; assert.equal(result.error.code, 'ASTRAGIT_GIT_TAG_REMOTE_OUTCOME_UNKNOWN'); assert.equal(result.error.operationStatus, 'unknown_after_write'); assert.equal(await git(f.remote, 'rev-parse', 'refs/tags/cancel'), action.expectedTargets[0]);
});
