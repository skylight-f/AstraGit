import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { executeProjectGitAction, getProjectGitFlowState, getProjectGitFlowPreview, parseGitFlowChange } from '../packages/git-core/dist/index.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { repositoryGitFlowDirectory, resolveGitFlowTool, verifyBundledGitFlow } from '../packages/git-core/dist/gitFlowTool.js';
import { readGitFlowState, previewGitFlow } from '../packages/git-core/dist/gitFlowOperations.js';

const exec = promisify(execFile);
const native = {};
const configuration = { production: 'main', develop: 'develop', feature: 'feature/', bugfix: 'bugfix/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: 'v' };
async function fixture(t, unborn = false) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-flow-test-')); const cwd = join(root, 'repository'); await mkdir(cwd);
  const global = join(root, 'global.gitconfig'); await writeFile(global, '');
  const saved = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', LANG: 'C', LC_ALL: 'C' };
  const raw = async (dir, ...args) => (await exec('git', args, { cwd: dir, env })).stdout;
  const git = async (...args) => (await raw(cwd, ...args)).trim();
  await git('init', '-q', '--initial-branch=main'); await git('config', 'user.name', 'Flow Test'); await git('config', 'user.email', 'flow@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  if (!unborn) { await writeFile(join(cwd, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-qm', 'base'); }
  const preview = change => getProjectGitFlowPreview(cwd, change);
  const run = async (change, fingerprint) => executeProjectGitAction(cwd, { type: 'manage_flow', change, expectedFingerprint: fingerprint ?? (await preview(change)).fingerprint }, undefined, env);
  const init = async (config = configuration) => run({ operation: 'init', configuration: config });
  const commit = async (content, message = content.trim()) => { await writeFile(join(cwd, 'base.txt'), content); await git('add', 'base.txt'); await git('commit', '-qm', message); };
  return { root, cwd, global, env, git, raw, preview, run, init, commit };
}

test('Git Flow validates operation-specific options and protects native AVH shell arguments', () => {
  for (const change of [null, [], { operation: 'init', configuration: { ...configuration, develop: 'main' } }, { operation: 'start', kind: 'feature', name: '$(touch-sentinel)' }, { operation: 'start', kind: 'hotfix', name: 'x', rebase: true }, { operation: 'finish', kind: 'release', name: '1', rebase: true }, { operation: 'finish', kind: 'feature', name: 'x', skipTag: true }, { operation: 'finish', kind: 'hotfix', name: '1', skipTag: true, tagMessage: 'tag' }, { operation: 'finish', kind: 'feature', name: 'x', keepBranch: true, forceDelete: true }]) assert.throws(() => parseGitFlowChange(change), error => error.code === 'ASTRAGIT_GIT_FLOW_INVALID');
  assert.equal(parseGitFlowChange({ operation: 'start', kind: 'feature', name: '子系统/接入' }).name, '子系统/接入');
});

test('the optional system-only probe reports missing Git Flow without changing repository state', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const tools = join(f.root, 'git-only'); await mkdir(tools); await symlink((await exec('which', ['git'], { env: f.env })).stdout.trim(), join(tools, 'git'));
  const saved = { PATH: process.env.PATH, GIT_EXEC_PATH: process.env.GIT_EXEC_PATH }; const config = await readFile(join(f.cwd, '.git/config')); const index = await readFile(join(f.cwd, '.git/index'));
  try { process.env.PATH = tools; process.env.GIT_EXEC_PATH = tools; assert.equal((await readGitFlowState(f.cwd, { toolMode: 'system' })).available, false); await assert.rejects(() => previewGitFlow(f.cwd, { operation: 'init', configuration }, { toolMode: 'system' }), error => error.code === 'ASTRAGIT_GIT_FLOW_UNAVAILABLE'); }
  finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('Git Flow preview is read-only; explicit init uses custom names and only local configuration', native, async t => {
  const f = await fixture(t); await f.git('branch', 'other'); const config = await readFile(join(f.cwd, '.git/config')); const index = await readFile(join(f.cwd, '.git/index')); const head = await f.git('rev-parse', 'HEAD');
  const custom = { ...configuration, develop: 'integration', feature: 'topic/', versionTag: '' }; const change = { operation: 'init', configuration: custom };
  const p = await f.preview(change); assert.equal(p.createsDevelop, true); assert.equal(p.createsInitialCommit, false);
  assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), head);
  const result = await f.run(change, p.fingerprint); assert.equal(result.outcome, 'completed'); const state = await getProjectGitFlowState(f.cwd); assert.equal(state.initialized, true); assert.deepEqual(state.configuration, custom); assert.equal(state.branch, p.branch); assert.equal(state.branch, 'integration');
  assert.equal(await f.git('rev-parse', 'refs/heads/integration'), head); assert.equal(await readFile(f.global, 'utf8'), ''); assert.ok(result.flow.changedRefs.some(item => item.ref === 'refs/heads/integration' && item.before === null));
});

