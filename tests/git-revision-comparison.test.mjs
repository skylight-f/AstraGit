import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { getProjectGitCommitDetail, getProjectGitRevisionsDiff, getProjectGitPatchExport } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
async function fixture(t, sha256 = false) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-revision-comparison-')); const cwd = join(root, 'repo'); await mkdir(cwd);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LANG: 'C', LC_ALL: 'C' };
  const native = (await exec('which', ['git'], { env })).stdout.trim(); const git = async (...args) => (await exec(native, args, { cwd, env, maxBuffer: 20 * 1024 ** 2 })).stdout.trim();
  t.after(() => rm(root, { recursive: true, force: true }));
  await git('init', '-q', '--initial-branch=main', ...(sha256 ? ['--object-format=sha256'] : [])); await git('config', 'user.name', 'Comparison Test'); await git('config', 'user.email', 'comparison@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.autocrlf', 'false');
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git('add', '.'); await git('commit', '-qm', 'base'); const base = await git('rev-parse', 'HEAD');
  await git('switch', '-qc', 'left'); await writeFile(join(cwd, 'file.txt'), 'left\n'); await writeFile(join(cwd, 'left.txt'), 'only left\n'); await git('add', '.'); await git('commit', '-qm', 'left'); const left = await git('rev-parse', 'HEAD');
  await git('switch', '-qc', 'right', base); await writeFile(join(cwd, 'file.txt'), 'right\n'); await writeFile(join(cwd, 'right.txt'), 'only right\n'); await git('add', '.'); await git('commit', '-qm', 'right'); const right = await git('rev-parse', 'HEAD'); await git('switch', 'main');
  return { root, cwd, env, native, git, base, left, right };
}
const lines = comparison => comparison.diff.fileDiffs.find(file => file.newPath === 'file.txt').hunks.flatMap(hunk => hunk.lines).filter(line => line.type === 'addition' || line.type === 'deletion').map(line => [line.type, line.content]);

test('merge parent comparisons show each parent baseline and keep files and exported patches in that scope', async t => {
  const f = await fixture(t); await f.git('switch', 'left'); await assert.rejects(() => f.git('merge', '--no-ff', 'right', '-m', 'merge'));
  await writeFile(join(f.cwd, 'file.txt'), 'resolved\n'); await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'merge resolution');
  const merge = await f.git('rev-parse', 'HEAD'); const detail = await getProjectGitCommitDetail(f.cwd, merge); assert.deepEqual(detail.parentHashes, [f.left, f.right]);
  await writeFile(join(f.cwd, 'file.txt'), 'staged after merge\n'); await f.git('add', 'file.txt'); await writeFile(join(f.cwd, 'file.txt'), 'working after merge\n');
  const index = await readFile(join(f.cwd, '.git/index')); const objects = await f.git('count-objects', '-v'); const refs = await f.git('show-ref');
  const first = await getProjectGitRevisionsDiff(f.cwd, [detail.parentHashes[0], merge]); const second = await getProjectGitRevisionsDiff(f.cwd, [detail.parentHashes[1], merge]);
  assert.deepEqual(lines(first), [['deletion', 'left'], ['addition', 'resolved']]); assert.deepEqual(lines(second), [['deletion', 'right'], ['addition', 'resolved']]);
  assert.deepEqual(first.files.map(file => file.path).sort(), ['file.txt', 'right.txt']); assert.deepEqual(second.files.map(file => file.path).sort(), ['file.txt', 'left.txt']);
  assert.deepEqual(first.diff.files.sort(), first.files.map(file => file.path).sort()); assert.deepEqual(second.diff.files.sort(), second.files.map(file => file.path).sort());
  const patch = await getProjectGitPatchExport(f.cwd, { scope: 'range', baseRef: second.revisions[0], targetRef: second.revisions[1] }); const path = join(f.root, 'second-parent.patch'); await writeFile(path, Buffer.from(patch.data, 'base64'));
  const checkout = join(f.root, 'second-parent'); await f.git('worktree', 'add', '--detach', checkout, f.right); await exec(f.native, ['apply', '--', path], { cwd: checkout, env: f.env }); assert.equal(await readFile(join(checkout, 'file.txt'), 'utf8'), 'resolved\n'); assert.equal(await readFile(join(checkout, 'left.txt'), 'utf8'), 'only left\n');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'working after merge\n'); assert.equal(await f.git('rev-parse', 'HEAD'), merge); assert.equal(await f.git('show-ref'), refs); assert.equal(await f.git('count-objects', '-v'), objects);
});

