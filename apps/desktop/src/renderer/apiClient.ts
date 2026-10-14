/**
 * 独立应用 Renderer 公共类型入口：只暴露 Git 工作台所需契约。
 * 不引入会话、任务、数字团队等 Zeus 全站类型。
 */
export type { GitBlameLine, GitFileBlame } from './features/git/gitContracts.js';
export type * from './features/git/gitContracts.js';

export interface ProjectRecord {
  id: string;
  name: string;
  localPath: string;
  description?: string | null;
  note?: string | null;
  createdAt?: string;
  lastOpenedAt?: string;
}

export interface GitAppProject extends ProjectRecord {
  createdAt: string;
  lastOpenedAt: string;
}

export type ModelTemplateId = 'custom' | 'deepseek' | 'bailian' | 'kimi' | 'zai';

export interface ModelConnection {
  id: string;
  name: string;
  templateId: ModelTemplateId;
  baseUrl: string;
  modelsPath: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  models: Array<{ id: string; displayName: string; enabled: boolean }>;
}

export interface SaveModelConnection {
  name: string;
  templateId: ModelTemplateId;
  baseUrl: string;
  modelsPath?: string;
  enabled?: boolean;
  apiKey?: string;
  allowInsecureHttp?: boolean;
  models?: ModelConnection['models'];
}

export interface CodexAccount {
  available: boolean;
  signedIn: boolean;
  message?: string;
  codexHome?: string;
}

export interface CodexLogin {
  generationId: string;
  loginId: string;
  authUrl: string;
}

import type { GitApiClient } from './features/git/gitApiClient.js';

/** 工作台所需 DashboardClient 能力子集；独立应用不组合全站 client。 */
export interface DashboardClient extends GitApiClient {
  loadProjects(): Promise<GitAppProject[]>;
  createProject(input: { name?: string; localPath: string }): Promise<GitAppProject>;
  removeProject(projectId: string): Promise<{ ok: boolean }>;
  touchProject(projectId: string): Promise<GitAppProject>;
  loadGitCommitModels(projectId: string): Promise<{ items: Array<{ id: string; label: string }>; warning: string }>;
  loadModelConnectionTemplates(): Promise<Record<Exclude<ModelTemplateId, 'custom'>, { name: string; baseUrl: string; modelsPath: string }>>;
  loadModelConnections(): Promise<ModelConnection[]>;
  createModelConnection(input: SaveModelConnection): Promise<ModelConnection>;
  updateModelConnection(id: string, input: SaveModelConnection): Promise<ModelConnection>;
  removeModelConnection(id: string): Promise<{ ok: boolean }>;
  refreshModelConnectionModels(id: string): Promise<{ connection: ModelConnection; addedModelIds: string[] }>;
  addManualModel(id: string, modelId: string): Promise<ModelConnection>;
  loadCodexAccount(): Promise<CodexAccount>;
  startCodexLogin(): Promise<CodexLogin>;
  loadCodexLoginStatus(login: CodexLogin): Promise<{ status: 'pending' | 'succeeded' | 'failed'; error: string | null }>;
}

export { AstraGitApiError, isLikelyLocalServerConnectionError } from './transport/localApiTransport.js';