test('Git Flow unborn initialization creates an empty initial commit without adding untracked files', native, async t => {
  const f = await fixture(t, true); await writeFile(join(f.cwd, 'untracked.txt'), 'keep\n'); const p = await f.preview({ operation: 'init', configuration }); assert.equal(p.createsInitialCommit, true);
  await f.init(); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'develop'); assert.equal(await f.git('ls-tree', '-r', 'HEAD'), ''); assert.equal(await readFile(join(f.cwd, 'untracked.txt'), 'utf8'), 'keep\n');
});

test('Git Flow feature start preserves portable local edits and finish integrates exactly the selected feature', native, async t => {
  const f = await fixture(t); await f.init(); await writeFile(join(f.cwd, 'base.txt'), 'feature\n'); await f.run({ operation: 'start', kind: 'feature', name: '子系统/接入' }); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'feature\n');
  await f.git('add', '.'); await f.git('commit', '-qm', 'feature work'); const feature = await f.git('rev-parse', 'HEAD'); await f.git('branch', 'feature/unrelated');
  const result = await f.run({ operation: 'finish', kind: 'feature', name: '子系统/接入' }); assert.equal(result.outcome, 'completed'); assert.equal(await f.git('rev-parse', 'develop'), feature); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'develop'); assert.ok((await getProjectGitFlowState(f.cwd)).localBranches.includes('feature/unrelated')); assert.ok(!(await getProjectGitFlowState(f.cwd)).localBranches.includes('feature/子系统/接入'));
});

test('Git Flow release creates an annotated tag with exact multiline quotes and backmerges to develop', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'release', name: '1.2.0' }); await f.commit('release\n'); const release = await f.git('rev-parse', 'HEAD');
  const message = "Release '1.2.0'\n\nLiteral $(not-a-command) and `backticks`\n";
  const result = await f.run({ operation: 'finish', kind: 'release', name: '1.2.0', tagMessage: message, keepBranch: true }); assert.equal(result.outcome, 'completed');
  assert.equal(await f.git('cat-file', '-t', 'refs/tags/v1.2.0'), 'tag'); const tag = await f.raw(f.cwd, 'cat-file', '-p', 'refs/tags/v1.2.0'); assert.equal(tag.slice(tag.indexOf('\n\n') + 2), message);
  await f.git('merge-base', '--is-ancestor', release, 'main'); await f.git('merge-base', '--is-ancestor', 'main', 'develop'); assert.ok((await getProjectGitFlowState(f.cwd)).localBranches.includes('release/1.2.0'));
});

test('Git Flow hotfix completes without a tag when explicitly selected and keeps unrelated tags', native, async t => {
  const f = await fixture(t); await f.init(); await f.git('tag', 'unrelated'); await f.run({ operation: 'start', kind: 'hotfix', name: '1.2.1' }); await f.commit('hotfix\n'); const hotfix = await f.git('rev-parse', 'HEAD');
  await f.run({ operation: 'finish', kind: 'hotfix', name: '1.2.1', skipTag: true }); await f.git('merge-base', '--is-ancestor', hotfix, 'main'); await f.git('merge-base', '--is-ancestor', 'main', 'develop'); assert.equal(await f.git('tag', '--list'), 'unrelated');
});

