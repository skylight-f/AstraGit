import { useEffect, useRef, useState } from 'react';
import { VisibleApplicationError } from '../ui/ApplicationErrorDialog.js';
import { conflictEditorLanguage, conflictEditorTheme, initializeConflictMonaco, monaco } from './conflictMonaco.js';
import { ConflictRawTextHistory, conflictModelText, conflictRawPositionAt, conflictRawPositionMapper } from './conflictRawText.js';

export interface ConflictTextEditorProps {
  path: string;
  label: string;
  content: string;
  readOnly: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
  reveal?: { offset: number; token: number };
  regions?: Array<{ start: number; end: number; kind: 'current' | 'incoming' | 'conflict' }>;
}

/** 每个结果栏拥有独立模型；外部选入通过可撤销编辑同步，保留编辑器原生撤销栈。 */
export function ConflictTextEditor(props: ConflictTextEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const rawRef = useRef<ConflictRawTextHistory | null>(null);
  const current = useRef(props);
  current.current = props;
  const applying = useRef(false);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!host.current) return;
    let model: monaco.editor.ITextModel | undefined;
    let view: monaco.editor.IStandaloneCodeEditor | undefined;
    let decorations: monaco.editor.IEditorDecorationsCollection | undefined;
    let changed: monaco.IDisposable | undefined;
    const dispose = () => {
      changed?.dispose();
      changed = undefined;
      decorations?.clear();
      if (decorationsRef.current === decorations) decorationsRef.current = null;
      decorations = undefined;
      if (viewRef.current === view) viewRef.current = null;
      view?.dispose();
      view = undefined;
      model?.dispose();
      model = undefined;
      rawRef.current = null;
    };
    setError(null);
    try {
      initializeConflictMonaco();
      const input = current.current;
      model = monaco.editor.createModel(input.content, conflictEditorLanguage(input.path));
      rawRef.current = new ConflictRawTextHistory(input.content, model.getAlternativeVersionId());
      view = monaco.editor.create(host.current, {
        model,
        theme: conflictEditorTheme,
        automaticLayout: true,
        readOnly: input.readOnly,
        domReadOnly: input.readOnly,
        ariaLabel: `${input.label} · ${input.path}`,
        accessibilitySupport: 'auto',
        fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 20,
        lineNumbers: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        scrollbar: { horizontal: 'auto', vertical: 'auto', alwaysConsumeMouseWheel: false },
        padding: { top: 8, bottom: 16 },
        glyphMargin: false,
        folding: true,
        fixedOverflowWidgets: true,
        renderLineHighlight: 'none',
        renderWhitespace: 'selection',
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: false },
        unicodeHighlight: { ambiguousCharacters: false },
      });
      const textModel = model;
      changed = textModel.onDidChangeContent(event => {
        if (applying.current || !rawRef.current) return;
        const raw = rawRef.current.apply(event.changes, textModel.getAlternativeVersionId(), event.isUndoing || event.isRedoing);
        if (!current.current.readOnly) current.current.onChange?.(raw);
      });
      view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (!current.current.readOnly) current.current.onSave?.();
      });
      decorations = view.createDecorationsCollection();
      decorationsRef.current = decorations;
      viewRef.current = view;
      setReady(value => value + 1);
    } catch (reason) {
      dispose();
      setError(reason);
    }
    return dispose;
  }, [props.path, props.label]);

  useEffect(() => {
    const view = viewRef.current;
    const model = view?.getModel();
    const raw = rawRef.current;
    if (!view || !model || !raw) return;
    view.updateOptions({ readOnly: props.readOnly, domReadOnly: props.readOnly, ariaLabel: `${props.label} · ${props.path}` });
    const normalized = conflictModelText(props.content, model.getEOL());
    if (model.getValue() === normalized) {
      raw.synchronize(props.content, model.getAlternativeVersionId());
      return;
    }
    applying.current = true;
    try {
      model.pushStackElement();
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: normalized }], () => null);
      model.pushStackElement();
      raw.synchronize(props.content, model.getAlternativeVersionId());
    } finally {
      applying.current = false;
    }
  }, [props.content, props.readOnly, props.path, props.label, ready]);

  useEffect(() => {
    const view = viewRef.current;
    const model = view?.getModel();
    if (!view || !model) return;
    const content = rawRef.current?.content ?? props.content;
    const positionAt = conflictRawPositionMapper(content);
    decorationsRef.current?.set((props.regions ?? []).map(region => {
      const length = content.length;
      const start = Math.max(0, Math.min(length, Number.isFinite(region.start) ? Math.floor(region.start) : 0));
      const end = Math.max(start, Math.min(length, Number.isFinite(region.end) ? Math.floor(region.end) : start));
      const first = positionAt(start);
      const last = positionAt(Math.max(start, end - 1));
      return {
        range: new monaco.Range(first.lineNumber, 1, last.lineNumber, model.getLineMaxColumn(last.lineNumber)),
        options: { isWholeLine: true, className: `git-conflict-line-${region.kind}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      };
    }));
  }, [props.regions, props.content, props.path, props.label, ready]);

  useEffect(() => {
    const view = viewRef.current;
    const model = view?.getModel();
    const raw = rawRef.current;
    if (!view || !model || !raw || !props.reveal || !Number.isFinite(props.reveal.offset)) return;
    const position = conflictRawPositionAt(raw.content, props.reveal.offset);
    view.setPosition(position);
    view.revealPositionInCenterIfOutsideViewport(position);
  }, [props.reveal?.offset, props.reveal?.token, props.path, props.label, ready]);

  return <div className="git-conflict-code-editor" role="group" aria-label={`${props.label} · ${props.path}`}>
    <div ref={host} className="git-conflict-code-host" />
    {error ? <div className="git-conflict-code-error" role="alert"><VisibleApplicationError error={error} language={document.documentElement.lang.startsWith('zh') ? 'zh-CN' : 'en'} /></div> : null}
  </div>;
}
