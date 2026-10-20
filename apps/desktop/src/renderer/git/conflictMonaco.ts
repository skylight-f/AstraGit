/// <reference types="vite/client" />
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker&inline';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js';

export { monaco };
export const conflictEditorTheme = 'astragit-conflict-light';
let initialized = false;

/** 官方独立编辑器只使用本地 Worker 与 Monarch 语法，不加载语言服务器或诊断 Worker。 */
export function initializeConflictMonaco(): void {
  if (initialized) return;
  (globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  monaco.editor.defineTheme(conflictEditorTheme, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8792A3' },
      { token: 'keyword', foreground: '7C3AED' },
      { token: 'string', foreground: '047857' },
      { token: 'number', foreground: 'B45309' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#253044',
      'editorGutter.background': '#fafbfe',
      'editorLineNumber.foreground': '#9aa3b3',
      'editorLineNumber.activeForeground': '#596579',
      'editor.selectionBackground': '#e8dfff',
      'editor.inactiveSelectionBackground': '#f0ebfa',
      'editorCursor.foreground': '#7c3aed',
      'editorIndentGuide.background1': '#e9ebf2',
      'editorIndentGuide.activeBackground1': '#cbd2df',
      'editorWhitespace.foreground': '#d0d5df',
      'editorOverviewRuler.border': '#ffffff00',
    },
  });
  // JSON 只分词；不引入 monaco 的 JSON contribution 及其诊断服务。
  monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc'] });
  monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
      root: [
        [/\/\/.*$/u, 'comment'],
        [/\/\*/u, 'comment', '@comment'],
        [/"(?:[^"\\]|\\.)*"\s*(?=:)/u, 'key'],
        [/"(?:[^"\\]|\\.)*"/u, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u, 'number'],
        [/\b(?:true|false|null)\b/u, 'keyword'],
        [/[{}[\]]/u, '@brackets'],
        [/[,:]/u, 'delimiter'],
      ],
      comment: [[/[^/*]+/u, 'comment'], [/\*\//u, 'comment', '@pop'], [/[/*]/u, 'comment']],
    },
  });
  monaco.editor.setTheme(conflictEditorTheme);
  initialized = true;
}

const languageByExtension: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json', css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html', vue: 'html', mpx: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', md: 'markdown', mdx: 'markdown',
  py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml',
  sql: 'sql', go: 'go', rs: 'rust', java: 'java', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp',
  ini: 'ini', conf: 'ini', properties: 'ini', toml: 'ini',
};

export function conflictEditorLanguage(path: string): string {
  const name = path.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() ?? '';
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  return languageByExtension[name.split('.').at(-1) ?? ''] ?? 'plaintext';
}
