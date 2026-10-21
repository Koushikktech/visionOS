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
import React, { useState, useMemo, useCallback } from 'react';
import {
  Presentation,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Copy,
  Check,
  Sparkles,
  Layers,
  FileText,
} from 'lucide-react';
import { smartStopPropagation } from '../lib/panModifier';

export interface SlideItem {
  id: string;
  title: string;
  subtitle?: string;
  layout?: 'hero' | 'split' | 'columns' | 'stats' | 'timeline' | 'takeaway' | string;
  bullets?: string[];
  content?: string;
  speakerNotes?: string;
  stats?: Array<{ label: string; value: string; change?: string }>;
  columns?: Array<{ title: string; text: string; icon?: string }>;
  timelineSteps?: Array<{ step: string; title: string; desc: string }>;
}

export type TLSlideDeckShape = TLBaseShape<
  'slide_deck',
  {
    w: number;
    h: number;
    title: string;
    subtitle?: string;
    theme?: string;
    currentSlideIndex?: number;
    slides?: SlideItem[];
    canvaEmbedUrl?: string;
  }
>;

export const slideDeckShapeProps: RecordProps<TLSlideDeckShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  subtitle: T.optional(T.string),
  theme: T.optional(T.string),
  currentSlideIndex: T.optional(T.number),
  slides: T.optional(T.arrayOf(T.any)),
  canvaEmbedUrl: T.optional(T.string),
};

export class SlideDeckShapeUtil extends BaseBoxShapeUtil<TLSlideDeckShape> {
  static override type = 'slide_deck' as const;
  static override props = slideDeckShapeProps;

  override getDefaultProps(): TLSlideDeckShape['props'] {
    return {
      w: 800,
      h: 500,
      title: 'Presentation Deck',
      subtitle: 'Interactive Slides',
      theme: 'midnight',
      currentSlideIndex: 0,
      slides: [
        {
          id: 'slide-1',
          title: 'Welcome to VisionOS Deck',
          subtitle: 'Interactive Spatial Slide Deck',
          layout: 'hero',
          bullets: ['Visual canvas architecture', 'Fully persistent records', 'Spatial multi-agent integration'],
        },
      ],
    };
  }

  override canResize = () => true;

  override onResize = (shape: TLSlideDeckShape, info: TLResizeInfo<TLSlideDeckShape>) => {
    return {
      props: {
        w: Math.max(640, Math.round(info.scaleX * shape.props.w)),
        h: Math.max(480, Math.round(info.scaleY * shape.props.h)),
      },
    };
  };

  override component(shape: TLSlideDeckShape) {
    return <SlideDeckCard shape={shape} util={this} />;
  }

  override indicator(shape: TLSlideDeckShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={16}
        ry={16}
        className="stroke-indigo-500/50 stroke-2 fill-none"
      />
    );
  }
}

