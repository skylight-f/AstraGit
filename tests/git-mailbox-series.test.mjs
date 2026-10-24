import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitMailboxPreview, getProjectGitPatchExport, getProjectGitRepositorySnapshot, getProjectGitSkipPreview } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

const exec = promisify(execFile); process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
const env = { ...process.env, LC_ALL: 'C' };
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-mailbox-test-'))); const cwd = join(root, 'source'); await mkdir(cwd); const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const raw = async (path, args, extra = {}) => (await exec('git', args, { cwd: path, env: { ...env, ...extra } })).stdout;
  const at = async (path, ...args) => (await raw(path, args)).trim(); const git = (...args) => at(cwd, ...args);
  const configure = async path => { await at(path, 'config', 'user.name', 'Mailbox Committer'); await at(path, 'config', 'user.email', 'committer@astragit.invalid'); await at(path, 'config', 'commit.gpgsign', 'false'); await at(path, 'config', 'core.hooksPath', join(root, 'hooks')); };
  await git('init', '-b', 'main'); await configure(cwd); await writeFile(join(cwd, 'file.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base'); const base = await git('rev-parse', 'HEAD');
  const commit = async (name, contents, message = name, extra = {}) => { if (contents !== null) { await writeFile(join(cwd, name), contents); await git('add', '--', name); } await raw(cwd, ['commit', '--allow-empty', '--cleanup=verbatim', '-m', message], extra); return git('rev-parse', 'HEAD'); };
  const clone = async (name, revision = base) => { const path = join(root, name); await at(root, 'clone', '--no-hardlinks', cwd, path); await configure(path); await at(path, 'checkout', '-B', 'main', revision); return path; };
  const run = (path, action, signal) => executeProjectGitAction(path, action, signal, env);
  const exportSeries = options => getProjectGitPatchExport(cwd, { scope: 'series', ...options });
  const importSeries = (path, mailbox, preview) => run(path, { type: 'import_mailbox', mailbox, expectedFingerprint: preview.fingerprint });
  return { root, cwd, cleanup, raw, at, git, base, commit, configure, clone, run, exportSeries, importSeries };
}
const input = (artifact, extra = {}) => ({ data: artifact.data, encoding: 'base64', keepSubject: true, keepCR: true, threeWay: true, empty: 'keep', ...extra });
const author = number => ({ GIT_AUTHOR_NAME: `Author ${number} 中文`, GIT_AUTHOR_EMAIL: `author${number}@astragit.invalid`, GIT_AUTHOR_DATE: `${2005 - number}-01-02T03:04:05+0800` });

test('unmarked Git mbox imports preserve quoted From lines without assuming mboxrd escaping', async t => {
  const f = await fixture(t); const sha = await f.commit('file.txt', 'next\n', 'foreign\n\n>From quoted text\n'); const data = await f.raw(f.cwd, ['format-patch', '--stdout', '-1', '--keep-subject', '--no-signature', sha]); const mailbox = { data, encoding: 'utf8', keepSubject: true }; const path = await f.clone('foreign'); const preview = await getProjectGitMailboxPreview(path, mailbox); assert.match(preview.commits[0].message, />From quoted text/u); await f.importSeries(path, mailbox, preview); assert.equal(await f.raw(path, ['show', '-s', '--format=%B', 'HEAD']), await f.raw(f.cwd, ['show', '-s', '--format=%B', sha]));
});

