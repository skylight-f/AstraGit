import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseGitPorcelainStatus, type GitRunnerResult } from './index.js';
import { readGitWritePreview, type GitWritePreview } from './gitDestructivePreview.js';

export type GitRebasePlanAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';
export interface GitRebasePlanStep { sha: string; action: GitRebasePlanAction; message?: string }
export interface GitRebaseCommit { sha: string; parentShas: string[]; author: string; authoredAt: string; message: string; subject: string }
export interface GitInteractiveRebasePreview {
  fingerprint: string; branch: string; detached: boolean; headSha: string;
  baseSha: string; baseSubject: string; ontoSha: string; ontoSubject: string;
  commits: GitRebaseCommit[]; mergeCount: number; publishedCount: number;
  changedFiles: string[]; changedFileCount: number;
  untrackedObstacles: string[]; untrackedObstacleCount: number;
  nestedRepositories: GitWritePreview['nestedRepositories']; nestedRepositoryCount: number;
}
export interface GitInteractiveRebaseInput {
  baseSha: string; ontoSha: string; expectedFingerprint: string; steps: GitRebasePlanStep[];
  groupMessages?: Record<string, string>; allowFlattenMerges?: boolean; allowOverwriteObstacles?: boolean;
}
export interface GitRebaseEditState { fingerprint: string; originalBranch: string; originalHeadSha: string; originalCommitSha: string; appPlan: boolean }
type Run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<GitRunnerResult>;
type Identity = { branch: string; detached: boolean; headSha: string; integrationState: 'merge' | 'rebase' | 'cherry_pick' | 'revert' | 'am' | null };
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const maximumCommits = 2000;
const maximumMessageBytes = 128 * 1024;
const maximumPayloadBytes = 6 * 1024 * 1024;
const markerName = 'astragit-plan-id';
const metadataName = 'astragit-interactive-rebase';
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write', operationStage: 'preflight' });
const safeMessage = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value) <= maximumMessageBytes;
function safePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '提交路径无效，无法检查重放范围。');
  return path;
}
async function optionalFile(path: string) { try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
async function gitRoot(cwd: string, run: Run) { return resolve(cwd, (await run(['rev-parse', '--absolute-git-dir'])).stdout.replace(/\r?\n$/u, '')); }
async function resolveCommit(ref: string, run: Run) {
  if (!ref || ref.includes('\0') || ref.length > 4096) throw failure('ASTRAGIT_GIT_REBASE_RANGE_INVALID', '请选择有效的变基基点。');
  let sha: string;
  try { sha = (await run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).stdout.trim(); }
  catch (error) {
    const native = error as { exitCode?: number; stderr?: string; details?: string };
    if (native.exitCode === 128 && /Needed a single revision|unknown revision|bad revision|expected commit type|not a valid object name/iu.test(native.stderr ?? '')) throw Object.assign(failure('ASTRAGIT_GIT_REBASE_RANGE_INVALID', '所选基点不是有效的提交，请核对来源基点和新基点。'), { details: native.details ?? native.stderr });
    throw error;
  }
  if (!objectId.test(sha)) throw failure('ASTRAGIT_GIT_REBASE_RANGE_INVALID', '无法读取所选基点提交。');
  return sha;
}

/** Include transient paths: a commit may add a file that a later commit deletes. */
async function replayTargets(commits: string[], run: Run) {
  if (!commits.length) return [];
  const fields = (await run(['diff-tree', '--raw', '--root', '--no-commit-id', '--no-renames', '-r', '-z', '--stdin'], commits.join('\n') + '\n')).stdout.split('\0').filter(Boolean);
  const paths = new Map<string, string>();
  for (let index = 0; index < fields.length; index += 2) {
    const match = /^:([0-9]{6}) ([0-9]{6}) [a-f0-9]+ [a-f0-9]+ [A-Z][0-9]*$/u.exec(fields[index]!);
    if (!match || !fields[index + 1]) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '无法完整读取提交重放的路径。');
    const mode = match[2] === '000000' ? match[1]! : match[2]!; const path = safePath(fields[index + 1]!);
    if (!paths.has(path) || mode !== '160000') paths.set(path, mode);
  }
  return [...paths].sort(([left], [right]) => left.localeCompare(right)).map(([path, mode]) => ({ path, mode }));
}

