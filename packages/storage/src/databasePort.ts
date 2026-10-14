// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
import type { SQLInputValue } from 'node:sqlite';

export type SqlValue = SQLInputValue;

/**
 * Repository 可见的最小 SQLite 端口。
 *
 * 领域 Repository 依赖此端口而不是 storage composition root，避免通过 `index.ts`
 * 形成循环依赖或取得关闭、迁移、备份等不属于自身的数据库生命周期能力。
 */
export interface AstraGitDatabasePort {
  execute(sql: string, params?: SqlValue[]): void;
  select<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | undefined;
  countRows(tableName: string): number;
  afterCommit(callback: () => void | Promise<void>): void;
  transaction<T>(operation: () => T): T;
  durableTransactionSync<T>(operation: () => T): T;
  commitCriticalFactSync<T>(operation: () => T): T;
}

/**
 * SQLite 外的同一耐久存储边界在遇到 ENOSPC/EIO/EROFS/EACCES 等硬故障时，
 * 通过此端口触发 Core 统一只读保护。业务配额拒绝不属于该端口。
 */
export interface AstraGitDatabaseWriteFaultReporter {
  reportExternalWriteFault(operation: string, cause: unknown): unknown;
}
