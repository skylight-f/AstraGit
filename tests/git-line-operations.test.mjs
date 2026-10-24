import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitLineDiff, parseGitLineChange } from '../packages/git-core/dist/index.js';
import { alignedDiffRows } from '../apps/desktop/src/renderer/git/gitDiffRows.ts';
import { selectGitFilePaths } from '../apps/desktop/src/renderer/git/gitFileSelection.ts';
import { prepareGitLineChanges } from '../packages/git-core/src/gitLineOperations.ts';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';

const exec = promisify(execFile);
async function fixture(t, files = { 'file.txt': 'start\noldA\noldB\nend\n' }, unborn = false) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-lines-test-')); const cwd = join(root, 'repo'); await mkdir(cwd); const global = join(root, 'global'); await writeFile(global, '');
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const raw = async (...args) => (await exec('git', args, { cwd, env, maxBuffer: 20 * 1024 ** 2 })).stdout;
  const git = async (...args) => (await raw(...args)).trim();
  const write = async (path, value) => { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), value); };
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'Line Test'); await git('config', 'user.email', 'line@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.autocrlf', 'false');
  for (const [path, content] of Object.entries(files)) await write(path, content);
  if (!unborn) { await git('add', '.'); await git('commit', '-qm', 'base'); }
  const preview = (path = 'file.txt', stage = 'unstaged') => getProjectGitLineDiff(cwd, { path, stage });
  const input = (value, operation, choose = () => true) => ({ path: value.path, stage: value.stage, expectedFingerprint: value.fingerprint, operation, selection: value.diff.fileDiffs[0].hunks.flatMap((hunk, index) => { const lines = hunk.lines.flatMap((line, index) => ['addition', 'deletion'].includes(line.type) && choose(line) ? [index] : []); return lines.length ? [{ hunk: index, lines }] : []; }) });
  const run = value => executeProjectGitAction(cwd, { type: 'apply_line_changes', input: value }, undefined, env);
  const blob = async (path = 'file.txt') => (await exec('git', ['show', ':' + path], { cwd, env, encoding: 'buffer', maxBuffer: 20 * 1024 ** 2 })).stdout;
  const objects = () => readdir(join(cwd, '.git/objects'), { recursive: true }).then(paths => paths.sort());
  return { root, cwd, env, git, raw, write, preview, input, run, blob, objects };
}

test('line preview and native applicability checking leave the real index, refs, object store and hooks unchanged', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n');
  const index = await readFile(join(f.cwd, '.git/index')); const config = await readFile(join(f.cwd, '.git/config')); const objects = await f.objects(); const head = await f.git('rev-parse', 'HEAD');
  const preview = await f.preview(); const prepared = await prepareGitLineChanges(f.cwd, f.input(preview, 'stage', line => line.content === 'newA'), { env: f.env }); assert.ok(prepared.bytes.length);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.deepEqual(await f.objects(), objects); assert.equal(await f.git('rev-parse', 'HEAD'), head); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'start\nnewA\nnewB\nend\n');
});

test('stage selected additions and deletions without staging other lines, unrelated files or file mode changes', async t => {
  const f = await fixture(t, { 'file.txt': 'start\noldA\noldB\nend\n', 'other.txt': 'other\n' }); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); await f.write('other.txt', 'unrelated\n'); await chmod(join(f.cwd, 'file.txt'), 0o755); await f.git('update-index', '--assume-unchanged', 'other.txt'); const other = await f.raw('ls-files', '--stage', '-v', '--', 'other.txt');
  const preview = await f.preview(); await f.run(f.input(preview, 'stage', line => ['oldA', 'newA'].includes(line.content)));
  assert.deepEqual(await f.blob(), Buffer.from('start\noldB\nnewA\nend\n')); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'start\nnewA\nnewB\nend\n'); assert.equal(await f.raw('ls-files', '--stage', '-v', '--', 'other.txt'), other); assert.match(await f.git('ls-files', '--stage', '--', 'file.txt'), /^100644 /u);
});

test('partial unstage restores only selected original lines and preserves newer unstaged worktree content', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); await f.git('add', 'file.txt'); await f.write('file.txt', 'start\nnewA\nnewest-worktree\nend\n');
  const preview = await f.preview('file.txt', 'staged'); await f.run(f.input(preview, 'unstage', line => ['oldB', 'newB'].includes(line.content)));
  assert.deepEqual(await f.blob(), Buffer.from('start\nnewA\noldB\nend\n')); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'start\nnewA\nnewest-worktree\nend\n');
});