/** A disposable HEAD index checks hidden flags without changing the real index. */
async function hiddenChanges(cwd: string, headSha: string, run: Run): Promise<string[]> {
  const flags = (await run(['ls-files', '-v', '-z'])).stdout.split('\0').filter(Boolean);
  const paths: string[] = []; const missing: string[] = [];
  for (const row of flags) {
    if (!'hSs'.includes(row[0] ?? '')) continue;
    const path = safePath(row.slice(2));
    try { await lstat(join(cwd, path)); paths.push(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (row[0] === 'h') missing.push(path); }
  }
  if (!paths.length) return missing;
  const directory = await mkdtemp(join(tmpdir(), 'astragit-rebase-index-')); const env = { GIT_INDEX_FILE: join(directory, 'index'), GIT_OPTIONAL_LOCKS: '0' };
  try {
    await run(['read-tree', headSha], undefined, env); const changed = [...missing];
    for (let offset = 0; offset < paths.length; offset += 16) changed.push(...(await run(['--literal-pathspecs', 'diff', '--name-only', '-z', '--ignore-submodules=dirty', '--', ...paths.slice(offset, offset + 16)], undefined, env)).stdout.split('\0').filter(Boolean));
    return changed;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export { hiddenChanges as readGitHiddenChanges };

export async function readInteractiveRebasePreview(cwd: string, identity: Identity, baseRef: string, ontoRef: string | undefined, run: Run, signal?: AbortSignal): Promise<GitInteractiveRebasePreview> {
  signal?.throwIfAborted();
  if (!identity.headSha) throw failure('ASTRAGIT_GIT_REBASE_HEAD_REQUIRED', '仓库尚无提交，无法交互变基。');
  if (identity.integrationState) throw failure('ASTRAGIT_GIT_INTEGRATION_ACTIVE', '请先完成或终止当前整合，再开始交互变基。');
  const baseSha = await resolveCommit(baseRef, run); const ontoSha = ontoRef ? await resolveCommit(ontoRef, run) : baseSha;
  try { await run(['merge-base', '--is-ancestor', baseSha, identity.headSha]); }
  catch (error) { if ((error as { exitCode?: number }).exitCode === 1) throw failure('ASTRAGIT_GIT_REBASE_BASE_NOT_ANCESTOR', '所选来源基点不是当前 HEAD 的祖先；请选择要整理的提交之前的基点。新位置请填写在“新基点”中。'); throw error; }
  const range = `${baseSha}..${identity.headSha}`;
  const shas = (await run(['rev-list', '--reverse', '--topo-order', '--no-merges', `--max-count=${maximumCommits + 1}`, range])).stdout.trim().split('\n').filter(Boolean);
  if (shas.length > maximumCommits) throw failure('ASTRAGIT_GIT_REBASE_RANGE_TOO_LARGE', `本次范围超过 ${maximumCommits} 个提交，请选择更近的来源基点后分批整理。`);
  const commits: GitRebaseCommit[] = [];
  if (shas.length) {
    const fields = (await run(['log', '-z', '--no-walk=unsorted', '--format=%H%x00%P%x00%an%x00%aI%x00%B', '--stdin'], shas.join('\n') + '\n')).stdout.split('\0');
    if (fields.at(-1) === '') fields.pop();
    if (fields.length !== shas.length * 5) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '无法完整读取提交说明，请缩小变基范围后重试。');
    const bySha = new Map<string, GitRebaseCommit>();
    for (let index = 0; index < fields.length; index += 5) {
      const [sha, parents, author, authoredAt, message] = fields.slice(index, index + 5) as [string, string, string, string, string];
      if (!objectId.test(sha) || !safeMessage(message)) throw failure('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '提交说明包含无效字节或超过单项 128 KiB 限制，无法在内置计划中处理。');
      bySha.set(sha, { sha, parentShas: parents.split(' ').filter(Boolean), author, authoredAt, message, subject: message.split(/\r?\n/u)[0] ?? '' });
    }
    for (const sha of shas) { const commit = bySha.get(sha); if (!commit) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '提交集合发生变化，请重新读取。'); commits.push(commit); }
  }
  const targets = await replayTargets(shas, run);
  const [write, mergeCountText, unpublishedText, baseSubject, hidden, status] = await Promise.all([
    readGitWritePreview(cwd, { ...identity, targetSha: ontoSha }, 'hard', args => run(args), signal, targets),
    run(['rev-list', '--count', '--merges', range]), run(['rev-list', '--count', '--no-merges', range, '--not', '--remotes']),
    run(['show', '-s', '--format=%s', baseSha]), hiddenChanges(cwd, identity.headSha, run),
    run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=dirty']),
  ]);
  const changed = [...new Set([...parseGitPorcelainStatus(status.stdout).fileStatuses.filter(file => file.indexStatus !== '?').map(file => file.path), ...hidden])].sort();
  const mergeCount = Number(mergeCountText.stdout.trim()); const unpublished = Number(unpublishedText.stdout.trim());
  if (!Number.isSafeInteger(mergeCount) || !Number.isSafeInteger(unpublished)) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '无法读取变基提交范围。');
  const fingerprint = createHash('sha256').update(JSON.stringify([cwd, identity, baseSha, ontoSha, write.fingerprint, commits, mergeCount, unpublished, changed])).digest('hex');
  if (Buffer.byteLength(JSON.stringify(commits)) > maximumPayloadBytes) throw failure('ASTRAGIT_GIT_REBASE_RANGE_TOO_LARGE', '本次提交说明总量过大，请选择更近的基点后分批整理。');
  return { fingerprint, branch: identity.branch, detached: identity.detached, headSha: identity.headSha, baseSha, baseSubject: baseSubject.stdout.trimEnd(), ontoSha, ontoSubject: write.targetSubject, commits, mergeCount, publishedCount: Math.max(0, commits.length - unpublished), changedFiles: changed.slice(0, 200), changedFileCount: changed.length, untrackedObstacles: write.untrackedObstacles, untrackedObstacleCount: write.untrackedObstacleCount, nestedRepositories: write.nestedRepositories, nestedRepositoryCount: write.nestedRepositoryCount };
}

export interface GitRebasePlanGroup { anchor: string; members: GitRebasePlanStep[]; message: string; squash: boolean }
export function compileInteractiveRebasePlan(preview: GitInteractiveRebasePreview, steps: GitRebasePlanStep[], groupMessages: Record<string, string> = {}) {
  const commits = new Map(preview.commits.map(commit => [commit.sha, commit]));
  if (!Array.isArray(steps) || !steps.length || steps.some(step => !step || typeof step !== 'object') || steps.length !== commits.size || new Set(steps.map(step => step.sha)).size !== commits.size || steps.some(step => !commits.has(step.sha) || !['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'].includes(step.action) || (step.action === 'reword' ? !safeMessage(step.message) : step.message !== undefined))) throw failure('ASTRAGIT_GIT_REBASE_PLAN_INVALID', '提交计划必须完整包含预览中的每个提交一次，且只能使用支持的操作；改说明项需要有效的完整提交说明。');
  if (!groupMessages || typeof groupMessages !== 'object' || Array.isArray(groupMessages)) throw failure('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '合并说明格式无效。');
  const groups: GitRebasePlanGroup[] = [];
  for (const step of steps) {
    if (step.action === 'drop') continue;
    const previous = groups.at(-1);
    if (step.action === 'squash' || step.action === 'fixup') {
      if (!previous) throw failure('ASTRAGIT_GIT_REBASE_FIRST_COMBINED', '第一个保留的提交不能向前合并；请改为保留、改说明或暂停编辑。');
      previous.members.push(step); if (step.action === 'squash') { previous.squash = true; previous.message += `\n\n${commits.get(step.sha)!.message.trimEnd()}`; }
    } else groups.push({ anchor: step.sha, members: [step], message: (step.action === 'reword' ? step.message! : commits.get(step.sha)!.message).trimEnd(), squash: false });
  }
  if (Object.keys(groupMessages).some(key => !groups.some(group => group.anchor === key && group.squash) || !safeMessage(groupMessages[key]))) throw failure('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '合并说明必须对应当前确实包含 squash 的提交组，且不能包含无效字节或过大。');
  const messages = Object.fromEntries(preview.commits.map(commit => [commit.sha, commit.message]));
  for (const step of steps) if (step.action === 'reword') messages[step.sha] = step.message!;
  for (const group of groups) {
    if (!group.squash) continue;
    group.message = groupMessages[group.anchor] ?? group.message;
    if (!safeMessage(group.message)) throw failure('ASTRAGIT_GIT_REBASE_MESSAGE_INVALID', '合并后的提交说明不能包含无效字节或超过 128 KiB。');
    for (const member of group.members.slice(1)) messages[member.sha] = group.message;
  }
  const todo = steps.map(step => `${step.action} ${step.sha}`).join('\n') + '\n';
  if (Buffer.byteLength(JSON.stringify(messages)) > maximumPayloadBytes) throw failure('ASTRAGIT_GIT_REBASE_RANGE_TOO_LARGE', '本次说明总量过大，请分批整理。');
  return { groups, messages, todo };
}

interface RebasePayload { schemaVersion: 1; id: string; cwd: string; originalBranch: string; originalHeadSha: string; detached: boolean; todo: string; messages: Record<string, string> }
interface StoredPayload { payload: RebasePayload; checksum: string }
const digest = (payload: RebasePayload) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function requireRealDirectory(path: string) { const entry = await lstat(path); if (!entry.isDirectory() || entry.isSymbolicLink()) throw failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '交互变基恢复目录已变化，请检查 Git 目录，不要直接重复操作。'); }
async function atomicText(directory: string, name: string, content: string) {
  const temporary = join(directory, `.write-${randomUUID()}`); const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, join(directory, name)); } finally { await rm(temporary, { force: true }); }
}
async function materializeMessages(directory: string, payload: RebasePayload) {
  await requireRealDirectory(directory); const messages = join(directory, 'messages');
  await mkdir(messages, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); await requireRealDirectory(messages);
  for (const [sha, message] of Object.entries(payload.messages)) await atomicText(messages, sha, message);
}
function editorEnvironment(directory: string) {
  // Only fixed shell code and an app-created path are executable. Commit text is data.
  const edit = String.raw`set -eu
payload=$1
file=$2
state=$(git rev-parse --git-path rebase-merge/done)
last=$(/usr/bin/tail -n 1 "$state")
rest=\${last#* }
sha=\${rest%% *}
case "$sha" in ''|*[!a-f0-9]*) echo 'AstraGit rebase step is invalid' >&2; exit 1;; esac
sha=$(git rev-parse --verify "$sha^{commit}")
if [ ! -f "$payload/messages/$sha" ]; then echo 'AstraGit rebase message is missing' >&2; exit 1; fi
/bin/cp "$payload/messages/$sha" "$file"`;
  return { GIT_EDITOR: `/bin/sh -c ${quote(edit.replaceAll('\\${', '${'))} -- ${quote(directory)}` };
}

