import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { getProjectGitTrackedFiles, getProjectGitFileHistory, getProjectGitFileRevision, getProjectGitCommitDetail, parseGitUnifiedDiff } from '../packages/git-core/dist/index.js';
import { readFileHistory, readFileRevision } from '../packages/git-core/dist/gitFileHistory.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
const exec = promisify(execFile);
const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read) { const deadline = Date.now() + 5000; do { const value = await read(); if (value) return value; await delay(20); } while (Date.now() < deadline); throw new Error('Fixture marker was not reached'); }
const parseDiff = text => ({ isRepository: true, files: [], diffText: text, fileDiffs: parseGitUnifiedDiff(text) });
async function fixture(t, empty = false, sha256 = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-file-history-'))); const cwd = join(root, 'repository'); await mkdir(cwd); const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim(); const native = (await exec('which', ['git'], { env })).stdout.trim();
  await git('init', '-b', 'main', ...(sha256 ? ['--object-format=sha256'] : [])); await git('config', 'user.name', 'History Test'); await git('config', 'user.email', 'history@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  const original = 'types/中文\told.txt'; const renamed = 'src/new\nname.txt'; const final = 'final/[literal]*.txt'; const commits = [];
  const commit = async message => { await git('add', '.'); await git('commit', '-m', message); const sha = await git('rev-parse', 'HEAD'); commits.push(sha); return sha; };
  if (!empty) { await mkdir(join(cwd, 'types')); await writeFile(join(cwd, original), 'one\ntwo\n'); await writeFile(join(cwd, 'unchanged.txt'), 'clean\n'); await commit('added'); await mkdir(join(cwd, 'src')); await git('mv', original, renamed); await commit('renamed first'); await writeFile(join(cwd, renamed), 'one\nmodified\n'); await commit('modified'); await mkdir(join(cwd, 'final')); await git('mv', renamed, final); await commit('renamed second'); }
  const wrapper = async script => { const bin = join(root, 'bin'); await mkdir(bin, { recursive: true }); const file = join(bin, 'git'); await writeFile(file, '#!/bin/sh\n' + script + `\nexec '${native}' "$@"\n`); await chmod(file, 0o755); return { env: { ...env, PATH: `${bin}:${env.PATH}` }, parseDiff }; };
  return { root, cwd, git, native, cleanup, original, renamed, final, commits, commit, wrapper };
}

test('single-file native history follows two renames across every page without --skip losing older entries', async t => {
  const f = await fixture(t); const index = await readFile(join(f.cwd, '.git/index')); const head = await f.git('rev-parse', 'HEAD'); const entries = []; let offset = 0;
  do { const page = await getProjectGitFileHistory(f.cwd, { path: f.final, ref: head, offset, limit: 1 }); entries.push(...page.items); offset = page.nextOffset; } while (offset !== null);
  assert.deepEqual(entries.map(row => row.hash), [...f.commits].reverse()); assert.deepEqual(entries.map(row => row.path), [f.final, f.renamed, f.renamed, f.original]); assert.equal(entries[0].previousPath, f.renamed); assert.equal(entries[2].previousPath, f.original); assert.equal(entries[3].changeType, 'A'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), head);
  const withoutFollow = await getProjectGitFileHistory(f.cwd, { path: f.final, followRenames: false }); assert.equal(withoutFollow.items.length, 1);
});

test('pinned history and historical blobs stay on the selected revision after HEAD moves or the current file is deleted', async t => {
  const f = await fixture(t); const pinned = f.commits[2]; await f.git('rm', f.final); await f.commit('deleted'); const page = await getProjectGitFileHistory(f.cwd, { path: f.renamed, ref: pinned }); assert.deepEqual(page.items.map(row => row.hash), f.commits.slice(0, 3).reverse()); assert.equal(page.revision, pinned); const file = await getProjectGitFileRevision(f.cwd, { path: f.renamed, ref: pinned, withBlame: true }); assert.equal(file.content, 'one\nmodified\n'); assert.equal(file.lines[0].commitHash, f.commits[0]); assert.equal(file.lines[0].filename, f.original); assert.equal(file.lines[1].commitHash, f.commits[2]); assert.equal(file.lines[1].originalLine, 2); await assert.rejects(() => lstat(join(f.cwd, f.final)), error => error.code === 'ENOENT');
  const deleted = await getProjectGitFileHistory(f.cwd, { path: f.final }); assert.equal(deleted.items[0].changeType, 'D'); const deletion = await getProjectGitFileRevision(f.cwd, { path: f.final, ref: deleted.items[0].hash, includeDiff: true }); assert.equal(deletion.unavailableReason, 'missing'); assert.equal(deletion.diff.fileDiffs[0].changeType, 'deleted');
});

