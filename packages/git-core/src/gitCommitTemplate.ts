import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readRepositorySettings } from './gitRepositorySettings.js';

const maximumBytes = 128 * 1024;
const maximumCharacters = 30_000;
type Run = (args: string[], input?: string) => Promise<{ stdout: string; stderr: string }>;
type TemplateProblem = 'ASTRAGIT_GIT_TEMPLATE_READ_FAILED' | 'ASTRAGIT_GIT_TEMPLATE_TOO_LARGE' | 'ASTRAGIT_GIT_TEMPLATE_INVALID';
export interface GitCommitTemplate {
  fingerprint: string;
  path: string | null;
  localPath: string | null;
  resolvedPath: string | null;
  source: 'none' | 'local' | 'inherited';
  content: string;
  /** Git removes instruction comments before this text is used as a draft. */
  message: string;
  problem: TemplateProblem | null;
}
export type GitCommitTemplateChange = {
  type: 'configure_commit_template';
  operation: 'inherit' | 'file' | 'content';
  value?: string;
  expectedFingerprint: string;
};
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const failure = (code: string, message: string) => Object.assign(new Error(message), { code, operationStatus: 'failed_before_write' });

function validateContent(value: string): void {
  if (value.includes('\0') || Buffer.from(value).toString('utf8') !== value) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板必须是不含空字节的 UTF-8 文本。');
  if (value.length > maximumCharacters || Buffer.byteLength(value) > maximumBytes) throw failure('ASTRAGIT_GIT_TEMPLATE_TOO_LARGE', '提交模板不能超过 30000 个字符或 128 KiB。');
}

/** A configured path can be outside the worktree, but must resolve to a bounded regular text file. */
async function readTemplateFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板路径不是普通文件。');
    if (before.size > maximumBytes) throw failure('ASTRAGIT_GIT_TEMPLATE_TOO_LARGE', '提交模板不能超过 30000 个字符或 128 KiB。');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure('ASTRAGIT_GIT_TEMPLATE_READ_FAILED', '提交模板在读取期间发生变化，请重新载入。');
    if (length > maximumBytes) throw failure('ASTRAGIT_GIT_TEMPLATE_TOO_LARGE', '提交模板不能超过 30000 个字符或 128 KiB。');
    const bytes = buffer.subarray(0, length);
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板必须是有效的 UTF-8 文本。'); }
    validateContent(content);
    return { content, identity: [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs, hash(bytes)] };
  } finally { await handle.close(); }
}

/** Read the effective Git configuration, retaining the complete template for settings preview. */
export async function readCommitTemplate(cwd: string, run: Run, redact: (text: string) => string): Promise<GitCommitTemplate> {
  const settings = await readRepositorySettings(run, redact);
  const { path, localPath } = settings.commitTemplate;
  const source = path === null ? 'none' : localPath === path ? 'local' : 'inherited';
  let resolvedPath: string | null = null;
  let content = ''; let message = ''; let problem: TemplateProblem | null = null;
  let identity: unknown = null;
  if (path !== null) {
    try {
      if (!path || path.includes('\0')) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板路径无效。');
      // Git expands ~/ and %(prefix) paths itself; relative paths follow the repository root.
      const expanded = (await run(['config', '--includes', '--path', '--get', 'commit.template'])).stdout.replace(/\n$/u, '');
      resolvedPath = resolve(cwd, expanded);
      const file = await readTemplateFile(resolvedPath);
      content = file.content; identity = file.identity;
      message = (await run(['stripspace', '--strip-comments'], content)).stdout;
    } catch (reason) {
      const code = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : '';
      problem = code === 'ASTRAGIT_GIT_TEMPLATE_INVALID' || code === 'ASTRAGIT_GIT_TEMPLATE_TOO_LARGE' ? code : 'ASTRAGIT_GIT_TEMPLATE_READ_FAILED';
      content = ''; message = ''; identity = [problem, code];
    }
  }
  return { fingerprint: hash(JSON.stringify([settings.fingerprint, path, localPath, resolvedPath, identity])), path, localPath, resolvedPath, source, content, message, problem };
}