test('selected commits export in topological order despite reversed dates; mailbox import retains author, dates, messages, binary and empty commits', async t => {
  const f = await fixture(t); const a = await f.commit('file.txt', 'first\n', '[Topic] first\n\nfull body\n# literal line\nFrom sender Fri Jan  2 03:04:05 2004\n>From quoted text\n', author(1)); const b = await f.commit('binary.bin', Buffer.from([0, 255, 1, 2]), 'binary\n\nbody\n', author(2)); const c = await f.commit('empty', null, 'empty commit\n\nkeep this\n', author(3));
  const index = await readFile(join(f.cwd, '.git/index')); const objects = await f.git('count-objects', '-v'); const artifact = await f.exportSeries({ revisions: [c, a, b] }); assert.deepEqual(artifact.commits.map(commit => commit.sha), [a, b, c]); assert.equal(artifact.commits[2].empty, true); assert.match(artifact.suggestedName, /3-commits.*\.mbox$/u); assert.equal(await f.git('count-objects', '-v'), objects); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  const path = await f.clone('target'); const mailbox = input(artifact); const beforeIndex = await readFile(join(path, '.git/index')); const beforeObjects = await f.at(path, 'count-objects', '-v'); const preview = await getProjectGitMailboxPreview(path, mailbox); assert.equal(preview.applicable, true); assert.deepEqual(preview.commits.map(commit => commit.subject), ['[Topic] first', 'binary', 'empty commit']); assert.deepEqual(await readFile(join(path, '.git/index')), beforeIndex); assert.equal(await f.at(path, 'count-objects', '-v'), beforeObjects);
  await f.importSeries(path, mailbox, preview); const targetCommits = (await f.at(path, 'rev-list', '--reverse', `${f.base}..HEAD`)).split('\n'); assert.equal(targetCommits.length, 3);
  for (let index = 0; index < 3; index++) assert.equal(await f.raw(path, ['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', targetCommits[index]]), await f.raw(f.cwd, ['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', [a, b, c][index]]));
  assert.deepEqual(await readFile(join(path, 'binary.bin')), Buffer.from([0, 255, 1, 2])); assert.equal(await f.at(path, 'status', '--porcelain=v1'), '');
});

test('noncontiguous selections contain exactly the selected commits while range export includes intermediate commits', async t => {
  const f = await fixture(t); const a = await f.commit('a.txt', 'a\n'); const b = await f.commit('b.txt', 'b\n'); const c = await f.commit('c.txt', 'c\n');
  const selected = await f.exportSeries({ revisions: [c, a] }); assert.deepEqual(selected.commits.map(commit => commit.sha), [a, c]); const range = await f.exportSeries({ baseRef: f.base, targetRef: c }); assert.deepEqual(range.commits.map(commit => commit.sha), [a, b, c]);
  const path = await f.clone('selected'); const mailbox = input(selected); await f.importSeries(path, mailbox, await getProjectGitMailboxPreview(path, mailbox)); assert.equal(await f.at(path, 'rev-list', '--count', `${f.base}..HEAD`), '2'); await assert.rejects(() => readFile(join(path, 'b.txt')));
});

test('root mailbox imports into an unborn repository and does not include unrelated untracked files in its commits', async t => {
  const f = await fixture(t); const artifact = await f.exportSeries({ revisions: [f.base] }); const path = join(f.root, 'unborn'); await mkdir(path); await f.at(path, 'init', '-b', 'main'); await f.configure(path); await writeFile(join(path, 'keep.txt'), 'untracked\n'); const mailbox = input(artifact); const preview = await getProjectGitMailboxPreview(path, mailbox); assert.equal(preview.headSha, ''); assert.equal(preview.applicable, true); await f.importSeries(path, mailbox, preview);
  assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'base\n'); assert.equal(await f.at(path, 'ls-files'), 'file.txt'); assert.equal(await readFile(join(path, 'keep.txt'), 'utf8'), 'untracked\n');
});

test('series export rejects merge commits, partial-file scopes, duplicate selections and invalid ranges without flattening', async t => {
  const f = await fixture(t); await f.git('checkout', '-b', 'topic'); const a = await f.commit('topic.txt', 'topic\n'); await f.git('checkout', 'main'); await f.commit('main.txt', 'main\n'); await f.git('merge', '--no-ff', 'topic', '-m', 'merge'); const merge = await f.git('rev-parse', 'HEAD');
  await assert.rejects(() => f.exportSeries({ revisions: [merge] }), error => error.code === 'ASTRAGIT_GIT_PATCH_SERIES_MERGE'); await assert.rejects(() => f.exportSeries({ baseRef: f.base, targetRef: merge }), error => error.code === 'ASTRAGIT_GIT_PATCH_SERIES_MERGE');
  for (const options of [{ revisions: [a, a] }, { revisions: [a], paths: ['topic.txt'] }, { baseRef: 42 }, { revisions: ['HEAD'] }]) await assert.rejects(() => f.exportSeries(options), error => error.code === 'ASTRAGIT_GIT_PATCH_SERIES_INVALID');
  assert.equal(await f.git('rev-parse', 'HEAD'), merge);
});

