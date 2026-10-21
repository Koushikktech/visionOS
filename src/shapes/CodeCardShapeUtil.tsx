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
  Eye,
  GripHorizontal,
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
  const [editTitle, setEditTitle] = useState(shape.props.title);
  const [editCode, setEditCode] = useState(shape.props.code);
  const [editLanguage, setEditLanguage] = useState(shape.props.language);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { w, h, title, language, code, description, isStreaming } = shape.props;
  const normLang = normalizeLanguage(language);
  const badge = LANGUAGE_BADGES[normLang] || {
    label: (language || 'CODE').toUpperCase(),
    bg: 'bg-indigo-500/20',
    text: 'text-indigo-300',
    border: 'border-indigo-500/30',
  };

  useEffect(() => {
    setEditTitle(shape.props.title);
    setEditCode(shape.props.code);
    setEditLanguage(shape.props.language);
  }, [shape.props.title, shape.props.code, shape.props.language]);

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
    setIsEditing(false);
    onUpdate({
      title: editTitle.trim() || 'code_snippet',
      language: editLanguage.trim() || 'javascript',
      code: editCode,
    });
  }, [editTitle, editLanguage, editCode, onUpdate]);

  // Syntax highlighting with line numbers
  const { lines, lineNumbers } = useMemo(() => {
    const codeText = isEditing ? editCode : code;
    const grammar = Prism.languages[normLang] || Prism.languages.javascript || Prism.languages.markup;
    const highlighted = Prism.highlight(codeText || '', grammar, normLang);

    const splitLines = highlighted.split('\n');
    const numbers = Array.from({ length: splitLines.length }, (_, i) => i + 1);

    return {
      lines: splitLines,
      lineNumbers: numbers,
    };
  }, [code, editCode, isEditing, normLang]);

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col font-sans antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Window Bar */}
      <div
        className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          {/* macOS window dots */}
          <div className="flex items-center gap-1.5 mr-1 shrink-0 opacity-75">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
          </div>

          <FileCode className="h-4 w-4 text-slate-400 shrink-0 ml-1" strokeWidth={1.5} />

          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
              }}
              className="bg-black/50 border border-white/20 rounded px-2 py-0.5 text-xs text-white outline-none focus:border-white/40 font-mono flex-1"
              placeholder="filename.ext..."
            />
          ) : (
            <span
              className="truncate text-xs font-mono font-medium tracking-wide text-slate-200"
              title={title}
              onDoubleClick={() => setIsEditing(true)}
            >
              {title || 'code_snippet'}
            </span>
          )}

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
        <div
          className="flex items-center gap-1 shrink-0"
          onPointerDown={stopEventPropagation}
        >
          <button
            type="button"
            onClick={() => setWrapLines(!wrapLines)}
            title={wrapLines ? 'Disable Line Wrap' : 'Enable Line Wrap'}
            className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-all active:scale-[0.96] ${
              wrapLines ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
            }`}
          >
            <WrapText className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (isEditing) handleSaveEdit();
              else setIsEditing(true);
            }}
            title={isEditing ? 'Save / View Highlighted' : 'Edit Source Code'}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {isEditing ? <Eye className="h-4 w-4 text-indigo-400" strokeWidth={1.5} /> : <Pencil className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied to Clipboard!' : 'Copy Source Code'}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {description && (
        <div className="bg-black/20 border-b border-white/5 px-4 py-1 text-[11px] text-slate-400 font-sans truncate">
          {description}
        </div>
      )}

      {/* Main Code Block with Line Numbers */}
      <div
        data-scrollable="true"
        className="relative flex-1 min-h-0 w-full overflow-auto liquid-glass-code-bg p-3 text-[11px] font-mono leading-relaxed select-text overscroll-contain custom-card-scrollbar"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
        onDoubleClick={() => !isEditing && setIsEditing(true)}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            onPointerDown={smartStopPropagation}
            data-scrollable="true"
            placeholder="Paste or write your source code here..."
            className="w-full h-full resize-none bg-black/40 border border-white/10 rounded-xl p-3 font-mono text-xs text-sky-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            spellCheck={false}
          />
        ) : (
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
        )}
      </div>
    </HTMLContainer>
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
