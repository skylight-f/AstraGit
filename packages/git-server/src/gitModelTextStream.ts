import type { GitModelTextEvents } from './gitModelTextGeneration.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const failed = (message: string) => Object.assign(new Error(message), { statusCode: 502 });

/** 按 SSE 行解码，UTF-8、CRLF 和 JSON 均可以跨网络分片。只转发公开的思考内容/摘要。 */
export async function readGitModelStream(response: Response, protocol: string, events: GitModelTextEvents, activity: () => void): Promise<string> {
  if (!response.body) throw failed('模型流式响应为空。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const text: string[] = [];
  let pending = '';
  let data: string[] = [];
  let completed = false;
  const content = (delta: unknown) => {
    if (typeof delta === 'string' && delta) { text.push(delta); events.onText(delta); }
  };
  const thinking = (delta: unknown) => { if (typeof delta === 'string' && delta) events.onThinking(delta); };
  const dispatch = () => {
    if (!data.length) return;
    const raw = data.join('\n'); data = [];
    if (raw === '[DONE]') return;
    let event: Record<string, unknown>;
    try { event = object(JSON.parse(raw)); } catch { throw failed('模型流式响应格式无效，请重试。'); }
    if (event.error || event.type === 'error' || event.type === 'response.failed') throw failed('模型流式生成失败，请检查连接后重试。');
    if (protocol === 'openai_completions') {
      const choice = object(Array.isArray(event.choices) ? event.choices[0] : null);
      const delta = object(choice.delta);
      thinking(delta.reasoning_content);
      content(delta.content);
      if (choice.finish_reason === 'length') throw failed('模型输出达到供应商上限，已展示的问题已保留，请缩小范围后继续评审。');
      if (choice.finish_reason === 'stop') completed = true;
      else if (choice.finish_reason) throw failed('模型未正常完成评审，已展示的问题已保留。');
    } else if (protocol === 'anthropic_messages') {
      const delta = object(event.delta);
      if (event.type === 'content_block_start') {
        const block = object(event.content_block);
        if (block.type === 'text') content(block.text);
        if (block.type === 'thinking') thinking(block.thinking);
        if (block.type === 'tool_use') throw failed('代码评审不支持工具调用。');
      }
      if (delta.type === 'text_delta') content(delta.text);
      if (delta.type === 'thinking_delta') thinking(delta.thinking);
      if (delta.stop_reason === 'max_tokens') throw failed('模型输出达到供应商上限，已展示的问题已保留，请缩小范围后继续评审。');
      if (delta.stop_reason && delta.stop_reason !== 'end_turn' && delta.stop_reason !== 'stop_sequence') throw failed('模型未正常完成评审，已展示的问题已保留。');
      if (event.type === 'message_stop') completed = true;
    } else {
      if (event.type === 'response.output_text.delta') content(event.delta);
      if (event.type === 'response.reasoning_summary_text.delta') thinking(event.delta);
      if (event.type === 'response.reasoning_summary_text.done') thinking('\n');
      if (event.type === 'response.incomplete') throw failed('模型输出未完成，已展示的问题已保留，请缩小范围后继续评审。');
      if (event.type === 'response.completed') completed = true;
    }
  };
  const line = (value: string) => {
    if (!value) dispatch();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /u, ''));
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.value?.length) activity();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, end).replace(/\r$/u, ''));
        pending = pending.slice(end + 1);
      }
      if (chunk.done || completed) break;
    }
    if (!completed) {
      if (pending) line(pending.replace(/\r$/u, ''));
      dispatch();
    }
    if (!completed) throw failed('模型流式连接中断，已展示的问题已保留，请重新评审。');
    return text.join('');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
