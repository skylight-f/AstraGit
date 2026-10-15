import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/** Invalid/unreadable local data must never be treated as an empty store. */
export function readLocalJson(filePath: string): unknown {
  let text: string;
  try { text = readFileSync(filePath, 'utf8'); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw localDataError(filePath, '读取');
  }
  try { return JSON.parse(text); } catch { throw localDataError(filePath, '解析'); }
}

export function localDataError(filePath: string, operation: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(`${basename(filePath)} ${operation}失败，请检查本应用数据文件：${filePath}`), {
    code: operation === '保存' ? 'ASTRAGIT_LOCAL_DATA_WRITE_FAILED' : 'ASTRAGIT_LOCAL_DATA_READ_FAILED', statusCode: 503,
  });
}

/** Publish a complete 0600 file only after its contents have been flushed. */
export function writeLocalJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, filePath);
  } catch { throw localDataError(filePath, '保存'); }
  finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
