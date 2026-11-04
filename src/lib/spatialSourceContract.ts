import { shapeId } from './ai/actions';
import { extractShapeSemanticText } from './spatialVision';
import { hasActiveShapeDraft } from '../hooks/useShapeDraft';
import type { SpatialActionFrame, SpatialDeckSlide, SpatialNodeItem } from '@/types/spatial';

export interface ShapeSourceState {
  type: string;
  props: Record<string, unknown>;
}

interface SourceEntry {
  type: string;
  revision: string;
  source: Record<string, unknown>;
  createdInBatch: boolean;
}

function projectSource(type: string, fields: Record<string, unknown>) {
  switch (type) {
    case 'artifact':
      if (typeof fields.code !== 'string') return null;
      return { type, title: fields.title, code: fields.code };
    case 'code_card':
      if (typeof fields.code !== 'string') return null;
      return {
        type,
        title: fields.title,
        language: fields.language,
        description: fields.description,
        code: fields.code,
      };
    case 'rich_card':
      if (typeof fields.content !== 'string') return null;
      return {
        type,
        title: fields.title,
        archetype: fields.archetype,
        content: fields.content,
      };
    case 'document':
      if (
        !Array.isArray(fields.sections) ||
        !fields.sections.every(
          (section) =>
            section &&
            typeof section === 'object' &&
            typeof (section as Record<string, unknown>).id === 'string' &&
            typeof (section as Record<string, unknown>).title === 'string' &&
            typeof (section as Record<string, unknown>).content === 'string'
        )
      )
        return null;
      return {
        type,
        title: fields.title,
        subtitle: fields.subtitle,
        author: fields.author,
        date: fields.date,
        sections: fields.sections,
      };
    case 'slide_deck':
      if (fields.slides !== undefined && !Array.isArray(fields.slides)) return null;
      return {
        type,
        title: fields.title,
        subtitle: fields.subtitle,
        theme: fields.theme,
        currentSlideIndex: fields.currentSlideIndex,
        slides: Array.isArray(fields.slides) ? fields.slides : [],
      };
    case 'vector_shape':
      if (typeof fields.svgPath !== 'string') return null;
      return {
        type,
        title: fields.title,
        vectorType: fields.vectorType,
        label: fields.label,
        svgPath: fields.svgPath,
      };
    case 'text':
      if (typeof fields.text !== 'string') return null;
      return { type, text: fields.text };
    default:
      return typeof fields.text === 'string' ? { type, text: fields.text } : null;
  }
}

function exactSourceRevision(source: Record<string, unknown>) {
  // This stays local. Unlike the compact board-index hash, it is the exact source
  // projection that the model received, including all content used by replacement.
  return JSON.stringify(source);
}

function sourceFromNode(node: SpatialNodeItem) {
  // The active chat prompt includes full code/content/sections for selected
  // objects, but it deliberately omits vector paths and empty text snippets.
  if (node.type === 'vector_shape') return null;
  if (
    (node.type === 'artifact' || node.type === 'code_card') &&
    !node.code
  )
    return null;
  if (node.type === 'rich_card' && !node.content) return null;
  if (node.text === '') return null;
  return projectSource(node.type, node as unknown as Record<string, unknown>);
}

function sourceFromShape(shape: ShapeSourceState) {
  return projectSource(shape.type, {
    ...shape.props,
    text: extractShapeSemanticText(shape.props),
  });
}

function nodeKey(id: string) {
  return shapeId(id);
}

function draftKeyForSource(type: string, id: string) {
  if (type === 'artifact') return `artifact:${id}:source`;
  if (type === 'code_card' || type === 'rich_card') return `${type}:${id}`;
  if (type === 'document') return `document:${id}:content`;
  if (type === 'slide_deck') return `slide-deck:${id}:content`;
  return null;
}

function expectedSourceType(frame: SpatialActionFrame) {
  switch (frame.op) {
    case 'mutate_artifact':
      return typeof frame.code === 'string' ? 'artifact' : null;
    case 'mutate_code_card':
      return frame.code !== undefined ? 'code_card' : null;
    case 'mutate_rich_card':
      return frame.content !== undefined ? 'rich_card' : null;
    case 'mutate_document':
      return frame.sections !== undefined ? 'document' : null;
    case 'mutate_slide_deck':
      return frame.slides !== undefined ? 'slide_deck' : null;
    case 'mutate_vector':
      return frame.svgPath !== undefined ? 'vector_shape' : null;
    case 'mutate_text':
      return typeof frame.text === 'string' ? '*' : null;
    default:
      return null;
  }
}

