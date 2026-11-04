'use client';

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  TLBaseShape,
  T,
  RecordProps,
  stopEventPropagation,
  TLResizeInfo,
} from '@tldraw/tldraw';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Code2,
  Copy,
  Check,
  WrapText,
  Pencil,
  FileCode,
  Terminal,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-css';
import { smartStopPropagation } from '../lib/panModifier';
import { useShapeDraft } from '../hooks/useShapeDraft';
import { ShapeFocusLayer } from '../components/ShapeFocusLayer';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';
import { subscribeToShapeEditing } from '../lib/shapeEditing';

export type TLCodeCardShape = TLBaseShape<
  'code_card',
  {
    w: number;
    h: number;
    title: string;
    language: string;
    code: string;
    description?: string;
    color: string;
    isStreaming: boolean;
  }
>;

export const codeCardShapeProps: RecordProps<TLCodeCardShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  language: T.string,
  code: T.string,
  description: T.optional(T.string),
  color: T.string,
  isStreaming: T.boolean,
};

const LANGUAGE_BADGES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  typescript: { label: 'TypeScript', bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  ts: { label: 'TypeScript', bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  tsx: { label: 'React TSX', bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  javascript: { label: 'JavaScript', bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/30' },
  js: { label: 'JavaScript', bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/30' },
  jsx: { label: 'React JSX', bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  python: { label: 'Python', bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  py: { label: 'Python', bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  rust: { label: 'Rust', bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  rs: { label: 'Rust', bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  go: { label: 'Go', bg: 'bg-sky-500/20', text: 'text-sky-300', border: 'border-sky-500/30' },
  golang: { label: 'Go', bg: 'bg-sky-500/20', text: 'text-sky-300', border: 'border-sky-500/30' },
  cpp: { label: 'C++', bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30' },
  c: { label: 'C', bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500/30' },
  sql: { label: 'SQL', bg: 'bg-pink-500/20', text: 'text-pink-300', border: 'border-pink-500/30' },
  bash: { label: 'Bash', bg: 'bg-lime-500/20', text: 'text-lime-300', border: 'border-lime-500/30' },
  sh: { label: 'Shell', bg: 'bg-lime-500/20', text: 'text-lime-300', border: 'border-lime-500/30' },
  json: { label: 'JSON', bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30' },
  yaml: { label: 'YAML', bg: 'bg-rose-500/20', text: 'text-rose-300', border: 'border-rose-500/30' },
  html: { label: 'HTML', bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  css: { label: 'CSS', bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
};

function normalizeLanguage(lang?: string): string {
  if (!lang) return 'javascript';
  const clean = lang.toLowerCase().trim();
  if (clean === 'js') return 'javascript';
  if (clean === 'ts') return 'typescript';
  if (clean === 'py') return 'python';
  if (clean === 'rs') return 'rust';
  if (clean === 'sh') return 'bash';
  return clean;
}

function CodeCardComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLCodeCardShape;
  editor?: any;
  onUpdate: (updates: Partial<TLCodeCardShape['props']>) => void;
}) {
  const isSelected = Boolean(editor?.getSelectedShapeIds?.()?.includes(shape.id));
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const draft = useShapeDraft(
    `code_card:${shape.id}`,
    {
      title: shape.props.title,
      language: shape.props.language,
      code: shape.props.code,
    },
    { editor, shapeId: shape.id }
  );
  const editTitle = draft.value.title;
  const editCode = draft.value.code;
  const editLanguage = draft.value.language;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isEditing]);

  useEffect(() => {
    if (draft.recovered) setIsEditing(true);
  }, [draft.recovered]);

  useEffect(() => subscribeToShapeEditing(shape.id, () => {
    const current = editor?.getShape?.(shape.id);
    if (!current || editor?.getIsReadonly?.() || editor?.isShapeOrAncestorLocked?.(current)) return;
    setIsEditing(true);
  }), [editor, shape.id]);

  const { w, h, title, language, code, description, isStreaming } = shape.props;
  const normLang = normalizeLanguage(language);
  const badge = LANGUAGE_BADGES[normLang] || {
    label: (language || 'CODE').toUpperCase(),
    bg: 'bg-indigo-500/20',
    text: 'text-indigo-300',
    border: 'border-indigo-500/30',
  };

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    },
    [code]
  );

  const handleSaveEdit = useCallback(() => {
    const next = {
      title: editTitle.trim() || 'code_snippet',
      language: editLanguage.trim() || 'javascript',
      code: editCode,
    };
    setSaveError('');
    try {
      onUpdate(next);
      const savedShape = editor?.getShape?.(shape.id);
      if (
        savedShape?.type !== 'code_card' ||
        savedShape.props.title !== next.title ||
        savedShape.props.language !== next.language ||
        savedShape.props.code !== next.code
      )
        throw new Error('The code could not be saved to the canvas. Your draft is still here.');
      draft.save(next);
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The code could not be saved. Your draft is still here.');
    }
  }, [editTitle, editLanguage, editCode, onUpdate, editor, shape.id, draft.save]);

  const handleDiscardEdit = useCallback(() => {
    draft.discard();
    setSaveError('');
    setIsEditing(false);
  }, [draft.discard]);

  // Syntax highlighting with line numbers
  const { lines, lineNumbers } = useMemo(() => {
    const codeText = code;
    const grammar = Prism.languages[normLang] || Prism.languages.javascript || Prism.languages.markup;
    const highlighted = Prism.highlight(codeText || '', grammar, normLang);

    const splitLines = highlighted.split('\n');
    const numbers = Array.from({ length: splitLines.length }, (_, i) => i + 1);

    return {
      lines: splitLines,
      lineNumbers: numbers,
    };
  }, [code, normLang]);

  return (
    <>
    <HTMLContainer
      id={shape.id}
      className="studio-native-window studio-native-code-window pointer-events-auto overflow-hidden rounded-2xl transition-colors flex flex-col font-sans antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Window Bar */}
      <div
        data-window-header="code"
        className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <FileCode className="h-4 w-4 text-slate-400 shrink-0 ml-1" strokeWidth={1.5} />

          <span
            data-window-title
            className="truncate text-xs font-mono font-medium tracking-wide text-slate-200"
            title={title}
            onDoubleClick={() => setIsEditing(true)}
          >
            {title || 'code_snippet'}
          </span>

          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400 bg-white/5 border border-white/10 uppercase tracking-wider"
          >
            {badge.label}
          </span>

          {isStreaming && (
            <span className="flex items-center gap-1 text-[9px] font-mono tabular-nums text-indigo-300 animate-pulse bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-400/20">
              Generating...
            </span>
          )}
        </div>

        {/* Code Card Controls */}
        <ArtifactHeaderActions
          menuLabel="Code card actions"
          primaryAction={{ label: 'Edit source code', icon: <Pencil />, onSelect: () => setIsEditing(true) }}
          actions={[
            { id: 'line-wrap', label: wrapLines ? 'Disable line wrap' : 'Enable line wrap', icon: <WrapText />, onSelect: () => setWrapLines((current) => !current) },
            { id: 'copy', label: copied ? 'Source code copied' : 'Copy source code', icon: copied ? <Check /> : <Copy />, onSelect: handleCopy },
          ]}
        />
      </div>

      {description && (
        <div className="bg-black/20 border-b border-white/5 px-4 py-1 text-[11px] text-slate-400 font-sans truncate">
          {description}
        </div>
      )}

      {/* Main Code Block with Line Numbers */}
      <div
        data-scrollable="true"
        className="relative flex-1 min-h-0 w-full overflow-auto liquid-glass-code-bg p-3 text-xs font-mono leading-relaxed select-text overscroll-contain custom-card-scrollbar"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
        onDoubleClick={() => !isEditing && setIsEditing(true)}
      >
        <div className="flex min-w-full">
            {/* Line Numbers Gutter */}
            <div className="shrink-0 pr-3 mr-3 text-right select-none text-slate-500 border-r border-white/10 font-mono text-[11px] tabular-nums">
              {lineNumbers.map((num) => (
                <div key={num} className="leading-6 tabular-nums">
                  {num}
                </div>
              ))}
            </div>

            {/* Syntax Highlighted Code Lines */}
            <div
              className={`flex-1 font-mono text-[11px] leading-6 ${
                wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
              }`}
            >
              {lines.map((lineHtml, idx) => (
                <div
                  key={idx}
                  className="min-h-[1.5rem]"
                  dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                />
              ))}
              {isStreaming && (
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-sky-400 animate-pulse align-middle" />
              )}
            </div>
        </div>
      </div>
    </HTMLContainer>
    {isEditing && (
      <ShapeFocusLayer title={`Edit ${editTitle || title || 'code'}`} onClose={() => setIsEditing(false)}>
        <div className="flex h-full min-h-0 flex-col gap-3 bg-slate-950 p-3 sm:p-5">
          {(draft.hasConflict || draft.recovered || saveError || (draft.isDirty && !draft.recoveryAvailable)) && (
            <div
              role={saveError ? 'alert' : 'status'}
              className="shrink-0 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2.5 text-sm leading-relaxed text-amber-100"
            >
              {saveError ||
                (draft.hasConflict
                  ? 'Canvas content changed while this draft was open. Save to replace the latest content, or discard to load it.'
                  : !draft.recoveryAvailable
                    ? 'This draft is too large for recovery after a reload. Save it to the canvas now.'
                    : 'Recovered an unsaved code draft. Save or discard it when ready.')}
            </div>
          )}
          <div className="grid shrink-0 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
              File name
              <input
                type="text"
                value={editTitle}
                onChange={(e) => draft.setValue((current) => ({ ...current, title: e.target.value }))}
                onPointerDown={stopEventPropagation}
                className="min-h-11 rounded-xl border border-white/15 bg-black/45 px-3 text-base text-white outline-none focus:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-300/70"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
              Language
              <input
                type="text"
                value={editLanguage}
                onChange={(e) => draft.setValue((current) => ({ ...current, language: e.target.value }))}
                onPointerDown={stopEventPropagation}
                className="min-h-11 rounded-xl border border-white/15 bg-black/45 px-3 text-base text-white outline-none focus:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-300/70"
              />
            </label>
          </div>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-sm font-medium text-slate-200">
            Source code
            <textarea
              ref={textareaRef}
              value={editCode}
              onChange={(e) => draft.setValue((current) => ({ ...current, code: e.target.value }))}
              data-scrollable="true"
              placeholder="Paste or write your source code here..."
              className="min-h-0 w-full flex-1 resize-none rounded-xl border border-white/15 bg-black/45 p-3 font-mono text-base leading-relaxed text-sky-100 outline-none focus:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-300/70"
              spellCheck={false}
            />
          </label>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
            <button type="button" onClick={() => setIsEditing(false)} className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70">Return to canvas</button>
            <button type="button" onClick={handleDiscardEdit} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70">Discard draft</button>
            <button type="button" onClick={handleSaveEdit} className="min-h-11 rounded-xl bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">Save code</button>
          </div>
        </div>
      </ShapeFocusLayer>
    )}
    </>
  );
}

export class CodeCardShapeUtil extends BaseBoxShapeUtil<TLCodeCardShape> {
  static override type = 'code_card' as const;
  static override props = codeCardShapeProps;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(shape: TLCodeCardShape, info: TLResizeInfo<TLCodeCardShape>) {
    return {
      props: {
        w: Math.max(320, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(180, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLCodeCardShape['props'] {
    return {
      w: 520,
      h: 320,
      title: 'algorithm.py',
      language: 'python',
      code: `def quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + middle + quicksort(right)\n\n# Example usage:\nprint(quicksort([3, 6, 8, 10, 1, 2, 1]))`,
      description: 'Recursive QuickSort algorithm in Python',
      color: 'light-blue',
      isStreaming: false,
    };
  }

  override component(shape: TLCodeCardShape) {
    return (
      <CodeCardComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.updateShape({
            id: shape.id,
            type: 'code_card',
            props: updates,
          });
        }}
      />
    );
  }

  override indicator(shape: TLCodeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}