/** Git's reword editor refuses empty messages even with rebase --allow-empty-message.
 * Use a fixed native amend instruction for this explicit plan value. No caller can
 * provide exec text: both the private payload ID and commit SHA are app generated.
 */
function nativeTodo(steps: GitRebasePlanStep[], plan: ReturnType<typeof compileInteractiveRebasePlan>, id: string) {
  const emptyGroups = plan.groups.filter(group => group.squash && !group.message.trim());
  const fixups = new Set(emptyGroups.flatMap(group => group.members.slice(1).map(step => step.sha)));
  const amendments = new Set(emptyGroups.map(group => group.members.at(-1)!.sha));
  const lines: string[] = [];
  for (const step of steps) {
    const emptyReword = step.action === 'reword' && !step.message!.trim();
    lines.push(`${emptyReword ? 'pick' : fixups.has(step.sha) ? 'fixup' : step.action} ${step.sha}`);
    if (emptyReword || amendments.has(step.sha)) lines.push(`exec git -c commit.cleanup=verbatim commit --amend --allow-empty --allow-empty-message -F "$(git rev-parse --git-path ${metadataName}/${id}/messages/${step.sha})"`);
  }
  return lines.join('\n') + '\n';
}

async function cleanupPayload(root: string, directory: string) {
  if (await optionalFile(join(root, 'rebase-merge/head-name')) !== null || await optionalFile(join(root, 'rebase-apply/head-name')) !== null) return;
  await requireRealDirectory(join(root, metadataName)); await requireRealDirectory(directory);
  await rm(directory, { recursive: true });
  await rmdir(join(root, metadataName)).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; });
}

