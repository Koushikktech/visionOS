import type { Editor, TLBinding, TLShape, TLShapeId } from '@tldraw/tldraw';
import type { SpatialNodeItem, SpatialNodePatch } from '@/types/spatial';
import { extractShapeSemanticText } from './spatialVision';

export function contentRevision(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export interface SpatialPageSnapshot {
  pageId: string;
  /** tldraw store records are replaced on updates, so identity detects record changes. */
  shapes: Map<string, TLShape>;
  /** Arrow bindings are separate store records and must be guarded separately. */
  bindings: Map<string, TLBinding[]>;
}

export interface SpatialSerializationCacheEntry {
  type: string;
  props: unknown;
  node: SpatialNodeItem;
}

/** Caches source fields only; page geometry and all safety fields are refreshed each pass. */
export interface SpatialSerializationCache {
  pageId: string | null;
  entries: Map<string, SpatialSerializationCacheEntry>;
}

export function createSpatialSerializationCache(): SpatialSerializationCache {
  return { pageId: null, entries: new Map() };
}

export function isCanvasShapeLocked(editor: Editor, shape?: TLShape) {
  let current = shape;
  while (current) {
    if (current.isLocked) return true;
    if (!String(current.parentId).startsWith('shape:')) break;
    current = editor.getShape(current.parentId as TLShapeId);
  }
  return false;
}

/** Reject group membership changes when a selected shape or any ancestor is locked. */
export function assertShapesUnlockedForReparent(editor: Editor, ids: string[]) {
  for (const id of ids) {
    const shapeId = (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId;
    const shape = editor.getShape(shapeId);
    if (!shape)
      throw new Error(`Canvas object ${id} no longer exists. Please retry.`);
    if (isCanvasShapeLocked(editor, shape))
      throw new Error('Unlock every selected object and its frame before changing group membership.');
  }
}

export function captureSpatialPageSnapshot(editor: Editor): SpatialPageSnapshot {
  const shapes = editor.getCurrentPageShapes();
  const bindings = new Map<string, TLBinding[]>();
  for (const shape of shapes) {
    if (shape.type !== 'arrow') continue;
    const arrowBindings = editor.getBindingsFromShape(shape, 'arrow');
    bindings.set(shape.id as string, [...arrowBindings]);
  }
  return {
    pageId: editor.getCurrentPageId(),
    shapes: new Map(shapes.map((shape) => [shape.id as string, shape])),
    bindings,
  };
}

export function matchesSpatialPageSnapshot(
  editor: Editor,
  snapshot: SpatialPageSnapshot
) {
  if (editor.getCurrentPageId() !== snapshot.pageId) return false;
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length !== snapshot.shapes.size) return false;
  if (!shapes.every((shape) => snapshot.shapes.get(shape.id as string) === shape))
    return false;

  const currentBindings = new Map<string, TLBinding[]>();
  for (const shape of shapes) {
    if (shape.type !== 'arrow') continue;
    const arrowBindings = editor.getBindingsFromShape(shape, 'arrow');
    currentBindings.set(shape.id as string, arrowBindings);
  }
  if (currentBindings.size !== snapshot.bindings.size) return false;
  for (const [arrowId, bindings] of currentBindings) {
    const previousBindings = snapshot.bindings.get(arrowId);
    if (!previousBindings || previousBindings.length !== bindings.length) return false;
    if (bindings.some((binding, index) => previousBindings[index] !== binding))
      return false;
  }
  return true;
}

export function assertSpatialPageSnapshotCurrent(
  editor: Editor,
  snapshot: SpatialPageSnapshot
) {
  if (editor.getCurrentPageId() !== snapshot.pageId)
    throw new Error('The page changed while applying the action. Please retry.');
  if (!matchesSpatialPageSnapshot(editor, snapshot))
    throw new Error('Canvas changed while applying the action. Please retry.');
}

/** One page-space representation, shared by the solver and model. Storage stays local. */
export function serializeSpatialShape(
  editor: Editor,
  shape: TLShape,
  zIndex: number,
  reuseSource?: SpatialNodeItem
): SpatialNodeItem | undefined {
  const b = editor.getShapePageBounds(shape.id);
  if (!b) return undefined;

  const p = shape.props as Record<string, any>;
  const canReuseSource = reuseSource?.type === shape.type;
  const bindings =
    shape.type === 'arrow' ? editor.getBindingsFromShape(shape.id, 'arrow') : [];
  const source: Pick<
    SpatialNodeItem,
    | 'title'
    | 'text'
    | 'content'
    | 'code'
    | 'language'
    | 'description'
    | 'archetype'
    | 'color'
    | 'subtitle'
    | 'author'
    | 'date'
    | 'sections'
    | 'theme'
    | 'currentSlideIndex'
    | 'slides'
    | 'slideCount'
    | 'storage'
    | 'mediaUrl'
    | 'mediaType'
    | 'vectorType'
    | 'svgPath'
    | 'metadata'
  > = canReuseSource
    ? {
        title: reuseSource.title,
        text: reuseSource.text,
        content: reuseSource.content,
        code: reuseSource.code,
        language: reuseSource.language,
        description: reuseSource.description,
        archetype: reuseSource.archetype,
        color: reuseSource.color,
        subtitle: reuseSource.subtitle,
        author: reuseSource.author,
        date: reuseSource.date,
        sections: reuseSource.sections,
        theme: reuseSource.theme,
        currentSlideIndex: reuseSource.currentSlideIndex,
        slides: reuseSource.slides,
        slideCount: reuseSource.slideCount,
        storage: reuseSource.storage,
        mediaUrl: reuseSource.mediaUrl,
        mediaType: reuseSource.mediaType,
        vectorType: reuseSource.vectorType,
        svgPath: reuseSource.svgPath,
        metadata: reuseSource.metadata,
      }
    : {
        title: p.title || p.name,
        text: p.code || p.content ? undefined : extractShapeSemanticText(p),
        content: p.content,
        code: p.code,
        language: p.language,
        description: p.description,
        archetype: p.archetype,
        color: p.color,
        subtitle: p.subtitle,
        author: p.author,
        date: p.date,
        sections: p.sections,
        theme: p.theme,
        currentSlideIndex: p.currentSlideIndex,
        slides: p.slides,
        slideCount: Array.isArray(p.slides) ? p.slides.length : undefined,
        storage: p.storage,
        mediaUrl: p.url,
        mediaType: p.mediaType,
        vectorType: p.vectorType,
        svgPath: p.svgPath,
        metadata: { revision: contentRevision({ ...p, storage: undefined }) },
      };

  return {
    id: shape.id,
    type: shape.type,
    parentId: shape.parentId,
    minX: b.minX,
    minY: b.minY,
    maxX: b.maxX,
    maxY: b.maxY,
    zIndex,
    rotation: shape.rotation,
    intrinsicW: typeof p.w === 'number' ? p.w : undefined,
    intrinsicH: typeof p.h === 'number' ? p.h : undefined,
    isLocked: isCanvasShapeLocked(editor, shape),
    ...source,
    from: bindings.find((binding) => (binding.props as any).terminal === 'start')?.toId,
    to: bindings.find((binding) => (binding.props as any).terminal === 'end')?.toId,
  };
}

export function spatialNodeGeometryPatch(node: SpatialNodeItem): SpatialNodePatch {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    minX: node.minX,
    minY: node.minY,
    maxX: node.maxX,
    maxY: node.maxY,
    zIndex: node.zIndex,
    rotation: node.rotation,
    intrinsicW: node.intrinsicW,
    intrinsicH: node.intrinsicH,
    isLocked: node.isLocked,
    from: node.from,
    to: node.to,
  };
}

