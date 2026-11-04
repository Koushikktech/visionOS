import type { TLEditorSnapshot } from '@tldraw/tldraw';

export interface CanvasRecoverySummary {
  shapeCount: number;
  pageCount: number;
  typeCounts: Array<{ label: string; count: number }>;
  titleSamples: string[];
}

const SHAPE_LABELS: Record<string, string> = {
  artifact: 'App',
  arrow: 'Connector',
  code_card: 'Code card',
  document: 'Document',
  draw: 'Drawing',
  frame: 'Frame',
  geo: 'Shape',
  image: 'Image',
  media_embed: 'Media',
  note: 'Sticky note',
  rich_card: 'Card',
  slide_deck: 'Slide deck',
  text: 'Text',
  video: 'Video',
  vector_shape: 'Vector shape',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readableShapeLabel(type: unknown): string {
  if (typeof type !== 'string' || !type.trim()) return 'Other';
  if (SHAPE_LABELS[type]) return SHAPE_LABELS[type];
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? (clean.length > 88 ? `${clean.slice(0, 85).trimEnd()}…` : clean) : null;
}

/** Summarizes only fields useful for identifying a recovery copy in the review dialog. */
export function summarizeCanvasRecovery(snapshot: TLEditorSnapshot): CanvasRecoverySummary {
  const store = asRecord(asRecord(snapshot)?.document)?.store;
  const records = asRecord(store);
  const typeCounts = new Map<string, number>();
  const titleSamples: string[] = [];
  let shapeCount = 0;
  let pageCount = 0;

  for (const value of Object.values(records ?? {})) {
    const record = asRecord(value);
    if (!record) continue;

    if (record.typeName === 'page') {
      pageCount += 1;
      const pageName = cleanTitle(record.name);
      if (pageName && !titleSamples.includes(pageName) && titleSamples.length < 3) {
        titleSamples.push(pageName);
      }
      continue;
    }

    if (record.typeName !== 'shape') continue;
    shapeCount += 1;
    const label = readableShapeLabel(record.type);
    typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);

    const props = asRecord(record.props);
    const title = cleanTitle(props?.title) ?? cleanTitle(props?.name);
    if (title && !titleSamples.includes(title) && titleSamples.length < 3) {
      titleSamples.push(title);
    }
  }

  return {
    shapeCount,
    pageCount,
    typeCounts: Array.from(typeCounts, ([label, count]) => ({ label, count })).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    ),
    titleSamples,
  };
}

export function formatRecoverySavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (!Number.isFinite(date.getTime())) return savedAt;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
