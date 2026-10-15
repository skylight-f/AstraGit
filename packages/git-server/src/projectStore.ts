import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { localDataError, readLocalJson, writeLocalJson } from './localJsonFile.js';

export interface GitAppProject {
  id: string;
  name: string;
  localPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface CreateProjectInput {
  name: string;
  localPath: string;
}

/** 简化项目列表：原子写 JSON，不承担 Zeus 全量项目字段。 */
export class ProjectStore {
  private readonly filePath: string;
  private cache: GitAppProject[] | null = null;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'projects.json');
  }

  list(): GitAppProject[] {
    return this.read().map(project => ({ ...project }));
  }

  getById(id: string): GitAppProject | undefined {
    return this.read().find((project) => project.id === id);
  }

  getByPath(localPath: string): GitAppProject | undefined {
    const normalized = canonicalProjectPath(localPath);
    return this.read().find((project) => canonicalProjectPath(project.localPath) === normalized);
  }

  create(input: CreateProjectInput): GitAppProject {
    if (!input.localPath || input.localPath.includes('\0') || !isAbsolute(input.localPath)) throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '请选择有效的绝对目录路径。');
    const localPath = canonicalProjectPath(input.localPath);
    const name = input.name.trim() || localPath.split('/').filter(Boolean).at(-1) || '项目';
    if (!name || name.length > 120) throw projectError('ASTRAGIT_PROJECT_NAME_INVALID', '项目名称无效。');
    if (!existsSync(localPath)) throw projectError('ASTRAGIT_PROJECT_PATH_MISSING', '项目目录不存在。');
    if (!statSync(localPath).isDirectory()) throw projectError('ASTRAGIT_PROJECT_PATH_INVALID', '项目路径必须是目录。');
    const existing = this.getByPath(localPath);
    if (existing) {
      const refreshed = { ...existing, lastOpenedAt: new Date().toISOString() };
      this.replace(existing.id, refreshed);
      return refreshed;
    }
    const now = new Date().toISOString();
    const project: GitAppProject = { id: `astragit_${randomUUID()}`, name, localPath, createdAt: now, lastOpenedAt: now };
    this.write([...this.read(), project]);
    return project;
  }

  touch(id: string): GitAppProject | undefined {
    const project = this.getById(id);
    if (!project) return undefined;
    const updated = { ...project, lastOpenedAt: new Date().toISOString() };
    this.replace(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    const projects = this.read();
    const next = projects.filter((project) => project.id !== id);
    if (next.length === projects.length) return false;
    this.write(next);
    return true;
  }

  private replace(id: string, updated: GitAppProject): void {
    const projects = this.read().map((project) => (project.id === id ? updated : project));
    this.write(projects);
  }

  private read(): GitAppProject[] {
    if (this.cache) return this.cache;
    const parsed = readLocalJson(this.filePath);
    if (parsed === undefined) this.cache = [];
    else if (Array.isArray(parsed) && parsed.every(isProjectRecord)) this.cache = parsed;
    else throw localDataError(this.filePath, '校验');
    return this.cache;
  }

  private write(projects: GitAppProject[]): void {
    writeLocalJson(this.filePath, projects);
    this.cache = projects;
  }
}

function isProjectRecord(value: unknown): value is GitAppProject {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && Boolean(item.id) && typeof item.name === 'string' && typeof item.localPath === 'string' && isAbsolute(item.localPath) && !item.localPath.includes('\0') && typeof item.createdAt === 'string' && typeof item.lastOpenedAt === 'string';
}

function canonicalProjectPath(value: string): string {
  const path = resolve(value);
  try { return realpathSync.native(path); } catch { return path; }
}

export function projectError(code: string, message: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(message), { statusCode: 400, code });
}
