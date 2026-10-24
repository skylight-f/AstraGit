import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { parseGitArchiveInput, getProjectGitArchivePreview, writeProjectGitArchive } from '../packages/git-core/dist/index.js';
import { writeGitArchive } from '../packages/git-core/dist/gitArchive.js';
import { startGitServer } from '../packages/git-server/dist/index.js';
import { createFileSecretStore } from '../packages/git-server/dist/securityCore.js';
import { createDashboardClientLike } from '../apps/desktop/src/renderer/clientBootstrap.ts';
import { createArchiveFileAccess } from '../apps/desktop/src/main/archiveFileAccess.ts';

const exec = promisify(execFile);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(t, unborn = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'astragit-archive-')));
  const cwd = join(root, 'source'); await mkdir(cwd);
  const cleanup = []; t.after(async () => { for (const close of cleanup) await close(); await rm(root, { recursive: true, force: true }); });
  const git = (...args) => exec('git', args, { cwd, env }).then(result => result.stdout.trim());
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Archive Test'); await git('config', 'user.email', 'archive@astragit.invalid');
  await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'));
  await writeFile(join(cwd, 'text.txt'), 'committed source\n');
  await writeFile(join(cwd, 'binary.bin'), Buffer.from([0, 255, 12, 10]));
  await writeFile(join(cwd, 'tab\t换行\n.txt'), 'special name\n');
  await writeFile(join(cwd, 'run.sh'), '#!/bin/sh\nexit 0\n'); await chmod(join(cwd, 'run.sh'), 0o755);
  await symlink('text.txt', join(cwd, 'link'));
  await writeFile(join(cwd, 'private.txt'), 'export ignored\n');
  await writeFile(join(cwd, 'version.txt'), '$Format:%H$\n');
  await writeFile(join(cwd, '.gitattributes'), 'private.txt export-ignore\nversion.txt export-subst\n');
  if (!unborn) { await git('add', '.'); await git('commit', '-m', 'archive baseline'); }
  return { root, cwd, git, cleanup };
}
function sink() { const chunks = []; return { chunks, output: new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }) }; }
async function archive(cwd, input) { const { chunks, output } = sink(); const result = await writeProjectGitArchive(cwd, input, output); return { bytes: Buffer.concat(chunks), result }; }
async function inspect(path, format) {
  const code = `import sys,json,zipfile,tarfile\np=sys.argv[1]\nif sys.argv[2]=='zip':\n a=zipfile.ZipFile(p); items=[{'name':i.filename,'mode':i.external_attr>>16,'data':a.read(i).hex()} for i in a.infolist() if not i.is_dir()]\nelse:\n a=tarfile.open(p); items=[{'name':i.name,'mode':i.mode,'link':i.linkname,'data':a.extractfile(i).read().hex() if i.isfile() else ''} for i in a.getmembers() if not i.isdir()]\nprint(json.dumps(items))`;
  return JSON.parse((await exec('/usr/bin/python3', ['-c', code, path, format])).stdout);
}

