import { useEffect, useRef, useState } from 'react';
import type { DashboardClient, GitCommitTemplate } from '../apiClient.js';
import { Button } from '../ui/Button.js';
import { ModalPortal } from '../ui/ModalPortal.js';
import { usePresenceOpen } from '../ui/MotionPresence.js';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { createGitTemplateDraftGuard } from './gitTemplateDraftGuard.js';
import './gitCommitTemplate.css';

export function GitCommitTemplateControl(props: {
  client: Pick<DashboardClient, 'loadProjectGitCommitTemplate'>;
  projectId: string;
  repositoryId: string;
  repositoryName?: string;
  value: string;
  zh: boolean;
  disabled: boolean;
  active?: boolean;
  autoFill?: boolean;
  onApply: (message: string, expected: string) => void;
}) {
  const presenceOpen = usePresenceOpen();
  const active = props.active !== false && presenceOpen;
  const guard = useRef(createGitTemplateDraftGuard(props.value));
  guard.current.observe(props.value, props.disabled || !active);
  const attempted = useRef(false); const request = useRef(0); const controller = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ template: GitCommitTemplate; ticket: { value: string; revision: number } } | null>(null);
  const text = (cn: string, en: string) => props.zh ? cn : en;
  const scope = `${props.projectId}:${props.repositoryId}`;
  useEffect(() => () => { request.current += 1; controller.current?.abort(); }, [scope, active]);
  async function read(automatic: boolean) {
    if (!props.repositoryId || props.disabled || !active) return;
    const ticket = guard.current.ticket(); const version = ++request.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(null); setNotice('');
    try {
      const template = await props.client.loadProjectGitCommitTemplate(props.projectId, props.repositoryId, abort.signal);
      if (abort.signal.aborted || version !== request.current) return;
      if (template.problem) { setError({ code: template.problem }); return; }
      if (template.source === 'none') { if (!automatic) setNotice(text('尚未配置模板，可在“操作 → 仓库设置”中配置。', 'No template configured. Open Actions → Repository settings.')); return; }
      if (!guard.current.accepts(ticket)) { if (!automatic) setNotice(text('提交说明已变化，原草稿保留，请重新读取模板。', 'The commit message changed. Your draft was kept; reload the template.')); return; }
      if (ticket.value) setPending({ template, ticket });
      else { props.onApply(template.message, ticket.value); if (!automatic) setNotice(text('已填入模板，请补全并检查提交说明。', 'Template inserted. Complete and review the commit message.')); }
    } catch (reason) { if (!abort.signal.aborted && version === request.current) setError(reason); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => {
    if (!active || props.disabled || props.autoFill === false || !props.repositoryId || props.value || attempted.current) return;
    attempted.current = true;
    void read(true);
  }, [scope, active, props.disabled, props.autoFill]);
  return <span className="git-template-control">
    <Button size="compact" variant="secondary" disabled={props.disabled || !props.repositoryId || loading} busy={loading} title={props.repositoryName ? `${text('使用模板', 'Use template')} · ${props.repositoryName}` : undefined} onClick={() => void read(false)}>{text('使用模板', 'Use template')}</Button>
    {error ? <span className="git-template-feedback" role="status"><VisibleApplicationError error={error} language={props.zh ? 'zh-CN' : 'en'} /></span> : notice ? <small className="git-template-feedback" role="status">{notice}</small> : null}
    {pending ? <ModalPortal role="dialog" aria-label={text('使用模板替换提交说明', 'Replace commit message with template')} rootClassName="project-git-modal-root" onDismiss={() => setPending(null)}><section className="project-git-menu-action-dialog git-template-replace" data-modal-surface="dialog">
      <h3>{text('使用模板替换当前说明？', 'Replace the current message with the template?')}</h3><p>{text('取消会保留当前手工或 AI 草稿。模板中的注释只用于设置预览，不会填入提交说明。', 'Cancel keeps your manual or AI draft. Template comments appear in Settings previews and are not inserted into the commit message.')}</p>
      <pre>{pending.template.message || text('此模板为空，将清空当前说明。', 'This template is empty. The current message will be cleared.')}</pre>
      <footer><Button variant="secondary" onClick={() => setPending(null)}>{text('取消', 'Cancel')}</Button><Button disabled={props.disabled} onClick={() => { if (guard.current.accepts(pending.ticket)) props.onApply(pending.template.message, pending.ticket.value); else setNotice(text('提交说明已变化，原草稿保留，请重新读取模板。', 'The commit message changed. Your draft was kept; reload the template.')); setPending(null); }}>{text('替换说明', 'Replace message')}</Button></footer>
    </section></ModalPortal> : null}
  </span>;
}
