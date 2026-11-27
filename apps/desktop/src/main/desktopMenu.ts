import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopMenuCommand, DesktopMenuState } from '@astragit/shared';

export function desktopMenuTemplate(state: DesktopMenuState, development: boolean, invoke: (command: DesktopMenuCommand) => void): MenuItemConstructorOptions[] {
  const text = (cn: string, en: string) => state.language === 'zh-CN' ? cn : en;
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const native = (role: MenuItemConstructorOptions['role'], cn: string, en: string): MenuItemConstructorOptions => ({ role, label: text(cn, en) });
  const action = (id: DesktopMenuCommand, cn: string, en: string, accelerator?: string): MenuItemConstructorOptions => ({
    id, label: text(cn, en), accelerator, enabled: state.enabled.includes(id), click: () => invoke(id),
  });
  return [
    { label: 'AstraGit', submenu: [
      native('about', '关于 AstraGit', 'About AstraGit'), action('settings', '设置…', 'Settings…', 'CommandOrControl+,'), separator,
      native('services', '服务', 'Services'), separator,
      native('hide', '隐藏 AstraGit', 'Hide AstraGit'), native('hideOthers', '隐藏其他应用', 'Hide Others'), native('unhide', '显示全部', 'Show All'),
      separator, native('quit', '退出 AstraGit', 'Quit AstraGit'),
    ] },
    { label: text('文件', 'File'), submenu: [
      action('open-local-project', '打开本地仓库…', 'Open Local Repository…', 'CommandOrControl+O'),
      action('project-list', '打开或添加项目…', 'Open or Add Project…'), separator,
      action('close-project', '关闭当前项目', 'Close Current Project'),
    ] },
    { label: text('编辑', 'Edit'), submenu: [
      native('undo', '撤销', 'Undo'), native('redo', '重做', 'Redo'), separator,
      native('cut', '剪切', 'Cut'), native('copy', '复制', 'Copy'), native('paste', '粘贴', 'Paste'), native('selectAll', '全选', 'Select All'),
    ] },
    { label: text('视图', 'View'), submenu: [
      action('source', '项目提交', 'Project Commits'), action('changes', '暂存与未暂存', 'Staged and Unstaged'),
      action('history', '提交历史', 'Commit History'), action('review', '代码评审', 'Code Review'),
      action('search', '搜索工作区…', 'Search Workspace…', 'CommandOrControl+K'), separator,
      native('resetZoom', '实际大小', 'Actual Size'), native('zoomIn', '放大', 'Zoom In'), native('zoomOut', '缩小', 'Zoom Out'),
      native('togglefullscreen', '切换全屏', 'Toggle Full Screen'),
      ...(development ? [separator, native('reload', '重载界面', 'Reload'), native('forceReload', '强制重载界面', 'Force Reload'), native('toggleDevTools', '切换开发者工具', 'Toggle Developer Tools')] : []),
    ] },
    { label: text('仓库', 'Repository'), submenu: [
      action('commit', '提交…', 'Commit…'), separator,
      action('pull', '拉取…', 'Pull…'), action('push', '推送…', 'Push…'), action('fetch', '抓取', 'Fetch'), separator,
      action('branch', '新建分支…', 'New Branch…'), action('merge', '合并…', 'Merge…'), action('tag', '标签…', 'Tags…'), action('stash', '贮藏…', 'Stash…'),
      separator, action('git-actions', '更多仓库操作…', 'More Repository Actions…'), action('refresh', '刷新仓库', 'Refresh Repository'),
    ] },
    { label: text('窗口', 'Window'), submenu: [
      native('minimize', '最小化', 'Minimize'), native('zoom', '缩放', 'Zoom'), native('close', '关闭窗口', 'Close Window'), separator,
      native('front', '前置全部窗口', 'Bring All to Front'),
    ] },
    { role: 'help', label: text('帮助', 'Help'), submenu: [action('updates', '版本与更新…', 'Version and Updates…')] },
  ];
}