test('Git Flow refuses stale refs, configuration, worktree bytes and changed options before writing', native, async t => {
  const f = await fixture(t); await f.init(); const change = { operation: 'start', kind: 'feature', name: 'checked' };
  let p = await f.preview(change); await f.git('branch', 'other'); await assert.rejects(() => f.run(change, p.fingerprint), error => error.code === 'ASTRAGIT_GIT_FLOW_CHANGED');
  p = await f.preview(change); await f.git('config', 'astragit.own', 'changed'); await assert.rejects(() => f.run(change, p.fingerprint), error => error.code === 'ASTRAGIT_GIT_FLOW_CHANGED');
  await writeFile(join(f.cwd, 'base.txt'), 'first\n'); p = await f.preview(change); await writeFile(join(f.cwd, 'base.txt'), 'second\n'); await assert.rejects(() => f.run(change, p.fingerprint), error => error.code === 'ASTRAGIT_GIT_FLOW_CHANGED');
  p = await f.preview(change); await assert.rejects(() => f.run({ ...change, name: 'other-feature' }, p.fingerprint), error => error.code === 'ASTRAGIT_GIT_FLOW_CHANGED'); assert.equal(await f.git('branch', '--list', 'feature/*'), ''); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'second\n');
});

test('Git Flow finish detects branches used by another worktree before starting', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'feature', name: 'in-use' }); await f.commit('feature\n'); await f.git('worktree', 'add', '-q', join(f.root, 'other-worktree'), 'develop');
  await assert.rejects(() => f.preview({ operation: 'finish', kind: 'feature', name: 'in-use' }), error => error.code === 'ASTRAGIT_GIT_FLOW_WORKTREE'); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'feature/in-use');
});

test('Git Flow feature merge conflict is paused and resumes only after explicit conflict resolution and merge continuation', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'feature', name: 'conflict' }); await f.commit('feature\n'); await f.git('checkout', '-q', 'develop'); await f.commit('develop\n'); await f.git('checkout', '-q', 'feature/conflict');
  const change = { operation: 'finish', kind: 'feature', name: 'conflict' }; await assert.rejects(() => f.run(change), error => error.code === 'ASTRAGIT_GIT_FLOW_PAUSED' && error.operationStatus === 'conflict');
  assert.equal((await getProjectGitFlowState(f.cwd)).branch, 'develop'); await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_FLOW_INTEGRATION');
  await writeFile(join(f.cwd, 'base.txt'), 'resolved\n'); await f.git('add', 'base.txt'); await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'merge' }, undefined, f.env);
  await f.run(change); assert.ok(!(await getProjectGitFlowState(f.cwd)).localBranches.includes('feature/conflict')); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'resolved\n');
});

test('Git Flow release backmerge conflict preserves completed production and tag steps for a reviewed resume', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'release', name: '2.0' }); await f.commit('release\n'); await f.git('checkout', '-q', 'develop'); await f.commit('next development\n'); await f.git('checkout', '-q', 'release/2.0');
  const change = { operation: 'finish', kind: 'release', name: '2.0', tagMessage: 'Release 2.0' }; await assert.rejects(() => f.run(change), error => error.code === 'ASTRAGIT_GIT_FLOW_PAUSED' && /refs\/tags\/v2\.0/u.test(error.details));
  const production = await f.git('rev-parse', 'main'); const tag = await f.git('rev-parse', 'refs/tags/v2.0'); assert.equal((await getProjectGitFlowState(f.cwd)).branch, 'develop');
  await writeFile(join(f.cwd, 'base.txt'), 'both\n'); await f.git('add', 'base.txt'); await executeProjectGitAction(f.cwd, { type: 'continue_integration', kind: 'merge' }, undefined, f.env);
  await f.run({ ...change, tagMessage: '' }); assert.equal(await f.git('rev-parse', 'main'), production); assert.equal(await f.git('rev-parse', 'refs/tags/v2.0'), tag); assert.ok(!(await getProjectGitFlowState(f.cwd)).localBranches.includes('release/2.0'));
});

