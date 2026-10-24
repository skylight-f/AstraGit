import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitRepositorySnapshot, getProjectGitCommitDetail, getProjectGitComparisonDiff, parseGitUnifiedDiff } from '../packages/git-core/dist/index.js';
import { buildGitHunkPatch } from '../apps/desktop/src/renderer/git/gitHunkPatch.ts';

const exec = promisify(execFile);
async function fixture(t, files = { 'file.txt': 'start\nold\n' }) {
  const cwd = await mkdtemp(join(tmpdir(), 'astragit-hunk-integrity-')); const global = join(cwd, 'global.gitconfig'); await writeFile(global, '');
  const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(cwd, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C', LC_ALL: 'C' };
  const raw = async (...args) => (await exec('git', args, { cwd, env, maxBuffer: 25 * 1024 ** 2 })).stdout;
  const git = async (...args) => (await raw(...args)).trim();
  const write = async (path, data) => { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), data); };
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'Hunk Test'); await git('config', 'user.email', 'hunk@astragit.invalid'); await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.autocrlf', 'false');
  for (const [path, content] of Object.entries(files)) await write(path, content);
  await git('--literal-pathspecs', 'add', '--', ...Object.keys(files)); await git('commit', '-qm', 'base');
  const snapshot = () => getProjectGitRepositorySnapshot(cwd);
  const run = action => executeProjectGitAction(cwd, action, undefined, env);
  const blob = async path => (await exec('git', ['show', `:${path}`], { cwd, env, encoding: 'buffer', maxBuffer: 25 * 1024 ** 2 })).stdout;
  return { cwd, env, write, raw, git, snapshot, run, blob };
}
const added = file => file.hunks.flatMap(hunk => hunk.lines).filter(line => line.type === 'addition').map(line => line.content);

test('real snapshot hunk staging and unstaging retain final trailing spaces and unrelated staged content', async t => {
  const f = await fixture(t); const content = 'start\nnew    \n'; await f.write('file.txt', content); await f.write('unrelated.txt', 'keep\n'); await f.git('add', 'unrelated.txt'); const unrelated = await f.git('rev-parse', ':unrelated.txt');
  let snapshot = await f.snapshot(); let file = snapshot.unstagedDiff.fileDiffs.find(file => file.newPath === 'file.txt'); assert.deepEqual(added(file), ['new    ']);
  assert.equal(snapshot.unstagedDiff.diffText, await f.raw('-c', 'core.quotePath=false', 'diff', '--submodule=short', '--', '.'));
  await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]) }); assert.deepEqual(await f.blob('file.txt'), Buffer.from(content)); assert.equal(await f.git('rev-parse', ':unrelated.txt'), unrelated);
  snapshot = await f.snapshot(); file = snapshot.stagedDiff.fileDiffs.find(file => file.newPath === 'file.txt'); assert.deepEqual(added(file), ['new    ']);
  await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]), reverse: true }); assert.deepEqual(await f.blob('file.txt'), Buffer.from('start\nold\n')); assert.equal(await f.git('rev-parse', ':unrelated.txt'), unrelated); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), content);
});

test('Git C quoted names decode accurately and the actual renderer hunk builder stages literal paths', { skip: process.platform === 'win32' }, async t => {
  const names = ['space name.txt', ' leading trailing.txt ', 'line\n字.txt', 'tab\tfile.txt', 'quote"slash\\.txt', 'literal b/child.txt', 'control-\x01.txt', 'two b/a b/file.txt'];
  const f = await fixture(t, Object.fromEntries(names.map(path => [path, 'start\nold\n'])));
  for (const path of names) await f.write(path, 'start\nnew    \n');
  const snapshot = await f.snapshot(); assert.deepEqual(new Set(snapshot.unstagedDiff.files), new Set(names));
  for (const path of names) {
    const file = snapshot.unstagedDiff.fileDiffs.find(file => file.newPath === path); assert.ok(file, JSON.stringify(path)); assert.equal(file.oldPath, path);
    await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]) }); assert.deepEqual(await f.blob(path), Buffer.from('start\nnew    \n'));
    const native = await f.raw('-c', 'core.quotePath=true', '--literal-pathspecs', 'diff', '--cached', '--', path); assert.equal(parseGitUnifiedDiff(native)[0].newPath, path);
  }
});

test('hunk contents beginning with header-like plus and minus signs remain real content', async t => {
  const f = await fixture(t, { 'file.txt': 'anchor\n-- old path\n+ old\n' }); const content = 'anchor\n++ new path\n- new\n'; await f.write('file.txt', content);
  const file = (await f.snapshot()).unstagedDiff.fileDiffs[0]; assert.equal(file.oldPath, 'file.txt'); assert.equal(file.newPath, 'file.txt'); assert.deepEqual(added(file), ['++ new path', '- new']);
  assert.ok(file.hunks[0].lines.some(line => line.type === 'deletion' && line.content === '-- old path'));
  await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]) }); assert.deepEqual(await f.blob('file.txt'), Buffer.from(content));
});

