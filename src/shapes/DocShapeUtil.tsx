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
import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  FileText,
  Copy,
  Check,
  Download,
  ListCollapse,
  ChevronRight,
  User,
  Calendar,
  Clock,
  Pencil,
  Eye,
  Bookmark,
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import { smartStopPropagation } from '../lib/panModifier';
import type { DocSection } from '../types/spatial';

export type TLDocShape = TLBaseShape<
  'document',
  {
    w: number;
    h: number;
    title: string;
    subtitle?: string;
    author?: string;
    date?: string;
    sections: DocSection[];
    activeSectionId?: string;
  }
>;

export const docShapeProps: RecordProps<TLDocShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  subtitle: T.optional(T.string),
  author: T.optional(T.string),
  date: T.optional(T.string),
  sections: T.arrayOf(T.any) as unknown as T.Validator<DocSection[]>,
  activeSectionId: T.optional(T.string),
};

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
<div class="my-3 rounded-xl overflow-hidden border border-white/10 bg-[#0c0e18]/90 font-mono text-[11px] leading-relaxed shadow-lg">
  <div class="flex items-center justify-between px-3 py-1 bg-white/5 border-b border-white/5 text-[10px] text-slate-400 font-sans select-none">
    <span class="font-mono text-indigo-300 font-semibold uppercase tracking-wider text-[9px]">${language}</span>
    <span class="text-[9px] text-slate-500">code</span>
  </div>
  <pre class="p-3 overflow-x-auto text-slate-200 custom-card-scrollbar"><code class="language-${language}">${highlighted}</code></pre>