test('octopus merges can compare every direct parent without silently substituting the first parent', async t => {
  const f = await fixture(t);
  for (const name of ['one', 'two', 'three']) {
    await f.git('switch', '-c', name, f.base); await writeFile(join(f.cwd, `${name}.txt`), `${name}\n`); await f.git('add', '.'); await f.git('commit', '-qm', name);
  }
  await f.git('switch', 'one'); await f.git('merge', '--no-ff', 'two', 'three', '-m', 'octopus'); const merge = await f.git('rev-parse', 'HEAD'); const detail = await getProjectGitCommitDetail(f.cwd, merge); assert.equal(detail.parentHashes.length, 3);
  const names = ['one', 'two', 'three'];
  for (const [index, parent] of detail.parentHashes.entries()) {
    const comparison = await getProjectGitRevisionsDiff(f.cwd, [parent, merge]); assert.deepEqual(comparison.revisions, [parent, merge]); assert.deepEqual(comparison.files.map(file => file.path).sort(), names.filter((_, item) => item !== index).map(name => `${name}.txt`).sort());
  }
});

test('HTTP merge parent comparison returns the selected parent and its file list without writing Git state', async t => {
  const f = await fixture(t); await f.git('switch', 'left'); await assert.rejects(() => f.git('merge', '--no-ff', 'right', '-m', 'merge')); await writeFile(join(f.cwd, 'file.txt'), 'resolved\n'); await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'resolution'); const merge = await f.git('rev-parse', 'HEAD');
  const data = join(f.root, 'parent-data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'merge-parent-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); t.after(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'Merge parents', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const detail = await client.loadProjectGitCommit(project.id, repository.id, merge); const second = await client.loadProjectGitRevisionsDiff(project.id, repository.id, [detail.parentHashes[1], detail.commit.hash]);
  assert.deepEqual(second.revisions, [f.right, merge]); assert.deepEqual(lines(second), [['deletion', 'right'], ['addition', 'resolved']]); assert.deepEqual(second.files.map(file => file.path).sort(), ['file.txt', 'left.txt']); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
});

test('selected commit comparison uses both exact trees rather than HEAD or their merge base and ignores local edits', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'staged local\n'); await f.git('add', 'file.txt'); await writeFile(join(f.cwd, 'file.txt'), 'unstaged local\n');
  const index = await readFile(join(f.cwd, '.git/index')); const refs = await f.git('show-ref'); const objects = await f.git('count-objects', '-v');
  const comparison = await getProjectGitRevisionsDiff(f.cwd, ['left', 'right']); assert.deepEqual(comparison.revisions, [f.left, f.right]);
  assert.deepEqual(comparison.files.map(file => file.path).sort(), ['file.txt', 'left.txt', 'right.txt']); assert.equal(comparison.diff.unavailableReason, undefined);
  assert.deepEqual(lines(comparison), [['deletion', 'left'], ['addition', 'right']]); assert.equal(comparison.diff.fileDiffs.find(file => file.oldPath === 'left.txt').changeType, 'deleted'); assert.equal(comparison.diff.fileDiffs.find(file => file.newPath === 'right.txt').changeType, 'added');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'unstaged local\n'); assert.equal(await f.git('rev-parse', 'HEAD'), f.base); assert.equal(await f.git('show-ref'), refs); assert.equal(await f.git('count-objects', '-v'), objects);
  const reverse = await getProjectGitRevisionsDiff(f.cwd, [f.right, f.left]); assert.deepEqual(lines(reverse), [['deletion', 'right'], ['addition', 'left']]);
});

test('fixed SHA-256 comparisons survive branch deletion and distinguish equal trees from missing versions', async t => {
  const f = await fixture(t, true); await f.git('branch', '-D', 'left', 'right');
  const comparison = await getProjectGitRevisionsDiff(f.cwd, [f.left, f.right]); assert.ok(comparison.revisions.every(sha => sha.length === 64)); assert.deepEqual(lines(comparison), [['deletion', 'left'], ['addition', 'right']]);
  await f.git('commit', '--allow-empty', '-qm', 'new message, same tree'); const same = await getProjectGitRevisionsDiff(f.cwd, [f.base, await f.git('rev-parse', 'HEAD')]); assert.deepEqual(same.files, []); assert.deepEqual(same.diff.files, []); assert.equal(same.diff.diffText, ''); assert.equal(same.diff.unavailableReason, undefined);
  for (const value of [[], ['HEAD'], ['HEAD', 'HEAD', 'HEAD'], ['', 'HEAD'], [42, 'HEAD'], ['HEAD\0x', 'HEAD']]) await assert.rejects(() => getProjectGitRevisionsDiff(f.cwd, value), error => error.code === 'ASTRAGIT_GIT_COMPARISON_INVALID');
  for (const ref of ['missing-branch', '--output=not-a-path', 'HEAD:no-file']) await assert.rejects(() => getProjectGitRevisionsDiff(f.cwd, [ref, f.base]));
});