/**
 * Serialize the complete page. The optional cache reuses only source fields when
 * tldraw's immutable props record is the same object; every safety-relevant
 * geometry, hierarchy, lock, z-order, and arrow-binding field is recalculated.
 */
export function serializeCanvas(
  editor: Editor,
  cache?: SpatialSerializationCache
): SpatialNodeItem[] {
  const pageId = editor.getCurrentPageId();
  if (cache && cache.pageId !== pageId) {
    cache.entries.clear();
    cache.pageId = pageId;
  }

  const seenIds = cache ? new Set<string>() : undefined;
  const nodes: SpatialNodeItem[] = [];
  editor.getCurrentPageShapesSorted().forEach((shape, zIndex) => {
    const id = shape.id as string;
    seenIds?.add(id);
    const previous = cache?.entries.get(id);
    const canReuseSource =
      previous?.type === shape.type && previous.props === shape.props;
    const node = serializeSpatialShape(
      editor,
      shape,
      zIndex,
      canReuseSource ? previous.node : undefined
    );
    if (node) {
      cache?.entries.set(id, {
        type: shape.type,
        props: shape.props,
        node,
      });
      // Do not expose the cache-owned record to callers. Nested source fields remain
      // read-only tldraw record data and are never edited by context compaction.
      nodes.push({ ...node });
    } else {
      cache?.entries.delete(id);
    }
  });

  if (cache && seenIds) {
    for (const id of cache.entries.keys()) {
      if (!seenIds.has(id)) cache.entries.delete(id);
    }
  }
  return nodes;
}

/** Remove full deck bodies from nearby previews; only selected decks are sent as editable source. */
export function compactViewportNeighbor(node: SpatialNodeItem): SpatialNodeItem {
  return {
    ...node,
    slides: undefined,
    slideCount: node.slideCount ?? node.slides?.length,
    code: node.code?.slice(0, 180),
    content: node.content?.slice(0, 180),
    text: node.text?.slice(0, 180),
    storage: undefined,
  };
}

export function compactBoard(nodes: SpatialNodeItem[]) {
  return nodes
    .slice(0, 300)
    .map(
      ({
        id,
        type,
        parentId,
        minX,
        minY,
        maxX,
        maxY,
        zIndex,
        rotation,
        title,
        color,
        from,
        to,
        metadata,
      }) => ({
        id,
        type,
        parentId,
        minX,
        minY,
        maxX,
        maxY,
        zIndex,
        rotation,
        title: title?.slice(0, 120),
        color,
        from,
        to,
        metadata,
      })
    );
}
