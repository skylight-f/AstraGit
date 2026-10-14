import type { AstraGitDatabasePort } from './databasePort.js';

export interface SettingRecord {
  key: string;
  valueJson: string;
  updatedAt: string;
}

/** Model metadata is local to this application's database; secrets are stored separately. */
export class SettingRepository {
  constructor(private readonly db: AstraGitDatabasePort) {}

  getJson<T>(key: string): T | undefined {
    const row = this.db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [key]);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return undefined;
    }
  }

  setJson(key: string, value: unknown): SettingRecord {
    const record = { key, valueJson: JSON.stringify(value), updatedAt: new Date().toISOString() };
    if (record.valueJson === undefined) throw new TypeError('Setting value must be JSON serializable.');
    this.db.execute(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [record.key, record.valueJson, record.updatedAt],
    );
    return record;
  }
}
