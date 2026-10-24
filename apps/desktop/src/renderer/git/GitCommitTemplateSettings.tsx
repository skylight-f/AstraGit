import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitCommitTemplate, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitCommitTemplate.css';

export function GitCommitTemplateSettings(props: {
  client: Pick<DashboardClient, 'loadProjectGitCommitTemplate'>;
  projectId: string; repository: ProjectGitRepositoryWorkbenchItem; zh: boolean; disabled: boolean;
  onChanged: () => Promise<void>;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [template, setTemplate] = useState<GitCommitTemplate | null>(null); const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'content' | 'file'>('content'); const [content, setContent] = useState(''); const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const alive = useRef(true); const request = useRef(0); const controller = useRef<AbortController | null>(null); const gate = useRef(false);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  async function load() {
    const version = ++request.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setLoading(true);
    try {
      const value = await props.client.loadProjectGitCommitTemplate(props.projectId, props.repository.id, abort.signal);
      if (alive.current && version === request.current && !abort.signal.aborted) { setTemplate(value); setContent(value.content); setPath(value.path ?? ''); setError(value.problem ? { code: value.problem } : null); }
    } catch (reason) { if (alive.current && !abort.signal.aborted && version === request.current) setError(reason); }
    finally { if (alive.current && version === request.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current += 1; controller.current?.abort(); }; }, [props.projectId, props.repository.id, props.client]);
  async function save(operation: 'content' | 'file' | 'inherit') {
    if (!template || gate.current || props.disabled || loading) return;
    gate.current = true; setSaving(true);
    try {
      const outcome = await props.onExecute(props.repository, { type: 'configure_commit_template', operation, ...(operation === 'inherit' ? {} : { value: operation === 'content' ? content : path }), expectedFingerprint: template.fingerprint }, text('设置提交模板', 'Configure commit template'));
      if (outcome === 'completed' && alive.current) { await load(); await props.onChanged(); }
    } catch (reason) { if (alive.current) setError(reason); }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  const disabled = props.disabled || loading || saving;
  return <section className="git-template-settings" aria-label={text('提交模板设置', 'Commit template settings')}>
    <h3>{text('提交模板', 'Commit template')}</h3>
    <p>{text('新说明为空时默认填入模板；已有手工或 AI 草稿保留。编辑会另存本仓库模板，不覆盖原文件或全局设置。', 'Templates initialize empty new messages. Existing manual or AI drafts are kept. Edits create a repository template without overwriting original files or global settings.')}</p>
    {template ? <small>{template.source === 'none' ? text('尚未配置模板', 'No template configured') : `${template.source === 'local' ? text('本仓库', 'This repository') : text('继承', 'Inherited')} · ${template.path}`}</small> : null}
    {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
    <label>{text('设置方式', 'Configure using')}<select aria-label={text('模板设置方式', 'Template configuration mode')} disabled={disabled} value={mode} onChange={event => setMode(event.target.value === 'file' ? 'file' : 'content')}><option value="content">{text('编辑模板内容', 'Edit template text')}</option><option value="file">{text('使用已有文件', 'Use an existing file')}</option></select></label>
    {mode === 'content' ? <label>{text('模板内容', 'Template text')}<textarea aria-label={text('仓库提交模板内容', 'Repository commit template text')} rows={5} maxLength={30_000} value={content} disabled={disabled} onChange={event => setContent(event.target.value)} /></label> : <label>{text('模板文件路径', 'Template file path')}<input aria-label={text('仓库提交模板路径', 'Repository commit template path')} spellCheck={false} value={path} disabled={disabled} onChange={event => setPath(event.target.value)} /></label>}
    <small>{text('注释可在此预览，填入说明时由 Git 移除；空内容可作为本仓库的空模板。', 'Comments remain visible here and Git removes them when inserting the draft. Empty text creates an empty repository template.')}</small>
    <div className="git-settings-actions"><Button variant="secondary" size="compact" disabled={disabled} onClick={() => void load()}>{text('重新读取模板', 'Reload template')}</Button><Button variant="secondary" size="compact" disabled={disabled || !template || template.localPath === null} onClick={() => void save('inherit')}>{text('模板恢复继承', 'Use inherited template')}</Button><Button size="compact" disabled={disabled || !template || (mode === 'file' && !path)} busy={saving} onClick={() => void save(mode)}>{text('保存模板', 'Save template')}</Button></div>
  </section>;
}
