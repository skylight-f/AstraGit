import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export type GitIgnoreScope = 'repository' | 'local' | 'global';
export interface GitIgnoreInput { scope: GitIgnoreScope; patterns: string[] }
export interface GitIgnorePreview { scope: GitIgnoreScope; filePath: string; configuredPath: string; exists: boolean; fingerprint: string }
type Run = (args: string[]) => Promise<{ stdout: string; stderr: string }>;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write' });
const unconfirmed = (error: unknown) => Object.assign(new Error('忽略规则保存未确认，请检查规则文件后再操作。', { cause: error }), { code: 'ASTRAGIT_GIT_IGNORE_OUTCOME_UNKNOWN', operationStatus: 'unknown_after_write', operationStage: 'command', details: error instanceof Error ? error.message : String(error) });
const unline = (value: string) => value.replace(/\r?\n$/u, '');
async function inspect(path: string) { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
function validate(input: GitIgnoreInput) {
  if (!input || !['repository', 'local', 'global'].includes(input.scope) || !Array.isArray(input.patterns) || !input.patterns.length || input.patterns.length > 200 || input.patterns.some(value => typeof value !== 'string' || !value || /[\0\r\n]/u.test(value)) || Buffer.byteLength(input.patterns.join('\n')) > 64 * 1024) throw failure('ASTRAGIT_GIT_IGNORE_INVALID', '忽略规则无效。每行一条规则，不可包含换行或 NUL，最多 200 条、64 KiB。');
}
async function canonicalMissing(path: string): Promise<string> {
  const parts: string[] = []; let parent = path;
  while (!(await inspect(parent))) { parts.unshift(basename(parent)); parent = dirname(parent); }
  return join(await realpath(parent), ...parts);
}
async function state(cwd: string, scope: GitIgnoreScope, run: Run, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  if (!['repository', 'local', 'global'].includes(scope)) throw failure('ASTRAGIT_GIT_IGNORE_INVALID', '忽略范围无效。');
  signal?.throwIfAborted();
  let configuredPath: string;
  if (scope === 'repository') configuredPath = join(cwd, '.gitignore');
  else if (scope === 'local') configuredPath = resolve(cwd, unline((await run(['rev-parse', '--git-path', 'info/exclude'])).stdout));
  else {
    let configured = '';
    try { configured = unline((await run(['config', '--global', '--includes', '--path', '--get', 'core.excludesfile'])).stdout); }
    catch (error) { if ((error as { exitCode?: number }).exitCode !== 1) throw error; }
    configuredPath = configured ? (isAbsolute(configured) ? configured : resolve(cwd, configured)) : resolve(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'git/ignore');
  }
  const links: Array<[string, string]> = []; let filePath = configuredPath;
  for (let index = 0; ; index += 1) {
    if (index > 40) throw failure('ASTRAGIT_GIT_IGNORE_FILE_INVALID', '忽略文件的链接层级异常，请检查配置路径。');
    const info = await inspect(filePath);
    if (!info?.isSymbolicLink()) break;
    if (scope === 'repository') throw failure('ASTRAGIT_GIT_IGNORE_FILE_INVALID', '.gitignore 是符号链接，Git 不会正常读取此规则文件，请先调整该路径。');
    const link = await readlink(filePath); links.push([filePath, link]); filePath = resolve(dirname(filePath), link);
  }
  filePath = await canonicalMissing(filePath);
  const info = await inspect(filePath);
  if (info && !info.isFile()) throw failure('ASTRAGIT_GIT_IGNORE_FILE_INVALID', '忽略规则目标不是普通文件，请检查路径。');
  const content = info ? await readFile(filePath, { signal }) : Buffer.alloc(0);
  const identity = info ? `${info.dev}:${info.ino}:${info.mode}` : null;
  const fingerprint = createHash('sha256').update(JSON.stringify([scope, configuredPath, filePath, links, identity])).update(content).digest('hex');
  signal?.throwIfAborted();
  return { preview: { scope, configuredPath, filePath, exists: Boolean(info), fingerprint }, content, info };
}

export async function readGitIgnorePreview(cwd: string, scope: GitIgnoreScope, run: Run, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<GitIgnorePreview> {
  return (await state(cwd, scope, run, env, signal)).preview;
}

/** Append the requested rules without rewriting any pre-existing bytes or staging files. */
export async function appendGitIgnore(cwd: string, input: GitIgnoreInput & { expectedFingerprint: string }, run: Run, env: NodeJS.ProcessEnv, onWrite: (path: string) => Promise<void>, signal?: AbortSignal) {
  validate(input);
  let current: Awaited<ReturnType<typeof state>>;
  try { current = await state(cwd, input.scope, run, env, signal); }
  catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { operationStatus: 'failed_before_write', operationStage: 'preflight' }); }
  if (!input.expectedFingerprint || current.preview.fingerprint !== input.expectedFingerprint) throw failure('ASTRAGIT_GIT_IGNORE_CHANGED', '忽略文件、配置路径或规则已变化，未追加规则。请重新载入并核对。');
  const old = current.content;
  const newline = old.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const separator = old.length === 0 || old.at(-1) === 10 ? '' : old.at(-1) === 13 ? '\n' : newline;
  const addition = Buffer.from(separator + input.patterns.join(newline) + newline);
  signal?.throwIfAborted(); await onWrite(current.preview.filePath);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let writeError: Error | undefined;
  try {
    await mkdir(dirname(current.preview.filePath), { recursive: true }); signal?.throwIfAborted();
    handle = await open(current.preview.filePath, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | (current.info ? 0 : constants.O_CREAT | constants.O_EXCL), input.scope === 'repository' ? 0o644 : 0o600);
    const opened = await handle.stat();
    if ((current.info && (opened.dev !== current.info.dev || opened.ino !== current.info.ino)) || !opened.isFile() || !(await handle.readFile()).equals(old)) throw failure('ASTRAGIT_GIT_IGNORE_CHANGED', '规则文件在保存前发生变化，请重新载入。');
    signal?.throwIfAborted();
    const written = await handle.write(addition);
    if (written.bytesWritten !== addition.length) throw new Error('Only part of the ignore rules was written.');
    await handle.sync();
    const after = await handle.stat(); const target = await inspect(current.preview.filePath);
    if (!target?.isFile() || target.dev !== after.dev || target.ino !== after.ino || after.size !== old.length + addition.length) throw new Error('The ignore file changed during append.');
    const contents = Buffer.alloc(after.size); let offset = 0;
    while (offset < contents.length) { const result = await handle.read(contents, offset, contents.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    if (offset !== contents.length || !contents.equals(Buffer.concat([old, addition]))) throw new Error('The appended ignore contents could not be confirmed.');
    signal?.throwIfAborted();
  } catch (error) {
    writeError = unconfirmed(error);
  } finally { try { await handle?.close(); } catch (error) { writeError ??= unconfirmed(error); } }
  if (writeError) throw writeError;
  return { stdout: `Appended ${input.patterns.length} ignore rules to ${current.preview.filePath}\n`, stderr: '' };
}
