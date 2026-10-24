import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getProjectGitHistorySearchScope, queryProjectGitHistoryScope } from '../packages/git-core/dist/index.js';
import { captureHistorySearchScope, searchHistoryScope } from '../packages/git-core/src/gitHistorySearch.ts';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';

const exec = promisify(execFile);
const env = { ...process.env, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
async function fixture(t, count = 12, sha256 = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-history-search-'))); const cwd = join(root, 'repo'); await mkdir(cwd); const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = async (args, overrides = {}) => (await exec('git', args, { cwd, env: { ...env, ...overrides } })).stdout.trim();
  await git(['init', '-b', 'main', ...(sha256 ? ['--object-format=sha256'] : [])]); await git(['config', 'user.name', 'Search Test']); await git(['config', 'user.email', 'search@astragit.invalid']); await git(['config', 'commit.gpgsign', 'false']); await git(['config', 'core.hooksPath', join(root, 'hooks')]);
  const tree = await git(['hash-object', '-t', 'tree', '-w', '/dev/null']); const commits = [];
  const commit = async (message, parent = commits.at(-1), author = 'Search Test', date = 1_600_000_000 + commits.length) => {
    const hash = await git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { GIT_AUTHOR_NAME: author, GIT_AUTHOR_DATE: `${date} +0000`, GIT_COMMITTER_DATE: `${date} +0000` }); commits.push(hash); return hash;
  };
  for (let i = 0; i < count; i++) await commit(i === 0 ? 'old subject\n\nRareBody [a.*] 中文\u001fvalue' : `history ${i}`, undefined, i === 0 ? '早期作者' : 'Search Test');
  if (count) await git(['update-ref', 'refs/heads/main', commits.at(-1)]);
  await writeFile(join(cwd, 'untracked.txt'), 'keep me');
  const wrapper = async script => { const native = (await exec('which', ['git'], { env })).stdout.trim(); const bin = join(root, 'bin'); await mkdir(bin, { recursive: true }); await writeFile(join(bin, 'git'), '#!/bin/sh\n' + script + `\nexec '${native}' "$@"\n`); await chmod(join(bin, 'git'), 0o755); return { env: { ...env, PATH: `${bin}:${env.PATH}` } }; };
  return { root, cwd, cleanup, git, commits, commit, wrapper };
}
async function api(_t, f) {
  const dataDirectory = join(f.root, 'data'); const options = { dataDirectory, projectRoot: f.root, apiToken: 'history-search-tests', secretStore: createFileSecretStore(join(dataDirectory, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'History search', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  return { client, project, repository, restart: async () => { await server.close(); server = await startGitServer(options); return createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); } };
}

test('full history finds message bodies and authors older than the initial 200 commits with literal Unicode/control text', async t => {
  const f = await fixture(t, 225); const scope = await getProjectGitHistorySearchScope(f.cwd); const head = f.commits.at(-1);
  for (const [field, search] of [['all', 'RareBody'], ['message', '[a.*]'], ['message', '中文\u001fvalue'], ['author', '早期作者'], ['hash', f.commits[0].slice(0, 14)]]) {
    const page = await queryProjectGitHistoryScope(f.cwd, scope, { search, field }, 0); assert.equal(page.commits.length, 1, `${field}/${search}`); assert.equal(page.commits[0].hash, f.commits[0]); assert.ok(page.commits[0].searchMatch.excerpt.includes(search)); assert.equal(page.hasMore, false);
  }
  assert.equal((await queryProjectGitHistoryScope(f.cwd, scope, { search: 'RareBody', field: 'author' }, 0)).commits.length, 0); assert.equal(await f.git(['rev-parse', 'HEAD']), head); assert.equal(await readFile(join(f.cwd, 'untracked.txt'), 'utf8'), 'keep me'); await assert.rejects(() => lstat(join(f.cwd, '.git/index')), error => error.code === 'ENOENT');
  const a = await api(t, f); const page = await a.client.searchProjectGitHistory(a.project.id, a.repository.id, { search: 'RareBody', field: 'message' }); assert.equal(page.commits[0].hash, f.commits[0]);
});

test('empty and filtered pagination retain exact native order without double-skipping or duplicate commits', async t => {
  const f = await fixture(t, 19); const scope = await getProjectGitHistorySearchScope(f.cwd);
  for (const search of ['', 'history']) {
    let offset = 0; const hashes = [];
    do { const page = await queryProjectGitHistoryScope(f.cwd, scope, { search, limit: 3 }, offset); hashes.push(...page.commits.map(commit => commit.hash)); offset = page.hasMore ? offset + page.commits.length : null; } while (offset !== null);
    assert.deepEqual(hashes, f.commits.slice(search ? 1 : 0).reverse()); assert.equal(new Set(hashes).size, hashes.length);
  }
});

test('an immutable scope survives advancing and force-moving branches while a new scope sees new commits', async t => {
  const f = await fixture(t); const scope = await getProjectGitHistorySearchScope(f.cwd, 'refs/heads/main'); const first = await queryProjectGitHistoryScope(f.cwd, scope, { limit: 2 }, 0); const before = [...f.commits]; const later = await f.commit('new after scope'); await f.git(['update-ref', 'refs/heads/main', later]); await f.git(['branch', 'keep-later', later]); await f.git(['update-ref', 'refs/heads/main', before[1]]);
  const rest = await queryProjectGitHistoryScope(f.cwd, scope, { limit: 200 }, 2); assert.deepEqual([...first.commits, ...rest.commits].map(row => row.hash), before.reverse()); const fresh = await queryProjectGitHistoryScope(f.cwd, await getProjectGitHistorySearchScope(f.cwd), {}, 0); assert.ok(fresh.commits.some(row => row.hash === later));
});

test('changing Git replacement objects invalidates a pinned scope instead of mixing rewritten relationships', async t => {
  const f = await fixture(t, 5); const scope = await getProjectGitHistorySearchScope(f.cwd); const alternate = await f.commit('replacement root', null); await f.git(['replace', f.commits[0], alternate]);
  await assert.rejects(() => queryProjectGitHistoryScope(f.cwd, scope, { limit: 2 }, 2), error => error.code === 'ASTRAGIT_GIT_HISTORY_QUERY_CHANGED'); const fresh = await queryProjectGitHistoryScope(f.cwd, await getProjectGitHistorySearchScope(f.cwd), { search: 'replacement root' }, 0); assert.equal(fresh.commits[0].hash, f.commits[0]);
});

test('all-branch scope includes remote/tag/detached commits, excludes stash-only and noncommit tags, and honors explicit namespaces', async t => {
  const f = await fixture(t, 3); const remote = await f.commit('remote only', f.commits[0]); await f.git(['update-ref', 'refs/remotes/origin/topic', remote]); const tagged = await f.commit('tag only', f.commits[0]); await f.git(['tag', '-a', 'same', tagged, '-m', 'annotation']); const detached = await f.commit('detached only', f.commits[0]); await f.git(['update-ref', '--no-deref', 'HEAD', detached]); const stash = await f.commit('stash only', f.commits[0]); await f.git(['update-ref', 'refs/stash', stash]); const blob = await f.git(['hash-object', '-w', 'untracked.txt']); await f.git(['tag', 'blob-tag', blob]);
  const all = await queryProjectGitHistoryScope(f.cwd, await getProjectGitHistorySearchScope(f.cwd), {}, 0); const hashes = new Set(all.commits.map(row => row.hash)); for (const hash of [remote, tagged, detached]) assert.ok(hashes.has(hash)); assert.ok(!hashes.has(stash));
  await f.git(['tag', '-a', 'nested-commit', 'refs/tags/same', '-m', 'nested']); await f.git(['tag', '-a', 'first-blob', blob, '-m', 'blob']); await f.git(['tag', '-a', 'nested-blob', 'refs/tags/first-blob', '-m', 'nested blob']); const nested = await getProjectGitHistorySearchScope(f.cwd); assert.ok(nested.revisions.includes(tagged)); assert.ok(!nested.revisions.includes(blob));
  const tagOnly = await queryProjectGitHistoryScope(f.cwd, await getProjectGitHistorySearchScope(f.cwd, 'refs/tags/same'), {}, 0); assert.equal(tagOnly.commits[0].hash, tagged); assert.ok(!tagOnly.commits.some(row => row.hash === remote));
});

test('date and ancestor order preserve native Git ordering and parent identities', async t => {
  const f = await fixture(t, 4); const side = await f.commit('side old date', f.commits[0], 'Side', 1_590_000_000); await f.git(['branch', 'side', side]); const scope = await getProjectGitHistorySearchScope(f.cwd);
  for (const order of ['topo', 'date']) {
    const expected = (await f.git(['log', order === 'date' ? '--date-order' : '--topo-order', '--format=%H', ...scope.revisions])).split('\n'); const page = await queryProjectGitHistoryScope(f.cwd, scope, { order }, 0); assert.deepEqual(page.commits.map(row => row.hash), expected); assert.deepEqual(page.commits.find(row => row.hash === side).parentHashes, [f.commits[0]]);
  }
});

test('empty and SHA-256 repositories are normal query scopes; invalid input cannot become revision options', async t => {
  const empty = await fixture(t, 0); const scope = await getProjectGitHistorySearchScope(empty.cwd); assert.deepEqual((await queryProjectGitHistoryScope(empty.cwd, scope, {}, 0)).commits, []);
  const f = await fixture(t, 3, true); const shaScope = await getProjectGitHistorySearchScope(f.cwd); const page = await queryProjectGitHistoryScope(f.cwd, shaScope, { search: f.commits[0].slice(0, 10), field: 'hash' }, 0); assert.equal(page.commits[0].hash.length, 64);
  for (const query of [{ field: 'regex' }, { search: [] }, { order: '--all' }, { limit: 201 }, { search: 'bad\0value' }]) await assert.rejects(() => queryProjectGitHistoryScope(f.cwd, shaScope, query, 0), error => error.code === 'ASTRAGIT_GIT_HISTORY_QUERY_INVALID');
  await assert.rejects(() => getProjectGitHistorySearchScope(f.cwd, '--all'), error => error.code === 'ASTRAGIT_GIT_HISTORY_QUERY_REVISION_INVALID');
});

test('cancelling a full-history search terminates its native process group without repository writes', async t => {
  const f = await fixture(t); const scope = await captureHistorySearchScope(f.cwd, undefined, { env }); const marker = join(f.root, 'started'); const runtime = await f.wrapper(`for arg in "$@"; do if [ "$arg" = log ]; then printf '%s' "$$" > '${marker}'; while :; do /bin/sleep 0.1; done; fi; done`); const controller = new AbortController(); const pending = searchHistoryScope(f.cwd, scope, { search: 'not present' }, 0, { ...runtime, signal: controller.signal }); const rejected = assert.rejects(pending, error => error.code === 'ASTRAGIT_CANCELLED'); const deadline = Date.now() + 5000;
  while (!(await lstat(marker).catch(() => null))) { if (Date.now() > deadline) throw new Error('Native query did not start'); await new Promise(resolve => setTimeout(resolve, 20)); }
  const pid = Number(await readFile(marker, 'utf8')); controller.abort(); await rejected; assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH'); assert.equal(await f.git(['rev-parse', 'HEAD']), f.commits.at(-1));
});

test('HTTP queries bind cursors to repository and filters, freeze pages, and expire after a service restart', async t => {
  const f = await fixture(t, 9); const a = await api(t, f); const call = query => a.client.searchProjectGitHistory(a.project.id, a.repository.id, query); const first = await call({ search: 'history', limit: 2 }); assert.equal(first.commits.length, 2); assert.ok(first.nextCursor); const prior = [...f.commits]; const later = await f.commit('history new'); await f.git(['update-ref', 'refs/heads/main', later]); const next = await call({ search: 'history', limit: 2, cursor: first.nextCursor }); assert.equal(next.commits[0].hash, prior.at(-3)); assert.ok(!next.commits.some(row => row.hash === later));
  await assert.rejects(() => call({ search: 'different', limit: 2, cursor: first.nextCursor }), error => error.error === 'ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED'); await assert.rejects(() => call({ search: 'history', limit: 2, cursor: 'invalid' }), error => error.error === 'ASTRAGIT_GIT_HISTORY_QUERY_INVALID'); await assert.rejects(() => a.client.searchProjectGitHistory(a.project.id, 'wrong-repository', { cursor: first.nextCursor }), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND');
  const restarted = await a.restart(); await assert.rejects(() => restarted.searchProjectGitHistory(a.project.id, a.repository.id, { search: 'history', limit: 2, cursor: first.nextCursor }), error => error.error === 'ASTRAGIT_GIT_HISTORY_QUERY_EXPIRED'); const fresh = await restarted.searchProjectGitHistory(a.project.id, a.repository.id, { search: 'history', limit: 2 }); assert.equal(fresh.commits[0].hash, later); assert.equal((await restarted.loadProjectGitOperations(a.project.id)).items.length, 0);
});
