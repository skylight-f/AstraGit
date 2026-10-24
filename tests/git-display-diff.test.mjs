import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildGitPatchExport, getGitDiff, getProjectGitRepositorySnapshot, getProjectGitCommitDetail, getProjectGitComparisonDiff, readSelectedGitCommitChanges, parseGitUnifiedDiff } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { gitDiffFileVersions, gitDiffUnavailableMessage } from '../apps/desktop/src/renderer/git/gitDiffFeedback.ts';
import { gitDiffReader, gitDisplayDiffOptions, readGitDisplayDiff } from '../packages/git-core/dist/gitDiffReader.js';

const exec = promisify(execFile);
async function fixture(t, files = { 'file.txt': 'base\n' }, unborn = false) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-display-diff-')); const cwd = join(root, 'repo'); await mkdir(cwd); const global = join(root, 'global'); await writeFile(global, '');
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const raw = async (...args) => (await exec('git', args, { cwd, env, maxBuffer: 32 * 1024 ** 2 })).stdout;
  const git = async (...args) => (await raw(...args)).trim();
  const write = async (path, value) => { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), value); };
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'Diff Test'); await git('config', 'user.email', 'diff@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.autocrlf', 'false');
  for (const [path, contents] of Object.entries(files)) await write(path, contents);
  if (!unborn) { await git('add', '.'); await git('commit', '-qm', 'base'); }
  return { root, cwd, env, raw, git, write };
}
const changes = file => file.hunks.flatMap(hunk => hunk.lines).filter(line => ['addition', 'deletion'].includes(line.type)).map(line => [line.type, line.content]);

test('overall diff distinguishes a genuine non-repository, an unborn repository and a clean committed repository', async t => {
  const f = await fixture(t); const outside = join(f.root, 'outside'); await mkdir(outside);
  assert.equal((await getGitDiff(outside)).isRepository, false);
  assert.deepEqual(await getGitDiff(f.cwd), { isRepository: true, files: [], diffText: '', fileDiffs: [] });
  await assert.rejects(() => getGitDiff(join(f.root, 'missing')), error => error.code === 'ASTRAGIT_GIT_DIFF_READ_FAILED');
  const unborn = join(f.root, 'unborn'); await mkdir(unborn); await exec('git', ['init', '-q', '--initial-branch=main'], { cwd: unborn, env: f.env }); await writeFile(join(unborn, 'new.txt'), 'first\n');
  const diff = await getGitDiff(unborn); assert.equal(diff.isRepository, true); assert.equal(diff.unavailableReason, undefined); assert.deepEqual(diff.files, ['new.txt']); assert.deepEqual(changes(diff.fileDiffs[0]), [['addition', 'first']]);
});

test('overall diff preserves literal whitespace, newline, tab and wildcard filenames without changing index bytes', async t => {
  const names = [' leading.txt ', 'line\n字.txt', 'tab\tfile.txt', '[literal]*.txt']; const f = await fixture(t, Object.fromEntries(names.map(path => [path, 'base\n'])));
  for (const path of names) await f.write(path, 'new    \n'); await f.write('new\nname.txt', 'new file\n'); const index = await readFile(join(f.cwd, '.git/index'));
  const diff = await getGitDiff(f.cwd); assert.equal(diff.unavailableReason, undefined); assert.deepEqual(new Set(diff.files), new Set([...names, 'new\nname.txt'])); assert.deepEqual(new Set(diff.fileDiffs.map(file => file.newPath)), new Set(diff.files)); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  assert.deepEqual(changes(diff.fileDiffs.find(file => file.newPath === names[0])), [['deletion', 'base'], ['addition', 'new    ']]);
});

test('more than 200 untracked files preserves all names and stage previews, and refuses incomplete patch export', async t => {
  const f = await fixture(t); await f.write('file.txt', 'staged\n'); await f.git('add', 'file.txt');
  await Promise.all(Array.from({ length: 201 }, (_, index) => f.write(`new/${index}.txt`, 'new\n')));
  const snapshot = await getProjectGitRepositorySnapshot(f.cwd);
  assert.equal(snapshot.diff.isRepository, true); assert.equal(snapshot.diff.unavailableReason, 'too_many_files'); assert.equal(snapshot.diff.files.length, 202); assert.equal(snapshot.diff.diffText, ''); assert.deepEqual(snapshot.diff.fileDiffs, []);
  assert.equal(snapshot.stagedDiff.unavailableReason, undefined); assert.deepEqual(snapshot.stagedDiff.files, ['file.txt']); assert.equal(snapshot.unstagedDiff.unavailableReason, undefined);
  assert.throws(() => buildGitPatchExport(snapshot.diff), error => error.code === 'ASTRAGIT_GIT_DIFF_INCOMPLETE');
  assert.match(gitDiffUnavailableMessage(snapshot.diff.unavailableReason, true), /200.*未返回不完整补丁/u);
  const selection = await readSelectedGitCommitChanges(f.cwd, ['new/200.txt']); assert.equal(parseGitUnifiedDiff(selection.diff)[0].newPath, 'new/200.txt');
});

