import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { buildWorkspaceGitCommandRequest } from '../apps/desktop/src/renderer/features/git/workspaceGitCommandClient.ts';
import { executeProjectGitAction, getProjectGitExternalToolSettings, getProjectGitExternalToolPreview } from '../packages/git-core/dist/index.js';

const exec = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'astragit-external-tools-')); const cwd = join(root, 'repository'); await mkdir(cwd);
  const global = join(root, 'global.gitconfig'); await writeFile(global, ''); const previous = process.env.GIT_CONFIG_GLOBAL; process.env.GIT_CONFIG_GLOBAL = global; process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => { if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous; await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, LC_ALL: 'C' }; const raw = async (directory, ...args) => (await exec('git', args, { cwd: directory, env })).stdout;
  const git = async (...args) => (await raw(cwd, ...args)).trim();
  await git('init', '--initial-branch=main'); await git('config', 'user.name', 'Tool Test'); await git('config', 'user.email', 'tool@astragit.invalid'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'file.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base');
  const run = (action, signal) => executeProjectGitAction(cwd, action, signal, env);
  const configure = async (kind, command, name = 'astragit-test', scope = 'local') => run({ type: 'configure_external_tool', configuration: { kind, scope, toolName: name, command, executable: null, ...(kind === 'merge' ? { keepBackup: false } : {}) }, expectedFingerprint: (await getProjectGitExternalToolSettings(cwd)).fingerprint });
  const preview = input => getProjectGitExternalToolPreview(cwd, input);
  const tool = async (input, expectedFingerprint, signal) => run({ type: 'external_tool', input, expectedFingerprint: expectedFingerprint ?? (await preview(input)).fingerprint }, signal);
  const script = join(root, 'capture.mjs'); const captured = join(root, 'captured.json');
  await writeFile(script, `import fs from 'node:fs';\nconst paths = process.argv.slice(2);\nfs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(paths.map(path => ({ path, data: fs.readFileSync(path).toString('base64') }))));\n`);
  const command = `${quote(process.execPath)} ${quote(script)} "$LOCAL" "$REMOTE"`;
  const conflict = async () => {
    await git('switch', '-c', 'incoming'); await writeFile(join(cwd, 'file.txt'), 'incoming\n'); await git('commit', '-am', 'incoming'); await git('switch', 'main'); await writeFile(join(cwd, 'file.txt'), 'current\n'); await git('commit', '-am', 'current'); await assert.rejects(() => git('merge', 'incoming'));
  };
  return { root, cwd, global, env, raw, git, run, configure, preview, tool, command, captured, conflict };
}

test('external tool settings support local/global override and changed-configuration protection without touching unrelated config', async t => {
  const f = await fixture(t); await f.configure('diff', f.command, 'global-tool', 'global'); let settings = await getProjectGitExternalToolSettings(f.cwd);
  assert.equal(settings.selected.diff, 'global-tool'); assert.equal(settings.entries.find(item => item.key === 'difftool.global-tool.cmd').global, f.command);
  await f.git('config', 'remote.origin.url', 'https://example.invalid/repo.git'); const before = await f.git('config', 'remote.origin.url'); await f.configure('diff', f.command, 'local-tool');
  settings = await getProjectGitExternalToolSettings(f.cwd); assert.equal(settings.selected.diff, 'local-tool'); assert.ok(settings.tools.find(item => item.name === 'local-tool' && item.configured)); assert.equal(await f.git('config', 'remote.origin.url'), before);
  const stale = settings.fingerprint; await f.git('config', 'diff.tool', 'opendiff'); await assert.rejects(() => f.run({ type: 'configure_external_tool', expectedFingerprint: stale, configuration: { scope: 'local', kind: 'diff', toolName: 'other', command: f.command, executable: null } }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_CHANGED');
});

test('staged, unstaged and combined comparison send exact binary bytes and leave repository content and index unchanged', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); const staged = Buffer.from([0, 255, 10, 13, 3]); const working = Buffer.from([0, 254, 10, 13, 4]); await writeFile(join(f.cwd, 'file.txt'), staged); await f.git('add', 'file.txt'); await writeFile(join(f.cwd, 'file.txt'), working);
  const index = await readFile(join(f.cwd, '.git/index'));
  for (const [stage, expected] of [['staged', [Buffer.from('base\n'), staged]], ['unstaged', [staged, working]], ['combined', [Buffer.from('base\n'), working]]]) {
    const result = await f.tool({ mode: 'diff', paths: ['file.txt'], stage }); assert.equal(result.outcome, 'completed'); const captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64')), expected); assert.equal(captured.every(item => !item.path.startsWith(f.cwd)), true);
    assert.deepEqual(await readFile(join(f.cwd, 'file.txt')), working); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
  }
});