/** A plan file is durable across conflict stops and process restarts. */
export async function executeInteractiveRebase(cwd: string, preview: GitInteractiveRebasePreview, input: GitInteractiveRebaseInput, run: Run, runRebase: (args: string[], env: NodeJS.ProcessEnv) => Promise<GitRunnerResult>) {
  if (!input.expectedFingerprint || input.expectedFingerprint !== preview.fingerprint) throw failure('ASTRAGIT_GIT_REBASE_PREVIEW_CHANGED', '分支、提交、索引或磁盘内容已变化，尚未开始交互变基，请重新载入计划。');
  if (!preview.commits.length) throw failure('ASTRAGIT_GIT_REBASE_NO_COMMITS', '来源基点之后没有可整理的提交，请选择更早的基点。');
  if (preview.changedFileCount) throw Object.assign(failure('ASTRAGIT_GIT_REBASE_LOCAL_CHANGES', '当前仓库还有未提交的跟踪修改，请先提交或贮藏后再交互变基。'), { affectedFiles: preview.changedFiles, affectedFileCount: preview.changedFileCount });
  if (preview.mergeCount && !input.allowFlattenMerges) throw failure('ASTRAGIT_GIT_REBASE_MERGES_CONFIRMATION_REQUIRED', '范围内包含合并提交；当前计划会线性重放，请确认移除合并节点及仅存在于合并提交中的改动的影响。');
  if ((preview.untrackedObstacleCount || preview.nestedRepositories.some(item => item.effect === 'directory')) && !input.allowOverwriteObstacles) throw failure('ASTRAGIT_GIT_REBASE_OBSTACLES_CONFIRMATION_REQUIRED', '重放路径与现有未跟踪或忽略内容重名，请备份并明确确认覆盖范围。');
  const plan = compileInteractiveRebasePlan(preview, input.steps, input.groupMessages);
  const root = await gitRoot(cwd, run); const parent = join(root, metadataName);
  await mkdir(parent, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); await requireRealDirectory(parent);
  const id = randomUUID(); const directory = join(parent, id); await mkdir(directory, { mode: 0o700 });
  const payload: RebasePayload = { schemaVersion: 1, id, cwd, originalBranch: preview.branch, originalHeadSha: preview.headSha, detached: preview.detached, todo: nativeTodo(input.steps, plan, id), messages: plan.messages };
  let started = false;
  try {
    await atomicText(directory, 'manifest.json', JSON.stringify({ payload, checksum: digest(payload) } satisfies StoredPayload)); await atomicText(directory, 'todo', payload.todo); await materializeMessages(directory, payload);
    const env: NodeJS.ProcessEnv = editorEnvironment(directory);
    // Git appends the todo path last; the command expects payload, ID, then path.
    const seq = String.raw`set -eu
payload=$1
id=$2
todo=$3
printf '%s\n' "$id" > "\${todo%/*}/astragit-plan-id"
/bin/cp "$payload/todo" "$todo"`;
    env.GIT_SEQUENCE_EDITOR = `/bin/sh -c ${quote(seq.replaceAll('\\${', '${'))} -- ${quote(directory)} ${quote(id)}`;
    started = true;
    return await runRebase(['-c', 'rebase.autoSquash=false', '-c', 'rebase.autoStash=false', '-c', 'rebase.updateRefs=false', '-c', 'rebase.rebaseMerges=false', '-c', 'rebase.rescheduleFailedExec=true', '-c', 'rebase.instructionFormat=%s', '-c', 'rebase.abbreviateCommands=false', '-c', 'rebase.missingCommitsCheck=error', '-c', 'submodule.recurse=false', '-c', 'commit.cleanup=verbatim', 'rebase', '--interactive', '--keep-empty', '--allow-empty-message', '--onto', preview.ontoSha, preview.baseSha], env);
  } finally {
    // A cleanup failure must not replace the actual native Git outcome.
    if (started) await cleanupPayload(root, directory).catch(() => undefined);
    else await rm(directory, { recursive: true, force: true });
  }
}

