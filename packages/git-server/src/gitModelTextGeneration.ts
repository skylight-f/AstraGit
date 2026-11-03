import { modelConnectionRequestEndpoint, modelRef } from '@astragit/ai-runtime';
import type { ModelConnectionService } from './modelConnectionService.js';

/** 内部构造的只读文本任务，客户端不能提供系统指令。 */
export interface GitModelTextTask {
  system: string;
  prompt: string;
  modelRef?: string;
  maxTokens?: number;
  maxCharacters?: number;
}

export async function generateGitModelText(service: ModelConnectionService, task: GitModelTextTask, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ message: string; model: string }> {
  const connections = await service.loadRuntimeConnections();
  const available = connections
    .filter((connection) => connection.enabled && connection.apiKey)
    .flatMap((connection) => connection.models.filter((model) => model.enabled).map((model) => ({ connection, model, ref: modelRef(connection.id, model.id) })));
  const requestedModelRef = task.modelRef;
  // 未记住提交模型时退回第一个可用模型，不再依赖项目级白名单或默认模型配置。
  const selected = requestedModelRef ? available.find((entry) => entry.ref === requestedModelRef) : available[0];
  if (!selected) throw failure('所选模型不可用，请选择已启用且配置 API Key 的模型连接。', 409);
  const { connection, model } = selected;
  const { system, prompt } = task;
  const protocol = model.protocolFamily;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];
  const body =
    protocol === 'anthropic_messages'
      ? { model: model.id, system, messages: messages.slice(1), max_tokens: task.maxTokens ?? 2048, stream: false }
      : protocol === 'openai_responses'
        ? { model: model.id, instructions: system, input: prompt, max_output_tokens: task.maxTokens ?? 4096, stream: false, store: false }
        : { model: model.id, messages, max_completion_tokens: task.maxTokens ?? 4096, stream: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const useApiKey = model.authenticationScheme === 'x_api_key' || (model.authenticationScheme === 'protocol_default' && protocol === 'anthropic_messages');
  headers[useApiKey ? 'x-api-key' : 'Authorization'] = useApiKey ? connection.apiKey! : `Bearer ${connection.apiKey!}`;
  if (protocol === 'anthropic_messages') headers['anthropic-version'] = '2023-06-01';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 80_000);
  try {
    const response = await fetcher(modelConnectionRequestEndpoint(connection.baseUrl, protocol), { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    if (!response.ok) throw failure(`AI 生成失败（HTTP ${response.status}），请检查模型连接后重试。`, 502);
    const payload: unknown = await response.json();
    const value = record(payload);
    const choice = record(Array.isArray(value.choices) ? value.choices[0] : null);
    const content =
      protocol === 'openai_completions'
        ? record(choice.message).content
        : protocol === 'anthropic_messages'
          ? readTextBlocks(value.content)
          : Array.isArray(value.output)
            ? value.output
                .filter((item) => record(item).type === 'message')
                .map((item) => readTextBlocks(record(item).content))
                .join('\n')
            : '';
    const incomplete = protocol === 'openai_completions' ? choice.finish_reason === 'length' : protocol === 'anthropic_messages' ? value.stop_reason === 'max_tokens' : value.status === 'incomplete';
    if (incomplete) throw failure('模型输出被截断，请重试或更换模型。', 502);
    const message =
      typeof content === 'string'
        ? content
            .trim()
            .replace(/^```[^\n]*\n([\s\S]*?)\n```$/u, '$1')
            .trim()
        : '';
    if (!message || message.length > (task.maxCharacters ?? 10_000)) throw failure('模型未返回有效的生成内容，请重试。', 502);
    return { message, model: model.displayName || model.id };
  } catch (error) {
    if (controller.signal.aborted) throw failure('AI 生成超时，请重试。', 504);
    // 不把供应商响应、连接地址或凭据附带到客户端错误中。
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw failure('AI 生成失败，请检查模型连接后重试。', 502);
  } finally {
    clearTimeout(timer);
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function readTextBlocks(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((item) => ['text', 'output_text'].includes(String(record(item).type)))
        .map((item) => record(item).text)
        .filter((text) => typeof text === 'string')
        .join('\n')
    : '';
}
function failure(message: string, statusCode: number): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(message), { statusCode, code: 'ASTRAGIT_COMMIT_MESSAGE_FAILED' });
}