test('discarding one real hunk preserves other changes and exact trailing whitespace', async t => {
  const original = Array.from({ length: 30 }, (_, index) => `line ${index}\n`); const f = await fixture(t, { 'file.txt': original.join('') }); const changed = [...original]; changed[1] = 'first change   \n'; changed[27] = 'last change    \n'; await f.write('file.txt', changed.join(''));
  const file = (await f.snapshot()).unstagedDiff.fileDiffs[0]; assert.equal(file.hunks.length, 2);
  await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]), reverse: true, target: 'worktree' }); changed[1] = original[1]; assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), changed.join('')); assert.deepEqual(await f.blob('file.txt'), Buffer.from(original.join('')));
});

test('CRLF and missing final newlines round trip through native snapshot hunk patches', async t => {
  const originals = { 'crlf.txt': 'start\r\nold\r\n', 'no-newline.txt': 'start\nold' }; const changed = { 'crlf.txt': 'start\r\nnew    \r\n', 'no-newline.txt': 'start\nnew    ' }; const f = await fixture(t, originals);
  for (const [path, content] of Object.entries(changed)) await f.write(path, content);
  const snapshot = await f.snapshot();
  for (const path of Object.keys(changed)) { const file = snapshot.unstagedDiff.fileDiffs.find(file => file.newPath === path); await f.run({ type: 'apply_patch', patch: buildGitHunkPatch(file, file.hunks[0]) }); assert.deepEqual(await f.blob(path), Buffer.from(changed[path])); }
});

test('rename and binary metadata retain actual leading a and b directories rather than stripping them as diff prefixes', { skip: process.platform === 'win32' }, async t => {
  const original = Array.from({ length: 25 }, (_, index) => `line ${index}\n`).join(''); const f = await fixture(t, { 'a/old space.txt': original, 'a/binary.bin': Buffer.from([0, 1, 2, 3]) });
  await mkdir(join(f.cwd, 'b')); await f.git('mv', 'a/old space.txt', 'b/new\t名.txt'); await f.git('mv', 'a/binary.bin', 'b/binary.bin'); await f.write('b/new\t名.txt', original+'last new    \n'); await f.git('add', '.');
  const snapshot = await f.snapshot(); const renamed = snapshot.stagedDiff.fileDiffs.find(file => file.newPath === 'b/new\t名.txt'); assert.equal(renamed.changeType, 'renamed'); assert.equal(renamed.oldPath, 'a/old space.txt');
  const binary = snapshot.stagedDiff.fileDiffs.find(file => file.newPath === 'b/binary.bin'); assert.equal(binary.oldPath, 'a/binary.bin'); assert.equal(binary.changeType, 'renamed'); assert.equal(binary.hunks.length, 0);
  await f.git('commit', '-qm', 'rename'); const detail = await getProjectGitCommitDetail(f.cwd, 'HEAD'); assert.equal(detail.diff.fileDiffs.find(file => file.newPath === 'b/new\t名.txt').oldPath, 'a/old space.txt');
});

test('history, branch comparison and stash detail retain native diff trailing bytes', async t => {
  const f = await fixture(t); const content = 'start\nnew    \n'; await f.write('file.txt', content); await f.git('add', 'file.txt'); await f.git('commit', '-qm', 'update');
  const detail = await getProjectGitCommitDetail(f.cwd, 'HEAD'); assert.equal(detail.diff.diffText, await f.raw('-c', 'core.quotePath=false', 'show', '--format=', '--no-ext-diff', '--find-renames', 'HEAD')); assert.deepEqual(added(detail.diff.fileDiffs[0]), ['new    ']);
  const comparison = await getProjectGitComparisonDiff(f.cwd, 'HEAD~1', 'current'); assert.deepEqual(added(comparison.fileDiffs[0]), ['new    ']);
  await f.write('file.txt', 'start\nstashed    \n'); await f.git('stash', 'push', '-m', 'test'); const stash = await getProjectGitCommitDetail(f.cwd, 'stash@{0}'); assert.deepEqual(added(stash.diff.fileDiffs[0]), ['stashed    ']);
});


test('binary and copy headers disambiguate names containing the literal b prefix text', async t => {
  const names = ['literal b/child.bin', 'two b/a b/file.bin', ' leading b/space.bin '];
  const f = await fixture(t, Object.fromEntries(names.map(path => [path, Buffer.from([0, 1, 2, 3])])));
  for (const path of names) await f.write(path, Buffer.from([0, 1, 4, 3]));
  const files = (await f.snapshot()).unstagedDiff.fileDiffs; assert.deepEqual(new Set(files.map(file => file.newPath)), new Set(names)); assert.ok(files.every(file => file.hunks.length === 0));
  await f.write('b/copy.bin', Buffer.from([0, 1, 2, 3])); await f.git('add', 'b/copy.bin');
  const copied = parseGitUnifiedDiff(await f.raw('-c', 'core.quotePath=false', 'diff', '--cached', '--find-copies', '--find-copies-harder')).find(file => file.changeType === 'copied');
  assert.ok(copied); assert.equal(copied.newPath, 'b/copy.bin'); assert.ok(names.includes(copied.oldPath));
});
