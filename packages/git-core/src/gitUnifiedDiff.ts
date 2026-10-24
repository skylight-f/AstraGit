import { decodeGitQuotedPath as decodeGitDiagnosticPath } from './gitQuotedPath.js';
import type { GitFileDiff, GitDiffHunk } from './index.js';

/** 将 unified diff 解析成文件、hunk 和行级记录；该函数只解析文本，不执行任何 Git 写操作。 */
export function parseGitUnifiedDiff(diffText: string): GitFileDiff[] {
  const files: GitFileDiff[] = [];
  let currentFile: GitFileDiff | undefined;
  let currentHunk: GitDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentFile = createFileDiffFromHeader(line);
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }
    if (!currentFile) continue;

    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      currentFile.isBinary = true;
      continue;
    }

    if (line.startsWith('@@ ')) {
      currentHunk = parseGitDiffHunkHeader(line);
      currentFile.hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'addition',
          content: line.slice(1),
          oldLineNumber: null,
          newLineNumber: newLine,
        });
        currentFile.addedLines += 1;
        newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      currentFile.deletedLines += 1;
      oldLine += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line.startsWith('\\')) {
      currentHunk.lines.push({
        type: 'metadata',
        content: line,
        oldLineNumber: null,
        newLineNumber: null,
      });
    }
      continue;
    }

    if (line.startsWith('rename from ')) {
      currentFile.oldPath = decodeGitDiagnosticPath(line.slice('rename from '.length)) ?? line.slice('rename from '.length);
      currentFile.changeType = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      currentFile.newPath = decodeGitDiagnosticPath(line.slice('rename to '.length)) ?? line.slice('rename to '.length);
      currentFile.changeType = 'renamed';
      continue;
    }
    if (line.startsWith('new file mode ')) {
      currentFile.changeType = 'added';
      if (line.endsWith(' 160000')) currentFile.isSubmodule = true;
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      currentFile.changeType = 'deleted';
      if (line.endsWith(' 160000')) currentFile.isSubmodule = true;
      continue;
    }
    if (line.startsWith('index ') && / 160000$/u.test(line)) {
      currentFile.isSubmodule = true;
      continue;
    }
    if (line.startsWith('copy from ') || line.startsWith('copy to ')) {
      const from = line.startsWith('copy from '); const raw = line.slice(from ? 10 : 8);
      currentFile[from ? 'oldPath' : 'newPath'] = decodeGitDiagnosticPath(raw) ?? raw;
      currentFile.changeType = 'copied';
      continue;
    }
    if (line.startsWith('--- ')) {
      const path = parseDiffMarkerPath(line.slice(4));
      if (path && path !== '/dev/null') currentFile.oldPath = path;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = parseDiffMarkerPath(line.slice(4));
      if (path && path !== '/dev/null') currentFile.newPath = path;
      if (path === '/dev/null') currentFile.changeType = 'deleted';
      continue;
    }

  }

  return files;
}

function createFileDiffFromHeader(header: string): GitFileDiff {
  const body = header.slice('diff --git '.length);
  const candidates: Array<[string, string]> = [];
  for (const match of body.matchAll(/ (?=(?:"b\/|b\/))/gu)) {
    const old = decodeDiffPathToken(body.slice(0, match.index));
    const next = decodeDiffPathToken(body.slice(match.index + 1));
    if (old?.startsWith('a/') && next?.startsWith('b/')) candidates.push([old.slice(2), next.slice(2)]);
  }
  // Unquoted names can themselves contain " b/". Unchanged paths disambiguate
  // binary/mode-only diffs; rename/copy metadata replaces both paths below.
  const paths = candidates.find(([old, next]) => old === next) ?? candidates.at(-1);
  return {
    oldPath: paths?.[0] ?? '',
    newPath: paths?.[1] ?? '',
    changeType: 'modified',
    addedLines: 0,
    deletedLines: 0,
    hunks: [],
  };
}

function parseGitDiffHunkHeader(header: string): GitDiffHunk {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(header);
  return {
    header,
    oldStart: Number(match?.[1] ?? 0),
    oldLines: Number(match?.[2] ?? 1),
    newStart: Number(match?.[3] ?? 0),
    newLines: Number(match?.[4] ?? 1),
    lines: [],
  };
}

function parseDiffMarkerPath(value: string): string {
  const token = value.startsWith('"') ? /^"(?:[^"\\]|\\.)*"/u.exec(value)?.[0] : value.split('\t', 1)[0];
  const path = token === undefined ? null : decodeDiffPathToken(token);
  return path === null ? '' : path === '/dev/null' ? path : stripDiffPathPrefix(path);
}

function decodeDiffPathToken(value: string): string | null {
  if (value.includes('"') && !/^"(?:[^"\\]|\\.)*"$/u.test(value)) return null;
  return decodeGitDiagnosticPath(value);
}

function stripDiffPathPrefix(value: string): string {
  return value.replace(/^[ab]\//u, '');
}
