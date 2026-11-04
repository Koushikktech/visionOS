import type { Editor, TLShape } from '@tldraw/tldraw';
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from './browserStorage';

export type WorkspaceLaunchIntent = {
  id: string;
  kind: 'open' | 'new-page' | 'example' | 'draft' | 'restore';
  pageId?: string;
  example?: 'field-notes' | 'brief-slides' | 'connections';
  draft?: string;
};

export type WorkspacePreviewShape = {
  kind: 'app' | 'document' | 'slides' | 'note' | 'code' | 'media' | 'sketch' | 'connector' | 'shape';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  title?: string;
};

export type WorkspaceOverview = {
  pageId: string;
  bounds: { x: number; y: number; w: number; h: number };
  shapes: WorkspacePreviewShape[];
};

export type WorkspaceSummary = {
  version: 2;
  capturedAt: string;
  captureSource: 'editor-hydration';
  activePageId: string;
  pages: Array<{ id: string; name: string; hasShapes: boolean }>;
  overview: WorkspaceOverview | null;
};

export type WorkspaceSummaryState =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'empty'; summary: WorkspaceSummary }
  | { status: 'ready'; summary: WorkspaceSummary };

export const WORKSPACE_STUDIO_SUMMARY_KEY = 'visionos_studio_summary_v1';
export const WORKSPACE_STUDIO_SUMMARY_VERSION = 2 as const;
export const MAX_STUDIO_PREVIEW_SHAPES = 80;

const MAX_PAGES = 120;
const MAX_CACHE_BYTES = 80_000;
const SAFE_PAGE_ID = /^page:[\w-]{1,160}$/;
const SAFE_COLORS = new Set([
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange',
  'green', 'light-green', 'light-red', 'red', 'white',
]);

type ShapeRecord = TLShape & {
  props: TLShape['props'] & Record<string, unknown>;
};

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return undefined;
  if (/(api[ _-]?key|access[ _-]?token|secret|password|private[ _-]?key)/i.test(label)) return undefined;
  if (/(?:sk-[A-Za-z0-9_-]{12,}|AIza[\w-]{20,}|Bearer\s+\S+)/i.test(label)) return undefined;
  return label.length > 72 ? `${label.slice(0, 69)}…` : label;
}

function safeColor(value: unknown): string {
  return typeof value === 'string' && (SAFE_COLORS.has(value) || /^#[a-fA-F0-9]{6}$/.test(value)) ? value : 'grey';
}

function previewKind(shape: ShapeRecord): WorkspacePreviewShape['kind'] {
  switch (shape.type) {
    case 'artifact': return 'app';
    case 'document': return 'document';
    case 'slide_deck': return 'slides';
    case 'note':
    case 'rich_card': return 'note';
    case 'code_card': return 'code';
    case 'image':
    case 'video':
    case 'media_embed': return 'media';
    case 'draw': return 'sketch';
    case 'arrow': return 'connector';
    default: return 'shape';
  }
}

function safeShapeTitle(shape: ShapeRecord): string | undefined {
  if (!['artifact', 'document', 'slide_deck', 'rich_card', 'code_card', 'vector_shape'].includes(shape.type)) {
    return undefined;
  }
  return cleanLabel(shape.props.title);
}

function isFiniteBounds(bounds: unknown): bounds is { x: number; y: number; w: number; h: number } {
  if (!bounds || typeof bounds !== 'object') return false;
  const value = bounds as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) &&
    Math.abs(value.x as number) <= 1_000_000 &&
    Math.abs(value.y as number) <= 1_000_000 &&
    (value.w as number) > 0 && (value.h as number) > 0 &&
    (value.w as number) <= 1_000_000 && (value.h as number) <= 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'capturedAt', 'captureSource', 'activePageId', 'pages', 'overview']) ||
      value.version !== WORKSPACE_STUDIO_SUMMARY_VERSION ||
      typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) ||
      value.captureSource !== 'editor-hydration') return false;
  if (typeof value.activePageId !== 'string' || !SAFE_PAGE_ID.test(value.activePageId)) return false;
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > MAX_PAGES) return false;
  const pageIds = new Set<string>();
  for (const page of value.pages) {
    if (!isRecord(page) || !hasOnlyKeys(page, ['id', 'name', 'hasShapes']) ||
        typeof page.id !== 'string' || !SAFE_PAGE_ID.test(page.id) ||
        typeof page.name !== 'string' || page.name.length > 80 || cleanLabel(page.name) !== page.name || typeof page.hasShapes !== 'boolean') return false;
    if (pageIds.has(page.id)) return false;
    pageIds.add(page.id);
  }
  if (!pageIds.has(value.activePageId)) return false;
  if (value.overview === null) return true;
  const overview = value.overview;
  if (!isRecord(overview) || !hasOnlyKeys(overview, ['pageId', 'bounds', 'shapes']) ||
      overview.pageId !== value.activePageId || !isFiniteBounds(overview.bounds) ||
      !Array.isArray(overview.shapes) || overview.shapes.length > MAX_STUDIO_PREVIEW_SHAPES) return false;
  if (!hasOnlyKeys(overview.bounds, ['x', 'y', 'w', 'h'])) return false;
  return overview.shapes.every((shape) => {
    if (!isRecord(shape) || !hasOnlyKeys(shape, ['kind', 'x', 'y', 'w', 'h', 'color', 'title']) ||
        !['app', 'document', 'slides', 'note', 'code', 'media', 'sketch', 'connector', 'shape'].includes(String(shape.kind))) return false;
    if (!['x', 'y', 'w', 'h'].every((key) => typeof shape[key] === 'number' && Number.isFinite(shape[key]))) return false;
    if (Math.abs(shape.x as number) > 1_000_000 || Math.abs(shape.y as number) > 1_000_000 ||
        (shape.w as number) > 1_000_000 || (shape.h as number) > 1_000_000) return false;
    if (typeof shape.w !== 'number' || typeof shape.h !== 'number' || shape.w <= 0 || shape.h <= 0) return false;
    if (typeof shape.color !== 'string' || (!SAFE_COLORS.has(shape.color) && !/^#[a-fA-F0-9]{6}$/.test(shape.color))) return false;
    if (shape.title !== undefined && (typeof shape.title !== 'string' || shape.title.length > 72 || cleanLabel(shape.title) !== shape.title)) return false;
    return true;
  });
}

function stateFromSummary(summary: WorkspaceSummary): WorkspaceSummaryState {
  const hasShapes = summary.pages.some((page) => page.hasShapes);
  return hasShapes ? { status: 'ready', summary } : { status: 'empty', summary };
}

/** Reads only the app-owned, bounded Studio cache. Missing, blocked, or invalid data is unknown. */
export function readWorkspaceSummary(): WorkspaceSummaryState {
  try {
    const stored = readLocalStorage(WORKSPACE_STUDIO_SUMMARY_KEY);
    if (!stored.available || !stored.value) return { status: 'unavailable' };
    if (stored.value.length > MAX_CACHE_BYTES) return { status: 'unavailable' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.value);
    } catch {
      return { status: 'unavailable' };
    }
    if (!isWorkspaceSummary(parsed)) return { status: 'unavailable' };
    return stateFromSummary(parsed);
  } catch {
    return { status: 'error' };
  }
}

