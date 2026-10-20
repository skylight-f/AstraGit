import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { verifyMachOArchitecture } from '../scripts/macos-architecture.mjs';

const execute = promisify(execFile);

test('Mach-O verification rejects unsupported application architectures before invoking lipo', async () => {
  for (const architecture of ['ia32', 'x86_64', 'arm', '', undefined]) {
    await assert.rejects(verifyMachOArchitecture('/file/that/does/not/exist', architecture), /Unsupported macOS architecture:/u);
  }
});

test('Mach-O verification accepts actual matching binaries and rejects the other architecture', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'astragit-macho-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'architecture fixture.c');
  await writeFile(source, 'int astragit_architecture_fixture(void) { return 1; }\n');

  for (const [architecture, target, other] of [['arm64', 'arm64', 'x64'], ['x64', 'x86_64', 'arm64']]) {
    await t.test(architecture, async () => {
      const file = join(directory, `${architecture} fixture.o`);
      await execute('/usr/bin/xcrun', ['clang', '-target', `${target}-apple-macos13.0`, '-c', source, '-o', file]);
      await verifyMachOArchitecture(file, architecture);
      await assert.rejects(verifyMachOArchitecture(file, other));
    });
  }

  const invalid = join(directory, 'not a Mach-O file');
  await writeFile(invalid, 'ordinary text\n');
  await assert.rejects(verifyMachOArchitecture(invalid, 'arm64'));
  await assert.rejects(verifyMachOArchitecture(join(directory, 'missing'), 'x64'));
});
