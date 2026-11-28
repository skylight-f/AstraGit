import { Select, TextInput } from '../../ui/FormControls.js';
import { useEffect, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { Eye } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlash } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { PencilSimple } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import type { CodexAccount, CodexLogin, DashboardClient, ModelConnection, ModelConnectionModel, ModelTemplateId } from '../../api/apiClient.js';
import { readDisabledCodexModels, saveDisabledCodexModels, watchModelCatalog } from './gitCommitModels.js';
import { Button } from '../../ui/Button.js';

type Protocol = ModelConnectionModel['protocolFamily'];
type ProviderDraft = Pick<ModelConnection, 'name' | 'baseUrl' | 'templateId' | 'modelsPath' | 'protocolFamily' | 'enabled' | 'models' | 'pricingUrl'> & { apiKey: string };
type ModelEditor = { existingId?: string; modelId: string; displayName: string; enabled: boolean };

const defaultProtocol: Protocol = 'openai_completions';
const protocolNames: Record<Protocol, string> = {
  openai_completions: '/chat/completions · OpenAI',
  openai_responses: '/responses · OpenAI',
  anthropic_messages: '/messages · Anthropic',
};
const emptyProvider: ProviderDraft = { name: '', baseUrl: '', templateId: 'custom', modelsPath: '/models', protocolFamily: defaultProtocol, enabled: true, models: [], apiKey: '' };

