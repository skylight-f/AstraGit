import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { Writable } from 'node:stream';
import { parseGitArchiveInput, type GitArchiveInput, type GitArchivePreview, type GitArchiveResult } from '@astragit/git-core';
import { userFacingErrorCause } from '@astragit/shared';

interface Request { id: string; projectId: string; repositoryId: string; input: GitArchiveInput }
const failure = (code: string, message: string) => Object.assign(new Error(message), { code: `ASTRAGIT_GIT_ARCHIVE_${code}` });
function requestFrom(value: unknown): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('INVALID', '源码存档请求无效。');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['id', 'projectId', 'repositoryId', 'input'].includes(key)) || typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(record.id) || [record.projectId, record.repositoryId].some(id => typeof id !== 'string' || !id || id.length > 512 || id.includes('\0'))) throw failure('INVALID', '源码存档请求身份无效。');
  const input = parseGitArchiveInput(record.input);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input.revision)) throw failure('INVALID', '请先核对源码存档的固定提交版本。');
  return { id: record.id, projectId: record.projectId as string, repositoryId: record.repositoryId as string, input };
}

/** The renderer supplies a reviewed revision, never bytes or an output pathname. */
export function createArchiveFileAccess(options: {
  chooseSave: (name: string, format: GitArchiveInput['format']) => Promise<string | null>;
  preview: (request: Request, signal: AbortSignal) => Promise<GitArchivePreview>;
  generate: (request: Request, output: Writable, signal: AbortSignal) => Promise<GitArchiveResult>;
}) {
  let active: { id: string; controller: AbortController; work?: Promise<unknown> } | null = null;
  let closed = false;
  return {
    isBusy: () => active !== null,
    cancel: (id: unknown) => { if (typeof id !== 'string' || active?.id !== id) return false; active.controller.abort(); return true; },
    close: async () => { closed = true; const job = active; job?.controller.abort(); await job?.work?.catch(() => undefined); },
    save: async (value: unknown) => {
      let job: NonNullable<typeof active> | undefined;
      try {
        const request = requestFrom(value);
        if (closed) throw failure('NOT_AVAILABLE', '应用正在退出，源码存档尚未开始。');
        if (active) throw failure('BUSY', '已有源码存档正在导出，请等待完成或取消。');
        job = { id: request.id, controller: new AbortController() }; active = job;
        const { signal } = job.controller;
        const metadata = options.preview(request, signal); job.work = metadata;
        const preview = await metadata; job.work = undefined; signal.throwIfAborted();
        const path = await options.chooseSave(preview.suggestedName, preview.format);
        if (!path || signal.aborted || closed) return { ok: true as const, canceled: true as const };
        if (!isAbsolute(path)) throw failure('FILE_INVALID', '请选择有效的源码存档保存位置。');
        job.work = (async () => {
          const temporary = join(dirname(path), `.astragit-archive-${randomUUID()}.tmp`);
          const file = await open(temporary, 'wx', 0o600); let writing = Promise.resolve();
          const output = new Writable({
            highWaterMark: 1024 * 1024,
            write(chunk: Buffer, _encoding, callback) { writing = file.writeFile(chunk); void writing.then(() => callback(), error => callback(error)); },
            destroy(error, callback) { void writing.then(() => callback(error), reason => callback(error ?? reason)); },
          });
          output.on('error', () => { /* Generation reports this through its rejected promise. */ });
          try {
            const result = await options.generate(request, output, signal);
            signal.throwIfAborted(); await file.sync(); await file.close(); signal.throwIfAborted();
            await rename(temporary, path);
            return { ok: true as const, canceled: false as const, name: basename(path), ...result };
          } finally { output.destroy(); await writing.catch(() => undefined); await file.close().catch(() => undefined); await rm(temporary, { force: true }).catch(() => undefined); }
        })();
        return await job.work as { ok: true; canceled: false; name: string } & GitArchiveResult;
      } catch (error) {
        if (job?.controller.signal.aborted) return { ok: true as const, canceled: true as const };
        const code = (error as { code?: string })?.code;
        const cause = typeof code === 'string' && code.startsWith('ASTRAGIT_') ? error : Object.assign(failure('SAVE_FAILED', '源码存档未能完成保存，请检查目标位置。'), { cause: error });
        return { ok: false as const, error: userFacingErrorCause(cause) };
      } finally { if (active === job) active = null; }
    },
  };
}
