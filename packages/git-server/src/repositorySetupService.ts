import { createHash } from 'node:crypto';
import { dirname, basename, isAbsolute, join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { redactGitOutput, setupGitRepository } from '@astragit/git-core';
import type { RepositorySetupInput, RepositorySetupJob } from '@astragit/shared';
import { localDataError, readLocalJson, writeLocalJson } from './localJsonFile.js';
import { ProjectStore, projectError } from './projectStore.js';

type StoredJob = RepositorySetupJob & { fingerprint: string };
const statuses = new Set(['running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted']);
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id);

/** A retry identifies the same durable job; it never starts Git a second time. */
export class RepositorySetupService {
  private readonly file: string;
  private jobs: StoredJob[];
  private readonly tasks = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly destinations = new Set<string>();
  private closing = false;

  constructor(dataDirectory: string, private readonly projects: ProjectStore) {
    this.file = join(dataDirectory, 'repository-setup-jobs.json');
    const stored = readLocalJson(this.file);
    if (stored !== undefined && (!Array.isArray(stored) || !stored.every(isStoredJob))) throw localDataError(this.file, '校验');
    this.jobs = (stored as StoredJob[] | undefined) ?? [];
    let recovered = false;
    this.jobs = this.jobs.map(job => {
      if (job.status !== 'running' && job.status !== 'cancelling') return job;
      recovered = true;
      return { ...job, status: 'interrupted', finishedAt: new Date().toISOString(), error: { code: 'ASTRAGIT_REPOSITORY_SETUP_INTERRUPTED', message: '上次创建仓库的最终状态未确认，请检查目标目录与 Git 进程。不会自动重新执行。' } };
    });
    if (recovered) writeLocalJson(this.file, this.jobs);
  }

  list(): RepositorySetupJob[] { return this.jobs.slice(0, 100).map(publicJob); }
  isBusy(): boolean { return this.tasks.size > 0; }
  get(id: string): RepositorySetupJob {
    const job = this.jobs.find(job => job.id === id);
    if (!job) throw Object.assign(projectError('ASTRAGIT_REPOSITORY_SETUP_NOT_FOUND', '找不到创建仓库的任务，请检查目标目录。'), { statusCode: 404 });
    return publicJob(job);
  }

  start(value: unknown): RepositorySetupJob {
    if (this.closing) throw projectError('ASTRAGIT_BUSY', '应用正在关闭，无法创建仓库。');
    const input = parseInput(value);
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.jobs.find(job => job.id === input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw projectError('ASTRAGIT_REPOSITORY_SETUP_CONFLICT', '同一任务标识不能用于不同的创建参数。');
      return this.get(previous.id);
    }
    if (this.tasks.size >= 4) throw projectError('ASTRAGIT_BUSY', '已有多个仓库正在创建，请等待或取消后再试。');
    const job: StoredJob = { id: input.requestId, kind: input.kind, localPath: input.localPath, status: 'running', startedAt: new Date().toISOString(), output: '', fingerprint };
    const active = this.jobs.filter(job => job.status === 'running' || job.status === 'cancelling');
    const terminal = this.jobs.filter(job => job.status !== 'running' && job.status !== 'cancelling');
    // Bound detailed logs, not idempotency identities. An old delayed request must
    // still resolve to its original result after it disappears from recent history.
    const next = [job, ...active, ...terminal].map((entry, index) => index < 100 ? entry : {
      ...entry, output: '', ...(entry.error ? { error: { code: entry.error.code, message: entry.error.message } } : {}),
    });
    writeLocalJson(this.file, next); // No filesystem mutation before the job identity is durable.
    this.jobs = next;
    const controller = new AbortController();
    const promise = this.run(input, controller.signal);
    this.tasks.set(job.id, { controller, promise });
    void promise.then(() => this.tasks.delete(job.id), () => {
      this.tasks.delete(job.id);
      Object.assign(this.jobs.find(item => item.id === job.id)!, { status: 'interrupted', error: { code: 'ASTRAGIT_LOCAL_DATA_WRITE_FAILED', message: '保存任务结果失败，请检查目标目录后再操作。' } });
    });
    return this.get(job.id);
  }