</div>
`;
};

function renderMarkdownWithMath(content: string): string {
  if (!content) return '';

  // Process LaTeX math formulas ($inline$, $$block$$)
  let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<div class="katex-error text-xs text-red-400 my-1">${math}</div>`;
    }
  });

  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="katex-error text-xs text-red-400">${math}</span>`;
    }
  });

  const rawHtml = marked.parse(processed, {
    renderer: customRenderer,
    breaks: true,
    gfm: true,
  }) as string;

  return DOMPurify.sanitize(rawHtml);
}

function DocComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLDocShape;
  editor?: any;
  onUpdate: (updates: Partial<TLDocShape['props']>) => void;
}) {
  const isSelected = Boolean(editor?.getSelectedShapeIds?.()?.includes(shape.id));
  const {
    w,
    h,
    title = 'Untitled Document',
    subtitle,
    author = 'VisionOS AI',
    date = 'September 2026',
    sections = [],
  } = shape.props;

  const [showTOC, setShowTOC] = useState(true);
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id || 'sec_1');
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fallback if no sections
  const safeSections = useMemo<DocSection[]>(() => {
    if (sections && sections.length > 0) return sections;
    return [
      {
        id: 'sec_1',
        title: 'Overview',
        content: 'Document initialized on VisionOS.',
      },
    ];
  }, [sections]);

  // Estimate read time
  const readTimeMin = useMemo(() => {
    const totalWords = safeSections.reduce(
      (acc, s) => acc + (s.content ? s.content.split(/\s+/).length : 0),
      0
    );
    return Math.max(1, Math.ceil(totalWords / 200));
  }, [safeSections]);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const targetElement = document.getElementById(`doc-sec-${sectionId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleCopyMarkdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const md = [
        `# ${title}`,
        subtitle ? `*${subtitle}*\n` : '',
        `**Author:** ${author} | **Date:** ${date}\n`,
        '---',
        ...safeSections.map((s) => `\n## ${s.title}\n\n${s.content}`),
      ].join('\n');

      navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [title, subtitle, author, date, safeSections]
  );

  const handleExportMarkdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const md = [
        `# ${title}`,
        subtitle ? `*${subtitle}*\n` : '',
        `**Author:** ${author} | **Date:** ${date}\n`,
        '---',
        ...safeSections.map((s) => `\n## ${s.title}\n\n${s.content}`),
      ].join('\n');

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [title, subtitle, author, date, safeSections]
  );

  const handleExportHTML = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      background: #090b14;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 24px;
      line-height: 1.7;
    }
    h1 { font-size: 36px; font-weight: 800; color: #fff; margin-bottom: 8px; }
    h2 { font-size: 22px; font-weight: 700; color: #818cf8; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; }
    p { margin-bottom: 16px; color: #cbd5e1; }
    pre { background: #0c0e18; padding: 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); overflow-x: auto; font-family: monospace; }
    .meta { font-size: 13px; color: #94a3b8; margin-bottom: 32px; display: flex; gap: 16px; }
    @media print {
      body { background: #fff; color: #000; max-width: none; }
      h1, h2 { color: #000; }
      p { color: #222; }
      pre { background: #f8fafc; border-color: #cbd5e1; color: #000; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<p style="font-size: 18px; color: #94a3b8;">${subtitle}</p>` : ''}
  <div class="meta">
    <span>Author: ${author}</span>
    <span>Date: ${date}</span>
  </div>
  ${safeSections
    .map(
      (s) => `
    <section>
      <h2>${s.title}</h2>
      <div>${renderMarkdownWithMath(s.content)}</div>
    </section>
  `
    )
    .join('')}
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [title, subtitle, author, date, safeSections]
  );

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Navigation Bar */}
      <div className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <FileText className="h-4 w-4 text-slate-300 shrink-0" strokeWidth={1.5} />
          <span
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title}
          >
            {title}
          </span>
          <span className="shrink-0 rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400">
            {safeSections.length} sections
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0" onPointerDown={stopEventPropagation}>
          {/* Toggle Table of Contents */}
          <button
            type="button"
            onClick={() => setShowTOC((prev) => !prev)}
            title={showTOC ? 'Hide Table of Contents' : 'Show Table of Contents'}
            className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-all active:scale-[0.96] ${
              showTOC
                ? 'bg-white/15 text-white'
                : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
            }`}
          >
            <ListCollapse className="h-4 w-4" strokeWidth={1.5} />
          </button>

          {/* Copy Markdown */}
          <button
            type="button"
            onClick={handleCopyMarkdown}
            title="Copy Document as Markdown"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>

          {/* Export Dropdown / Download */}
          <button
            type="button"
            onClick={handleExportHTML}
            title="Export Document (Printable HTML / PDF)"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Main Document Split Workspace */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Sticky Table of Contents Sidebar */}
        {showTOC && (
          <div
            className="w-44 shrink-0 border-r border-white/10 bg-black/30 p-3 overflow-y-auto custom-card-scrollbar select-none"
            onPointerDown={isSelected ? smartStopPropagation : undefined}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Bookmark className="h-3 w-3 text-indigo-400" />
              <span>Outline</span>
            </div>

            <nav className="space-y-1">
              {safeSections.map((sec, idx) => (
                <button
                  key={sec.id || idx}
                  onClick={() => scrollToSection(sec.id)}
                  className={`w-full text-left rounded-lg px-2 py-1.5 text-[11px] leading-tight transition-all flex items-center justify-between group ${
                    activeSection === sec.id
                      ? 'bg-indigo-500/15 text-indigo-200 font-medium border border-indigo-500/25'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{sec.title}</span>
                  <ChevronRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500" />
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Scrollable Document Body */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto p-6 select-text custom-card-scrollbar"
          onPointerDown={isSelected ? smartStopPropagation : undefined}
        >
          {/* Header Banner */}
          <div className="border-b border-white/10 pb-5 mb-6">
            <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1.5 leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-slate-300 leading-relaxed font-light mb-3">{subtitle}</p>
            )}

            {/* Document Metadata Pills */}
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-400">
              {author && (
                <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-300">
                  <User className="h-2.5 w-2.5 text-indigo-400" />
                  {author}
                </span>
              )}
              {date && (
                <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-400">
                  <Calendar className="h-2.5 w-2.5 text-indigo-400" />
                  {date}
                </span>
              )}
              <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-400 tabular-nums">
                <Clock className="h-2.5 w-2.5 text-slate-400" />
                <span className="tabular-nums">{readTimeMin}</span> min read
              </span>
            </div>
          </div>

          {/* Rendered Sections */}
          <div className="space-y-8">
            {safeSections.map((sec, idx) => (
              <section
                key={sec.id || idx}
                id={`doc-sec-${sec.id}`}
                className="scroll-mt-4 group border-b border-white/5 pb-6 last:border-none"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/10 border border-white/10 text-[10px] font-mono font-bold text-slate-200 tabular-nums">
                    {idx + 1}
                  </span>
                  <h2 className="text-base font-bold text-white tracking-tight">{sec.title}</h2>
                  {sec.badge && (
                    <span className="rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                      {sec.badge}
                    </span>
                  )}
                </div>

                <div
                  className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed text-xs"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownWithMath(sec.content) }}
                />
              </section>
            ))}
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

export class DocShapeUtil extends BaseBoxShapeUtil<TLDocShape> {
  static override type = 'document' as const;
  static override props = docShapeProps;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(shape: TLDocShape, info: TLResizeInfo<TLDocShape>) {
    return {
      props: {
        w: Math.max(480, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(340, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLDocShape['props'] {
    return {
      w: 680,
      h: 520,
      title: 'VisionOS Technical Specification',
      subtitle:
        'A comprehensive design document and architecture specification for multi-modal spatial computing.',
      author: 'VisionOS Kernel & Swarm',
      date: 'September 2026',
      sections: [
        {
          id: 'sec_1',
          title: 'Executive Summary',
          badge: 'Overview',
          content:
            'VisionOS merges 2D spatial canvas computing with an autonomous Hermes-grade multi-agent swarm. By combining a Kiwi.js linear constraint solver with low-latency token streaming, VisionOS delivers an AI workspace operating at 60 FPS.',
        },
        {
          id: 'sec_2',
          title: 'Mathematical Foundations',
          badge: 'Cassowary Solver',
          content:
            'Layout bounds are solved via Cassowary simplex tableau equations:\n\n$$\\min \\sum_{i} w_i \\cdot (s_i^+ + s_i^-) \\quad \\text{subject to} \\quad A \\cdot x = b$$\n\nEvery card maintains non-overlapping bounding margins with dynamic edge connectors.',
        },
        {
          id: 'sec_3',
          title: 'Implementation Architecture',
          badge: 'System Pipeline',
          content:
            'The system is partitioned into three decoupled layers:\n- **Kernel Layer:** Next.js App Router and Web Worker protocol streamer.\n- **Substrate Layer:** `tldraw` v3 custom shape utilities.\n- **Swarm Layer:** Hierarchical DAG macro-planner streaming parallel specialist workers.',
        },
      ],
    };
  }

  override component(shape: TLDocShape) {
    return (
      <DocComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.updateShape({
            id: shape.id,
            type: 'document',
            props: updates,
          });
        }}
      />
    );
  }

  override indicator(shape: TLDocShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}