test('tracked file search includes clean files and freezes pagination when paths or the search scope change', async t => {
  const f = await fixture(t); const first = await getProjectGitTrackedFiles(f.cwd, { limit: 1 }); assert.equal(first.total, 2); assert.ok(first.nextOffset); const second = await getProjectGitTrackedFiles(f.cwd, { offset: first.nextOffset, limit: 1, expectedFingerprint: first.fingerprint }); assert.equal(second.paths[0], 'unchanged.txt'); assert.equal(second.nextOffset, null); assert.deepEqual((await getProjectGitTrackedFiles(f.cwd, { search: 'UNCHANGED' })).paths, ['unchanged.txt']);
  await writeFile(join(f.cwd, 'a-new.txt'), 'new'); await f.git('add', '.'); await assert.rejects(() => getProjectGitTrackedFiles(f.cwd, { offset: 1, limit: 1, expectedFingerprint: first.fingerprint }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_CHANGED'); await assert.rejects(() => getProjectGitTrackedFiles(f.cwd, { offset: 1 }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID'); const past = await getProjectGitTrackedFiles(f.cwd, { ref: f.commits[0] }); assert.ok(past.paths.includes(f.original)); assert.ok(!past.paths.includes(f.final));
});

test('working-tree blame includes unstaged lines without changing the index and rejects stale content fingerprints', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, f.final), 'one\nlocal edit\nextra\n'); const index = await readFile(join(f.cwd, '.git/index')); const file = await getProjectGitFileRevision(f.cwd, { path: f.final, workingTree: true, withBlame: true, includeDiff: true }); assert.equal(file.content, 'one\nlocal edit\nextra\n'); assert.equal(file.lines.length, 3); assert.equal(file.lines[0].commitHash, f.commits[0]); assert.match(file.lines[1].commitHash, /^0+$/u); assert.equal(file.lines[2].line, 3); assert.ok(file.diff.fileDiffs[0].addedLines > 0); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  await writeFile(join(f.cwd, f.final), 'later\n'); await assert.rejects(() => getProjectGitFileRevision(f.cwd, { path: f.final, workingTree: true, withBlame: true, expectedFingerprint: file.fingerprint }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_CHANGED');
});

test('ordinary and historical file details preserve tab, newline, wildcard and quoted paths in NUL numstat records', async t => {
  const f = await fixture(t); const detail = await getProjectGitCommitDetail(f.cwd, f.commits[1]); assert.deepEqual(detail.files.map(row => row.path), [f.renamed]); assert.equal(detail.files[0].originalPath, f.original); const initial = await getProjectGitCommitDetail(f.cwd, f.commits[0]); assert.ok(initial.files.some(row => row.path === f.original && row.additions === 2));
  const revision = await getProjectGitFileRevision(f.cwd, { path: f.final, ref: f.commits[3], previousPath: f.renamed, includeDiff: true }); assert.equal(revision.content, 'one\nmodified\n'); assert.ok(revision.diff.fileDiffs.some(row => row.newPath === f.final));
});

