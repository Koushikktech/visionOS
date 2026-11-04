'use client';

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  TLBaseShape,
  T,
  RecordProps,
  stopEventPropagation,
  TLResizeInfo,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  type Editor,
  type TLShapeId,
} from '@tldraw/tldraw';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceActive } from '../components/WorkspaceActivity';
import { createPortal } from 'react-dom';
import {
  Presentation,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Copy,
  Check,
  Pencil,
  Eye,
  Download,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
  StickyNote,
} from 'lucide-react';
import { smartStopPropagation } from '../lib/panModifier';
import {
  deckThemeValidator,
  slideItemsValidator,
} from '../lib/shapeContentSchema';
import { useShapeDraft } from '../hooks/useShapeDraft';
import { isCanvasShapeLocked } from '../lib/spatialContext';
import {
  deckToJson,
  deckToMarkdown,
  isValidDeckDraft,
  makeContentId,
  moveItem,
  safeContentFilename,
  type DeckDraft,
  type DeckSlideContent,
} from '../lib/contentEditing';
import { copyTextToClipboard } from '../components/SpatialAIOmnibar';
import { ShapeFocusLayer } from '../components/ShapeFocusLayer';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { subscribeToShapeEditing } from '../lib/shapeEditing';

export interface SlideItem extends DeckSlideContent {
  layout?: 'hero' | 'split' | 'columns' | 'stats' | 'timeline' | 'takeaway' | string;
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
  title: T.string.check((value) => {
    if (value.length > 1_000_000) throw new Error('Deck title is too long.');
  }),
  subtitle: T.optional(T.string.check((value) => {
    if (value.length > 1_000_000) throw new Error('Deck subtitle is too long.');
  })),
  theme: T.optional(deckThemeValidator),
  currentSlideIndex: T.optional(T.number.check((value) => {
    if (!Number.isInteger(value) || value < 0 || value >= 500) throw new Error('Invalid slide index.');
  })),
  slides: T.optional(slideItemsValidator) as T.Validator<SlideItem[] | undefined>,
  canvaEmbedUrl: T.optional(T.string.check((value) => {
    if (value.length > 1_000_000) throw new Error('Embed URL is too long.');
  })),
};

const slideDeckShapeVersions = createShapePropsMigrationIds('slide_deck', {
  AddSlideDefaults: 1,
});

export const slideDeckShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: slideDeckShapeVersions.AddSlideDefaults,
      up: (props) => {
        if (!Array.isArray(props.slides)) return;
        // Retain all legacy fields and only fill fields the former renderer defaulted.
        props.slides = props.slides.map((slide: unknown, index: number) => {
          if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return slide;
          const legacy = slide as Record<string, unknown>;
          return {
            ...legacy,
            id: legacy.id === undefined ? `slide-${index + 1}` : legacy.id,
            title: legacy.title === undefined ? `Slide ${index + 1}` : legacy.title,
          };
        });
      },
      down: 'retired',
    },
  ],
});

const LAYOUTS = [
  { value: 'hero', label: 'Title' },
  { value: 'split', label: 'Split' },
  { value: 'columns', label: 'Columns' },
  { value: 'stats', label: 'Stats' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'takeaway', label: 'Takeaway' },
] as const;

const THEMES = [
  { value: 'midnight', label: 'Midnight', background: '#0a1020', foreground: '#f8fafc', muted: '#cbd5e1', accent: '#a5b4fc', surface: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)' },
  { value: 'paper', label: 'Paper', background: '#f4efe4', foreground: '#202938', muted: '#475569', accent: '#9a5b2f', surface: 'rgba(255,255,255,0.72)', border: 'rgba(71,85,105,0.2)' },
  { value: 'ocean', label: 'Ocean', background: '#082f49', foreground: '#f0f9ff', muted: '#bae6fd', accent: '#38bdf8', surface: 'rgba(14,116,144,0.3)', border: 'rgba(125,211,252,0.28)' },
  { value: 'plum', label: 'Plum', background: '#24133a', foreground: '#faf5ff', muted: '#e9d5ff', accent: '#d8b4fe', surface: 'rgba(126,34,206,0.16)', border: 'rgba(216,180,254,0.25)' },
] as const;

type ThemeTokens = (typeof THEMES)[number];
const getTheme = (name: string): ThemeTokens => THEMES.find((theme) => theme.value === name) || THEMES[0];
const clampIndex = (index: number, length: number) => Math.min(Math.max(Number.isFinite(index) ? Math.trunc(index) : 0, 0), Math.max(0, length - 1));