test('dirty, hidden and colliding targets are explained before mailbox writes; temporary index checks leave real flags intact', async t => {
  const f = await fixture(t); const a = await f.commit('file.txt', 'new\n'); const artifact = await f.exportSeries({ revisions: [a] }); const mailbox = input(artifact); const path = await f.clone('dirty'); await f.at(path, 'update-index', '--assume-unchanged', 'file.txt'); await writeFile(join(path, 'file.txt'), 'hidden\n'); const index = await readFile(join(path, '.git/index'));
  const preview = await getProjectGitMailboxPreview(path, mailbox); assert.equal(preview.applicable, false); assert.match(preview.diagnostics, /file\.txt/u); assert.deepEqual(await readFile(join(path, '.git/index')), index); await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_BLOCKED'); assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'hidden\n'); assert.equal(await f.at(path, 'rev-parse', 'HEAD'), f.base);
  const created = await f.commit('new.txt', 'added\n'); const addition = input(await f.exportSeries({ revisions: [created] })); const collision = await f.clone('collision'); await writeFile(join(collision, 'new.txt'), 'keep untracked\n'); assert.equal((await getProjectGitMailboxPreview(collision, addition)).applicable, false);
});

test('preview binding covers input options, staged versions, working contents, branch identity and existing integration', async t => {
  const f = await fixture(t); const sha = await f.commit('file.txt', 'new\n'); const mailbox = input(await f.exportSeries({ revisions: [sha] })); const path = await f.clone('stale'); const preview = await getProjectGitMailboxPreview(path, mailbox); await f.at(path, 'checkout', '-b', 'other'); await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_CHANGED'); await f.at(path, 'checkout', 'main');
  await assert.rejects(() => f.importSeries(path, { ...mailbox, keepSubject: false }, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_CHANGED'); await writeFile(join(path, 'file.txt'), 'later work\n'); await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_CHANGED'); assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'later work\n');
});

test('mailbox conflicts are distinct from rebase and native continuation keeps the remaining series and original authors', async t => {
  const f = await fixture(t); const a = await f.commit('a.txt', 'first\n', 'first', author(1)); const b = await f.commit('file.txt', 'incoming\n', 'second', author(2)); const c = await f.commit('c.txt', 'last\n', 'third', author(3)); const mailbox = input(await f.exportSeries({ revisions: [c, b, a] })); const path = await f.clone('conflict'); await writeFile(join(path, 'file.txt'), 'current\n'); await f.at(path, 'commit', '-am', 'destination'); const destination = await f.at(path, 'rev-parse', 'HEAD'); const preview = await getProjectGitMailboxPreview(path, mailbox); const result = await f.importSeries(path, mailbox, preview); assert.equal(result.outcome, 'conflict'); const paused = await getProjectGitRepositorySnapshot(path); assert.equal(paused.integrationState, 'am'); assert.deepEqual(paused.conflictFiles, ['file.txt']); assert.equal(await f.at(path, 'rev-list', '--count', `${destination}..HEAD`), '1');
  await writeFile(join(path, 'file.txt'), 'resolved\n'); await f.at(path, 'add', 'file.txt'); await f.run(path, { type: 'continue_integration', kind: 'am' }); assert.equal((await getProjectGitRepositorySnapshot(path)).integrationState, null); assert.equal(await f.at(path, 'show', '-s', '--format=%an', 'HEAD'), 'Author 3 中文'); assert.equal(await f.at(path, 'show', '-s', '--format=%an', 'HEAD~1'), 'Author 2 中文'); assert.equal(await readFile(join(path, 'c.txt'), 'utf8'), 'last\n');
});

