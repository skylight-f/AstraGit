import { useEffect, useState } from 'react';
import type { CodexAccount, CodexLogin, DashboardClient, ModelConnection, ModelTemplateId } from './apiClient.js';
import { Button } from './ui/Button.js';
import { ModalPortal } from './ui/ModalPortal.js';

type Templates = Awaited<ReturnType<DashboardClient['loadModelConnectionTemplates']>>;

export function ModelSettings(props: { client: DashboardClient; language: 'zh-CN' | 'en-US'; onClose: () => void; onChanged: () => void; embedded?: boolean }) {
  const zh = props.language === 'zh-CN';
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [templateId, setTemplateId] = useState<ModelTemplateId>('custom');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [manualModel, setManualModel] = useState<Record<string, string>>({});
  const [replacementKeys, setReplacementKeys] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; name: string; baseUrl: string; modelsPath: string } | null>(null);
  const [login, setLogin] = useState<CodexLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([props.client.loadModelConnectionTemplates(), props.client.loadModelConnections()])
      .then(([nextTemplates, nextConnections]) => {
        if (!active) return;
        setTemplates(nextTemplates);
        setConnections(nextConnections);
      })
      .catch((error: unknown) => {
        if (active) setMessage(errorText(error));
      });
    void props.client.loadCodexAccount().then(nextAccount => {
      if (active) setAccount(nextAccount);
    }).catch(error => {
      if (active) setAccount({ available: false, signedIn: false, message: errorText(error) });
    });
    return () => { active = false; };
  }, [props.client]);

  useEffect(() => {
    if (!login) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await props.client.loadCodexLoginStatus(login);
        if (!active) return;
        if (result.status === 'succeeded') {
          setLogin(null);
          setAccount(await props.client.loadCodexAccount());
          setMessage(zh ? 'Codex 已登录。' : 'Codex is signed in.');
          props.onChanged();
          return;
        }
        if (result.status === 'failed') {
          setLogin(null);
          setMessage(result.error || (zh ? 'Codex 登录失败。' : 'Codex sign in failed.'));
          return;
        }
      } catch (error) {
        if (active) setMessage(errorText(error));
        return;
      }
      if (active) timer = setTimeout(() => void check(), 2_000);
    };
    timer = setTimeout(() => void check(), 2_000);
    return () => { active = false; clearTimeout(timer); };
  }, [login, props.client, props.onChanged, zh]);

  function selectTemplate(id: ModelTemplateId): void {
    setTemplateId(id);
    if (id === 'custom') {
      setName('');
      setBaseUrl('');
      return;
    }
    const template = templates?.[id];
    if (template) {
      setName(template.name);
      setBaseUrl(template.baseUrl);
    }
  }

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

  async function reloadConnections(): Promise<void> {
    setConnections(await props.client.loadModelConnections());
    props.onChanged();
  }

  function allowHttp(url: string): boolean {
    if (!url.trim().startsWith('http://')) return true;
    return window.confirm(zh
      ? 'HTTP 不会加密 API Key 和提交内容。确认仍要使用此地址？'
      : 'HTTP does not encrypt your API key or commit contents. Continue with this URL?');
  }

  async function createConnection(): Promise<void> {
    if (!allowHttp(baseUrl)) return;
    await perform(async () => {
      await props.client.createModelConnection({ name, templateId, baseUrl, apiKey, allowInsecureHttp: baseUrl.startsWith('http://'), models: [] });
      setApiKey('');
      setName('');
      setBaseUrl('');
      setTemplateId('custom');
      await reloadConnections();
      setMessage(zh ? '连接已保存。刷新模型目录，或手动添加模型 ID。' : 'Connection saved. Refresh its catalog or add a model ID.');
    });
  }

  async function replaceKey(connection: ModelConnection): Promise<void> {
    const key = replacementKeys[connection.id]?.trim();
    if (!key || !allowHttp(connection.baseUrl)) return;
    await perform(async () => {
      await props.client.updateModelConnection(connection.id, { ...connection, apiKey: key, allowInsecureHttp: connection.baseUrl.startsWith('http://') });
      setReplacementKeys((current) => ({ ...current, [connection.id]: '' }));
      await reloadConnections();
      setMessage(zh ? 'API Key 已更新。' : 'API key updated.');
    });
  }

  async function saveConnectionEdit(): Promise<void> {
    if (!editing) return;
    const connection = connections.find(item => item.id === editing.id);
    const nextUrl = editing.baseUrl.trim();
    if (!connection || !allowHttp(nextUrl)) return;
    await perform(async () => {
      await props.client.updateModelConnection(connection.id, {
        ...connection, name: editing.name.trim(), baseUrl: nextUrl,
        modelsPath: editing.modelsPath.trim(), allowInsecureHttp: nextUrl.startsWith('http://'),
      });
      setEditing(null);
      await reloadConnections();
      setMessage(zh ? '连接配置已更新，原 API Key 和模型选择已保留。' : 'Connection updated. Your API key and model selections are preserved.');
    });
  }

  async function refreshModels(connection: ModelConnection): Promise<void> {
    await perform(async () => {
      const result = await props.client.refreshModelConnectionModels(connection.id);
      await reloadConnections();
      setMessage(zh ? `已发现 ${result.connection.models.length} 个模型。` : `Found ${result.connection.models.length} models.`);
    });
  }

  async function setModelEnabled(connection: ModelConnection, modelId: string, enabled: boolean): Promise<void> {
    await perform(async () => {
      await props.client.updateModelConnection(connection.id, {
        ...connection,
        models: connection.models.map((model) => model.id === modelId ? { ...model, enabled } : model),
      });
      await reloadConnections();
    });
  }

  async function setConnectionEnabled(connection: ModelConnection, enabled: boolean): Promise<void> {
    await perform(async () => {
      await props.client.updateModelConnection(connection.id, { ...connection, enabled });
      await reloadConnections();
    });
  }

  async function addModel(connection: ModelConnection): Promise<void> {
    const modelId = manualModel[connection.id]?.trim();
    if (!modelId) return;
    await perform(async () => {
      await props.client.addManualModel(connection.id, modelId);
      setManualModel((current) => ({ ...current, [connection.id]: '' }));
      await reloadConnections();
      setMessage(zh ? '模型已添加。' : 'Model added.');
    });
  }

  async function removeConnection(connection: ModelConnection): Promise<void> {
    if (!window.confirm(zh ? `移除模型连接「${connection.name}」？` : `Remove model connection “${connection.name}”?`)) return;
    await perform(async () => {
      await props.client.removeModelConnection(connection.id);
      if (editing?.id === connection.id) setEditing(null);
      await reloadConnections();
    });
  }

  async function startLogin(): Promise<void> {
    await perform(async () => {
      const next = await props.client.startCodexLogin();
      if (!/^https?:\/\//iu.test(next.authUrl)) throw new Error(zh ? '登录地址无效。' : 'Invalid login URL.');
      setLogin(next);
      setMessage(zh ? '点击下方链接在浏览器中完成登录。' : 'Open the link below to finish signing in.');
    });
  }

  const content = (
      <div className={props.embedded ? 'gitapp-settings-model-content' : 'gitapp-settings-panel'} data-modal-surface="dialog">
        <header className="gitapp-settings-header">
          <div>
            <h2>{zh ? 'AI 模型设置' : 'AI model settings'}</h2>
            <p>{zh ? '配置提交说明使用的模型。API Key 保存在本机。' : 'Configure models for commit messages. API keys stay on this device.'}</p>
          </div>
          {!props.embedded ? <Button onClick={props.onClose}>{zh ? '完成' : 'Done'}</Button> : null}
        </header>

        {message ? <p className="gitapp-settings-message" role="status">{message}</p> : null}

        <section className="gitapp-settings-section">
          <h3>Codex</h3>
          <p>{account === null ? (zh ? '正在读取账户状态…' : 'Loading account…') : account.signedIn ? (zh ? '已登录，可在提交区选择 Codex 模型。' : 'Signed in. Codex models are available in the commit panel.') : account.code === 'ASTRAGIT_CODEX_DISABLED' ? (zh ? 'Codex 尚未启用。' : 'Codex is disabled.') : account.message || (zh ? '尚未登录。' : 'Not signed in.')}</p>
          {account?.codexHome ? <small title={account.codexHome}>{zh ? '独立数据目录：' : 'Separate data directory: '}{account.codexHome}</small> : null}
          {account?.available && !account.signedIn ? <Button disabled={busy || Boolean(login)} onClick={() => void startLogin()}>{zh ? '登录 Codex' : 'Sign in to Codex'}</Button> : null}
          {login ? <a href={login.authUrl} target="_blank" rel="noopener noreferrer">{zh ? '在浏览器中打开登录页面 ↗' : 'Open sign in page ↗'}</a> : null}
        </section>

        <section className="gitapp-settings-section">
          <h3>{zh ? '模型连接' : 'Model connections'}</h3>
          {connections.length === 0 ? <p>{zh ? '还没有模型连接。添加一个后可刷新模型目录。' : 'No model connections yet. Add one, then refresh its model catalog.'}</p> : null}
          {connections.map((connection) => (
            <div className="gitapp-settings-connection" key={connection.id}>
              <div className="gitapp-settings-connection-heading">
                <div><strong>{connection.name}</strong><small>{connection.baseUrl} · {connection.apiKeyConfigured ? (zh ? '已配置密钥' : 'Key configured') : (zh ? '未配置密钥' : 'No key')}</small></div>
                <Button size="compact" disabled={busy} onClick={() => setEditing({ id: connection.id, name: connection.name, baseUrl: connection.baseUrl, modelsPath: connection.modelsPath })}>{zh ? '编辑连接' : 'Edit connection'}</Button>
                <Button variant="danger" size="compact" disabled={busy} onClick={() => void removeConnection(connection)}>{zh ? '移除' : 'Remove'}</Button>
              </div>
              {editing?.id === connection.id ? (
                <div className="gitapp-settings-editor">
                  <div className="gitapp-settings-form">
                    <label>{zh ? '连接名称' : 'Connection name'}<input disabled={busy} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
                    <label>{zh ? '连接 API 地址' : 'Connection API URL'}<input disabled={busy} value={editing.baseUrl} onChange={event => setEditing({ ...editing, baseUrl: event.target.value })} spellCheck={false} /></label>
                    <label>{zh ? '模型目录路径' : 'Models path'}<input disabled={busy} value={editing.modelsPath} onChange={event => setEditing({ ...editing, modelsPath: event.target.value })} spellCheck={false} /></label>
                  </div>
                  <div className="gitapp-settings-row">
                    <Button size="compact" variant="primary" disabled={busy || !editing.name.trim() || !editing.baseUrl.trim() || !editing.modelsPath.trim()} onClick={() => void saveConnectionEdit()}>{zh ? '保存连接配置' : 'Save connection settings'}</Button>
                    <Button size="compact" disabled={busy} onClick={() => setEditing(null)}>{zh ? '取消编辑' : 'Cancel edit'}</Button>
                  </div>
                </div>
              ) : null}
              <label className="gitapp-settings-toggle">
                <input type="checkbox" checked={connection.enabled} disabled={busy} onChange={(event) => void setConnectionEnabled(connection, event.currentTarget.checked)} />
                <span>{zh ? '启用连接' : 'Enable connection'}</span>
              </label>
              {connection.models.length ? (
                <fieldset className="gitapp-settings-models">
                  <legend>{zh ? '启用模型' : 'Enabled models'}</legend>
                  <small>{zh ? '勾选后可在提交区选择。新发现的模型默认停用。' : 'Select models to use in the commit panel. Newly discovered models are disabled.'}</small>
                  <div className="gitapp-settings-model-list">
                    {connection.models.map((model) => (
                      <label key={model.id} className="gitapp-settings-toggle">
                        <input type="checkbox" aria-label={zh ? `启用模型 ${model.id}` : `Enable model ${model.id}`} checked={model.enabled} disabled={busy} onChange={(event) => void setModelEnabled(connection, model.id, event.currentTarget.checked)} />
                        <span>{model.displayName || model.id}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : <p>{zh ? '暂无模型。刷新目录或手动添加。' : 'No models yet. Refresh the catalog or add a model.'}</p>}
              <div className="gitapp-settings-row">
                <Button size="compact" disabled={busy} onClick={() => void refreshModels(connection)}>{zh ? '刷新模型目录' : 'Refresh catalog'}</Button>
                <input aria-label={zh ? '手动模型 ID' : 'Manual model ID'} placeholder={zh ? '手动输入模型 ID' : 'Add model ID'} value={manualModel[connection.id] ?? ''} onChange={(event) => setManualModel((current) => ({ ...current, [connection.id]: event.target.value }))} />
                <Button size="compact" disabled={busy || !manualModel[connection.id]?.trim()} onClick={() => void addModel(connection)}>{zh ? '添加模型' : 'Add model'}</Button>
              </div>
              <div className="gitapp-settings-row">
                <input aria-label={zh ? '替换 API Key' : 'Replace API key'} type="password" placeholder={zh ? '替换 API Key' : 'Replace API key'} value={replacementKeys[connection.id] ?? ''} onChange={(event) => setReplacementKeys((current) => ({ ...current, [connection.id]: event.target.value }))} />
                <Button size="compact" disabled={busy || !replacementKeys[connection.id]?.trim()} onClick={() => void replaceKey(connection)}>{zh ? '更新密钥' : 'Update key'}</Button>
              </div>
            </div>
          ))}
        </section>

        <section className="gitapp-settings-section">
          <h3>{zh ? '添加连接' : 'Add connection'}</h3>
          <div className="gitapp-settings-form">
            <label>{zh ? '类型' : 'Type'}<select value={templateId} onChange={(event) => selectTemplate(event.target.value as ModelTemplateId)}><option value="custom">{zh ? '自定义兼容 API' : 'Custom compatible API'}</option>{templates ? Object.entries(templates).map(([id, template]) => <option key={id} value={id}>{template.name}</option>) : null}</select></label>
            <label>{zh ? '名称' : 'Name'}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>{zh ? 'API 地址' : 'API URL'}<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" spellCheck={false} /></label>
            <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /></label>
          </div>
          <Button variant="primary" disabled={busy || !name.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={() => void createConnection()}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '保存连接' : 'Save connection')}</Button>
        </section>
      </div>
  );
  return props.embedded ? content : <ModalPortal role="dialog" aria-label={zh ? 'AI 模型设置' : 'AI model settings'} rootClassName="gitapp-settings-root" onDismiss={props.onClose}>{content}</ModalPortal>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
