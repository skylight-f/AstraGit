import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitIgnorePreview, GitIgnoreScope, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { describeUserFacingError, userFacingErrorCause } from '@astragit/shared';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { gitIgnorePatterns, type GitIgnorePreset } from './gitIgnorePatterns.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';

export interface GitIgnoreRequest { repository: ProjectGitRepositoryWorkbenchItem; paths: string[]; directory?: string }
export function gitIgnoreNeedsReview(error: unknown) {
  if (describeUserFacingError(error).outcomeUnconfirmed) return true;
  for (let cause: ReturnType<typeof userFacingErrorCause> | undefined = userFacingErrorCause(error); cause; cause = cause.cause) if (cause.operationStatus === 'unknown_after_write' || cause.code === 'ASTRAGIT_GIT_IGNORE_CHANGED' || cause.code === 'ASTRAGIT_GIT_ACTION_REFRESH_FAILED') return true;
  return false;
}

export function GitIgnoreDialog(props: {
  request: GitIgnoreRequest; projectId: string; client: Pick<DashboardClient, 'loadProjectGitIgnorePreview'>; zh: boolean; busy: boolean;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const [request] = useState(props.request);
  const [scope, setScope] = useState<GitIgnoreScope>('repository');
  const initial = gitIgnorePatterns(request.paths, 'paths', request.directory);
  const [preset, setPreset] = useState<GitIgnorePreset>(initial ? 'paths' : 'custom');
  const [rules, setRules] = useState(initial?.join('\n') ?? '');
  const [preview, setPreview] = useState<GitIgnorePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [globalConfirmed, setGlobalConfirmed] = useState(false);
  const submitting = useRef(false); const alive = useRef(true);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setPreview(null); setLoading(true); setError(null); setNeedsReview(false); setGlobalConfirmed(false);
    void props.client.loadProjectGitIgnorePreview(props.projectId, request.repository.id, scope, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.client, props.projectId, request, scope, reload]);
  const patterns = rules.split(/\r?\n/u).filter(Boolean);
  const valid = patterns.length > 0 && patterns.length <= 200 && new TextEncoder().encode(rules).length <= 64 * 1024 && patterns.every(pattern => !/[\0\r\n]/u.test(pattern));
  const ready = preview && !props.busy && !loading && !needsReview && valid && (scope !== 'global' || globalConfirmed);
  async function submit() {
    if (!ready || !preview || submitting.current) return;
    submitting.current = true;
    try {
      const result = await props.onExecute(request.repository, { type: 'ignore', scope, patterns, expectedFingerprint: preview.fingerprint }, text('追加忽略规则', 'Append ignore rules'));
      if (!alive.current) return;
      if (result.outcome === 'completed') props.onClose();
      else if (result.error) { setError(result.error); setNeedsReview(gitIgnoreNeedsReview(result.error)); setGlobalConfirmed(false); }
    } catch (reason) { if (alive.current) { setError(reason); setNeedsReview(true); } }
    finally { submitting.current = false; }
  }
  const presets = [['paths', text('所选路径', 'Selected paths')], ['names', text('所有同名项', 'Same names anywhere')], ['extensions', text('所有相同扩展名文件', 'Same extensions anywhere')], ['directories', text('所在目录', 'Containing directories')], ['custom', text('自定义规则', 'Custom rules')]] as const;
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={text('忽略文件', 'Ignore files')} onDismiss={props.onClose} dismissDisabled={props.busy}>
    <section className="project-git-menu-action-dialog git-ignore-dialog" data-modal-surface="dialog">
      <header><strong>{text('忽略文件', 'Ignore files')}</strong><p>{request.repository.name} · {request.paths.length} {text('个未跟踪项', 'untracked items')}</p></header>
      <label>{text('保存范围', 'Save rules in')}<select value={scope} disabled={props.busy || loading} onChange={event => setScope(event.target.value as GitIgnoreScope)}><option value="repository">{text('当前仓库 .gitignore（可随提交共享）', 'Repository .gitignore (shareable in commits)')}</option><option value="local">{text('仅本机此仓库 info/exclude', 'Local repository info/exclude')}</option><option value="global">{text('Git 全局忽略文件', 'Git global ignore file')}</option></select></label>
      {loading ? <p role="status">{text('正在读取规则文件位置…', 'Reading the ignore file location…')}</p> : preview ? <p className="git-ignore-destination">{text(preview.exists ? '追加到现有文件：' : '创建规则文件：', preview.exists ? 'Append to existing file:' : 'Create ignore file:')}<code>{preview.filePath}</code>{preview.configuredPath !== preview.filePath ? <small>{text('配置路径：', 'Configured path: ')}{preview.configuredPath}</small> : null}</p> : null}
      <label>{text('规则类型', 'Rule type')}<select value={preset} disabled={props.busy} onChange={event => { const value = event.target.value as GitIgnorePreset; setPreset(value); setGlobalConfirmed(false); if (value !== 'custom') setRules(gitIgnorePatterns(request.paths, value, request.directory)?.join('\n') ?? ''); }}>{presets.map(([value, label]) => <option key={value} value={value} disabled={value !== 'custom' && !gitIgnorePatterns(request.paths, value, request.directory)}>{label}</option>)}</select></label>
      <label>{text('追加规则（每行一条，可编辑）', 'Rules to append (one per line, editable)')}<textarea rows={6} value={rules} disabled={props.busy} onChange={event => { setRules(event.target.value); setPreset('custom'); setGlobalConfirmed(false); }} /></label>
      {!initial ? <small>{text('部分路径包含换行，无法自动生成单行精确规则。请手动核对自定义模式的匹配范围。', 'Some paths contain line breaks and cannot use an exact single-line rule. Review a custom pattern’s scope.')}</small> : null}
      <p>{text('只追加规则，不删除文件，也不自动暂存。规则按 Git 优先级生效，已经跟踪的文件不受忽略规则影响。', 'Append rules without deleting or staging files. Git’s precedence rules apply; tracked files are not affected by ignore rules.')}</p>
      {scope === 'global' ? <label className="git-ignore-confirm"><input type="checkbox" checked={globalConfirmed} disabled={props.busy || loading} onChange={event => setGlobalConfirmed(event.target.checked)} />{text('已核对规则及实际保存路径；该文件可能影响其他仓库。', 'I reviewed these rules and the destination. This file may affect other repositories.')}</label> : null}
      {!valid && rules ? <p role="alert">{text('规则最多 200 条、64 KiB，不能包含 NUL。', 'Rules are limited to 200 lines and 64 KiB and cannot contain NUL.')}</p> : null}
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      {needsReview ? <p role="alert">{text('请先重新载入并核对规则文件，不要直接重复追加。', 'Reload and review the ignore file before appending again.')}</p> : null}
      <footer><Button variant="secondary" autoFocus disabled={props.busy} onClick={props.onClose}>{text('取消', 'Cancel')}</Button><Button variant="secondary" disabled={props.busy || loading} onClick={() => setReload(value => value + 1)}>{text('重新载入', 'Reload')}</Button><Button disabled={!ready} busy={props.busy} onClick={() => void submit()}>{text('追加规则', 'Append rules')}</Button></footer>
    </section>
  </ModalPortal>;
}