test('large patches preserve real file counts across workspace, history and comparison instead of returning empty success', async t => {
  const f = await fixture(t); await f.write('file.txt', 'x'.repeat(11 * 1024 * 1024) + '\n');
  const snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.diff.isRepository, true); assert.equal(snapshot.unstagedDiff.unavailableReason, 'too_large'); assert.deepEqual(snapshot.unstagedDiff.files, ['file.txt']); assert.equal(snapshot.stagedDiff.unavailableReason, undefined); assert.equal(snapshot.unstagedDiff.diffText, '');
  await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'large'); const detail = await getProjectGitCommitDetail(f.cwd, 'HEAD'); assert.equal(detail.files.length, 1); assert.equal(detail.diff.unavailableReason, 'too_large'); assert.equal(detail.diff.diffText, ''); assert.deepEqual(detail.diff.fileDiffs, []);
  const comparison = await getProjectGitComparisonDiff(f.cwd, 'HEAD~1', 'current'); assert.equal(comparison.unavailableReason, 'too_large'); assert.deepEqual(comparison.files, ['file.txt']);
});

test('line count limits apply even to small byte-size patches, without exporting a truncated first hunk', async t => {
  const f = await fixture(t); await f.write('file.txt', 'x\n'.repeat(151_000)); const diff = await getGitDiff(f.cwd);
  assert.equal(diff.unavailableReason, 'too_large'); assert.deepEqual(diff.files, ['file.txt']); assert.equal(diff.diffText, ''); assert.throws(() => buildGitPatchExport(diff), error => error.code === 'ASTRAGIT_GIT_DIFF_INCOMPLETE');
});

test('user diff presentation, external diff and text conversion do not replace or corrupt built-in previews', async t => {
  const f = await fixture(t); const script = join(f.root, 'external.sh'); const marker = join(f.root, 'executed'); await writeFile(script, `#!/bin/sh\ntouch '${marker}'\nprintf 'not a patch\\n'\n`); await chmod(script, 0o755);
  await f.git('config', 'diff.external', script); await f.git('config', 'diff.custom.textconv', script); await f.write('.gitattributes', 'file.txt diff=custom\n'); await f.git('add', '.gitattributes'); await f.git('commit', '-qm', 'attributes');
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'], ['diff.srcPrefix', 'custom-source/'], ['diff.dstPrefix', 'custom-destination/'], ['diff.relative', 'true'], ['diff.context', '0'], ['diff.suppressBlankEmpty', 'true'], ['color.ui', 'always']]) await f.git('config', key, value);
  await f.write('file.txt', 'new    \n');
  const snapshot = await getProjectGitRepositorySnapshot(f.cwd); assert.equal(snapshot.unstagedDiff.unavailableReason, undefined); assert.equal(snapshot.unstagedDiff.fileDiffs[0].newPath, 'file.txt'); assert.deepEqual(changes(snapshot.unstagedDiff.fileDiffs[0]), [['deletion', 'base'], ['addition', 'new    ']]);
  const selected = await readSelectedGitCommitChanges(f.cwd, ['file.txt']); assert.equal(parseGitUnifiedDiff(selected.diff)[0].newPath, 'file.txt');
  await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'changed'); const detail = await getProjectGitCommitDetail(f.cwd, 'HEAD'); assert.equal(detail.diff.unavailableReason, undefined); assert.equal(detail.diff.fileDiffs[0].newPath, 'file.txt');
  const comparison = await getProjectGitComparisonDiff(f.cwd, 'HEAD~1', 'current'); assert.equal(comparison.unavailableReason, undefined); assert.equal(comparison.fileDiffs[0].newPath, 'file.txt'); await assert.rejects(() => readFile(marker), error => error.code === 'ENOENT');
});

test('invalid diff configuration raises a read error rather than pretending the directory is not a repository', async t => {
  const f = await fixture(t); await f.write('file.txt', 'changed\n'); await f.git('config', 'diff.algorithm', 'invalid-algorithm');
  await assert.rejects(() => getGitDiff(f.cwd), error => error.code === 'ASTRAGIT_GIT_DIFF_READ_FAILED');
});

