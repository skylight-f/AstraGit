import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import type { ConflictTextEditorProps } from './ConflictTextEditor.js';

interface ConflictEditorBoundaryProps {
  children: ReactNode;
  zh: boolean;
  onRetry: () => void;
}

/** 导入失败仅替换代码区域；合并草稿及保存状态继续由外层持有。 */
export class ConflictEditorBoundary extends Component<ConflictEditorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const text = (cn: string, en: string) => this.props.zh ? cn : en;
    return <div className="git-conflict-code-error" role="alert">
      <strong>{text('代码编辑器暂时无法加载', 'The code editor could not be loaded')}</strong>
      <p>{text('当前合并草稿仍保留在页面中。请重新加载编辑器；如果仍然失败，可手动刷新页面。', 'Your current merge draft remains in this page. Retry loading the editor, or refresh the page if the problem continues.')}</p>
      <div>
        <button type="button" onClick={this.props.onRetry}>{text('重新加载编辑器', 'Retry editor')}</button>
        <button type="button" onClick={() => window.location.reload()}>{text('刷新页面', 'Refresh page')}</button>
      </div>
    </div>;
  }
}

function createLazyEditor() {
  return lazy(() => import('./ConflictTextEditor.js').then(module => ({ default: module.ConflictTextEditor })));
}

/** React.lazy 会缓存失败，手动重试时创建新实例，再次请求本地编辑器模块。 */
export function ConflictTextEditorLoader({ zh, ...props }: ConflictTextEditorProps & { zh: boolean }) {
  const [loader, setLoader] = useState(() => ({ Editor: createLazyEditor(), attempt: 0 }));
  const Editor = loader.Editor;
  return <ConflictEditorBoundary key={loader.attempt} zh={zh} onRetry={() => setLoader(value => ({ Editor: createLazyEditor(), attempt: value.attempt + 1 }))}>
    <Suspense fallback={<p role="status">{zh ? '加载代码编辑器…' : 'Loading code editor…'}</p>}>
      <Editor {...props} />
    </Suspense>
  </ConflictEditorBoundary>;
}
