import type { DocSection } from '@/types/spatial';

export const MAX_DOCUMENT_SECTIONS = 100;
export const MAX_DOCUMENT_CONTENT_CHARS = 180_000;
export const MAX_DECK_SLIDES = 100;
export const MAX_DECK_CONTENT_CHARS = 180_000;

export interface DocumentDraft {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  sections: DocSection[];
}

export interface DeckSlideContent {
  [key: string]: unknown;
  id: string;
  title: string;
  subtitle?: string;
  layout?: string;
  bullets?: string[];
  content?: string;
  speakerNotes?: string;
  stats?: Array<{ label: string; value: string; change?: string }>;
  columns?: Array<{ title: string; text: string; icon?: string }>;
  timelineSteps?: Array<{ step: string; title: string; desc: string }>;
}

export interface DeckDraft {
  title: string;
  subtitle?: string;
  theme: string;
  slides: DeckSlideContent[];
  canvaEmbedUrl?: string;
  currentSlideIndex?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function isBoundedString(value: unknown, max: number, nonEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (!nonEmpty || value.trim().length > 0);
}

function uniqueIds(items: Array<{ id: string }>) {
  const ids = items.map((item) => item.id);
  return ids.every((id) => id.trim().length > 0) && new Set(ids).size === ids.length;
}

export function isValidDocumentDraft(value: unknown): value is DocumentDraft {
  if (!isRecord(value) || !isBoundedString(value.title, 4_000)) return false;
  // Keep unknown legacy section metadata in the draft. UI edits spread existing
  // records, so saving known fields must not silently erase forward fields.
  if (value.subtitle !== undefined && !isBoundedString(value.subtitle, 4_000)) return false;
  if (value.author !== undefined && !isBoundedString(value.author, 1_000)) return false;
  if (value.date !== undefined && !isBoundedString(value.date, 256)) return false;
  if (!Array.isArray(value.sections) || value.sections.length > MAX_DOCUMENT_SECTIONS) return false;
  const sections: DocSection[] = [];
  let total = 0;
  for (const candidate of value.sections) {
    if (!isRecord(candidate)) return false;
    const { id, title, content, badge } = candidate;
    if (!isBoundedString(id, 1_024, true) || !isBoundedString(title, 2_000) || !isBoundedString(content, 180_000)) return false;
    if (badge !== undefined && !isBoundedString(badge, 256)) return false;
    total += id.length + title.length + content.length + (typeof badge === 'string' ? badge.length : 0);
    sections.push({ id, title, content, ...(typeof badge === 'string' ? { badge } : {}) });
  }
  try {
    return total <= MAX_DOCUMENT_CONTENT_CHARS && JSON.stringify(value).length <= MAX_DOCUMENT_CONTENT_CHARS + 8_000 && uniqueIds(sections);
  } catch {
    return false;
  }
}

function isStringList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item, maxLength));
}

export function isValidDeckDraft(value: unknown): value is DeckDraft {
  if (!isRecord(value) || !isBoundedString(value.title, 4_000) || !isBoundedString(value.theme, 64, true)) return false;
  if (value.subtitle !== undefined && !isBoundedString(value.subtitle, 4_000)) return false;
  if (value.canvaEmbedUrl !== undefined && !isBoundedString(value.canvaEmbedUrl, 1_000_000)) return false;
  const currentSlideIndex = value.currentSlideIndex;
  if (currentSlideIndex !== undefined && (typeof currentSlideIndex !== 'number' || !Number.isInteger(currentSlideIndex) || currentSlideIndex < 0 || currentSlideIndex >= 500)) return false;
  if (!Array.isArray(value.slides) || value.slides.length > MAX_DECK_SLIDES) return false;
  let total = 0;
  const ids: Array<{ id: string }> = [];
  for (const candidate of value.slides) {
    if (!isRecord(candidate)) return false;
    const slide = candidate;
    if (!isBoundedString(slide.id, 1_024, true) || !isBoundedString(slide.title, 4_000)) return false;
    if (slide.subtitle !== undefined && !isBoundedString(slide.subtitle, 4_000)) return false;
    if (slide.layout !== undefined && !isBoundedString(slide.layout, 128)) return false;
    if (slide.content !== undefined && !isBoundedString(slide.content, 30_000)) return false;
    if (slide.speakerNotes !== undefined && !isBoundedString(slide.speakerNotes, 10_000)) return false;
    if (slide.bullets !== undefined && !isStringList(slide.bullets, 100, 4_000)) return false;
    for (const [field, max, required] of [['stats', 50, ['label', 'value']], ['columns', 20, ['title', 'text']], ['timelineSteps', 50, ['step', 'title', 'desc']]] as const) {
      const items: unknown = slide[field];
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > max) return false;
      for (const item of items) {
        if (!isRecord(item) || !required.every((key) => isBoundedString(item[key], field === 'timelineSteps' && key === 'step' ? 256 : 4_000))) return false;
        if (field === 'stats' && item.change !== undefined && !isBoundedString(item.change, 4_000)) return false;
        if (field === 'columns' && item.icon !== undefined && !isBoundedString(item.icon, 128)) return false;
      }
    }
    try {
      total += JSON.stringify(slide).length;
    } catch {
      return false;
    }
    ids.push({ id: slide.id });
  }
  try {
    return total <= MAX_DECK_CONTENT_CHARS && JSON.stringify(value).length <= MAX_DECK_CONTENT_CHARS + 8_000 && uniqueIds(ids);
  } catch {
    return false;
  }
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const result = [...items];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function makeContentId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function safeContentFilename(title: string, fallback: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return slug || fallback;
}

