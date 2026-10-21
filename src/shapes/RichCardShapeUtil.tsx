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
  Sparkles,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Lightbulb,
  FileText,
  FlaskConical,
  Columns,
  Terminal,
  Pencil,
  Eye,
  GripHorizontal,
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import type { CardArchetype } from '../types/spatial';
import { smartStopPropagation } from '../lib/panModifier';

export type TLRichCardShape = TLBaseShape<
  'rich_card',
  {
    w: number;
    h: number;
    title: string;
    content: string;
    archetype: CardArchetype;
    color: string;
    isStreaming: boolean;
  }
>;

export const richCardShapeProps: RecordProps<TLRichCardShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  content: T.string,
  archetype: T.string as unknown as T.Validator<CardArchetype>,
  color: T.string,
  isStreaming: T.boolean,
};

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

const customRenderer = new marked.Renderer();

customRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = (lang || 'text').toLowerCase();
  const grammar = Prism.languages[language] || Prism.languages.javascript || Prism.languages.text;
  let highlighted = text;
  if (grammar) {
    try {
      highlighted = Prism.highlight(text, grammar, language);
    } catch {
      highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } else {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return `
<div class="my-2.5 rounded-xl overflow-hidden border border-white/10 bg-[#0c0e18]/90 font-mono text-[11px] leading-relaxed shadow-lg">
  <div class="flex items-center justify-between px-3 py-1 bg-white/5 border-b border-white/5 text-[10px] text-slate-400 font-sans select-none">
    <span class="font-mono text-indigo-300 font-semibold uppercase tracking-wider text-[9px]">${language}</span>
    <span class="text-[9px] text-slate-500">code</span>
  </div>
  <pre class="p-2.5 overflow-x-auto text-slate-200 custom-card-scrollbar"><code class="language-${language}">${highlighted}</code></pre>
</div>
`;
};

customRenderer.codespan = function ({ text }: { text: string }) {
  return `<code class="rounded-md bg-white/10 border border-white/10 px-1.5 py-0.5 text-[11px] font-mono text-indigo-300">${text}</code>`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer: customRenderer,
});

/**
 * Safely parses text containing $...$ (inline math) and $$...$$ (block math) with KaTeX,
 * then renders markdown via marked.
 */
function renderMarkdownWithKaTeX(rawText: string): string {
  if (!rawText) return '';

  let processed = rawText;

  // 1. Block math $$...$$
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-block my-2 overflow-x-auto py-1">${katex.renderToString(math.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<pre class="bg-black/30 p-2 rounded text-red-300 font-mono text-xs">${math}</pre>`;
    }
  });

  // 2. Inline math $...$
  processed = processed.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, math) => {
    try {
      return `<span class="katex-inline">${katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false,
      })}</span>`;
    } catch {
      return `<code class="bg-black/30 px-1 rounded text-red-300 font-mono">${math}</code>`;
    }
  });

  try {
    const rawHtml = marked.parse(processed) as string;
    if (typeof window !== 'undefined') {
      return DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: [
          'annotation',
          'semantics',
          'math',
          'mrow',
          'mi',
          'mo',
          'mn',
          'msup',
          'msub',
          'mfrac',
          'mover',
          'munder',
          'msubsup',
          'mtext',
          'mspace',
          'mtable',
          'mtr',
          'mtd',
        ],
        ADD_ATTR: ['display', 'xmlns'],
      });
    }
    return rawHtml;
  } catch {
    return processed.replace(/\n/g, '<br/>');
  }
}

const ARCHETYPE_CONFIG: Record<
  CardArchetype,
  {
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  }
> = {
  idea: {
    label: 'Idea',
    icon: Lightbulb,
  },
  note: {
    label: 'Note',
    icon: FileText,
  },
  research: {
    label: 'Research',
    icon: FlaskConical,
  },
  comparison: {
    label: 'Matrix',
    icon: Columns,
  },
  prompt: {
    label: 'Prompt',
    icon: Terminal,
  },
};

function RichCardComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLRichCardShape;
  editor?: any;
  onUpdate: (updates: Partial<TLRichCardShape['props']>) => void;
}) {
  const isSelected = Boolean(editor?.getSelectedShapeIds?.()?.includes(shape.id));
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(shape.props.title);
  const [editContent, setEditContent] = useState(shape.props.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { w, h, title, content, archetype = 'note', isStreaming } = shape.props;
  const config = ARCHETYPE_CONFIG[archetype] || ARCHETYPE_CONFIG.note;
  const IconComponent = config.icon;

  useEffect(() => {
    setEditTitle(shape.props.title);
    setEditContent(shape.props.content);
  }, [shape.props.title, shape.props.content]);

  const htmlContent = useMemo(() => {
    return renderMarkdownWithKaTeX(content);
  }, [content]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const fullText = `# ${title}\n\n${content}`;
      navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    },
    [title, content]
  );

  const handleSaveEdit = useCallback(() => {
    setIsEditing(false);
    onUpdate({
      title: editTitle.trim() || 'Untitled Note',
      content: editContent,
    });
  }, [editTitle, editContent, onUpdate]);

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col antialiased"
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
          <IconComponent className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.5} />

          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
              }}
              className="bg-black/50 border border-white/20 rounded px-2 py-0.5 text-xs text-white outline-none focus:border-white/40 font-semibold flex-1"
              placeholder="Note Title..."
            />
          ) : (
            <span
              className="truncate text-xs font-semibold tracking-wide text-slate-200"
              title={title}
              onDoubleClick={() => setIsEditing(true)}
            >
              {title || 'Canvas Note'}
            </span>
          )}

          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400 bg-white/5 border border-white/10 uppercase tracking-wider"
          >
            {config.label}
          </span>

          {isStreaming && (
            <span className="flex items-center gap-1 text-[9px] font-mono tabular-nums text-indigo-300 animate-pulse bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-400/20">
              <Sparkles className="h-2.5 w-2.5" />
              Streaming...
            </span>
          )}
        </div>

        {/* Card Controls */}
        <div
          className="flex items-center gap-1 shrink-0"
          onPointerDown={stopEventPropagation}
        >
          <button
            type="button"
            onClick={() => {
              if (isEditing) handleSaveEdit();
              else setIsEditing(true);
            }}
            title={isEditing ? 'Preview Markdown' : 'Edit Note Content'}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {isEditing ? <Eye className="h-4 w-4 text-indigo-400" strokeWidth={1.5} /> : <Pencil className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy Markdown'}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* Body Area: Live Markdown + KaTeX OR Interactive Editor */}
      <div
        data-scrollable="true"
        className="relative flex-1 min-h-0 w-full overflow-y-auto p-4 text-xs leading-relaxed text-slate-200 select-text overscroll-contain custom-card-scrollbar"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
        onDoubleClick={() => !isEditing && setIsEditing(true)}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onPointerDown={smartStopPropagation}
            data-scrollable="true"
            placeholder="Write your markdown and LaTeX math formulas ($E=mc^2$ or $$\int...$$)..."
            className="w-full h-full resize-none bg-black/40 border border-white/10 rounded-xl p-3 font-mono text-xs text-indigo-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <>
            <div
              className="rich-card-prose prose prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-headings:text-white prose-pre:my-2 prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-indigo-300 prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0.5"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
            )}
          </>
        )}
      </div>
    </HTMLContainer>
  );
}

export class RichCardShapeUtil extends BaseBoxShapeUtil<TLRichCardShape> {
  static override type = 'rich_card' as const;
  static override props = richCardShapeProps;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(shape: TLRichCardShape, info: TLResizeInfo<TLRichCardShape>) {
    return {
      props: {
        w: Math.max(280, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(160, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLRichCardShape['props'] {
    return {
      w: 480,
      h: 280,
      title: 'Structured Note',
      content: '## Overview\n\nWrite your rich markdown notes, thoughts, and math here:\n\n$$E = mc^2$$',
      archetype: 'note',
      color: 'light-blue',
      isStreaming: false,
    };
  }

  override component(shape: TLRichCardShape) {
    return (
      <RichCardComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.updateShape({
            id: shape.id,
            type: 'rich_card',
            props: updates,
          });
        }}
      />
    );
  }

  override indicator(shape: TLRichCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}
