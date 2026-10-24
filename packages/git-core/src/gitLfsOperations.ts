import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, readlink, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { devNull } from 'node:os';
import { GitHistoryReader } from './gitFileHistory.js';

export interface GitLfsChange {
  operation: 'install' | 'track' | 'untrack' | 'fetch' | 'pull' | 'push';
  directory?: string; pattern?: string; literal?: boolean; lockable?: boolean;
  skipHooks?: boolean; remote?: string; include?: string; exclude?: string;
}
export interface GitLfsPattern { pattern: string; source: string; lockable: boolean; tracked: boolean; directory?: string; inputPattern?: string }
export interface GitLfsFile { name: string; size: number; oid: string; downloaded: boolean; checkout: boolean }
export interface GitLfsState {
  available: boolean; version: string; fingerprint: string; headSha: string; branch: string;
  requiresInitialization: boolean;
  configured: boolean; patterns: GitLfsPattern[]; files: GitLfsFile[]; remotes: string[];
  hookPath: string; hookPresent: boolean; status: string;
}
export interface GitLfsPreview { fingerprint: string; change: GitLfsChange; state: GitLfsState; effects: string[] }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; redact?: (text: string) => string; onWrite?: (path: string) => Promise<void> };
type Run = (args: string[]) => Promise<{ stdout: string; stderr: string }>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (suffix: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_LFS_${suffix}`, operationStatus: 'failed_before_write', operationStage: 'preflight', statusCode: ['CHANGED', 'INTEGRATION', 'CONFLICT'].includes(suffix) ? 409 : 400, ...(details ? { details } : {}) });
const utf8 = (value: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
async function stat(path: string) { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function directory(value: unknown) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw fail('PATH', '请选择当前仓库内的目录，不得通过父目录、符号链接或 Git 元数据。');
  return value;
}
export function parseGitLfsChange(value: unknown): GitLfsChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID', 'Git LFS 操作选项无效。');
  const input = value as Record<string, unknown>;
  if (typeof input.operation !== 'string' || !['install', 'track', 'untrack', 'fetch', 'pull', 'push'].includes(input.operation)) throw fail('INVALID', '请选择支持的 Git LFS 操作。');
  const change: GitLfsChange = { operation: input.operation as GitLfsChange['operation'] };
  if (input.directory !== undefined) change.directory = directory(input.directory);
  for (const key of ['literal', 'lockable', 'skipHooks'] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw fail('INVALID', 'Git LFS 开关必须为布尔值。'); change[key] = input[key];
  }
  for (const key of ['pattern', 'remote', 'include', 'exclude'] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].length > 16_384 || /[\0\r\n]/u.test(input[key])) throw fail('INVALID', 'Git LFS 规则或远程参数无效。'); change[key] = input[key];
  }
  if (['track', 'untrack'].includes(change.operation) && (!change.pattern || isAbsolute(change.pattern) || change.pattern.split('/').some(part => part === '..' || part.toLowerCase() === '.git'))) throw fail('INVALID', '请输入仓库内的文件名或匹配规则。');
  if (change.operation !== 'track' && (change.literal !== undefined || change.lockable !== undefined)) throw fail('INVALID', '文件名和锁定选项仅用于添加跟踪规则。');
  if (!['track', 'untrack'].includes(change.operation) && change.directory) throw fail('INVALID', '此操作应在仓库根目录执行。');
  if ((change.skipHooks !== undefined && change.operation !== 'install') || (change.pattern !== undefined && !['track', 'untrack'].includes(change.operation)) || (change.remote !== undefined && !['fetch', 'pull', 'push'].includes(change.operation)) || ((change.include !== undefined || change.exclude !== undefined) && !['fetch', 'pull'].includes(change.operation))) throw fail('INVALID', '选项与当前 Git LFS 操作不匹配。');
  return change;
}
async function safeDirectory(cwd: string, path: string) {
  let current = cwd;
  for (const part of directory(path).split('/').filter(Boolean)) {
    current = join(current, part); const entry = await stat(current);
    if (!entry?.isDirectory() || entry.isSymbolicLink() || await stat(join(current, '.git'))) throw fail('PATH', '规则目录不存在、经过符号链接或属于另一个 Git 仓库。', path);
  }
  return current;
}
async function fileIdentity(path: string) {
  const entry = await stat(path); if (!entry) return null;
  if (entry.isSymbolicLink()) return { link: await readlink(path), mode: entry.mode };
  if (!entry.isFile() || entry.size > 2 * 1024 * 1024) throw fail('CONFIG', 'LFS 属性、配置或钩子必须是普通文件，且不超过 2 MiB。', path);
  return { mode: entry.mode, bytes: (await readFile(path)).toString('base64') };
}
function json(raw: string) { try { const value = JSON.parse(raw) as unknown; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON object'); return value as Record<string, unknown>; } catch { throw fail('READ', 'Git LFS 未返回有效 JSON，请安装支持 JSON 查询的新版 Git LFS。'); } }
async function repositoryState(cwd: string, runtime: Runtime) {
  cwd = await realpath(cwd);
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const [headSha, branchBytes, config, index, flags, remotes, hookRaw] = await Promise.all([
    reader.revision(), reader.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, undefined, undefined, [0, 1]),
    reader.text(['config', '--null', '--list', '--includes']), reader.text(['ls-files', '--stage', '-z']), reader.text(['ls-files', '-v', '-z']), reader.text(['remote']), reader.text(['rev-parse', '--git-path', 'hooks/pre-push']),
  ]);
  const hookPath = resolve(cwd, hookRaw.replace(/\r?\n$/u, ''));
  const integration: unknown[] = [];
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    const path = resolve(cwd, (await reader.text(['rev-parse', '--git-path', name])).replace(/\r?\n$/u, '')); const entry = await stat(path);
    if (entry) integration.push([name, entry.isDirectory() ? { mtime: entry.mtimeMs, ctime: entry.ctimeMs } : await fileIdentity(path)]);
  }
  const hook = await fileIdentity(hookPath);
  const localVersion = utf8(await reader.run(['config', '--local', '--get', 'lfs.repositoryformatversion'], undefined, undefined, undefined, [0, 1])).trim();
  const hooks: unknown[] = [];
  for (const name of ['pre-push', 'post-checkout', 'post-commit', 'post-merge']) {
    const path = resolve(cwd, (await reader.text(['rev-parse', '--git-path', 'hooks/' + name])).replace(/\r?\n$/u, '')); hooks.push([path, await fileIdentity(path)]);
  }
  return { reader, headSha, branch: utf8(branchBytes).replace(/\r?\n$/u, ''), config, index, flags, remotes: remotes.split(/\r?\n/u).filter(Boolean), hook, hookPath, hooks, localVersion, integration };
}
export async function readGitLfsState(cwd: string, runtime: Runtime = {}): Promise<GitLfsState> {
  const info = await repositoryState(cwd, runtime); let version: string;
  // `track` also tries to install hooks, even when only listing JSON. Redirect
  // that command-local hooks location to the null device; no real hook changes.
  const lfsArgs = (...args: string[]) => ['-c', `core.hooksPath=${devNull}`, 'lfs', ...args];
  try { version = (await info.reader.text(lfsArgs('version'))).trim(); }
  catch (error) {
    if ((error as { exitCode?: number }).exitCode !== 1 || !/['’]lfs['’] is not a git command/u.test((error as { stderr?: string }).stderr ?? '')) throw error;
    return { available: false, version: '', requiresInitialization: !info.localVersion, fingerprint: hash([await realpath(cwd), info.headSha, info.branch, info.config, info.index]), headSha: info.headSha, branch: info.branch, configured: false, patterns: [], files: [], remotes: info.remotes, hookPath: info.hookPath, hookPresent: info.hooks.some(value => (value as unknown[])[1]), status: '' };
  }
  const configured = ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process'].every(key => info.config.split('\0').some(record => record.startsWith(key + '\n')));
  const attributes: unknown[] = [];
  for (const source of ['.gitattributes', '.lfsconfig']) attributes.push([source, await fileIdentity(join(cwd, source))]);
  const baseIdentity = [await realpath(cwd), version, info.headSha, info.branch, info.config, info.index, info.flags, info.integration, info.hooks];
  // verifyRepositoryVersion in native Git LFS writes local config even for
  // `track --json`. Do not invoke those queries until explicit initialization.
  if (!info.localVersion) return { available: true, version, requiresInitialization: true, fingerprint: hash([...baseIdentity, attributes]), headSha: info.headSha, branch: info.branch, configured, patterns: [], files: [], remotes: info.remotes, hookPath: info.hookPath, hookPresent: info.hooks.some(value => (value as unknown[])[1]), status: '' };
  if (info.localVersion !== '0') throw fail('CONFIG', '仓库使用未知的 LFS 格式版本，未尝试修改，请使用对应版本工具核对。');
  let patternData: Record<string, unknown>, fileData: Record<string, unknown>, status: string;
  try {
    [patternData, fileData, status] = await Promise.all([info.reader.text(lfsArgs('track', '--json')).then(json), info.reader.text(lfsArgs('ls-files', '--json')).then(json), info.reader.text(lfsArgs('status'))]);
  } catch (error) {
    if ((error as { code?: string }).code === 'ASTRAGIT_CANCELLED') throw error;
    throw fail('READ', '无法完整读取 Git LFS 状态。请确认 Git LFS 版本支持 JSON 查询，并查看具体原因。', (error as { stderr?: string; message?: string }).stderr ?? (error as Error).message);
  }
  if (!Array.isArray(patternData.patterns) || (fileData.files !== null && !Array.isArray(fileData.files))) throw fail('READ', 'Git LFS 返回了不完整的跟踪规则或文件清单。');
  const patterns = (patternData.patterns as unknown[]).map(value => {
    const item = value as GitLfsPattern;
    if (!item || typeof item.pattern !== 'string' || typeof item.source !== 'string' || typeof item.lockable !== 'boolean' || typeof item.tracked !== 'boolean') throw fail('READ', 'Git LFS 跟踪规则格式无效。');
    let input: { directory?: string; inputPattern?: string } = {};
    if (item.source === '.gitattributes' || item.source.endsWith('/.gitattributes')) {
      const target = item.source === '.gitattributes' ? '' : item.source.slice(0, -'/.gitattributes'.length);
      try {
        directory(target);
        if (!target || item.pattern.startsWith(target + '/')) {
          // Native JSON uses repository-qualified, attribute-escaped patterns;
          // untrack expects the command-directory-relative, unescaped form.
          const pattern = (target ? item.pattern.slice(target.length + 1) : item.pattern).replaceAll('[[:space:]]', ' ').replaceAll('\\#', '#').replaceAll('\\\\', '\\');
          input = { directory: target, inputPattern: pattern };
        }
      } catch { /* Other attribute sources are visible but not editable here. */ }
    }
    return { pattern: item.pattern, source: item.source, lockable: item.lockable, tracked: item.tracked, ...input };
  });
  const files = ((fileData.files ?? []) as unknown[]).map(value => {
    const item = value as GitLfsFile;
    if (!item || typeof item.name !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0 || !/^[a-f0-9]{64}$/u.test(item.oid) || typeof item.downloaded !== 'boolean' || typeof item.checkout !== 'boolean') throw fail('READ', 'Git LFS 文件清单格式无效。');
    directory(item.name); return { name: item.name, size: item.size, oid: item.oid, downloaded: item.downloaded, checkout: item.checkout };
  });
  // Include native scope sources without following global or symlink sources for writes.
  for (const source of [...new Set(patterns.map(item => item.source))].filter(source => !['.gitattributes', '.lfsconfig'].includes(source))) attributes.push([source, await fileIdentity(resolve(cwd, source))]);
  return { available: true, version, requiresInitialization: false, fingerprint: hash([...baseIdentity, attributes, patterns, files]), headSha: info.headSha, branch: info.branch, configured, patterns, files, remotes: info.remotes, hookPath: info.hookPath, hookPresent: info.hooks.some(value => (value as unknown[])[1]), status: runtime.redact?.(status) ?? status };
}
async function worktreeIdentity(cwd: string, files: GitLfsFile[], runtime: Runtime) {
  const values: unknown[] = [];
  for (const file of files) {
    runtime.signal?.throwIfAborted(); const parts = file.name.split('/'); await safeDirectory(cwd, parts.slice(0, -1).join('/'));
    const absolute = join(cwd, file.name); const entry = await stat(absolute);
    if (!entry) { values.push([file.name, null]); continue; }
    if (entry.isSymbolicLink() || !entry.isFile()) throw fail('PATH', 'LFS 文件被符号链接或目录占用，请先核对。', file.name);
    const handle = await open(absolute, 'r');
    try {
      const current = await handle.stat(); if (current.ino !== entry.ino || current.dev !== entry.dev) throw fail('CHANGED', '读取时 LFS 文件已被替换，请刷新。', file.name);
      const buffer = Buffer.alloc(Math.min(entry.size, 1024)); await handle.read(buffer, 0, buffer.length, 0);
      values.push([file.name, entry.dev, entry.ino, entry.mode, entry.size, entry.mtimeMs, entry.ctimeMs, buffer.toString('base64')]);
    } finally { await handle.close(); }
  }
  return values;
}
export async function previewGitLfs(cwd: string, value: unknown, runtime: Runtime = {}): Promise<GitLfsPreview> {
  const change = parseGitLfsChange(value); const state = await readGitLfsState(cwd, runtime);
  if (!state.available) throw fail('UNAVAILABLE', '未找到独立系统 Git LFS。请安装 git-lfs 后重新读取。');
  if (state.requiresInitialization && change.operation !== 'install') throw fail('INIT_REQUIRED', '请先明确初始化当前仓库的 LFS，再读取规则或传输内容。');
  if (['fetch', 'pull', 'push'].includes(change.operation) && (!change.remote || !state.remotes.includes(change.remote))) throw fail('REMOTE', '请选择当前仓库中实际存在的远程。');
  const info = await repositoryState(cwd, runtime); const effects: string[] = [];
  if (['fetch', 'pull', 'push'].includes(change.operation) && !state.headSha) throw fail('EMPTY', '当前仓库尚无提交，请先创建需要传输的 LFS 版本。');
  if (change.operation === 'install' && !change.skipHooks && info.hook && 'link' in info.hook) throw fail('HOOK', 'pre-push 钩子是符号链接。请选择保留现有钩子，并手动整合 LFS 调用。');
  if (change.operation === 'pull' && info.integration.length) throw fail('INTEGRATION', '请先完成当前合并、变基或邮件应用，再下载并检出 LFS 文件。');
  if (['track', 'untrack'].includes(change.operation)) {
    const target = await safeDirectory(cwd, change.directory ?? ''); const attribute = join(target, '.gitattributes');
    const entry = await stat(attribute); if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw fail('PATH', '规则文件不是普通 .gitattributes，不能改写。');
    const relative = [change.directory, '.gitattributes'].filter(Boolean).join('/');
    if (info.index.split('\0').some(record => record.endsWith('\t' + relative) && !/^\d+ [a-f0-9]+ 0\t/u.test(record))) throw fail('CONFLICT', '.gitattributes 仍有冲突，请先解决。', relative);
    if (change.operation === 'untrack' && !state.patterns.some(rule => rule.directory === (change.directory ?? '') && rule.inputPattern === change.pattern && rule.tracked)) throw fail('RULE_MISSING', '所选目录中没有这条 LFS 跟踪规则，请重新读取并选择实际规则。');
    effects.push(relative, '仅更改跟踪规则，不自动暂存、提交或迁移历史。');
  } else if (change.operation === 'install') effects.push('只配置当前仓库的 LFS filters。', change.skipHooks ? '保留现有钩子；推送前需自行确认已调用 git lfs pre-push。' : `安装 LFS pre-push 钩子，已有自定义钩子不会被强制覆盖：${state.hookPath}`);
  else effects.push(change.operation === 'fetch' ? '下载到本地 LFS 缓存，不检出工作区文件。' : change.operation === 'pull' ? '下载并检出当前版本的 LFS 内容；不合并远程 Git 分支。' : '上传当前 HEAD 可达的 LFS 对象，不推送 Git 分支。');
  const files = change.operation === 'pull' ? await worktreeIdentity(cwd, state.files, runtime) : [];
  const after = await readGitLfsState(cwd, runtime);
  if (state.fingerprint !== after.fingerprint) throw fail('CHANGED', '读取期间 Git LFS 状态已变化，请重新预览。');
  return { fingerprint: hash([state.fingerprint, change, files]), change, state, effects };
}
export async function executeGitLfs(cwd: string, value: unknown, expected: string, run: Run, runtime: Runtime = {}) {
  const preview = await previewGitLfs(cwd, value, runtime);
  if (!expected || expected !== preview.fingerprint) throw fail('CHANGED', '仓库、规则、工具或文件已变化，本次未执行，请重新预览。');
  const change = preview.change; let args: string[];
  if (change.operation === 'install') args = ['lfs', 'install', '--local', ...(change.skipHooks ? ['--skip-repo'] : [])];
  else if (change.operation === 'track' || change.operation === 'untrack') args = [...(change.directory ? ['-C', change.directory] : []), 'lfs', change.operation, ...(change.operation === 'track' ? [...(change.literal ? ['--filename'] : []), ...(change.lockable === true ? ['--lockable'] : change.lockable === false ? ['--not-lockable'] : [])] : []), '--', change.pattern!];
  else args = ['lfs', change.operation, ...((change.operation === 'fetch' || change.operation === 'pull') ? [...(change.include === undefined ? [] : [`--include=${change.include}`]), ...(change.exclude === undefined ? [] : [`--exclude=${change.exclude}`])] : []), '--', change.remote!, ...(change.operation === 'pull' ? [] : [preview.state.headSha || 'HEAD'])];
  let started = false;
  try {
    if (change.operation === 'untrack') return await removeTrackingRule(cwd, preview, { ...runtime, onWrite: async path => { started = true; await runtime.onWrite?.(path); } });
    started = true;
    const result = await run(change.operation === 'install' ? args : ['-c', `core.hooksPath=${devNull}`, ...args]);
    if (change.operation === 'install' && preview.state.requiresInitialization) await run(['config', '--local', 'lfs.repositoryformatversion', '0']);
    return result;
  }
  catch (error) {
    if (!started) throw error;
    const cause = error as { message?: string; stderr?: string; stdout?: string };
    throw Object.assign(fail('OUTCOME_UNKNOWN', 'Git LFS 操作未确认完成，配置、缓存、工作区或远端可能已部分更新。请核对实际状态后再操作。', runtime.redact?.([cause.message, cause.stderr, cause.stdout].filter(Boolean).join('\n')) ?? [cause.message, cause.stderr, cause.stdout].filter(Boolean).join('\n')), { cause: error, operationStatus: 'unknown_after_write', operationStage: 'lfs' });
  }
}

/** Native untrack only edits root attributes and cannot remove some --filename
 * glob escapes. Remove the exact reviewed entry while retaining unrelated attrs.
 */
async function removeTrackingRule(cwd: string, preview: GitLfsPreview, runtime: Runtime) {
  const { change } = preview;
  const rule = preview.state.patterns.find(item => item.directory === (change.directory ?? '') && item.inputPattern === change.pattern && item.tracked)!;
  const target = await safeDirectory(cwd, change.directory ?? ''); const path = join(target, '.gitattributes');
  const entry = await stat(path); if (!entry?.isFile() || entry.isSymbolicLink()) throw fail('CHANGED', '属性文件已被替换，请重新读取。');
  const before = await readFile(path); const rawPattern = change.directory ? rule.pattern.slice(change.directory.length + 1) : rule.pattern;
  const tokens = new Set(['filter=lfs', 'diff=lfs', 'merge=lfs', '-text', 'lockable', '-lockable']); let removed = false;
  const text = utf8(before).split(/(?<=\n)/u).map(line => {
    const end = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
    const body = end ? line.slice(0, -end.length) : line; const match = /^([ \t]*)(\S+)[ \t]+(.+)$/u.exec(body);
    if (!match || match[2] !== rawPattern) return line;
    const attributes = match[3]!.split(/[ \t]+/u); if (!attributes.includes('filter=lfs')) return line;
    removed = true; const remaining = attributes.filter(attribute => !tokens.has(attribute));
    return remaining.length ? match[1] + match[2] + ' ' + remaining.join(' ') + end : '';
  }).join('');
  if (!removed) throw fail('RULE_MISSING', '无法对应属性文件中的完整规则，未更改文件。请核对实际规则来源或文件格式。');
  runtime.signal?.throwIfAborted();
  if (!before.equals(await readFile(path))) throw fail('CHANGED', '写入前属性文件已变化，请重新读取。');
  await runtime.onWrite?.(path);
  const temporary = join(target, `.astragit-lfs-${randomUUID()}`); let handle;
  try {
    handle = await open(temporary, 'wx', entry.mode & 0o777); await handle.chmod(entry.mode & 0o777); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = undefined;
    runtime.signal?.throwIfAborted();
    const current = await stat(path);
    if (!current?.isFile() || current.isSymbolicLink() || current.ino !== entry.ino || current.dev !== entry.dev || !before.equals(await readFile(path))) throw fail('CHANGED', '写入前属性文件已被替换或变化，请重新读取。');
    await rename(temporary, path);
  } finally { await handle?.close(); await rm(temporary, { force: true }); }
  return { stdout: `Removed LFS tracking rule: ${rule.pattern}\n`, stderr: '' };
}
