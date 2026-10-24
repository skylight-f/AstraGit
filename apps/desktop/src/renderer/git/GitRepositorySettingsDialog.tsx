import { useCallback, useEffect, useRef, useState } from 'react';
import { gitRemoteAddressIssue } from '@astragit/shared';
import type { DashboardClient, ProjectGitAction, ProjectGitRepositorySettings, ProjectGitRepositoryWorkbenchItem } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import type { ExecutionOutcome } from './gitWorkbenchTypes.js';
import { GitCommitTemplateSettings } from './GitCommitTemplateSettings.js';

type RemoteAction = Extract<ProjectGitAction, { type: 'configure_remote' }>;
type EditRemote = { operation: RemoteAction['operation']; name: string; value: string };
type SettingsAction = Omit<Extract<ProjectGitAction, { type: 'set_identity_field' }>, 'expectedSettingsFingerprint'> | Omit<RemoteAction, 'expectedSettingsFingerprint'>;

export function GitRepositorySettingsDialog(props: {
  client: Pick<DashboardClient, 'loadProjectGitRepositorySettings' | 'loadProjectGitCommitTemplate'>;
  projectId: string;
  repository: ProjectGitRepositoryWorkbenchItem;
  zh: boolean;
  busy: boolean;
  onClose: () => void;
  onExecute: (repository: ProjectGitRepositoryWorkbenchItem, action: ProjectGitAction, label: string) => Promise<ExecutionOutcome>;
}) {
  const [settings, setSettings] = useState<ProjectGitRepositorySettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<EditRemote | null>(null);
  const alive = useRef(true); const gate = useRef(false); const request = useRef(0);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const load = useCallback(async () => {
    const version = ++request.current; setLoading(true);
    try {
      const value = await props.client.loadProjectGitRepositorySettings(props.projectId, props.repository.id);
      if (alive.current && version === request.current) { setSettings(value); setError(null); }
    } catch (reason) { if (alive.current && version === request.current) setError(reason); }
    finally { if (alive.current && version === request.current) setLoading(false); }
  }, [props.client, props.projectId, props.repository.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current += 1; }; }, [load]);
  const disabled = saving || props.busy || loading;
  async function perform(action: SettingsAction) {
    if (!settings || disabled || gate.current) return;
    gate.current = true; setSaving(true);
    try {
      const outcome = await props.onExecute(props.repository, { ...action, expectedSettingsFingerprint: settings.fingerprint }, text('保存仓库设置', 'Save repository settings'));
      if (outcome === 'completed' && alive.current) { setEdit(null); await load(); }
    } catch (reason) { if (alive.current) setError(reason); }
    finally { gate.current = false; if (alive.current) setSaving(false); }
  }
  return <ModalPortal rootClassName="project-git-modal-root" backdropClassName="project-git-modal-backdrop" role="dialog" aria-label={text('仓库设置', 'Repository settings')} onDismiss={() => edit ? setEdit(null) : props.onClose()} dismissDisabled={saving || props.busy}>
    <section className="project-git-menu-action-dialog git-repository-settings" data-modal-surface="dialog">
      <header><strong>{text('仓库设置', 'Repository settings')} · {props.repository.name}</strong><p>{text('保存到当前仓库的本地 Git 配置。', 'Save to this repository’s local Git configuration.')}</p></header>
      {error ? <VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /> : null}
      {loading ? <p role="status">{text('正在读取设置…', 'Loading settings…')}</p> : null}
      {settings ? <>
        <section aria-label={text('提交身份', 'Commit identity')}><h3>{text('提交身份', 'Commit identity')}</h3>
          <IdentityField field="name" local={settings.identity.localName} effective={settings.identity.name} zh={props.zh} disabled={disabled} onSave={value => perform({ type: 'set_identity_field', field: 'name', value })} />
          <IdentityField field="email" local={settings.identity.localEmail} effective={settings.identity.email} zh={props.zh} disabled={disabled} onSave={value => perform({ type: 'set_identity_field', field: 'email', value })} />
        </section>
        <GitCommitTemplateSettings client={props.client} projectId={props.projectId} repository={props.repository} zh={props.zh} disabled={disabled} onExecute={props.onExecute} onChanged={load} />
        <section aria-label={text('远程仓库设置', 'Remote settings')}><h3>{text('远程仓库', 'Remotes')}</h3>
          {settings.remotes.map(remote => <article key={remote.name} className="git-settings-remote"><strong>{remote.name}</strong>{remote.fetchUrls.map((url, index) => <p key={`fetch:${index}`}>{text('获取', 'Fetch')} · {url}</p>)}{remote.pushUrls.length ? remote.pushUrls.map((url, index) => <p key={`push:${index}`}>{text('推送', 'Push')} · {url}</p>) : <p>{text('推送使用获取地址', 'Push uses the fetch address')}</p>}
            {!remote.editable ? <small>{text('继承自仓库外配置', 'Inherited from external configuration')}</small> : <div className="git-settings-actions">
              {(['rename', 'set_fetch_url', 'set_push_url', 'clear_push_url', 'remove'] as const).map(operation => <Button key={operation} size="compact" variant="secondary" disabled={disabled || (operation === 'clear_push_url' && !remote.pushUrls.length)} onClick={() => setEdit({ operation, name: remote.name, value: operation === 'rename' ? remote.name : '' })}>{remoteLabel(operation, props.zh)}</Button>)}
            </div>}
          </article>)}
          {!settings.remotes.length ? <p>{text('尚未配置远程仓库。', 'No remotes configured.')}</p> : null}
          <Button variant="secondary" disabled={disabled} onClick={() => setEdit({ operation: 'add', name: '', value: '' })}>{text('添加远程…', 'Add remote…')}</Button>
        </section>
        {edit ? <RemoteEditor key={`${edit.name}:${edit.operation}`} initial={edit} zh={props.zh} disabled={disabled} onCancel={() => setEdit(null)} onSave={value => perform({ type: 'configure_remote', ...value })} /> : null}
      </> : null}
      <footer><Button variant="secondary" disabled={saving || props.busy} onClick={() => void load()}>{text('重新载入', 'Reload')}</Button><Button disabled={saving || props.busy} onClick={props.onClose}>{text('关闭', 'Close')}</Button></footer>
    </section>
  </ModalPortal>;
}

