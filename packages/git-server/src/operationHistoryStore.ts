import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ProjectGitOperationPage, ProjectGitOperationRecord } from '@astragit/git-core';
import { localDataError, readLocalJson, writeLocalJson } from './localJsonFile.js';

interface StoredOperation extends ProjectGitOperationRecord {
  projectId: string;
}

const maximumRecords = 2_000;
const pageSize = 50;
const operationStatuses = new Set<ProjectGitOperationRecord['status']>(['running', 'completed', 'conflict', 'failed_before_write', 'unknown_after_write', 'recorded']);

/** 保存工作台操作的真实状态；进程中断后，未结束的写操作按结果未知展示。 */
export class OperationHistoryStore {
  private readonly filePath: string;
  private records: StoredOperation[] | null = null;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'git-operation-history.json');
  }

  private ensureRecords(): StoredOperation[] {
    if (this.records) return this.records;
    let changed = false;
    const records = this.read().map((record): StoredOperation => {
      if (record.status !== 'running') return record;
      changed = true;
      return {
        ...record,
        status: record.commands?.length ? 'unknown_after_write' : 'failed_before_write',
        output: record.output || '应用在操作结束前退出，请检查当前仓库状态。',
      };
    });
    if (changed) this.write(records);
    else this.records = records;
    return records;
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
    this.write([record, ...this.ensureRecords()].slice(0, maximumRecords));
    return record;
  }

  update(id: string, change: Partial<ProjectGitOperationRecord>): void {
    const records = this.ensureRecords();
    const index = records.findIndex((item) => item.id === id);
    const record = records[index];
    if (!record) return;
    this.write(records.map((item) => item.id === id ? { ...item, ...change } : item));
    // Keep the reference returned by start() current only after persistence.
    Object.assign(record, change);
    this.records![index] = record;
  }

  list(projectId: string, cursor?: string): ProjectGitOperationPage {
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('操作历史分页位置无效。');
    const records = this.ensureRecords().filter((record) => record.projectId === projectId);
    const items = records.slice(offset, offset + pageSize).map(({ projectId: _projectId, ...record }) => record);
    return { items, total: records.length, nextCursor: offset + pageSize < records.length ? String(offset + pageSize) : null };
  }

  private read(): StoredOperation[] {
    const value = readLocalJson(this.filePath);
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((item): item is StoredOperation =>
        typeof item === 'object' && item !== null &&
        typeof item.id === 'string' && typeof item.projectId === 'string' &&
        typeof item.repositoryId === 'string' && typeof item.repositoryName === 'string' &&
        (item.action === null || typeof item.action === 'string') &&
        typeof item.startedAt === 'string' &&
        (item.durationMs === null || (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0)) &&
        operationStatuses.has(item.status) && typeof item.output === 'string' &&
        (item.commands === null || (Array.isArray(item.commands) && item.commands.every((command: unknown) => typeof command === 'string'))) &&
        Array.isArray(item.limitations),
      )) throw localDataError(this.filePath, '校验');
    return value.slice(0, maximumRecords);
  }

  private write(records: StoredOperation[]): void {
    writeLocalJson(this.filePath, records);
    this.records = records;
  }
}