  cancel(id: string): RepositorySetupJob {
    const job = this.get(id);
    const task = this.tasks.get(id);
    if (task) {
      this.update(id, { status: 'cancelling' });
      task.controller.abort();
    }
    return task ? this.get(id) : job;
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await Promise.allSettled([...this.tasks.values()].map(task => task.promise));
  }

  private update(id: string, patch: Partial<RepositorySetupJob>): void {
    const next = this.jobs.map(job => job.id === id ? { ...job, ...patch } : job);
    writeLocalJson(this.file, next);
    this.jobs = next;
  }

  private async run(input: RepositorySetupInput, signal: AbortSignal): Promise<void> {
    let destination: string | undefined;
    let locked = false;
    try {
      destination = await canonicalDestination(input.localPath);
      signal.throwIfAborted();
      if (this.destinations.has(destination)) throw projectError('ASTRAGIT_BUSY', '这个目录已有创建任务正在执行。');
      this.destinations.add(destination); locked = true;
      const path = await setupGitRepository(input, signal, text => {
        const job = this.jobs.find(job => job.id === input.requestId)!;
        job.output = redactGitOutput(job.output + text).slice(-65_536);
      });
      signal.throwIfAborted();
      const project = this.projects.create({ name: input.name ?? '', localPath: path });
      this.update(input.requestId, { status: 'completed', localPath: path, projectId: project.id, finishedAt: new Date().toISOString() });
    } catch (error) {
      const value = error as { code?: unknown; details?: unknown };
      this.update(input.requestId, {
        status: signal.aborted ? 'cancelled' : 'failed', finishedAt: new Date().toISOString(),
        error: { code: signal.aborted ? 'ASTRAGIT_REPOSITORY_SETUP_CANCELLED' : typeof value?.code === 'string' ? value.code : 'ASTRAGIT_REPOSITORY_SETUP_FAILED', message: signal.aborted ? '任务已停止，请检查目标目录。已生成的内容不会由应用自动删除。' : redactGitOutput(error instanceof Error ? error.message : String(error)), ...(typeof value?.details === 'string' ? { details: redactGitOutput(value.details).slice(-65_536) } : {}) },
      });
    } finally { if (locked && destination) this.destinations.delete(destination); }
  }
}

function publicJob({ fingerprint: _fingerprint, ...job }: StoredJob): RepositorySetupJob { return structuredClone(job); }

function parseInput(value: unknown): RepositorySetupInput {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (!validId(input.requestId) || (input.kind !== 'clone' && input.kind !== 'init') || typeof input.localPath !== 'string' || !isAbsolute(input.localPath) || input.localPath.includes('\0')) throw projectError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '创建参数无效，请检查任务和目标目录。');
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length > 120)) throw projectError('ASTRAGIT_PROJECT_NAME_INVALID', '项目名称过长或无效。');
  for (const field of ['source', 'branch']) if (input[field] !== undefined && typeof input[field] !== 'string') throw projectError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '仓库地址和分支必须为文字。');
  if ((input.recursive !== undefined && typeof input.recursive !== 'boolean') || (input.depth !== undefined && (typeof input.depth !== 'number' || !Number.isSafeInteger(input.depth) || input.depth < 1))) throw projectError('ASTRAGIT_REPOSITORY_SETUP_INVALID', '克隆选项无效。');
  return { requestId: input.requestId, kind: input.kind, localPath: resolve(input.localPath), name: typeof input.name === 'string' ? input.name.trim() : '', source: typeof input.source === 'string' ? input.source.trim() : '', branch: typeof input.branch === 'string' ? input.branch.trim() : '', recursive: input.recursive === true, ...(typeof input.depth === 'number' ? { depth: input.depth } : {}) };
}

async function canonicalDestination(path: string): Promise<string> {
  const suffix: string[] = [];
  let current = resolve(path);
  for (;;) {
    try { return resolve(await realpath(current), ...suffix.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current); if (parent === current) throw error;
      suffix.push(basename(current)); current = parent;
    }
  }
}

function isStoredJob(value: unknown): value is StoredJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as StoredJob;
  return validId(job.id) && (job.kind === 'clone' || job.kind === 'init') && typeof job.localPath === 'string' && isAbsolute(job.localPath) && statuses.has(job.status) && typeof job.output === 'string' && typeof job.startedAt === 'string' && typeof job.fingerprint === 'string' && (!job.error || (typeof job.error.code === 'string' && typeof job.error.message === 'string'));
}