test('Git Flow explicit push sends only completed flow branches and its version tag, preserving remote flow branches', native, async t => {
  const f = await fixture(t); const remote = join(f.root, 'remote.git'); await f.raw(f.root, 'init', '--bare', '-q', remote); await f.git('remote', 'add', 'origin', remote); await f.init(); await f.git('tag', 'unrelated-local');
  await f.run({ operation: 'start', kind: 'release', name: '3.0' }); await f.commit('release\n'); await f.git('push', '-qu', 'origin', 'release/3.0');
  await f.run({ operation: 'finish', kind: 'release', name: '3.0', tagMessage: 'Release 3', pushAfter: true });
  assert.equal((await f.raw(remote, 'tag', '--list')).trim(), 'v3.0'); assert.equal((await f.raw(remote, 'rev-parse', 'refs/heads/main')).trim(), await f.git('rev-parse', 'main')); assert.equal((await f.raw(remote, 'rev-parse', 'refs/heads/develop')).trim(), await f.git('rev-parse', 'develop')); assert.ok((await f.raw(remote, 'branch', '--list', 'release/3.0')).includes('release/3.0'));
});

test('Git Flow feature finish rebases before merging and retains the rewritten feature when requested', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'feature', name: 'rebase' }); await f.commit('feature\n'); const old = await f.git('rev-parse', 'HEAD');
  await f.git('checkout', '-q', 'develop'); await writeFile(join(f.cwd, 'other.txt'), 'develop\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'develop update'); await f.git('checkout', '-q', 'feature/rebase');
  await f.run({ operation: 'finish', kind: 'feature', name: 'rebase', rebase: true, keepBranch: true }); const rewritten = await f.git('rev-parse', 'feature/rebase'); assert.notEqual(rewritten, old); await f.git('merge-base', '--is-ancestor', rewritten, 'develop'); assert.equal(await readFile(join(f.cwd, 'other.txt'), 'utf8'), 'develop\n');
});

test('Git Flow refuses its follow-up push if a flow hook changes the remote after local steps', native, async t => {
  const f = await fixture(t); const remote = join(f.root, 'remote.git'); const other = join(f.root, 'other.git'); await f.raw(f.root, 'init', '--bare', '-q', remote); await f.raw(f.root, 'init', '--bare', '-q', other); await f.git('remote', 'add', 'origin', remote); await f.init();
  await f.run({ operation: 'start', kind: 'hotfix', name: 'redirect' }); await f.commit('hotfix\n'); const hook = join(f.cwd, '.git/hooks/post-flow-hotfix-finish'); await writeFile(hook, '#!/bin/sh\ngit config remote.origin.url ../other.git\n'); await chmod(hook, 0o755);
  await assert.rejects(() => f.run({ operation: 'finish', kind: 'hotfix', name: 'redirect', skipTag: true, pushAfter: true }), error => error.code === 'ASTRAGIT_GIT_FLOW_OUTCOME_UNKNOWN' && /未发起后续推送/u.test(error.details));
  assert.equal(await f.raw(remote, 'for-each-ref'), ''); assert.equal(await f.raw(other, 'for-each-ref'), ''); assert.equal(await f.git('show', 'main:base.txt'), 'hotfix'); assert.ok(!(await getProjectGitFlowState(f.cwd)).localBranches.includes('hotfix/redirect'));
});

