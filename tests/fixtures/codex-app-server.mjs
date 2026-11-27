#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const home = process.env.CODEX_HOME;
if (!home || !existsSync(home)) {
  console.error('CODEX_HOME must exist before the native CLI starts.');
  process.exit(1);
}
const input = createInterface({ input: process.stdin });
let modelReads = 0;
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    writeFileSync(join(home, 'client-info.json'), JSON.stringify(request.params.clientInfo));
    result = { userAgent: 'astragit-test', codexHome: home };
  } else if (request.method === 'model/list') {
    const model = ++modelReads === 1 ? 'codex-test' : 'codex-new';
    result = { data: [{ id: model, model, displayName: 'Codex test', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }] }], nextCursor: null };
  } else if (request.method === 'account/read') {
    const account = process.env.ASTRAGIT_CODEX_TEST_SIGNED_IN === '1' ? { type: 'chatgpt', planType: 'plus' } : null;
    result = { account, requiresOpenaiAuth: true };
  } else {
    process.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: 'Unsupported method' } })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
});