function sourceFromCreation(frame: SpatialActionFrame) {
  switch (frame.op) {
    case 'spawn_artifact':
      return projectSource('artifact', frame as unknown as Record<string, unknown>);
    case 'create_code_card':
      return projectSource('code_card', frame as unknown as Record<string, unknown>);
    case 'create_rich_card':
      return projectSource('rich_card', frame as unknown as Record<string, unknown>);
    case 'create_document':
      return projectSource('document', frame as unknown as Record<string, unknown>);
    case 'create_slide_deck':
      return projectSource('slide_deck', frame as unknown as Record<string, unknown>);
    case 'draw_vector':
      return projectSource('vector_shape', frame as unknown as Record<string, unknown>);
    default:
      return null;
  }
}

function applyReplacementSource(
  current: Record<string, unknown>,
  frame: SpatialActionFrame
) {
  const next = { ...current };
  if (frame.title !== undefined) next.title = frame.title;
  if (frame.op === 'mutate_artifact' && frame.code !== undefined)
    next.code = frame.code;
  if (frame.op === 'mutate_code_card') {
    if (frame.code !== undefined) next.code = frame.code;
    if (frame.language !== undefined) next.language = frame.language;
    if (frame.description !== undefined) next.description = frame.description;
  }
  if (frame.op === 'mutate_rich_card') {
    if (frame.content !== undefined) next.content = frame.content;
    if (frame.archetype !== undefined) next.archetype = frame.archetype;
  }
  if (frame.op === 'mutate_document') {
    for (const key of ['subtitle', 'author', 'date', 'sections'] as const)
      if (frame[key] !== undefined) next[key] = frame[key];
  }
  if (frame.op === 'mutate_slide_deck') {
    for (const key of ['subtitle', 'theme', 'currentSlideIndex'] as const)
      if (frame[key] !== undefined) next[key] = frame[key];
    if (frame.slides !== undefined)
      next.slides = mergeDeckSlidesPreservingUnknownFields(
        Array.isArray(current.slides) ? current.slides : [],
        frame.slides
      );
  }
  if (frame.op === 'mutate_vector') {
    for (const key of ['vectorType', 'label', 'svgPath'] as const)
      if (frame[key] !== undefined) next[key] = frame[key];
  }
  if (frame.op === 'mutate_text') {
    if (current.type === 'rich_card') next.content = frame.text;
    else if (current.type === 'code_card') next.code = frame.text;
    else next.text = frame.text;
  }
  return next;
}

const deckSlideFields = new Set([
  'id', 'title', 'subtitle', 'layout', 'bullets', 'content', 'speakerNotes',
  'stats', 'columns', 'timelineSteps',
]);

/** Preserve forward-compatible slide metadata the current AI schema cannot edit. */
export function mergeDeckSlidesPreservingUnknownFields(
  previousSlides: unknown[],
  incomingSlides: SpatialActionFrame['slides']
): SpatialDeckSlide[] {
  const previousById = new Map(
    previousSlides.flatMap((slide) => {
      if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return [];
      const record = slide as Record<string, unknown>;
      return typeof record.id === 'string' ? [[record.id, record] as const] : [];
    })
  );
  const incoming = incomingSlides || [];
  return incoming.map((slide) => {
    const previous = previousById.get(slide.id);
    if (!previous) return slide;
    const extraFields = Object.fromEntries(
      Object.entries(previous).filter(([key]) => !deckSlideFields.has(key))
    );
    const merged: Record<string, unknown> = { ...extraFields, ...slide };
    for (const [field, identity] of [
      ['stats', ['label', 'value']],
      ['columns', ['title', 'text']],
      ['timelineSteps', ['step', 'title']],
    ] as const) {
      const nextItems = slide[field];
      const oldItems = previous[field];
      if (!Array.isArray(nextItems) || !Array.isArray(oldItems)) continue;
      merged[field] = nextItems.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const candidate = item as Record<string, unknown>;
        const oldItem = oldItems.find((old) =>
          old && typeof old === 'object' && !Array.isArray(old) &&
          identity.every((key) => (old as Record<string, unknown>)[key] === candidate[key])
        ) || oldItems.find((old) =>
          old && typeof old === 'object' && !Array.isArray(old) &&
          (old as Record<string, unknown>)[identity[0]] === candidate[identity[0]]
        );
        if (!oldItem || typeof oldItem !== 'object' || Array.isArray(oldItem)) return candidate;
        const known = new Set(
          field === 'stats' ? ['label', 'value', 'change'] :
            field === 'columns' ? ['title', 'text', 'icon'] : ['step', 'title', 'desc']
        );
        const extras = Object.fromEntries(
          Object.entries(oldItem as Record<string, unknown>).filter(([key]) => !known.has(key))
        );
        return { ...extras, ...candidate };
      });
    }
    return merged as SpatialDeckSlide;
  });
}