function IdentityField(props: { field: 'name' | 'email'; local: string | null; effective: string; zh: boolean; disabled: boolean; onSave: (value: string | null) => Promise<void> }) {
  const [value, setValue] = useState(props.local ?? '');
  useEffect(() => { setValue(props.local ?? ''); }, [props.local]);
  const label = props.field === 'name' ? (props.zh ? '姓名' : 'Name') : props.zh ? '邮箱' : 'Email';
  return <div className="git-settings-identity"><label>{label}<input aria-label={props.zh ? `仓库提交${label}` : `Repository commit ${label.toLowerCase()}`} value={value} placeholder={props.effective} disabled={props.disabled} onChange={event => setValue(event.target.value)} maxLength={500} /></label><div className="git-settings-actions"><Button size="compact" disabled={props.disabled || !value.trim() || value.trim() === props.local} onClick={() => void props.onSave(value.trim())}>{props.zh ? `保存${label}` : `Save ${label.toLowerCase()}`}</Button><Button size="compact" variant="secondary" disabled={props.disabled || props.local === null} onClick={() => void props.onSave(null)}>{props.zh ? '恢复继承' : 'Use inherited value'}</Button></div><small>{props.zh ? '当前生效：' : 'Effective: '}{props.effective || (props.zh ? '未配置' : 'Not configured')}</small></div>;
}

function remoteLabel(operation: RemoteAction['operation'], zh: boolean): string {
  const labels = { add: ['添加远程', 'Add remote'], rename: ['重命名…', 'Rename…'], set_fetch_url: ['修改获取地址…', 'Edit fetch URL…'], set_push_url: ['设置推送地址…', 'Set push URL…'], clear_push_url: ['推送使用获取地址…', 'Use fetch URL for push…'], remove: ['移除远程…', 'Remove remote…'] } as const;
  return labels[operation][zh ? 0 : 1];
}

function RemoteEditor(props: { initial: EditRemote; zh: boolean; disabled: boolean; onCancel: () => void; onSave: (value: EditRemote) => Promise<void> }) {
  const [name, setName] = useState(props.initial.name); const [value, setValue] = useState(props.initial.value); const [confirm, setConfirm] = useState(false);
  const operation = props.initial.operation;
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const destructive = operation === 'remove' || operation === 'clear_push_url';
  const url = ['add', 'set_fetch_url', 'set_push_url'].includes(operation);
  const invalid = !name.trim() || (url ? Boolean(gitRemoteAddressIssue(value.trim())) : operation === 'rename' ? !value.trim() || value.trim() === name : !confirm);
  return <form className="git-settings-editor" onSubmit={event => { event.preventDefault(); if (!props.disabled && !invalid) void props.onSave({ operation, name: name.trim(), value: value.trim() }); }}><h3>{remoteLabel(operation, props.zh)}</h3>
    <label>{text('远程名称', 'Remote name')}<input value={name} disabled={props.disabled || operation !== 'add'} onChange={event => setName(event.target.value)} required /></label>
    {url || operation === 'rename' ? <label>{url ? text('新地址', 'New URL') : text('新名称', 'New name')}<input value={value} disabled={props.disabled} onChange={event => setValue(event.target.value)} spellCheck={false} required />{url && value.trim() && gitRemoteAddressIssue(value.trim()) ? <small role="alert">{text('请输入不含密码或令牌的有效 Git 地址。', 'Enter a valid Git address without passwords or tokens.')}</small> : null}</label> : null}
    {operation === 'set_fetch_url' ? <p>{text('修改第一个获取地址，其余获取地址保留。', 'Replace the first fetch URL; other fetch URLs are retained.')}</p> : operation === 'set_push_url' ? <p>{text('使用此地址替换该远程的全部独立推送地址。', 'Replace all explicit push URLs for this remote with this address.')}</p> : null}
    {destructive ? <label className="git-checkout-stash"><input type="checkbox" checked={confirm} disabled={props.disabled} onChange={event => setConfirm(event.target.checked)} />{operation === 'remove' ? text('确认移除此远程配置及本地远程跟踪引用，服务器上的仓库和分支保留。', 'Remove this remote configuration and local remote-tracking refs. The server repository and branches are kept.') : text('确认移除全部独立推送地址，之后推送使用获取地址。', 'Remove all explicit push URLs. Pushes will use the fetch address.')}</label> : null}
    <div className="git-settings-actions"><Button type="button" variant="secondary" disabled={props.disabled} onClick={props.onCancel}>{text('取消', 'Cancel')}</Button><Button type="submit" disabled={props.disabled || invalid}>{text('保存', 'Save')}</Button></div>
  </form>;
}