function instructionRows(text: string) { return text.split(/\r?\n/u).filter(line => line.trim() && !line.trimStart().startsWith('#')).map(line => { if (line.startsWith('exec ')) return line.trimEnd(); const match = /^(pick|reword|edit|squash|fixup|drop) ([a-f0-9]{40}|[a-f0-9]{64})(?:\s|$)/u.exec(line); return match ? `${match[1]} ${match[2]}` : 'invalid'; }); }
export async function readInteractiveRebaseResume(cwd: string, run: Run) {
  try { return await readInteractiveRebaseResumeInternal(cwd, run); }
  catch (error) {
    if (typeof (error as { code?: unknown }).code === 'string' && String((error as { code?: unknown }).code).startsWith('ASTRAGIT_GIT_REBASE_')) throw error;
    throw Object.assign(failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '无法完整读取交互变基恢复数据，请核对后再继续；仍可终止原生变基。'), { cause: error });
  }
}

async function readInteractiveRebaseResumeInternal(cwd: string, run: Run) {
  const root = await gitRoot(cwd, run); const marker = await optionalFile(join(root, 'rebase-merge', markerName)); if (marker === null) return null;
  const id = marker.trim(); if (!uuid.test(id)) throw failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '交互变基标识无效，请核对 Git 状态；可以终止该变基或在外部 Git 中处理。');
  const parent = join(root, metadataName); const directory = join(parent, id); await requireRealDirectory(parent); await requireRealDirectory(directory);
  const path = join(directory, 'manifest.json'); const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '交互变基恢复文件不适用，请核对后再操作。');
  const stored = JSON.parse(await readFile(path, 'utf8')) as StoredPayload; const value = stored.payload;
  if (!value || value.schemaVersion !== 1 || value.id !== id || value.cwd !== cwd || typeof value.originalBranch !== 'string' || typeof value.detached !== 'boolean' || !objectId.test(value.originalHeadSha) || !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages) || typeof value.todo !== 'string' || !Object.keys(value.messages).length || Object.entries(value.messages).some(([sha, message]) => !objectId.test(sha) || !safeMessage(message)) || stored.checksum !== digest(value)) throw failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '交互变基恢复数据已变化，请检查后再继续；不要重新开始同一变基。');
  const [original, branch, done, todo] = await Promise.all(['orig-head', 'head-name', 'done', 'git-rebase-todo'].map(name => readFile(join(root, 'rebase-merge', name), 'utf8')));
  if (original!.trim() !== value.originalHeadSha || branch!.trim() !== (value.detached ? 'detached HEAD' : `refs/heads/${value.originalBranch}`)) throw failure('ASTRAGIT_GIT_REBASE_RECOVERY_INVALID', '恢复数据不属于当前变基，未继续操作。');
  const before = instructionRows(done!); const after = instructionRows(todo!);
  // Git can reschedule a failed instruction at the boundary.
  if (before.at(-1) === after[0]) after.shift();
  if (JSON.stringify([...before, ...after]) !== JSON.stringify(instructionRows(value.todo))) throw failure('ASTRAGIT_GIT_REBASE_PLAN_CHANGED', '原生变基计划已在外部改动，请核对；可在外部继续或在应用中终止。');
  await materializeMessages(directory, value);
  return { env: { GIT_EDITOR: editorEnvironment(directory).GIT_EDITOR }, cleanup: () => cleanupPayload(root, directory) };
}