export function ModelSettings({ client, language, onChanged }: { client: DashboardClient; language: 'zh-CN' | 'en-US'; onChanged: () => void }) {
  const zh = language === 'zh-CN';
  const [templates, setTemplates] = useState<Awaited<ReturnType<DashboardClient['loadModelConnectionTemplates']>> | null>(null);
  const [connections, setConnections] = useState<ModelConnection[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<ProviderDraft>();
  const [showKey, setShowKey] = useState(false);
  const [editor, setEditor] = useState<ModelEditor>();
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [disabledCodexModels, setDisabledCodexModels] = useState(readDisabledCodexModels);
  const [login, setLogin] = useState<CodexLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState<Awaited<ReturnType<DashboardClient['testModelConnection']>>>();

  const selection = selectedId ?? connections?.[0]?.id ?? 'new';
  const connection = connections?.find(item => item.id === selection);
  const provider = draft ?? (connection ? { ...connection, apiKey: '' } : emptyProvider);
  const models = connection?.models ?? provider.models;
  const isCodex = selection === 'codex';
  const codexModels = account?.models ?? [];
  const providerProtocol = provider.protocolFamily ?? (models.length ? '' : defaultProtocol);

  useEffect(() => {
    let active = true;
    void client.loadModelConnectionTemplates().then(items => {
      if (active) setTemplates(items);
    }).catch(error => {
      if (active) setMessage(errorText(error));
    });
    void client.loadModelConnections().then(items => {
      if (active) setConnections(items);
    }).catch(error => {
      if (active) setMessage(errorText(error));
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!isCodex || login || busy) return;
    let active = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const nextAccount = await client.loadCodexAccount();
        if (active) setAccount(nextAccount);
      } catch (error) {
        if (active) setAccount(current => current ?? { available: false, signedIn: false, message: errorText(error) });
      } finally {
        reading = false;
      }
    };
    void read();
    const unwatch = watchModelCatalog(() => void read());
    return () => { active = false; unwatch(); };
  }, [client, isCodex, login, busy]);

  useEffect(() => {
    if (!login) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await client.loadCodexLoginStatus(login);
        if (!active) return;
        if (result.status === 'succeeded') {
          const nextAccount = await client.loadCodexAccount();
          if (!active) return;
          setLogin(null);
          setAccount(nextAccount);
          setMessage(zh ? 'Codex 已登录。' : 'Codex is signed in.');
          onChanged();
          return;
        }
        if (result.status === 'failed') {
          setLogin(null);
          setMessage(result.error || (zh ? 'Codex 登录失败。' : 'Codex sign in failed.'));
          return;
        }
      } catch (error) {
        if (active) {
          setLogin(null);
          setMessage(errorText(error));
        }
        return;
      }
      timer = setTimeout(() => void check(), 2_000);
    };
    timer = setTimeout(() => void check(), 2_000);
    return () => { active = false; clearTimeout(timer); };
  }, [login, client, onChanged, zh]);

  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function selectProvider(id: string, nextDraft?: ProviderDraft): void {
    if ((draft || editor) && !window.confirm(zh ? '放弃未保存的更改？' : 'Discard unsaved changes?')) return;
    setSelectedId(id);
    setDraft(nextDraft);
    setDiagnostic(undefined);
    setEditor(undefined);
    setShowKey(false);
    setMessage('');
  }

  function updateProvider(changes: Partial<ProviderDraft>): void {
    setDraft({ ...provider, ...changes });
    setDiagnostic(undefined);
  }

  function updateConnection(updated: ModelConnection): void {
    setConnections(items => {
      const current = items ?? [];
      return current.some(item => item.id === updated.id)
        ? current.map(item => item.id === updated.id ? updated : item)
        : [...current, updated];
    });
    onChanged();
  }

  function saveProvider(): void {
    const baseUrl = provider.baseUrl.trim();
    const apiKey = provider.apiKey.trim();
    const allowInsecureHttp = /^http:/iu.test(baseUrl);
    if (allowInsecureHttp && (baseUrl !== connection?.baseUrl || apiKey) && !window.confirm(zh
      ? 'HTTP 不会加密 API Key 和提交内容。确认仍要使用此地址？'
      : 'HTTP does not encrypt your API key or commit contents. Continue with this URL?')) return;
    void perform(async () => {
      const input = { ...provider, name: provider.name.trim(), baseUrl, modelsPath: provider.modelsPath.trim(), models, apiKey: apiKey || undefined, allowInsecureHttp };
      const updated = connection ? await client.updateModelConnection(connection.id, input) : await client.createModelConnection(input);
      setSelectedId(updated.id);
      setDraft(undefined);
      setShowKey(false);
      updateConnection(updated);
      setMessage(zh ? '供应商已保存。' : 'Provider saved.');
    });
  }

  function removeProvider(item: ModelConnection): void {
    if (!window.confirm(zh ? `删除供应商「${item.name}」及其模型？` : `Delete provider “${item.name}” and its models?`)) return;
    void perform(async () => {
      await client.removeModelConnection(item.id);
      setConnections(items => items?.filter(candidate => candidate.id !== item.id) ?? []);
      setSelectedId(undefined);
      setDraft(undefined);
      setDiagnostic(undefined);
      setEditor(undefined);
      setShowKey(false);
      onChanged();
    });
  }

  function saveModel(item: ModelConnection, values: ModelEditor): void {
    const { existingId, modelId, displayName, enabled } = values;
    void perform(async () => {
      const updated = existingId
        ? await client.updateModelConnection(item.id, {
            ...item,
            models: item.models.map(model => model.id === existingId ? { ...model, displayName: displayName.trim() || model.id, enabled } : model),
          })
        : await client.addManualModel(item.id, { modelId: modelId.trim(), displayName: displayName.trim(), enabled });
      updateConnection(updated);
      setEditor(undefined);
    });
  }

  function toggleCodexModel(id: string, enabled: boolean): void {
    const next = enabled ? disabledCodexModels.filter(model => model !== id) : [...disabledCodexModels, id];
    try { saveDisabledCodexModels(next); }
    catch { setMessage(zh ? '无法保存 Codex 模型选择。' : 'Could not save Codex model selection.'); return; }
    setMessage('');
    setDisabledCodexModels(next);
    onChanged();
  }

  const diagnosticText = diagnostic?.ok
    ? (zh ? `${diagnostic.discoveredModelCount} 个模型` : `${diagnostic.discoveredModelCount} models`)
    : diagnostic?.message;
  const canSave = Boolean(draft && provider.name.trim() && provider.baseUrl.trim() && provider.modelsPath.trim() && (connection || provider.apiKey.trim()));
  const savedKeyHint = connection?.apiKeyConfigured
    ? (zh ? '已配置 · 输入新密钥可替换' : 'Configured · Enter a new key to replace it')
    : (zh ? '输入供应商的 API Key' : 'Enter your provider API key');

  return (
    <div className="gitapp-model-settings">
      <div className="gitapp-model-scroll">
        <div className="gitapp-model-content">
          <header className="gitapp-model-intro">
            <h2>{zh ? '模型' : 'Models'}</h2>
            <p>{zh ? '配置 AI 生成提交说明和代码评审使用的模型。API Key 保存在本机。' : 'Configure models for AI commit messages and code review. API keys stay on this device.'}</p>
          </header>

          <div className="gitapp-model-toolbar" role="group" aria-label={zh ? '模型供应商' : 'Model providers'}>
            <Button size="compact" className="gitapp-model-icon" disabled={busy} title={zh ? '刷新供应商列表' : 'Reload providers'} aria-label={zh ? '刷新供应商列表' : 'Reload providers'} onClick={() => void perform(async () => {
              const items = await client.loadModelConnections();
              if (connection && !items.some(item => item.id === connection.id)) {
                setSelectedId(undefined);
                setDraft(undefined);
                setEditor(undefined);
                setShowKey(false);
              }
              setConnections(items);
              setDiagnostic(undefined);
              onChanged();
            })}><ArrowsClockwise size={16} aria-hidden="true" /></Button>
            <Button size="compact" disabled={busy || !connections} onClick={() => selectProvider('new', emptyProvider)}><Plus size={16} aria-hidden="true" />{zh ? '添加供应商' : 'Add provider'}</Button>
            {connections?.map(item => (
              <Button size="compact" key={item.id} className="gitapp-model-provider-tab" aria-pressed={selection === item.id} disabled={busy} title={item.name} onClick={() => { if (selection !== item.id) selectProvider(item.id); }}>
                <span className="gitapp-model-provider-symbol" aria-hidden="true">{Array.from(item.name)[0]?.toUpperCase()}</span>
                <span>{item.name}</span>
              </Button>
            ))}
            <Button size="compact" className="gitapp-model-provider-tab" aria-pressed={isCodex} disabled={busy} onClick={() => { if (!isCodex) selectProvider('codex'); }}>
              <span className="gitapp-model-provider-symbol" aria-hidden="true">C</span><span>Codex</span>
            </Button>
          </div>

          {message ? <p className="gitapp-settings-message" role="status">{message}</p> : null}

          {isCodex ? <>
            <section className="gitapp-model-card gitapp-model-account" aria-label={zh ? 'Codex 账户' : 'Codex account'}>
              <h3>{zh ? 'Codex 账户' : 'Codex account'}</h3>
              <p>{account === null ? (zh ? '正在读取账户状态…' : 'Loading account…') : account.signedIn ? (zh ? '已登录。' : 'Signed in.') : account.code === 'ASTRAGIT_CODEX_DISABLED' ? (zh ? 'Codex 尚未启用。' : 'Codex is disabled.') : account.message || (zh ? '尚未登录。' : 'Not signed in.')}</p>
              {account?.codexHome ? <small>{zh ? '独立数据目录：' : 'Separate data directory: '}{account.codexHome}</small> : null}
              {account?.available && !account.signedIn ? <Button size="compact" disabled={busy || Boolean(login)} onClick={() => void perform(async () => {
                const next = await client.startCodexLogin();
                if (!/^https?:\/\//iu.test(next.authUrl)) throw new Error(zh ? '登录地址无效。' : 'Invalid login URL.');
                setLogin(next);
              })}>{zh ? '登录 Codex' : 'Sign in to Codex'}</Button> : null}
              {login ? <a href={login.authUrl} target="_blank" rel="noopener noreferrer">{zh ? '在浏览器中打开登录页面 ↗' : 'Open sign in page ↗'}</a> : null}
            </section>
            <section className="gitapp-model-list" aria-labelledby="gitapp-codex-model-list-heading">
              <header>
                <h3 id="gitapp-codex-model-list-heading">{zh ? '模型列表' : 'Models'} <small>{codexModels.length}</small></h3>
                <Button size="compact" disabled={busy || Boolean(login) || !account?.available} onClick={() => void perform(async () => {
                  setAccount(await client.refreshCodexModels());
                  onChanged();
                })}><ArrowsClockwise size={16} aria-hidden="true" />{zh ? '同步目录' : 'Sync catalog'}</Button>
              </header>
              <div className="gitapp-model-card">
                {codexModels.length ? <ul>{codexModels.map(model => {
                  const name = model.id.slice('codex:'.length);
                  return <li key={model.id}>
                    <div className="gitapp-model-row">
                      <div className="gitapp-model-description">
                        <div className="gitapp-model-title"><code>{name}</code></div>
                        {model.displayName && model.displayName !== name ? <small>{model.displayName}</small> : null}
                      </div>
                      <div className="gitapp-model-row-actions">
                        <input type="checkbox" aria-label={zh ? `启用模型 ${name}` : `Enable model ${name}`} title={zh ? '启用模型' : 'Enable model'} checked={!disabledCodexModels.includes(model.id)} disabled={busy} onChange={event => toggleCodexModel(model.id, event.currentTarget.checked)} />
                      </div>
                    </div>
                  </li>;
                })}</ul> : <p className="gitapp-model-empty" role="status">{account === null ? (zh ? '正在读取模型目录…' : 'Loading model catalog…')
                  : account.available && !account.signedIn && account.requiresOpenaiAuth !== false && !account.message ? (zh ? '登录 Codex 后即可选择模型。' : 'Sign in to Codex to choose models.')
                    : (zh ? '暂无可选的 Codex 模型。' : 'No Codex models are available.')}</p>}
              </div>
            </section>
          </> : connections ? (
            <>
              <form key={selection} id="gitapp-provider-form" className="gitapp-model-card gitapp-model-provider-form" onSubmit={event => { event.preventDefault(); if (canSave && !busy) saveProvider(); }}>
                {connection ? (
                  <label className="gitapp-model-field"><span>{zh ? '供应商 ID' : 'Provider ID'}</span><TextInput className="gitapp-model-provider-id" value={connection.id} readOnly /></label>
                ) : (
                  <label className="gitapp-model-field">
                    <span>{zh ? '供应商类型' : 'Provider type'}</span>
                    <Select
                      ariaLabel={zh ? '供应商类型' : 'Provider type'}
                      value={provider.templateId}
                      disabled={busy}
                      onChange={value => {
                      const templateId = value as ModelTemplateId;
                      const template = templateId === 'custom' ? null : templates?.[templateId];
                      updateProvider({ templateId, name: template?.name ?? '', baseUrl: template?.baseUrl ?? '', modelsPath: template?.modelsPath ?? '/models' });
                    }}
                      options={[
                        { value: 'custom', label: zh ? '自定义兼容 API' : 'Custom compatible API' },
                        ...(templates ? Object.entries(templates).map(([id, template]) => ({ value: id, label: template.name })) : []),
                      ]}
                    />
                  </label>
                )}
                <label className="gitapp-model-field"><span>{zh ? '名称' : 'Name'}</span><TextInput value={provider.name} disabled={busy} maxLength={80} onChange={event => updateProvider({ name: event.target.value })} /></label>
                <label className="gitapp-model-field"><span>{zh ? '接口地址' : 'API URL'}</span><TextInput value={provider.baseUrl} disabled={busy} spellCheck={false} placeholder="https://example.com/v1" onChange={event => updateProvider({ baseUrl: event.target.value })} /></label>
                <label className="gitapp-model-field">
                  <span>{zh ? '接口协议' : 'API protocol'}</span>
                  <Select
                    ariaLabel={zh ? '接口协议' : 'API protocol'}
                    value={providerProtocol}
                    disabled={busy}
                    onChange={value => updateProvider({ protocolFamily: value as Protocol })}
                    options={[
                      ...(!providerProtocol ? [{ value: '', label: zh ? '现有模型使用不同协议' : 'Existing models use different protocols', disabled: true }] : []),
                      ...(Object.entries(protocolNames).map(([protocol, name]) => ({ value: protocol, label: name }))),
                    ]}
                  />
                </label>
                <div className="gitapp-model-field">
                  <label htmlFor="gitapp-model-key">API Key</label>
                  <div className="gitapp-model-key">
                    <TextInput id="gitapp-model-key" type={showKey ? 'text' : 'password'} disabled={busy} autoComplete="off" spellCheck={false} placeholder={savedKeyHint} value={provider.apiKey} onChange={event => updateProvider({ apiKey: event.target.value })} />
                    <Button size="compact" className="gitapp-model-icon gitapp-model-plain" disabled={!provider.apiKey || busy} aria-label={showKey ? (zh ? '隐藏新密钥' : 'Hide new API key') : (zh ? '显示新密钥' : 'Show new API key')} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</Button>
                  </div>
                </div>
                <div className="gitapp-model-field">
                  <span>{zh ? '连接测试' : 'Connection test'}</span>
                  <div className="gitapp-model-test">
                    <span role="status" className="gitapp-model-test-result" data-result={diagnostic ? (diagnostic.ok ? 'success' : 'error') : undefined}>{diagnosticText ?? (!connection || draft ? (zh ? '保存后可测试' : 'Save to test') : '')}</span>
                    <Button size="compact" disabled={!connection || Boolean(draft) || busy} onClick={() => connection && void perform(async () => {
                      setDiagnostic(undefined);
                      setDiagnostic(await client.testModelConnection(connection.id));
                    })}>{zh ? '测试连接' : 'Test connection'}</Button>
                  </div>
                </div>
                <details className="gitapp-model-advanced">
                  <summary>{zh ? '高级设置' : 'Advanced settings'}</summary>
                  <label className="gitapp-model-field"><span>{zh ? '模型目录路径' : 'Model catalog path'}</span><TextInput value={provider.modelsPath} disabled={busy} spellCheck={false} onChange={event => updateProvider({ modelsPath: event.target.value })} /></label>
                  <label className="gitapp-model-checkbox"><input type="checkbox" checked={provider.enabled} disabled={busy} onChange={event => updateProvider({ enabled: event.currentTarget.checked })} />{zh ? '启用供应商' : 'Enable provider'}</label>
                </details>
              </form>

              {connection ? (
                <section className="gitapp-model-list" aria-labelledby="gitapp-model-list-heading">
                  <header>
                    <h3 id="gitapp-model-list-heading">{zh ? '模型列表' : 'Models'} <small>{models.length}</small></h3>
                    <div className="gitapp-model-list-actions">
                      <Button size="compact" disabled={busy || !connection.apiKeyConfigured || Boolean(draft || editor)} onClick={() => void perform(async () => {
                        const result = await client.refreshModelConnectionModels(connection.id);
                        updateConnection(result.connection);
                        setMessage(zh ? `已同步 ${result.connection.models.length} 个模型。` : `Synced ${result.connection.models.length} models.`);
                      })}><ArrowsClockwise size={16} aria-hidden="true" />{zh ? '同步目录' : 'Sync catalog'}</Button>
                      <Button size="compact" disabled={busy || Boolean(editor)} onClick={() => setEditor({ modelId: '', displayName: '', enabled: true })}><Plus size={16} aria-hidden="true" />{zh ? '添加模型' : 'Add model'}</Button>
                    </div>
                  </header>
                  <div className="gitapp-model-card">
                    {editor && !editor.existingId ? <ModelEditorForm value={editor} onChange={setEditor} onSubmit={() => saveModel(connection, editor)} onCancel={() => setEditor(undefined)} zh={zh} busy={busy} /> : null}
                    {models.length ? <ul>{models.map(model => (
                      <li key={model.id}>
                        {editor?.existingId === model.id ? <ModelEditorForm value={editor} onChange={setEditor} onSubmit={() => saveModel(connection, editor)} onCancel={() => setEditor(undefined)} zh={zh} busy={busy} /> : (
                          <div className="gitapp-model-row">
                            <div className="gitapp-model-description">
                              <div className="gitapp-model-title">
                                <code>{model.id}</code>
                                <span title={zh ? '上下文长度' : 'Context window'}>{formatTokens(model.contextWindow)}</span>
                                <span>{zh ? '输出' : 'Output'} {formatTokens(model.maxTokens)}</span>
                                {model.capability.imageInput.state === 'supported' ? <span>{zh ? '图像' : 'Image'}</span> : null}
                              </div>
                              {model.displayName !== model.id ? <small>{model.displayName}</small> : null}
                            </div>
                            <div className="gitapp-model-row-actions">
                              <input type="checkbox" aria-label={zh ? `启用模型 ${model.id}` : `Enable model ${model.id}`} title={zh ? '启用模型' : 'Enable model'} checked={model.enabled} disabled={busy || Boolean(editor)} onChange={event => {
                                const enabled = event.currentTarget.checked;
                                void perform(async () => updateConnection(await client.updateModelConnection(connection.id, {
                                  ...connection,
                                  models: models.map(item => item.id === model.id ? { ...item, enabled } : item),
                                })));
                              }} />
                              <Button size="compact" className="gitapp-model-icon gitapp-model-plain" disabled={busy || Boolean(editor)} title={zh ? '编辑模型' : 'Edit model'} aria-label={zh ? `编辑模型 ${model.id}` : `Edit model ${model.id}`} onClick={() => setEditor({ ...model, existingId: model.id, modelId: model.id })}><PencilSimple size={16} aria-hidden="true" /></Button>
                              <Button size="compact" className="gitapp-model-icon gitapp-model-plain" disabled={busy || Boolean(editor)} title={zh ? '删除模型' : 'Delete model'} aria-label={zh ? `删除模型 ${model.id}` : `Delete model ${model.id}`} onClick={() => {
                                if (!window.confirm(zh ? `删除模型「${model.id}」？` : `Delete model “${model.id}”?`)) return;
                                void perform(async () => updateConnection(await client.updateModelConnection(connection.id, { ...connection, models: models.filter(item => item.id !== model.id) })));
                              }}><Trash size={16} aria-hidden="true" /></Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}</ul> : !editor ? <p className="gitapp-model-empty">{zh ? '暂无模型，可同步目录或手动添加。' : 'Sync the catalog or add a model manually.'}</p> : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : !message ? <p role="status">{zh ? '正在读取模型设置…' : 'Loading model settings…'}</p> : null}
        </div>
      </div>

      {!isCodex && connections ? (
        <footer className="gitapp-model-footer">
          {connection ? (
            <>
              <Button variant="danger" size="compact" className="gitapp-model-plain" disabled={busy} onClick={() => removeProvider(connection)}><Trash size={16} aria-hidden="true" />{zh ? '删除供应商' : 'Delete provider'}</Button>
              <Button size="compact" className="gitapp-model-plain" disabled={busy} onClick={() => selectProvider('new', { ...connection, name: zh ? `${connection.name} 副本` : `${connection.name} copy`, apiKey: '' })}><Copy size={16} aria-hidden="true" />{zh ? '克隆供应商' : 'Clone provider'}</Button>
            </>
          ) : null}
          <Button type="submit" form="gitapp-provider-form" variant="primary" size="compact" disabled={!canSave || busy}>{zh ? '保存' : 'Save'}</Button>
        </footer>
      ) : null}
    </div>
  );
}

function ModelEditorForm({ value, onChange, onSubmit, onCancel, zh, busy }: {
  value: ModelEditor;
  onChange: (value: ModelEditor) => void;
  onSubmit: () => void;
  onCancel: () => void;
  zh: boolean;
  busy: boolean;
}) {
  return (
    <form className="gitapp-model-editor" onSubmit={event => { event.preventDefault(); if (!busy && value.modelId.trim()) onSubmit(); }}>
      <label>{zh ? '模型 ID' : 'Model ID'}<TextInput value={value.modelId} readOnly={Boolean(value.existingId)} disabled={busy} maxLength={200} onChange={event => onChange({ ...value, modelId: event.target.value })} /></label>
      <label>{zh ? '显示名称' : 'Display name'}<TextInput value={value.displayName} disabled={busy} maxLength={200} onChange={event => onChange({ ...value, displayName: event.target.value })} /></label>
      <div className="gitapp-model-editor-actions">
        <label className="gitapp-model-checkbox"><input type="checkbox" checked={value.enabled} disabled={busy} onChange={event => onChange({ ...value, enabled: event.currentTarget.checked })} />{zh ? '启用模型' : 'Enable model'}</label>
        <Button size="compact" disabled={busy} onClick={onCancel}>{zh ? '取消' : 'Cancel'}</Button>
        <Button variant="primary" size="compact" type="submit" disabled={busy || !value.modelId.trim()}>{zh ? '保存模型' : 'Save model'}</Button>
      </div>
    </form>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`;
  return String(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