test('unborn repositories, untracked files, empty files and binary or oversized text are distinct readable states', async t => {
  const f = await fixture(t, true); await writeFile(join(f.cwd, 'fresh.txt'), 'new\n'); const history = await getProjectGitFileHistory(f.cwd, { path: 'fresh.txt' }); assert.equal(history.unavailableReason, 'no_commits'); let revision = await getProjectGitFileRevision(f.cwd, { path: 'fresh.txt', workingTree: true, withBlame: true }); assert.equal(revision.unavailableReason, 'no_commits'); assert.equal(revision.lines.length, 1); await f.commit('first'); await writeFile(join(f.cwd, 'untracked.txt'), 'untouched\n'); revision = await getProjectGitFileRevision(f.cwd, { path: 'untracked.txt', workingTree: true, withBlame: true }); assert.equal(revision.unavailableReason, 'uncommitted_file'); assert.match(revision.lines[0].commitHash, /^0+$/u);
  await writeFile(join(f.cwd, 'empty.txt'), ''); await writeFile(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 65])); await writeFile(join(f.cwd, 'non-utf8.txt'), Buffer.from([255, 254, 1])); await writeFile(join(f.cwd, 'big.txt'), Buffer.alloc(4 * 1024 * 1024 + 1, 65)); await f.commit('file types');
  assert.equal((await getProjectGitFileRevision(f.cwd, { path: 'empty.txt', ref: 'HEAD', withBlame: true })).content, ''); for (const path of ['binary.bin', 'non-utf8.txt']) { const value = await getProjectGitFileRevision(f.cwd, { path, ref: 'HEAD', withBlame: true }); assert.equal(value.unavailableReason, 'binary'); assert.equal(value.content, null); }
  revision = await getProjectGitFileRevision(f.cwd, { path: 'big.txt', ref: 'HEAD' }); assert.equal(revision.unavailableReason, 'too_large'); assert.equal(revision.byteLength, 4 * 1024 * 1024 + 1);
});