function downloadText(filename: string, mime: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function DeckSlideView({ slide, index, theme, presenter = false }: {
  slide: SlideItem;
  index: number;
  theme: ThemeTokens;
  presenter?: boolean;
}) {
  const layout = LAYOUTS.some((item) => item.value === slide.layout) ? slide.layout : 'split';
  const isTitle = layout === 'hero';
  const isTakeaway = layout === 'takeaway';
  const isSplit = layout === 'split';
  const heading = (
    <section className={isTakeaway ? 'rounded-2xl border-l-4 px-5 py-4' : ''} style={isTakeaway ? { borderColor: theme.accent, background: theme.surface } : undefined}>
      <span className="text-[11px] font-mono uppercase tracking-[0.18em]" style={{ color: theme.accent }}>Slide {index + 1}</span>
      <h1 className={`${presenter ? 'text-4xl md:text-6xl' : 'text-3xl'} mt-2 font-bold leading-tight tracking-tight`} style={{ color: theme.foreground }}>{slide.title}</h1>
      {slide.subtitle && <p className={`${presenter ? 'mt-4 text-xl' : 'mt-2 text-base'} max-w-3xl`} style={{ color: theme.muted }}>{slide.subtitle}</p>}
    </section>
  );
  const body = (
    <section>
      {slide.content && <p className={`${presenter ? 'text-lg leading-8' : 'text-sm leading-7'} max-w-4xl whitespace-pre-wrap`} style={{ color: theme.muted }}>{slide.content}</p>}
      {slide.bullets?.length ? (
        <ul className={`${slide.content ? 'mt-4' : ''} ${presenter ? 'space-y-4 text-lg' : 'space-y-3 text-sm'} text-left`} style={{ color: theme.foreground }}>
          {slide.bullets.map((bullet, bulletIndex) => <li key={bulletIndex} className="flex items-start gap-3"><span aria-hidden="true" className="mt-[0.65em] h-2 w-2 shrink-0 rounded-full" style={{ background: theme.accent }} /><span className="leading-7">{bullet}</span></li>)}
        </ul>
      ) : null}
    </section>
  );
  return (
    <div className={`mx-auto flex w-full max-w-5xl flex-col gap-5 ${isTitle ? 'items-center text-center' : ''} ${isTakeaway ? 'justify-center' : ''}`}>
      {isSplit ? <div className="grid items-start gap-5 md:grid-cols-2">{heading}{body}</div> : <>{heading}{body}</>}

      {slide.stats?.length ? (
        <div className={`grid gap-3 ${layout === 'stats' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3'}`}>
          {slide.stats.map((stat, itemIndex) => <div key={itemIndex} className="rounded-2xl border p-4" style={{ background: theme.surface, borderColor: theme.border }}>
            <p className="text-xs" style={{ color: theme.muted }}>{stat.label}</p><p className={`${presenter ? 'text-4xl' : 'text-2xl'} mt-1 font-bold tabular-nums`} style={{ color: theme.foreground }}>{stat.value}</p>{stat.change && <p className="mt-2 text-xs font-medium" style={{ color: theme.accent }}>{stat.change}</p>}
          </div>)}
        </div>
      ) : null}

      {slide.columns?.length ? (
        <div className={`grid gap-3 ${layout === 'columns' ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2'}`}>
          {slide.columns.map((column, itemIndex) => <article key={itemIndex} className="rounded-2xl border p-4" style={{ background: theme.surface, borderColor: theme.border }}>
            {column.icon && <span className="mb-2 inline-flex min-h-7 items-center rounded-full px-2 text-[10px]" style={{ color: theme.accent, background: theme.surface }}>{column.icon}</span>}
            <h2 className="text-base font-semibold" style={{ color: theme.foreground }}>{column.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6" style={{ color: theme.muted }}>{column.text}</p>
          </article>)}
        </div>
      ) : null}

      {slide.timelineSteps?.length ? (
        <ol className={layout === 'timeline' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
          {slide.timelineSteps.map((step, itemIndex) => <li key={itemIndex} className={`flex gap-3 rounded-xl border p-3 ${layout === 'timeline' ? 'min-h-28 flex-col' : ''}`} style={{ background: theme.surface, borderColor: theme.border }}>
            <span className="flex min-h-9 min-w-9 items-center justify-center rounded-full text-xs font-semibold" style={{ color: theme.background, background: theme.accent }}>{step.step || String(itemIndex + 1)}</span>
            <div><h2 className="text-sm font-semibold" style={{ color: theme.foreground }}>{step.title}</h2><p className="mt-1 text-sm leading-6" style={{ color: theme.muted }}>{step.desc}</p></div>
          </li>)}
        </ol>
      ) : null}
    </div>
  );
}

function PresenterView({ deckTitle, slide, index, total, theme, onChoose, onClose }: {
  deckTitle: string;
  slide: SlideItem;
  index: number;
  total: number;
  theme: ThemeTokens;
  onChoose: (index: number) => void;
  onClose: () => void;
}) {
  const workspaceActive = useWorkspaceActive();
  const [showNotes, setShowNotes] = useState(true);
  const dialogRef = useDialogFocus<HTMLDivElement>(workspaceActive, onClose);
  useEffect(() => {
    if (!workspaceActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onChoose(Math.min(total - 1, index + 1)); }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); event.stopPropagation(); onChoose(Math.max(0, index - 1)); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [index, onChoose, onClose, total, workspaceActive]);

  if (!workspaceActive) return null;
  return createPortal(
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${deckTitle} presenter`} className="fixed inset-0 z-[10000] flex flex-col outline-none" style={{ color: theme.foreground, background: theme.background }}>
      <header className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-6" style={{ borderColor: theme.border }}>
        <div className="min-w-0"><p className="truncate text-xs font-medium">{deckTitle}</p><p className="text-[11px]" style={{ color: theme.muted }}>Presenter · {index + 1} of {total}</p></div>
        <button type="button" onClick={onClose} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border" style={{ borderColor: theme.border }} aria-label="Exit presenter"><X className="h-5 w-5" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 md:px-16 md:py-12">
        <DeckSlideView slide={slide} index={index} theme={theme} presenter />
        {showNotes && slide.speakerNotes && <section aria-label="Speaker notes" className="mx-auto mt-8 max-w-5xl rounded-xl border p-4" style={{ background: theme.surface, borderColor: theme.border }}><h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.accent }}>Speaker notes</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6" style={{ color: theme.muted }}>{slide.speakerNotes}</p></section>}
      </main>
      <footer className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-t px-3 sm:px-6" style={{ borderColor: theme.border }}>
        <button type="button" onClick={() => onChoose(Math.max(0, index - 1))} disabled={index === 0} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border disabled:opacity-35" style={{ borderColor: theme.border }} aria-label="Previous slide"><ChevronLeft className="h-5 w-5" /></button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowNotes((visible) => !visible)} aria-pressed={showNotes} className="flex min-h-[44px] items-center gap-2 rounded-xl border px-3 text-xs" style={{ borderColor: theme.border }}><StickyNote className="h-4 w-4" />{showNotes ? 'Hide notes' : 'Show notes'}</button>
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl px-4 text-xs font-semibold" style={{ color: theme.background, background: theme.accent }}>Exit</button>
        </div>
        <button type="button" onClick={() => onChoose(Math.min(total - 1, index + 1))} disabled={index === total - 1} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border disabled:opacity-35" style={{ borderColor: theme.border }} aria-label="Next slide"><ChevronRight className="h-5 w-5" /></button>
      </footer>
    </div>,
    document.body
  );
}

export class SlideDeckShapeUtil extends BaseBoxShapeUtil<TLSlideDeckShape> {
  static override type = 'slide_deck' as const;
  static override props = slideDeckShapeProps;
  static override migrations = slideDeckShapeMigrations;

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

  override onResize = (shape: TLSlideDeckShape, info: TLResizeInfo<TLSlideDeckShape>) => ({
    props: {
      w: Math.max(640, Math.round(info.scaleX * shape.props.w)),
      h: Math.max(480, Math.round(info.scaleY * shape.props.h)),
    },
  });

  override component(shape: TLSlideDeckShape) {
    return <SlideDeckCard shape={shape} editor={this.editor} />;
  }

  override indicator(shape: TLSlideDeckShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} className="stroke-indigo-500/50 stroke-2 fill-none" />;
  }
}

function SlideDeckCard({ shape, editor }: { shape: TLSlideDeckShape; editor: Editor }) {
  const { title, w, h } = shape.props;
  const slides = useMemo<SlideItem[]>(() => {
    const raw = shape.props.slides;
    if (!Array.isArray(raw)) return [];
    return raw.map((slide, index) => ({
      ...slide,
      id: slide.id || `slide-${index + 1}`,
      title: slide.title || `Slide ${index + 1}`,
    }));
  }, [shape.props.slides]);

  const persistedDeck = useMemo<DeckDraft>(() => ({
    title: shape.props.title,
    subtitle: shape.props.subtitle,
    theme: shape.props.theme || 'midnight',
    currentSlideIndex: shape.props.currentSlideIndex || 0,
    slides,
    canvaEmbedUrl: shape.props.canvaEmbedUrl,
  }), [shape.props.canvaEmbedUrl, shape.props.currentSlideIndex, shape.props.title, shape.props.subtitle, shape.props.theme, slides]);
  const validateRecovered = useCallback((candidate: unknown) => isValidDeckDraft(candidate), []);
  const draft = useShapeDraft<DeckDraft>(`slide-deck:${shape.id}:content`, persistedDeck, { editor, shapeId: shape.id, validateRecovered });
  const locked = editor.isShapeOrAncestorLocked(shape.id);
  const [isEditing, setIsEditing] = useState(false);
  const [activeSlideIdx, setActiveSlideIdx] = useState(() => clampIndex(shape.props.currentSlideIndex || 0, slides.length));
  const [isPresenter, setIsPresenter] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => subscribeToShapeEditing(shape.id, () => {
    if (editor.isShapeOrAncestorLocked(shape.id)) {
      setFeedback('Unlock this deck and its containing frame before editing.');
      return;
    }
    setFeedback('');
    setIsEditing(true);
  }), [editor, shape.id]);

  const safeIdx = clampIndex(activeSlideIdx, slides.length);
  const currentSlide = slides[safeIdx];
  const theme = getTheme(shape.props.theme || 'midnight');
  const editTheme = getTheme(draft.value.theme);
  const editSlides = draft.value.slides;
  const editSlideIndex = clampIndex(activeSlideIdx, editSlides.length);
  const selectedSlide = editSlides[editSlideIndex];

  useEffect(() => {
    setActiveSlideIdx(clampIndex(shape.props.currentSlideIndex || 0, slides.length));
  }, [shape.props.currentSlideIndex, shape.props.slides, slides.length]);

  useEffect(() => {
    if (draft.recovered) {
      setIsEditing(true);
      setActiveSlideIdx(clampIndex(draft.value.currentSlideIndex || 0, draft.value.slides.length));
    }
  }, [draft.recovered, draft.value.currentSlideIndex, draft.value.slides.length]);

  const updateDeckDraft = useCallback((patch: Partial<DeckDraft>) => {
    draft.setValue((current) => ({ ...current, ...patch }));
    setFeedback('');
  }, [draft.setValue]);

  const updateSlide = useCallback((index: number, patch: Partial<SlideItem>) => {
    draft.setValue((current) => ({ ...current, slides: current.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide) }));
    setFeedback('');
  }, [draft.setValue]);

  const commitDraft = useCallback((replaceConflict = false) => {
    if (editor.isShapeOrAncestorLocked(shape.id)) { setFeedback('Unlock this deck and its containing frame before saving.'); return; }
    const current = editor.getShape(shape.id as TLShapeId);
    if (!current) { setFeedback('This deck was deleted.'); return; }
    if (!isValidDeckDraft(draft.value)) { setFeedback('Check the slide fields, duplicate IDs, and content limits before saving.'); return; }
    if (draft.hasConflict && !replaceConflict) { setFeedback('The saved deck changed while you edited it. Choose how to resolve the conflict.'); return; }
    try {
      editor.updateShape({ id: shape.id, type: 'slide_deck', props: {
        title: draft.value.title,
        subtitle: draft.value.subtitle,
        theme: draft.value.theme,
        slides: draft.value.slides,
        canvaEmbedUrl: draft.value.canvaEmbedUrl,
        currentSlideIndex: clampIndex(activeSlideIdx, draft.value.slides.length),
      } });
      const saved = editor.getShape(shape.id as TLShapeId);
      const props = saved?.props as TLSlideDeckShape['props'] | undefined;
      const expected = {
        title: draft.value.title,
        subtitle: draft.value.subtitle,
        theme: draft.value.theme,
        slides: draft.value.slides,
        canvaEmbedUrl: draft.value.canvaEmbedUrl,
        currentSlideIndex: clampIndex(activeSlideIdx, draft.value.slides.length),
      };
      const actual = props && {
        title: props.title,
        subtitle: props.subtitle,
        theme: props.theme || 'midnight',
        slides: props.slides || [],
        canvaEmbedUrl: props.canvaEmbedUrl,
        currentSlideIndex: clampIndex(props.currentSlideIndex || 0, props.slides?.length || 0),
      };
      if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
        setFeedback('The canvas did not confirm this save. Your draft is still available.');
        return;
      }
      draft.save(draft.value);
      setFeedback('');
      setIsEditing(false);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not save the deck. Your draft is still available.');
    }
  }, [activeSlideIdx, draft, editor, shape.id]);

  const chooseSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    const next = clampIndex(index, slides.length);
    setActiveSlideIdx(next);
    setNotesOpen(false);
    if (!editor.isShapeOrAncestorLocked(shape.id)) {
      editor.run(() => {
        editor.updateShape({ id: shape.id, type: 'slide_deck', props: { currentSlideIndex: next } });
      }, { history: 'ignore' });
    }
  }, [editor, shape.id, slides.length]);

  const appendSlide = useCallback(() => {
    const newSlide: SlideItem = { id: makeContentId('slide'), title: `Slide ${editSlides.length + 1}`, layout: 'split', bullets: [] };
    draft.setValue((current) => ({ ...current, currentSlideIndex: current.slides.length, slides: [...current.slides, newSlide] }));
    setActiveSlideIdx(editSlides.length);
  }, [draft.setValue, editSlides.length]);

  const removeSlide = useCallback((index: number) => {
    const slide = editSlides[index];
    if (!slide || !window.confirm(`Delete “${slide.title || `Slide ${index + 1}`}”?`)) return;
    const activeId = editSlides[clampIndex(activeSlideIdx, editSlides.length)]?.id;
    const next = editSlides.filter((_, slideIndex) => slideIndex !== index);
    const preservedIndex = activeId ? next.findIndex((item) => item.id === activeId) : -1;
    const selectedIndex = preservedIndex >= 0 ? preservedIndex : clampIndex(index, next.length);
    draft.setValue((current) => ({ ...current, currentSlideIndex: selectedIndex, slides: next }));
    setActiveSlideIdx(selectedIndex);
  }, [activeSlideIdx, draft.setValue, editSlides]);

  const moveSlide = useCallback((index: number, destination: number) => {
    const activeId = editSlides[clampIndex(activeSlideIdx, editSlides.length)]?.id;
    const next = moveItem(editSlides, index, destination);
    const selectedIndex = activeId ? next.findIndex((slide) => slide.id === activeId) : -1;
    const activeIndex = selectedIndex >= 0 ? selectedIndex : destination;
    draft.setValue((current) => ({ ...current, currentSlideIndex: activeIndex, slides: next }));
    setActiveSlideIdx(activeIndex);
  }, [activeSlideIdx, draft.setValue, editSlides]);

  const selectEditSlide = useCallback((index: number) => {
    setActiveSlideIdx(index);
    draft.setValue((current) => ({ ...current, currentSlideIndex: clampIndex(index, current.slides.length) }));
  }, [draft.setValue]);

  const addStat = useCallback(() => updateSlide(editSlideIndex, { stats: [...(selectedSlide?.stats || []), { label: 'Metric', value: '0' }] }), [editSlideIndex, selectedSlide, updateSlide]);
  const addColumn = useCallback(() => updateSlide(editSlideIndex, { columns: [...(selectedSlide?.columns || []), { title: 'Column', text: '' }] }), [editSlideIndex, selectedSlide, updateSlide]);
  const addTimeline = useCallback(() => updateSlide(editSlideIndex, { timelineSteps: [...(selectedSlide?.timelineSteps || []), { step: String((selectedSlide?.timelineSteps?.length || 0) + 1), title: 'Milestone', desc: '' }] }), [editSlideIndex, selectedSlide, updateSlide]);

  const handleCopyMarkdown = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    const succeeded = await copyTextToClipboard(deckToMarkdown(persistedDeck));
    setCopied(succeeded);
    setFeedback(succeeded ? '' : 'Could not copy the deck. Check clipboard access and try again.');
    setTimeout(() => setCopied(false), 2000);
  }, [persistedDeck]);

  const exportMarkdown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    downloadText(`${safeContentFilename(title, 'presentation')}.md`, 'text/markdown;charset=utf-8', deckToMarkdown(persistedDeck));
  }, [persistedDeck, title]);

  const exportJson = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const sourceDeck: DeckDraft = {
      title: shape.props.title,
      subtitle: shape.props.subtitle,
      theme: shape.props.theme || 'midnight',
      slides: shape.props.slides || [],
      canvaEmbedUrl: shape.props.canvaEmbedUrl,
      currentSlideIndex: shape.props.currentSlideIndex || 0,
    };
    downloadText(`${safeContentFilename(title, 'presentation')}.json`, 'application/json;charset=utf-8', deckToJson(sourceDeck, shape.props.currentSlideIndex || 0));
  }, [shape.props.currentSlideIndex, shape.props.slides, shape.props.subtitle, shape.props.theme, shape.props.title, title]);

  const exportPptx = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    setFeedback('');
    try {
      const { createDeckPptxBytes, createPptxBlob } = await import('../lib/deckPptxExport');
      const bytes = await createDeckPptxBytes(persistedDeck);
      const url = URL.createObjectURL(createPptxBlob(bytes));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeContentFilename(title, 'presentation')}.pptx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setFeedback('PowerPoint downloaded. Dense text shrinks to fit; split long fields for easier reading.');
    } catch {
      setFeedback('PowerPoint export failed. Your deck is unchanged; try downloading Markdown or JSON instead.');
    }
  }, [persistedDeck, title]);

  const enterPresenter = useCallback(() => {
    setIsPresenter(true);
    try {
      const promise = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      void promise?.catch(() => { /* Focus presenter remains available if browser fullscreen is unavailable. */ });
    } catch { /* Keep the in-app focus view available. */ }
  }, []);

  const exitPresenter = useCallback(() => {
    setIsPresenter(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }, []);

  return (
    <>
      <HTMLContainer
        style={{ width: `${w}px`, height: `${h}px`, pointerEvents: 'all' }}
        className="studio-native-window studio-native-deck relative flex flex-col overflow-hidden rounded-2xl font-sans text-slate-100 antialiased"
        onWheel={smartStopPropagation}
      >
        <div data-window-header="deck" className="relative flex h-12 shrink-0 items-center justify-between liquid-glass-header px-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/20 text-indigo-300"><Presentation className="h-4 w-4" strokeWidth={1.5} /></div>
            <div className="min-w-0"><h2 data-window-title className="truncate text-xs font-semibold text-white">{title || 'Presentation Deck'}{draft.isDirty && !isEditing && <span className="ml-2 text-[9px] text-amber-200">Unsaved draft</span>}</h2><p className="truncate text-[10px] text-slate-400">{slides.length ? `${safeIdx + 1} / ${slides.length} slides` : 'No slides'}</p></div>
          </div>
          <ArtifactHeaderActions
            menuLabel="Deck export options"
            primaryAction={{ label: 'Open presenter view', icon: <Maximize2 />, disabled: isEditing || !slides.length, onSelect: enterPresenter }}
            actions={[
              { id: 'edit', label: isEditing ? 'Close deck editor' : locked ? 'Deck is locked' : 'Edit deck', icon: isEditing ? <Eye /> : <Pencil />, disabled: locked, onSelect: () => { setIsEditing((value) => !value); setFeedback(''); } },
              { id: 'copy', label: copied ? 'Deck Markdown copied' : 'Copy deck as Markdown', icon: copied ? <Check /> : <Copy />, disabled: isEditing, onSelect: handleCopyMarkdown },
              { id: 'export-markdown', label: 'Download Markdown (.md)', icon: <Download />, disabled: isEditing, separatorBefore: true, onSelect: exportMarkdown },
              { id: 'export-json', label: 'Download JSON (.json)', icon: <Download />, disabled: isEditing, onSelect: exportJson },
              { id: 'export-pptx', label: 'Download editable PowerPoint (.pptx)', icon: <Download />, disabled: isEditing, onSelect: (event) => { void exportPptx(event); } },
            ]}
          />
        </div>

        {isEditing ? (
          <ShapeFocusLayer title={title || 'Presentation Deck'} onClose={() => setIsEditing(false)}>
          <div className="flex h-full min-h-0 flex-col overflow-hidden" onPointerDown={stopEventPropagation}>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
              <aside className="flex max-h-32 w-full shrink-0 flex-row gap-2 overflow-x-auto overflow-y-hidden border-b border-white/10 bg-black/25 p-2 custom-card-scrollbar sm:max-h-none sm:w-48 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-b-0 sm:border-r">
                <button type="button" disabled={locked || editSlides.length >= 100} onClick={appendSlide} className="flex min-h-[44px] w-28 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-100 hover:bg-white/10 disabled:opacity-40 sm:w-full"><Plus className="h-4 w-4" />Add slide</button>
                <nav aria-label="Slides" className="flex shrink-0 items-stretch gap-1 sm:w-full sm:flex-col sm:gap-0 sm:space-y-1">
                  {editSlides.map((slide, index) => <div key={slide.id} className={`w-44 shrink-0 rounded-lg border sm:w-full ${editSlideIndex === index ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-transparent hover:bg-white/5'}`}>
                    <button type="button" onClick={() => selectEditSlide(index)} aria-current={editSlideIndex === index ? 'page' : undefined} className="flex min-h-[44px] w-full items-center gap-2 px-2 text-left text-xs text-slate-100"><span className="w-4 shrink-0 text-[10px] tabular-nums text-slate-500">{index + 1}</span><span className="truncate">{slide.title || 'Untitled slide'}</span></button>
                    <div className="flex justify-end gap-1 px-1 pb-1">
                      <button type="button" disabled={locked || index === 0} onClick={() => moveSlide(index, index - 1)} aria-label={`Move slide ${index + 1} up`} className="min-h-[44px] min-w-[44px] rounded-md text-slate-400 hover:bg-white/10 disabled:opacity-30"><ArrowUp className="mx-auto h-4 w-4" /></button>
                      <button type="button" disabled={locked || index === editSlides.length - 1} onClick={() => moveSlide(index, index + 1)} aria-label={`Move slide ${index + 1} down`} className="min-h-[44px] min-w-[44px] rounded-md text-slate-400 hover:bg-white/10 disabled:opacity-30"><ArrowDown className="mx-auto h-4 w-4" /></button>
                      <button type="button" disabled={locked} onClick={() => removeSlide(index)} aria-label={`Delete slide ${index + 1}`} className="min-h-[44px] min-w-[44px] rounded-md text-rose-300 hover:bg-rose-500/10 disabled:opacity-30"><Trash2 className="mx-auto h-4 w-4" /></button>
                    </div>
                  </div>)}
                </nav>
              </aside>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-card-scrollbar">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-[11px] text-slate-300">Deck title<input aria-label="Deck title" maxLength={4000} value={draft.value.title} onChange={(event) => updateDeckDraft({ title: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  <label className="text-[11px] text-slate-300">Deck subtitle<input aria-label="Deck subtitle" maxLength={4000} value={draft.value.subtitle || ''} onChange={(event) => updateDeckDraft({ subtitle: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  <label className="text-[11px] text-slate-300">Theme<select aria-label="Deck theme" value={THEMES.some((item) => item.value === draft.value.theme) ? draft.value.theme : 'midnight'} onChange={(event) => updateDeckDraft({ theme: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50">{THEMES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                </div>
                {selectedSlide ? <div className="mt-4 space-y-3 rounded-xl border border-white/10 p-3" style={{ background: editTheme.surface, borderColor: editTheme.border }}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-slate-300">Slide title<input aria-label="Slide title" maxLength={4000} value={selectedSlide.title} onChange={(event) => updateSlide(editSlideIndex, { title: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                    <label className="text-[11px] text-slate-300">Slide subtitle<input aria-label="Slide subtitle" maxLength={4000} value={selectedSlide.subtitle || ''} onChange={(event) => updateSlide(editSlideIndex, { subtitle: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                    <label className="text-[11px] text-slate-300">Layout<select aria-label="Slide layout" value={LAYOUTS.some((item) => item.value === selectedSlide.layout) ? selectedSlide.layout : 'split'} onChange={(event) => updateSlide(editSlideIndex, { layout: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50">{LAYOUTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    <label className="text-[11px] text-slate-300">Bullets (one per line)<textarea aria-label="Slide bullets" maxLength={100_000} value={(selectedSlide.bullets || []).join('\n')} onChange={(event) => updateSlide(editSlideIndex, { bullets: event.target.value ? event.target.value.split('\n') : [] })} disabled={locked} className="mt-1 min-h-[72px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  </div>
                  <label className="block text-[11px] text-slate-300">Slide content<textarea aria-label="Slide content" maxLength={30_000} value={selectedSlide.content || ''} onChange={(event) => updateSlide(editSlideIndex, { content: event.target.value })} disabled={locked} className="mt-1 min-h-[88px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  <label className="block text-[11px] text-slate-300">Speaker notes<textarea aria-label="Speaker notes" maxLength={10_000} value={selectedSlide.speakerNotes || ''} onChange={(event) => updateSlide(editSlideIndex, { speakerNotes: event.target.value })} disabled={locked} className="mt-1 min-h-[72px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>

                  <details className="rounded-lg border border-white/10 px-3">
                    <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-xs font-medium text-slate-100">Stats <button type="button" disabled={locked || (selectedSlide.stats?.length || 0) >= 50} onClick={(event) => { event.preventDefault(); addStat(); }} className="min-h-[40px] rounded-md px-2 text-indigo-200 hover:bg-white/10 disabled:opacity-40">+ Add stat</button></summary>
                    <div className="space-y-2 pb-3">{(selectedSlide.stats || []).map((stat, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_44px]"><input aria-label={`Stat ${index + 1} label`} value={stat.label} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { stats: selectedSlide.stats?.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} disabled={locked} placeholder="Label" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Stat ${index + 1} value`} value={stat.value} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { stats: selectedSlide.stats?.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} disabled={locked} placeholder="Value" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Stat ${index + 1} change`} value={stat.change || ''} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { stats: selectedSlide.stats?.map((item, itemIndex) => itemIndex === index ? { ...item, change: event.target.value || undefined } : item) })} disabled={locked} placeholder="Change" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><button type="button" onClick={() => updateSlide(editSlideIndex, { stats: selectedSlide.stats?.filter((_, itemIndex) => itemIndex !== index) })} disabled={locked} className="min-h-[44px] min-w-[44px] rounded-lg text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" aria-label={`Remove stat ${index + 1}`}><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>
                  </details>

                  <details className="rounded-lg border border-white/10 px-3">
                    <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-xs font-medium text-slate-100">Columns <button type="button" disabled={locked || (selectedSlide.columns?.length || 0) >= 20} onClick={(event) => { event.preventDefault(); addColumn(); }} className="min-h-[40px] rounded-md px-2 text-indigo-200 hover:bg-white/10 disabled:opacity-40">+ Add column</button></summary>
                    <div className="space-y-2 pb-3">{(selectedSlide.columns || []).map((column, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 p-2 sm:grid-cols-[1fr_1fr_1fr_44px]"><input aria-label={`Column ${index + 1} title`} value={column.title} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { columns: selectedSlide.columns?.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })} disabled={locked} placeholder="Title" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Column ${index + 1} text`} value={column.text} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { columns: selectedSlide.columns?.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) })} disabled={locked} placeholder="Text" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Column ${index + 1} icon label`} value={column.icon || ''} maxLength={128} onChange={(event) => updateSlide(editSlideIndex, { columns: selectedSlide.columns?.map((item, itemIndex) => itemIndex === index ? { ...item, icon: event.target.value || undefined } : item) })} disabled={locked} placeholder="Icon label" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><button type="button" onClick={() => updateSlide(editSlideIndex, { columns: selectedSlide.columns?.filter((_, itemIndex) => itemIndex !== index) })} disabled={locked} className="min-h-[44px] min-w-[44px] rounded-lg text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" aria-label={`Remove column ${index + 1}`}><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>
                  </details>

                  <details className="rounded-lg border border-white/10 px-3">
                    <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-xs font-medium text-slate-100">Timeline <button type="button" disabled={locked || (selectedSlide.timelineSteps?.length || 0) >= 50} onClick={(event) => { event.preventDefault(); addTimeline(); }} className="min-h-[40px] rounded-md px-2 text-indigo-200 hover:bg-white/10 disabled:opacity-40">+ Add milestone</button></summary>
                    <div className="space-y-2 pb-3">{(selectedSlide.timelineSteps || []).map((step, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-white/10 p-2 sm:grid-cols-[80px_1fr_1fr_44px]"><input aria-label={`Timeline ${index + 1} step`} value={step.step} maxLength={256} onChange={(event) => updateSlide(editSlideIndex, { timelineSteps: selectedSlide.timelineSteps?.map((item, itemIndex) => itemIndex === index ? { ...item, step: event.target.value } : item) })} disabled={locked} placeholder="Step" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Timeline ${index + 1} title`} value={step.title} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { timelineSteps: selectedSlide.timelineSteps?.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })} disabled={locked} placeholder="Title" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><input aria-label={`Timeline ${index + 1} description`} value={step.desc} maxLength={4000} onChange={(event) => updateSlide(editSlideIndex, { timelineSteps: selectedSlide.timelineSteps?.map((item, itemIndex) => itemIndex === index ? { ...item, desc: event.target.value } : item) })} disabled={locked} placeholder="Description" className="min-h-[44px] rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-white" /><button type="button" onClick={() => updateSlide(editSlideIndex, { timelineSteps: selectedSlide.timelineSteps?.filter((_, itemIndex) => itemIndex !== index) })} disabled={locked} className="min-h-[44px] min-w-[44px] rounded-lg text-rose-300 hover:bg-rose-500/10 disabled:opacity-40" aria-label={`Remove timeline item ${index + 1}`}><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>
                  </details>
                </div> : <p className="mt-4 rounded-lg border border-dashed border-white/15 p-4 text-sm text-slate-400">Add a slide to begin editing.</p>}
                {(draft.recovered || !draft.recoveryAvailable) && <p role="status" className="mt-3 text-xs text-amber-200">{draft.recovered ? 'Recovered an unsaved deck draft.' : 'Draft recovery storage is unavailable. Keep this editor open until you save.'}</p>}
                {draft.hasConflict && <p role="alert" className="mt-3 text-xs text-amber-200">The saved deck changed while this draft was open. Review it before choosing which version to keep.</p>}
                {locked && <p role="status" className="mt-3 text-xs text-amber-200">This deck or its containing frame is locked. Unlock it to make changes.</p>}
                {feedback && <p role="alert" className="mt-3 text-xs text-rose-200">{feedback}</p>}
              </div>
            </div>
            <div className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/20 px-3 py-1.5">
              <span className="text-[11px] text-slate-400">{draft.isDirty ? 'Unsaved changes' : 'Changes applied to canvas'}</span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {draft.isDirty && <button type="button" onClick={() => { if (window.confirm('Discard this deck draft?')) { draft.discard(); setFeedback(''); } }} className="min-h-[44px] rounded-lg px-3 text-xs text-slate-300 hover:bg-white/10">Discard draft</button>}
                {draft.hasConflict && <button type="button" onClick={() => { draft.discard(); setFeedback(''); }} className="min-h-[44px] rounded-lg px-3 text-xs text-slate-100 hover:bg-white/10">Use latest</button>}
                <button type="button" disabled={locked || !draft.isDirty} onClick={() => commitDraft(draft.hasConflict)} className="min-h-[44px] rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">{draft.hasConflict ? 'Replace with draft' : 'Save changes'}</button>
              </div>
            </div>
          </div>
          </ShapeFocusLayer>
        ) : (
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5" style={{ background: theme.background }}>
            {currentSlide ? <DeckSlideView slide={currentSlide} index={safeIdx} theme={theme} /> : <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center text-center"><p className="text-lg font-semibold text-white">This deck has no slides yet.</p><p className="mt-2 text-sm text-slate-400">Add a slide to start building the presentation.</p><button type="button" onClick={() => { appendSlide(); setIsEditing(true); }} disabled={locked} className="mt-4 flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />Add slide</button></div>}
            {currentSlide?.speakerNotes && <section className="mt-4 border-t pt-3" style={{ borderColor: theme.border }}>
              <button type="button" onClick={() => setNotesOpen((open) => !open)} aria-expanded={notesOpen} className="flex min-h-[44px] items-center gap-2 text-xs font-medium" style={{ color: theme.accent }}><StickyNote className="h-4 w-4" />{notesOpen ? 'Hide speaker notes' : 'Show speaker notes'}</button>
              {notesOpen && <p className="whitespace-pre-wrap pb-2 text-xs leading-5" style={{ color: theme.muted }}>{currentSlide.speakerNotes}</p>}
            </section>}
          </main>
        )}

        {!isEditing && <footer data-window-toolbar="deck" className="flex min-h-[56px] shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] px-3" onPointerDown={stopEventPropagation}>
          {slides.length > 0 ? <button type="button" onClick={() => chooseSlide(safeIdx - 1)} disabled={safeIdx === 0} aria-label="Previous slide" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/15 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button> : <span className="text-xs text-slate-400">No slides</span>}
          {slides.length > 0 ? <div className="flex min-w-0 items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">Slide <input aria-label="Go to slide number" type="number" inputMode="numeric" min={1} max={slides.length} value={safeIdx + 1} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= slides.length) chooseSlide(value - 1); }} className="h-11 w-16 rounded-lg border border-white/10 bg-black/30 px-2 text-center text-sm text-white" /></label>
            <span className="hidden max-w-[180px] truncate text-[11px] text-slate-400 sm:inline">{currentSlide.title}</span>
          </div> : <span />}
          {slides.length > 0 ? <button type="button" onClick={() => chooseSlide(safeIdx + 1)} disabled={safeIdx === slides.length - 1} aria-label="Next slide" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/5 text-white/80 hover:bg-white/15 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button> : <span />}
        </footer>}
        {feedback && !isEditing && <p role="alert" className="absolute bottom-14 left-3 right-3 z-20 rounded-lg border border-rose-300/20 bg-slate-950/95 px-3 py-2 text-xs text-rose-100">{feedback}</p>}
      </HTMLContainer>
      {isPresenter && currentSlide && typeof document !== 'undefined' && <PresenterView deckTitle={title} slide={currentSlide} index={safeIdx} total={slides.length} theme={theme} onChoose={chooseSlide} onClose={exitPresenter} />}
    </>
  );
}
