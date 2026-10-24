import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitExternalToolConfiguration, GitExternalToolInput, GitExternalToolKind, GitExternalToolPreview, GitExternalToolSettings, ProjectGitAction, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import './gitExternalTool.css';

export interface GitExternalToolRequest { repository: ProjectGitRepositoryWorkbenchItem; input?: GitExternalToolInput }
export function GitExternalToolDialog(props: {
  request: GitExternalToolRequest; projectId: string; zh: boolean; busy: boolean;
  client: Pick<DashboardClient, 'loadRepositoryGitExternalTools' | 'previewRepositoryGitExternalTool'>;
  onClose(): void; onAbort(): Promise<void>;
  onExecute(repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string): Promise<{ outcome: ExecutionOutcome; error?: unknown }>;
}) {
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const [tab, setTab] = useState<'run' | 'settings'>(props.request.input ? 'run' : 'settings');
  const [settings, setSettings] = useState<GitExternalToolSettings | null>(null); const [preview, setPreview] = useState<GitExternalToolPreview | null>(null);
  const [kind, setKind] = useState<GitExternalToolKind>(props.request.input?.mode ?? 'diff'); const [scope, setScope] = useState<'local' | 'global'>('local');
  const [name, setName] = useState(''); const [command, setCommand] = useState(''); const [executable, setExecutable] = useState(''); const [backup, setBackup] = useState('inherit');
  const [runName, setRunName] = useState(''); const [markResolved, setMarkResolved] = useState(false);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<unknown>(null); const [feedback, setFeedback] = useState('');
  const alive = useRef(true); const gate = useRef(false); const request = useRef<AbortController | null>(null);
  const form = useRef({ kind, scope }); form.current = { kind, scope };
  const resetFields = (value: GitExternalToolSettings, nextKind: GitExternalToolKind, nextScope: 'local' | 'global', nextName?: string) => {
    const selected = nextName ?? value.entries.find(item => item.key === `${nextKind}.tool`)?.[nextScope] ?? value.selected[nextKind] ?? '';
    const owned = (key: string) => value.entries.find(item => item.key === key)?.[nextScope] ?? '';
    setName(selected); setCommand(owned(`${nextKind}tool.${selected}.cmd`)); setExecutable(owned(`${nextKind}tool.${selected}.path`)); setBackup(owned('mergetool.keepbackup') || 'inherit');
  };
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true);
    try {
      const value = await props.client.loadRepositoryGitExternalTools(props.projectId, props.request.repository.id, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setSettings(value); resetFields(value, form.current.kind, form.current.scope); setRunName(value.selected[props.request.input?.mode ?? 'diff'] ?? ''); setPreview(null); setError(null);
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [props.client, props.projectId, props.request.repository.id, props.request.input?.mode]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);
  const input: GitExternalToolInput | null = props.request.input ? { ...props.request.input, ...(runName ? { toolName: runName } : {}), ...(props.request.input.mode === 'merge' ? { markResolved } : {}) } : null;
  const identity = input ? JSON.stringify(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) : '';
  const currentIdentity = useRef(identity); currentIdentity.current = identity; const previousIdentity = useRef(identity);
  useEffect(() => { if (previousIdentity.current === identity) return; previousIdentity.current = identity; request.current?.abort(); setLoading(false); setPreview(null); }, [identity]);
  const locked = saving || props.busy;
  async function prepare() {
    if (!input || locked || loading) return; request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true); setPreview(null); setError(null);
    const selectedIdentity = identity;
    try {
      const value = await props.client.previewRepositoryGitExternalTool(props.projectId, props.request.repository.id, input, controller.signal);
      if (alive.current && !controller.signal.aborted && selectedIdentity === currentIdentity.current) setPreview(value);
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }
  async function perform(action: ProjectGitAction, close: boolean) {
    if (locked || gate.current) return; gate.current = true; setSaving(true); setError(null); setFeedback('');
    try {
      const result = await props.onExecute(props.request.repository, action, action.type === 'configure_external_tool' ? text('保存外部工具设置', 'Save external tool settings') : text('启动外部工具', 'Launch external tool'));
      if (!alive.current) return;
      setPreview(null);
      if (result.outcome === 'completed') { if (close) props.onClose(); else { await load(); setFeedback(text('配置已保存。', 'Settings saved.')); } }
      else setError(result.error ?? new Error(text('工具操作未完成，请核对实际文件和 Git 状态。', 'The tool operation did not complete. Review actual files and Git state.')));
    } catch (reason) { if (alive.current) { setError(reason); setPreview(null); } }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  const configuration = (inheritSelection = false): GitExternalToolConfiguration => ({ scope, kind, toolName: name || 'opendiff', command: command || null, executable: executable || null, ...(kind === 'merge' ? { keepBackup: backup === 'inherit' ? null : backup === 'true' } : {}), ...(inheritSelection ? { inheritSelection: true } : {}) });
  const activeTools = settings?.tools.filter(item => item.kind === kind) ?? [];
  return <ModalPortal role="dialog" aria-label={text('外部差异与合并工具', 'External diff and merge tools')} rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" onDismiss={props.onClose} dismissDisabled={locked}>
    <section className="git-external-tool-dialog" data-modal-surface="dialog">
      <header><strong>{text('外部工具', 'External tools')} · {props.request.repository.name}</strong><Button variant="secondary" disabled={locked} onClick={props.onClose}>{text('关闭', 'Close')}</Button></header>
      <nav aria-label={text('外部工具页面', 'External tool pages')}>
        {input ? <button type="button" aria-pressed={tab === 'run'} disabled={locked} onClick={() => setTab('run')}>{text('启动工具', 'Launch tool')}</button> : null}
        <button type="button" aria-pressed={tab === 'settings'} disabled={locked} onClick={() => setTab('settings')}>{text('工具设置', 'Tool settings')}</button>
      </nav>
      <div className="git-external-tool-content">
        {loading ? <p role="status">{text('正在读取工具与文件…', 'Reading tools and files…')}</p> : null}
        {error ? <div role="alert"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></div> : null}
        {tab === 'run' && input ? <>
          <h3>{input.mode === 'merge' ? text('处理所选冲突', 'Resolve selected conflicts') : text('比较所选文件版本', 'Compare selected file versions')}</h3>
          <label>{text('使用工具', 'Use tool')}<input value={runName} disabled={locked} list="git-external-run-tools" onChange={event => setRunName(event.target.value)} placeholder={settings?.selected[input.mode] ?? text('请先选择或配置工具', 'Select or configure a tool')} /><datalist id="git-external-run-tools">{settings?.tools.filter(item => item.kind === input.mode).map(item => <option key={item.name} value={item.name}>{item.available ? item.configured ? text('自定义', 'Custom') : text('可用', 'Available') : text('未安装或路径未配置', 'Unavailable')}</option>)}</datalist></label>
          {input.mode === 'merge' ? <><p>{text('外部工具处理磁盘中的冲突文件，内置编辑器未保存的草稿仍保留。工具必须等待编辑窗口关闭后退出；取消后请关闭仍打开的外部窗口并核对文件。', 'The external tool edits conflict files on disk. Unsaved built-in drafts are retained. The tool must wait until its editor closes; after cancellation, close any remaining external windows and review the files.')}</p><label className="git-external-check"><input type="checkbox" checked={markResolved} disabled={locked} onChange={event => setMarkResolved(event.target.checked)} />{text('工具成功退出且核对通过后，暂存所选文件并标记为已解决', 'After a successful tool exit and validation, stage selected files and mark them resolved')}</label><small>{text('未勾选时只回到内置编辑器复核，不自动暂存。不会继续整合或创建提交。', 'Otherwise return to the built-in editor for review without staging. No integration is continued and no commit is created.')}</small></> : <p>{text('将所选版本的临时副本交给差异工具；本操作不自动暂存或提交文件。', 'Pass temporary copies of the selected versions to the diff tool. This action does not stage or commit files.')}</p>}
          <ul>{input.paths.map(path => <li key={path}>{path}</li>)}</ul>
          <Button variant="secondary" disabled={locked || loading} onClick={() => void prepare()}>{text('读取并核对版本', 'Read and review versions')}</Button>
          {preview ? <section className="git-external-tool-preview"><strong>{preview.toolName}</strong>{preview.command ? <pre>{preview.command}</pre> : null}{preview.files.map(file => <article key={file.path}><strong>{file.path}</strong><small>{versionLabel(file.beforeLabel, props.zh)} ({file.beforeBytes} B) → {versionLabel(file.afterLabel, props.zh)} ({file.afterBytes} B)</small></article>)}<Button disabled={locked} onClick={() => void perform({ type: 'external_tool', input: preview.input, expectedFingerprint: preview.fingerprint }, true)}>{text('启动并等待工具退出', 'Launch and wait for the tool')}</Button></section> : null}
        </> : tab === 'settings' && settings ? <>
          <div className="git-external-tool-grid"><label>{text('工具类型', 'Tool type')}<select value={kind} disabled={locked} onChange={event => { const value = event.target.value as GitExternalToolKind; setKind(value); resetFields(settings, value, scope); }}><option value="diff">{text('差异比较', 'Diff')}</option><option value="merge">{text('冲突合并', 'Merge')}</option></select></label><label>{text('保存范围', 'Save scope')}<select value={scope} disabled={locked} onChange={event => { const value = event.target.value as typeof scope; setScope(value); resetFields(settings, kind, value); }}><option value="local">{text('当前仓库', 'This repository')}</option><option value="global">{text('全局 Git（影响其他仓库及 Git 应用）', 'Global Git (affects other repositories and Git apps)')}</option></select></label></div>
          <p>{text('当前生效工具：', 'Effective tool: ')}{settings.selected[kind] ?? text('未指定', 'Not selected')}</p>
          <label>{text('工具名称', 'Tool name')}<input value={name} disabled={locked} list="git-external-setting-tools" onChange={event => { const value = event.target.value; if (activeTools.some(item => item.name === value)) resetFields(settings, kind, scope, value); else setName(value); }} placeholder="opendiff / vscode / custom-name" /><datalist id="git-external-setting-tools">{activeTools.map(item => <option key={item.name} value={item.name}>{item.available ? text('可用', 'Available') : text('未安装或路径未配置', 'Unavailable')}</option>)}</datalist></label>
          <label>{text('可执行路径覆盖（可选）', 'Executable path override (optional)')}<input value={executable} disabled={locked} onChange={event => setExecutable(event.target.value)} spellCheck={false} /></label>
          <label>{text('自定义命令（可选）', 'Custom command (optional)')}<textarea rows={3} value={command} disabled={locked} onChange={event => setCommand(event.target.value)} spellCheck={false} placeholder={kind === 'diff' ? 'tool --wait --diff "$LOCAL" "$REMOTE"' : 'tool --wait --merge "$LOCAL" "$REMOTE" "$BASE" "$MERGED"'} /><small>{text('Git 按 Shell 命令运行；含空格的文件变量需要引号。使用内置工具时可留空，留空会移除此范围的命令或路径覆盖。', 'Git runs this as a shell command; quote file variables containing spaces. Leave empty for a built-in tool, or to remove this scope’s command/path override.')}</small></label>
          {kind === 'merge' ? <label>{text('保留 .orig 备份', 'Keep .orig backups')}<select value={backup} disabled={locked} onChange={event => setBackup(event.target.value)}><option value="inherit">{text('继承 Git 配置', 'Inherit Git configuration')}</option><option value="true">{text('保留', 'Keep')}</option><option value="false">{text('不保留', 'Do not keep')}</option></select></label> : null}
          <div className="git-external-tool-actions"><Button disabled={locked || loading || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(name)} onClick={() => void perform({ type: 'configure_external_tool', configuration: configuration(), expectedFingerprint: settings.fingerprint }, false)}>{text('保存这组设置', 'Save these settings')}</Button><Button variant="secondary" disabled={locked || loading} onClick={() => void perform({ type: 'configure_external_tool', configuration: configuration(true), expectedFingerprint: settings.fingerprint }, false)}>{text('移除此范围的默认工具覆盖', 'Remove default tool override in this scope')}</Button></div>
          <details><summary>{text('当前配置与继承值', 'Current configuration and inherited values')}</summary>{settings.entries.filter(item => item.key.startsWith(`${kind}.`) || item.key.startsWith(`${kind}tool.`)).map(item => <div key={item.key} className="git-external-config-entry"><strong>{item.key}</strong><pre>{item.value ?? '—'}</pre><small>{text('当前范围：', 'In selected scope: ')}{item[scope] ?? text('未设置，使用继承值', 'Not set; inherited')}</small></div>)}</details>
        </> : null}
        {feedback ? <p role="status">{feedback}</p> : null}
      </div>
      <footer><Button variant="secondary" disabled={locked || loading} onClick={() => void load()}>{text('重新载入', 'Reload')}</Button>{saving ? <Button variant="secondary" onClick={() => void props.onAbort().catch(setError)}>{text('中止并核对结果', 'Cancel and review outcome')}</Button> : null}</footer>
    </section>
  </ModalPortal>;
}

function versionLabel(value: string, zh: boolean) { return zh ? value.replace("Git index stages 1/2/3", "Git 冲突版本合计").replace("Before", "变更前").replace("After", "变更后").replace("Working tree", "工作区").replace("Index", "暂存区").replace("Missing", "不存在") : value; }