function SlideDeckCard({ shape, util }: { shape: TLSlideDeckShape; util: SlideDeckShapeUtil }) {
  const { title, subtitle, theme = 'midnight', w, h } = shape.props;
  const slides = useMemo<SlideItem[]>(() => {
    const raw = shape.props.slides;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((s, idx) => ({
        id: s?.id || `slide-${idx + 1}`,
        title: s?.title || `Slide ${idx + 1}`,
        subtitle: s?.subtitle || '',
        layout: s?.layout || 'split',
        bullets: Array.isArray(s?.bullets) ? s.bullets : [],
        content: typeof s?.content === 'string' ? s.content : '',
        speakerNotes: typeof s?.speakerNotes === 'string' ? s.speakerNotes : '',
        stats: Array.isArray(s?.stats) ? s.stats : [],
        columns: Array.isArray(s?.columns) ? s.columns : [],
        timelineSteps: Array.isArray(s?.timelineSteps) ? s.timelineSteps : [],
      }));
    }
    return [
      {
        id: 'slide-1',
        title: title || 'Presentation Slide',
        subtitle: subtitle || '',
        layout: 'hero',
        bullets: ['Overview of slide contents', 'All data recovered successfully'],
      },
    ];
  }, [shape.props.slides, title, subtitle]);

  const [activeSlideIdx, setActiveSlideIdx] = useState<number>(shape.props.currentSlideIndex || 0);
  const [copied, setCopied] = useState(false);

  const safeIdx = Math.min(Math.max(0, activeSlideIdx), slides.length - 1);
  const currentSlide = slides[safeIdx] || slides[0];

  const handlePrev = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = Math.max(0, safeIdx - 1);
      setActiveSlideIdx(next);
      util.editor.updateShape<TLSlideDeckShape>({
        id: shape.id,
        type: 'slide_deck',
        props: { currentSlideIndex: next },
      });
    },
    [safeIdx, shape.id, util.editor]
  );

  const handleNext = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = Math.min(slides.length - 1, safeIdx + 1);
      setActiveSlideIdx(next);
      util.editor.updateShape<TLSlideDeckShape>({
        id: shape.id,
        type: 'slide_deck',
        props: { currentSlideIndex: next },
      });
    },
    [safeIdx, slides.length, shape.id, util.editor]
  );

  const handleCopyMarkdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const md = slides
        .map(
          (s, idx) =>
            `# Slide ${idx + 1}: ${s.title}\n${s.subtitle ? `*${s.subtitle}*\n\n` : ''}${
              s.bullets && s.bullets.length > 0 ? s.bullets.map((b) => `- ${b}`).join('\n') : s.content || ''
            }\n`
        )
        .join('\n---\n\n');
      navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [slides]
  );

  return (
    <HTMLContainer
      style={{
        width: `${w}px`,
        height: `${h}px`,
        pointerEvents: 'all',
      }}
      className="relative select-none overflow-hidden rounded-2xl liquid-glass-card text-slate-100 flex flex-col font-sans antialiased"
      onWheel={smartStopPropagation}
    >
      {/* Top Header Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between liquid-glass-header px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Presentation className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-white truncate max-w-[280px]">
              {title || 'Presentation Deck'}
            </h2>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-mono tabular-nums text-white/80 border border-white/10">
            {safeIdx + 1} / {slides.length}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5" onPointerDown={stopEventPropagation}>
          <button
            type="button"
            onClick={handleCopyMarkdown}
            title="Copy entire slide deck as Markdown"
            className="min-h-[40px] px-3 flex items-center gap-1.5 rounded-lg text-[11px] font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
            <span>{copied ? 'Copied' : 'Export MD'}</span>
          </button>

          <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

          {/* Prev/Next Navigation */}
          <button
            type="button"
            onClick={handlePrev}
            disabled={safeIdx === 0}
            title="Previous Slide"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/15 active:scale-[0.96] disabled:opacity-30 disabled:pointer-events-none transition-all"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={safeIdx === slides.length - 1}
            title="Next Slide"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/15 active:scale-[0.96] disabled:opacity-30 disabled:pointer-events-none transition-all"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Slide Body Stage */}
      <div className="relative flex-1 overflow-y-auto p-6 flex flex-col justify-center">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
          <div>
            <span className="text-[10px] font-mono tabular-nums tracking-wider text-slate-400 uppercase font-semibold">
              Slide {safeIdx + 1}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
              {currentSlide.title}
            </h1>
            {currentSlide.subtitle && (
              <p className="text-sm text-slate-300 mt-1 font-normal">
                {currentSlide.subtitle}
              </p>
            )}
          </div>

          {/* Bullets List */}
          {currentSlide.bullets && currentSlide.bullets.length > 0 && (
            <ul className="space-y-2.5 mt-2">
              {currentSlide.bullets.map((b, bIdx) => (
                <li key={bIdx} className="flex items-start gap-2.5 text-xs text-slate-200">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  <span className="leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Key Stats Showcase if present */}
          {currentSlide.stats && currentSlide.stats.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              {currentSlide.stats.map((st, stIdx) => (
                <div
                  key={stIdx}
                  className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col"
                >
                  <span className="text-xs text-white/60">{st.label}</span>
                  <span className="text-xl font-bold text-white mt-0.5 tabular-nums">{st.value}</span>
                  {st.change && (
                    <span className="text-[10px] text-emerald-400 mt-1 font-mono tabular-nums">
                      {st.change}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Columns Showcase if present */}
          {currentSlide.columns && currentSlide.columns.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {currentSlide.columns.map((col, cIdx) => (
                <div
                  key={cIdx}
                  className="rounded-xl border border-white/10 bg-white/5 p-3 flex flex-col gap-1"
                >
                  <h3 className="text-xs font-semibold text-indigo-300">{col.title}</h3>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{col.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Freeform content if present */}
          {currentSlide.content && (!currentSlide.bullets || currentSlide.bullets.length === 0) && (
            <div className="text-xs text-slate-200 leading-relaxed mt-2 whitespace-pre-wrap">
              {currentSlide.content}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Slide Pager Bar */}
      <div className="flex min-h-[40px] shrink-0 items-center justify-between border-t border-white/5 px-4 bg-white/[0.02]">
        <span className="text-[10px] font-mono text-white/40">
          VisionOS Presentation View
        </span>

        {/* Thumbnail Dots */}
        <div className="flex items-center gap-1" onPointerDown={stopEventPropagation}>
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setActiveSlideIdx(idx);
                util.editor.updateShape<TLSlideDeckShape>({
                  id: shape.id,
                  type: 'slide_deck',
                  props: { currentSlideIndex: idx },
                });
              }}
              title={`Jump to slide ${idx + 1}`}
              aria-label={`Jump to slide ${idx + 1}`}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center active:scale-[0.96] transition-transform"
            >
              <div
                className={`h-1.5 rounded-full transition-all ${
                  idx === safeIdx ? 'w-5 bg-white/80' : 'w-1.5 bg-white/20 hover:bg-white/40'
                }`}
              />
            </button>
          ))}
        </div>
      </div>
    </HTMLContainer>
  );
}
