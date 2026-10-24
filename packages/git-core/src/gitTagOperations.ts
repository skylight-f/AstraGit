import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { gitRemoteEndpoint } from './gitRemoteEndpoint.js';

export interface GitTagLocalInfo { objectSha: string; objectType: string; peeledSha?: string; peeledType?: string; commitSha?: string; subject: string }
export interface GitTagItem { name: string; local?: GitTagLocalInfo; targets: Array<{ objectSha: string | null; peeledSha?: string }> }
export interface GitTagQuery { remote?: string; search?: string; offset?: number; limit?: number; expectedFingerprint?: string }
export interface GitTagPage { items: GitTagItem[]; total: number; nextOffset: number | null; fingerprint: string; remote?: string; destinations: string[]; pushFingerprint?: string }
export interface GitTagTarget { sha: string; subject: string }
export interface DeleteRemoteTagInput { remote: string; tagName: string; expectedRemotePushFingerprint: string; expectedTargets: Array<string | null> }
type Result = { stdout: string; stderr: string };
type Run = (args: string[], input?: string, env?: NodeJS.ProcessEnv) => Promise<Result>;
type Runtime = { env: NodeJS.ProcessEnv; signal?: AbortSignal; redact: (text: string) => string; pushTarget: (remote: string) => Promise<{ urls: string[]; fingerprint: string }> };
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const hasControl = (value: string) => Array.from(value).some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
const fail = (code: string, message: string, details?: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_TAG_${code}`, operationStatus: 'failed_before_write', operationStage: 'preflight', ...(details ? { details } : {}) });
function tagName(name: string) { if (typeof name !== 'string' || !name || name.length > 4096 || name.includes(' ') || hasControl(name)) throw fail('INVALID', '标签名称无效，请重新输入。'); return name; }
export async function assertGitTagRef(name: string, run: Run) {
  tagName(name);
  try { await run(['check-ref-format', `refs/tags/${name}`]); }
  catch (error) { const candidate = error as { exitCode?: number; interrupted?: boolean }; if (candidate.interrupted || ![1, 128].includes(candidate.exitCode ?? 0)) throw error; throw fail('INVALID', '标签名称不符合 Git 引用规则，请重新输入。'); }
}
export async function localGitTags(run: Run): Promise<Map<string, GitTagLocalInfo>> {
  const text = (await run(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(contents:subject)%00', 'refs/tags'])).stdout;
  const fields = text.split('\0'); const tags = new Map<string, GitTagLocalInfo>();
  for (let index = 0; index < fields.length - 1; index += 6) {
    const [ref, object, type, peeled, peeledType, subject] = fields.slice(index, index + 6);
    const full = ref?.replace(/^\n+/u, '') ?? ''; if (!full.startsWith('refs/tags/') || !sha.test(object ?? '') || !type || subject === undefined) throw fail('LIST_INVALID', '无法完整读取本地标签。');
    const name = tagName(full.slice(10)); let commitSha = type === 'commit' ? object : peeledType === 'commit' ? peeled : undefined;
    if (peeledType === 'tag') {
      try { const result = await run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${full}^{commit}`]); if (sha.test(result.stdout.trim())) commitSha = result.stdout.trim(); }
      catch (error) { if ((error as { exitCode?: number; code?: unknown }).exitCode !== 1 && (error as { code?: unknown }).code !== 1) throw error; }
    }
    tags.set(name, { objectSha: object!, objectType: type, ...(peeled ? { peeledSha: peeled, peeledType } : {}), ...(commitSha ? { commitSha } : {}), subject });
  }
  return tags;
}
function remoteTags(text: string) {
  const tags = new Map<string, { objectSha: string | null; peeledSha?: string }>();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const separator = line.indexOf('\t'); const object = line.slice(0, separator); const ref = line.slice(separator + 1);
    if (separator < 0 || !sha.test(object) || !ref.startsWith('refs/tags/')) throw fail('LIST_INVALID', '远程返回了无效标签信息。');
    const peeled = ref.endsWith('^{}'); const name = tagName(ref.slice(10, peeled ? -3 : undefined)); const value = tags.get(name) ?? { objectSha: null };
    if (peeled) value.peeledSha = object; else value.objectSha = object; tags.set(name, value);
  }
  if ([...tags.values()].some(value => !value.objectSha)) throw fail('LIST_INVALID', '远程未返回完整标签对象版本。');
  return tags;
}
export async function readGitTagPage(cwd: string, query: GitTagQuery, run: Run, runtime: Runtime): Promise<GitTagPage> {
  const offset = query.offset ?? 0; const limit = query.limit ?? 100;
  if ((query.remote !== undefined && (typeof query.remote !== 'string' || !query.remote || query.remote.startsWith('-') || hasControl(query.remote))) || (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 4096)) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || (query.expectedFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(query.expectedFingerprint)) || (offset > 0 && !query.expectedFingerprint)) throw fail('QUERY_INVALID', '标签查询参数无效，请重新载入。');
  const local = await localGitTags(run); const destinations: string[] = []; let pushFingerprint: string | undefined; const all = new Map<string, GitTagItem>();
  if (query.remote) {
    const push = await runtime.pushTarget(query.remote); pushFingerprint = push.fingerprint; destinations.push(...push.urls.map(runtime.redact));
    if (!push.urls.length) throw fail('REMOTE_REQUIRED', '该远程没有推送地址，请先核对仓库设置。');
    for (let index = 0; index < push.urls.length; index++) {
      runtime.signal?.throwIfAborted(); const endpoint = await gitRemoteEndpoint(query.remote, push.urls[index]!, run, runtime.env);
      const rows = remoteTags((await run(['ls-remote', '--tags', '--', endpoint.name], undefined, endpoint.env)).stdout);
      for (const [name, version] of rows) { const item = all.get(name) ?? { name, ...(local.has(name) ? { local: local.get(name)! } : {}), targets: push.urls.map(() => ({ objectSha: null })) }; item.targets[index] = version; all.set(name, item); }
    }
    if ((await runtime.pushTarget(query.remote)).fingerprint !== push.fingerprint) throw fail('LIST_CHANGED', '读取期间远程推送地址已变化，请重新载入。');
  } else for (const [name, metadata] of local) all.set(name, { name, local: metadata, targets: [] });
  const search = query.search?.trim().toLocaleLowerCase() ?? '';
  const items = [...all.values()].sort((a, b) => a.name.localeCompare(b.name)).filter(item => `${item.name} ${item.local?.objectSha ?? ''} ${item.local?.subject ?? ''} ${item.targets.map(target => target.objectSha ?? '').join(' ')}`.toLocaleLowerCase().includes(search));
  const fingerprint = createHash('sha256').update(JSON.stringify([await realpath(cwd), query.remote ?? null, pushFingerprint, search, items])).digest('hex');
  if (query.expectedFingerprint && query.expectedFingerprint !== fingerprint) throw fail('LIST_CHANGED', '标签版本、地址或筛选范围已变化，请从第一页重新载入。');
  return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null, fingerprint, ...(query.remote ? { remote: query.remote } : {}), destinations, ...(pushFingerprint ? { pushFingerprint } : {}) };
}