test('ZIP, TAR and TAR.GZ export native committed snapshots with attributes, modes and unusual paths', async t => {
  const f = await fixture(t); const commit = await f.git('rev-parse', 'HEAD');
  await writeFile(join(f.cwd, 'text.txt'), 'staged but excluded\n'); await f.git('add', 'text.txt');
  await writeFile(join(f.cwd, 'text.txt'), 'working but excluded\n'); await writeFile(join(f.cwd, 'untracked.txt'), 'not archived\n');
  await writeFile(join(f.cwd, '.gitattributes'), '* export-ignore\n');
  const index = await readFile(join(f.cwd, '.git/index')); const objects = await f.git('count-objects', '-v');
  for (const format of ['zip', 'tar', 'tar.gz']) {
    const input = { revision: 'main', format, prefix: 'project/源码' }; const { bytes, result } = await archive(f.cwd, input);
    assert.equal(result.commitHash, commit); assert.equal(result.prefix, 'project/源码/'); assert.equal(result.byteLength, bytes.length); assert.equal(result.sha256, hash(bytes));
    const path = join(f.root, `output.${format}`); await writeFile(path, bytes); const items = await inspect(path, format);
    const byName = new Map(items.map(item => [item.name, item])); const prefix = 'project/源码/';
    assert.equal(Buffer.from(byName.get(prefix + 'text.txt').data, 'hex').toString(), 'committed source\n');
    assert.deepEqual(Buffer.from(byName.get(prefix + 'binary.bin').data, 'hex'), Buffer.from([0, 255, 12, 10]));
    assert.equal(Buffer.from(byName.get(prefix + 'tab\t换行\n.txt').data, 'hex').toString(), 'special name\n');
    assert.equal(Buffer.from(byName.get(prefix + 'version.txt').data, 'hex').toString(), commit + '\n');
    assert.equal(byName.has(prefix + 'private.txt'), false); assert.equal(byName.has(prefix + 'untracked.txt'), false);
    assert.equal(byName.get(prefix + 'run.sh').mode & 0o111, 0o111);
    if (format === 'zip') { assert.equal(byName.get(prefix + 'link').mode & 0o170000, 0o120000); assert.equal(Buffer.from(byName.get(prefix + 'link').data, 'hex').toString(), 'text.txt'); }
    else assert.equal(byName.get(prefix + 'link').link, 'text.txt');
    const native = (await exec('git', ['archive', `--format=${format === 'zip' ? 'zip' : 'tar'}`, `--prefix=${prefix}`, commit], { cwd: f.cwd, env, encoding: 'buffer' })).stdout;
    assert.deepEqual(format === 'tar.gz' ? gunzipSync(bytes) : bytes, native);
  }
  assert.deepEqual(await readFile(join(f.cwd, '.git/index')), index); assert.equal(await f.git('rev-parse', 'HEAD'), commit); assert.equal(await f.git('count-objects', '-v'), objects);
});

test('reviewed commits stay fixed after branch changes and custom gzip commands are not executed', async t => {
  const f = await fixture(t); const preview = await getProjectGitArchivePreview(f.cwd, { revision: 'main', format: 'tar.gz' });
  await writeFile(join(f.cwd, 'text.txt'), 'next commit\n'); await f.git('add', '.'); await f.git('commit', '-m', 'later commit');
  const sentinel = join(f.root, 'must-not-run'); await f.git('config', 'tar.tar.gz.command', `touch '${sentinel}'`);
  const { bytes, result } = await archive(f.cwd, { revision: preview.commitHash, format: preview.format, prefix: preview.prefix });
  assert.equal(result.commitHash, preview.commitHash); const path = join(f.root, 'fixed.tar.gz'); await writeFile(path, bytes);
  const items = await inspect(path, 'tar.gz'); assert.equal(Buffer.from(items.find(item => item.name === 'text.txt').data, 'hex').toString(), 'committed source\n');
  await assert.rejects(() => readFile(sentinel), error => error.code === 'ENOENT');
});

test('large archives stream through backpressure and preserve complete binary content', async t => {
  const f = await fixture(t); const bytes = randomBytes(9 * 1024 * 1024 + 37); await writeFile(join(f.cwd, 'large.bin'), bytes); await f.git('add', '.'); await f.git('commit', '-m', 'large source');
  const chunks = []; let writes = 0;
  const output = new Writable({ highWaterMark: 1024, write(chunk, _encoding, callback) { writes++; chunks.push(Buffer.from(chunk)); setImmediate(callback); } });
  const result = await writeProjectGitArchive(f.cwd, { revision: 'HEAD', format: 'tar' }, output); assert.ok(writes > 10); assert.ok(result.byteLength > 9 * 1024 * 1024);
  const archiveBytes = Buffer.concat(chunks); assert.equal(result.sha256, hash(archiveBytes));
  const path = join(f.root, 'large.tar'); await writeFile(path, archiveBytes); const extracted = (await exec('tar', ['-xOf', path, 'large.bin'], { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 })).stdout; assert.deepEqual(extracted, bytes);
});

