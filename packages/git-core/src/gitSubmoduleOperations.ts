import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { gitRemoteAddressIssue } from '@astragit/shared';
import { GitHistoryReader } from './gitFileHistory.js';

export interface GitSubmoduleChange {
  operation: 'add' | 'remove' | 'deinit' | 'set_url' | 'set_branch' | 'sync' | 'update' | 'absorb';
  path: string;
  url?: string;
  branch?: string | null;
  keepFiles?: boolean;
  recursive?: boolean;
  remote?: boolean;
  strategy?: 'checkout' | 'merge' | 'rebase';
  adoptExisting?: boolean;
  allowLocal?: boolean;
}
export interface GitSubmoduleItem {
  name: string; path: string; url: string; branch: string | null; localUrl: string | null;
  localBranch: string | null; locallyRegistered: boolean; checkedOutBranch: string; initialized: boolean; recordedSha: string; headSha: string;
  changedPaths: string[]; integration: boolean;
}
export interface GitSubmoduleState { fingerprint: string; headSha: string; branch: string; modules: GitSubmoduleItem[] }
export interface GitSubmodulePreview {
  fingerprint: string; change: GitSubmoduleChange; state: GitSubmoduleState;
  module: GitSubmoduleItem | null; existingRepository: boolean; existingHeadSha: string | null; effects: string[];
}
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; redact?: (text: string) => string; hiddenChanges?: (cwd: string, head: string) => Promise<string[]> };
type Run = (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
const failure = (suffix: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_SUBMODULE_${suffix}`, operationStatus: 'failed_before_write', operationStage: 'preflight', statusCode: ['CHANGED', 'BLOCKED', 'DIRTY', 'CONFIG_DIRTY', 'ADOPT_REQUIRED'].includes(suffix) ? 409 : suffix === 'NOT_FOUND' ? 404 : 400, ...(details ? { details } : {}) });
const utf8 = (value: Buffer) => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); } catch { throw failure('INVALID', '子模块配置或路径不是有效 UTF-8，请在外部工具中核对。'); } };
const hasControl = (value: string, includeSpace = false) => [...value].some(character => { const code = character.charCodeAt(0); return code < 32 || code === 127 || includeSpace && code === 32; });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function stat(path: string) { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function safePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.includes('\0') || path.includes('\\') || path.startsWith('-') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw failure('PATH', '请选择当前仓库内的子模块目录，不得包含父级路径、Git 元数据或符号链接。');
}
async function inspectPath(cwd: string, path: string) {
  safePath(path); let current = cwd;
  const parts = path.split('/');
  for (const [position, part] of parts.entries()) {
    current = join(current, part); const entry = await stat(current);
    if (!entry) return null;
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw failure('PATH', '子模块路径被普通文件或符号链接占用，请先核对目录。', path);
    if (position < parts.length - 1 && await stat(join(current, '.git'))) throw failure('PATH', '目标跨越另一个 Git 仓库，请在对应子仓库中操作。', path);
  }
  return stat(current);
}
function configEntries(raw: string) {
  const values = new Map<string, string[]>();
  for (const record of raw.split('\0').filter(Boolean)) {
    const split = record.indexOf('\n'); const key = split < 0 ? record : record.slice(0, split); const value = split < 0 ? '' : record.slice(split + 1);
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return values;
}
const last = (values: Map<string, string[]>, key: string) => values.get(key)?.at(-1) ?? null;
export function parseGitSubmoduleChange(value: unknown): GitSubmoduleChange {
  if (!value || typeof value !== 'object') throw failure('INVALID', '子模块操作选项无效。');
  const input = value as Record<string, unknown>; safePath(input.path);
  if (typeof input.operation !== 'string' || !['add', 'remove', 'deinit', 'set_url', 'set_branch', 'sync', 'update', 'absorb'].includes(input.operation)) throw failure('INVALID', '请选择支持的子模块操作。');
  const output: GitSubmoduleChange = { operation: input.operation as GitSubmoduleChange['operation'], path: input.path };
  for (const key of ['keepFiles', 'recursive', 'remote', 'adoptExisting', 'allowLocal'] as const) {
    if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw failure('INVALID', '子模块开关选项必须为布尔值。'); output[key] = input[key]; }
  }
  if (input.url !== undefined) { if (typeof input.url !== 'string') throw failure('INVALID', '子模块地址无效。'); output.url = input.url; }
  if (input.branch !== undefined) { if (input.branch !== null && typeof input.branch !== 'string') throw failure('INVALID', '子模块跟踪分支无效。'); output.branch = input.branch as string | null; }
  if (input.strategy !== undefined) { if (typeof input.strategy !== 'string' || !['checkout', 'merge', 'rebase'].includes(input.strategy)) throw failure('INVALID', '子模块更新策略无效。'); output.strategy = input.strategy as GitSubmoduleChange['strategy']; }
  return output;
}
async function integration(reader: GitHistoryReader) {
  const directory = (await reader.text(['rev-parse', '--absolute-git-dir'])).replace(/\r?\n$/u, '');
  for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) if (await stat(join(directory, name))) return true;
  return false;
}
async function metadata(cwd: string, runtime: Runtime) {
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const shared = await stat(join(cwd, '.gitmodules'));
  if (shared && (!shared.isFile() || shared.isSymbolicLink() || shared.size > 2 * 1024 * 1024)) throw failure('CONFIG', '.gitmodules 必须是仓库内普通配置文件，且不超过 2 MiB。');
  const sharedBytes = shared ? await readFile(join(cwd, '.gitmodules')) : Buffer.alloc(0);
  const [raw, local, index, headSha, branch, activeIntegration] = await Promise.all([
    shared ? reader.text(['config', '--null', '--file', '.gitmodules', '--list']) : '',
    reader.text(['config', '--null', '--local', '--list']), reader.run(['ls-files', '--stage', '-z']), reader.revision(),
    reader.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, undefined, undefined, [0, 1]).then(utf8), integration(reader),
  ]);
  if (shared) {
    const keys = utf8(await reader.run(['config', '--null', '--file', '.gitmodules', '--name-only', '--list'])).split('\0').filter(Boolean);
    if (keys.some(key => hasControl(key))) throw failure('CONFIG', '共享子模块配置的名称含控制字符，无法完整核对。');
  }
  const entries = configEntries(raw); const localEntries = configEntries(local);
  const gitlinks = new Map<string, string>();
  for (const record of utf8(index).split('\0').filter(Boolean)) {
    const split = record.indexOf('\t'); if (split < 0) throw failure('CONFIG', '暂存区子模块记录无效。');
    const fields = record.slice(0, split).split(' ');
    if (fields[0] === '160000' && fields[2] === '0') gitlinks.set(record.slice(split + 1), fields[1]!);
  }
  const modules: GitSubmoduleItem[] = []; const paths = new Set<string>(); const rawChildren: unknown[] = [];
  for (const [key, values] of entries) {
    const match = /^submodule\.(.+)\.path$/u.exec(key); if (!match) continue;
    const name = match[1]!; const path = values[0]!;
    if (values.length !== 1 || hasControl(name) || paths.has(path)) throw failure('CONFIG', '子模块名称或路径重复、包含控制字符，无法确定操作对象。');
    paths.add(path); safePath(path); await inspectPath(cwd, path);
    const marker = await stat(join(cwd, path, '.git'));
    if (marker?.isSymbolicLink()) throw failure('PATH', '子模块 .git 指向符号链接，请在外部工具中核对。', path);
    const initialized = Boolean(marker); let childHead = ''; let status = ''; let childIntegration = false; let childRefs = ''; let childConfig = ''; let childIndex = ''; let childBranch = '';
    if (initialized) {
      const child = new GitHistoryReader(join(cwd, path), runtime); await child.initialize();
      [childHead, status, childIntegration, childRefs, childConfig, childIndex, childBranch] = await Promise.all([
        child.revision(), child.text(['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all', '--ignore-submodules=none']), integration(child),
        child.run(['show-ref', '--head'], undefined, undefined, undefined, [0, 1]).then(utf8), child.text(['config', '--null', '--local', '--list']), child.text(['ls-files', '--stage', '-z']).then(async stage => stage + await child.text(['ls-files', '-v', '-z'])), child.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, undefined, undefined, [0, 1]).then(utf8),
      ]);
    }
    const rawUrl = last(entries, `submodule.${name}.url`) ?? ''; const rawLocal = last(localEntries, `submodule.${name}.url`);
    modules.push({ name, path, url: runtime.redact?.(rawUrl) ?? rawUrl, branch: last(entries, `submodule.${name}.branch`), localUrl: rawLocal === null ? null : runtime.redact?.(rawLocal) ?? rawLocal, localBranch: last(localEntries, `submodule.${name}.branch`), locallyRegistered: [...localEntries.keys()].some(key => key.startsWith(`submodule.${name}.`)), checkedOutBranch: childBranch.replace(/\r?\n$/u, ''), initialized, recordedSha: gitlinks.get(path) ?? '', headSha: childHead, changedPaths: status.split('\0').filter(Boolean), integration: childIntegration });
    rawChildren.push([path, childRefs, childConfig, childIndex, childBranch]);
    if (modules.length > 1000) throw failure('CONFIG', '子模块超过管理窗口的一千项上限，请缩小仓库范围。');
  }
  const state = { headSha, branch: branch.replace(/\r?\n$/u, ''), modules, fingerprint: digest([headSha, branch, sharedBytes.toString('base64'), local, index.toString('base64'), modules, rawChildren, activeIntegration]) };
  return { state, reader, entries, localEntries, sharedBytes, activeIntegration };
}
async function treeFingerprint(cwd: string, path: string, runtime: Runtime, protectContents: boolean) {
  const hash = createHash('sha256');
  const visit = async (relative: string): Promise<void> => {
    runtime.signal?.throwIfAborted(); const absolute = join(cwd, relative); const entry = await stat(absolute);
    hash.update(JSON.stringify([relative, entry?.mode ?? 'missing'])); if (!entry) return;
    if (entry.isSymbolicLink()) hash.update(await readlink(absolute));
    else if (entry.isFile()) { for await (const chunk of createReadStream(absolute, { signal: runtime.signal })) hash.update(chunk as Buffer); }
    else if (entry.isDirectory()) {
      if (relative !== path && await stat(join(absolute, '.git'))) {
        const child = new GitHistoryReader(absolute, runtime); await child.initialize();
        const head = await child.revision(); const nestedState = await metadata(absolute, runtime); hash.update(nestedState.state.fingerprint);
        if (protectContents) {
          const status = await child.text(['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all', '--ignore-submodules=none']);
          const hidden = head && runtime.hiddenChanges ? await runtime.hiddenChanges(absolute, head) : [];
          if (status || hidden.length || nestedState.activeIntegration) throw failure('DIRTY', '嵌套子仓库有本地内容或未结束的整合，请先保存，或选择保留目录。', relative);
        }
      }
      for (const name of (await readdir(absolute)).sort()) {
      if (name.toLowerCase() === '.git') continue;
      await visit(`${relative}/${name}`);
      }
    }
    else throw failure('PATH', '子模块目录中存在不支持的特殊文件。', relative);
  };
  await visit(path); return hash.digest('hex');
}
export async function readGitSubmodules(cwd: string, runtime: Runtime = {}): Promise<GitSubmoduleState> { return (await metadata(cwd, runtime)).state; }
export async function previewGitSubmodule(cwd: string, input: unknown, runtime: Runtime = {}): Promise<GitSubmodulePreview> {
  const change = parseGitSubmoduleChange(input); const meta = await metadata(cwd, runtime);
  const { state, reader } = meta; const module = state.modules.find(item => item.path === change.path) ?? null;
  if (meta.activeIntegration && ['add', 'remove'].includes(change.operation)) throw failure('BLOCKED', '父仓库有未结束的整合，请先继续或终止，再管理子模块。');
  const location = await inspectPath(cwd, change.path);
  const effects: string[] = []; let existingRepository = false; let existingHeadSha: string | null = null; let existingState = '';
  if (change.operation === 'add') {
    if (!state.headSha) throw failure('BLOCKED', '请先在父仓库创建首个提交，再添加子模块。');
    if (state.modules.some(item => item.path === change.path || change.path.startsWith(`${item.path}/`) || item.path.startsWith(`${change.path}/`))) throw failure('PATH', '目标与已登记子模块重叠，请在对应子仓库中操作。', change.path);
    if ((await reader.run(['ls-files', '-z', '--', change.path])).length) throw failure('PATH', '目标路径已被暂存区跟踪，请先核对现有文件。', change.path);
    const marker = location && await stat(join(cwd, change.path, '.git'));
    if (marker) {
      if (marker.isSymbolicLink()) throw failure('PATH', '现有仓库 .git 不能是符号链接。');
      const child = new GitHistoryReader(join(cwd, change.path), runtime); await child.initialize();
      existingHeadSha = await child.revision();
      existingState = (await metadata(join(cwd, change.path), runtime)).state.fingerprint;
      if (await integration(child)) throw failure('BLOCKED', '现有子仓库有未结束的整合，请先完成再登记。');
      if (!existingHeadSha) throw failure('BLOCKED', '现有子仓库没有提交，不能登记子模块引用。');
      existingRepository = true;
      if (!change.adoptExisting) throw failure('ADOPT_REQUIRED', '目标已是 Git 仓库。请明确选择登记现有仓库后重新预览，不会重新克隆覆盖。', change.path);
      effects.push('adopt_existing');
    } else if (location && (await readdir(join(cwd, change.path))).length) throw failure('PATH', '目标目录非空且不是可登记的 Git 仓库。', change.path);
    effects.push('stage_gitlink_and_gitmodules');
  } else {
    if (!module?.recordedSha) throw failure('NOT_FOUND', '该路径没有唯一有效的已登记子模块与暂存区引用，请刷新并检查 .gitmodules。', change.path);
    if (module.integration && ['update', 'remove', 'deinit', 'absorb'].includes(change.operation)) throw failure('BLOCKED', '子仓库有未结束的整合，请打开该子仓库先处理。', change.path);
    if ((change.operation === 'deinit' || change.operation === 'remove' && !change.keepFiles) && module.changedPaths.length) throw failure('DIRTY', '子仓库包含修改、未跟踪或忽略文件，移除工作区会影响这些内容。请先保存或选择保留目录。', module.changedPaths.join('\n'));
    if (change.operation === 'remove') effects.push(change.keepFiles ? 'keep_worktree_remove_registration' : 'remove_worktree_keep_object_database', 'stage_gitlink_and_gitmodules');
    if (change.operation === 'deinit') effects.push('remove_worktree_keep_registration_and_objects');
    if (change.operation === 'set_url') effects.push('edit_gitmodules_and_sync_local_url');
    if (change.operation === 'set_branch') effects.push('edit_gitmodules_branch');
    if (change.operation === 'absorb') effects.push('move_git_metadata_keep_worktree');
    if (change.operation === 'sync') effects.push('sync_url_without_network');
    if (change.operation === 'update') effects.push(change.remote ? 'fetch_remote_branch' : 'checkout_recorded_commit', change.strategy ?? 'checkout');
  }
  if (change.operation === 'add' || change.operation === 'set_url') {
    const url = change.url ?? '';
    const relative = /^(?:\.\.?\/)/u.test(url) && !hasControl(url) && url.trim() === url;
    if (!relative && gitRemoteAddressIssue(url)) throw failure('URL', '请输入有效且不含密码或令牌的 Git 地址；支持相对远程地址。');
  }
  if (change.operation === 'set_branch' && change.branch === undefined) throw failure('INVALID', '请选择跟踪分支或恢复默认分支。');
  if (change.branch !== undefined && change.branch !== null) {
    if (!change.branch || hasControl(change.branch, true) || change.branch.startsWith('-') || change.operation === 'add' && change.branch === '.') throw failure('INVALID', '子模块跟踪分支名称无效。');
    if (change.branch !== '.') { try { await reader.run(['check-ref-format', '--branch', change.branch]); } catch { throw failure('INVALID', '子模块跟踪分支名称无效。'); } }
  }
  if (module && (change.operation === 'deinit' || change.operation === 'remove' && !change.keepFiles)) {
    if (!module.initialized && location && (await readdir(join(cwd, change.path))).length) throw failure('DIRTY', '未初始化的子模块目录包含本地文件，请先保存或选择保留目录。', change.path);
    const hidden = module.headSha && runtime.hiddenChanges ? await runtime.hiddenChanges(join(cwd, change.path), module.headSha) : [];
    if (hidden.length) throw failure('DIRTY', '子仓库有被索引标记隐藏的本地修改，请先保存或选择保留目录。', hidden.join('\n'));
  }
  if (['add', 'remove'].includes(change.operation)) {
    const index = await reader.run(['show', ':.gitmodules'], undefined, undefined, 2 * 1024 * 1024, [0, 128]);
    if (!index.equals(meta.sharedBytes)) throw failure('CONFIG_DIRTY', '.gitmodules 含未暂存修改，自动暂存会混入其他配置。请先单独处理该文件，再重试。', '.gitmodules');
  }
  if (change.operation === 'deinit' && (await stat(join(cwd, change.path, '.git')))?.isDirectory()) throw failure('BLOCKED', '子模块使用内嵌 .git 目录，请先执行“整理 Git 元数据”再停用。', change.path);
  if (change.operation === 'remove') {
    try { await reader.run(['rm', '--dry-run', ...(change.keepFiles ? ['--cached'] : []), '--', change.path]); }
    catch (error) { throw failure('BLOCKED', 'Git 拒绝移除当前子模块，请先核对暂存的引用和本地修改；尚未执行移除。', runtime.redact?.((error as { details?: string }).details ?? String(error))); }
  }
  const content = await treeFingerprint(cwd, change.path, runtime, change.operation === 'deinit' || change.operation === 'remove' && !change.keepFiles);
  // Re-read metadata after filesystem inspection; never confirm a mixed snapshot.
  const after = await metadata(cwd, runtime);
  if (after.state.fingerprint !== state.fingerprint) throw failure('CHANGED', '子模块或父仓库状态在读取期间发生变化，请重新预览。');
  return { state, change, module, existingRepository, existingHeadSha, effects, fingerprint: digest([state.fingerprint, change, content, existingState]) };
}
export async function executeGitSubmodule(cwd: string, change: GitSubmoduleChange, expectedFingerprint: string, runtime: Runtime, run: Run) {
  const preview = await previewGitSubmodule(cwd, change, runtime);
  if (!expectedFingerprint || preview.fingerprint !== expectedFingerprint) throw failure('CHANGED', '父仓库、子模块内容、配置或选项已变化，本次未开始操作，请重新预览。');
  const { module } = preview; const path = change.path; const commands: string[][] = [];
  switch (change.operation) {
    case 'add': commands.push(['submodule', 'add', ...(hasControl(path) ? ['--name', `astragit-${digest(path).slice(0, 16)}`] : []), ...(change.branch ? ['-b', change.branch] : []), '--', change.url!, path]); break;
    case 'remove':
      commands.push(['rm', ...(change.keepFiles ? ['--cached'] : []), '--', path]);
      if (change.keepFiles) commands.push(['config', '--file', '.gitmodules', '--remove-section', `submodule.${module!.name}`], ['add', '--', '.gitmodules']);
      if (module!.locallyRegistered) commands.push(['config', '--local', '--remove-section', `submodule.${module!.name}`]);
      break;
    case 'absorb': commands.push(['submodule', 'absorbgitdirs', '--', path]); break;
    case 'deinit': commands.push(['submodule', 'deinit', '--', path]); break;
    case 'set_url': commands.push(['submodule', 'set-url', '--', path, change.url!]); break;
    case 'set_branch': commands.push(['submodule', 'set-branch', ...(change.branch === null ? ['--default'] : ['--branch', change.branch!]), '--', path]); break;
    case 'sync': commands.push(['submodule', 'sync', ...(change.recursive ? ['--recursive'] : []), '--', path]); break;
    case 'update': commands.push(['submodule', 'update', '--init', `--${change.strategy ?? 'checkout'}`, ...(change.recursive ? ['--recursive'] : []), ...(change.remote ? ['--remote'] : []), '--', path]); break;
  }
  let stdout = ''; let stderr = ''; let completedCommands = 0;
  try {
    for (const args of commands) { const result = await run(['--literal-pathspecs', ...args]); stdout += result.stdout; stderr += result.stderr; completedCommands += 1; }
    return { stdout, stderr };
  } catch (error) {
    const detail = error as { message?: string; details?: string; stderr?: string };
    throw Object.assign(new Error('子模块操作未完整完成，仓库可能已有部分变化。请刷新父仓库与子仓库，查看 Git 详情后再决定下一步。'), { code: 'ASTRAGIT_GIT_SUBMODULE_OUTCOME_UNKNOWN', operationStatus: 'unknown_after_write', operationStage: 'write', details: runtime.redact?.(JSON.stringify({ operation: change.operation, path, completedCommands, reason: detail.details ?? detail.stderr ?? detail.message })) ?? detail.message, cause: error });
  }
}