export async function deleteGitRemoteTag(input: DeleteRemoteTagInput, run: Run, runtime: Runtime): Promise<Result> {
  const name = tagName(input.tagName); await assertGitTagRef(name, run); const push = await runtime.pushTarget(input.remote);
  if (!push.urls.length || !input.expectedRemotePushFingerprint || input.expectedRemotePushFingerprint !== push.fingerprint) throw fail('REMOTE_CHANGED', '推送地址已变化，本次未删除标签，请重新核对。');
  if (!Array.isArray(input.expectedTargets) || input.expectedTargets.length !== push.urls.length || input.expectedTargets.some(value => value !== null && (typeof value !== 'string' || !sha.test(value))) || !input.expectedTargets.some(Boolean)) throw fail('REVIEW_REQUIRED', '请先读取远程标签，核对每个目标上的对象版本。');
  let completed = 0; const stdout: string[] = []; const stderr: string[] = [];
  for (let index = 0; index < push.urls.length; index++) {
    const expected = input.expectedTargets[index]; if (!expected) continue;
    let attempted = false;
    try {
      const endpoint = await gitRemoteEndpoint(input.remote, push.urls[index]!, run, runtime.env);
      attempted = true;
      const output = await run(['push', '--no-follow-tags', `--force-with-lease=refs/tags/${name}:${expected}`, '--', endpoint.name, `:refs/tags/${name}`], undefined, endpoint.env); completed++; stdout.push(output.stdout); stderr.push(output.stderr);
    } catch (error) {
      const candidate = error as { interrupted?: boolean; stderr?: string; details?: string };
      const targets = push.urls.map((url, target) => `${target + 1}. ${url}\n${input.expectedTargets[target] === null ? 'Skipped: absent in reviewed state' : target < index ? 'Deleted reviewed tag object' : target === index ? 'Failed or unconfirmed; reload this destination' : 'Not attempted'}\n${input.expectedTargets[target] ?? ''}`).join('\n');
      const details = runtime.redact(`completed=${completed}\ntarget=${index + 1}\n${targets}\n${candidate.details ?? candidate.stderr ?? String(error)}`);
      if (!completed && !attempted) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { operationStatus: 'failed_before_write', operationStage: 'preflight' });
      if (!completed && !candidate.interrupted && /\[rejected\][^\n]*\(stale info\)/u.test(candidate.stderr ?? '')) throw fail('REMOTE_VERSION_CHANGED', '服务器上的标签对象已变化，删除被拒绝，请重新读取后核对。', details);
      if (!completed && !candidate.interrupted && /\[remote rejected\]/u.test(candidate.stderr ?? '')) throw fail('REMOTE_REJECTED', '服务器拒绝删除此标签，请查看标签保护或服务端检查。', details);
      throw Object.assign(fail('REMOTE_OUTCOME_UNKNOWN', '未能确认全部目标的标签删除结果，请逐一重新读取服务器，不要直接重复删除。', details), { operationStatus: 'unknown_after_write', operationStage: 'command' });
    }
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