test('root commit, renames, deletion and two revisions retain correct before/after files including literal special paths', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); const first = await f.git('rev-parse', 'HEAD'); await f.tool({ mode: 'diff', paths: ['file.txt'], commitHash: first }); let captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), ['', 'base\n']);
  const renamed = 'renamed\n[?].txt'; await f.git('mv', 'file.txt', renamed); await writeFile(join(f.cwd, renamed), 'renamed content\n'); await f.git('add', '.'); await f.git('commit', '-m', 'rename'); const second = await f.git('rev-parse', 'HEAD');
  await f.tool({ mode: 'diff', paths: [renamed], revisions: [first, second] }); captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.equal(Buffer.from(captured[1].data, 'base64').toString(), 'renamed content\n');
  await f.git('rm', '--', renamed); await f.tool({ mode: 'diff', paths: [renamed], stage: 'staged' }); captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), ['renamed content\n', '']);
});

test('untracked and unborn files compare against an empty version without adding objects or staging files', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); await f.git('checkout', '--orphan', 'unborn'); await f.git('rm', '-rf', '.'); await writeFile(join(f.cwd, 'new.txt'), 'new\n');
  await f.tool({ mode: 'diff', paths: ['new.txt'], stage: 'combined' }); const captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), ['', 'new\n']); assert.equal(await f.git('ls-files'), '');
});

test('changed worktree bytes, refs or tool command invalidate confirmation before starting a tool', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); await writeFile(join(f.cwd, 'file.txt'), 'changed\n'); const input = { mode: 'diff', paths: ['file.txt'], stage: 'combined' }; const preview = await f.preview(input);
  await writeFile(join(f.cwd, 'file.txt'), 'changed again\n'); await assert.rejects(() => f.tool(input, preview.fingerprint), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_CHANGED'); await assert.rejects(() => access(f.captured));
  const next = await f.preview(input); await f.git('config', 'difftool.astragit-test.cmd', 'exit 0'); await assert.rejects(() => f.tool(input, next.fingerprint), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_CHANGED');
});

test('external merge first uses a temporary index and can leave the result for built-in review without staging', async t => {
  const f = await fixture(t); await f.conflict(); await f.configure('merge', 'cp "$REMOTE" "$MERGED"'); const before = await readFile(join(f.cwd, '.git/index')); const mergeHead = await readFile(join(f.cwd, '.git/MERGE_HEAD'));
  const result = await f.tool({ mode: 'merge', paths: ['file.txt'], markResolved: false }); assert.equal(result.outcome, 'completed'); assert.deepEqual(result.conflictFiles, ['file.txt']); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'incoming\n'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before); assert.deepEqual(await readFile(join(f.cwd, '.git/MERGE_HEAD')), mergeHead);
});

test('successful reviewed external merge stages only selected paths and never creates a merge commit', async t => {
  const f = await fixture(t); await f.conflict(); await f.configure('merge', 'cp "$REMOTE" "$MERGED"'); await writeFile(join(f.cwd, 'unrelated.txt'), 'unrelated\n'); await f.git('add', 'unrelated.txt'); const head = await f.git('rev-parse', 'HEAD'); const unrelated = await f.git('rev-parse', ':unrelated.txt');
  const result = await f.tool({ mode: 'merge', paths: ['file.txt'], markResolved: true }); assert.equal(result.outcome, 'completed'); assert.deepEqual(result.conflictFiles, []); assert.equal(await f.git('show', ':file.txt'), 'incoming'); assert.equal(await f.git('rev-parse', ':unrelated.txt'), unrelated); assert.equal(await f.git('rev-parse', 'HEAD'), head); await access(join(f.cwd, '.git/MERGE_HEAD'));
});