test('Git Flow HTTP previews are read-only and durable execution replays after restart without starting a branch twice', native, async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'flow-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false };
  let server = await startGitServer(options); t.after(() => server.close()); let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  const project = await client.createProject({ name: 'Flow', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const config = await readFile(join(f.cwd, '.git/config')); assert.equal((await client.loadRepositoryGitFlow(project.id, repository.id)).initialized, false); const init = { operation: 'init', configuration }; const review = await client.previewRepositoryGitFlow(project.id, repository.id, init); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config);
  assert.equal((await client.executeProjectGitAction(project.id, repository.id, { type: 'manage_flow', change: init, expectedFingerprint: review.fingerprint })).result.outcome, 'completed');
  const change = { operation: 'start', kind: 'feature', name: 'once' }; const p = await client.previewRepositoryGitFlow(project.id, repository.id, change); const action = { type: 'manage_flow', change, expectedFingerprint: p.fingerprint }; const envelope = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = async (body, route = 'flow') => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  assert.equal((await send(action)).status, 400); assert.equal((await send(envelope, 'actions')).status, 400); const first = await send(envelope); assert.equal(first.status, 200);
  await f.git('checkout', '-q', 'main'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken });
  assert.deepEqual(await send(envelope), first); assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'main'); assert.ok((await client.loadRepositoryGitFlow(project.id, repository.id)).branches.some(branch => branch.branch === 'feature/once'));
});

test('Git Flow starting a feature explains overwrite refusal without claiming all flow configuration was rolled back', native, async t => {
  const f = await fixture(t); await f.init(); await f.commit('develop version\n'); await f.git('checkout', '-q', 'main'); await writeFile(join(f.cwd, 'base.txt'), 'local work\n');
  await assert.rejects(() => f.run({ operation: 'start', kind: 'feature', name: 'blocked' }), error => error.code === 'ASTRAGIT_GIT_FLOW_CHECKOUT_BLOCKED' && error.operationStatus === 'unknown_after_write');
  assert.equal(await f.git('symbolic-ref', '--short', 'HEAD'), 'main'); assert.equal(await f.git('branch', '--list', 'feature/blocked'), ''); assert.equal(await readFile(join(f.cwd, 'base.txt'), 'utf8'), 'local work\n'); assert.equal(await f.git('config', '--get', 'gitflow.branch.feature/blocked.base'), 'develop');
});

