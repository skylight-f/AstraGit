// Adapted from Zeus's SQLite transaction boundary for AstraGit on 2026-10-09.
// Initializes only AstraGit settings, audits, command receipts, and artifacts.
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AstraGitDatabasePort, AstraGitDatabaseWriteFaultReporter, SqlValue } from './databasePort.js';
import { migrateArtifactStoreSchema } from './artifactStore.js';
import { migrateCommandDeliverySchema } from './commandDeliveryStore.js';

type CommitNotification = () => void | Promise<void>;
type WriteFaultKind = 'disk_full' | 'io_error' | 'read_only_filesystem' | 'permission_denied' | 'integrity_error' | 'database_unavailable' | 'commit_unknown';

export class StorageWriteFaultError extends Error {
  readonly code = 'ASTRAGIT_STORAGE_READ_ONLY_FAULT';
  readonly statusCode = 503;
  readonly recoveryRequired = true;

  constructor(readonly kind: WriteFaultKind, readonly operation: string, readonly readsAvailable: boolean, cause: unknown) {
    super('AstraGit 存储写入失败，已停止新的写操作。请修复磁盘空间或权限后重启应用。', { cause });
    this.name = 'StorageWriteFaultError';
  }
}

/** Synchronous WAL commits preserve the command ledger before a Git side effect. */
export class AstraGitDatabase implements AstraGitDatabasePort, AstraGitDatabaseWriteFaultReporter {
  private savepointSequence = 0;
  private savepointDepth = 0;
  private durableDepth = 0;
  private closed = false;
  private writeFailure: StorageWriteFaultError | null = null;
  private readonly afterCommitCallbacks: CommitNotification[] = [];

  constructor(private readonly db: DatabaseSync) {}

  execute(sql: string, params: SqlValue[] = []): void {
    this.assertWritable();
    if (/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/iu.test(sql)) {
      throw new Error('Use transaction() or save() for SQLite transaction control.');
    }
    try {
      this.ensurePendingTransaction();
      if (params.length === 0) this.db.exec(sql);
      else this.db.prepare(sql).run(...params);
    } catch (error) {
      throw this.captureWriteFailure('execute', error) ?? error;
    }
  }

  select<T>(sql: string, params: SqlValue[] = []): T[] {
    this.assertOpen();
    if (this.writeFailure && !this.writeFailure.readsAvailable) throw this.writeFailure;
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  get<T>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.select<T>(sql, params)[0];
  }