test('a zero tool exit cannot mark unresolved conflict markers as resolved, and failing tools retain the real unmerged index', async t => {
  const f = await fixture(t); await f.conflict(); await f.configure('merge', 'exit 0'); const index = await readFile(join(f.cwd, '.git/index')); const original = await readFile(join(f.cwd, 'file.txt'), 'utf8');
  await assert.rejects(() => f.tool({ mode: 'merge', paths: ['file.txt'], markResolved: true }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN' && error.details.includes('冲突标记'));
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.ok((await f.git('ls-files', '--unmerged')).length);
  await f.configure('merge', 'printf "saved but failed\\n" > "$MERGED"; exit 3'); await assert.rejects(() => f.tool({ mode: 'merge', paths: ['file.txt'], markResolved: true }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN');
  // Native mergetool restores this failing path from its backup. Other paths
  // may already have completed, so the application does not promise rollback.
  assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), original); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index);
});

test('outside, metadata, symlink-ancestor and malformed tool requests never start a tool', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); await symlink(f.root, join(f.cwd, 'linked'));
  for (const path of ['../outside', '.git/config', 'a/.GiT/config', 'linked/global.gitconfig']) await assert.rejects(() => f.preview({ mode: 'diff', paths: [path] }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_PATH');
  await assert.rejects(() => f.preview({ mode: 'diff', paths: ['file.txt'], stage: ['staged'] }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_INVALID'); await assert.rejects(() => access(f.captured));
});


test('removing a local default restores the global selection without deleting reusable tool definitions', async t => {
  const f = await fixture(t); await f.configure('diff', f.command, 'global-tool', 'global'); await f.configure('diff', f.command, 'local-tool'); const settings = await getProjectGitExternalToolSettings(f.cwd);
  await f.run({ type: 'configure_external_tool', configuration: { kind: 'diff', scope: 'local', toolName: 'local-tool', command: null, executable: null, inheritSelection: true }, expectedFingerprint: settings.fingerprint });
  const after = await getProjectGitExternalToolSettings(f.cwd); assert.equal(after.selected.diff, 'global-tool'); assert.equal(after.entries.find(item => item.key === 'difftool.local-tool.cmd').local, f.command);
});

test('symlinks compare link contents rather than targets, and stash untracked files use the stash third parent', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); const outside = join(f.root, 'outside.txt'); await writeFile(outside, 'outside private content'); await symlink(outside, join(f.cwd, 'link.txt')); await f.git('add', 'link.txt'); await f.git('commit', '-m', 'link'); await rm(join(f.cwd, 'link.txt')); await symlink('another-target', join(f.cwd, 'link.txt'));
  await f.tool({ mode: 'diff', paths: ['link.txt'], stage: 'unstaged' }); let captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), [outside, 'another-target']);
  await writeFile(join(f.cwd, 'untracked.txt'), 'stashed untracked\n'); await f.git('stash', 'push', '--include-untracked', '-m', 'stash');
  await f.tool({ mode: 'diff', paths: ['untracked.txt'], commitHash: 'stash@{0}' }); captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), ['', 'stashed untracked\n']);
});

test('recognized historical renames preserve the old path and bytes in external comparison', async t => {
  const f = await fixture(t); await f.configure('diff', f.command); const before = Array.from({ length: 100 }, (_, index) => `line ${index}\n`).join(''); await writeFile(join(f.cwd, 'file.txt'), before); await f.git('commit', '-am', 'long original'); const old = await f.git('rev-parse', 'HEAD');
  await f.git('mv', 'file.txt', 'renamed.txt'); const after = before.replace('line 50\n', 'line fifty\n'); await writeFile(join(f.cwd, 'renamed.txt'), after); await f.git('commit', '-am', 'rename with small edit');
  await f.tool({ mode: 'diff', paths: ['renamed.txt'], revisions: [old, 'HEAD'] }); const captured = JSON.parse(await readFile(f.captured, 'utf8')); assert.deepEqual(captured.map(item => Buffer.from(item.data, 'base64').toString()), [before, after]);
});

