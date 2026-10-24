import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type GitFileIntent = 'open' | 'reveal' | 'edit-ignore-rule';
export interface GitFileLocation { path: string; isDirectory: boolean; missingFile: boolean }
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const inside = (root: string, path: string) => { const value = relative(root, path); return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value); };
async function inspect(path: string) {
  try { return await lstat(path); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null; throw error; }
}
async function directory(path: string) { try { return (await stat(path)).isDirectory(); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; } }

/** Select only known Git entries; revealing a deletion falls back to its existing parent. */
export async function resolveGitFileLocation(root: string, path: string, intent: GitFileIntent, knownPaths: string[]): Promise<GitFileLocation> {
  if (intent !== 'open' && intent !== 'reveal') throw failure('ASTRAGIT_GIT_FILE_ACTION_INVALID', '文件操作无效。');
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\0') || (path && path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw failure('ASTRAGIT_GIT_PATH_INVALID', '请选择仓库内的有效文件路径。');
  const canonicalRoot = await realpath(root);
  const normalized = knownPaths.map(value => value.replace(/\/$/u, ''));
  if (path && !normalized.some(value => value === path || value.startsWith(`${path}/`))) throw failure('ASTRAGIT_GIT_FILE_NOT_FOUND', '该路径已不在仓库文件列表中，请刷新后重新选择。');
  const absolute = path ? join(canonicalRoot, path) : canonicalRoot;
  let parent = path ? dirname(absolute) : canonicalRoot;
  while (parent !== canonicalRoot && !(await directory(parent))) parent = dirname(parent);
  if (!inside(canonicalRoot, resolve(absolute)) || !inside(canonicalRoot, await realpath(parent))) throw failure('ASTRAGIT_GIT_PATH_INVALID', '文件所在目录指向所选仓库以外，无法从此入口操作。');
  const entry = await inspect(absolute);
  if (entry) return { path: absolute, isDirectory: entry.isDirectory(), missingFile: false };
  if (intent === 'open') throw failure('ASTRAGIT_GIT_FILE_MISSING', '文件已不存在，无法打开；可在 Finder 中定位其所在目录。');
  return { path: parent, isDirectory: true, missingFile: true };
}
