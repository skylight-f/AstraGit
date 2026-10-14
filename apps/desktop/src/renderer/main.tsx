import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createDashboardClientLike } from './clientBootstrap.js';
import type { RendererBootstrap } from './bootstrapTypes.js';

import './styles.css';
import './ui/primitives.css';
import './agentdesk-theme.css';

async function main(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('AstraGit renderer root element is missing');
  let bootstrap: RendererBootstrap | null = null;
  try {
    const provider = window.astraGit?.getBootstrap;
    console.info('[AstraGit] bootstrap provider', typeof provider);
    bootstrap = provider ? await provider() : null;
    console.info('[AstraGit] bootstrap', bootstrap ? { baseUrl: bootstrap.baseUrl, hasToken: Boolean(bootstrap.apiToken) } : null);
  } catch (error) {
    console.error('[AstraGit] bootstrap failed', error);
    bootstrap = null;
  }
  if (!bootstrap?.baseUrl || !bootstrap.apiToken) {
    rootElement.innerHTML = `
      <div style="padding:32px;font-family:system-ui;max-width:520px">
        <h1 style="margin:0 0 8px;font-size:22px">AstraGit</h1>
        <p style="color:#5d6675;line-height:1.5">本机服务配置未就绪。请完全退出应用后重新运行 <code>pnpm dev</code>。</p>
        <pre style="background:#f1f3f7;padding:12px;border-radius:8px;overflow:auto">${window.astraGit ? 'bridge=ok' : 'bridge=missing'}</pre>
      </div>`;
    return;
  }
  const language: 'zh-CN' | 'en-US' = bootstrap.language === 'en-US' ? 'en-US' : 'zh-CN';
  const client = createDashboardClientLike({
    baseUrl: bootstrap.baseUrl,
    apiToken: bootstrap.apiToken,
  });
  createRoot(rootElement).render(<App client={client} language={language} />);
}

void main();