test('Git Flow rejects an unrelated existing version tag before any finish writes', native, async t => {
  const f = await fixture(t); await f.init(); await f.run({ operation: 'start', kind: 'release', name: 'collision' }); await f.commit('release\n'); await f.git('tag', 'vcollision', 'main'); const before = await f.git('rev-parse', 'HEAD'); const config = await readFile(join(f.cwd, '.git/config')); const index = await readFile(join(f.cwd, '.git/index'));
  await assert.rejects(() => f.preview({ operation: 'finish', kind: 'release', name: 'collision', tagMessage: 'Release' }), error => error.code === 'ASTRAGIT_GIT_FLOW_TAG_EXISTS' && error.operationStatus === 'failed_before_write');
  assert.equal(await f.git('rev-parse', 'HEAD'), before); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

function usePackagedResources(t, resourcesPath) {
  const saved = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { configurable: true, writable: true, value: resourcesPath });
  t.after(() => { if (saved) Object.defineProperty(process, 'resourcesPath', saved); else delete process.resourcesPath; });
}

test('bundled Git Flow runs from a relocated app path with spaces, quotes and POSIX backslashes, ignoring other tools including recursive rebase', native, async t => {
  const f = await fixture(t); const resources = join(f.root, process.platform === 'win32' ? "Astra's Git.app" : "Astra's Git\\Tools.app", 'Contents', 'Resources'); await mkdir(resources, { recursive: true }); await cp(repositoryGitFlowDirectory, join(resources, 'git-flow-avh'), { recursive: true }); usePackagedResources(t, resources);
  const fake = join(f.root, 'other-tools'); await mkdir(fake); const sentinel = join(f.root, 'wrong-tool-ran'); const script = join(fake, 'git-flow');
  await writeFile(script, '#!/bin/sh\nprintf wrong > "$ASTRAGIT_FLOW_SENTINEL"\nexit 88\n'); await chmod(script, 0o755);
  process.env.PATH = fake + ':' + process.env.PATH; f.env.PATH = process.env.PATH; f.env.ASTRAGIT_FLOW_SENTINEL = sentinel; await f.git('config', 'alias.flow', '!exit 89');
  const tool = await resolveGitFlowTool(); assert.equal(tool.directory, await realpath(join(resources, 'git-flow-avh'))); assert.equal((await getProjectGitFlowState(f.cwd)).toolSource, 'bundled');
  await f.init(); await f.run({ operation: 'start', kind: 'feature', name: 'bundled' }); await f.commit('bundled feature\n'); const old = await f.git('rev-parse', 'HEAD'); await f.git('checkout', '-q', 'develop'); await writeFile(join(f.cwd, 'other.txt'), 'develop\n'); await f.git('add', '.'); await f.git('commit', '-qm', 'develop update'); await f.git('checkout', '-q', 'feature/bundled');
  await f.run({ operation: 'finish', kind: 'feature', name: 'bundled', rebase: true, keepBranch: true }); assert.notEqual(await f.git('rev-parse', 'feature/bundled'), old); await f.git('merge-base', '--is-ancestor', 'feature/bundled', 'develop'); assert.equal(await f.git('config', '--get', 'alias.flow'), '!exit 89'); await assert.rejects(() => readFile(sentinel), error => error.code === 'ENOENT');
});

test('bundled tool corruption, missing license and executable/symlink changes are rejected before any repository writes', native, async t => {
  const f = await fixture(t); const resources = join(f.root, 'Resources'); await mkdir(resources); const directory = join(resources, 'git-flow-avh'); await cp(repositoryGitFlowDirectory, directory, { recursive: true }); usePackagedResources(t, resources);
  const config = await readFile(join(f.cwd, '.git/config')); const index = await readFile(join(f.cwd, '.git/index')); const change = { operation: 'init', configuration };
  const entry = join(directory, 'git-flow'); const original = await readFile(entry); await writeFile(entry, Buffer.concat([original, Buffer.from('\n# changed\n')]));
  await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID' && error.operationStatus === 'failed_before_write'); await writeFile(entry, original); await chmod(entry, 0o644); await assert.rejects(() => verifyBundledGitFlow(directory), error => error.code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID'); await chmod(entry, 0o755);
  const license = await readFile(join(directory, 'LICENSE')); await rm(join(directory, 'LICENSE')); await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID'); await writeFile(join(directory, 'LICENSE'), license);
  const feature = join(directory, 'git-flow-feature'); const content = await readFile(feature); await rm(feature); await symlink(join(repositoryGitFlowDirectory, 'git-flow-feature'), feature); await assert.rejects(() => f.preview(change), error => error.code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID'); await rm(feature); await writeFile(feature, content);
  assert.equal((await verifyBundledGitFlow(directory)).files, 13); assert.deepEqual(await readFile(join(f.cwd, '.git/config')), config); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('packaged apps require their own resource directory instead of falling back to the source checkout or a system tool', native, async t => {
  const f = await fixture(t); const resources = join(f.root, 'Missing.app', 'Contents', 'Resources'); await mkdir(resources, { recursive: true }); usePackagedResources(t, resources);
  await assert.rejects(() => getProjectGitFlowState(f.cwd), error => error.code === 'ASTRAGIT_GIT_FLOW_RESOURCE_INVALID'); assert.equal(await f.git('config', '--get-regexp', '^gitflow\\.').catch(() => ''), '');
});

test('a replaced but internally consistent bundled source invalidates the old review even when its version is unchanged', native, async t => {
  const f = await fixture(t); const resources = join(f.root, 'Resources'); await mkdir(resources); const directory = join(resources, 'git-flow-avh'); await cp(repositoryGitFlowDirectory, directory, { recursive: true }); usePackagedResources(t, resources);
  const change = { operation: 'init', configuration }; const p = await f.preview(change); const entry = join(directory, 'git-flow-feature'); await writeFile(entry, Buffer.concat([await readFile(entry), Buffer.from('\n# locally replaced source\n')]));
  const { createHash } = await import('node:crypto'); const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); manifest.files['git-flow-feature'].sha256 = createHash('sha256').update(await readFile(entry)).digest('hex'); await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await verifyBundledGitFlow(directory); await assert.rejects(() => f.run(change, p.fingerprint), error => error.code === 'ASTRAGIT_GIT_FLOW_CHANGED'); assert.equal((await getProjectGitFlowState(f.cwd)).initialized, false);
});
