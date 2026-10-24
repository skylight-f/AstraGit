import { createLocalApiTransport, type LocalApiConnection } from './transport/localApiTransport.js';
import { createGitApiClient, type GitApiClient } from './features/git/gitApiClient.js';
import type { CodexAccount, CodexLogin, DashboardClient, GitAppProject, ModelConnection, ModelTemplateId, SaveModelConnection } from './apiClient.js';
import { jsonRequest } from './transport/localApiTransport.js';

export function createDashboardClientLike(options: { baseUrl: string; apiToken: string }): DashboardClient {
  const connection: LocalApiConnection = { baseUrl: options.baseUrl, apiToken: options.apiToken };
  const transport = createLocalApiTransport({ getConnection: () => connection });
  const git: GitApiClient = createGitApiClient(transport);
  return {
    ...git,
    startRepositorySetup: input => transport.request('/api/repository-setup', jsonRequest('POST', input)),
    loadRepositorySetup: id => transport.request(`/api/repository-setup/${encodeURIComponent(id)}`),
    loadRepositorySetups: () => transport.request('/api/repository-setup'),
    cancelRepositorySetup: id => transport.request(`/api/repository-setup/${encodeURIComponent(id)}/cancel`, jsonRequest('POST', {})),
    loadProjects: () => transport.request<GitAppProject[]>('/api/projects'),
    createProject: (input) => transport.request<GitAppProject>('/api/projects', jsonRequest('POST', input)),
    removeProject: (projectId) => transport.request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
    touchProject: (projectId) => transport.request<GitAppProject>(`/api/projects/${encodeURIComponent(projectId)}/touch`, jsonRequest('POST', {})),
    loadGitCommitModels: git.loadGitCommitModels,
    loadModelConnectionTemplates: () => transport.request<Record<Exclude<ModelTemplateId, 'custom'>, { name: string; baseUrl: string; modelsPath: string }>>('/api/model-connection-templates'),
    loadModelConnections: async () => (await transport.request<{ items: ModelConnection[] }>('/api/model-connections')).items,
    createModelConnection: (input: SaveModelConnection) => transport.request<ModelConnection>('/api/model-connections', jsonRequest('POST', input)),
    updateModelConnection: (id: string, input: SaveModelConnection) => transport.request<ModelConnection>(`/api/model-connections/${encodeURIComponent(id)}`, jsonRequest('PATCH', input)),
    removeModelConnection: (id: string) => transport.request<{ ok: boolean }>(`/api/model-connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    refreshModelConnectionModels: (id: string) => transport.request<{ connection: ModelConnection; addedModelIds: string[] }>(`/api/model-connections/${encodeURIComponent(id)}/refresh-models`, jsonRequest('POST', {})),
    addManualModel: (id: string, modelId: string) => transport.request<ModelConnection>(`/api/model-connections/${encodeURIComponent(id)}/models`, jsonRequest('POST', { modelId })),
    loadCodexAccount: () => transport.request<CodexAccount>('/api/codex/account'),
    startCodexLogin: () => transport.request<CodexLogin>('/api/codex/account/login/chatgpt', jsonRequest('POST', {})),
    loadCodexLoginStatus: (login: CodexLogin) => transport.request(`/api/codex/account/login/chatgpt/status?generationId=${encodeURIComponent(login.generationId)}&loginId=${encodeURIComponent(login.loginId)}`),
  };
}