test('symbolic links show their own stored target and never read through a final or ancestor link', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'outside.txt'), 'outside secret'); await symlink(join(f.root, 'outside.txt'), join(f.cwd, 'link')); await symlink(f.root, join(f.cwd, 'outside-dir')); await f.commit('links'); const historical = await getProjectGitFileRevision(f.cwd, { path: 'link', ref: 'HEAD', withBlame: true }); assert.equal(historical.unavailableReason, 'symlink'); assert.equal(historical.content, join(f.root, 'outside.txt')); const working = await getProjectGitFileRevision(f.cwd, { path: 'link', workingTree: true }); assert.equal(working.unavailableReason, 'symlink'); await assert.rejects(() => getProjectGitFileRevision(f.cwd, { path: 'outside-dir/outside.txt', workingTree: true }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID');
  for (const path of ['../outside.txt', '/etc/passwd', '.git/config', 'types/../file.txt', 'file\0name']) await assert.rejects(() => getProjectGitFileHistory(f.cwd, { path }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID');
});

test('SHA-256 histories and original blame paths retain complete native object identities', async t => {
  const f = await fixture(t, false, true); const history = await getProjectGitFileHistory(f.cwd, { path: f.final }); assert.equal(history.items.length, 4); assert.ok(history.items.every(row => row.hash.length === 64)); const file = await getProjectGitFileRevision(f.cwd, { path: f.final, ref: 'HEAD', withBlame: true }); assert.equal(file.lines[0].commitHash.length, 64); assert.equal(file.lines[0].filename, f.original);
});

test('staged renames keep existing line origins and their pre-rename history across pinned pages', async t => {
  const f = await fixture(t); const nextPath = 'staged/another\nname.txt'; await mkdir(join(f.cwd, 'staged')); await f.git('mv', f.final, nextPath); await writeFile(join(f.cwd, nextPath), 'one\nlocal edit\n');
  const index = await readFile(join(f.cwd, '.git/index')); const page = await getProjectGitFileHistory(f.cwd, { path: nextPath, limit: 1 }); assert.equal(page.path, nextPath); assert.equal(page.historyPath, f.final); assert.equal(page.items[0].hash, f.commits[3]);
  const older = await getProjectGitFileHistory(f.cwd, { path: page.historyPath, ref: page.revision, offset: page.nextOffset, limit: 1 }); assert.equal(older.items[0].hash, f.commits[2]);
  const file = await getProjectGitFileRevision(f.cwd, { path: nextPath, workingTree: true, withBlame: true }); assert.equal(file.lines[0].commitHash, f.commits[0]); assert.equal(file.lines[0].filename, f.original); assert.match(file.lines[1].commitHash, /^0+$/u); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('BOM, CRLF, no-final-newline and uncommitted SHA-256 contents retain exact display lines', async t => {
  const f = await fixture(t, true, true); await writeFile(join(f.cwd, 'format.txt'), '\ufefffirst\r\nsecond');
  const unborn = await getProjectGitFileRevision(f.cwd, { path: 'format.txt', workingTree: true, withBlame: true }); assert.equal(unborn.lines.length, 2); assert.equal(unborn.lines[0].commitHash.length, 64); assert.equal(unborn.content, '\ufefffirst\r\nsecond'); await f.commit('format');
  const file = await getProjectGitFileRevision(f.cwd, { path: 'format.txt', ref: 'HEAD', withBlame: true }); assert.equal(file.content, '\ufefffirst\r\nsecond'); assert.deepEqual(file.lines.map(line => line.content), ['\ufefffirst\r', 'second']);
  await writeFile(join(f.cwd, 'untracked.txt'), 'new\n'); const untracked = await getProjectGitFileRevision(f.cwd, { path: 'untracked.txt', workingTree: true, withBlame: true }); assert.equal(untracked.lines[0].commitHash.length, 64);
});

test('invalid query types cannot silently select another version or change blame scope', async t => {
  const f = await fixture(t);
  for (const query of [{ path: f.final, withBlame: 'true' }, { path: f.final, workingTree: 'false' }, { path: f.final, ref: 42 }, { path: f.final, expectedFingerprint: 'bad' }]) await assert.rejects(() => getProjectGitFileRevision(f.cwd, query), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID');
  await assert.rejects(() => getProjectGitFileHistory(f.cwd, { path: f.final, followRenames: 0 }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID'); await assert.rejects(() => getProjectGitTrackedFiles(f.cwd, { search: [] }), error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_INVALID');
});

test('older Git blame without a final commit falls back only while the reviewed HEAD still matches', async t => {
  const f = await fixture(t); const runtime = await f.wrapper(`found_blame=0\nfound_contents=0\nfound_revision=0\nfor arg in "$@"; do [ "$arg" = blame ] && found_blame=1; [ "$arg" = --contents ] && found_contents=1; [ "$arg" = '${f.commits[3]}' ] && found_revision=1; done\nif [ "$found_blame$found_contents$found_revision" = 111 ]; then echo 'fatal: cannot use --contents with final commit object name' >&2; exit 128; fi`); await writeFile(join(f.cwd, f.final), 'one\nlocal\n'); const file = await readFileRevision(f.cwd, { path: f.final, workingTree: true, withBlame: true }, runtime); assert.equal(file.lines[0].commitHash, f.commits[0]); assert.match(file.lines[1].commitHash, /^0+$/u);
});

test('external edits during blame are rejected rather than attaching old attribution to new contents', async t => {
  const f = await fixture(t); const marker = join(f.root, 'blame-started'); const release = join(f.root, 'blame-release'); const runtime = await f.wrapper(`for arg in "$@"; do if [ "$arg" = blame ]; then touch '${marker}'; while [ ! -e '${release}' ]; do /bin/sleep 0.02; done; fi; done`); const pending = readFileRevision(f.cwd, { path: f.final, workingTree: true, withBlame: true }, runtime); const rejected = assert.rejects(pending, error => error.code === 'ASTRAGIT_GIT_FILE_HISTORY_CHANGED'); await until(() => lstat(marker).then(() => true).catch(() => false)); await writeFile(join(f.cwd, f.final), 'external change\n'); await writeFile(release, 'go'); await rejected; assert.equal(await readFile(join(f.cwd, f.final), 'utf8'), 'external change\n');
});

test('cancelling a streaming log kills its blocked native Git process and preserves repository state', async t => {
  const f = await fixture(t); const marker = join(f.root, 'log-started'); const runtime = await f.wrapper(`for arg in "$@"; do if [ "$arg" = log ]; then printf '%s' "$$" > '${marker}'; while :; do /bin/sleep 0.1; done; fi; done`); const controller = new AbortController(); const index = await readFile(join(f.cwd, '.git/index')); const pending = readFileHistory(f.cwd, { path: f.final }, { ...runtime, signal: controller.signal }); const rejected = assert.rejects(pending, error => error.code === 'ASTRAGIT_CANCELLED'); await until(() => readFile(marker, 'utf8').catch(() => null)); controller.abort(); await rejected; assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), f.commits[3]);
});

test('HTTP history, file search and selected-revision attribution use the addressed project and repository', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'file-history-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close()); const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'File history', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const files = await client.loadProjectGitTrackedFiles(project.id, repository.id, { search: 'unchanged' }); assert.deepEqual(files.paths, ['unchanged.txt']); const page = await client.loadProjectGitFileHistory(project.id, repository.id, { path: f.renamed, ref: f.commits[2], limit: 1 }); assert.equal(page.items[0].hash, f.commits[2]); const next = await client.loadProjectGitFileHistory(project.id, repository.id, { path: f.renamed, ref: page.revision, offset: page.nextOffset, limit: 1 }); assert.equal(next.items[0].hash, f.commits[1]); const file = await client.loadProjectGitFileRevision(project.id, repository.id, { path: f.renamed, ref: page.revision, withBlame: true }); assert.equal(file.lines[0].filename, f.original); await assert.rejects(() => client.loadProjectGitFileHistory(project.id, 'wrong-repository', { path: f.final }), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND'); for (const suffix of ['file-revision?path=unchanged.txt&workingTree=typo', 'file-history?path=unchanged.txt&followRenames=1', 'tracked-files?search=one&search=two']) {
    const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${suffix}`, { headers: { authorization: `Bearer ${server.apiToken}`, 'x-astragit-api-token': server.apiToken } }); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'ASTRAGIT_GIT_FILE_HISTORY_INVALID');
  }
  assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
});

test('working-file diff reads actual disk contents when the real index no longer tracks the file', async t => {
  const f = await fixture(t); await f.git('rm', '--cached', '--', 'unchanged.txt');
  const index = await readFile(join(f.cwd, '.git/index')); const objects = await f.git('count-objects', '-v');
  const clean = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', workingTree: true, includeDiff: true });
  assert.deepEqual(clean.diff.files, []); assert.equal(clean.content, 'clean\n');
  await writeFile(join(f.cwd, 'unchanged.txt'), 'actual disk version\n');
  const changed = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', workingTree: true, includeDiff: true });
  assert.equal(changed.diff.unavailableReason, undefined); assert.equal(changed.diff.fileDiffs[0].changeType, 'modified');
  assert.match(changed.diff.diffText, /\+actual disk version/u); assert.equal(changed.diff.fileDiffs[0].oldPath, 'unchanged.txt');
  await rm(join(f.cwd, 'unchanged.txt'));
  const removed = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', workingTree: true, includeDiff: true });
  assert.equal(removed.diff.fileDiffs[0].changeType, 'deleted');
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('count-objects', '-v'), objects);
});

test('new and unborn working-file previews have native additions without writing objects or a real index', async t => {
  const f = await fixture(t, true); const path = 'new\n[literal].txt'; await writeFile(join(f.cwd, path), 'first\r\nlast');
  const objects = await f.git('count-objects', '-v');
  const unborn = await getProjectGitFileRevision(f.cwd, { path, workingTree: true, includeDiff: true });
  assert.equal(unborn.diff.unavailableReason, undefined); assert.deepEqual(unborn.diff.files, [path]); assert.equal(unborn.diff.fileDiffs[0].changeType, 'added'); assert.match(unborn.diff.diffText, /\\ No newline at end of file/u);
  await assert.rejects(() => lstat(join(f.cwd, '.git/index')), error => error.code === 'ENOENT'); assert.equal(await f.git('count-objects', '-v'), objects);
  await f.commit('initial'); await writeFile(join(f.cwd, 'untracked.txt'), 'untracked\n');
  const index = await readFile(join(f.cwd, '.git/index')); const afterCommitObjects = await f.git('count-objects', '-v');
  const fresh = await getProjectGitFileRevision(f.cwd, { path: 'untracked.txt', workingTree: true, includeDiff: true }); assert.equal(fresh.diff.fileDiffs[0].changeType, 'added');
  await f.git('add', 'untracked.txt'); await writeFile(join(f.cwd, 'untracked.txt'), 'new working contents\n');
  const stagedIndex = await readFile(join(f.cwd, '.git/index')); const stagedObjects = await f.git('count-objects', '-v');
  const staged = await getProjectGitFileRevision(f.cwd, { path: 'untracked.txt', workingTree: true, includeDiff: true }); assert.match(staged.diff.diffText, /\+new working contents/u);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), stagedIndex); assert.equal(await f.git('count-objects', '-v'), stagedObjects);
  assert.notDeepEqual(index, stagedIndex); assert.notEqual(afterCommitObjects, stagedObjects);
});

test('staged rename working-file preview compares the source base to current disk contents and preserves native paths', async t => {
  const f = await fixture(t); const target = 'renamed\tnew.txt'; await f.git('mv', '--', 'unchanged.txt', target); await writeFile(join(f.cwd, target), 'clean\nextra\n');
  const index = await readFile(join(f.cwd, '.git/index')); const objects = await f.git('count-objects', '-v');
  const value = await getProjectGitFileRevision(f.cwd, { path: target, workingTree: true, includeDiff: true });
  assert.equal(value.diff.unavailableReason, undefined); assert.deepEqual(value.diff.files, [target]); assert.equal(value.diff.fileDiffs[0].oldPath, 'unchanged.txt'); assert.equal(value.diff.fileDiffs[0].newPath, target); assert.equal(value.diff.fileDiffs[0].changeType, 'renamed'); assert.match(value.diff.diffText, /\+extra/u);
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('count-objects', '-v'), objects);
});

test('historical file diffs ignore presentation config and label merge comparison with the first parent', async t => {
  const f = await fixture(t); await f.git('switch', '-c', 'feature'); await writeFile(join(f.cwd, 'unchanged.txt'), 'feature\n'); await f.commit('feature'); await f.git('switch', 'main'); await writeFile(join(f.cwd, 'main.txt'), 'main\n'); await f.commit('main'); await f.git('merge', '--no-ff', '-m', 'merge', 'feature');
  await f.git('config', 'diff.noprefix', 'true'); await f.git('config', 'diff.srcPrefix', 'unexpected/'); await f.git('config', 'diff.dstPrefix', 'other/'); await f.git('config', 'diff.context', '0'); await f.git('config', 'color.ui', 'always');
  const value = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', ref: 'HEAD', includeDiff: true });
  assert.equal(value.diff.unavailableReason, undefined); assert.equal(value.diff.comparisonParent, await f.git('rev-parse', 'HEAD^1')); assert.deepEqual(value.diff.files, ['unchanged.txt']); assert.equal(value.diff.fileDiffs[0].oldPath, 'unchanged.txt'); assert.match(value.diff.diffText, /^diff --git a\/unchanged.txt b\/unchanged.txt/u);
  assert.equal(await f.git('config', 'diff.srcPrefix'), 'unexpected/');
});

test('file-history diff limits and read failures remain explicit instead of becoming empty success', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'unchanged.txt'), 'x\n'.repeat(151_000));
  const limited = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', workingTree: true, includeDiff: true });
  assert.equal(limited.diff.unavailableReason, 'too_large'); assert.deepEqual(limited.diff.files, ['unchanged.txt']); assert.equal(limited.diff.diffText, '');
  const runtime = await f.wrapper(`for arg in "$@"; do if [ "$arg" = --unified=3 ]; then echo 'fatal: injected patch read failure' >&2; exit 128; fi; done`);
  const failed = await readFileRevision(f.cwd, { path: 'unchanged.txt', ref: 'HEAD', includeDiff: true }, runtime);
  assert.equal(failed.diff.unavailableReason, 'read_failed'); assert.equal(failed.diff.diffText, ''); assert.equal(failed.diff.readError.code, 'ASTRAGIT_GIT_DIFF_READ_FAILED');
  await writeFile(join(f.cwd, 'unchanged.txt'), Buffer.from([0x61, 0xff, 0x0a]));
  const encoding = await getProjectGitFileRevision(f.cwd, { path: 'unchanged.txt', workingTree: true, includeDiff: true }); assert.equal(encoding.diff.unavailableReason, 'encoding'); assert.equal(encoding.diff.fileDiffs.length, 0);
});

test('HTTP transports actual untracked working-file diffs without creating operation records', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'fresh.txt'), 'fresh\n'); const data = join(f.root, 'data');
  const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'revision-diff-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Revision diff', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const value = await client.loadProjectGitFileRevision(project.id, repository.id, { path: 'fresh.txt', workingTree: true, includeDiff: true });
  assert.equal(value.diff.unavailableReason, undefined); assert.equal(value.diff.fileDiffs[0].changeType, 'added'); assert.deepEqual(value.diff.files, ['fresh.txt']); assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
});