test('partial discard changes only selected worktree lines and leaves the index untouched', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); const index = await readFile(join(f.cwd, '.git/index'));
  const preview = await f.preview(); await f.run(f.input(preview, 'discard', line => ['oldB', 'newB'].includes(line.content)));
  assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'start\nnewA\noldB\nend\n'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('unborn untracked files support partial stage and complete unstage without creating commits or deleting worktree bytes', async t => {
  const f = await fixture(t, { 'file.txt': 'one\ntwo\nthree\n' }, true); const objects = await f.objects(); const preview = await f.preview(); assert.equal(preview.headSha, ''); assert.deepEqual(await f.objects(), objects); await assert.rejects(() => readFile(join(f.cwd, '.git/index')), error => error.code === 'ENOENT');
  await f.run(f.input(preview, 'stage', line => line.content === 'two')); assert.deepEqual(await f.blob(), Buffer.from('two\n'));
  const staged = await f.preview('file.txt', 'staged'); await f.run(f.input(staged, 'unstage')); assert.equal(await f.git('ls-files', '--', 'file.txt'), ''); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'one\ntwo\nthree\n'); await assert.rejects(() => f.git('rev-parse', '--verify', 'HEAD'));
});

test('deleted files can stage some deletions, stage the rest, and unstage only selected deleted lines', async t => {
  const f = await fixture(t, { 'file.txt': 'one\ntwo\nthree\n' }); await rm(join(f.cwd, 'file.txt'));
  await f.run(f.input(await f.preview(), 'stage', line => line.content === 'two')); assert.deepEqual(await f.blob(), Buffer.from('one\nthree\n'));
  await f.run(f.input(await f.preview(), 'stage')); assert.equal(await f.git('ls-files', '--', 'file.txt'), '');
  await f.run(f.input(await f.preview('file.txt', 'staged'), 'unstage', line => line.content === 'two')); assert.deepEqual(await f.blob(), Buffer.from('two\n')); await assert.rejects(() => readFile(join(f.cwd, 'file.txt')), error => error.code === 'ENOENT');
});

test('line identities remain correct with C quoted filenames and user diff prefix, algorithm and relative settings', { skip: process.platform === 'win32' }, async t => {
  const path = 'a/line\n字\t".txt'; const f = await fixture(t, { [path]: 'old\nend\n' }); await f.write(path, 'new    \nend\n');
  for (const [name, value] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'], ['diff.srcPrefix', 'source/'], ['diff.dstPrefix', 'target/'], ['diff.algorithm', 'histogram'], ['diff.relative', 'true']]) await f.git('config', name, value);
  const preview = await f.preview(path); assert.equal(preview.diff.fileDiffs[0].newPath, path); await f.run(f.input(preview, 'stage')); assert.deepEqual(await f.blob(path), Buffer.from('new    \nend\n'));
});

test('native autocrlf conversion stages canonical bytes and discards selected lines back to CRLF', async t => {
  const f = await fixture(t); await f.git('config', 'core.autocrlf', 'true'); await f.write('file.txt', 'start\r\nnewA\r\nnewB\r\nend\r\n');
  await f.run(f.input(await f.preview(), 'stage', line => ['oldA', 'newA'].includes(line.content))); assert.deepEqual(await f.blob(), Buffer.from('start\noldB\nnewA\nend\n'));
  await f.run(f.input(await f.preview(), 'discard')); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'start\r\noldB\r\nnewA\r\nend\r\n');
});

test('native working-tree-encoding conversion supports UTF-16 files without exposing corrupted text or writing real preview objects', async t => {
  const f = await fixture(t, { '.gitattributes': 'file.txt working-tree-encoding=UTF-16LE eol=crlf\n', 'file.txt': Buffer.from('start\r\nold\r\nend\r\n', 'utf16le') }); const value = Buffer.from('start\r\nnew    \r\nend\r\n', 'utf16le'); await f.write('file.txt', value); const objects = await f.objects();
  const preview = await f.preview(); assert.deepEqual(await f.objects(), objects); assert.equal(preview.diff.fileDiffs[0].hunks[0].lines.find(line => line.type === 'addition').content, 'new    ');
  await f.run(f.input(preview, 'discard')); assert.deepEqual(await readFile(join(f.cwd, 'file.txt')), Buffer.from('start\r\nold\r\nend\r\n', 'utf16le'));
});

test('no-final-newline line choices preserve EOF or add only the line boundary required by selected insertion', async t => {
  const f = await fixture(t, { 'file.txt': 'old' }); await f.write('file.txt', 'new'); await f.run(f.input(await f.preview(), 'stage', line => line.type === 'addition')); assert.deepEqual(await f.blob(), Buffer.from('old\nnew'));
  await f.run(f.input(await f.preview('file.txt', 'staged'), 'unstage')); assert.deepEqual(await f.blob(), Buffer.from('old'));
  await f.run(f.input(await f.preview(), 'stage')); assert.deepEqual(await f.blob(), Buffer.from('new'));
});