test('mailbox skip reviews and discards the current resolution, then applies later patches; abort restores the original destination', async t => {
  const f = await fixture(t); const a = await f.commit('a.txt', 'first\n'); const b = await f.commit('file.txt', 'incoming\n'); const c = await f.commit('c.txt', 'last\n'); const mailbox = input(await f.exportSeries({ revisions: [a, b, c] }));
  for (const action of ['skip', 'abort']) { const path = await f.clone(action); await writeFile(join(path, 'file.txt'), 'destination\n'); await f.at(path, 'commit', '-am', 'destination'); const original = await f.at(path, 'rev-parse', 'HEAD'); await f.importSeries(path, mailbox, await getProjectGitMailboxPreview(path, mailbox));
    if (action === 'skip') { const preview = await getProjectGitSkipPreview(path, 'am'); await writeFile(join(path, 'file.txt'), 'edited resolution\n'); await assert.rejects(() => f.run(path, { type: 'skip_integration', kind: 'am', expectedFingerprint: preview.fingerprint }), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_PREVIEW_CHANGED'); const next = await getProjectGitSkipPreview(path, 'am'); await f.run(path, { type: 'skip_integration', kind: 'am', expectedFingerprint: next.fingerprint }); assert.equal(await readFile(join(path, 'file.txt'), 'utf8'), 'destination\n'); assert.equal(await readFile(join(path, 'c.txt'), 'utf8'), 'last\n'); }
    else { await f.run(path, { type: 'abort_integration', kind: 'am' }); assert.equal(await f.at(path, 'rev-parse', 'HEAD'), original); await assert.rejects(() => readFile(join(path, 'a.txt'))); }
    assert.equal((await getProjectGitRepositorySnapshot(path)).integrationState, null);
  }
});

test('mailbox paths cannot traverse symlink ancestors or metadata, and ordinary diff input is not accepted as mail', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'dir')); const sha = await f.commit('dir/file.txt', 'new\n'); const mailbox = input(await f.exportSeries({ revisions: [sha] })); const path = await f.clone('links'); const outside = join(f.root, 'outside'); await mkdir(outside); await symlink(outside, join(path, 'dir'));
  await assert.rejects(() => getProjectGitMailboxPreview(path, mailbox), error => error.code === 'ASTRAGIT_GIT_PATCH_PATH_INVALID'); await assert.rejects(() => readFile(join(outside, 'file.txt')));
  await assert.rejects(() => getProjectGitMailboxPreview(path, { ...mailbox, data: 'diff --git a/x b/x\n', encoding: 'utf8' })); assert.equal(await f.at(path, 'rev-parse', 'HEAD'), f.base);
});

test('HTTP mailbox preview is read-only, import requires its dedicated envelope, and replay after restart cannot create duplicate commits', async t => {
  const f = await fixture(t); const sha = await f.commit('file.txt', 'incoming\n'); const mailbox = input(await f.exportSeries({ revisions: [sha] })); const path = await f.clone('http'); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'mailbox-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); f.cleanup.push(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Mailbox', localPath: path }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const preview = await client.previewRepositoryGitMailbox(project.id, repository.id, mailbox); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
  const action = { type: 'import_mailbox', mailbox, expectedFingerprint: preview.fingerprint }; const body = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action }); const send = async (value, route = 'patch-import') => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(value) }); return { status: response.status, value: await response.json() }; };
  assert.notEqual((await send(action)).status, 200); assert.notEqual((await send(body, 'actions')).status, 200); const first = await send(body); assert.equal(first.status, 200, JSON.stringify(first.value)); const imported = await f.at(path, 'rev-parse', 'HEAD'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); assert.deepEqual(await send(body), first); assert.equal(await f.at(path, 'rev-parse', 'HEAD'), imported); assert.equal((await client.loadProjectGitOperations(project.id)).items.filter(item => item.action === 'import_mailbox').length, 1);
});

test('a failed non-three-way import pauses as am without misreporting a merge conflict or accepting rebase controls', async t => {
  const f = await fixture(t); const sha = await f.commit('file.txt', 'incoming\n'); const mailbox = input(await f.exportSeries({ revisions: [sha] }), { threeWay: false }); const path = await f.clone('plain-failure'); await writeFile(join(path, 'file.txt'), 'destination\n'); await f.at(path, 'commit', '-am', 'destination'); const preview = await getProjectGitMailboxPreview(path, mailbox);
  await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_PAUSED' && error.operationStatus === 'unknown_after_write'); const snapshot = await getProjectGitRepositorySnapshot(path); assert.equal(snapshot.integrationState, 'am'); assert.equal(snapshot.conflictFiles.length, 0); await assert.rejects(() => f.run(path, { type: 'continue_integration', kind: 'rebase' }), error => error.code === 'ASTRAGIT_GIT_INTEGRATION_CHANGED'); await f.run(path, { type: 'abort_integration', kind: 'am' }); assert.equal((await getProjectGitRepositorySnapshot(path)).integrationState, null);
});