const createOps = new Set([
  'spawn_artifact',
  'create_code_card',
  'create_rich_card',
  'create_document',
  'create_slide_deck',
  'draw_vector',
  'create_group',
  'create_card',
  'embed_media',
]);

/**
 * Enforce source provenance before a batch is sent to the worker. Only full
 * selected/actually-transmitted nodes authorize replacement. Preview nodes
 * naturally fail the exact comparison against the current complete source.
 */
export function assertSpatialSourceContract(
  frames: SpatialActionFrame[],
  transmittedNodes: SpatialNodeItem[],
  getCurrentShape: (id: string) => ShapeSourceState | undefined
) {
  const sources = new Map<string, SourceEntry>();
  for (const node of transmittedNodes) {
    const source = sourceFromNode(node);
    if (source) {
      sources.set(nodeKey(node.id), {
        type: node.type,
        revision: exactSourceRevision(source),
        source,
        createdInBatch: false,
      });
    }
  }

  const batchCreatedIds = new Set<string>();
  const currentCheckedIds = new Set<string>();
  for (const frame of frames) {
    const targetType = expectedSourceType(frame);
    if (targetType) {
      const id = frame.target || frame.id;
      if (!id) throw new Error('A full-content replacement needs an exact target.');
      const key = nodeKey(id);
      const source = sources.get(key);
      if (!source)
        throw new Error(
          'The full content for this target was not supplied to the model. Select the object and retry.'
        );
      if (targetType !== '*' && source.type !== targetType)
        throw new Error('A full-content replacement targeted the wrong shape type.');
      if (!source.createdInBatch) {
        const draftKey = draftKeyForSource(source.type, key);
        if (draftKey && hasActiveShapeDraft(draftKey))
          throw new Error(
            'Save or discard the local source draft before asking AI to replace this object.'
          );
      }

      if (!source.createdInBatch && !currentCheckedIds.has(key)) {
        const current = getCurrentShape(key);
        if (!current)
          throw new Error('The replacement target no longer exists. Retry with the latest canvas.');
        if (current.type !== source.type || (targetType !== '*' && current.type !== targetType))
          throw new Error('A full-content replacement targeted the wrong shape type.');
        const currentSource = sourceFromShape(current);
        if (!currentSource || exactSourceRevision(currentSource) !== source.revision)
          throw new Error(
            'The target changed after its full content was supplied to the model. Retry with the latest canvas.'
          );
        currentCheckedIds.add(key);
      }

      source.source = applyReplacementSource(source.source, frame);
      source.revision = exactSourceRevision(source.source);
      sources.set(key, source);
    }

    if (createOps.has(frame.op) && frame.id) {
      const key = nodeKey(frame.id);
      if (getCurrentShape(key))
        throw new Error('Creation cannot reuse an existing canvas object ID.');
      if (batchCreatedIds.has(key))
        throw new Error('A batch cannot create the same canvas object ID twice.');
      batchCreatedIds.add(key);
      const createdSource = sourceFromCreation(frame);
      if (createdSource) {
        sources.set(key, {
          type: createdSource.type as string,
          revision: exactSourceRevision(createdSource),
          source: createdSource,
          createdInBatch: true,
        });
      }
    }
  }
}

export function spatialNodeSourceRevision(node: SpatialNodeItem): string | null {
  const source = sourceFromNode(node);
  return source ? exactSourceRevision(source) : null;
}

export function shapeSourceRevision(shape: ShapeSourceState): string | null {
  const source = sourceFromShape(shape);
  return source ? exactSourceRevision(source) : null;
}