test('changed file bytes, branch, HEAD, index flags and attributes invalidate selected-line confirmation before writes', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n');
  const mutations = [() => f.write('file.txt', 'start\nnewA2\nnewB\nend\n'), () => f.git('branch', '-m', 'renamed'), () => f.git('commit', '--allow-empty', '-qm', 'head moved'), () => f.git('update-index', '--assume-unchanged', 'file.txt'), () => f.write('.gitattributes', '*.txt text eol=lf\n')];
  for (const mutate of mutations) { const preview = await f.preview(); const input = f.input(preview, 'stage'); await mutate(); const index = await readFile(join(f.cwd, '.git/index')); await assert.rejects(() => f.run(input), error => error.code === 'ASTRAGIT_GIT_LINES_CHANGED' && error.operationStatus === 'failed_before_write'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); }
});

test('malformed, context-only and out-of-range line selections never fall back to staging the whole file', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); const preview = await f.preview(); const input = f.input(preview, 'stage'); const index = await readFile(join(f.cwd, '.git/index'));
  for (const selection of [[{ hunk: 0, lines: [0] }], [{ hunk: 999, lines: [0] }], [{ hunk: 0, lines: [999] }]]) await assert.rejects(() => f.run({ ...input, selection }), error => error.code === 'ASTRAGIT_GIT_LINES_INVALID');
  for (const change of [{ ...input, operation: 'discard', stage: 'staged' }, { ...input, selection: [] }, { ...input, path: '../outside' }, { ...input, path: '.git/config' }, { ...input, selection: [{ hunk: 0, lines: ['1'] }] }]) assert.throws(() => parseGitLineChange(change));
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('custom filters, binary contents and symlinks give explicit non-line-operation outcomes', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); await f.write('.gitattributes', 'file.txt filter=custom\n'); const marker = join(f.root, 'filter-ran'); await f.git('config', 'filter.custom.clean', `sh -c 'touch ${marker}; cat'`);
  const filtered = await f.preview(); assert.equal(filtered.readOnlyReason, 'filter'); await assert.rejects(() => readFile(marker), error => error.code === 'ENOENT'); await assert.rejects(() => prepareGitLineChanges(f.cwd, { path: 'file.txt', stage: 'unstaged', operation: 'stage', selection: [{ hunk: 0, lines: [0] }], expectedFingerprint: filtered.fingerprint }, { env: f.env }), error => error.code === 'ASTRAGIT_GIT_LINES_UNSUPPORTED');
  await rm(join(f.cwd, '.gitattributes')); await f.write('file.txt', Buffer.from([0, 255, 1])); assert.equal((await f.preview()).readOnlyReason, 'binary');
  const outside = join(f.root, 'outside'); await writeFile(outside, 'do not read'); await rm(join(f.cwd, 'file.txt')); await symlink(outside, join(f.cwd, 'file.txt')); const link = await f.preview(); assert.equal(link.readOnlyReason, 'file-type'); assert.equal(link.diff.diffText.includes('do not read'), false);
});

test('large, invalidly encoded and cancelled line reads fail explicitly without reporting an empty clean diff', async t => {
  const f = await fixture(t); await f.write('file.txt', Buffer.alloc(8 * 1024 ** 2 + 1, 97)); await assert.rejects(() => f.preview(), error => error.code === 'ASTRAGIT_GIT_LINES_TOO_LARGE');
  await f.write('file.txt', Buffer.from([255, 254, 1])); await assert.rejects(() => f.preview(), error => error.code === 'ASTRAGIT_GIT_LINES_UNSUPPORTED');
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => getProjectGitLineDiff(f.cwd, { path: 'file.txt', stage: 'unstaged' }, controller.signal), error => error.code === 'ASTRAGIT_CANCELLED' && error.operationStatus === 'failed_before_write');
});