  countRows(tableName: string): number {
    if (!/^[a-z_]+$/u.test(tableName)) throw new Error('Invalid AstraGit table name.');
    return this.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName}`)?.count ?? 0;
  }

  afterCommit(callback: CommitNotification): void {
    this.assertWritable();
    if (!this.db.isTransaction) throw new Error('afterCommit requires a pending write transaction.');
    this.afterCommitCallbacks.push(callback);
  }

  async save(): Promise<void> {
    this.assertWritable();
    if (this.savepointDepth > 0 || this.durableDepth > 0) throw new Error('Cannot save from a transaction callback.');
    this.publishAfterCommitCallbacks(this.commitPendingTransaction());
  }

  /** A savepoint joins the pending transaction; save() performs the final commit. */
  transaction<T>(operation: () => T): T {
    this.assertWritable();
    this.ensurePendingTransaction();
    const savepoint = `astragit_transaction_${++this.savepointSequence}`;
    const checkpoint = this.afterCommitCallbacks.length;
    this.db.exec(`SAVEPOINT ${savepoint}`);
    this.savepointDepth += 1;
    try {
      const result = operation();
      assertSynchronous(result);
      this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      this.afterCommitCallbacks.splice(checkpoint);
      if (!this.writeFailure) {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (rollbackError) {
          throw new AggregateError([error, this.enterWriteFault('savepoint_rollback', rollbackError, 'commit_unknown')], 'SQLite operation and rollback failed.');
        }
      }
      throw this.captureWriteFailure('savepoint_operation', error) ?? error;
    } finally {
      this.savepointDepth -= 1;
    }
  }

  /** Returns only after the entire synchronous transaction is durably committed. */
  durableTransactionSync<T>(operation: () => T): T {
    this.assertWritable();
    if (this.savepointDepth > 0 || this.durableDepth > 0) throw new Error('Durable transactions cannot be nested.');
    const previouslyCommitted = this.commitPendingTransaction();
    this.publishAfterCommitCallbacks(previouslyCommitted);
    this.durableDepth += 1;
    try {
      this.ensurePendingTransaction();
      const result = operation();
      assertSynchronous(result);
      const committed = this.commitPendingTransaction();
      this.durableDepth -= 1;
      this.publishAfterCommitCallbacks(committed);
      return result;
    } catch (error) {
      this.afterCommitCallbacks.length = 0;
      if (this.db.isTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError([error, this.enterWriteFault('durable_transaction_rollback', rollbackError, 'commit_unknown')], 'SQLite operation and rollback failed.');
        }
      }
      throw this.captureWriteFailure('durable_transaction', error) ?? error;
    } finally {
      this.durableDepth = 0;
    }
  }

  commitCriticalFactSync<T>(operation: () => T): T {
    this.assertWritable();
    if (this.savepointDepth === 0 && this.durableDepth === 0) return this.durableTransactionSync(operation);
    const result = operation();
    assertSynchronous(result);
    return result;
  }

  reportExternalWriteFault(operation: string, cause: unknown): StorageWriteFaultError {
    return this.enterWriteFault(operation, cause, classifyWriteFault(cause) ?? 'io_error');
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const errors: unknown[] = [];
    try {
      await this.save();
      const checkpoint = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      if (Number(checkpoint?.busy ?? 1) !== 0) throw new Error('SQLite WAL checkpoint is still busy.');
    } catch (error) {
      errors.push(error);
    }
    try {
      this.discardAndClose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'AstraGit SQLite close failed.');
  }

  /** Used only to discard an incomplete startup or failed shutdown transaction. */
  discardAndClose(): void {
    if (this.closed) return;
    try {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
    } finally {
      this.afterCommitCallbacks.length = 0;
      this.db.close();
      this.closed = true;
    }
  }

  private ensurePendingTransaction(): void {
    if (this.db.isTransaction) return;
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      throw this.captureWriteFailure('begin', error) ?? error;
    }
  }

  private commitPendingTransaction(): CommitNotification[] {
    if (!this.db.isTransaction) {
      if (this.afterCommitCallbacks.length) throw this.enterWriteFault('after_commit_ownership', 'Missing transaction', 'commit_unknown');
      return [];
    }
    try {
      this.db.exec('COMMIT');
    } catch (error) {
      throw this.enterWriteFault('commit', error, 'commit_unknown');
    }
    return this.afterCommitCallbacks.splice(0);
  }

  private publishAfterCommitCallbacks(callbacks: readonly CommitNotification[]): void {
    for (const callback of callbacks) {
      try {
        const result = callback();
        if (result instanceof Promise) void result.catch((error: unknown) => console.error('AstraGit 提交后通知失败。', error));
      } catch (error) {
        console.error('AstraGit 提交后通知失败。', error);
      }
    }
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) throw new Error('AstraGit SQLite is closed.');
  }

  private assertWritable(): void {
    this.assertOpen();
    if (this.writeFailure) throw this.writeFailure;
  }

  private captureWriteFailure(operation: string, cause: unknown): StorageWriteFaultError | null {
    const kind = classifyWriteFault(cause);
    return kind ? this.enterWriteFault(operation, cause, kind) : null;
  }

  private enterWriteFault(operation: string, cause: unknown, kind: WriteFaultKind): StorageWriteFaultError {
    if (this.writeFailure) return this.writeFailure;
    let readsAvailable = kind !== 'integrity_error';
    if (this.db.isTransaction) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        readsAvailable = false;
      }
    }
    this.afterCommitCallbacks.length = 0;
    this.writeFailure = new StorageWriteFaultError(kind, operation, readsAvailable, cause);
    return this.writeFailure;
  }
}

const applicationId = 0x41535447; // ASTG

export async function createAstraGitDatabase(filePath: string): Promise<AstraGitDatabase> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const native = new DatabaseSync(filePath);
  const db = new AstraGitDatabase(native);
  try {
    const currentId = Number(native.prepare('PRAGMA application_id').get()?.application_id ?? 0);
    if (currentId !== 0 && currentId !== applicationId) throw new Error('Database belongs to another application.');
    await chmod(filePath, 0o600);
    const journalMode = native.prepare('PRAGMA journal_mode = WAL').get();
    if (String(journalMode?.journal_mode).toLowerCase() !== 'wal') throw new Error('AstraGit SQLite requires WAL.');
    native.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 1000');
    native.enableDefensive(true);
    db.durableTransactionSync(() => {
      db.execute(`PRAGMA application_id = ${applicationId}`);
      db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_id TEXT PRIMARY KEY, description TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
      )`);
      db.execute(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
      )`);
      db.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_ref TEXT, action TEXT NOT NULL,
        resource_type TEXT NOT NULL, resource_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      )`);
      migrateArtifactStoreSchema(db);
      migrateCommandDeliverySchema(db);
    });
    return db;
  } catch (error) {
    db.discardAndClose();
    throw error;
  }
}

function assertSynchronous(value: unknown): void {
  if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function') {
    throw new TypeError('SQLite transaction callbacks must be synchronous.');
  }
}

function classifyWriteFault(cause: unknown): WriteFaultKind | null {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  const message = cause instanceof Error ? cause.message : String(cause);
  const evidence = `${code} ${message}`.toUpperCase();
  if (/SQLITE_FULL|ENOSPC|EDQUOT|DATABASE OR DISK IS FULL|QUOTA EXCEEDED/u.test(evidence)) return 'disk_full';
  if (/SQLITE_IOERR|\bEIO\b|DISK I\/O ERROR/u.test(evidence)) return 'io_error';
  if (/SQLITE_READONLY|\bEROFS\b|READONLY DATABASE|READ-ONLY DATABASE/u.test(evidence)) return 'read_only_filesystem';
  if (/SQLITE_PERM|SQLITE_AUTH|\bEACCES\b|\bEPERM\b|PERMISSION DENIED/u.test(evidence)) return 'permission_denied';
  if (/SQLITE_CORRUPT|SQLITE_NOTADB|DATABASE DISK IMAGE IS MALFORMED|NOT A DATABASE/u.test(evidence)) return 'integrity_error';
  if (/SQLITE_CANTOPEN|UNABLE TO OPEN DATABASE|ENOTDIR/u.test(evidence)) return 'database_unavailable';
  return null;
}
