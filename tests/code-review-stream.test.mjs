import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewReportStream, createReviewThinkingStream } from '../packages/git-server/dist/gitCodeReviewStream.js';
import { readGitModelStream } from '../packages/git-server/dist/gitModelTextStream.js';
import { generateGitModelText } from '../packages/git-server/dist/gitModelTextGeneration.js';
import { generateCodexCommitMessage } from '../packages/git-server/dist/gitCommitCodexGeneration.js';

const finding = { severity: 'high', repositoryId: 'repo', path: 'a.ts', line: 2, title: '转义 " 与 }', detail: '第一行\n第二行包含 { 和 }', suggestion: '修复问题' };
const report = { findings: [finding], summary: '概述', impacts: ['影响'], checks: ['验证'] };
const scope = [{ repositoryId: 'repo', files: ['a.ts'] }];

test('review publishes each complete validated finding before the document finishes, without a finding count budget', () => {
  const events = [];
  const push = createReviewReportStream(scope, text => ({ text }), event => events.push(event));
  const first = `{"findings":[${JSON.stringify(finding)}`;
  for (const char of first.slice(0, -1)) push(char);
  assert.equal(events.length, 0);
  push('}');
  assert.deepEqual(events, [{ type: 'finding', finding }]);
  const rest = Array.from({ length: 15 }, () => finding);
  for (const char of `,${rest.map(item => JSON.stringify(item)).join(',')}],"summary":"概述","impacts":["影响"],"checks":["验证"]}`) push(char);
  assert.equal(events.filter(event => event.type === 'finding').length, 16);
  assert.deepEqual(events.slice(-3), [{ type: 'summary', text: '概述' }, { type: 'impact', text: '影响' }, { type: 'check', text: '验证' }]);
});

test('review rejects out-of-scope findings before emitting them and keeps earlier valid findings', () => {
  const events = [];
  const push = createReviewReportStream(scope, text => ({ text }), event => events.push(event));
  push(`{"findings":[${JSON.stringify(finding)},`);
  assert.throws(() => push(JSON.stringify({ ...finding, path: '../secret' })), /格式或文件定位无效/u);
  assert.equal(events.length, 1);
});

test('thinking redaction survives credentials split across deltas', () => {
  const events = [];
  const stream = createReviewThinkingStream(text => ({ text: text.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{8,}/gu, '[redacted]') }), text => events.push(text));
  for (const char of '检查 sk-abcdefghijklmnop 和 Bearer secret-token-123 后继续。') stream.push(char);
  stream.finish();
  assert.equal(events.join(''), '检查 [redacted] 和 [redacted] 后继续。');
  assert.ok(events.every(text => !text.includes('abcdefghijklmnop') && !text.includes('secret-token')));
});

const sse = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
function response(frames) {
  const bytes = new TextEncoder().encode(frames.join(''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    const end = Math.min(bytes.length, offset + 7);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('provider streams decode UTF-8 boundaries, reasoning and text for all three protocols', async t => {
  const text = JSON.stringify(report);
  const cases = [
    ['openai_completions', [sse({ choices: [{ delta: { reasoning_content: '思考摘要' } }] }), sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']],
    ['openai_responses', [sse({ type: 'response.reasoning_summary_text.delta', delta: '思考摘要' }), sse({ type: 'response.output_text.delta', delta: text }), sse({ type: 'response.completed' })]],
    ['anthropic_messages', [sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思考摘要' } }), sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }), sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }), sse({ type: 'message_stop' })]],
  ];
  for (const [protocol, frames] of cases) await t.test(protocol, async () => {
    const thinking = []; const content = [];
    const result = await readGitModelStream(response(frames), protocol, { onThinking: text => thinking.push(text), onText: text => content.push(text) }, () => {});
    assert.equal(result, text); assert.equal(content.join(''), text); assert.equal(thinking.join(''), '思考摘要');
  });
});

test('provider truncation, errors and missing completion never turn partial results into success', async () => {
  for (const frames of [
    [sse({ choices: [{ delta: { content: '{}' } }] })],
    [sse({ choices: [{ delta: {}, finish_reason: 'length' }] })],
    [sse({ error: { message: 'private-provider-details' } })],
  ]) await assert.rejects(readGitModelStream(response(frames), 'openai_completions', { onText() {}, onThinking() {} }, () => {}), error => {
    assert.doesNotMatch(error.message, /private-provider-details/u); return true;
  });
});

test('review requests use provider output capacity instead of an application token budget', async () => {
  for (const protocol of ['openai_completions', 'openai_responses', 'anthropic_messages']) {
    const service = { loadRuntimeConnections: async () => [{ id: 'connection', enabled: true, apiKey: 'fixture-only', baseUrl: 'https://fixture.invalid/v1', models: [{ id: 'model', enabled: true, protocolFamily: protocol, authenticationScheme: 'protocol_default', maxTokens: 64_000, capability: { reasoning: { state: 'supported' } } }] }] };
    let body;
    const fetcher = async (_url, init) => {
      body = JSON.parse(init.body);
      if (protocol === 'openai_completions') return response([sse({ choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] })]);
      if (protocol === 'openai_responses') return response([sse({ type: 'response.output_text.delta', delta: '{}' }), sse({ type: 'response.completed' })]);
      return response([sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } }), sse({ type: 'message_stop' })]);
    };
    await generateGitModelText(service, { system: 'Review', prompt: 'diff', unlimitedOutput: true }, undefined, fetcher, { onText() {}, onThinking() {} });
    assert.equal(body.stream, true);
    assert.equal('max_completion_tokens' in body, false);
    assert.equal('max_output_tokens' in body, false);
    if (protocol === 'anthropic_messages') assert.equal(body.max_tokens, 64_000);
    else assert.equal('max_tokens' in body, false);
    if (protocol === 'openai_responses') assert.deepEqual(body.reasoning, { summary: 'auto' });
  }
});

test('native Codex streams public reasoning summaries and findings from an isolated read-only session', async () => {
  let listener;
  let thread;
  let turn;
  const text = JSON.stringify(report);
  const received = [];
  const manager = {
    ensureReady: async () => ({ models: [{ model: 'fixture', displayName: 'Fixture', raw: {}, supportedReasoningEfforts: ['medium'] }] }),
    readAccount: async () => ({ signedIn: true }),
    startThread: async input => { thread = input; return { id: 'thread' }; },
    subscribe: callback => { listener = callback; return () => {}; },
    startTurn: async input => {
      turn = input;
      listener({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 'thread', delta: '正在核对改动。' } });
      listener({ method: 'item/agentMessage/delta', params: { threadId: 'thread', itemId: 'answer', delta: text } });
      listener({ method: 'turn/completed', params: { threadId: 'thread', turn: { status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text }] } } });
      return { id: 'turn' };
    },
    close: async () => {},
  };
  await generateCodexCommitMessage({ modelRef: 'codex:fixture', files: ['a.ts'], stagedDiff: 'diff', repositoryName: 'fixture', language: 'zh-CN' }, {
    manager, keepAlive: true, commandPath: '', codexHome: '', task: { system: 'Review', prompt: 'diff', unlimitedOutput: true },
    onThinking: text => received.push(['thinking', text]), onTextDelta: text => received.push(['text', text]),
  });
  assert.deepEqual(received, [['thinking', '正在核对改动。'], ['text', text]]);
  assert.deepEqual(thread.sandbox, { type: 'readOnly', networkAccess: false });
  assert.equal(thread.ephemeral, true);
  assert.equal(turn.summary, 'auto');
});