test('HTTP line read is read-only and durable selected-line actions replay after restart without applying newer content', async t => {
  const f = await fixture(t); await f.write('file.txt', 'start\nnewA\nnewB\nend\n'); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'line-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'Line Test', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const index = await readFile(join(f.cwd, '.git/index'));
  const preview = await client.loadProjectGitLineDiff(project.id, repository.id, { path: 'file.txt', stage: 'unstaged' }); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  const action = { type: 'apply_line_changes', input: f.input(preview, 'stage', line => ['oldA', 'newA'].includes(line.content)) }; const envelope = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = async () => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/actions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(envelope) }); return { status: response.status, value: await response.json() }; };
  const first = await send(); assert.equal(first.status, 200); const bytes = await f.blob(); await f.write('file.txt', 'newer worktree\n'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  assert.deepEqual(await send(), first); assert.deepEqual(await f.blob(), bytes); await assert.rejects(() => client.executeProjectGitAction(project.id, repository.id, action), error => error.error === 'ASTRAGIT_GIT_LINES_CHANGED');
});


test('real unmerged index entries require the conflict editor and preserve every index stage', async t => {
  const f = await fixture(t); await f.git('checkout', '-qb', 'target'); await f.write('file.txt', 'theirs\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'theirs'); await f.git('checkout', 'main'); await f.write('file.txt', 'ours\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'ours'); await assert.rejects(() => f.git('merge', 'target'));
  const index = await readFile(join(f.cwd, '.git/index')); const stages = await f.raw('ls-files', '--stage', '-z'); await assert.rejects(() => f.preview(), error => error.code === 'ASTRAGIT_GIT_LINES_CONFLICT'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.raw('ls-files', '--stage', '-z'), stages);
});

test('actual rendered line cells and Shift/Ctrl selection keys map to the intended native changed-line identities', async t => {
  const f = await fixture(t, { 'file.txt': 'old1\nold2\nend\n' }); await f.write('file.txt', 'new1\nnew2\nnew3\nend\n'); const preview = await f.preview(); const file = preview.diff.fileDiffs[0];
  const orderedPaths = file.hunks.flatMap((hunk, hunkIndex) => alignedDiffRows(hunk).flatMap(row => [row.left, row.right].flatMap(cell => ['addition', 'deletion'].includes(cell.kind) ? [`${hunkIndex}:${cell.lineIndex}`] : [])));
  const key = content => file.hunks.flatMap((hunk, index) => hunk.lines.flatMap((line, lineIndex) => line.content === content ? [`${index}:${lineIndex}`] : []))[0];
  let selection = { selectedPaths: [], anchor: null };
  for (const [clickedPath, range, additive] of [[key('new1'), false, false], [key('old2'), false, true], [key('new3'), true, false], [key('new1'), false, true]]) selection = selectGitFilePaths({ ...selection, orderedPaths, clickedPath, range, additive });
  assert.deepEqual(new Set(selection.selectedPaths), new Set(['old2', 'new1', 'new2', 'new3'].map(key)));
  const input = f.input(preview, 'stage', line => ['old2', 'new1', 'new2', 'new3'].includes(line.content)); await f.run(input); assert.deepEqual(await f.blob(), Buffer.from('old1\nnew1\nnew2\nnew3\nend\n'));
});

test('new-file line staging honors core.filemode=false exactly like native git add', async t => {
  const f = await fixture(t); await f.git('config', 'core.filemode', 'false'); await f.write('new.sh', 'one\ntwo\n'); await chmod(join(f.cwd, 'new.sh'), 0o755);
  await f.run(f.input(await f.preview('new.sh'), 'stage')); const application = await f.git('ls-files', '--stage', '--', 'new.sh'); assert.match(application, /^100644 /u);
  await f.run(f.input(await f.preview('new.sh', 'staged'), 'unstage')); await f.git('add', 'new.sh'); assert.equal(await f.git('ls-files', '--stage', '--', 'new.sh'), application);
});

test('discarding untracked line selections retains unselected bytes, then removes only the fully selected untracked file', async t => {
  const f = await fixture(t); await f.write('extra.txt', 'one\ntwo\nthree\n'); const index = await readFile(join(f.cwd, '.git/index'));
  await f.run(f.input(await f.preview('extra.txt'), 'discard', line => line.content === 'two')); assert.equal(await readFile(join(f.cwd, 'extra.txt'), 'utf8'), 'one\nthree\n');
  await f.run(f.input(await f.preview('extra.txt'), 'discard')); await assert.rejects(() => readFile(join(f.cwd, 'extra.txt')), error => error.code === 'ENOENT'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.blob('file.txt').then(bytes => bytes.toString()), 'start\noldA\noldB\nend\n');
});

test('discarding selected deletions restores those lines of a missing worktree file without changing the index', async t => {
  const f = await fixture(t, { 'file.txt': 'one\ntwo\nthree\n' }); await rm(join(f.cwd, 'file.txt')); const index = await readFile(join(f.cwd, '.git/index'));
  await f.run(f.input(await f.preview(), 'discard', line => line.content === 'two')); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'two\n'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});