test('a patch containing an additional file after metadata was read cannot be presented or exported as the reviewed scope', async t => {
  const f = await fixture(t, { 'file.txt': 'base\n', 'later.txt': 'base\n' }); await f.write('file.txt', 'selected\n');
  const names = (await getGitDiff(f.cwd)).files; assert.deepEqual(names, ['file.txt']); await f.write('later.txt', 'changed after metadata\n');
  const diff = await readGitDisplayDiff(gitDiffReader(f.cwd), ['diff', ...gitDisplayDiffOptions, '--', '.'], names);
  assert.equal(diff.unavailableReason, 'read_failed'); assert.equal(diff.diffText, ''); assert.equal(diff.readError.code, 'ASTRAGIT_GIT_DIFF_READ_FAILED'); assert.match(diff.readError.cause.details, /Unexpected patch paths:.*later.txt/u); assert.throws(() => buildGitPatchExport(diff), error => error.code === 'ASTRAGIT_GIT_DIFF_INCOMPLETE');
});

test('non-UTF8 text patches and embedded repositories report their actual limitations', async t => {
  const f = await fixture(t); await f.write('file.txt', Buffer.from([0x61, 0xff, 0x0a])); const diff = await getGitDiff(f.cwd); assert.equal(diff.isRepository, true); assert.equal(diff.unavailableReason, 'encoding'); assert.deepEqual(diff.files, ['file.txt']); assert.equal(diff.diffText, '');
  await f.write('file.txt', 'base\n'); const embedded = join(f.cwd, 'embedded'); await mkdir(embedded); await exec('git', ['init', '-q', '--initial-branch=main'], { cwd: embedded, env: f.env }); await writeFile(join(embedded, 'private.txt'), 'private embedded data\n'); await exec('git', ['add', '.'], { cwd: embedded, env: f.env }); await exec('git', ['-c', 'user.name=Embedded', '-c', 'user.email=embedded@astragit.invalid', 'commit', '-qm', 'base'], { cwd: embedded, env: f.env });
  const nested = await getGitDiff(f.cwd); assert.equal(nested.unavailableReason, 'unsupported_files'); assert.deepEqual(nested.files, ['embedded/']); assert.equal(nested.diffText, '');
});

