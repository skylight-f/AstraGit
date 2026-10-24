import { useState } from 'react';
import { gitBranchNameIssue, gitRemoteAddressIssue } from '@astragit/shared';
import type { useRepositorySetup } from './useRepositorySetup.js';
import { Button } from './ui/Button.js';
import { VisibleApplicationError } from './ui/ApplicationErrorDialog.js';

export function RepositorySetupForm(props: { kind: 'clone' | 'init'; zh: boolean; setup: ReturnType<typeof useRepositorySetup> }) {
  const { kind, setup, zh } = props;
  const draft = setup.draft?.kind === kind ? setup.draft : null;
  const [source, setSource] = useState(draft?.source ?? '');
  const [destination, setDestination] = useState(draft?.localPath ?? (setup.job?.kind === kind ? setup.job.localPath : ''));
  const [name, setName] = useState(draft?.name ?? '');
  const [branch, setBranch] = useState(draft?.branch ?? '');
  const [recursive, setRecursive] = useState(draft?.recursive ?? false);
  const [depth, setDepth] = useState(draft?.depth ? String(draft.depth) : '');
  const [openWhenDone, setOpenWhenDone] = useState(true);
  const [picking, setPicking] = useState(false);
  const text = (cn: string, en: string) => zh ? cn : en;
  const invalidSource = kind === 'clone' && gitRemoteAddressIssue(source.trim());
  const invalidBranch = Boolean(branch.trim()) && gitBranchNameIssue(branch);
  const invalidDepth = Boolean(depth) && (!/^\d+$/u.test(depth) || Number(depth) < 1 || Number(depth) > 1_000_000);
  const labels = { running: text('正在创建仓库…', 'Creating repository…'), cancelling: text('正在停止…', 'Stopping…'), completed: text('仓库已创建', 'Repository ready'), failed: text('创建未完成', 'Setup failed'), cancelled: text('已停止', 'Stopped'), interrupted: text('上次任务的状态未确认', 'Previous task is unconfirmed') };
  return <section className="repository-setup" aria-label={kind === 'clone' ? text('克隆仓库', 'Clone repository') : text('初始化仓库', 'Initialize repository')}>
    <form onSubmit={event => { event.preventDefault(); if (!setup.busy && destination && !invalidSource && !invalidBranch && !invalidDepth) void setup.start({ kind, source: source.trim(), localPath: destination, name, branch: branch.trim(), recursive, ...(kind === 'clone' && depth ? { depth: Number(depth) } : {}) }, openWhenDone); }}>
      <fieldset disabled={setup.busy}>
        <legend>{kind === 'clone' ? text('克隆仓库', 'Clone repository') : text('创建本地 Git 仓库', 'Create a local Git repository')}</legend>
        {kind === 'clone' ? <label>{text('仓库地址', 'Source repository')}<input value={source} onChange={event => setSource(event.target.value)} placeholder="git@github.com:owner/repository.git" spellCheck={false} required />{invalidSource === 'credentials' ? <small role="alert">{text('地址中请勿填写密码或令牌，使用系统 Git 凭据助手认证。', 'Use the system Git credential helper; omit passwords and tokens from the address.')}</small> : source.trim() && invalidSource ? <small role="alert">{text('请输入 HTTPS、SSH、Git 地址或本地仓库绝对路径。', 'Enter an HTTPS, SSH or Git address, or an absolute local repository path.')}</small> : null}</label> : null}
        <label>{text('目标目录', 'Destination folder')}<span className="gitapp-path-row"><input value={destination} onChange={event => setDestination(event.target.value)} placeholder="/Users/you/code/repository" spellCheck={false} required /><Button variant="secondary" disabled={picking} onClick={async () => { setPicking(true); try { const value = await window.astraGit?.chooseDirectory?.(); if (value) setDestination(value); } finally { setPicking(false); } }}>{text('浏览…', 'Browse…')}</Button></span><small>{kind === 'clone' ? text('选择新目录或空目录。', 'Choose a new or empty folder.') : text('保留目录中的文件，不自动暂存或创建提交。', 'Existing files are kept. No files are staged and no commit is created.')}</small></label>
        <div className="repository-setup-grid"><label>{text('项目名称（可选）', 'Project name (optional)')}<input value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label><label>{kind === 'clone' ? text('检出分支／标签（可选）', 'Branch / tag (optional)') : text('初始分支', 'Initial branch')}<input value={branch} onChange={event => setBranch(event.target.value)} placeholder={kind === 'init' ? 'main' : text('远程默认分支', 'Remote default branch')} spellCheck={false} />{invalidBranch ? <small role="alert">{text('分支名称无效，不能包含空格或 Git 保留字符。', 'Invalid branch name. Avoid whitespace and Git reserved characters.')}</small> : null}</label></div>
        {kind === 'clone' ? <details><summary>{text('克隆选项', 'Clone options')}</summary><label className="repository-setup-check"><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} />{text('同时克隆子模块', 'Clone submodules recursively')}</label><label>{text('浅克隆深度（可选）', 'Shallow clone depth (optional)')}<input type="number" min={1} max={1_000_000} value={depth} onChange={event => setDepth(event.target.value)} placeholder={text('留空获取完整历史', 'Leave empty for full history')} /></label></details> : null}
        <label className="repository-setup-check"><input type="checkbox" checked={openWhenDone} onChange={event => setOpenWhenDone(event.target.checked)} />{text('完成后打开', 'Open when complete')}</label>
        {invalidDepth ? <small role="alert">{text('浅克隆深度必须为 1 到 1000000 的整数。', 'Clone depth must be an integer from 1 to 1000000.')}</small> : null}
        <Button type="submit" variant="primary" disabled={setup.busy || !destination || Boolean(invalidSource || invalidBranch || invalidDepth)}>{kind === 'clone' ? text('克隆', 'Clone') : text('初始化', 'Initialize')}</Button>
      </fieldset>
    </form>
    {setup.job || setup.error ? <section className="repository-setup-progress" aria-label={text('创建进度', 'Setup progress')}>
      {setup.job ? <><strong role="status">{labels[setup.job.status]}</strong><p>{setup.job.localPath}</p><pre tabIndex={0} aria-label={text('Git 输出', 'Git output')}>{setup.job.output || (setup.busy ? text('正在准备…', 'Preparing…') : text('Git 未返回输出。', 'Git returned no output.'))}</pre>{setup.job.error ? <p role="alert"><VisibleApplicationError error={setup.job.error} language={zh ? 'zh-CN' : 'en'} /></p> : null}{['failed', 'cancelled', 'interrupted'].includes(setup.job.status) ? <p>{text('请核对目标目录后再继续，应用不会自动清理已生成的文件。', 'Review the destination before continuing. The app does not automatically remove generated files.')}</p> : null}</> : null}
      {setup.error ? <p role="alert"><VisibleApplicationError error={setup.error} language={zh ? 'zh-CN' : 'en'} /></p> : null}
      <div>{setup.busy ? <Button variant="secondary" disabled={setup.job?.status === 'cancelling'} onClick={() => void setup.cancel()}>{text('停止', 'Stop')}</Button> : <Button variant="secondary" onClick={setup.clear}>{text('清除结果', 'Clear result')}</Button>}{setup.missing ? <Button variant="secondary" onClick={setup.clear}>{text('清除丢失的任务记录', 'Forget missing job')}</Button> : null}{setup.error && (setup.job || setup.busy) ? <Button variant="secondary" onClick={() => void setup.reconnect()}>{text('重新连接并核对', 'Reconnect and check')}</Button> : null}{setup.job?.status === 'completed' ? <Button onClick={() => void setup.open()}>{text('打开仓库', 'Open repository')}</Button> : null}</div>
    </section> : null}
  </section>;
}
