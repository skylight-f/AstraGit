export interface GitCodeReviewInput {
  /** 省略时评审当前项目内全部仓库。 */
  repositoryId?: string;
  mode: 'worktree' | 'staged';
  language: 'zh-CN' | 'en';
  modelRef: string;
}

export interface GitCodeReviewScope {
  fingerprint: string;
  fileCount: number;
  repositories: Array<{ id: string; name: string; relativePath: string; fileCount: number }>;
  limitations: string[];
}

export interface GitCodeReviewFinding {
  severity: 'high' | 'medium' | 'low';
  repositoryId: string;
  path: string;
  line?: number;
  title: string;
  detail: string;
  suggestion: string;
}

export interface GitCodeReviewReport extends GitCodeReviewScope {
  summary: string;
  impacts: string[];
  findings: GitCodeReviewFinding[];
  checks: string[];
  model: string;
  reviewedAt: string;
  mode: 'worktree' | 'staged';
}

export type GitCodeReviewEvent =
  | { type: 'scope'; scope: GitCodeReviewScope }
  | { type: 'thinking'; text: string }
  | { type: 'summary' | 'impact' | 'check'; text: string }
  | { type: 'finding'; finding: GitCodeReviewFinding }
  | { type: 'result'; report: GitCodeReviewReport }
  | { type: 'error'; message: string }
  | { type: 'heartbeat' };