test('merge history uses an explicit first-parent comparison and stash detail includes untracked files', async t => {
  const f = await fixture(t, { 'file.txt': 'base\n', 'b/prefix.txt': 'base prefix\n' }); await f.git('switch', '-qc', 'feature/work'); await f.write('feature.txt', 'feature\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'feature'); await f.git('switch', 'main'); await f.write('main.txt', 'main\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'main'); await f.git('merge', '--no-ff', '-m', 'merge', 'feature/work');
  const detail = await getProjectGitCommitDetail(f.cwd, 'HEAD'); assert.equal(detail.parentHashes.length, 2); assert.equal(detail.diff.comparisonParent, detail.parentHashes[0]); assert.equal(detail.diff.unavailableReason, undefined); assert.deepEqual(detail.files.map(file => file.path), ['feature.txt']); assert.equal(detail.diff.fileDiffs[0].newPath, 'feature.txt');
  await f.write('file.txt', 'stashed\n'); await f.write('b/prefix.txt', 'changed prefix\n'); await f.write('stash-new.txt', 'untracked\n'); await f.git('stash', 'push', '-u', '-m', 'saved');
  await f.git('config', 'diff.noprefix', 'true'); await f.git('config', 'diff.srcPrefix', 'custom-source/'); await f.git('config', 'diff.dstPrefix', 'custom-destination/');
  for (let attempt = 0; attempt < 6; attempt++) {
    const stash = await getProjectGitCommitDetail(f.cwd, 'stash@{0}');
    assert.equal(stash.diff.unavailableReason, undefined, JSON.stringify(stash)); assert.equal(stash.diff.comparisonParent, undefined); assert.deepEqual(new Set(stash.files.map(file => file.path)), new Set(['file.txt', 'b/prefix.txt', 'stash-new.txt'])); assert.deepEqual(new Set(stash.diff.fileDiffs.map(file => file.newPath)), new Set(['file.txt', 'b/prefix.txt', 'stash-new.txt']));
    assert.match(stash.diff.diffText, /^diff --git a\//u);
  }
  assert.equal(await f.git('config', 'diff.srcPrefix'), 'custom-source/');
});

test('HTTP preserves unavailable metadata and per-file preview remains available while overall preview is bounded', async t => {
  const f = await fixture(t); await Promise.all(Array.from({ length: 201 }, (_, index) => f.write(`new/${index}.txt`, 'new\n'))); const data = join(f.root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'display-diff-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); t.after(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Display Diff Test', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  assert.equal(repository.snapshot.diff.unavailableReason, 'too_many_files'); assert.equal(repository.snapshot.diff.files.length, 201);
  const perFile = await client.loadProjectGitLineDiff(project.id, repository.id, { path: 'new/200.txt', stage: 'unstaged' }); assert.equal(perFile.diff.fileDiffs[0].newPath, 'new/200.txt');
  const headers = { 'x-astragit-api-token': server.apiToken }; const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/diff`, { headers }); assert.equal(response.status, 200); assert.equal((await response.json()).unavailableReason, 'too_many_files');
  await f.git('config', 'diff.algorithm', 'invalid-algorithm'); const failed = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/diff`, { headers }); assert.equal(failed.status, 500); assert.equal((await failed.json()).error, 'ASTRAGIT_GIT_DIFF_READ_FAILED');
});

test('overall previews retain both staging versions and reject concatenating patches for the same path', async t => {
  const f = await fixture(t); await f.write('file.txt', 'staged version\n'); await f.git('add', 'file.txt'); await f.write('file.txt', 'working version\n');
  const index = await readFile(join(f.cwd, '.git/index'));
  const snapshot = await getProjectGitRepositorySnapshot(f.cwd);
  assert.equal(snapshot.diff.unavailableReason, undefined);
  assert.deepEqual(snapshot.diff.fileDiffs.map(file => file.stage), ['unstaged', 'staged']);
  const working = gitDiffFileVersions(snapshot.diff, 'unstaged'); const staged = gitDiffFileVersions(snapshot.diff, 'staged');
  assert.equal(working.versions.length, 2);
  assert.deepEqual(changes(working.file), [['deletion', 'staged version'], ['addition', 'working version']]);
  assert.deepEqual(changes(staged.file), [['deletion', 'base'], ['addition', 'staged version']]);
  assert.equal(buildGitPatchExport(snapshot.stagedDiff).patchText, snapshot.stagedDiff.diffText);
  assert.equal(buildGitPatchExport(snapshot.unstagedDiff).patchText, snapshot.unstagedDiff.diffText);
  assert.throws(() => buildGitPatchExport(snapshot.diff), error => error.code === 'ASTRAGIT_GIT_DIFF_MIXED_STAGES');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  // Undoing the staged edit on disk must not hide the staged or unstaged patch.
  await f.write('file.txt', 'base\n'); const cancelled = await getGitDiff(f.cwd);
  assert.equal(gitDiffFileVersions(cancelled, 'staged').versions.length, 2);
  assert.deepEqual(changes(gitDiffFileVersions(cancelled, 'unstaged').file), [['deletion', 'staged version'], ['addition', 'base']]);
});

test('renamed targets and a recreated rename source have independent preview paths and an ambiguous export is refused', async t => {
  const f = await fixture(t); await f.git('mv', 'file.txt', 'renamed.txt'); await f.write('file.txt', 'recreated source\n');
  const diff = await getGitDiff(f.cwd); assert.equal(diff.unavailableReason, undefined);
  const recreated = gitDiffFileVersions({ ...diff, files: ['file.txt'] }, 'unstaged');
  assert.equal(recreated.versions.length, 1); assert.equal(recreated.file.changeType, 'added'); assert.equal(recreated.file.stage, 'untracked');
  const renamed = gitDiffFileVersions({ ...diff, files: ['renamed.txt'] }, 'staged');
  assert.equal(renamed.versions.length, 1); assert.equal(renamed.file.changeType, 'renamed'); assert.equal(renamed.file.oldPath, 'file.txt');
  assert.equal(renamed.file.hunks.length, 0); assert.throws(() => buildGitPatchExport(diff), error => error.code === 'ASTRAGIT_GIT_DIFF_MIXED_STAGES');
  assert.equal(gitDiffFileVersions(null, 'unstaged').file, null);
});

test('disjoint staging scopes still export a native patch applicable to the common base', async t => {
  const f = await fixture(t, { 'staged.txt': 'one\n', 'working.txt': 'two\n' });
  await f.write('staged.txt', 'staged\n'); await f.git('add', 'staged.txt'); await f.write('working.txt', 'working\n'); await f.write('new.txt', 'new\n');
  const snapshot = await getProjectGitRepositorySnapshot(f.cwd); const patch = buildGitPatchExport(snapshot.diff); const copy = join(f.root, 'copy');
  await exec('git', ['clone', '-q', '--', f.cwd, copy], { env: f.env }); const patchFile = join(f.root, 'reviewed.patch'); await writeFile(patchFile, patch.patchText);
  await exec('git', ['apply', '--check', '--', patchFile], { cwd: copy, env: f.env });
  assert.deepEqual(new Set(snapshot.diff.fileDiffs.map(file => file.stage)), new Set(['unstaged', 'staged', 'untracked']));
});
