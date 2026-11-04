'use client';

import { AIOrb } from '../components/AIOrb';


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
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import type { CardArchetype } from '../types/spatial';
import { smartStopPropagation } from '../lib/panModifier';
import { useShapeDraft } from '../hooks/useShapeDraft';
import { ShapeFocusLayer } from '../components/ShapeFocusLayer';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';
import { subscribeToShapeEditing } from '../lib/shapeEditing';

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
  const [saveError, setSaveError] = useState('');
  const draft = useShapeDraft(
    `rich_card:${shape.id}`,
    { title: shape.props.title, content: shape.props.content },
    { editor, shapeId: shape.id }
  );
  const editTitle = draft.value.title;
  const editContent = draft.value.content;
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

  const { w, h, title, content, archetype = 'note', isStreaming } = shape.props;
  const config = ARCHETYPE_CONFIG[archetype] || ARCHETYPE_CONFIG.note;
  const IconComponent = config.icon;

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
    const next = {
      title: editTitle.trim() || 'Untitled Note',
      content: editContent,
    };
    setSaveError('');
    try {
      onUpdate(next);
      const savedShape = editor?.getShape?.(shape.id);
      if (
        savedShape?.type !== 'rich_card' ||
        savedShape.props.title !== next.title ||
        savedShape.props.content !== next.content
      )
        throw new Error('The note could not be saved to the canvas. Your draft is still here.');
      draft.save(next);
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The note could not be saved. Your draft is still here.');
    }
  }, [editTitle, editContent, onUpdate, editor, shape.id, draft.save]);

  const handleDiscardEdit = useCallback(() => {
    draft.discard();
    setSaveError('');
    setIsEditing(false);
  }, [draft.discard]);

  return (
    <>
    <HTMLContainer
      id={shape.id}
      className="studio-native-window studio-native-note pointer-events-auto overflow-hidden rounded-2xl transition-colors flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Window Bar */}
      <div
        data-window-header="note"
        className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <IconComponent className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.5} />

          <span
            data-window-title
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title}
            onDoubleClick={() => setIsEditing(true)}
          >
            {title || 'Canvas Note'}
          </span>

          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400 bg-white/5 border border-white/10 uppercase tracking-wider"
          >
            {config.label}
          </span>

          {isStreaming && (
            <span className="flex items-center gap-1 text-[9px] font-mono tabular-nums text-indigo-300 animate-pulse bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-400/20">
              <AIOrb className="h-2.5 w-2.5" />
              Streaming...
            </span>
          )}
        </div>

        {/* Card Controls */}
        <ArtifactHeaderActions
          menuLabel="Note actions"
          primaryAction={{ label: 'Edit note content', icon: <Pencil />, onSelect: () => setIsEditing(true) }}
          actions={[{ id: 'copy', label: copied ? 'Markdown copied' : 'Copy Markdown', icon: copied ? <Check /> : <Copy />, onSelect: handleCopy }]}
        />
      </div>

      {/* Body Area: Live Markdown + KaTeX */}
      <div
        data-scrollable="true"
        className="relative flex-1 min-h-0 w-full overflow-y-auto p-4 text-sm leading-relaxed text-slate-200 select-text overscroll-contain custom-card-scrollbar"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
        onDoubleClick={() => !isEditing && setIsEditing(true)}
      >
        <div
          className="rich-card-prose prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-headings:text-white prose-pre:my-2 prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-indigo-300 prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0.5"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle" />
        )}
      </div>
    </HTMLContainer>
    {isEditing && (
      <ShapeFocusLayer title={`Edit ${editTitle || title || 'note'}`} onClose={() => setIsEditing(false)}>
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
                    : 'Recovered an unsaved note draft. Save or discard it when ready.')}
            </div>
          )}
          <label className="flex shrink-0 flex-col gap-1.5 text-sm font-medium text-slate-200">
            Note title
            <input
              type="text"
              value={editTitle}
              onChange={(e) => draft.setValue((current) => ({ ...current, title: e.target.value }))}
              onPointerDown={stopEventPropagation}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); }}
              className="min-h-11 rounded-xl border border-white/15 bg-black/45 px-3 text-base text-white outline-none focus:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-300/70"
              placeholder="Note title"
            />
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-sm font-medium text-slate-200">
            Markdown and LaTeX content
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => draft.setValue((current) => ({ ...current, content: e.target.value }))}
              data-scrollable="true"
              placeholder="Write your markdown and LaTeX math formulas ($E=mc^2$ or $$\int...$$)..."
              className="min-h-0 w-full flex-1 resize-none rounded-xl border border-white/15 bg-black/45 p-3 font-mono text-base leading-relaxed text-indigo-100 outline-none focus:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-300/70"
            />
          </label>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
            <button type="button" onClick={() => setIsEditing(false)} className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70">Return to canvas</button>
            <button type="button" onClick={handleDiscardEdit} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70">Discard draft</button>
            <button type="button" onClick={handleSaveEdit} className="min-h-11 rounded-xl bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">Save note</button>
          </div>
        </div>
      </ShapeFocusLayer>
    )}
    </>
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
