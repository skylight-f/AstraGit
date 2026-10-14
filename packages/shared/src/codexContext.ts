// Extracted from Zeus for AstraGit on 2026-10-09; package scope and app identity adapted locally.
/** app-server v2 additionalContext 的单个命名条目。 */
export interface CodexAdditionalContextEntry {
  kind: 'application' | 'untrusted';
  value: string;
}

/** Codex bootstrap 的可信清单与不可信正文必须使用 app-server 的精确线协议。 */
export type CodexBootstrapAdditionalContext = Record<string, CodexAdditionalContextEntry>;
