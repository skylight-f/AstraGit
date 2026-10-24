import { useState } from 'react';
import type { GitStagePreview } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import './gitStageReview.css';

export type GitStageDecision = { kind: 'stage'; suppressFuture: boolean } | { kind: 'lfs'; path: string } | null;
export function GitStageReviewDialog(props: { repositoryName: string; preview: GitStagePreview; zh: boolean; selectionHint?: string; onDecide(decision: GitStageDecision): void }) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const required = props.preview.lfsSetupRequired;
  const files = required ? props.preview.lfsFiles.map(path => ({ path, byteLength: null })) : props.preview.largeFiles;
  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? '');
  const [suppress, setSuppress] = useState(false);
  const [limit, setLimit] = useState(200);
  const [scopeLimit, setScopeLimit] = useState(200);
  const size = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString(props.zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 })} MiB`;
  return <ModalPortal role="dialog" aria-label={text(required ? '暂存前配置 Git LFS' : '大文件暂存提醒', required ? 'Set up Git LFS before staging' : 'Large files to stage')} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={() => props.onDecide(null)}>
    <section className="git-stage-review" data-modal-surface="dialog">
      <header><strong>{text(required ? '暂存前配置 Git LFS' : '大文件暂存提醒', required ? 'Set up Git LFS before staging' : 'Large files to stage')} · {props.repositoryName}</strong><Button variant="secondary" onClick={() => props.onDecide(null)}>{text('取消', 'Cancel')}</Button></header>
      <p>{required
        ? text('这些文件已声明使用 LFS，但当前 Git 没有配置 LFS clean/process。请先完成 LFS 配置，再重新暂存。', 'These files declare the LFS filter, but Git has no LFS clean/process configured. Set up LFS, then stage again.')
        : text(`所选范围中有 ${files.length} 个普通 Git 文件达到 ${size(props.preview.thresholdBytes)} 的提醒阈值，合计 ${size(props.preview.totalBytes)}。可以先配置 LFS，也可以按普通 Git 暂存。`, `${files.length} ordinary Git files in the selection meet the ${size(props.preview.thresholdBytes)} warning threshold (${size(props.preview.totalBytes)} total). Set up LFS first or stage with ordinary Git.`)}</p>
      <ul className="git-stage-files" aria-label={text('需核对的文件', 'Files to review')}>{files.slice(0, limit).map(file => <li key={file.path}><label><input type="radio" name="git-stage-lfs-file" checked={selectedPath === file.path} onChange={() => setSelectedPath(file.path)} /><span>{file.path}</span>{file.byteLength !== null ? <small>{size(file.byteLength)}</small> : null}</label></li>)}</ul>
      {files.length > limit ? <Button variant="secondary" onClick={() => setLimit(value => value + 200)}>{text('显示更多', 'Show more')}</Button> : null}
      <details><summary>{text('本次暂存的原始选择范围', 'Original staging selection')} · {props.preview.paths.length}</summary><ul className="git-stage-scope">{props.preview.paths.slice(0, scopeLimit).map(path => <li key={path}>{path}</li>)}</ul>{props.preview.paths.length > scopeLimit ? <Button variant="secondary" onClick={() => setScopeLimit(value => value + 200)}>{text('显示更多选择范围', 'Show more selected paths')}</Button> : null}</details>
      <p>{text('配置 LFS 会打开管理窗口并保留文件选择；完成规则配置后，请重新发起暂存。', 'Set up LFS opens the manager and keeps your file selection. After configuring tracking rules, stage again.')}</p>
      {!required ? <><label className="git-stage-check"><input type="checkbox" checked={suppress} onChange={event => setSuppress(event.target.checked)} />{text('以后不再提醒（可在 Git LFS 管理中恢复）', 'Do not warn again (restore in the Git LFS manager)')}</label><small>{props.selectionHint ?? text('继续会暂存原始选择范围，包含未在上方列出的小文件。此操作不会创建提交。', 'Continue stages the original selection, including smaller files not listed above. It does not create a commit.')}</small></> : null}
      <footer><Button variant="secondary" disabled={!selectedPath} onClick={() => props.onDecide({ kind: 'lfs', path: selectedPath })}>{text(required ? '配置 Git LFS…' : '用 LFS 跟踪所选文件…', required ? 'Set up Git LFS…' : 'Track selected file with LFS…')}</Button>{!required ? <Button onClick={() => props.onDecide({ kind: 'stage', suppressFuture: suppress })}>{text('按普通 Git 暂存', 'Stage with ordinary Git')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}
