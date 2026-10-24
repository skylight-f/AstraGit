import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GitHistoryReader } from './gitFileHistory.js';
import { fingerprint as repositoryFingerprint } from './gitPatchOperations.js';
import { resolveGitFlowTool } from './gitFlowTool.js';

export type GitFlowKind = 'feature' | 'release' | 'hotfix';
export interface GitFlowConfiguration {
  production: string; develop: string;
  feature: string; bugfix: string; release: string; hotfix: string; support: string; versionTag: string;
}
export type GitFlowChange =
  | { operation: 'init'; configuration: GitFlowConfiguration }
  | { operation: 'start'; kind: GitFlowKind; name: string; base?: string; fetch?: boolean }
  | { operation: 'finish'; kind: GitFlowKind; name: string; keepBranch?: boolean; forceDelete?: boolean; rebase?: boolean; fetch?: boolean; pushAfter?: boolean; skipTag?: boolean; tagMessage?: string };
export interface GitFlowBranch { kind: GitFlowKind; name: string; branch: string; sha: string; base: string }
export interface GitFlowState {
  toolSource: 'bundled' | 'system';
  available: boolean; supported: boolean; version: string; fingerprint: string; initialized: boolean;
  configuration: GitFlowConfiguration; branch: string; headSha: string; localBranches: string[];
  branches: GitFlowBranch[]; remote: string; remoteAvailable: boolean; remoteUrls: string[]; integration: string[]; changedPaths: string[];
}
export interface GitFlowPreview {
  fingerprint: string; change: GitFlowChange; state: GitFlowState; branch: string; targets: string[]; tag: string | null;
  createsDevelop: boolean; createsInitialCommit: boolean; fetchesBranch: boolean;
}
export interface GitFlowRefChange { ref: string; before: string | null; after: string | null }
export interface GitFlowOutcome { operation: GitFlowChange['operation']; kind?: GitFlowKind; branch: string; paused: boolean; changedRefs: GitFlowRefChange[] }
type Runtime = { signal?: AbortSignal; env?: NodeJS.ProcessEnv; redact?: (text: string) => string; toolMode?: 'bundled' | 'system' };
type Run = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (suffix: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_FLOW_${suffix}`, statusCode: ['CHANGED', 'CONFLICT', 'INTEGRATION', 'WORKTREE'].includes(suffix) ? 409 : 400, operationStatus: 'failed_before_write', operationStage: 'preflight', ...(details ? { details } : {}) });
const prefixes = ['feature', 'bugfix', 'release', 'hotfix', 'support', 'versionTag'] as const;
const configKey = (key: keyof GitFlowConfiguration) => key === 'production' ? 'gitflow.branch.master' : key === 'develop' ? 'gitflow.branch.develop' : `gitflow.prefix.${key === 'versionTag' ? 'versiontag' : key}`;
const decode = (value: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
function name(value: unknown, allowEmpty = false) {
  // AVH is a shell tool; keep its eval-based tag/branch helpers away from shell syntax.
  if (typeof value !== 'string' || (!value && !allowEmpty) || value.length > 1024 || (value && (!/^[\p{L}\p{N}._/+@=-]+$/u.test(value) || value.startsWith('-')))) throw fail('INVALID', 'Git Flow 名称或前缀无效，请使用不含空白、控制字符和 shell 符号的分支名称。');
  return value;
}
export function parseGitFlowChange(value: unknown): GitFlowChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID', 'Git Flow 操作选项无效。');
  const input = value as Record<string, unknown>;
  if (input.operation === 'init') {
    if (!input.configuration || typeof input.configuration !== 'object' || Array.isArray(input.configuration)) throw fail('INVALID', '请选择 Git Flow 基础分支与命名前缀。');
    const source = input.configuration as Record<string, unknown>;
    const configuration = Object.fromEntries((['production', 'develop', ...prefixes] as const).map(key => [key, name(source[key], prefixes.includes(key as typeof prefixes[number]))])) as unknown as GitFlowConfiguration;
    if (configuration.production === configuration.develop) throw fail('INVALID', '生产分支与开发分支不能相同。');
    if (Object.keys(input).some(key => !['operation', 'configuration'].includes(key)) || Object.keys(source).some(key => !['production', 'develop', ...prefixes].includes(key))) throw fail('INVALID', '初始化包含不支持的选项。');
    return { operation: 'init', configuration };
  }
  if (!['start', 'finish'].includes(String(input.operation)) || !['feature', 'release', 'hotfix'].includes(String(input.kind))) throw fail('INVALID', '请选择支持的 Git Flow 操作和分支类型。');
  const kind = input.kind as GitFlowKind;
  const result: Record<string, unknown> = { operation: input.operation, kind, name: name(input.name) };
  const allowed = input.operation === 'start' ? ['operation', 'kind', 'name', 'base', 'fetch'] : ['operation', 'kind', 'name', 'keepBranch', 'forceDelete', 'rebase', 'fetch', 'pushAfter', 'skipTag', 'tagMessage'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('INVALID', '选项与当前 Git Flow 操作不匹配。');
  for (const key of ['keepBranch', 'forceDelete', 'rebase', 'fetch', 'pushAfter', 'skipTag']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw fail('INVALID', 'Git Flow 开关必须为布尔值。'); result[key] = input[key];
  }
  if (input.base !== undefined) result.base = name(input.base);
  if (input.tagMessage !== undefined) {
    if (typeof input.tagMessage !== 'string' || input.tagMessage.includes('\0') || Buffer.byteLength(input.tagMessage) > 128 * 1024) throw fail('INVALID', '标签说明包含无效字符或超过 128 KiB。'); result.tagMessage = input.tagMessage;
  }
  if ((kind !== 'feature' && input.rebase !== undefined) || (kind === 'feature' && (input.skipTag !== undefined || input.tagMessage !== undefined)) || (input.skipTag && input.tagMessage !== undefined) || (input.keepBranch && input.forceDelete)) throw fail('INVALID', '变基、标签或删除选项与分支类型不匹配。');
  return result as unknown as GitFlowChange;
}
function configValues(raw: string) {
  const values = new Map<string, string>();
  for (const record of raw.split('\0').filter(Boolean)) { const index = record.indexOf('\n'); values.set(index < 0 ? record : record.slice(0, index), index < 0 ? 'true' : record.slice(index + 1)); }
  return values;
}
async function optionalFile(reader: GitHistoryReader, cwd: string, name: string) {
  const path = resolve(cwd, (await reader.text(['rev-parse', '--git-path', name])).replace(/\r?\n$/u, ''));
  try { const info = await lstat(path); return info.isDirectory() ? { directory: true, mtime: info.mtimeMs, ctime: info.ctimeMs } : { bytes: (await readFile(path)).toString('base64') }; }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null; throw error; }
}
async function inspect(cwd: string, runtime: Runtime) {
  const reader = new GitHistoryReader(cwd, runtime); await reader.initialize();
  const [rawConfig, rawRefs, rawStatus, modified, rawWorktrees] = await Promise.all([
    reader.text(['config', '--null', '--list', '--includes']),
    reader.text(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)%00', 'refs/heads', 'refs/remotes', 'refs/tags']),
    reader.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']),
    reader.run(['ls-files', '-z', '--modified', '--others', '--exclude-standard']), reader.text(['worktree', 'list', '--porcelain', '-z']),
  ]);
  const config = configValues(rawConfig); const refs = new Map<string, string>();
  for (const record of rawRefs.split('\n').filter(Boolean)) { const fields = record.split('\0'); if (fields.length !== 4 || !/^[a-f0-9]{40,64}$/u.test(fields[1]!)) throw fail('READ', 'Git 返回了不完整的分支或标签清单。'); if (!fields[2]) refs.set(fields[0]!, fields[1]!); }
  const changedPaths = [...new Set(decode(modified).split('\0').filter(Boolean))];
  if (changedPaths.length > 20_000) throw fail('TOO_LARGE', '当前更改文件超过 20000 个，请先缩小或提交、贮藏更改后再执行 Git Flow。');
  const files = await repositoryFingerprint(cwd, changedPaths, reader, runtime);
  const integration: Array<[string, unknown]> = [];
  for (const key of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) { const value = await optionalFile(reader, cwd, key); if (value) integration.push([key, value]); }
  const recovery = await optionalFile(reader, cwd, '.gitflow/MERGE_BASE');
  const remoteKey = digest(rawConfig.split('\0').filter(record => /^(?:remote\.|url\.|core\.sshcommand\n|gitflow\.origin\n)/u.test(record)));
  return { reader, config, rawConfig, remoteKey, refs, status: decode(rawStatus), changedPaths, integration, files, worktrees: rawWorktrees, key: digest([await realpath(cwd), rawConfig, rawRefs, rawStatus.toString('base64'), files.fingerprint, integration, recovery, rawWorktrees]) };
}
async function read(cwd: string, runtime: Runtime) {
  const tool = await resolveGitFlowTool({ toolMode: runtime.toolMode, signal: runtime.signal });
  const info = await inspect(cwd, runtime); let available = true; let version = '';
  try { version = (await info.reader.text([...tool.arguments, 'version'])).trim(); }
  catch (error) { if ((error as { exitCode?: number }).exitCode === 1 && /['’]flow['’] is not a git command/u.test((error as { stderr?: string }).stderr ?? '')) available = false; else throw error; }
  const supported = /^1\.(?:1[1-9]|[2-9]\d)\.\d+(?:[-\w.]*)?\s+\(AVH Edition\)$/u.test(version);
  const configuration: GitFlowConfiguration = { production: info.config.get('gitflow.branch.master') ?? (info.refs.has('refs/heads/main') ? 'main' : 'master'), develop: info.config.get('gitflow.branch.develop') ?? 'develop', feature: 'feature/', bugfix: 'bugfix/', release: 'release/', hotfix: 'hotfix/', support: 'support/', versionTag: '' };
  for (const key of prefixes) configuration[key] = info.config.get(configKey(key)) ?? configuration[key];
  const initialized = ['production', 'develop', 'versionTag'].every(key => info.config.has(configKey(key as keyof GitFlowConfiguration))) && [...info.config.keys()].some(key => key.startsWith('gitflow.prefix.')) && configuration.production !== configuration.develop && [configuration.production, configuration.develop].every(branch => info.refs.has('refs/heads/' + branch));
  // Existing SourceTree configurations need not include AVH's bugfix prefix.
  // A missing native prefix is empty; only an uninitialized form uses defaults.
  if (initialized) for (const key of prefixes) configuration[key] = info.config.get(configKey(key)) ?? '';
  const localBranches = [...info.refs.keys()].filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice(11));
  const branches = initialized ? (['feature', 'release', 'hotfix'] as const).flatMap(kind => localBranches.filter(branch => branch.startsWith(configuration[kind]) && branch.length > configuration[kind].length && ![configuration.production, configuration.develop].includes(branch)).map(branch => ({ kind, name: branch.slice(configuration[kind].length), branch, sha: info.refs.get('refs/heads/' + branch)!, base: info.config.get(`gitflow.branch.${branch}.base`) ?? (kind === 'hotfix' ? configuration.production : configuration.develop) }))) : [];
  const remote = info.config.get('gitflow.origin') ?? 'origin';
  const remoteValues = (key: string) => info.rawConfig.split('\0').filter(record => record.startsWith(key + '\n')).map(record => record.slice(key.length + 1));
  const pushes = remoteValues(`remote.${remote}.pushurl`); const urls = pushes.length ? pushes : remoteValues(`remote.${remote}.url`);
  const state: GitFlowState = { toolSource: tool.source, available, supported, version, initialized, configuration, branch: info.files.branch, headSha: info.files.headSha, localBranches, branches, remote, remoteAvailable: info.config.has(`remote.${remote}.url`), remoteUrls: urls.map(value => runtime.redact?.(value) ?? value), fingerprint: digest([info.key, tool.fingerprint, available, supported, version]), integration: info.integration.map(([key]) => key), changedPaths: info.changedPaths };
  return { state, info, tool };
}
export async function readGitFlowState(cwd: string, runtime: Runtime = {}): Promise<GitFlowState> { return (await read(cwd, runtime)).state; }
async function validBranch(reader: GitHistoryReader, value: string) { name(value); try { await reader.text(['check-ref-format', '--branch', value]); } catch { throw fail('INVALID', '分支名称不符合 Git 规则。', value); } }
async function preview(cwd: string, value: unknown, runtime: Runtime) {
  const change = parseGitFlowChange(value); const before = await read(cwd, runtime); const { state, info } = before;
  if (!state.available) throw fail('UNAVAILABLE', state.toolSource === 'bundled' ? '应用内置 Git Flow 未能启动，请修复应用后重新读取。' : '未找到系统 Git Flow，请核对安装后重新读取。');
  if (!state.supported) throw fail('VERSION', '当前 Git Flow 不是支持的 AVH 1.11 或更新的 1.x 版本，请核对实际工具版本。', state.version);
  if (state.integration.length) throw fail('INTEGRATION', '请先在冲突编辑器完成或终止当前合并、变基或邮件应用，再重新预览 Git Flow。', state.integration.join('\n'));
  const fields = info.status.split('\0'); const records: string[] = [];
  for (let index = 0; index < fields.length && fields[index]; index++) {
    const record = fields[index]!; if (!/^[ MADRCU?!]{2} /u.test(record)) throw fail('READ', 'Git 返回了不完整的工作区状态。');
    records.push(record); if (/[RC]/u.test(record.slice(0, 2))) { index++; if (!fields[index]) throw fail('READ', 'Git 返回了不完整的重命名路径。'); }
  }
  if (records.some(record => record[0] === 'U' || record[1] === 'U' || ['AA', 'DD'].includes(record.slice(0, 2)))) throw fail('CONFLICT', '仓库还有未解决的冲突，请先处理并暂存。');
  const trackedChanges = records.some(record => !record.startsWith('?? '));
  let branch = ''; let targets: string[] = []; let tag: string | null = null; let createsDevelop = false; let createsInitialCommit = false; let fetchesBranch = false;
  if (change.operation === 'init') {
    const config = change.configuration;
    await validBranch(info.reader, config.production); await validBranch(info.reader, config.develop);
    for (const key of prefixes) await validBranch(info.reader, config[key] + 'astragit-flow-check');
    if (trackedChanges) throw fail('DIRTY', '初始化 Git Flow 前请先提交或贮藏暂存及已跟踪的本地修改。未跟踪文件不会加入初始提交。');
    if (!state.headSha && state.localBranches.length) throw fail('BASE', '当前 HEAD 尚无提交，但仓库已有历史。请先检出已有生产分支，再初始化 Git Flow，避免误建空提交。');
    if (state.headSha && !info.refs.has('refs/heads/' + config.production)) throw fail('BASE', '请选择实际存在的本地生产分支。', config.production);
    createsInitialCommit = !state.headSha; createsDevelop = !info.refs.has('refs/heads/' + config.develop);
    branch = createsDevelop || createsInitialCommit ? config.develop : state.branch; targets = [config.production, config.develop];
  } else {
    if (!state.initialized) throw fail('INIT_REQUIRED', '请先初始化当前仓库的 Git Flow 分支与命名前缀。');
    for (const key of ['production', 'develop', ...prefixes] as const) name(state.configuration[key], prefixes.includes(key as typeof prefixes[number]));
    name(state.remote);
    branch = state.configuration[change.kind] + change.name; await validBranch(info.reader, branch);
    if (change.operation === 'start') {
      if (info.refs.has('refs/heads/' + branch)) throw fail('EXISTS', '同名本地分支已存在，请切换已有分支或更换名称。', branch);
      const base = change.base ?? (change.kind === 'hotfix' ? state.configuration.production : state.configuration.develop);
      await validBranch(info.reader, base); if (!info.refs.has('refs/heads/' + base)) throw fail('BASE', '所选起点不是实际存在的本地分支。', base);
      targets = [base];
      if (change.kind !== 'feature' && trackedChanges && !/^(?:true|yes|on|1)$/iu.test(info.config.get('gitflow.allowdirty') ?? 'false')) throw fail('DIRTY', '开始 release/hotfix 前请先提交或贮藏本地修改。');
      if (change.kind !== 'feature') {
        if (state.branches.some(item => item.kind === change.kind) && !(change.kind === 'hotfix' && /^(?:true|yes|on|1)$/iu.test(info.config.get('gitflow.multi-hotfix') ?? 'false'))) throw fail('EXISTS', '当前类型已有未完成分支，请先完成该分支。');
        const versionTag = state.configuration.versionTag + change.name; await validBranch(info.reader, versionTag);
        if (info.refs.has('refs/tags/' + versionTag)) throw fail('TAG_EXISTS', '同版本标签已存在，未开始新的版本分支。', versionTag);
      }
    } else {
      const existing = state.branches.find(item => item.kind === change.kind && item.branch === branch);
      if (!existing) throw fail('MISSING', '所选 Git Flow 分支已不存在，请重新读取。', branch);
      if (trackedChanges) throw fail('DIRTY', '完成 Git Flow 前请先提交或贮藏本地修改；已有冲突需要先继续当前整合。');
      const base = existing.base; await validBranch(info.reader, base);
      if (!info.refs.has('refs/heads/' + base)) throw fail('BASE', '此分支记录的起点已不存在，请核对 Git Flow 配置。', base);
      targets = change.kind === 'feature' ? [base] : (change.kind === 'release' && base === state.configuration.develop) || (change.kind === 'hotfix' && base === state.configuration.production) ? [state.configuration.production, state.configuration.develop] : [base];
      if (change.kind !== 'feature' && !change.skipTag) {
        tag = state.configuration.versionTag + change.name; await validBranch(info.reader, tag);
        if (!info.refs.has('refs/tags/' + tag) && !change.tagMessage?.trim()) throw fail('MESSAGE', '请输入新版本标签的说明，或明确选择不创建标签。');
        if (info.refs.has('refs/tags/' + tag)) {
          let parent: string;
          try { parent = await info.reader.revision('refs/tags/' + tag + '^2'); }
          catch (error) { if ((error as { code?: string }).code !== 'ASTRAGIT_GIT_FILE_HISTORY_REVISION_INVALID') throw error; throw fail('TAG_EXISTS', '同名标签不是此分支先前完成步骤所创建的版本，未开始完成流程。', tag); }
          if (parent !== existing.sha) throw fail('TAG_EXISTS', '同名标签不对应所选分支的当前版本，未开始完成流程。', tag);
        }
        // AVH itself checks an existing tag against the finished branch. Keep it
        // visible for a resumed finish; never delete or replace that tag here.
      }
      fetchesBranch = info.refs.has(`refs/remotes/${state.remote}/${branch}`);
      const used = new Set([...targets, ...(change.rebase || !change.keepBranch ? [branch] : [])]);
      for (const record of info.worktrees.split('\0\0')) {
        const fields = record.split('\0'); const worktree = fields.find(field => field.startsWith('worktree '))?.slice(9); const ref = fields.find(field => field.startsWith('branch '))?.slice(7);
        if (worktree && ref?.startsWith('refs/heads/') && used.has(ref.slice(11)) && await realpath(worktree) !== await realpath(cwd)) throw fail('WORKTREE', '需要合并或删除的分支正在其他工作区使用，请先到对应工作区切换分支。', `${ref}\n${worktree}`);
      }
    }
    if ((change.fetch || (change.operation === 'finish' && (change.pushAfter || fetchesBranch))) && !state.remoteAvailable) throw fail('REMOTE', 'Git Flow 的远程不存在，请先在仓库设置中核对。', state.remote);
  }
  const after = await read(cwd, runtime); if (after.state.fingerprint !== state.fingerprint) throw fail('CHANGED', '读取期间仓库、配置或文件已变化，请重新预览 Git Flow。');
  return { info, tool: before.tool, value: { fingerprint: digest([state.fingerprint, change, branch, targets, tag]), change, state, branch, targets, tag, createsDevelop, createsInitialCommit, fetchesBranch } satisfies GitFlowPreview };
}
export async function previewGitFlow(cwd: string, change: unknown, runtime: Runtime = {}): Promise<GitFlowPreview> { return (await preview(cwd, change, runtime)).value; }
function refChanges(before: Map<string, string>, after: Map<string, string>): GitFlowRefChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(ref => before.get(ref) !== after.get(ref)).sort().map(ref => ({ ref, before: before.get(ref) ?? null, after: after.get(ref) ?? null }));
}
export async function executeGitFlow(cwd: string, value: unknown, expected: string, run: Run, runtime: Runtime = {}) {
  const reviewed = await preview(cwd, value, runtime); const p = reviewed.value; const change = p.change;
  if (!expected || expected !== p.fingerprint) throw fail('CHANGED', '分支、标签、配置、文件或操作选项已变化，本次未执行，请重新预览。');
  const common = ['-c', 'core.editor=true', '-c', 'sequence.editor=true', '-c', 'submodule.recurse=false'];
  let output = { stdout: '', stderr: '' }; let started = false; let temporary: string | undefined;
  const invoke = async (args: string[], input?: string) => { started = true; const next = await run([...common, ...args], input); output = { stdout: output.stdout + next.stdout, stderr: output.stderr + next.stderr }; };
  try {
    if (change.operation === 'init') {
      const config = change.configuration;
      if (p.createsDevelop && !p.createsInitialCommit) await invoke(['branch', '--no-track', config.develop, 'refs/heads/' + config.production]);
      // --force makes the interactive question sequence deterministic, including
      // empty prefixes. Answers are stdin data, never shell interpolation.
      const answers = [config.production, config.develop, ...prefixes.map(key => config[key] || '-'), '', ''].join('\n');
      await invoke(['-c', 'gitflow.init.defaults=false', ...reviewed.tool.arguments, 'init', '--local', '--force'], answers);
      // AVH checks out a development branch it creates itself. Pre-creating it
      // for repositories with multiple branches must retain that same behavior.
      if (p.createsDevelop && !p.createsInitialCommit) await invoke(['checkout', config.develop]);
    } else {
      const scope = `gitflow.${change.kind}.${change.operation}.`;
      const settings: Record<string, string | boolean> = { [scope + 'fetch']: change.fetch === true };
      let options: string[] = [];
      if (change.operation === 'finish') {
        for (const key of ['push', 'pushproduction', 'pushdevelop', 'pushtag', 'keep', 'keeplocal', 'force-delete', 'squash', 'squash-info', 'nobackmerge', 'nodevelopmerge', 'ff-master', 'sign', 'rebase', 'preserve-merges', 'no-ff']) settings[scope + key] = false;
        Object.assign(settings, { [scope + 'keepremote']: true, [scope + 'keep']: change.keepBranch === true, [scope + 'force-delete']: change.forceDelete === true, [scope + 'rebase']: change.rebase === true, [scope + 'notag']: change.skipTag === true, [scope + 'signingkey']: '', [scope + 'message']: '', [scope + 'messagefile']: '' });
        if (p.tag && change.tagMessage !== undefined) {
          temporary = await mkdtemp(join(tmpdir(), 'astragit-flow-'));
          const path = join(temporary, 'tag-message'); if (/[\r\n']/u.test(path)) throw fail('TEMP', '临时目录无法安全传递给当前 Git Flow 工具。');
          await writeFile(path, change.tagMessage!, { mode: 0o600 }); options = ['--messagefile', path];
        }
      }
      const overrides = Object.entries(settings).flatMap(([key, value]) => ['-c', `${key}=${value}`]);
      await invoke([...overrides, ...reviewed.tool.arguments, change.kind, change.operation, ...options, change.name, ...(change.operation === 'start' ? [p.targets[0]!] : [])]);
      const finished = await read(cwd, runtime);
      if (change.operation === 'start') {
        if (finished.state.branch !== p.branch || !finished.info.refs.has('refs/heads/' + p.branch)) throw fail('RESULT', 'Git Flow 返回成功，但实际新分支与确认名称不符，请核对钩子和当前分支。');
      } else {
        const exists = finished.info.refs.has('refs/heads/' + p.branch);
        if (exists !== (change.keepBranch === true)) throw fail('RESULT', 'Git Flow 返回成功，但本地分支保留/删除结果与确认内容不同。');
        const original = reviewed.info.refs.get('refs/heads/' + p.branch)!;
        if (!change.rebase) for (const target of p.targets) {
          if ((await finished.info.reader.text(['merge-base', original, 'refs/heads/' + target])).trim() !== original) throw fail('RESULT', 'Git Flow 返回成功，但无法确认原分支已合入所有目标。');
        }
        if (p.tag) {
          if (!finished.info.refs.has('refs/tags/' + p.tag)) throw fail('RESULT', 'Git Flow 返回成功，但本次版本标签不存在。');
          const tagged = await finished.info.reader.revision('refs/tags/' + p.tag);
          if ((await finished.info.reader.text(['merge-base', original, tagged])).trim() !== original) throw fail('RESULT', '现有版本标签没有包含所选分支，请核对实际版本。');
        }
      }
      if (change.operation === 'finish' && change.pushAfter) {
        if (reviewed.info.remoteKey !== finished.info.remoteKey) throw fail('REMOTE', 'Git Flow 本地步骤已执行，但远程配置已变化，未发起后续推送，请核对目标。');
        const refs = [...new Set(p.targets.map(branch => `refs/heads/${branch}`)), ...(p.tag ? [`refs/tags/${p.tag}`] : [])];
        // AVH --push pushes every local tag. Push only the reviewed flow refs.
        await invoke(['push', '--', p.state.remote, ...refs.map(ref => `${finished.info.refs.get(ref)!}:${ref}`)]);
      }
    }
    const after = await read(cwd, runtime);
    const flow: GitFlowOutcome = { operation: change.operation, ...('kind' in change ? { kind: change.kind } : {}), branch: p.branch, paused: false, changedRefs: refChanges(reviewed.info.refs, after.info.refs) };
    if (change.operation === 'init' && (!after.state.initialized || JSON.stringify(after.state.configuration) !== JSON.stringify(change.configuration))) throw fail('RESULT', 'Git Flow 初始化后的配置与确认内容不同，请刷新核对。');
    return { ...output, flow };
  } catch (error) {
    if (!started) throw error;
    let after: Awaited<ReturnType<typeof read>> | undefined;
    try { after = await read(cwd, { ...runtime, signal: undefined }); } catch { /* Cancellation and read failure cannot prove rollback. */ }
    const changes = after ? refChanges(reviewed.info.refs, after.info.refs) : [];
    const details = runtime.redact?.([output.stdout, output.stderr, (error as { stderr?: string; details?: string; message?: string }).stderr, (error as { details?: string }).details, (error as Error).message, JSON.stringify({ branch: after?.state.branch, changedRefs: changes })].filter(Boolean).join('\n')) ?? (error as Error).message;
    const blocked = change.operation === 'start' && after?.state.branch === p.state.branch && !after.info.refs.has('refs/heads/' + p.branch) && /would be overwritten/iu.test([details, (error as { stderr?: string }).stderr, (error as { details?: string }).details].join('\n'));
    throw Object.assign(fail(after?.state.integration.length ? 'PAUSED' : blocked ? 'CHECKOUT_BLOCKED' : 'OUTCOME_UNKNOWN', after?.state.integration.length ? 'Git Flow 已暂停，部分分支或标签可能已完成。请先解决并继续当前整合，再重新预览并完成原 Git Flow 分支。' : blocked ? '本地文件会被目标分支覆盖，Git 拒绝了新分支检出。流程可能已写入分支配置，请核对文件并提交或贮藏，再重新预览。' : 'Git Flow 未确认全部完成，部分分支、标签、配置或远程可能已经更新。请刷新并核对实际结果，不要直接重复执行。', details), { operationStatus: after?.state.integration.length ? 'conflict' : 'unknown_after_write', operationStage: 'command', cause: error });
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