/** Captures page names and a bounded, inert vector overview from an already hydrated editor. */
export function captureWorkspaceSummary(editor: Editor): WorkspaceSummary {
  const pages = editor.getPages().slice(0, MAX_PAGES).map((page) => {
    const pageShapeIds = editor.getPageShapeIds(page.id);
    return {
      id: page.id as string,
      name: cleanLabel(page.name) ?? 'Untitled page',
      hasShapes: pageShapeIds.size > 0,
    };
  });
  const activePageId = editor.getCurrentPageId() as string;
  const activePage = pages.find((page) => page.id === activePageId);
  if (!activePage) throw new Error('The active page was not available after editor hydration.');

  const candidates = editor.getCurrentPageShapes().slice(0, MAX_STUDIO_PREVIEW_SHAPES) as ShapeRecord[];
  const shapes = candidates.flatMap((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    if (!isFiniteBounds(bounds)) return [];
    return [{
      kind: previewKind(shape),
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      color: safeColor(shape.props.color),
      ...(safeShapeTitle(shape) ? { title: safeShapeTitle(shape) } : {}),
    } satisfies WorkspacePreviewShape];
  });

  const minX = Math.min(...shapes.map((shape) => shape.x));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  const maxX = Math.max(...shapes.map((shape) => shape.x + shape.w));
  const maxY = Math.max(...shapes.map((shape) => shape.y + shape.h));

  return {
    version: WORKSPACE_STUDIO_SUMMARY_VERSION,
    capturedAt: new Date().toISOString(),
    captureSource: 'editor-hydration',
    activePageId,
    pages,
    overview: shapes.length ? {
      pageId: activePageId,
      bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      shapes,
    } : null,
  };
}

/** Stores only the validated Studio schema; never touches the canvas persistence key. */
export function writeWorkspaceSummary(summary: WorkspaceSummary): boolean {
  if (!isWorkspaceSummary(summary)) return false;
  try {
    const serialized = JSON.stringify(summary);
    if (serialized.length > MAX_CACHE_BYTES) return false;
    const written = writeLocalStorage(WORKSPACE_STUDIO_SUMMARY_KEY, serialized);
    if (written && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('visionos:studio-summary'));
    }
    return written;
  } catch {
    return false;
  }
}

/** Invalidates the optional overview without changing any board or recovery data. */
export function clearWorkspaceSummary(): boolean {
  return removeLocalStorage(WORKSPACE_STUDIO_SUMMARY_KEY);
}
