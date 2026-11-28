export const desktopMenuSections = [
  { id: 'file', zh: '文件', en: 'File' },
  { id: 'edit', zh: '编辑', en: 'Edit' },
  { id: 'view', zh: '视图', en: 'View' },
  { id: 'repository', zh: '仓库', en: 'Repository' },
  { id: 'window', zh: '窗口', en: 'Window' },
  { id: 'help', zh: '帮助', en: 'Help' },
] as const;

export type DesktopMenuSection = typeof desktopMenuSections[number]['id'];

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