test('a real index change while the merge tool runs prevents automatic resolution and retains unrelated staged content', async t => {
  const f = await fixture(t); await f.conflict(); await writeFile(join(f.cwd, 'other.txt'), 'other\n');
  await f.configure('merge', `cp "$REMOTE" "$MERGED"; GIT_INDEX_FILE=${quote(join(f.cwd, '.git/index'))} git add -- other.txt`);
  await assert.rejects(() => f.tool({ mode: 'merge', paths: ['file.txt'], markResolved: true }), error => error.code === 'ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN' && error.details.includes('暂存区已变化'));
  assert.equal(await f.git('show', ':other.txt'), 'other'); assert.ok((await f.git('ls-files', '--unmerged', '--', 'file.txt')).length); assert.equal(await readFile(join(f.cwd, 'file.txt'), 'utf8'), 'incoming\n');
});

test('in-flight tool cancellation keeps the real conflict index and reports an unconfirmed result', async t => {
  const f = await fixture(t); await f.conflict(); const marker = join(f.root, 'started'); await f.configure('merge', `echo started > ${quote(marker)}; sleep 20; cp "$REMOTE" "$MERGED"`); const input = { mode: 'merge', paths: ['file.txt'], markResolved: true }; const preview = await f.preview(input); const before = await readFile(join(f.cwd, '.git/index')); const controller = new AbortController();
  const pending = f.tool(input, preview.fingerprint, controller.signal).then(value => ({ value }), error => ({ error }));
  let started = false; for (let attempt = 0; attempt < 300; attempt += 1) { try { await access(marker); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); } }
  controller.abort(); const result = await pending; assert.equal(started, true); assert.equal(result.error?.code, 'ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN'); assert.equal(result.error?.operationStatus, 'unknown_after_write'); assert.deepEqual(await readFile(join(f.cwd, '.git/index')), before);
});

test('HTTP tool launch requires a dedicated durable command and replays after restart without launching the tool twice', async t => {
  const f = await fixture(t); const count = join(f.root, 'launched'); await f.configure('diff', `echo launched >> ${quote(count)}; ${f.command}`); await writeFile(join(f.cwd, 'file.txt'), 'updated\n');
  const data = join(f.root, 'data'); const options = { dataDirectory: data, projectRoot: f.root, apiToken: 'external-tool-test', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }; let server = await startGitServer(options); t.after(() => server.close());
  let client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'External tools', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0]; const input = { mode: 'diff', paths: ['file.txt'], stage: 'combined' }; const preview = await client.previewRepositoryGitExternalTool(project.id, repository.id, input); const action = { type: 'external_tool', input, expectedFingerprint: preview.fingerprint };
  const envelope = await buildWorkspaceGitCommandRequest({ commandType: 'git.workbench.repository.action', scopeKind: 'git_repository', scopeId: repository.id, value: action });
  const send = async (body, route = 'external-tool') => { const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; };
  assert.equal((await send(action)).status, 400); assert.equal((await send(envelope, 'actions')).status, 400); const first = await send(envelope); assert.equal(first.status, 200); assert.equal(first.value.result.outcome, 'completed');
  await writeFile(join(f.cwd, 'file.txt'), 'changed after saved receipt\n'); await server.close(); server = await startGitServer(options); client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); assert.deepEqual(await send(envelope), first); assert.equal((await readFile(count, 'utf8')).trim(), 'launched'); assert.equal((await client.loadRepositoryGitExternalTools(project.id, repository.id)).selected.diff, 'astragit-test');
});


test('a failed post-tool status read is unconfirmed rather than a fabricated completed result', async t => {
  const f = await fixture(t); await writeFile(join(f.cwd, 'file.txt'), 'changed\n'); await f.configure('diff', `printf invalid > ${quote(join(f.cwd, '.git/index'))}`);
  await assert.rejects(() => f.tool({ mode: 'diff', paths: ['file.txt'], stage: 'combined' }), error => error.code === 'ASTRAGIT_GIT_ACTION_STATE_READ_FAILED' && error.operationStatus === 'unknown_after_write');
});
