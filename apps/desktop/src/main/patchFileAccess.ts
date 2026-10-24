import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { userFacingErrorCause } from '@astragit/shared';

const maximum = 8 * 1024 * 1024;
const fail = (code: string, message: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_PATCH_${code}` });
/** Paths come only from a native file dialog, never a renderer-supplied pathname. */
export function createPatchFileAccess(options: { chooseOpen: () => Promise<string | null>; chooseSave: (name: string) => Promise<string | null> }) {
  return {
    read: async () => {
      try {
        const path = await options.chooseOpen(); if (!path) return { ok: true as const, canceled: true as const };
        const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
          const before = await file.stat(); if (!before.isFile()) throw fail('FILE_INVALID', '请选择普通补丁文件。'); if (before.size > maximum) throw fail('TOO_LARGE', '补丁文件超过 8 MiB，请分批处理。');
          const parts: Buffer[] = []; let size = 0;
          for await (const chunk of file.createReadStream({ autoClose: false })) { size += chunk.length; if (size > maximum) throw fail('TOO_LARGE', '补丁文件超过 8 MiB，请分批处理。'); parts.push(chunk as Buffer); }
          const after = await file.stat(); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw fail('FILE_CHANGED', '读取期间补丁文件已变化，请重新选择。');
          return { ok: true as const, canceled: false as const, name: basename(path), data: Buffer.concat(parts).toString('base64'), byteLength: size };
        } finally { await file.close(); }
      } catch (error) { return { ok: false as const, error: userFacingErrorCause(error) }; }
    },
    save: async (request: unknown) => {
      let temporary: string | undefined;
      try {
        const value = request && typeof request === 'object' ? request as Record<string, unknown> : {};
        if (typeof value.data !== 'string' || value.data.length > maximum * 2 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256) || typeof value.suggestedName !== 'string') throw fail('FILE_INVALID', '补丁保存内容无效，请重新生成。');
        const bytes = Buffer.from(value.data, 'base64');
        if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== value.data || createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw fail('FILE_INVALID', '补丁保存内容或校验值不一致，请重新生成。');
        const name = basename(value.suggestedName).replace(/[\r\n\0]/gu, '').slice(0, 180) || 'astragit.patch';
        const path = await options.chooseSave(name); if (!path) return { ok: true as const, canceled: true as const };
        temporary = join(dirname(path), `.astragit-patch-${randomUUID()}.tmp`);
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await rename(temporary, path); temporary = undefined;
        return { ok: true as const, canceled: false as const, name: basename(path) };
      } catch (error) { return { ok: false as const, error: userFacingErrorCause(error) }; }
      finally { if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
    },
  };
}