test('comparison preserves native rename metadata, binary files and special paths under custom diff presentation', async t => {
  const f = await fixture(t); const name = 'new\t[literal]\n字.txt'; await f.git('mv', 'file.txt', name); await writeFile(join(f.cwd, 'binary.bin'), Buffer.from([0, 1, 2, 255])); await f.git('add', '.'); await f.git('commit', '-qm', 'rename and binary'); const next = await f.git('rev-parse', 'HEAD');
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.srcPrefix', 'unexpected/'], ['diff.dstPrefix', 'other/'], ['diff.context', '0'], ['color.ui', 'always']]) await f.git('config', key, value);
  const comparison = await getProjectGitRevisionsDiff(f.cwd, [f.base, next]); assert.equal(comparison.diff.unavailableReason, undefined); assert.deepEqual(new Set(comparison.files.map(file => file.path)), new Set([name, 'binary.bin'])); assert.equal(comparison.files.find(file => file.path === name).originalPath, 'file.txt'); assert.equal(comparison.diff.fileDiffs.find(file => file.newPath === name).changeType, 'renamed'); assert.equal(comparison.diff.fileDiffs.find(file => file.newPath === name).hunks.length, 0); assert.equal(comparison.diff.fileDiffs.find(file => file.newPath === 'binary.bin').changeType, 'added'); assert.equal(comparison.diff.fileDiffs.find(file => file.newPath === 'binary.bin').isBinary, true); assert.equal(await f.git('config', 'diff.srcPrefix'), 'unexpected/');
});

test('comparison range patch export retains the same direction and applies to the selected before tree', async t => {
  const f = await fixture(t); const comparison = await getProjectGitRevisionsDiff(f.cwd, [f.left, f.right]);
  const patch = await getProjectGitPatchExport(f.cwd, { scope: 'range', baseRef: comparison.revisions[0], targetRef: comparison.revisions[1] });
  const patchFile = join(f.root, 'range.patch'); await writeFile(patchFile, Buffer.from(patch.data, 'base64'));
  const checkout = join(f.root, 'checkout'); await f.git('worktree', 'add', '--detach', checkout, f.left); await exec(f.native, ['apply', '--check', '--', patchFile], { cwd: checkout, env: f.env }); await exec(f.native, ['apply', '--', patchFile], { cwd: checkout, env: f.env }); assert.equal(await readFile(join(checkout, 'file.txt'), 'utf8'), 'right\n'); await assert.rejects(() => readFile(join(checkout, 'left.txt')), error => error.code === 'ENOENT'); assert.equal(await readFile(join(checkout, 'right.txt'), 'utf8'), 'only right\n');
});

test('large historical comparison preserves metadata and explicitly declines an incomplete patch', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'x'.repeat(11 * 1024 * 1024) + '\n'); await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'large');
  const comparison = await getProjectGitRevisionsDiff(f.cwd, [f.base, 'HEAD']); assert.equal(comparison.diff.unavailableReason, 'too_large'); assert.deepEqual(comparison.files.map(file => file.path), ['file.txt']); assert.deepEqual(comparison.diff.files, ['file.txt']); assert.equal(comparison.diff.diffText, ''); assert.deepEqual(comparison.diff.fileDiffs, []);
});

test('cancelling a comparison terminates its native read and leaves refs, index and working bytes intact', async t => {
  const f = await fixture(t); const bin = join(f.root, 'bin'); await mkdir(bin); const marker = join(f.root, 'started'); const wrapper = join(bin, 'git');
  await writeFile(wrapper, `#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = --unified=3 ]; then printf '%s' "$$" > '${marker}'; while :; do /bin/sleep 0.1; done; fi; done\nexec '${f.native}' "$@"\n`); await chmod(wrapper, 0o755);
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous}`; t.after(() => { process.env.PATH = previous; }); const controller = new AbortController(); t.after(() => controller.abort()); const index = await readFile(join(f.cwd, '.git/index'));
  const pending = getProjectGitRevisionsDiff(f.cwd, [f.left, f.right], controller.signal); const rejected = assert.rejects(pending, error => error.code === 'ASTRAGIT_CANCELLED');
  let pid; const deadline = Date.now() + 5000; while (Date.now() < deadline && !pid) { pid = await readFile(marker, 'utf8').catch(() => null); if (!pid) await new Promise(resolve => setTimeout(resolve, 20)); } assert.ok(pid, 'comparison entered the native patch reader');
  controller.abort(); await rejected; assert.throws(() => process.kill(Number(pid), 0), error => error.code === 'ESRCH'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), f.base);
});

test('HTTP revision comparison enforces the addressed repository and exact query shape without logging a write', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'comparison-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Comparison', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const comparison = await client.loadProjectGitRevisionsDiff(project.id, repository.id, [f.left, f.right]); assert.deepEqual(comparison.revisions, [f.left, f.right]); assert.deepEqual(lines(comparison), [['deletion', 'left'], ['addition', 'right']]); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
  const path = `${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/compare-revisions`;
  for (const query of ['from=HEAD', 'from=HEAD&to=', 'from=HEAD&to=HEAD&to=left', 'from=HEAD&to=HEAD&mode=working-tree']) {
    const response = await fetch(`${path}?${query}`, { headers: { 'x-astragit-api-token': server.apiToken } }); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'ASTRAGIT_GIT_COMPARISON_INVALID');
  }
  await assert.rejects(() => client.loadProjectGitRevisionsDiff(project.id, 'other-repository', [f.left, f.right]), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND');
});
