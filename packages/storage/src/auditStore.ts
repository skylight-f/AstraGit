// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
import { randomId } from './randomId.js';
import type { AstraGitDatabasePort } from './databasePort.js';

export interface AstraGitAuditLogRecord {
  id: string;
  actorType: string;
  actorRef: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payloadJson: string;
  createdAt: string;
}

export interface AppendAuditLogInput {
  actorType: string;
  actorRef?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class AuditLogRepository {
  constructor(private readonly db: AstraGitDatabasePort) {}

  append(input: AppendAuditLogInput): AstraGitAuditLogRecord {
    const record: AstraGitAuditLogRecord = {
      id: `audit_log_${randomId(12)}`,
      actorType: input.actorType,
      actorRef: input.actorRef ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      payloadJson: JSON.stringify(input.payload),
      createdAt: input.createdAt,
    };
    this.db.execute(
      `INSERT INTO audit_logs (id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.actorType, record.actorRef, record.action, record.resourceType, record.resourceId, record.payloadJson, record.createdAt],
    );
    return record;
  }

  listRecent(limit = 20): AstraGitAuditLogRecord[] {
    return this.db
      .select<DbAuditLogRow>(
        `SELECT id, actor_type, actor_ref, action, resource_type, resource_id, payload_json, created_at
       FROM audit_logs ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        [limit],
      )
      .map(mapAuditLogRow);
  }
}

interface DbAuditLogRow {
  id: string;
  actor_type: string;
  actor_ref: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  payload_json: string;
  created_at: string;
}

function mapAuditLogRow(row: DbAuditLogRow): AstraGitAuditLogRecord {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorRef: row.actor_ref,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}
