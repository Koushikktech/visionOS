import type { Editor } from '@tldraw/tldraw';
import type { SpatialNodeItem } from '@/types/spatial';
import { extractShapeSemanticText } from './spatialVision';

export function contentRevision(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
/** One page-space representation, shared by the solver and model. Storage stays local. */
export function serializeCanvas(editor: Editor): SpatialNodeItem[] {
  return editor.getCurrentPageShapesSorted().flatMap((shape, zIndex) => {
    const b = editor.getShapePageBounds(shape.id);
    if (!b) return [];
    const p = shape.props as Record<string, any>;
    const bindings =
      shape.type === 'arrow'
        ? editor.getBindingsFromShape(shape.id, 'arrow')
        : [];
    return [
      {
        id: shape.id,
        type: shape.type,
        parentId: shape.parentId,
        minX: b.minX,
        minY: b.minY,
        maxX: b.maxX,
        maxY: b.maxY,
        zIndex,
        rotation: shape.rotation,
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
        storage: p.storage,
        mediaUrl: p.url,
        mediaType: p.mediaType,
        vectorType: p.vectorType,
        svgPath: p.svgPath,
        from: bindings.find((b) => (b.props as any).terminal === 'start')?.toId,
        to: bindings.find((b) => (b.props as any).terminal === 'end')?.toId,
        metadata: { revision: contentRevision({ ...p, storage: undefined }) },
      },
    ];
  });
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
