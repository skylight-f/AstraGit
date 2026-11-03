import { X } from '@phosphor-icons/react/dist/csr/X';
import { ShieldCheck } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, ProjectRecord, GitCodeReviewInput, GitCodeReviewScope, GitCodeReviewReport, GitCodeReviewFinding } from './apiClient.js';
import { loadGitCommitModelOptions } from './git/gitCommitModels.js';
import { readCachedProjectGitWorkbench, requestProjectGitWorkbench } from './git/projectGitWorkbenchState.js';
import { ZeusSelect } from './ZeusSelect.js';
import type { WorkspaceSearchDestination } from './workspaceSearchState.js';
import './codeReview.css';

export function CodeReviewPanel({ client, project, zh, active, modelSettingsRevision, onClose, onSettings, onNavigate }: {
  client: DashboardClient; project: ProjectRecord; zh: boolean; active: boolean; modelSettingsRevision: number;
  onClose: () => void; onSettings: () => void; onNavigate: (destination: WorkspaceSearchDestination) => Promise<void>;
}) {
  const label = (cn: string, en: string) => zh ? cn : en;
  const [repositoryId, setRepositoryId] = useState('');
  const [mode, setMode] = useState<'worktree' | 'staged'>('worktree');
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [modelRef, setModelRef] = useState('');
  const [modelWarning, setModelWarning] = useState('');
  const [repositoryOptions, setRepositoryOptions] = useState<GitCodeReviewScope['repositories']>([]);
  const [scope, setScope] = useState<GitCodeReviewScope | null>(null);
  const [scopeError, setScopeError] = useState('');
  const [scopeLoading, setScopeLoading] = useState(true);
  const [report, setReport] = useState<GitCodeReviewReport | null>(null);
  const [thinking, setThinking] = useState('');
  const [completed, setCompleted] = useState(false);
  const thinkingView = useRef<HTMLPreElement>(null);
  const followThinking = useRef(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const [modelRevision, setModelRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    if (followThinking.current && thinkingView.current) thinkingView.current.scrollTop = thinkingView.current.scrollHeight;
  }, [thinking]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const apply = (snapshot: NonNullable<ReturnType<typeof readCachedProjectGitWorkbench>>) => {
      if (alive) setRepositoryOptions(snapshot.repositories.map(repo => ({ id: repo.id, name: repo.name, relativePath: repo.relativePath, fileCount: repo.snapshot.fileStatuses.length })));
    };
    const cached = readCachedProjectGitWorkbench(client, project.id);
    if (cached) apply(cached);
    else void requestProjectGitWorkbench(client, project.id).then(apply).catch(() => {});
    // 即使默认范围因冲突或文件过多受阻，也能选择其他仓库。
    return () => { alive = false; };
  }, [client, project.id, active]);
  useEffect(() => {
    let alive = true;
    void loadGitCommitModelOptions(client, project.id).then(value => {
      if (!alive) return;
      setModels(value.items); setModelWarning(value.warning);
      setModelRef(current => value.items.some(item => item.id === current) ? current : value.modelRef);
    }).catch(() => { if (alive) { setModels([]); setModelRef(''); setModelWarning(label('无法加载模型，请检查 AI 设置。', 'Unable to load models. Check AI settings.')); } });
    return () => { alive = false; };
  }, [client, project.id, modelSettingsRevision, modelRevision, zh]);
  useEffect(() => {
    if (!active || busy) return;
    let alive = true;
    let running = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const value = await client.loadCodeReviewScope(project.id, { repositoryId: repositoryId || undefined, mode, language: zh ? 'zh-CN' : 'en', modelRef: 'scope-only' }, controller.signal);
        if (alive) { setScope(value); if (!repositoryId) setRepositoryOptions(value.repositories); setScopeError(''); }
      } catch (failure) { if (alive && !controller.signal.aborted) setScopeError(failure instanceof Error ? failure.message : label('无法读取改动范围。', 'Unable to read changes.')); }
      finally { running = false; if (alive) setScopeLoading(false); }
    };
    setScopeLoading(true);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [client, project.id, repositoryId, mode, zh, active, busy, report]);

  const changeScope = (nextRepository: string, nextMode: 'worktree' | 'staged') => {
    setRepositoryId(nextRepository); setMode(nextMode); setScope(null); setReport(null); setThinking(''); setCompleted(false); setError(''); setNotice('');
  };
  const start = async () => {
    if (request.current || !modelRef) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setReport(null); setThinking(''); setCompleted(false); setNotice(''); followThinking.current = true;
    const input: GitCodeReviewInput = { repositoryId: repositoryId || undefined, mode, language: zh ? 'zh-CN' : 'en', modelRef };
    try {
      const value = await client.reviewProjectCode(project.id, input, controller.signal, event => {
        if (controller.signal.aborted || !mounted.current) return;
        if (event.type === 'thinking') { setThinking(current => current + event.text); return; }
        if (event.type === 'scope') {
          setScope(event.scope);
          setReport({ ...event.scope, summary: '', impacts: [], findings: [], checks: [], model: models.find(model => model.id === modelRef)?.label ?? '', reviewedAt: new Date().toISOString(), mode });
        } else if (event.type === 'finding') setReport(current => current ? { ...current, findings: [...current.findings, event.finding] } : current);
        else if (event.type === 'summary') setReport(current => current ? { ...current, summary: event.text } : current);
        else if (event.type === 'impact') setReport(current => current ? { ...current, impacts: [...current.impacts, event.text] } : current);
        else if (event.type === 'check') setReport(current => current ? { ...current, checks: [...current.checks, event.text] } : current);
      });
      if (!controller.signal.aborted && mounted.current) { setReport(value); setScope(value); setCompleted(true); }
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : label('评审失败，请重试。', 'Review failed. Please retry.'));
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const stale = Boolean(report && (scopeError || scope?.fingerprint !== report.fingerprint));
  const openFinding = async (finding: GitCodeReviewFinding) => {
    if (opening || stale || busy || !report) return;
    setOpening(true); setError('');
    try {
      const current = await client.loadCodeReviewScope(project.id, { repositoryId: repositoryId || undefined, mode, language: zh ? 'zh-CN' : 'en', modelRef: 'scope-only' });
      if (!mounted.current) return;
      setScope(current);
      if (current.fingerprint !== report.fingerprint) return;
      const snapshot = await client.loadProjectGitWorkbench(project.id);
      if (!mounted.current) return;
      const file = snapshot.repositories.find(repo => repo.id === finding.repositoryId)?.snapshot.fileStatuses.find(file => file.path === finding.path);
      if (!file) throw new Error(label('文件已变化，请重新评审。', 'The file changed. Run review again.'));
      await onNavigate({ kind: 'file', projectId: project.id, repositoryId: finding.repositoryId, path: finding.path, stage: mode === 'staged' || (file.workingTreeStatus === ' ' && file.indexStatus !== '?') ? 'staged' : 'unstaged' });
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : label('无法打开文件。', 'Unable to open file.')); }
    finally { if (mounted.current) setOpening(false); }
  };
  const severity = { high: label('高风险', 'High'), medium: label('中风险', 'Medium'), low: label('低风险', 'Low') };
  return <aside id="gitapp-code-review" className="gitapp-code-review macos-ai-app theme-light" aria-label={label('代码评审', 'Code review')} hidden={!active}>
    <header><ShieldCheck size={18} aria-hidden="true" /><strong>{label('代码评审', 'Code review')}</strong><button type="button" onClick={onClose} aria-label={label('关闭代码评审', 'Close code review')} title={label('关闭代码评审', 'Close code review')}><X size={17} /></button></header>
    <div className="gitapp-review-scroll">
      <div className="gitapp-review-controls">
        <p className="gitapp-review-project" title={project.localPath}>{project.name}</p>
        <label><span>{label('评审仓库', 'Repositories')}</span><ZeusSelect size="compact" ariaLabel={label('评审仓库', 'Review repositories')} value={repositoryId} disabled={busy} onChange={value => changeScope(value, mode)} options={[{ value: '', label: label('当前项目全部仓库', 'All repositories in project') }, ...repositoryOptions.map(repo => ({ value: repo.id, label: repo.relativePath === '.' ? repo.name : repo.relativePath }))]} /></label>
        <label><span>{label('改动范围', 'Changes')}</span><ZeusSelect size="compact" ariaLabel={label('评审改动范围', 'Review change scope')} value={mode} disabled={busy} onChange={value => changeScope(repositoryId, value as 'worktree' | 'staged')} options={[{ value: 'worktree', label: label('全部工作区改动', 'All working tree changes') }, { value: 'staged', label: label('仅已暂存改动', 'Staged changes only') }]} /></label>
        <label><span>{label('AI 模型', 'AI model')}</span><ZeusSelect size="compact" ariaLabel={label('评审 AI 模型', 'Review AI model')} value={modelRef} disabled={busy || !models.length} onChange={setModelRef} options={models.length ? models.map(model => ({ value: model.id, label: model.label })) : [{ value: '', label: label('请先配置 AI 模型', 'Configure an AI model') }]} /></label>
        <div className="gitapp-review-model-actions"><button type="button" onClick={onSettings}>{label('AI 设置', 'AI settings')}</button><button type="button" disabled={busy} onClick={() => setModelRevision(value => value + 1)}>{label('刷新模型', 'Refresh models')}</button></div>
        {modelWarning ? <p className="gitapp-review-note">{modelWarning}</p> : null}
        <p className="gitapp-review-note">{label('将所选范围的差异发送至所选模型，只读分析代码；不会执行测试。', 'Sends the selected diff to your model for read-only analysis. Tests are not executed.')}</p>
        <div className="gitapp-review-run"><span>{scopeLoading ? label('读取改动中…', 'Reading changes…') : scope ? label(`${scope.fileCount} 个文件 · ${scope.repositories.filter(repo => repo.fileCount).length} 个仓库`, `${scope.fileCount} files · ${scope.repositories.filter(repo => repo.fileCount).length} repositories`) : ''}</span>{busy ? <button type="button" onClick={() => { request.current?.abort(); setNotice(label('评审已取消。', 'Review cancelled.')); }}>{label('取消评审', 'Cancel review')}</button> : <button type="button" className="is-primary" disabled={!modelRef || scopeLoading || !scope?.fileCount || Boolean(scopeError)} onClick={() => { void start(); }}>{report ? label('重新评审', 'Review again') : label('开始评审', 'Start review')}</button>}</div>
      </div>
      {scopeError || error ? <p className="gitapp-review-error" role="alert">{error || scopeError}</p> : null}
      {notice ? <p className="gitapp-review-note" role="status">{notice}</p> : null}
      {busy ? <p className="gitapp-review-progress" role="status">{label('正在评审…', 'Reviewing…')} {report ? label(`已发现 ${report.findings.length} 个问题，新的问题将逐条显示。`, `${report.findings.length} issues found. New issues appear as they are identified.`) : label('正在读取差异。', 'Reading changes.')}</p> : null}
      {thinking ? <details className="gitapp-review-thinking" open><summary>{busy ? label('模型思考中…', 'Model thinking…') : label('模型思考过程', 'Model reasoning')}</summary><pre ref={thinkingView} onScroll={event => { const view = event.currentTarget; followThinking.current = view.scrollHeight - view.scrollTop - view.clientHeight < 24; }}>{thinking}</pre></details> : busy && report ? <p className="gitapp-review-note">{label('等待模型返回思考内容或评审问题；部分模型仅提供思考摘要。', 'Waiting for model reasoning or findings. Some models provide reasoning summaries only.')}</p> : null}
      {report ? <div className="gitapp-review-report">
        {!busy && !completed ? <p className="gitapp-review-stale" role="status">{label('评审未完成，以下仅为已收到的部分结果。', 'Review incomplete. Only the received partial results are shown below.')}</p> : null}
        <p className="gitapp-review-note">{report.model} · {new Date(report.reviewedAt).toLocaleTimeString()} · {report.fileCount} {label('个文件', 'files')}</p>
        {stale ? <p className="gitapp-review-stale" role="status">{label('代码已变化或暂时无法核对，以下为上次结果，请重新评审。', 'Code has changed or cannot be verified. Results below are from the previous review.')}</p> : null}
        {report.summary ? <section><h3>{label('改动概述', 'Summary')}</h3><p>{report.summary}</p></section> : null}
        {completed || report.impacts.length ? <section><h3>{label('修改影响', 'Impact')}</h3>{report.impacts.length ? <ul>{report.impacts.map((impact, index) => <li key={index}>{impact}</li>)}</ul> : <p>{label('未提供额外影响分析。', 'No additional impact analysis provided.')}</p>}</section> : null}
        <section><h3>{label('潜在问题', 'Potential issues')} <small>{report.findings.length}</small></h3>{report.findings.length ? report.findings.map((finding, index) => <article className="gitapp-review-finding" key={index}><div><span className={`gitapp-review-severity is-${finding.severity}`}>{severity[finding.severity]}</span><strong>{finding.title}</strong></div><button type="button" className="gitapp-review-location" disabled={busy || stale || opening} onClick={() => { void openFinding(finding); }}>{report.repositories.find(repo => repo.id === finding.repositoryId)?.name} / {finding.path}{finding.line ? `:${finding.line}` : ''}</button><p>{finding.detail}</p><p><b>{label('建议：', 'Suggestion: ')}</b>{finding.suggestion}</p></article>) : <p>{completed ? label('在提供的差异范围内未发现明确问题，仍需结合实际运行验证。', 'No definite issues found within the provided diff. Runtime verification is still needed.') : label('尚未收到完整问题，评审完成前不能据此判断没有问题。', 'No complete findings received yet. This does not indicate a clean review.')}</p>}</section>
        {completed || report.checks.length ? <section><h3>{label('建议验证', 'Suggested checks')}</h3>{report.checks.length ? <ul>{report.checks.map((check, index) => <li key={index}>{check}</li>)}</ul> : <p>{label('未提供额外验证建议。', 'No additional checks suggested.')}</p>}</section> : null}
        {report.limitations.length ? <section><h3>{label('评审范围说明', 'Review coverage')}</h3><ul>{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></section> : null}
      </div> : !busy && !scopeLoading && !scopeError && !error && !notice ? <div className="gitapp-review-empty"><ShieldCheck size={28} /><strong>{scope?.fileCount ? label('评审当前代码改动', 'Review current changes') : label('当前范围没有改动', 'No changes in this scope')}</strong><p>{scope?.fileCount ? label('选择模型并开始评审，查看修改影响、潜在缺陷和验证建议。', 'Choose a model and start a review for impact, potential issues and suggested checks.') : label('修改文件或调整评审范围后再开始。', 'Modify files or change the review scope to start.')}</p></div> : null}
    </div>
  </aside>;
}
