import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { GitCommitModelState } from '../../models/useGitCommitModels.js';
import type { ProjectGitTab } from '../../projects/projectWorkspacePersistence.js';
import type { GitSearchNavigation } from '../../search/workspaceSearchState.js';
import type { DashboardClient, ProjectGitAction, ProjectRecord } from '../../../api/apiClient.js';

export type BusyState = { repositoryId: string; action: ProjectGitAction['type'] } | null;

export type OperationTone = 'success' | 'warning' | 'error';

export type BranchKind = 'local' | 'remote';

export type ExecutionOutcome = 'completed' | 'conflict' | null;

export type ProjectGitUpdateStrategy = 'merge' | 'rebase' | 'reset';

export type PushSelection = { repositoryId: string; remote: string; sourceBranch: string; targetBranch: string; setUpstream: boolean };

export type ChangeStage = 'staged' | 'unstaged';
export type GitContextEvent = MouseEvent | KeyboardEvent;
export interface GitContextTarget {
  kind: 'file' | 'directory' | 'stage' | 'local' | 'remote' | 'tag' | 'commit' | 'stash' | 'repository';
  repositoryId: string;
  ref: string;
  stage?: ChangeStage;
  /** A frozen selection within one repository and one staging area. */
  paths?: string[];
  commits?: string[];
}

export interface GitDiffOptions {
  stage?: 'combined' | ChangeStage;
  commitHash?: string;
  comparisonRef?: string;
  comparisonMode?: 'current' | 'working-tree';
  revisions?: [string, string];
}

export interface ProjectGitWorkbenchProps {
  project: ProjectRecord;
  autoFetchEnabled: boolean;
  client: DashboardClient;
  language: 'zh-CN' | 'en-US';
  tab: ProjectGitTab;
  onTabChange: (tab: ProjectGitTab) => void;
  commitModels: GitCommitModelState;
  onOpenModelSettings: () => void;
  navigationRequest?: GitSearchNavigation | null;
  onNavigationHandled?: (requestId: number) => void;
  commandHost: HTMLElement | null;
  commitViewNavigation?: ReactNode;
  sourceView?: { visible: boolean; active: boolean; onBusyChange: (busy: boolean) => void; onToolbarBusyChange: (busy: boolean) => void };
}