test('invalid archive inputs and unborn or missing revisions fail before exporting', async t => {
  const f = await fixture(t); const invalid = value => assert.throws(() => parseGitArchiveInput(value), error => error.code === 'ASTRAGIT_GIT_ARCHIVE_INVALID');
  for (const value of [null, [], { format: {} }, { format: 'rar' }, { revision: '' }, { revision: 'HEAD\0' }, { prefix: '/tmp/' }, { prefix: '../' }, { prefix: 'x/../' }, { prefix: 'C:/x' }, { prefix: 'x\\y' }, { output: '/tmp/file' }]) invalid(value);
  await assert.rejects(() => getProjectGitArchivePreview(f.cwd, { revision: 'missing-branch' }), error => error.code === 'ASTRAGIT_GIT_ARCHIVE_REVISION_INVALID');
  const unborn = await fixture(t, true); await assert.rejects(() => getProjectGitArchivePreview(unborn.cwd, {}), error => error.code === 'ASTRAGIT_GIT_ARCHIVE_REVISION_INVALID');
  assert.deepEqual(parseGitArchiveInput({ prefix: 'source/v1' }), { revision: 'HEAD', format: 'zip', prefix: 'source/v1/' });
});

test('sink errors and cancellation terminate archive subprocesses without reporting partial success', async t => {
  const f = await fixture(t); const started = deferred(); const controller = new AbortController();
  const output = new Writable({ write(_chunk, _encoding, callback) { started.resolve(); controller.abort(); callback(); } });
  await assert.rejects(() => writeProjectGitArchive(f.cwd, { format: 'tar' }, output, controller.signal), error => error.code === 'ASTRAGIT_CANCELLED');
  await started.promise;
  const broken = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('destination full')); } });
  await assert.rejects(() => writeProjectGitArchive(f.cwd, { format: 'tar' }, broken), /destination full/u);
  const controller2 = new AbortController(); controller2.abort(); await assert.rejects(() => writeGitArchive(f.cwd, {}, sink().output, { signal: controller2.signal, env }));
});

function nativeAccess(f, chooseSave, generate) {
  return createArchiveFileAccess({ chooseSave, preview: (request, signal) => getProjectGitArchivePreview(f.cwd, request.input, signal), generate: generate ?? ((request, output, signal) => writeProjectGitArchive(f.cwd, request.input, output, signal)) });
}
async function requestFor(f) { return { id: randomUUID(), projectId: 'project', repositoryId: 'repository', input: { revision: await f.git('rev-parse', 'HEAD'), format: 'zip', prefix: '' } }; }
const temporaries = async root => (await readdir(root)).filter(name => name.startsWith('.astragit-archive-'));

test('native save writes complete archives atomically and rejects renderer paths or unfixed revisions', async t => {
  const f = await fixture(t); const path = join(f.root, 'native.zip'); await writeFile(path, 'previous file'); let choices = 0;
  const access = nativeAccess(f, async () => { choices++; return path; }); const request = await requestFor(f);
  assert.equal((await access.save({ ...request, path })).ok, false); assert.equal((await access.save({ ...request, input: { ...request.input, revision: 'main' } })).ok, false); assert.equal(choices, 0);
  const result = await access.save(request); assert.equal(result.ok, true); assert.equal(result.canceled, false); assert.equal(result.name, 'native.zip'); assert.equal(result.sha256, hash(await readFile(path))); assert.deepEqual(await temporaries(f.root), []); assert.equal(access.isBusy(), false);
  const items = await inspect(path, 'zip'); assert.ok(items.some(item => item.name === 'text.txt'));
});

