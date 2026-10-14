import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProjectGitOperationPage, ProjectGitOperationRecord } from '@astragit/git-core';

interface StoredOperation extends ProjectGitOperationRecord {
  projectId: string;
}

const maximumRecords = 2_000;
const pageSize = 50;
const operationStatuses = new Set<ProjectGitOperationRecord['status']>(['running', 'completed', 'conflict', 'failed_before_write', 'unknown_after_write', 'recorded']);

/** 保存工作台操作的真实状态；进程中断后，未结束的写操作按结果未知展示。 */
export class OperationHistoryStore {
  private readonly filePath: string;
  private records: StoredOperation[];

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'git-operation-history.json');
    this.records = this.read();
    let changed = false;
    this.records = this.records.map((record) => {
      if (record.status !== 'running') return record;
      changed = true;
      return {
        ...record,
        status: record.commands?.length ? 'unknown_after_write' : 'failed_before_write',
        output: record.output || '应用在操作结束前退出，请检查当前仓库状态。',
      };
    });
    if (changed) this.write();
  }

  start(projectId: string, repositoryId: string, repositoryName: string, action: string): StoredOperation {
    const record: StoredOperation = {
      id: `git_operation_${randomUUID()}`,
      projectId,
      repositoryId,
      repositoryName,
      action,
      startedAt: new Date().toISOString(),
      durationMs: null,
      status: 'running',
      output: '',
      commands: [],
      limitations: [],
    };
    this.records.unshift(record);
    this.records = this.records.slice(0, maximumRecords);
    this.write();
    return record;
  }

  update(id: string, change: Partial<ProjectGitOperationRecord>): void {
    const record = this.records.find((item) => item.id === id);
    if (!record) return;
    Object.assign(record, change);
    this.write();
  }

  list(projectId: string, cursor?: string): ProjectGitOperationPage {
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('操作历史分页位置无效。');
    const records = this.records.filter((record) => record.projectId === projectId);
    const items = records.slice(offset, offset + pageSize).map(({ projectId: _projectId, ...record }) => record);
    return { items, total: records.length, nextCursor: offset + pageSize < records.length ? String(offset + pageSize) : null };
  }

  private read(): StoredOperation[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(value)) return [];
      return value.filter((item): item is StoredOperation =>
        typeof item === 'object' && item !== null &&
        typeof item.id === 'string' && typeof item.projectId === 'string' &&
        typeof item.repositoryId === 'string' && typeof item.repositoryName === 'string' &&
        (item.action === null || typeof item.action === 'string') &&
        typeof item.startedAt === 'string' &&
        (item.durationMs === null || (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0)) &&
        operationStatuses.has(item.status) && typeof item.output === 'string' &&
        (item.commands === null || (Array.isArray(item.commands) && item.commands.every((command: unknown) => typeof command === 'string'))) &&
        Array.isArray(item.limitations),
      ).slice(0, maximumRecords);
    } catch {
      return [];
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.records, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.filePath);
  }
}
