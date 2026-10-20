import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { readProjectGitConflict, saveProjectGitConflict } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { ProjectGitWorkbenchService } from '../packages/git-server/dist/projectGitWorkbenchService.js';
import { ProjectStore } from '../packages/git-server/dist/projectStore.js';
import { OperationHistoryStore } from '../packages/git-server/dist/operationHistoryStore.js';

const execute = promisify(execFile);
const gitInput = (cwd, args, input) => new Promise((resolve, reject) => { const child = execFile('git', args, { cwd }, error => error ? reject(error) : resolve()); child.stdin.end(input); });
async function fixture(t, input = {}) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-conflict-'));
  const repository = join(root, 'repo'); await mkdir(repository);
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await execute('git', args, { cwd: repository, env: { ...process.env, LC_ALL: 'C' } })).stdout.trim();
  const path = input.path ?? '冲突 文件.txt';
  await mkdir(join(repository, path, '..'), { recursive: true });
  const put = value => writeFile(join(repository, path), value);
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'AstraGit Test'); await git('config', 'user.email', 'test@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  if (!input.addAdd) await put(input.base ?? 'base\n'); await writeFile(join(repository, 'other.txt'), 'other base\n'); await git('add', '.'); await git('commit', '-m', 'base');
  await git('switch', '-c', 'incoming');
  if (input.incomingDeleted) await rm(join(repository, path)); else await put(input.incoming ?? 'incoming\n');
  await git('add', '-A'); await git('commit', '-m', 'incoming');
  await git('switch', 'main'); await put(input.current ?? 'current\n'); await git('add', '.'); await git('commit', '-m', 'current');
  await assert.rejects(input.rebase ? git('rebase', 'incoming') : git('-c', 'merge.conflictStyle=diff3', 'merge', '--no-edit', 'incoming'));
  const read = () => readProjectGitConflict(repository, path);
  const save = (file, value) => saveProjectGitConflict(repository, { path, expectedFingerprint: file.fingerprint, markResolved: false, ...value });
  return { root, repository, path, git, put, read, save };
}
const rejectsCode = (work, code) => assert.rejects(work, error => { assert.equal(error.code ?? error.error, code); return true; });

test('project conflict reads real Git stages and saves drafts separately from resolving without committing', async t => {
  const f = await fixture(t); const head = await f.git('rev-parse', 'HEAD'); const merge = await f.git('rev-parse', 'MERGE_HEAD');
  await writeFile(join(f.repository, 'other.txt'), 'unselected staged\n'); await f.git('add', 'other.txt');
  const beforeIndex = await f.git('ls-files', '--stage'); const file = await f.read();
  assert.equal(file.kind, 'text'); assert.equal(file.editable, true); assert.equal(file.markerSize, 7);
  assert.equal(file.base, 'base\n'); assert.equal(file.current, 'current\n'); assert.equal(file.incoming, 'incoming\n'); assert.match(file.worktree, /^<<<<<<< HEAD/u);
  assert.deepEqual(file.indexStages.map(stage => stage.stage), [1, 2, 3]);
  const draft = await f.save(file, { content: 'my combined result\n' });
  assert.deepEqual(draft.remainingConflictFiles, [f.path]); assert.equal(draft.conflict.worktree, 'my combined result\n'); assert.notEqual(draft.conflict.fingerprint, file.fingerprint);
  assert.equal(await f.git('ls-files', '--stage'), beforeIndex, 'Saving a draft must not stage anything.');
  const resolved = await f.save(draft.conflict, { content: 'my combined result\n', markResolved: true });
  assert.equal(resolved.conflict, null); assert.deepEqual(resolved.remainingConflictFiles, []); assert.equal(await f.git('show', `:${f.path}`), 'my combined result');
  assert.equal(await f.git('show', ':other.txt'), 'unselected staged'); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('rev-parse', 'MERGE_HEAD'), merge);
});

