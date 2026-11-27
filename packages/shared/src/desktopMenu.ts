export const desktopGitMenuCommands = [
  'commit', 'pull', 'push', 'fetch', 'branch', 'merge', 'tag', 'stash', 'git-actions', 'refresh',
] as const;

export type DesktopGitMenuCommand = typeof desktopGitMenuCommands[number];
export type DesktopMenuCommand = DesktopGitMenuCommand | 'settings' | 'updates' | 'open-local-project'
  | 'project-list' | 'close-project' | 'source' | 'changes' | 'history' | 'review' | 'search';

export interface DesktopMenuState {
  language: 'zh-CN' | 'en-US';
  enabled: DesktopMenuCommand[];
}
