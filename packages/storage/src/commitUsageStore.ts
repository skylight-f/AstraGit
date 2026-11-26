import { commitUsageDay, type CommitGenerationUsage, type CommitUsageRow } from '@astragit/shared';
import type { AstraGitDatabasePort } from './databasePort.js';

export function migrateCommitUsage(db: AstraGitDatabasePort) {
  db.execute(`CREATE TABLE IF NOT EXISTS daily_commit_generation_usage (
    day TEXT NOT NULL, project_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
    project_name TEXT NOT NULL, provider_name TEXT NOT NULL, model_name TEXT NOT NULL,
    generations INTEGER NOT NULL, reported_generations INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
    PRIMARY KEY (day, project_id, provider_id, model_id)
  )`);
}

export class CommitUsageStore {
  constructor(private readonly db: AstraGitDatabasePort) {}

  record(project: { id: string; name: string }, usage: CommitGenerationUsage, date = new Date()) {
    this.db.durableTransactionSync(() => this.db.execute(`
      INSERT INTO daily_commit_generation_usage
        (day, project_id, provider_id, model_id, project_name, provider_name, model_name, generations, reported_generations, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(day, project_id, provider_id, model_id) DO UPDATE SET
        project_name = excluded.project_name, provider_name = excluded.provider_name, model_name = excluded.model_name,
        generations = generations + 1, reported_generations = reported_generations + excluded.reported_generations,
        total_tokens = total_tokens + excluded.total_tokens
    `, [commitUsageDay(date), project.id, usage.providerId, usage.modelId, project.name, usage.providerName, usage.modelName,
      usage.totalTokens === null ? 0 : 1, usage.totalTokens ?? 0]));
  }

  list() {
    return this.db.select<CommitUsageRow>(`
      SELECT day, project_id AS projectId, provider_id AS providerId, model_id AS modelId,
        project_name AS projectName, provider_name AS providerName, model_name AS modelName,
        generations, reported_generations AS reportedGenerations, total_tokens AS totalTokens
      FROM daily_commit_generation_usage ORDER BY day, project_name, provider_name, model_name
    `);
  }
}