/** Edit pauses are identified by native state, including rebases started outside AstraGit. */
export async function readRebaseEditState(cwd: string, headSha: string, run: Run): Promise<GitRebaseEditState | null> {
  const root = await gitRoot(cwd, run); const state = join(root, 'rebase-merge');
  const [amend, done, todo, original, branch, marker] = await Promise.all(['amend', 'done', 'git-rebase-todo', 'orig-head', 'head-name', markerName].map(name => optionalFile(join(state, name))));
  if (amend === null || done === null || todo === null || !original || !branch || !objectId.test(original.trim())) return null;
  const last = instructionRows(done).at(-1); const match = /^edit ([a-f0-9]{40}|[a-f0-9]{64})$/u.exec(last ?? ''); if (!match || !objectId.test(amend.trim())) return null;
  return { fingerprint: createHash('sha256').update(JSON.stringify([root, headSha, amend, done, todo, original, branch])).digest('hex'), originalBranch: branch.trim().replace(/^refs\/heads\//u, ''), originalHeadSha: original.trim(), originalCommitSha: match[1]!, appPlan: Boolean(marker && uuid.test(marker.trim())) };
}

export async function prepareInteractiveRebaseControl(cwd: string, operation: 'continue' | 'skip' | 'abort', run: Run) {
  let resume: Awaited<ReturnType<typeof readInteractiveRebaseResume>> = null;
  let cleanup: (() => Promise<void>) | undefined;
  if (operation !== 'abort') { resume = await readInteractiveRebaseResume(cwd, run); cleanup = resume?.cleanup; }
  else {
    // Corrupt app recovery data must never prevent a native rebase abort.
    try {
      const root = await gitRoot(cwd, run); const id = (await optionalFile(join(root, 'rebase-merge', markerName)))?.trim();
      if (id && uuid.test(id)) cleanup = () => cleanupPayload(root, join(root, metadataName, id));
    } catch { /* Leave unrecognized metadata in place and let Git abort its own state. */ }
  }
  return { env: resume?.env ?? {}, cleanup, args: ['-c', 'rebase.updateRefs=false', '-c', 'submodule.recurse=false', ...(resume ? ['-c', 'commit.cleanup=verbatim', '-c', 'rebase.autoStash=false', '-c', 'rebase.rescheduleFailedExec=true'] : []), '-c', 'core.editor=true', 'rebase', `--${operation}`] };
}
