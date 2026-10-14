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
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    writeFileSync(join(home, 'client-info.json'), JSON.stringify(request.params.clientInfo));
    result = { userAgent: 'astragit-test', codexHome: home };
  } else if (request.method === 'model/list') {
    result = { data: [{ id: 'codex-test', model: 'codex-test', displayName: 'Codex test', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }] }], nextCursor: null };
  } else if (request.method === 'account/read') {
    result = { account: null, requiresOpenaiAuth: true };
  } else {
    process.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: 'Unsupported method' } })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
});