test('an empty first email can pause and be skipped in an unborn repository without requiring a nonexistent HEAD', async t => {
  const f = await fixture(t); const empty = await f.commit('empty', null, 'empty first'); const mailbox = input(await f.exportSeries({ revisions: [empty] }), { empty: 'stop' }); const path = join(f.root, 'empty-unborn'); await mkdir(path); await f.at(path, 'init', '-b', 'main'); await f.configure(path); const preview = await getProjectGitMailboxPreview(path, mailbox);
  await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_PAUSED'); assert.equal((await getProjectGitRepositorySnapshot(path)).integrationState, 'am'); const skip = await getProjectGitSkipPreview(path, 'am'); assert.equal(skip.headSha, ''); await f.run(path, { type: 'skip_integration', kind: 'am', expectedFingerprint: skip.fingerprint }); const snapshot = await getProjectGitRepositorySnapshot(path); assert.equal(snapshot.integrationState, null); assert.equal(snapshot.headSha, '');
});

test('cancellation of an in-flight mail hook preserves unknown outcome and refuses reimport using the old preview', async t => {
  const f = await fixture(t); const sha = await f.commit('file.txt', 'incoming\n'); const mailbox = input(await f.exportSeries({ revisions: [sha] })); const path = await f.clone('cancel'); const preview = await getProjectGitMailboxPreview(path, mailbox); const hooks = join(f.root, 'hooks'); await mkdir(hooks); const marker = join(f.root, 'hook-started');
  await writeFile(join(hooks, 'applypatch-msg'), `#!/bin/sh\necho started > '${marker}'\nsleep 20\nexit 1\n`, { mode: 0o755 }); const controller = new AbortController(); const attempt = f.run(path, { type: 'import_mailbox', mailbox, expectedFingerprint: preview.fingerprint }, controller.signal).then(value => ({ value }), error => ({ error }));
  let started = false; for (let index = 0; index < 200; index++) { if (await readFile(marker, 'utf8').catch(() => '')) { started = true; break; } await new Promise(resolve => setTimeout(resolve, 20)); } assert.ok(started); controller.abort(); const result = await attempt; assert.equal(result.error.operationStatus, 'unknown_after_write'); assert.equal((await getProjectGitRepositorySnapshot(path)).integrationState, 'am'); await assert.rejects(() => f.importSeries(path, mailbox, preview), error => error.code === 'ASTRAGIT_GIT_MAILBOX_CHANGED'); await f.run(path, { type: 'abort_integration', kind: 'am' }); assert.equal(await f.at(path, 'rev-parse', 'HEAD'), f.base);
});

test('mailbox imports above one MiB retain full binary bytes through the real HTTP client', async t => {
  const f = await fixture(t); const binary = randomBytes(900_000); const sha = await f.commit('large.bin', binary); const path = await f.clone('large-http'); const data = join(f.root, 'large-data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'large-mailbox', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Large mailbox', localPath: f.cwd }); const sourceRepository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const artifact = await client.exportRepositoryGitPatch(project.id, sourceRepository.id, { scope: 'series', revisions: [sha] }); assert.ok(artifact.byteLength > 1024 * 1024);
  const destination = await client.createProject({ name: 'Destination', localPath: path }); const repository = (await client.loadProjectGitWorkbench(destination.id)).repositories[0]; const mailbox = input(artifact); const preview = await client.previewRepositoryGitMailbox(destination.id, repository.id, mailbox); await client.executeProjectGitAction(destination.id, repository.id, { type: 'import_mailbox', mailbox, expectedFingerprint: preview.fingerprint }); assert.deepEqual(await readFile(join(path, 'large.bin')), binary);
});
