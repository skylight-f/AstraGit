import type { ProjectGitTab } from '../../projects/projectWorkspacePersistence.js';
import { MenuSurface } from '../../../ui/MenuSurface.js';
import { useRef } from 'react';
import { createPortal } from 'react-dom';

export function GitOperationsMenu(props: {
  anchor: HTMLButtonElement | null;
  zh: boolean;
  onClose: () => void;
  onOpenCommit: () => void;
  onOpenDeleteBranches?: () => void;
  onOpenDeleteRemoteBranches?: () => void;
  onOpenAmend?: () => void;
  onOpenInteractiveRebase?: () => void;
  onOpenFileHistory?: () => void;
  onImportPatch?: () => void;
  onOpenExternalTools?: () => void;
  onOpenLfs?: () => void;
  onOpenFlow?: () => void;
  onOpenSubmodules?: () => void;
  onOpenTags?: () => void;
  onExportPatch?: () => void;
  onExportArchive?: () => void;
  onOpenSettings?: () => void;
  onOpenPush: () => void;
  onOpenUpdate: () => void;
  onOpenNewBranch: () => void;
  onOpenRevision: () => void;
  onSelectTab: (tab: ProjectGitTab) => void;
  onOpenConsole: () => void;
  onOpenSubtree: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const bounds = props.anchor?.getBoundingClientRect();

  const action = (callback: () => void) => () => {
    props.onClose();
    callback();
  };
  return createPortal(
    <MenuSurface onClose={props.onClose} ref={menuRef} className="macos-ai-app project-git-operations-menu" role="menu" style={{ left: Math.max(8, (bounds?.right ?? 228) - 220), top: (bounds?.bottom ?? 0) + 5 }}>
      <button type="button" role="menuitem" onClick={action(props.onOpenCommit)}>
        {props.zh ? '提交…' : 'Commit…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenExternalTools} onClick={props.onOpenExternalTools ? action(props.onOpenExternalTools) : undefined}>{props.zh ? '外部工具设置…' : 'External tool settings…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenFlow} onClick={props.onOpenFlow ? action(props.onOpenFlow) : undefined}>Git Flow…</button>
      <button type="button" role="menuitem" disabled={!props.onOpenLfs} onClick={props.onOpenLfs ? action(props.onOpenLfs) : undefined}>{props.zh ? 'Git LFS 管理…' : 'Manage Git LFS…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenSubmodules} onClick={props.onOpenSubmodules ? action(props.onOpenSubmodules) : undefined}>{props.zh ? '子模块管理…' : 'Manage submodules…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenTags} onClick={props.onOpenTags ? action(props.onOpenTags) : undefined}>{props.zh ? '标签管理…' : 'Manage tags…'}</button>
      <button type="button" role="menuitem" disabled={!props.onImportPatch} onClick={props.onImportPatch ? action(props.onImportPatch) : undefined}>{props.zh ? '导入补丁…' : 'Import patch…'}</button>
      <button type="button" role="menuitem" disabled={!props.onExportPatch} onClick={props.onExportPatch ? action(props.onExportPatch) : undefined}>{props.zh ? '导出补丁…' : 'Export patch…'}</button>
      <button type="button" role="menuitem" disabled={!props.onExportArchive} onClick={props.onExportArchive ? action(props.onExportArchive) : undefined}>{props.zh ? '导出源码存档…' : 'Export source archive…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenFileHistory} onClick={props.onOpenFileHistory ? action(props.onOpenFileHistory) : undefined}>{props.zh ? '文件历史与代码归属…' : 'File history and blame…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenInteractiveRebase} onClick={props.onOpenInteractiveRebase ? action(props.onOpenInteractiveRebase) : undefined}>{props.zh ? '交互变基…' : 'Interactive rebase…'}</button>
      <button type="button" role="menuitem" disabled={!props.onOpenAmend} onClick={props.onOpenAmend ? action(props.onOpenAmend) : undefined}>
        {props.zh ? '修订上次提交…' : 'Amend last commit…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenSettings} onClick={props.onOpenSettings ? action(props.onOpenSettings) : undefined}>
        {props.zh ? '仓库设置…' : 'Repository settings…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenPush)}>
        {props.zh ? '推送…' : 'Push…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenUpdate)}>
        {props.zh ? '更新项目…' : 'Update Project…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenSubtree)}>
        {props.zh ? '管理子树…' : 'Manage subtrees…'}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={action(props.onOpenNewBranch)}>
        {props.zh ? '新建分支…' : 'New Branch…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenDeleteBranches} onClick={props.onOpenDeleteBranches ? action(props.onOpenDeleteBranches) : undefined}>
        {props.zh ? '删除本地分支…' : 'Delete local branches…'}
      </button>
      <button type="button" role="menuitem" disabled={!props.onOpenDeleteRemoteBranches} onClick={props.onOpenDeleteRemoteBranches ? action(props.onOpenDeleteRemoteBranches) : undefined}>
        {props.zh ? '删除远程分支…' : 'Delete remote branches…'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenRevision)}>
        {props.zh ? '切换到标签或提交…' : 'Switch to a tag or commit…'}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('log'))}>
        {props.zh ? '显示 Git 历史' : 'Show Git History'}
      </button>
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('changes'))}>
        {props.zh ? '未提交的变更' : 'Uncommitted Changes'}
      </button>
      <button type="button" role="menuitem" onClick={action(() => props.onSelectTab('stash'))}>
        {props.zh ? '贮藏' : 'Stashes'}
      </button>
      <button type="button" role="menuitem" onClick={action(props.onOpenConsole)}>
        {props.zh ? '控制台 / 操作记录' : 'Console / Operation history'}
      </button>
    </MenuSurface>,
    document.body,
  );
}