test('stale worktree and resolved index snapshots cannot overwrite newer edits', async t => {
  const f = await fixture(t); const original = await f.read();
  await f.put('external editor changed this\n');
  await rejectsCode(() => f.save(original, { content: 'stale content\n' }), 'ASTRAGIT_GIT_CONFLICT_STALE');
  assert.equal(await readFile(join(f.repository, f.path), 'utf8'), 'external editor changed this\n');
  const fresh = await f.read(); await f.git('add', '--', f.path);
  await rejectsCode(() => f.save(fresh, { content: 'stale resolved content\n', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_NOT_FOUND');
  assert.equal(await f.git('show', `:${f.path}`), 'external editor changed this');
});

test('an externally changed unmerged stage or HEAD invalidates the editor snapshot', async t => {
  const f = await fixture(t); const original = await f.read(); const before = await readFile(join(f.repository, f.path), 'utf8');
  await writeFile(join(f.repository, 'alternate.txt'), 'new incoming object\n'); const oid = await f.git('hash-object', '-w', 'alternate.txt');
  await gitInput(f.repository, ['update-index', '--index-info'], `100644 ${oid} 3\t${f.path}\n`);
  await rejectsCode(() => f.save(original, { content: 'old result\n', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_STALE');
  const changed = await f.read(); await f.git('update-ref', 'HEAD', 'HEAD~1');
  await rejectsCode(() => f.save(changed, { content: 'another old result\n', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_STALE');
  assert.equal(await readFile(join(f.repository, f.path), 'utf8'), before);
});

test('mark resolved rejects normal and malformed markers using the configured Git marker size', async t => {
  const f = await fixture(t); await writeFile(join(f.repository, '.gitattributes'), '*.txt conflict-marker-size=11\n');
  const file = await f.read(); assert.equal(file.markerSize, 11);
  for (const content of ['<<<<<<<<<<< current\nleft\n===========\nright\n>>>>>>>>>>> incoming\n', '<<<<<<<<<<< current\nmissing end\n', '>>>>>>>>>>> orphan end\n']) {
    await rejectsCode(() => f.save(file, { content, markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_MARKERS_REMAIN');
  }
  assert.equal(await readFile(join(f.repository, f.path), 'utf8'), file.worktree);
  const saved = await f.save(file, { content: '<<<<<<< ordinary shorter source delimiter\n', markResolved: true });
  assert.deepEqual(saved.remainingConflictFiles, []);
});

test('accepting an absent modify/delete side resolves as deletion rather than an empty text file', async t => {
  const f = await fixture(t, { incomingDeleted: true }); const file = await f.read();
  assert.equal(file.incoming, null); assert.deepEqual(file.indexStages.map(stage => stage.stage), [1, 2]); assert.equal(file.canAcceptIncoming, true);
  const result = await f.save(file, { acceptSide: 'incoming', markResolved: true });
  assert.deepEqual(result.remainingConflictFiles, []); await assert.rejects(readFile(join(f.repository, f.path)), { code: 'ENOENT' });
  assert.equal(await f.git('ls-files', '--', f.path), '');
});

test('add/add has no base, and a rebase keeps Git stage identities and its pending continuation', async t => {
  await t.test('add/add', async sub => {
    const f = await fixture(sub, { addAdd: true }); const file = await f.read();
    assert.equal(file.base, null); assert.deepEqual(file.indexStages.map(stage => stage.stage), [2, 3]);
    const result = await f.save(file, { acceptSide: 'incoming', markResolved: true });
    assert.deepEqual(result.remainingConflictFiles, []); assert.equal(await f.git('show', `:${f.path}`), 'incoming');
  });
  await t.test('rebase', async sub => {
    const f = await fixture(sub, { rebase: true }); const file = await f.read(); const head = await f.git('rev-parse', 'HEAD'); const rebaseHead = await f.git('rev-parse', 'REBASE_HEAD');
    assert.equal(file.current, 'incoming\n'); assert.equal(file.incoming, 'current\n');
    await f.save(file, { acceptSide: 'current', markResolved: true });
    assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await f.git('rev-parse', 'REBASE_HEAD'), rebaseHead); assert.match(await f.git('status'), /rebase in progress/u);
  });
});

test('binary and symlink conflicts cannot be overwritten through the text editor', async t => {
  await t.test('binary', async sub => {
    const f = await fixture(sub, { path: 'binary.bin', base: Buffer.from([0, 1, 2]), current: Buffer.from([0, 1, 3]), incoming: Buffer.from([0, 1, 4]) });
    const before = await readFile(join(f.repository, f.path)); const file = await f.read();
    assert.equal(file.kind, 'binary'); assert.equal(file.editable, false); assert.equal(file.canAcceptCurrent, false);
    await rejectsCode(() => f.save(file, { content: 'not binary', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_TEXT_UNSUPPORTED');
    assert.deepEqual(await readFile(join(f.repository, f.path)), before);
  });
  await t.test('leaf symlink', async sub => {
    const f = await fixture(sub); const outside = join(f.root, 'outside.txt'); await writeFile(outside, 'outside must remain\n');
    await rm(join(f.repository, f.path)); await symlink(outside, join(f.repository, f.path));
    const file = await f.read(); assert.equal(file.kind, 'symlink'); assert.equal(file.worktree, null);
    await rejectsCode(() => f.save(file, { content: 'bad overwrite', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_TEXT_UNSUPPORTED');
    assert.equal(await readFile(outside, 'utf8'), 'outside must remain\n');
  });
});

test('parent symlinks, traversal and Git administration paths are refused without touching external files', async t => {
  const f = await fixture(t, { path: 'nested/file.txt' }); const file = await f.read();
  for (const path of ['../outside.txt', '/tmp/outside.txt', '.git/config', 'nested/../file.txt']) await rejectsCode(() => readProjectGitConflict(f.repository, path), 'ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE');
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'file.txt'), 'outside\n');
  await rename(join(f.repository, 'nested'), join(f.repository, 'previous-nested')); await symlink(outside, join(f.repository, 'nested'));
  await rejectsCode(() => f.read(), 'ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE');
  await rejectsCode(() => f.save(file, { content: 'bad overwrite', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_PATH_UNSAFE');
  assert.equal(await readFile(join(outside, 'file.txt'), 'utf8'), 'outside\n');
});

test('gitlink stages remain available as metadata but cannot enter the text-save path', async t => {
  const f = await fixture(t, { path: 'submodule' });
  const [base, current, incoming] = await Promise.all([f.git('rev-parse', 'HEAD~1'), f.git('rev-parse', 'HEAD'), f.git('rev-parse', 'incoming')]);
  await gitInput(f.repository, ['update-index', '--index-info'], `0 ${'0'.repeat(40)}\tsubmodule\n160000 ${base} 1\tsubmodule\n160000 ${current} 2\tsubmodule\n160000 ${incoming} 3\tsubmodule\n`);
  await rm(join(f.repository, 'submodule')); await mkdir(join(f.repository, 'submodule')); await writeFile(join(f.repository, 'submodule/keep.txt'), 'child data\n');
  const file = await f.read(); assert.equal(file.kind, 'gitlink'); assert.equal(file.editable, false); assert.ok(file.indexStages.every(stage => stage.mode === '160000'));
  await rejectsCode(() => f.save(file, { acceptSide: 'current', markResolved: true }), 'ASTRAGIT_GIT_CONFLICT_TEXT_UNSUPPORTED');
  assert.equal(await readFile(join(f.repository, 'submodule/keep.txt'), 'utf8'), 'child data\n');
});

test('an existing Git index lock is preserved and prevents saving the working tree', async t => {
  const f = await fixture(t); const file = await f.read(); const lock = join(f.repository, '.git/index.lock'); await writeFile(lock, 'foreign lock');
  await rejectsCode(() => f.save(file, { content: 'must not write', markResolved: true }), 'ASTRAGIT_GIT_INDEX_LOCKED');
  assert.equal(await readFile(lock, 'utf8'), 'foreign lock'); assert.equal(await readFile(join(f.repository, f.path), 'utf8'), file.worktree);
});

test('failed staging retains the saved working draft and does not replace the real unmerged index', async t => {
  const f = await fixture(t); await writeFile(join(f.repository, '.gitattributes'), '*.txt filter=reject\n');
  await f.git('config', 'filter.reject.clean', 'false'); await f.git('config', 'filter.reject.required', 'true');
  const file = await f.read(); const stages = await f.git('ls-files', '--stage');
  await assert.rejects(() => f.save(file, { content: 'saved draft before failed stage\n', markResolved: true }), error => {
    assert.equal(error.operationStage, 'conflict_save'); assert.equal(error.operationStatus, 'unknown_after_write'); return true;
  });
  assert.equal(await readFile(join(f.repository, f.path), 'utf8'), 'saved draft before failed stage\n'); assert.equal(await f.git('ls-files', '--stage'), stages);
  await assert.rejects(readFile(join(f.repository, '.git/index.lock')), { code: 'ENOENT' });
});

test('project repository ownership and the desktop API contract are enforced for conflict reads and writes', async t => {
  const f = await fixture(t); const data = join(f.root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: f.repository, apiToken: 'conflict-fixture', codexNativeEnabled: false, secretStore: createFileSecretStore(join(data, 'secrets.json')) }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ localPath: f.repository }); const repo = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const endpoint = `${server.baseUrl}/api/projects/${encodeURIComponent(project.id)}/git/workbench/repositories/${encodeURIComponent(repo.id)}/conflict`;
  for (const origin of ['http://127.0.0.1:5179', 'null']) {
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-astragit-api-token' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.ok(preflight.headers.get('access-control-allow-methods').split(',').includes('PUT')); assert.match(preflight.headers.get('access-control-allow-headers'), /x-astragit-api-token/u);
  }
  const file = await client.readProjectGitConflict(project.id, repo.id, f.path); assert.equal(file.current, 'current\n');
  const other = join(f.root, 'other'); await mkdir(other); const otherProject = await client.createProject({ localPath: other });
  await rejectsCode(() => client.readProjectGitConflict(otherProject.id, repo.id, f.path), 'ASTRAGIT_REPOSITORY_NOT_FOUND');
  const result = await client.saveProjectGitConflict(project.id, repo.id, { path: f.path, expectedFingerprint: file.fingerprint, content: 'resolved via API\n', markResolved: true });
  assert.equal(result.conflict, null); assert.deepEqual(result.snapshot.conflictFiles, []); assert.equal(result.snapshot.integrationState, 'merge'); assert.equal(await f.git('show', `:${f.path}`), 'resolved via API');
});

test('conflict PUT accepts the decoded 2 MiB text limit including JSON escapes without relaxing other API body limits', async t => {
  const f = await fixture(t); const data = join(f.root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: f.repository, apiToken: 'large-conflict-fixture', codexNativeEnabled: false, secretStore: createFileSecretStore(join(data, 'secrets.json')) }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ localPath: f.repository }); const repo = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const file = await client.readProjectGitConflict(project.id, repo.id, f.path);
  // One-byte UTF-8 control characters serialize as six-byte JSON escapes. No NUL bytes are used.
  const content = '\u0001'.repeat(2 * 1024 * 1024);
  const body = JSON.stringify({ path: f.path, expectedFingerprint: file.fingerprint, content, markResolved: false });
  assert.ok(Buffer.byteLength(body) > 12 * 1024 * 1024);
  const endpoint = `${server.baseUrl}/api/projects/${encodeURIComponent(project.id)}/git/workbench/repositories/${encodeURIComponent(repo.id)}/conflict`;
  const headers = { Origin: 'http://localhost:5179', 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken };
  const response = await fetch(endpoint, { method: 'PUT', headers, body }); assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), headers.Origin);
  const saved = await response.json(); assert.equal(saved.conflict.worktree.length, content.length); assert.ok(saved.conflict.worktree === content); assert.equal(saved.conflict.editable, true); assert.deepEqual(saved.remainingConflictFiles, [f.path]);
  assert.equal((await readFile(join(f.repository, f.path))).byteLength, 2 * 1024 * 1024);
  const oversized = await fetch(endpoint, { method: 'PUT', headers, body: JSON.stringify({ path: f.path, expectedFingerprint: saved.conflict.fingerprint, content: 'x'.repeat(2 * 1024 * 1024 + 1), markResolved: false }) });
  assert.equal(oversized.status, 400); assert.equal((await oversized.json()).error, 'ASTRAGIT_GIT_CONFLICT_CONTENT_INVALID');
  assert.ok(await readFile(join(f.repository, f.path), 'utf8') === content);
  const otherApi = await fetch(`${server.baseUrl}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ localPath: f.repository, padding: 'x'.repeat(1024 * 1024) }) });
  assert.equal(otherApi.status, 413, 'The 1 MiB default must still apply to unrelated APIs.');
});

test('conflict read/save share the active Git command gate instead of racing an in-progress stage', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); await mkdir(data);
  const projects = new ProjectStore(data); const operations = new OperationHistoryStore(data); const service = new ProjectGitWorkbenchService(projects, operations);
  const project = projects.create({ name: 'Fixture', localPath: f.repository }); const repo = (await service.loadWorkbench(project.id)).repositories[0]; const file = await service.readConflict(project.id, repo.id, f.path);
  const marker = join(f.root, 'filter-running'); const release = join(f.root, 'release-filter'); const filter = join(f.root, 'filter.mjs');
  await writeFile(filter, `import fs from 'node:fs';const data=fs.readFileSync(0);fs.writeFileSync(${JSON.stringify(marker)},'running');while(!fs.existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10));process.stdout.write(data);`); await chmod(filter, 0o755);
  await writeFile(join(f.repository, '.gitattributes'), 'other.txt filter=wait\n'); await f.git('config', 'filter.wait.clean', `${process.execPath} ${filter}`); await writeFile(join(f.repository, 'other.txt'), 'work to stage\n');
  const staging = service.execute(project.id, repo.id, { type: 'stage', paths: ['other.txt'] });
  try {
    const until = Date.now() + 3000; while (true) { try { await readFile(marker); break; } catch { if (Date.now() > until) assert.fail('Git filter did not start'); await new Promise(r => setTimeout(r, 10)); } }
    await rejectsCode(() => service.readConflict(project.id, repo.id, f.path), 'ASTRAGIT_BUSY');
    await rejectsCode(() => service.saveConflict(project.id, repo.id, { path: f.path, expectedFingerprint: file.fingerprint, content: 'must wait', markResolved: false }), 'ASTRAGIT_BUSY');
  } finally { await writeFile(release, 'go'); await staging; }
  assert.equal(await readFile(join(f.repository, f.path), 'utf8'), file.worktree);
});