export function parseGitCommitTemplateChange(value: unknown): GitCommitTemplateChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板设置无效。');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['type', 'operation', 'value', 'expectedFingerprint'].includes(key)) || input.type !== 'configure_commit_template' || !['inherit', 'file', 'content'].includes(String(input.operation)) || typeof input.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板设置无效，请重新载入。');
  if (input.operation === 'inherit') {
    if (input.value !== undefined) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '恢复继承不接受模板内容或路径。');
    return { type: input.type, operation: 'inherit', expectedFingerprint: input.expectedFingerprint };
  }
  if (typeof input.value !== 'string') throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '请填写模板文件路径或内容。');
  if (input.operation === 'content') validateContent(input.value);
  else if (!input.value || input.value.includes('\0') || input.value.length > 16_384) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '提交模板路径无效。');
  return { type: input.type, operation: input.operation as 'file' | 'content', value: input.value, expectedFingerprint: input.expectedFingerprint };
}

/** Save immutable app-owned files; existing user/global template files are never overwritten. */
async function saveManagedTemplate(cwd: string, run: Run, content: string): Promise<string> {
  const common = (await run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.replace(/\n$/u, '');
  const directory = resolve(cwd, common, 'astragit-commit-templates');
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (reason) { if (!reason || typeof reason !== 'object' || !('code' in reason) || reason.code !== 'EEXIST') throw reason; }
  const folder = await lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '应用模板目录不是独立普通目录，未更改配置。');
  const destination = resolve(directory, `${hash(content)}.txt`);
  try { await writeFile(destination, content, { flag: 'wx', mode: 0o600 }); }
  catch (reason) {
    if (!reason || typeof reason !== 'object' || !('code' in reason) || reason.code !== 'EEXIST') throw reason;
    const file = await lstat(destination);
    if (!file.isFile() || file.isSymbolicLink() || (await readTemplateFile(destination)).content !== content) throw failure('ASTRAGIT_GIT_TEMPLATE_INVALID', '应用模板文件已被外部改变，未更改配置。');
  }
  return destination;
}

export async function configureCommitTemplate(cwd: string, run: Run, redact: (text: string) => string, value: GitCommitTemplateChange) {
  const change = parseGitCommitTemplateChange(value);
  const before = await readCommitTemplate(cwd, run, redact);
  if (before.fingerprint !== change.expectedFingerprint) throw failure('ASTRAGIT_GIT_TEMPLATE_STALE', '模板文件或仓库配置已变化，未更改设置。请重新载入核对。');
  if (change.operation === 'inherit') return before.localPath === null ? { stdout: '', stderr: '' } : run(['config', '--local', '--unset-all', '--', 'commit.template']);
  let path = change.value!;
  if (change.operation === 'content') path = await saveManagedTemplate(cwd, run, change.value!);
  else {
    // Validate the chosen file before making it the local default. Preserve tilde expansion in Git.
    const expanded = (await run(['-c', `commit.template=${path}`, 'config', '--path', '--get', 'commit.template'])).stdout.replace(/\n$/u, '');
    const target = resolve(cwd, expanded);
    try { await readTemplateFile(target); }
    catch (reason) { if (reason && typeof reason === 'object' && 'operationStatus' in reason) throw reason; throw failure('ASTRAGIT_GIT_TEMPLATE_READ_FAILED', '无法读取所选模板文件，未更改设置。'); }
  }
  if ((await readCommitTemplate(cwd, run, redact)).fingerprint !== before.fingerprint) throw failure('ASTRAGIT_GIT_TEMPLATE_STALE', '模板文件或仓库配置已变化，未更改设置。请重新载入核对。');
  return run(['config', '--local', '--replace-all', '--', 'commit.template', path]);
}