test('failed or cancelled native exports keep existing destinations and clean temporary files', async t => {
  const f = await fixture(t); const path = join(f.root, 'kept.zip'); await writeFile(path, 'keep me');
  const failed = nativeAccess(f, async () => path, async (_request, output) => { await pipeline((async function* () { yield Buffer.from('partial'); })(), output); throw new Error('disk full'); });
  const result = await failed.save(await requestFor(f)); assert.equal(result.ok, false); assert.equal(result.error.code, 'ASTRAGIT_GIT_ARCHIVE_SAVE_FAILED'); assert.equal(await readFile(path, 'utf8'), 'keep me'); assert.deepEqual(await temporaries(f.root), []);
  const started = deferred(); const canceled = nativeAccess(f, async () => path, async (_request, output, signal) => {
    started.resolve(); await pipeline((async function* () { yield Buffer.from('partial'); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); })(), output, { signal });
  });
  const request = await requestFor(f); const pending = canceled.save(request); await started.promise; assert.equal(canceled.cancel('wrong-id'), false); assert.equal(canceled.cancel(request.id), true); assert.equal((await pending).canceled, true);
  assert.equal(await readFile(path, 'utf8'), 'keep me'); assert.deepEqual(await temporaries(f.root), []); assert.equal(canceled.isBusy(), false);
});

test('native save cancellation, busy rejection and shutdown never resume a cancelled picker write', async t => {
  const f = await fixture(t); const picked = deferred(); const entered = deferred(); let generated = 0;
  const access = nativeAccess(f, async () => { entered.resolve(); return picked.promise; }, async () => { generated++; throw new Error('should not run'); });
  const pending = access.save(await requestFor(f)); await entered.promise; const busy = await access.save(await requestFor(f)); assert.equal(busy.ok, false); assert.equal(busy.error.code, 'ASTRAGIT_GIT_ARCHIVE_BUSY');
  await access.close(); picked.resolve(join(f.root, 'after-close.zip')); assert.equal((await pending).canceled, true); assert.equal(generated, 0); assert.deepEqual(await temporaries(f.root), []);
  const canceled = nativeAccess(f, async () => null); assert.equal((await canceled.save(await requestFor(f))).canceled, true);
});

test('HTTP archive previews and embedded streaming target the owned repository without a write operation', async t => {
  const f = await fixture(t); const data = join(f.root, 'data'); const server = await startGitServer({ dataDirectory: data, projectRoot: f.root, apiToken: 'archive-tests', secretStore: createFileSecretStore(join(data, 'secrets.json')), codexNativeEnabled: false }); f.cleanup.push(() => server.close());
  const client = createDashboardClientLike({ baseUrl: server.baseUrl, apiToken: server.apiToken }); const project = await client.createProject({ name: 'Archive', localPath: f.cwd }); const repository = (await client.loadProjectGitWorkbench(project.id)).repositories[0];
  const preview = await client.previewRepositoryGitArchive(project.id, repository.id, { revision: 'HEAD', format: 'tar', prefix: 'snapshot' }); assert.equal(preview.commitHash, await f.git('rev-parse', 'HEAD'));
  await assert.rejects(() => client.previewRepositoryGitArchive(project.id, 'wrong', {}), error => error.error === 'ASTRAGIT_REPOSITORY_NOT_FOUND');
  const response = await fetch(`${server.baseUrl}/api/projects/${project.id}/git/workbench/repositories/${repository.id}/archive-preview`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-astragit-api-token': server.apiToken }, body: JSON.stringify({ prefix: '../' }) }); assert.equal(response.status, 400);
  const { output, chunks } = sink(); const result = await server.writeGitArchive(project.id, repository.id, { revision: preview.commitHash, format: preview.format, prefix: preview.prefix }, output); assert.equal(result.sha256, hash(Buffer.concat(chunks)));
  assert.equal((await client.loadProjectGitOperations(project.id)).items.length, 0);
});
