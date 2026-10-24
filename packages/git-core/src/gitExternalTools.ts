import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { hasUnresolvedGitConflictMarkers } from '@astragit/shared';
import { GitHistoryReader } from './gitFileHistory.js';
import { gitCommandConfig } from './gitRemoteEndpoint.js';

export type GitExternalToolKind = 'diff' | 'merge';
export interface GitExternalToolSettings {
  fingerprint: string;
  selected: { diff: string | null; merge: string | null };
  entries: Array<{ key: string; value: string | null; local: string | null; global: string | null }>;
  tools: Array<{ name: string; kind: GitExternalToolKind; available: boolean; configured: boolean; description: string }>;
}
export interface GitExternalToolConfiguration {
  scope: 'local' | 'global'; kind: GitExternalToolKind; toolName: string;
  command: string | null; executable: string | null; keepBackup?: boolean | null; inheritSelection?: boolean;
}
export interface GitExternalToolInput {
  mode: GitExternalToolKind; paths: string[]; toolName?: string;
  stage?: 'combined' | 'staged' | 'unstaged'; commitHash?: string; comparisonRef?: string;
  comparisonMode?: 'current' | 'working-tree'; revisions?: [string, string]; markResolved?: boolean;
}
export interface GitExternalToolPreview {
  fingerprint: string; input: GitExternalToolInput; toolName: string; command: string | null;
  headSha: string; branch: string; files: Array<{ path: string; beforeBytes: number; afterBytes: number; beforeLabel: string; afterLabel: string }>;
}
export interface GitExternalSource { name: string; label: string; root?: string; path?: string; blob?: string; inline?: string; missing?: boolean; reason?: string; mode?: string }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; redact?: (text: string) => string; sources: (path: string, input: GitExternalToolInput, stashUntracked?: boolean) => Promise<GitExternalSource[]> };
type Run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
const maximumFile = 32 * 1024 * 1024; const maximumTotal = 128 * 1024 * 1024;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (suffix: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_EXTERNAL_TOOL_${suffix}`, operationStatus: 'failed_before_write', operationStage: 'preflight', ...(details ? { details } : {}) });
const toolNameValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value);
function pathValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.includes('\0') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw fail('PATH', '请选择仓库内文件，不得使用父级路径、Git 元数据或链接目录。');
}
async function info(path: string) { try { return await lstat(path); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null; throw error; } }
async function parents(cwd: string, path: string) {
  let current = cwd;
  for (const part of path.split('/').slice(0, -1)) { current = join(current, part); const entry = await info(current); if (!entry) return; if (!entry.isDirectory() || entry.isSymbolicLink()) throw fail('PATH', '文件位于链接或非目录路径中，请在外部工具中手动核对。', path); }
}
async function workingFile(cwd: string, path: string, signal?: AbortSignal) {
  pathValue(path); signal?.throwIfAborted(); await parents(cwd, path); const absolute = join(cwd, path); const entry = await info(absolute);
  if (!entry) return { bytes: Buffer.alloc(0), mode: 'missing', exists: false };
  if (entry.isSymbolicLink()) return { bytes: Buffer.from(await readlink(absolute)), mode: '120000', exists: true };
  if (!entry.isFile()) throw fail('PATH', '所选路径不是可比较的文件。子模块引用请在父仓库差异中查看。', path);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat(); if (opened.size > maximumFile) throw fail('TOO_LARGE', '单个版本超过 32 MiB，请使用工具自身的文件打开功能。', path);
    const bytes = await handle.readFile(); signal?.throwIfAborted(); await parents(cwd, path); const after = await info(absolute);
    if (!after?.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || after.mtimeMs !== opened.mtimeMs || after.size !== opened.size || bytes.length > maximumFile) throw fail('CHANGED', '文件在读取期间发生变化，请重新预览。', path);
    return { bytes, mode: opened.mode & 0o111 ? '100755' : '100644', exists: true };
  } finally { await handle.close(); }
}
const configPattern = '^(diff|merge)\\.(tool|guitool)$|^(difftool|mergetool)\\..+\\.(cmd|path|trustexitcode)$|^mergetool\\.keepbackup$';
function config(raw: string) {
  const result = new Map<string, string>();
  for (const row of raw.split('\0').filter(Boolean)) { const split = row.indexOf('\n'); result.set(split < 0 ? row : row.slice(0, split), split < 0 ? '' : row.slice(split + 1)); }
  return result;
}
async function settings(cwd: string, runtime: Pick<Runtime, 'signal' | 'env' | 'redact'>, withHelp = true) {
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const read = (args: string[]) => reader.run(['config', ...args, '--null', '--get-regexp', configPattern], undefined, undefined, undefined, [0, 1]).then(value => value.toString('utf8'));
  const [localRaw, globalRaw, allRaw] = await Promise.all([read(['--local', '--no-includes']), read(['--global', '--no-includes']), read(['--includes'])]);
  const local = config(localRaw); const global = config(globalRaw); const all = config(allRaw); const tools: GitExternalToolSettings['tools'] = [];
  if (withHelp) for (const kind of ['diff', 'merge'] as const) {
    const help = await reader.text([kind === 'diff' ? 'difftool' : 'mergetool', '--tool-help']); let available = true; let customSection = false;
    for (const row of help.split('\n')) {
      if (row.trim() === 'user-defined:') { customSection = true; continue; }
      if (row.includes('not currently available:')) { available = false; customSection = false; }
      if (customSection) continue;
      const match = /^\t\t([A-Za-z0-9][A-Za-z0-9._-]*)\s+(.*)$/u.exec(row); if (!match || match[1]!.endsWith('.cmd')) continue;
      tools.push({ name: match[1]!, kind, available, configured: false, description: runtime.redact?.(match[2]!) ?? match[2]! });
    }
    for (const key of all.keys()) {
      const match = new RegExp(`^${kind}tool\\.(.+)\\.cmd$`, 'u').exec(key);
      if (!match || !toolNameValid(match[1])) continue;
      const found = tools.find(item => item.kind === kind && item.name === match[1]);
      if (found) { found.configured = true; found.available = true; }
      else tools.push({ name: match[1], kind, available: true, configured: true, description: '' });
    }
  }
  const keys = new Set([...local.keys(), ...global.keys(), ...all.keys()]);
  const redact = (value: string | undefined) => value === undefined ? null : runtime.redact?.(value) ?? value;
  const output: GitExternalToolSettings = {
    fingerprint: hash([localRaw, globalRaw, allRaw]), selected: { diff: all.get('diff.tool') ?? null, merge: all.get('merge.tool') ?? null }, tools,
    entries: [...keys].sort().map(key => ({ key, value: redact(all.get(key)), local: redact(local.get(key)), global: redact(global.get(key)) })),
  };
  return { output, all, local, global, reader };
}
export async function readGitExternalToolSettings(cwd: string, runtime: Pick<Runtime, 'signal' | 'env' | 'redact'> = {}) { return (await settings(cwd, runtime)).output; }
export function parseGitExternalToolConfiguration(value: unknown): GitExternalToolConfiguration {
  if (!value || typeof value !== 'object') throw fail('INVALID', '外部工具设置无效。');
  const input = value as Record<string, unknown>;
  if ((input.scope !== 'local' && input.scope !== 'global') || (input.kind !== 'diff' && input.kind !== 'merge') || !toolNameValid(input.toolName)) throw fail('INVALID', '工具名称或配置范围无效。');
  for (const field of ['command', 'executable'] as const) if (input[field] !== null && (typeof input[field] !== 'string' || input[field].includes('\0') || input[field].length > 16_384)) throw fail('INVALID', '工具命令或路径无效。');
  if (input.keepBackup !== undefined && input.keepBackup !== null && typeof input.keepBackup !== 'boolean') throw fail('INVALID', '备份设置无效。');
  if (input.inheritSelection !== undefined && typeof input.inheritSelection !== 'boolean') throw fail('INVALID', '继承配置选项无效。');
  return { ...(input.inheritSelection !== undefined ? { inheritSelection: input.inheritSelection as boolean } : {}), scope: input.scope, kind: input.kind, toolName: input.toolName, command: input.command as string | null, executable: input.executable as string | null, ...(input.keepBackup !== undefined ? { keepBackup: input.keepBackup as boolean | null } : {}) };
}
export async function configureGitExternalTool(cwd: string, input: GitExternalToolConfiguration, expected: string, runtime: Runtime, run: Run) {
  const value = parseGitExternalToolConfiguration(input); const current = await settings(cwd, runtime, false);
  if (!expected || expected !== current.output.fingerprint) throw fail('CHANGED', '工具配置已变化，请重新载入设置后核对。');
  const namespace = `${value.kind}tool.${value.toolName}`; const owned = value.scope === 'local' ? current.local : current.global;
  const changes: Array<[string, string | null]> = value.inheritSelection ? [[`${value.kind}.tool`, null]] : [[`${value.kind}.tool`, value.toolName], [`${namespace}.cmd`, value.command], [`${namespace}.path`, value.executable]];
  if (!value.inheritSelection && value.kind === 'merge' && value.keepBackup !== undefined) changes.push(['mergetool.keepbackup', value.keepBackup === null ? null : String(value.keepBackup)]);
  let completed = 0; let stdout = ''; let stderr = '';
  try {
    for (const [key, next] of changes) {
      if (next === null && !owned.has(key) || next !== null && owned.get(key) === next) continue;
      const result = await run(['config', `--${value.scope}`, ...(next === null ? ['--unset-all', '--', key] : ['--replace-all', '--', key, next])]); completed += 1; stdout += result.stdout; stderr += result.stderr;
    }
    return { stdout, stderr };
  } catch (error) { throw outcome(error, runtime, { completedConfigurationWrites: completed }); }
}
export function parseGitExternalToolInput(value: unknown): GitExternalToolInput {
  if (!value || typeof value !== 'object') throw fail('INVALID', '外部工具参数无效。'); const input = value as Record<string, unknown>;
  if (input.mode !== 'diff' && input.mode !== 'merge' || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > 200) throw fail('INVALID', '请选择一至两百个文件。');
  input.paths.forEach(pathValue); const paths = [...new Set(input.paths as string[])];
  if (input.toolName !== undefined && !toolNameValid(input.toolName)) throw fail('INVALID', '外部工具名称无效。');
  if (input.stage !== undefined && (typeof input.stage !== 'string' || !['combined', 'staged', 'unstaged'].includes(input.stage)) || input.comparisonMode !== undefined && input.comparisonMode !== 'current' && input.comparisonMode !== 'working-tree' || input.markResolved !== undefined && typeof input.markResolved !== 'boolean') throw fail('INVALID', '比较范围或解决选项无效。');
  for (const key of ['commitHash', 'comparisonRef'] as const) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] || input[key].length > 4096 || input[key].includes('\0'))) throw fail('INVALID', '所选版本无效。');
  if (input.revisions !== undefined && (!Array.isArray(input.revisions) || input.revisions.length !== 2 || input.revisions.some(item => typeof item !== 'string' || !item || item.length > 4096 || item.includes('\0')))) throw fail('INVALID', '请选择两个有效版本。');
  if ([input.commitHash, input.comparisonRef, input.revisions].filter(value => value !== undefined).length > 1 || input.mode === 'merge' && [input.commitHash, input.comparisonRef, input.revisions, input.stage].some(value => value !== undefined)) throw fail('INVALID', '不能同时使用多个版本范围，合并工具只处理当前冲突。');
  return { mode: input.mode, paths, ...(input.toolName !== undefined ? { toolName: input.toolName as string } : {}), ...(input.stage !== undefined ? { stage: input.stage as GitExternalToolInput['stage'] } : {}), ...(input.commitHash !== undefined ? { commitHash: input.commitHash as string } : {}), ...(input.comparisonRef !== undefined ? { comparisonRef: input.comparisonRef as string } : {}), ...(input.comparisonMode !== undefined ? { comparisonMode: input.comparisonMode as GitExternalToolInput['comparisonMode'] } : {}), ...(input.revisions ? { revisions: input.revisions as [string, string] } : {}), ...(input.markResolved !== undefined ? { markResolved: input.markResolved as boolean } : {}) };
}
async function identity(reader: GitHistoryReader) {
  const [head, branch, index, flags, directory, indexPath] = await Promise.all([
    reader.revision(), reader.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, undefined, undefined, [0, 1]), reader.run(['ls-files', '--stage', '-z']), reader.run(['ls-files', '-v', '-z']), reader.text(['rev-parse', '--absolute-git-dir']), reader.text(['rev-parse', '--path-format=absolute', '--git-path', 'index']),
  ]);
  const markers: unknown[] = []; const root = directory.replace(/\r?\n$/u, '');
  for (const path of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge/git-rebase-todo', 'rebase-merge/done', 'rebase-apply/next', 'rebase-apply/original-commit', 'sequencer/todo']) {
    const entry = await info(join(root, path)); if (entry?.isFile() && entry.size <= 8 * 1024 * 1024) markers.push([path, (await readFile(join(root, path))).toString('base64')]); else markers.push([path, entry ? 'present' : 'missing']);
  }
  return { headSha: head, branch: branch.toString('utf8').replace(/\r?\n$/u, ''), indexPath: indexPath.replace(/\r?\n$/u, ''), fingerprint: hash([root, head, branch.toString('base64'), index.toString('base64'), flags.toString('base64'), markers]) };
}
async function prepare(cwd: string, value: unknown, runtime: Runtime) {
  const input = parseGitExternalToolInput(value); const current = await settings(cwd, runtime); const { reader } = current; const initial = await identity(reader);
  const toolName = input.toolName ?? current.output.selected[input.mode];
  if (!toolNameValid(toolName)) throw fail('REQUIRED', '请先在外部工具设置中选择工具。');
  const tool = current.output.tools.find(item => item.kind === input.mode && item.name === toolName);
  if (!tool?.available) throw fail('UNAVAILABLE', '所选外部工具不可用，请先安装工具或检查可执行路径与自定义命令。', toolName);
  const fixed = { ...input };
  if (input.commitHash) fixed.commitHash = await reader.revision(input.commitHash);
  if (input.comparisonRef) fixed.comparisonRef = await reader.revision(input.comparisonRef);
  if (input.revisions) fixed.revisions = [await reader.revision(input.revisions[0]), await reader.revision(input.revisions[1])];
  const files: GitExternalToolPreview['files'] = []; const copies: Array<{ path: string; before: Buffer; after: Buffer }> = []; const signatures: unknown[] = []; let total = 0;
  const conflicts = (await reader.text(['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean);
  for (const path of input.paths) {
    pathValue(path); await parents(cwd, path); runtime.signal?.throwIfAborted();
    if (input.mode === 'merge') {
      if (!conflicts.includes(path)) throw fail('CHANGED', '所选文件已不处于冲突状态，请刷新后重新选择。', path);
      const stages = await reader.text(['ls-files', '--unmerged', '-z', '--', path]);
      if (stages.split('\0').some(record => record.startsWith('160000 '))) throw fail('UNSUPPORTED', '子模块引用冲突请在对应子仓库选择提交，不能交给文件合并工具。', path);
      const work = await workingFile(cwd, path, runtime.signal); let stageBytes = 0;
      for (const record of stages.split('\0').filter(Boolean)) {
        const oid = record.slice(0, record.indexOf('\t')).split(' ')[1];
        if (!oid || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(oid)) throw fail('READ', '无法完整读取冲突索引版本。', path);
        const size = Number((await reader.text(['cat-file', '-s', oid])).trim());
        if (!Number.isSafeInteger(size) || size < 0) throw fail('READ', '无法读取冲突版本大小。', path); stageBytes += size;
      }
      signatures.push([path, stages, work.mode, bytesHash(work.bytes)]); files.push({ path, beforeBytes: stageBytes, afterBytes: work.bytes.length, beforeLabel: 'Git index stages 1/2/3', afterLabel: 'Working tree' });
      continue;
    }
    if (!input.commitHash && !input.comparisonRef && !input.revisions) {
      const known = (await reader.text(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', path])).split('\0');
      const inHead = initial.headSha ? (await reader.text(['ls-tree', '-r', '--name-only', '-z', initial.headSha, '--', path])).split('\0').includes(path) : false;
      if (!known.includes(path) && !inHead) throw fail('PATH', '文件不在当前 Git 文件范围中，请刷新后重新选择。', path);
    }
    const sources = await runtime.sources(path, fixed, Boolean(input.commitHash && /^stash@\{\d+\}$/u.test(input.commitHash))); if (sources.length !== 2) throw fail('READ', '未能读取完整的差异两端。', path);
    const read = async (source: GitExternalSource) => {
      pathValue(source.name);
      if (source.missing) return { bytes: Buffer.alloc(0), mode: 'missing' };
      if (source.inline !== undefined) return { bytes: Buffer.from(source.inline), mode: source.mode ?? '160000' };
      if (source.blob) { const bytes = await reader.run(['cat-file', 'blob', source.blob], undefined, undefined, maximumFile); return { bytes, mode: source.mode ?? '100644' }; }
      if (source.path) {
        const entry = await info(join(cwd, source.name));
        if (entry?.isDirectory()) {
          const indexed = (await reader.text(['ls-files', '--stage', '-z', '--', source.name])).split('\0').find(record => record.slice(record.indexOf('\t') + 1) === source.name && record.startsWith('160000 ') && record.split('\t')[0]?.endsWith(' 0'));
          if (!indexed) throw fail('PATH', '此目录不是当前版本的子模块引用。', source.name);
          let sha = indexed.split(' ')[1]!; let dirty = false;
          if (await info(join(cwd, source.name, '.git'))) { const child = new GitHistoryReader(join(cwd, source.name), runtime); await child.initialize(); sha = await child.revision(); dirty = Boolean(await child.text(['status', '--porcelain=v1', '-z', '--ignore-submodules=none'])); }
          return { bytes: Buffer.from(`Subproject commit ${sha}${dirty ? '-dirty' : ''}\n`), mode: '160000' };
        }
        return workingFile(cwd, source.name, runtime.signal);
      }
      throw fail('UNSUPPORTED', source.reason ?? '此版本不能交给文件差异工具。', path);
    };
    const [before, after] = await Promise.all(sources.map(read)); total += before.bytes.length + after.bytes.length;
    if (total > maximumTotal) throw fail('TOO_LARGE', '所选版本合计超过 128 MiB，请分批比较。');
    if (before.mode === 'missing' && after.mode === 'missing') throw fail('PATH', '所选范围中不存在该文件，请重新选择。', path);
    copies.push({ path, before: before.bytes, after: after.bytes }); signatures.push([path, sources.map(source => [source.name, source.label, source.blob, source.inline, source.missing, source.mode]), before.mode, after.mode, bytesHash(before.bytes), bytesHash(after.bytes)]);
    files.push({ path, beforeBytes: before.bytes.length, afterBytes: after.bytes.length, beforeLabel: sourceLabel(sources[0]!.label), afterLabel: sourceLabel(sources[1]!.label) });
  }
  if ((await identity(reader)).fingerprint !== initial.fingerprint || (await settings(cwd, runtime, false)).output.fingerprint !== current.output.fingerprint) throw fail('CHANGED', '仓库或工具配置在读取期间发生变化，请重新预览。');
  const preview: GitExternalToolPreview = { fingerprint: hash([initial.fingerprint, input, fixed, toolName, current.output.fingerprint, signatures]), input, toolName, command: runtime.redact?.(current.all.get(`${input.mode}tool.${toolName}.cmd`) ?? '') || null, headSha: initial.headSha, branch: initial.branch, files };
  return { preview, copies, initial, reader, settings: current.output };
}
function sourceLabel(value: string) { return value.replace('变更前', 'Before').replace('变更后', 'After').replace('工作区', 'Working tree').replace('暂存区', 'Index').replace('不存在', 'Missing'); }
export async function previewGitExternalTool(cwd: string, input: GitExternalToolInput, runtime: Runtime) { return (await prepare(cwd, input, runtime)).preview; }
function outcome(error: unknown, runtime: Pick<Runtime, 'redact'>, details: unknown) {
  const value = error as { message?: string; details?: string; stderr?: string };
  return Object.assign(new Error('外部工具未完整完成，部分文件或配置可能已改变。请关闭仍在运行的外部窗口并刷新核对，不要直接重复操作。'), { code: 'ASTRAGIT_GIT_EXTERNAL_TOOL_OUTCOME_UNKNOWN', operationStatus: 'unknown_after_write', operationStage: 'external_tool', details: runtime.redact?.(JSON.stringify({ ...details as object, reason: value.message, diagnostic: value.details ?? value.stderr })) ?? value.message, cause: error });
}
export async function executeGitExternalTool(cwd: string, input: GitExternalToolInput, expected: string, runtime: Runtime, run: Run) {
  const plan = await prepare(cwd, input, runtime); if (!expected || expected !== plan.preview.fingerprint) throw fail('CHANGED', '所选文件、版本或工具配置已变化，本次未启动工具，请重新预览。');
  const directory = await mkdtemp(join(tmpdir(), 'astragit-external-tool-')); let started = false; let completed = 0;
  try {
    if (input.mode === 'diff') {
      for (const file of plan.copies) {
        const before = join(directory, 'before', file.path); const after = join(directory, 'after', file.path);
        await mkdir(dirname(before), { recursive: true }); await mkdir(dirname(after), { recursive: true }); await writeFile(before, file.before, { mode: 0o600 }); await writeFile(after, file.after, { mode: 0o600 });
        started = true;
        try { await run(['difftool', '--no-prompt', '--no-gui', '--trust-exit-code', `--tool=${plan.preview.toolName}`, '--no-index', '--', before, after]); }
        catch (error) { if ((error as { exitCode?: number }).exitCode !== 1) throw error; }
        completed += 1;
      }
      return { stdout: '', stderr: '' };
    }
    const temporaryIndex = join(directory, 'index'); await copyFile(plan.initial.indexPath, temporaryIndex);
    const env = gitCommandConfig({ ...process.env, ...runtime.env, GIT_INDEX_FILE: temporaryIndex }, [[`mergetool.${plan.preview.toolName}.trustExitCode`, 'true']]);
    started = true;
    const result = await run(['--literal-pathspecs', 'mergetool', '--no-prompt', '--no-gui', `--tool=${plan.preview.toolName}`, '--', ...input.paths], undefined, env);
    completed = input.paths.length;
    if (!input.markResolved) return result;
    if ((await run(['--literal-pathspecs', 'ls-files', '--unmerged', '-z', '--', ...input.paths], undefined, env)).stdout) throw fail('UNRESOLVED', '外部工具没有完成所选文件的合并，请回到冲突视图核对。');
    const lockPath = `${plan.initial.indexPath}.lock`; const lock = await open(lockPath, 'wx', 0o600); let owned = true;
    try {
      if ((await identity(plan.reader)).fingerprint !== plan.initial.fingerprint) throw fail('CHANGED', '真实分支、整合或暂存区已变化；外部工具可能已保存工作区，本次不自动暂存。');
      const snapshots: string[] = [];
      for (const path of input.paths) {
        const current = await workingFile(cwd, path, runtime.signal);
        const attribute = (await plan.reader.text(['check-attr', '-z', 'conflict-marker-size', '--', path])).split('\0')[2] ?? '';
        const parsedSize = Number(attribute); const markerSize = Number.isSafeInteger(parsedSize) && parsedSize > 0 && parsedSize <= 1024 ? parsedSize : 7;
        if (current.exists && current.mode !== '120000') {
          let text: string | null = null; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(current.bytes); } catch { /* Binary tool results remain raw bytes. */ }
          if (text !== null && !text.includes('\0') && hasUnresolvedGitConflictMarkers(text, markerSize)) throw fail('MARKERS_REMAIN', '外部工具退出后结果仍有冲突标记，尚未标记解决；请回到内置编辑器核对。', path);
        }
        snapshots.push(hash([current.exists, current.mode, bytesHash(current.bytes)]));
      }
      await copyFile(plan.initial.indexPath, lockPath);
      await run(['--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], input.paths.join('\0') + '\0', { ...runtime.env, GIT_INDEX_FILE: lockPath });
      for (const [position, path] of input.paths.entries()) { const current = await workingFile(cwd, path, runtime.signal); if (hash([current.exists, current.mode, bytesHash(current.bytes)]) !== snapshots[position]) throw fail('CHANGED', '结果在暂存期间被外部修改，尚未更新真实索引，请重新核对。', path); }
      runtime.signal?.throwIfAborted(); await rename(lockPath, plan.initial.indexPath); owned = false;
    } finally { await lock.close(); if (owned) await rm(lockPath, { force: true }); await rm(`${lockPath}.lock`, { force: true }); }
    return result;
  } catch (error) { if (started) throw outcome(error, runtime, { completedFiles: completed, paths: input.paths }); throw error; }
  finally { await rm(directory, { recursive: true, force: true }); }
}