export function documentToMarkdown(document: DocumentDraft): string {
  const metadata = [
    document.subtitle ? `Subtitle: ${document.subtitle}` : '',
    document.author ? `Author: ${document.author}` : '',
    document.date ? `Date: ${document.date}` : '',
  ].filter(Boolean);
  const sections = document.sections.map((section) => [
    `## ${section.title}`,
    `<!-- section-id: ${section.id.replace(/--/g, '—')} -->`,
    section.badge ? `> Badge: ${section.badge}` : '',
    section.content,
  ].filter(Boolean).join('\n\n'));
  return [`# ${document.title}`, metadata.join('\n'), ...sections].filter(Boolean).join('\n\n---\n\n');
}

export function deckToMarkdown(deck: DeckDraft): string {
  const slides = deck.slides.map((slide, index) => {
    const blocks = [`# Slide ${index + 1}: ${slide.title}`, `<!-- slide-id: ${slide.id.replace(/--/g, '—')} -->`];
    if (slide.subtitle) blocks.push(`Subtitle: ${slide.subtitle}`);
    blocks.push(`Layout: ${slide.layout || 'split'}`);
    if (slide.content) blocks.push(`Content:\n${slide.content}`);
    if (slide.bullets?.length) blocks.push(`Bullets:\n${slide.bullets.map((item) => `- ${item}`).join('\n')}`);
    if (slide.stats?.length) blocks.push(`Stats:\n${slide.stats.map((item) => `- ${item.label}: ${item.value}${item.change ? ` (${item.change})` : ''}`).join('\n')}`);
    if (slide.columns?.length) blocks.push(`Columns:\n${slide.columns.map((item) => `- ${item.title}${item.icon ? ` [${item.icon}]` : ''}: ${item.text}`).join('\n')}`);
    if (slide.timelineSteps?.length) blocks.push(`Timeline:\n${slide.timelineSteps.map((item) => `- ${item.step} — ${item.title}: ${item.desc}`).join('\n')}`);
    if (slide.speakerNotes) blocks.push(`Speaker notes:\n${slide.speakerNotes}`);
    return blocks.join('\n\n');
  });
  return [`# ${deck.title}`, `Subtitle: ${deck.subtitle || ''}`, `Theme: ${deck.theme}`, ...(deck.currentSlideIndex !== undefined ? [`Current slide: ${deck.currentSlideIndex + 1}`] : []), ...(deck.canvaEmbedUrl ? [`Embed: ${deck.canvaEmbedUrl}`] : []), ...slides].join('\n\n---\n\n');
}

export function deckToJson(deck: DeckDraft, currentSlideIndex: number): string {
  return JSON.stringify({
    version: 1,
    title: deck.title,
    subtitle: deck.subtitle,
    theme: deck.theme,
    canvaEmbedUrl: deck.canvaEmbedUrl,
    currentSlideIndex,
    slides: deck.slides,
  }, null, 2);
}
