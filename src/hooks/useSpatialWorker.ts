'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor, TLShapeId, TLShapePartial } from '@tldraw/tldraw';
import { toRichText } from '@tldraw/tldraw';
import type {
  WorkerInMessage,
  WorkerOutMessage,
  SpatialNodeItem,
  SpatialActionFrame,
  CulledContextPayload,
  SolvedNodeCoordinate,
  SolvedGroupItem,
  SolvedConnectorItem,
  SolvedTextMutation,
  SolvedCreatedCard,
  SolvedRichCardItem,
  SolvedCodeCardItem,
  SolvedMediaEmbedItem,
  SolvedVectorItem,
  SolvedDocItem,
  SolvedDeckItem,
  DAGExecutionPlan,
  CardArchetype,
  SolvedArtifactItem,
  SolvedRestyle,
  SolvedActionPayload,
  SolvedLayoutResult,
  SpeculativeSkeletonBounds,
  ViewportQuery,
  AIIntentPreset,
  AISpatialStreamRequest,
} from '../types/spatial';
import {
  assertSpatialPageSnapshotCurrent,
  assertShapesUnlockedForReparent,
  captureSpatialPageSnapshot,
  compactBoard,
  createSpatialSerializationCache,
  isCanvasShapeLocked,
  matchesSpatialPageSnapshot,
  serializeCanvas,
  serializeSpatialShape,
  spatialNodeGeometryPatch,
  type SpatialPageSnapshot,
  type SpatialSerializationCache,
} from '../lib/spatialContext';
import { validateAction, shapeId as normalizeId } from '../lib/ai/actions';
import { extractShapeSemanticText } from '../lib/spatialVision';
import {
  assertSpatialSourceContract,
  mergeDeckSlidesPreservingUnknownFields,
} from '../lib/spatialSourceContract';
import { runEditorOperationSafely } from '../lib/editorOperation';
import {
  assertCanvasWritable,
  assertSpatialActionsWritable,
  isSpatialCanvasMutation,
  READONLY_CANVAS_MESSAGE,
} from '../lib/canvasWriteGuard';

function solvedActionHasCanvasWrites(payload: SolvedActionPayload): boolean {
  return Boolean(
    isSpatialCanvasMutation(payload.rawFrame) ||
      payload.nodes?.length ||
      payload.createdCard ||
      payload.richCard ||
      payload.codeCard ||
      payload.artifact ||
      payload.mediaEmbed ||
      payload.vector ||
      payload.document ||
      payload.deck ||
      payload.connector ||
      payload.group ||
      payload.textMutation ||
      payload.restyle ||
      payload.deletedIds?.length
  );
}

function solvedLayoutHasCanvasWrites(result: SolvedLayoutResult): boolean {
  return Boolean(
    result.actions?.some(solvedActionHasCanvasWrites) ||
      result.nodes.length ||
      result.createdCards?.length ||
      result.richCards?.length ||
      result.codeCards?.length ||
      result.artifacts?.length ||
      result.mediaEmbeds?.length ||
      result.vectors?.length ||
      result.documents?.length ||
      result.decks?.length ||
      result.groups?.length ||
      result.connectors?.length ||
      result.textMutations?.length ||
      result.restyles?.length ||
      result.deletedIds?.length
  );
}

export interface SpatialWorkerState {
  isWorkerReady: boolean;
  lastLatencyMs: number | null;
  lastActionSummary: string;
  culledContext: CulledContextPayload | null;
  indexedCount: number;
  isStreaming: boolean;
  streamingAction: string | null;
  firstTokenLatencyMs: number | null;
  totalStreamTimeMs: number | null;
  streamedFramesCount: number;
  skeletons: SpeculativeSkeletonBounds[];
}

export function useSpatialWorker(editor: Editor | null) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        snapshot: SpatialPageSnapshot;
        validateBeforeApply: () => void;
      }
    >()
  );
  const directLayoutSnapshotsRef = useRef(new Map<string, SpatialPageSnapshot>());
  const contextSerializationCacheRef = useRef<SpatialSerializationCache>(
    createSpatialSerializationCache()
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const streamPageSnapshotRef = useRef<SpatialPageSnapshot | null>(null);
  const streamSourceNodesRef = useRef<SpatialNodeItem[]>([]);
  const streamStartTimeRef = useRef<number>(0);
  const firstTokenReceivedRef = useRef<boolean>(false);
  const indexedPageIdRef = useRef<string | null>(null);
  const indexRevisionRef = useRef(0);
  const indexedStoreVersionRef = useRef(0);
  const observedStoreVersionRef = useRef(0);
  const indexedNodesRef = useRef(new Map<string, SpatialNodeItem>());
  const shapePropsRef = useRef(new Map<string, unknown>());
  const parentIdsRef = useRef(new Map<string, string>());
  const childrenByParentRef = useRef(new Map<string, Set<string>>());
  const queuedIndexChangesRef = useRef(new Map<string, 'upsert' | 'delete'>());
  const indexOrderDirtyRef = useRef(false);
  const indexSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<SpatialWorkerState>({
    isWorkerReady: false,
    lastLatencyMs: null,
    lastActionSummary: 'Spatial Engine Ready',
    culledContext: null,
    indexedCount: 0,
    isStreaming: false,
    streamingAction: null,
    firstTokenLatencyMs: null,
    totalStreamTimeMs: null,
    streamedFramesCount: 0,
    skeletons: [],
  });

  const reportReadonlyWrite = useCallback(() => {
    setState((prev) => ({
      ...prev,
      lastActionSummary: READONLY_CANVAS_MESSAGE,
      skeletons: [],
    }));
  }, []);

  // Extract spatial nodes from tldraw editor
  const extractSpatialNodes = useCallback((): SpatialNodeItem[] => {
    if (!editor) return [];
    return serializeCanvas(editor, contextSerializationCacheRef.current);
  }, [editor]);

  // Spring animation runner for smooth 60 FPS transitions
  const animateShapesToTargets = useCallback(
    (solvedNodes: SolvedNodeCoordinate[]) => {
      if (!editor || solvedNodes.length === 0) return;
      assertCanvasWritable(editor);

      // Commit once: animated document writes polluted undo and raced manual drags.
      runEditorOperationSafely(editor, () => editor.updateShapes(
        solvedNodes.flatMap((target) => {
          const shape = editor.getShape(target.id as TLShapeId);
          if (!shape) return [];
          const point = editor.getPointInParentSpace(shape, {
            x: target.x,
            y: target.y,
          });
          const bounds = editor.getShapePageBounds(shape.id);
          const current = editor.getPointInParentSpace(shape, {
            x: bounds?.minX ?? target.x,
            y: bounds?.minY ?? target.y,
          });
          return [
            {
              id: shape.id,
              type: shape.type,
              x: shape.x + point.x - current.x,
              y: shape.y + point.y - current.y,
              ...(target.w !== undefined && target.h !== undefined
                ? { props: { w: target.w, h: target.h } }
                : {}),
            } as TLShapePartial,
          ];
        })
      ));
    },
    [editor]
  );

  // Creates or updates a card on canvas
  const applyCreatedCard = useCallback(
    (card: SolvedCreatedCard) => {
      if (!editor) throw new Error('The canvas is not ready to create this card. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const isNote = card.shapeType === 'note';
        const existing = editor.getShape(shapeId);
        const richText = toRichText(
          card.text ? `${card.title}\n\n${card.text}` : card.title
        );

        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: isNote ? 'note' : 'geo',
            x: existing.x,
            y: existing.y,
            props: isNote
              ? {
                  color: card.color || 'light-violet',
                  richText,
                }
              : {
                  w: card.w,
                  h: card.h,
                  color: card.color || 'light-violet',
                  richText,
                },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: isNote ? 'note' : 'geo',
            x: card.x,
            y: card.y,
            props: isNote
              ? {
                  color: card.color || 'light-violet',
                  richText,
                }
              : {
                  w: card.w,
                  h: card.h,
                  geo: 'rectangle',
                  color: card.color || 'light-violet',
                  richText,
                },
          });
        }
      });

      // Dismiss matching speculative skeleton
      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== card.id),
      }));
    },
    [editor]
  );

  // Creates or updates a Rich Card (KaTeX / Markdown) on canvas
  const applyRichCard = useCallback(
    (card: SolvedRichCardItem) => {
      if (!editor) {
        throw new Error('The canvas is not ready to apply this note. Retry.');
      }
      assertCanvasWritable(editor);
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: 'rich_card',
            x: existing.x,
            y: existing.y,
            props: {
              w: card.w,
              h: card.h,
              title: card.title,
              content: card.content,
              archetype: card.archetype || 'note',
              color: card.color || 'light-blue',
              isStreaming: card.isStreaming || false,
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'rich_card',
            x: card.x,
            y: card.y,
            props: {
              w: card.w,
              h: card.h,
              title: card.title,
              content: card.content,
              archetype: card.archetype || 'note',
              color: card.color || 'light-blue',
              isStreaming: card.isStreaming || false,
            },
          });
        }
      });

      if (!editor.getShape(shapeId))
        throw new Error(`Could not apply note “${card.title}”. Retry.`);

      // Dismiss matching speculative skeleton
      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== card.id),
      }));
    },
    [editor]
  );

  // Creates or updates a syntax-highlighted code card
  const applyCodeCard = useCallback(
    (card: SolvedCodeCardItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this code card. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: 'code_card',
            props: {
              w: card.w || (existing.props as any).w || 520,
              h: card.h || (existing.props as any).h || 320,
              title:
                card.title || (existing.props as any).title || 'code_snippet',
              language:
                card.language ||
                (existing.props as any).language ||
                'javascript',
              code:
                card.code !== undefined
                  ? card.code
                  : (existing.props as any).code || '',
              description:
                card.description !== undefined
                  ? card.description
                  : (existing.props as any).description,
              color:
                card.color || (existing.props as any).color || 'light-blue',
              isStreaming: card.isStreaming || false,
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'code_card',
            x: card.x,
            y: card.y,
            props: {
              w: card.w,
              h: card.h,
              title: card.title,
              language: card.language || 'javascript',
              code: card.code,
              description: card.description,
              color: card.color || 'light-blue',
              isStreaming: card.isStreaming || false,
            },
          });
        }
      });

      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== card.id),
      }));
    },
    [editor]
  );

  // Streaming real-time text patch directly to a Rich Card
  const patchRichCardContent = useCallback(
    (cardId: string, appendText: string, isStreaming = true) => {
      if (!editor) return;
      assertCanvasWritable(editor);
      const shapeId = (
        cardId.startsWith('shape:') ? cardId : `shape:${cardId}`
      ) as TLShapeId;
      const shape = editor.getShape(shapeId);
      if (shape && shape.type === 'rich_card') {
        const currentContent =
          (shape.props as { content: string }).content || '';
        const newContent = currentContent + appendText;
        editor.updateShape({
          id: shapeId,
          type: 'rich_card',
          props: {
            content: newContent,
            isStreaming,
          },
        });
      }
    },
    [editor]
  );

  // Creates or updates an interactive sandbox simulation artifact
  const applyArtifact = useCallback(
    (artifact: SolvedArtifactItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this app. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        artifact.id.startsWith('shape:') ? artifact.id : `shape:${artifact.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          const prevProps = existing.props as Record<string, any>;
          editor.updateShape({
            id: shapeId,
            type: 'artifact',
            x: existing.x,
            y: existing.y,
            props: {
              w: artifact.w || prevProps.w,
              h: artifact.h || prevProps.h,
              title: artifact.title || prevProps.title,
              code: artifact.code || prevProps.code,
              ...(artifact.code !== undefined && artifact.code !== prevProps.code
                ? { networkEnabled: false }
                : {}),
              color: artifact.color || prevProps.color || 'light-violet',
              storage:
                artifact.storage && Object.keys(artifact.storage).length > 0
                  ? { ...(prevProps.storage || {}), ...artifact.storage }
                  : prevProps.storage || {},
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'artifact',
            x: artifact.x,
            y: artifact.y,
            props: {
              w: artifact.w,
              h: artifact.h,
              title: artifact.title,
              code: artifact.code,
              color: artifact.color || 'light-violet',
              storage: artifact.storage || {},
            },
          });
        }
      });

      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter(
          (s) =>
            s.id !== artifact.id &&
            s.id !== `shape:${artifact.id}` &&
            s.id !== artifact.id.replace(/^shape:/, '') &&
            !s.id.startsWith('summon_')
        ),
      }));
    },
    [editor]
  );

  // Creates or updates a media embed player (YouTube, Web, Audio)
  const applyMediaEmbed = useCallback(
    (media: SolvedMediaEmbedItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this media. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        media.id.startsWith('shape:') ? media.id : `shape:${media.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: 'media_embed',
            x: existing.x,
            y: existing.y,
            props: {
              w: media.w,
              h: media.h,
              title: media.title,
              url: media.url,
              mediaType: media.mediaType,
              color: media.color || 'light-blue',
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'media_embed',
            x: media.x,
            y: media.y,
            props: {
              w: media.w,
              h: media.h,
              title: media.title,
              url: media.url,
              mediaType: media.mediaType,
              color: media.color || 'light-blue',
            },
          });
        }
      });

      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== media.id),
      }));
    },
    [editor]
  );

  // Creates or updates an architectural glyph or procedural SVG vector shape
  const applyVectorShape = useCallback(
    (vector: SolvedVectorItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this vector. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        vector.id.startsWith('shape:') ? vector.id : `shape:${vector.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: 'vector_shape',
            x: existing.x,
            y: existing.y,
            props: {
              w: vector.w,
              h: vector.h,
              title: vector.title,
              vectorType: vector.vectorType,
              svgPath: vector.svgPath,
              label: vector.label,
              color: vector.color || 'light-violet',
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'vector_shape',
            x: vector.x,
            y: vector.y,
            props: {
              w: vector.w,
              h: vector.h,
              title: vector.title,
              vectorType: vector.vectorType,
              svgPath: vector.svgPath,
              label: vector.label,
              color: vector.color || 'light-violet',
            },
          });
        }
      });

      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== vector.id),
      }));
    },
    [editor]
  );

  // Creates or updates a longform document shape (Notion grade)
  const applyDocument = useCallback(
    (doc: SolvedDocItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this document. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        doc.id.startsWith('shape:') ? doc.id : `shape:${doc.id}`
      ) as TLShapeId;

      runEditorOperationSafely(editor, () => {
        const existing = editor.getShape(shapeId);
        if (existing) {
          editor.updateShape({
            id: shapeId,
            type: 'document',
            x: existing.x,
            y: existing.y,
            props: {
              w: doc.w,
              h: doc.h,
              title: doc.title,
              subtitle: doc.subtitle,
              author: doc.author,
              date: doc.date,
              sections: doc.sections,
            },
          });
        } else {
          editor.createShape({
            id: shapeId,
            type: 'document',
            x: doc.x,
            y: doc.y,
            props: {
              w: doc.w,
              h: doc.h,
              title: doc.title,
              subtitle: doc.subtitle,
              author: doc.author,
              date: doc.date,
              sections: doc.sections,
            },
          });
        }
      });

      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((s) => s.id !== doc.id),
      }));
    },
    [editor]
  );

  const applyDeck = useCallback(
    (deck: SolvedDeckItem, rawFrame: SpatialActionFrame) => {
      if (!editor) throw new Error('The canvas is not ready to apply this deck. Retry.');
      assertCanvasWritable(editor);
      validateAction(rawFrame);
      const isCreate = rawFrame.op === 'create_slide_deck';
      if (!isCreate && rawFrame.op !== 'mutate_slide_deck')
        throw new Error('Invalid slide deck action.');
      const requestedId = isCreate ? rawFrame.id : rawFrame.target || rawFrame.id;
      if (!requestedId || normalizeId(requestedId) !== normalizeId(deck.id))
        throw new Error('Slide deck action target changed before apply. Retry.');
      const id = normalizeId(deck.id) as TLShapeId;
      const existing = editor.getShape(id);
      if (isCreate && existing)
        throw new Error('The new slide deck ID already exists. Retry.');
      if (!isCreate && (!existing || existing.type !== 'slide_deck'))
        throw new Error('The slide deck no longer exists. Retry with the latest canvas.');
      if (existing && isCanvasShapeLocked(editor, existing))
        throw new Error('Unlock the slide deck and its frame before asking AI to change it.');

      const currentProps = existing?.props as Record<string, unknown> | undefined;
      const slides = mergeDeckSlidesPreservingUnknownFields(
        Array.isArray(currentProps?.slides) ? currentProps.slides : [],
        deck.slides
      );
      const props = {
        ...(isCreate ? { w: deck.w, h: deck.h } : {}),
        title: deck.title,
        subtitle: deck.subtitle,
        theme: deck.theme || 'midnight',
        currentSlideIndex: deck.currentSlideIndex ?? 0,
        slides,
      };

      runEditorOperationSafely(editor, () => {
        if (existing) {
          editor.updateShape({ id, type: 'slide_deck', x: existing.x, y: existing.y, props });
        } else {
          editor.createShape({ id, type: 'slide_deck', x: deck.x, y: deck.y, props });
        }
      });

      const readback = editor.getShape(id);
      const savedProps = readback?.props as Record<string, unknown> | undefined;
      if (
        readback?.type !== 'slide_deck' ||
        savedProps?.title !== props.title ||
        savedProps?.subtitle !== props.subtitle ||
        savedProps?.theme !== props.theme ||
        savedProps?.currentSlideIndex !== props.currentSlideIndex ||
        JSON.stringify(savedProps?.slides) !== JSON.stringify(props.slides)
      )
        throw new Error('The slide deck did not verify after writing. No success was reported.');
      setState((prev) => ({
        ...prev,
        skeletons: prev.skeletons.filter((item) => normalizeId(item.id) !== id),
      }));
    },
    [editor]
  );

  // Creates or updates a group container visual bounding frame
  const applyGroupFrame = useCallback(
    (group: SolvedGroupItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this group. Retry.');
      assertCanvasWritable(editor);

      const placeGroup = () => {
        const shapeId = (
          group.id.startsWith('shape:') ? group.id : `shape:${group.id}`
        ) as TLShapeId;

        let targetNodeIds =
          group.nodeIds && group.nodeIds.length > 0 ? group.nodeIds : [];
        if (targetNodeIds.length === 0) {
          targetNodeIds = Array.from(editor.getCurrentPageShapeIds()).filter(
            (id) => id !== shapeId && editor.getShape(id)?.type !== 'arrow'
          );
        }

        const existingGroup = editor.getShape(shapeId);
        if (existingGroup && isCanvasShapeLocked(editor, existingGroup))
          throw new Error('Unlock the group frame before changing its membership.');
        assertShapesUnlockedForReparent(editor, targetNodeIds);

        let finalX = group.x;
        let finalY = group.y;
        let finalW = group.w;
        let finalH = group.h;

        if (targetNodeIds.length > 0) {
          const childBounds = targetNodeIds
            .map((nId) => {
              const cleanId = (
                nId.startsWith('shape:') ? nId : `shape:${nId}`
              ) as TLShapeId;
              return editor.getShapePageBounds(cleanId);
            })
            .filter((b): b is NonNullable<typeof b> => !!b);

          if (childBounds.length > 0) {
            const paddingX = 48;
            const paddingBottom = 48;
            const headerTop = 60;
            const minX = Math.min(...childBounds.map((b) => b.minX)) - paddingX;
            const minY =
              Math.min(...childBounds.map((b) => b.minY)) - headerTop;
            const maxX = Math.max(...childBounds.map((b) => b.maxX)) + paddingX;
            const maxY =
              Math.max(...childBounds.map((b) => b.maxY)) + paddingBottom;

            finalX = minX;
            finalY = minY;
            finalW = Math.max(340, maxX - minX);
            finalH = Math.max(220, maxY - minY);
          }
        }

        runEditorOperationSafely(editor, () => {
          if (!editor.getShape(shapeId))
            editor.createShape({
              id: shapeId,
              type: 'frame',
              x: finalX,
              y: finalY,
              props: { w: finalW, h: finalH, name: group.title || 'Group' },
            });
          editor.reparentShapes(
            targetNodeIds.map((id) => normalizeId(id) as TLShapeId),
            shapeId
          );
        });
      };

      placeGroup();
    },
    [editor]
  );

  // Creates a directional connector arrow between two shapes with magnetic dynamic edge bindings
  const applyConnector = useCallback(
    (connector: SolvedConnectorItem) => {
      if (!editor) throw new Error('The canvas is not ready to apply this connector. Retry.');
      assertCanvasWritable(editor);

      const connect = () => {
        const fromShapeId = (
          connector.fromId.startsWith('shape:')
            ? connector.fromId
            : `shape:${connector.fromId}`
        ) as TLShapeId;
        const toShapeId = (
          connector.toId.startsWith('shape:')
            ? connector.toId
            : `shape:${connector.toId}`
        ) as TLShapeId;

        const fromShape = editor.getShape(fromShapeId);
        const toShape = editor.getShape(toShapeId);

        if (!fromShape || !toShape)
          throw new Error('Connector targets no longer exist. Retry with the current canvas.');

        const fromBounds = editor.getShapePageBounds(fromShapeId);
        const toBounds = editor.getShapePageBounds(toShapeId);

        if (!fromBounds || !toBounds)
          throw new Error('Connector targets are not available on the current page.');

        const fromCenter = {
          x: fromBounds.minX + fromBounds.w / 2,
          y: fromBounds.minY + fromBounds.h / 2,
        };
        const toCenter = {
          x: toBounds.minX + toBounds.w / 2,
          y: toBounds.minY + toBounds.h / 2,
        };

        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;

        let startX = fromBounds.maxX;
        let startY = fromCenter.y;
        let endX = toBounds.minX;
        let endY = toCenter.y;

        if (Math.abs(dx) >= Math.abs(dy)) {
          // Primarily Horizontal
          if (dx >= 0) {
            // Left to Right
            startX = fromBounds.maxX;
            startY = fromCenter.y;
            endX = toBounds.minX;
            endY = toCenter.y;
          } else {
            // Right to Left
            startX = fromBounds.minX;
            startY = fromCenter.y;
            endX = toBounds.maxX;
            endY = toCenter.y;
          }
        } else {
          // Primarily Vertical
          if (dy >= 0) {
            // Top to Bottom
            startX = fromCenter.x;
            startY = fromBounds.maxY;
            endX = toCenter.x;
            endY = toBounds.minY;
          } else {
            // Bottom to Top
            startX = fromCenter.x;
            startY = fromBounds.minY;
            endX = toCenter.x;
            endY = toBounds.maxY;
          }
        }

        const arrowId = (
          connector.id.startsWith('shape:')
            ? connector.id
            : `shape:${connector.id}`
        ) as TLShapeId;

        runEditorOperationSafely(editor, () => {
          const existing = editor.getShape(arrowId);
          if (existing) {
            editor.updateShape({
              id: arrowId,
              type: 'arrow',
              x: startX,
              y: startY,
              props: {
                start: { x: 0, y: 0 },
                end: { x: endX - startX, y: endY - startY },
                text: connector.label || '',
                arrowheadEnd: 'arrow',
                color: connector.color || 'light-violet',
                bend: connector.bend ?? 0,
                size: 's',
              },
            });
          } else {
            editor.createShape({
              id: arrowId,
              type: 'arrow',
              x: startX,
              y: startY,
              props: {
                start: { x: 0, y: 0 },
                end: { x: endX - startX, y: endY - startY },
                text: connector.label || '',
                arrowheadEnd: 'arrow',
                color: connector.color || 'light-violet',
                bend: connector.bend ?? 0,
                size: 's',
              },
            });
          }

          // Register dynamic magnetic bindings so moving shapes dynamically moves the arrow
          try {
            editor.createBinding({
              type: 'arrow',
              fromId: arrowId,
              toId: fromShapeId,
              props: {
                terminal: 'start',
                normalizedAnchor: { x: 0.5, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
            });
            editor.createBinding({
              type: 'arrow',
              fromId: arrowId,
              toId: toShapeId,
              props: {
                terminal: 'end',
                normalizedAnchor: { x: 0.5, y: 0.5 },
                isExact: false,
                isPrecise: false,
              },
            });
          } catch (error) {
            throw new Error('Could not bind the connector to its targets.');
          }
        });
        return true;
      };

      if (!connect())
        throw new Error('Connector targets could not be resolved.');
    },
    [editor]
  );

  // Restyles shape color / fill in-place
  const applyRestyle = useCallback(
    (restyle: SolvedRestyle) => {
      if (!editor) throw new Error('The canvas is not ready to apply this style. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        restyle.id.startsWith('shape:') ? restyle.id : `shape:${restyle.id}`
      ) as TLShapeId;
      const shape = editor.getShape(shapeId);
      if (!shape) throw new Error('The style target no longer exists. Retry with the current canvas.');

      if (restyle.color && !('color' in shape.props))
        throw new Error('This shape does not support a color style.');
      runEditorOperationSafely(editor, () => {
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...(restyle.color ? { color: restyle.color } : {}),
            ...(restyle.fill && 'fill' in shape.props
              ? { fill: restyle.fill }
              : {}),
          },
        });
      });
    },
    [editor]
  );

  // Deletes shapes from canvas
  const applyDelete = useCallback(
    (ids: string[]) => {
      if (!editor) throw new Error('The canvas is not ready to delete these objects. Retry.');
      if (ids.length === 0) return;
      assertCanvasWritable(editor);
      const shapeIds = ids.map(
        (id) => (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId
      );
      if (shapeIds.some((id) => !editor.getShape(id)))
        throw new Error('A delete target no longer exists. Retry with the current canvas.');
      runEditorOperationSafely(editor, () => editor.deleteShapes(shapeIds));
    },
    [editor]
  );

  // Updates shape text / markdown content in-place
  const applyTextMutation = useCallback(
    (mutation: SolvedTextMutation) => {
      if (!editor) throw new Error('The canvas is not ready to apply this text change. Retry.');
      assertCanvasWritable(editor);
      const shapeId = (
        mutation.id.startsWith('shape:') ? mutation.id : `shape:${mutation.id}`
      ) as TLShapeId;
      const shape = editor.getShape(shapeId);
      if (!shape) throw new Error('The text target no longer exists. Retry with the current canvas.');

      runEditorOperationSafely(editor, () => {
        if (shape.type === 'rich_card') {
          editor.updateShape({
            id: shapeId,
            type: 'rich_card',
            props: {
              content: mutation.text,
              ...(mutation.color ? { color: mutation.color } : {}),
            },
          });
        } else if (shape.type === 'code_card') {
          editor.updateShape({
            id: shapeId,
            type: 'code_card',
            props: {
              code: mutation.text,
              ...(mutation.color ? { color: mutation.color } : {}),
            },
          });
        } else if (shape.type === 'artifact') {
          // App source is changed only through mutate_artifact, which validates
          // complete HTML before the transaction reaches this handler.
          editor.updateShape({
            id: shapeId,
            type: 'artifact',
            props: {
              title: mutation.text,
              ...(mutation.color ? { color: mutation.color } : {}),
            },
          });
        } else {
          editor.updateShape({
            id: shapeId,
            type: shape.type,
            props: {
              richText: toRichText(mutation.text),
              ...(mutation.color ? { color: mutation.color } : {}),
            },
          });
        }
      });
    },
    [editor]
  );

  // Dispatches solved SAP frame to canvas
  const handleSolvedAction = useCallback(
    (payload: SolvedActionPayload) => {
      if (editor && solvedActionHasCanvasWrites(payload)) {
        assertCanvasWritable(editor);
      }
      if (!firstTokenReceivedRef.current) {
        firstTokenReceivedRef.current = true;
        const firstTokenLatency = Number(
          (performance.now() - streamStartTimeRef.current).toFixed(2)
        );
        setState((prev) => ({
          ...prev,
          firstTokenLatencyMs: firstTokenLatency,
        }));
      }

      setState((prev) => ({
        ...prev,
        lastLatencyMs: payload.executionTimeMs,
        lastActionSummary: payload.actionSummary,
        streamedFramesCount: prev.streamedFramesCount + 1,
      }));

      // 1. Handle Speculative Skeleton
      if (payload.skeleton) {
        setState((prev) => ({
          ...prev,
          skeletons: [...prev.skeletons, payload.skeleton!],
        }));

        // Auto-dissolve skeleton after 30s if not already replaced
        const skelId = payload.skeleton.id;
        setTimeout(() => {
          setState((prev) => ({
            ...prev,
            skeletons: prev.skeletons.filter((s) => s.id !== skelId),
          }));
        }, 30000);
      }

      // 2. Handle Created Card
      if (payload.createdCard) {
        applyCreatedCard(payload.createdCard);
      }

      // 2b. Handle Rich Card (KaTeX / Markdown) or Mutated Rich Card
      if (payload.richCard) {
        applyRichCard(payload.richCard);
      }

      // 2c. Handle Code Viewer Card or Mutated Code Card
      if (payload.codeCard) {
        applyCodeCard(payload.codeCard);
      }

      // 3. Handle Sandbox Artifact or Mutated Artifact
      if (payload.artifact) {
        applyArtifact(payload.artifact);
      }

      // 3b. Handle Media Embed Player (YouTube / Web / Audio)
      if (payload.mediaEmbed) {
        applyMediaEmbed(payload.mediaEmbed);
      }

      // 3c. Handle Vector Shape & Architectural Glyph
      if (payload.vector) {
        applyVectorShape(payload.vector);
      }

      // 3d. Handle Longform Document (Notion grade)
      if (payload.document) {
        applyDocument(payload.document);
      }

      if (payload.deck) {
        applyDeck(payload.deck, payload.rawFrame);
      }

      // 4. Handle Constraint Coordinates & Spring Relaxation
      if (payload.nodes && payload.nodes.length > 0) {
        animateShapesToTargets(payload.nodes);
      }

      // 5. Handle Group Frame
      if (payload.group) {
        applyGroupFrame(payload.group);
      }

      // 6. Handle Connectors
      if (payload.connector) {
        applyConnector(payload.connector);
      }

      // 7. Handle In-Place Text Mutation
      if (payload.textMutation) {
        applyTextMutation(payload.textMutation);
      }

      // 8. Handle In-Place Restyle
      if (payload.restyle) {
        applyRestyle(payload.restyle);
      }

      if (payload.focusIds?.length && editor) {
        runEditorOperationSafely(editor, () => {
          editor.setSelectedShapes(
            payload.focusIds!.map((id) => normalizeId(id) as TLShapeId)
          );
          editor.zoomToSelection();
        });
      }
      // 9. Handle Deletions
      if (payload.deletedIds && payload.deletedIds.length > 0) {
        applyDelete(payload.deletedIds);
      }
    },
    [
      animateShapesToTargets,
      applyCreatedCard,
      applyRichCard,
      applyCodeCard,
      applyArtifact,
      applyMediaEmbed,
      applyVectorShape,
      applyGroupFrame,
      applyConnector,
      applyTextMutation,
      applyRestyle,
      applyDelete,
      applyDocument,
      applyDeck,
      editor,
    ]
  );

  const rebuildSpatialParentIndex = useCallback(() => {
    if (!editor) return;
    parentIdsRef.current.clear();
    childrenByParentRef.current.clear();
    for (const shape of editor.getCurrentPageShapes()) {
      const parentId = shape.parentId as string;
      parentIdsRef.current.set(shape.id as string, parentId);
      const children = childrenByParentRef.current.get(parentId) || new Set<string>();
      children.add(shape.id as string);
      childrenByParentRef.current.set(parentId, children);
    }
  }, [editor]);

  const collectSpatialDescendants = useCallback((rootId: string) => {
    const descendants = new Set<string>();
    const pending = [...(childrenByParentRef.current.get(rootId) || [])];
    while (pending.length) {
      const childId = pending.pop()!;
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      pending.push(...(childrenByParentRef.current.get(childId) || []));
    }
    return descendants;
  }, []);

  const replaceSpatialIndex = useCallback(() => {
    if (!workerRef.current || !editor) return;
    if (indexSyncTimerRef.current) clearTimeout(indexSyncTimerRef.current);
    indexSyncTimerRef.current = null;
    queuedIndexChangesRef.current.clear();
    indexOrderDirtyRef.current = false;

    const pageId = editor.getCurrentPageId() as string;
    const nodes = extractSpatialNodes();
    const shapes = editor.getCurrentPageShapesSorted();
    indexedNodesRef.current = new Map(nodes.map((node) => [node.id, node]));
    shapePropsRef.current = new Map(
      shapes.map((shape) => [shape.id as string, shape.props])
    );
    rebuildSpatialParentIndex();
    indexedPageIdRef.current = pageId;
    const storeVersion = editor.store.history.get();
    indexedStoreVersionRef.current = storeVersion;
    observedStoreVersionRef.current = storeVersion;
    const revision = ++indexRevisionRef.current;
    workerRef.current.postMessage({
      type: 'SYNC_INDEX',
      pageId,
      revision,
      nodes,
    } satisfies WorkerInMessage);
  }, [editor, extractSpatialNodes, rebuildSpatialParentIndex]);

  const isShapeOnCurrentPage = useCallback((shape: ReturnType<Editor['getShape']>) => {
    if (!editor || !shape) return false;
    let parentId = shape.parentId as string;
    const visited = new Set<string>();
    while (parentId.startsWith('shape:')) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      const parent = editor.getShape(parentId as TLShapeId);
      if (!parent) return false;
      parentId = parent.parentId as string;
    }
    return parentId === editor.getCurrentPageId();
  }, [editor]);

  const flushSpatialIndexChanges = useCallback(() => {
    if (!workerRef.current || !editor) return;
    if (indexedPageIdRef.current !== editor.getCurrentPageId()) {
      replaceSpatialIndex();
      return;
    }

    const changes = queuedIndexChangesRef.current;
    const orderDirty = indexOrderDirtyRef.current;
    if (!changes.size && !orderDirty) return;
    queuedIndexChangesRef.current = new Map();
    indexOrderDirtyRef.current = false;

    const nodes: Array<SpatialNodeItem | ReturnType<typeof spatialNodeGeometryPatch>> = [];
    const deletedIds = new Set<string>();
    if (orderDirty) {
      const currentShapes = editor.getCurrentPageShapesSorted();
      const currentIds = new Set(currentShapes.map((shape) => shape.id as string));
      for (const id of indexedNodesRef.current.keys()) {
        if (!currentIds.has(id)) deletedIds.add(id);
      }
      currentShapes.forEach((shape, zIndex) => {
        const id = shape.id as string;
        const previous = indexedNodesRef.current.get(id);
        const canReuseSource =
          previous &&
          previous.type === shape.type &&
          shapePropsRef.current.get(id) === shape.props;
        const node = serializeSpatialShape(
          editor,
          shape,
          zIndex,
          canReuseSource ? previous : undefined
        );
        if (node) {
          nodes.push(canReuseSource ? spatialNodeGeometryPatch(node) : node);
          indexedNodesRef.current.set(id, node);
        } else if (indexedNodesRef.current.delete(id)) {
          deletedIds.add(id);
        }
        shapePropsRef.current.set(id, shape.props);
      });
      for (const id of deletedIds) {
        indexedNodesRef.current.delete(id);
        shapePropsRef.current.delete(id);
      }
    } else {
      for (const [id, operation] of changes) {
        const shape = editor.getShape(id as TLShapeId);
        if (operation === 'delete' || !shape || !isShapeOnCurrentPage(shape)) {
          if (indexedNodesRef.current.delete(id)) deletedIds.add(id);
          shapePropsRef.current.delete(id);
          continue;
        }

        const previous = indexedNodesRef.current.get(id);
        const canReuseSource =
          previous &&
          previous.type === shape.type &&
          shapePropsRef.current.get(id) === shape.props;
        const node = serializeSpatialShape(
          editor,
          shape,
          previous?.zIndex ?? 0,
          canReuseSource ? previous : undefined
        );
        if (!node) {
          if (indexedNodesRef.current.delete(id)) deletedIds.add(id);
          shapePropsRef.current.delete(id);
          continue;
        }
        nodes.push(canReuseSource ? spatialNodeGeometryPatch(node) : node);
        indexedNodesRef.current.set(id, node);
        shapePropsRef.current.set(id, shape.props);
      }
    }

    const storeVersion = editor.store.history.get();
    if (!nodes.length && !deletedIds.size) {
      indexedStoreVersionRef.current = storeVersion;
      return;
    }
    const pageId = editor.getCurrentPageId() as string;
    const revision = ++indexRevisionRef.current;
    indexedStoreVersionRef.current = storeVersion;
    workerRef.current.postMessage({
      type: 'PATCH_INDEX',
      pageId,
      revision,
      nodes,
      deletedIds: [...deletedIds],
    } satisfies WorkerInMessage);
  }, [editor, isShapeOnCurrentPage, replaceSpatialIndex]);

  const scheduleSpatialIndexFlush = useCallback(() => {
    if (indexSyncTimerRef.current) clearTimeout(indexSyncTimerRef.current);
    indexSyncTimerRef.current = setTimeout(() => {
      indexSyncTimerRef.current = null;
      flushSpatialIndexChanges();
    }, 60);
  }, [flushSpatialIndexChanges]);

  // Explicit worker operations synchronously flush only pending shape deltas.
  const syncShapesWithWorker = useCallback(() => {
    if (!workerRef.current || !editor) return;
    if (indexSyncTimerRef.current) clearTimeout(indexSyncTimerRef.current);
    indexSyncTimerRef.current = null;
    if (observedStoreVersionRef.current < editor.store.history.get()) {
      // A store change has committed but its throttled listener has not run yet.
      // Snapshot now so an immediate operation cannot solve against stale source.
      replaceSpatialIndex();
      return;
    }
    flushSpatialIndexChanges();
  }, [editor, flushSpatialIndexChanges, replaceSpatialIndex]);

  // Initialize Worker
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const worker = new Worker(
      new URL('../workers/spatial.worker.ts', import.meta.url),
      {
        type: 'module',
      }
    );

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'INDEX_SYNCED':
          setState((prev) => ({
            ...prev,
            isWorkerReady: true,
            indexedCount: msg.count,
          }));
          break;

        case 'INDEX_PATCHED':
          setState((prev) => ({ ...prev, indexedCount: msg.count }));
          break;

        case 'INDEX_RESYNC_REQUIRED':
          if (editor && msg.pageId === editor.getCurrentPageId()) {
            replaceSpatialIndex();
          }
          break;

        case 'DAG_PLAN_SOLVED':
          setState((prev) => ({
            ...prev,
            skeletons: msg.skeletons,
            lastActionSummary: `DAG Plan: ${msg.plan.nodes.length} specialists dispatched (<150ms TTFT)`,
          }));
          break;

        case 'STREAM_ACTION_SOLVED':
          if (activeSessionIdRef.current !== msg.sessionId) {
            // A cancelled/replaced stream may have solved its last chunk
            // before the abort reached the worker. Ignore its output and reset
            // any speculative index changes it made.
            worker.postMessage({
              type: 'STREAM_ABORT',
              sessionId: msg.sessionId,
            } satisfies WorkerInMessage);
            replaceSpatialIndex();
            break;
          }
          if (
            !editor ||
            !streamPageSnapshotRef.current ||
            !matchesSpatialPageSnapshot(editor, streamPageSnapshotRef.current)
          ) {
            worker.postMessage({
              type: 'STREAM_ABORT',
              sessionId: msg.sessionId,
            } satisfies WorkerInMessage);
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            activeSessionIdRef.current = null;
            streamPageSnapshotRef.current = null;
            streamSourceNodesRef.current = [];
            if (editor) replaceSpatialIndex();
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              streamingAction: null,
              lastActionSummary: 'The canvas changed while the AI action was being prepared. Please retry.',
              skeletons: [],
            }));
            break;
          }
          let streamFrameMark: string | undefined;
          const streamRollbackStatus = { attempted: false, error: undefined as unknown };
          try {
            streamFrameMark = editor.markHistoryStoppingPoint(
              'ai_stream_frame_start'
            );
            if (msg.payload.rawFrame) {
              assertSpatialSourceContract(
                [msg.payload.rawFrame],
                streamSourceNodesRef.current,
                (id) => {
                  const shape = editor.getShape(normalizeId(id) as TLShapeId);
                  return shape
                    ? { type: shape.type, props: shape.props as Record<string, unknown> }
                    : undefined;
                }
              );
            }
            runEditorOperationSafely(
              editor,
              () => handleSolvedAction(msg.payload),
              streamFrameMark,
              streamRollbackStatus
            );
            if (msg.payload.rawFrame) {
              const changedIds = [
                msg.payload.rawFrame.id,
                msg.payload.rawFrame.target,
              ].filter((id): id is string => Boolean(id));
              if (changedIds.length) {
                const currentNodes = serializeCanvas(editor);
                for (const changedId of changedIds) {
                  const currentNode = currentNodes.find(
                    (node) => normalizeId(node.id) === normalizeId(changedId)
                  );
                  if (!currentNode) continue;
                  streamSourceNodesRef.current = [
                    ...streamSourceNodesRef.current.filter(
                      (node) => normalizeId(node.id) !== normalizeId(currentNode.id)
                    ),
                    currentNode,
                  ];
                }
              }
            }
            editor.markHistoryStoppingPoint('ai_stream_frame_end');
            streamPageSnapshotRef.current = captureSpatialPageSnapshot(editor);
          } catch (error) {
            let rollbackError = streamRollbackStatus.error;
            if (streamFrameMark && editor && !streamRollbackStatus.attempted) {
              try {
                editor.bailToMark(streamFrameMark);
              } catch (failure) {
                rollbackError = failure;
              }
            }
            worker.postMessage({
              type: 'STREAM_ABORT',
              sessionId: msg.sessionId,
            } satisfies WorkerInMessage);
            activeSessionIdRef.current = null;
            streamPageSnapshotRef.current = null;
            streamSourceNodesRef.current = [];
            replaceSpatialIndex();
            const applyMessage =
              error instanceof Error ? error.message : String(error);
            const rollbackMessage = rollbackError
              ? ` Automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. The canvas may contain partial changes; inspect it before retrying.`
              : streamFrameMark
                ? ' The streamed change was rolled back.'
                : ' No rollback checkpoint was available; inspect the canvas for partial changes.';
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              streamingAction: null,
              lastActionSummary: `Could not apply the canvas change: ${applyMessage}.${rollbackMessage}`,
              skeletons: [],
            }));
          }
          break;

        case 'STREAM_COMPLETE':
          if (activeSessionIdRef.current !== msg.sessionId) break;
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            totalStreamTimeMs: msg.totalDurationMs,
            lastActionSummary: `Stream complete: ${msg.totalFrames} actions resolved in ${msg.totalDurationMs}ms`,
            skeletons: [], // clear remaining skeletons
          }));
          activeSessionIdRef.current = null;
          streamPageSnapshotRef.current = null;
          streamSourceNodesRef.current = [];
          break;

        case 'STREAM_ERROR':
          if (activeSessionIdRef.current !== msg.sessionId) break;
          console.error('[Worker Stream Error] Stream processing failed.');
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            lastActionSummary: `Stream Error: ${msg.error}`,
            skeletons: [],
          }));
          activeSessionIdRef.current = null;
          streamPageSnapshotRef.current = null;
          streamSourceNodesRef.current = [];
          break;

        case 'LAYOUT_SOLVED': {
          const pending = msg.requestId
            ? pendingRef.current.get(msg.requestId)
            : undefined;
          const directSnapshot = msg.requestId
            ? directLayoutSnapshotsRef.current.get(msg.requestId)
            : undefined;
          if (msg.requestId && !pending && !directSnapshot) {
            // An aborted or timed-out request can still finish in the worker.
            // Its result is intentionally ignored, so discard its speculative
            // worker-side state as well.
            replaceSpatialIndex();
            break;
          }
          if (pending && editor) {
            try {
              assertSpatialPageSnapshotCurrent(editor, pending.snapshot);
            } catch (error) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId!);
              // The worker has already solved this batch and advanced its
              // private spatial index. The rejected result must not remain as
              // the basis for a later action.
              replaceSpatialIndex();
              pending.reject(
                error instanceof Error ? error : new Error(String(error))
              );
              return;
            }
          }
          if (directSnapshot && editor) {
            directLayoutSnapshotsRef.current.delete(msg.requestId!);
            try {
              assertSpatialPageSnapshotCurrent(editor, directSnapshot);
            } catch (error) {
              // Direct layout solvers can update their private index too.
              replaceSpatialIndex();
              setState((prev) => ({
                ...prev,
                lastActionSummary: `${error instanceof Error ? error.message : String(error)} The layout was not applied.`,
              }));
              return;
            }
          }
          let mark: string | undefined;
          const batchRollbackStatus = { attempted: false, error: undefined as unknown };
          try {
            if (editor && msg.result.actions) {
              assertSpatialActionsWritable(
                editor,
                msg.result.actions.map((action) => action.rawFrame)
              );
            } else if (editor && solvedLayoutHasCanvasWrites(msg.result)) {
              assertCanvasWritable(editor);
            }
            mark = editor?.markHistoryStoppingPoint('ai_batch_start');
            // Source drafts live outside tldraw's store, so the page snapshot
            // cannot detect a draft that started while the worker was solving.
            // Recheck the captured source and draft state at the final write
            // boundary, before any action in this batch is applied.
            pending?.validateBeforeApply();
            console.log(
              `[LAYOUT_SOLVED] 📦 Received: richCards=${msg.result.richCards?.length || 0} createdCards=${msg.result.createdCards?.length || 0} codeCards=${msg.result.codeCards?.length || 0} mediaEmbeds=${msg.result.mediaEmbeds?.length || 0} vectors=${msg.result.vectors?.length || 0} groups=${msg.result.groups?.length || 0} connectors=${msg.result.connectors?.length || 0}`
            );
            setState((prev) => ({
              ...prev,
              lastLatencyMs: msg.result.executionTimeMs,
              lastActionSummary: msg.result.actionSummary,
            }));
            if (msg.result.skeletons) {
              setState((prev) => ({
                ...prev,
                skeletons: [...prev.skeletons, ...(msg.result.skeletons || [])],
              }));
            }

            if (msg.result.actions) {
              runEditorOperationSafely(
                editor,
                () => {
                  for (const payload of msg.result.actions!)
                    handleSolvedAction(payload);
                },
                mark,
                batchRollbackStatus
              );
              editor?.markHistoryStoppingPoint('ai_batch_end');
              if (pending) {
                clearTimeout(pending.timer);
                pendingRef.current.delete(msg.requestId!);
                pending.resolve();
              }
              break;
            }
            runEditorOperationSafely(editor, () => {
            const allCreatedIds: TLShapeId[] = [];

            // Single-tick Atomic History transaction

            if (msg.result.createdCards) {
              msg.result.createdCards.forEach(applyCreatedCard);
              allCreatedIds.push(
                ...msg.result.createdCards.map(
                  (c) =>
                    (c.id.startsWith('shape:')
                      ? c.id
                      : `shape:${c.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.richCards) {
              msg.result.richCards.forEach(applyRichCard);
              allCreatedIds.push(
                ...msg.result.richCards.map(
                  (c) =>
                    (c.id.startsWith('shape:')
                      ? c.id
                      : `shape:${c.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.codeCards) {
              msg.result.codeCards.forEach(applyCodeCard);
              allCreatedIds.push(
                ...msg.result.codeCards.map(
                  (c) =>
                    (c.id.startsWith('shape:')
                      ? c.id
                      : `shape:${c.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.artifacts) {
              msg.result.artifacts.forEach(applyArtifact);
              allCreatedIds.push(
                ...msg.result.artifacts.map(
                  (c) =>
                    (c.id.startsWith('shape:')
                      ? c.id
                      : `shape:${c.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.mediaEmbeds) {
              msg.result.mediaEmbeds.forEach(applyMediaEmbed);
              allCreatedIds.push(
                ...msg.result.mediaEmbeds.map(
                  (m) =>
                    (m.id.startsWith('shape:')
                      ? m.id
                      : `shape:${m.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.vectors) {
              msg.result.vectors.forEach(applyVectorShape);
              allCreatedIds.push(
                ...msg.result.vectors.map(
                  (v) =>
                    (v.id.startsWith('shape:')
                      ? v.id
                      : `shape:${v.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.documents) {
              msg.result.documents.forEach(applyDocument);
              allCreatedIds.push(
                ...msg.result.documents.map(
                  (d) =>
                    (d.id.startsWith('shape:')
                      ? d.id
                      : `shape:${d.id}`) as TLShapeId
                )
              );
            }
            if (msg.result.decks) {
              msg.result.decks.forEach((deck) => {
                const id = normalizeId(deck.id) as TLShapeId;
                const existing = editor?.getShape(id);
                const rawFrame: SpatialActionFrame = existing
                  ? {
                      t: 'patch', op: 'mutate_slide_deck', target: deck.id,
                      title: deck.title, subtitle: deck.subtitle, theme: deck.theme,
                      currentSlideIndex: deck.currentSlideIndex, slides: deck.slides,
                    }
                  : {
                      t: 'patch', op: 'create_slide_deck', id: deck.id,
                      title: deck.title, subtitle: deck.subtitle, theme: deck.theme,
                      currentSlideIndex: deck.currentSlideIndex, slides: deck.slides,
                    };
                applyDeck(deck, rawFrame);
                allCreatedIds.push(id);
              });
            }
            if (msg.result.nodes.length > 0) {
              animateShapesToTargets(msg.result.nodes);
            }
            if (msg.result.groups) {
              msg.result.groups.forEach(applyGroupFrame);
            }
            if (msg.result.connectors) {
              msg.result.connectors.forEach(applyConnector);
            }
            if (msg.result.textMutations) {
              msg.result.textMutations.forEach(applyTextMutation);
            }

            msg.result.restyles?.forEach(applyRestyle);
            if (msg.result.deletedIds?.length)
              applyDelete(msg.result.deletedIds);
            if (editor && msg.result.focusIds?.length) {
              const ids = msg.result.focusIds
                .map((id) => normalizeId(id) as TLShapeId)
                .filter((id) => editor.getShape(id));
              editor.setSelectedShapes(ids);
              if (ids.length) editor.zoomToSelection();
            }
            }, mark, batchRollbackStatus);
            if (editor) editor.markHistoryStoppingPoint('ai_batch_end');
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId!);
              pending.resolve();
            }
          } catch (error) {
            let rollbackError = batchRollbackStatus.error;
            if (mark && editor && !batchRollbackStatus.attempted) {
              try {
                editor.bailToMark(mark);
              } catch (rollbackFailure) {
                rollbackError = rollbackFailure;
              }
            }
            // Solving updates the worker index before the host applies the
            // result. Rebuild from the post-rollback editor even when rollback
            // itself failed, so future actions reflect the actual canvas.
            replaceSpatialIndex();
            const applyMessage =
              error instanceof Error ? error.message : String(error);
            const rollbackMessage = rollbackError
              ? ` Automatic rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. The canvas may contain partial changes; inspect it before retrying.`
              : mark && editor
                ? ' The batch was rolled back.'
                : editor
                  ? ' No rollback checkpoint was available; inspect the canvas for partial changes.'
                  : '';
            setState((prev) => ({
              ...prev,
              lastActionSummary: `Could not apply the canvas change: ${applyMessage}.${rollbackMessage}`,
              skeletons: [],
            }));
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId!);
              pending.reject(
                error instanceof Error ? error : new Error(String(error))
              );
            } else console.error('[SpatialWorker apply] Canvas action failed.');
          }

          break;
        }

        case 'VIEWPORT_CULLED':
          setState((prev) => ({
            ...prev,
            culledContext: msg.payload,
            lastActionSummary: `Culled context: ${msg.payload.totalTokenEstimate} tokens estimated`,
          }));
          break;

        case 'ERROR':
          if (msg.requestId) {
            directLayoutSnapshotsRef.current.delete(msg.requestId);
            const pending = pendingRef.current.get(msg.requestId);
            // Solvers can fail after mutating worker-local state. Restore the
            // live editor snapshot before another operation is allowed through.
            replaceSpatialIndex();
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId);
              pending.reject(new Error(msg.error));
            }
          }
          console.error('[SpatialWorker Error] Spatial calculation failed.');
          break;
      }
    };

    worker.onerror = () => {
      directLayoutSnapshotsRef.current.clear();
      for (const p of pendingRef.current.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Canvas engine failed. Reload to recover.'));
      }
      pendingRef.current.clear();
      setState((p) => ({
        ...p,
        isWorkerReady: false,
        lastActionSummary: 'Canvas engine failed. Reload to recover.',
      }));
    };
    workerRef.current = worker;
    setState((prev) => ({ ...prev, isWorkerReady: true }));

    return () => {
      for (const p of pendingRef.current.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Canvas engine stopped.'));
      }
      pendingRef.current.clear();
      directLayoutSnapshotsRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    animateShapesToTargets,
    replaceSpatialIndex,
    applyCreatedCard,
    applyArtifact,
    applyGroupFrame,
    applyConnector,
    applyTextMutation,
    handleSolvedAction,
  ]);

  // Keep spatial index warm on store updates
  useEffect(() => {
    if (!editor) return;

    const queueShape = (id: string, operation: 'upsert' | 'delete') => {
      queuedIndexChangesRef.current.set(id, operation);
    };
    const queueSubtree = (id: string) => {
      for (const descendantId of collectSpatialDescendants(id)) {
        queueShape(descendantId, 'upsert');
      }
    };
    const queueBindingArrow = (binding: any) => {
      if (binding?.typeName !== 'binding' || typeof binding.fromId !== 'string') return;
      const arrow = editor.getShape(binding.fromId as TLShapeId);
      if (isShapeOnCurrentPage(arrow)) queueShape(binding.fromId, 'upsert');
    };
    const pageIdOfShapeRecord = (record: any) => {
      let parentId = record.parentId as string;
      const visited = new Set<string>();
      while (parentId?.startsWith('shape:')) {
        if (visited.has(parentId)) return null;
        visited.add(parentId);
        const parent = editor.getShape(parentId as TLShapeId);
        if (!parent) return null;
        parentId = parent.parentId as string;
      }
      return parentId;
    };

    const unsubscribe = editor.store.listen((entry) => {
      const storeVersion = editor.store.history.get();
      if (storeVersion <= indexedStoreVersionRef.current) {
        observedStoreVersionRef.current = storeVersion;
        return;
      }
      const pageId = editor.getCurrentPageId() as string;
      if (indexedPageIdRef.current !== pageId) {
        scheduleSpatialIndexFlush();
        observedStoreVersionRef.current = storeVersion;
        return;
      }

      const { added, updated, removed } = entry.changes;
      let hasRelevantChange = false;
      let topologyChanged = false;

      for (const record of Object.values(added)) {
        if (record.typeName === 'shape' && pageIdOfShapeRecord(record) === pageId) {
          const id = record.id as string;
          queueShape(id, 'upsert');
          topologyChanged = true;
          hasRelevantChange = true;
        } else if (record.typeName === 'binding') {
          queueBindingArrow(record);
          hasRelevantChange ||= queuedIndexChangesRef.current.has(record.fromId as string);
        }
      }

      for (const [before, after] of Object.values(updated)) {
        if (before.typeName === 'shape' && after.typeName === 'shape') {
          const id = after.id as string;
          const wasOnPage =
            indexedNodesRef.current.has(id) || pageIdOfShapeRecord(before) === pageId;
          const isOnPage = pageIdOfShapeRecord(after) === pageId;
          if (!wasOnPage && !isOnPage) continue;

          queueSubtree(id);
          queueShape(id, isOnPage ? 'upsert' : 'delete');
          hasRelevantChange = true;
          if (
            wasOnPage !== isOnPage ||
            before.parentId !== after.parentId ||
            before.index !== after.index
          ) {
            topologyChanged = true;
          }
        } else if (before.typeName === 'binding' || after.typeName === 'binding') {
          queueBindingArrow(before);
          queueBindingArrow(after);
          hasRelevantChange ||=
            queuedIndexChangesRef.current.has((before as any).fromId) ||
            queuedIndexChangesRef.current.has((after as any).fromId);
        }
      }

      for (const record of Object.values(removed)) {
        if (
          record.typeName === 'shape' &&
          (indexedNodesRef.current.has(record.id as string) ||
            pageIdOfShapeRecord(record) === pageId)
        ) {
          const id = record.id as string;
          queueSubtree(id);
          queueShape(id, 'delete');
          topologyChanged = true;
          hasRelevantChange = true;
        } else if (record.typeName === 'binding') {
          queueBindingArrow(record);
          hasRelevantChange ||= queuedIndexChangesRef.current.has(record.fromId as string);
        }
      }

      if (!hasRelevantChange) {
        observedStoreVersionRef.current = storeVersion;
        return;
      }
      if (topologyChanged) {
        indexOrderDirtyRef.current = true;
        rebuildSpatialParentIndex();
      }
      observedStoreVersionRef.current = storeVersion;
      scheduleSpatialIndexFlush();
    });

    // Initial page snapshot; subsequent selection/session changes are ignored.
    replaceSpatialIndex();

    return () => {
      unsubscribe();
      if (indexSyncTimerRef.current) clearTimeout(indexSyncTimerRef.current);
      indexSyncTimerRef.current = null;
    };
  }, [
    editor,
    collectSpatialDescendants,
    isShapeOnCurrentPage,
    rebuildSpatialParentIndex,
    replaceSpatialIndex,
    scheduleSpatialIndexFlush,
  ]);

  // Generates culled context payload synchronously for immediate streaming
  const getCulledContextSync = useCallback((): CulledContextPayload => {
    if (!editor) {
      return {
        selectedNodes: [],
        viewportNeighbors: [],
        macroClusters: [],
        totalTokenEstimate: 0,
      };
    }

    const selectedIds = new Set(editor.getSelectedShapeIds());
    const vp = editor.getViewportPageBounds();
    const allNodes = extractSpatialNodes();

    const selectedNodes = allNodes.filter((n) =>
      selectedIds.has(n.id as TLShapeId)
    );
    let viewportNeighbors = allNodes.filter(
      (n) =>
        !selectedIds.has(n.id as TLShapeId) &&
        n.maxX >= vp.minX &&
        n.minX <= vp.maxX &&
        n.maxY >= vp.minY &&
        n.minY <= vp.maxY
    );

    // If no shapes in immediate viewport and none selected, but shapes exist elsewhere on canvas,
    // fallback to including canvas shapes so AI always knows what exists on the board
    if (
      viewportNeighbors.length === 0 &&
      selectedNodes.length === 0 &&
      allNodes.length > 0
    ) {
      viewportNeighbors = allNodes.slice(0, 25);
    }

    viewportNeighbors.sort(
      (a, b) =>
        Math.hypot(a.minX - vp.center.x, a.minY - vp.center.y) -
        Math.hypot(b.minX - vp.center.x, b.minY - vp.center.y)
    );
    viewportNeighbors = viewportNeighbors.slice(0, 20);
    const totalTokenEstimate =
      selectedNodes.length * 18 + viewportNeighbors.length * 12 + 20;

    return {
      selectedNodes,
      viewportNeighbors,
      macroClusters: [],
      boardIndex: compactBoard(allNodes),
      omittedCount: Math.max(0, allNodes.length - 300),
      totalTokenEstimate: Math.ceil(
        JSON.stringify({ selectedNodes, viewportNeighbors }).length / 4
      ),
    };
  }, [editor, extractSpatialNodes]);

  // Streams AI actions via Edge Relay and Worker NDJSON state machine
  const streamAIAction = useCallback(
    async (intent: AIIntentPreset, prompt?: string) => {
      if (!editor || !workerRef.current) return;
      if (editor.getIsReadonly()) {
        reportReadonlyWrite();
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const sessionId = `stream_${Date.now()}`;
      activeSessionIdRef.current = sessionId;
      streamPageSnapshotRef.current = captureSpatialPageSnapshot(editor);
      streamStartTimeRef.current = performance.now();
      firstTokenReceivedRef.current = false;

      setState((prev) => ({
        ...prev,
        isStreaming: true,
        streamingAction: intent,
        firstTokenLatencyMs: null,
        totalStreamTimeMs: null,
        streamedFramesCount: 0,
        lastActionSummary: `Streaming SAP protocol (${intent})...`,
      }));

      const screenCenter = editor.getViewportScreenCenter();
      const pageCenter = editor.screenToPage(screenCenter);

      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'STREAM_START',
        sessionId,
        viewportCenter: pageCenter,
      } satisfies WorkerInMessage);

      const culledContext = getCulledContextSync();
      streamSourceNodesRef.current = culledContext.selectedNodes;

      const requestPayload: AISpatialStreamRequest = {
        intent,
        prompt,
        culledContext,
        viewportCenter: pageCenter,
      };

      try {
        const response = await fetch('/api/ai/spatial-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (workerRef.current && activeSessionIdRef.current === sessionId) {
            workerRef.current.postMessage({
              type: 'STREAM_CHUNK',
              sessionId,
              chunk,
            } satisfies WorkerInMessage);
          }
        }

        if (workerRef.current && activeSessionIdRef.current === sessionId) {
          workerRef.current.postMessage({
            type: 'STREAM_END',
            sessionId,
          } satisfies WorkerInMessage);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') {
          if (workerRef.current) {
            workerRef.current.postMessage({
              type: 'STREAM_ABORT',
              sessionId,
            } satisfies WorkerInMessage);
          }
          streamPageSnapshotRef.current = null;
          streamSourceNodesRef.current = [];
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            lastActionSummary: prev.lastActionSummary.startsWith('The canvas changed')
              ? prev.lastActionSummary
              : 'Stream cancelled',
            skeletons: [],
          }));
        } else {
          streamPageSnapshotRef.current = null;
          streamSourceNodesRef.current = [];
          console.error(
            '[AI Stream Error]',
            err instanceof Error ? err.name : 'unknown error'
          );
          const errorMsg = err instanceof Error ? err.message : String(err);
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            lastActionSummary: `Stream failed: ${errorMsg}`,
            skeletons: [],
          }));
        }
      }
    },
    [editor, syncShapesWithWorker, getCulledContextSync, reportReadonlyWrite]
  );

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeSessionIdRef.current = null;
    streamPageSnapshotRef.current = null;
    streamSourceNodesRef.current = [];
  }, []);

  // Spatial Action Dispatchers
  const alignNodes = useCallback(
    (direction: 'horizontal' | 'vertical' | 'grid', margin = 28) => {
      if (!workerRef.current || !editor) return;
      if (editor.getIsReadonly()) {
        reportReadonlyWrite();
        return;
      }
      const selectedIds = editor.getSelectedShapeIds();
      const allPageShapeIds = Array.from(editor.getCurrentPageShapeIds());
      const targetIds = selectedIds.length > 1 ? selectedIds : allPageShapeIds;

      if (targetIds.length < 2) return;

      const requestId = crypto.randomUUID();
      directLayoutSnapshotsRef.current.set(
        requestId,
        captureSpatialPageSnapshot(editor)
      );
      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'ALIGN_NODES',
        requestId,
        nodeIds: targetIds as string[],
        direction,
        margin,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker, reportReadonlyWrite]
  );

  const dockNode = useCallback(
    (
      targetId: string,
      anchorId: string,
      slot: 'top' | 'bottom' | 'left' | 'right' | 'center',
      margin = 24
    ) => {
      if (!workerRef.current || !editor) return;
      if (editor.getIsReadonly()) {
        reportReadonlyWrite();
        return;
      }
      const requestId = crypto.randomUUID();
      directLayoutSnapshotsRef.current.set(
        requestId,
        captureSpatialPageSnapshot(editor)
      );
      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'DOCK_NODE',
        requestId,
        targetId,
        groupOrAnchorId: anchorId,
        slot,
        margin,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker, reportReadonlyWrite]
  );

  const repelCollisions = useCallback(
    (anchorId?: string, margin = 40) => {
      if (!workerRef.current || !editor) return;
      if (editor.getIsReadonly()) {
        reportReadonlyWrite();
        return;
      }
      const targetAnchor = anchorId || editor.getOnlySelectedShape()?.id;
      if (!targetAnchor) return;

      const requestId = crypto.randomUUID();
      directLayoutSnapshotsRef.current.set(
        requestId,
        captureSpatialPageSnapshot(editor)
      );
      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'REPEL_COLLISIONS',
        requestId,
        anchorId: targetAnchor as string,
        margin,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker, reportReadonlyWrite]
  );

  const runSpatialActions = useCallback(
    async (
      actions: SpatialActionFrame[],
      sessionId?: string,
      signal?: AbortSignal,
      transmittedSources: SpatialNodeItem[] = []
    ) => {
      if (!workerRef.current || !editor)
        throw new Error('Canvas engine is not ready.');
      assertSpatialActionsWritable(editor, actions);
      signal?.throwIfAborted();
      actions.forEach(validateAction);
      const validateBeforeApply = () => {
        assertSpatialActionsWritable(editor, actions);
        assertSpatialSourceContract(actions, transmittedSources, (id) => {
          const shape = editor.getShape(normalizeId(id) as TLShapeId);
          return shape
            ? { type: shape.type, props: shape.props as Record<string, unknown> }
            : undefined;
        });
      };
      validateBeforeApply();
      const known = new Set(
        editor.getCurrentPageShapes().map((s) => s.id as string)
      );
      const initiallyKnown = new Set(known);
      const batchCreated = new Set<string>();
      const knownTypes = new Map(
        editor
          .getCurrentPageShapes()
          .map((s) => [s.id as string, s.type as string])
      );
      for (const f of actions) {
        const references = [
          f.target,
          f.from,
          f.to,
          f.anchor,
          f.group,
          ...(f.nodeIds || []),
          ...(f.op.startsWith('mutate_') && !f.target && f.id ? [f.id] : []),
        ].filter(Boolean) as string[];
        const relativeAnchor = f.relative?.match(
          /^(?:right_of|below|left_of|above|next_to):(.+)$/
        )?.[1];
        if (relativeAnchor && relativeAnchor !== 'selection')
          references.push(relativeAnchor);

        for (const id of new Set(references.map(normalizeId))) {
          const normalized = normalizeId(id);
          if (!known.has(normalized))
            throw new Error(
              `Canvas target ${id} no longer exists. Select a target and retry.`
            );
        }

        let writeIds: string[] = [];
        if (f.op === 'align') writeIds = f.nodeIds || [];
        else if (f.op === 'create_group') writeIds = f.nodeIds || [];
        else if (f.op === 'dock_into' && f.target) writeIds = [f.target];
        else if (f.op === 'delete_shape') writeIds = f.nodeIds || [];
        else if (
          [
            'mutate_artifact',
            'mutate_document',
            'mutate_slide_deck',
            'mutate_rich_card',
            'mutate_code_card',
            'mutate_media',
            'mutate_vector',
            'mutate_text',
            'restyle_shape',
            'move_shape',
            'resize_shape',
            'stream_card_patch',
          ].includes(f.op)
        ) {
          const target = f.target || f.id;
          if (target) writeIds = [target];
        }
        for (const id of writeIds) {
          const shape = editor.getShape(normalizeId(id) as TLShapeId);
          if (isCanvasShapeLocked(editor, shape))
            throw new Error('Unlock the target before asking AI to change it.');
        }

        const expected = (
          {
            mutate_artifact: 'artifact',
            mutate_document: 'document',
            mutate_slide_deck: 'slide_deck',
            mutate_rich_card: 'rich_card',
            mutate_code_card: 'code_card',
            mutate_media: 'media_embed',
            mutate_vector: 'vector_shape',
          } as Record<string, string>
        )[f.op];
        if (expected && knownTypes.get(normalizeId(f.target!)) !== expected)
          throw new Error('Action targets the wrong shape type.');
        if (f.target) f.target = normalizeId(f.target);
        if (f.nodeIds) f.nodeIds = f.nodeIds.map(normalizeId);
        if (f.from) f.from = normalizeId(f.from);
        if (f.to) f.to = normalizeId(f.to);
        if (f.id) f.id = normalizeId(f.id);
        if (f.op === 'delete_shape')
          f.nodeIds?.forEach((id) => known.delete(normalizeId(id)));
        if (
          f.id &&
          !f.op.startsWith('mutate_') &&
          f.op !== 'speculative_skeleton'
        ) {
          const newId = normalizeId(f.id);
          if (initiallyKnown.has(newId) || batchCreated.has(newId))
            throw new Error('Creation would overwrite an existing shape.');
          batchCreated.add(newId);
          known.add(newId);
          const type = (
            {
              spawn_artifact: 'artifact',
              create_rich_card: 'rich_card',
              create_code_card: 'code_card',
              create_document: 'document',
              create_slide_deck: 'slide_deck',
              embed_media: 'media_embed',
              draw_vector: 'vector_shape',
              create_group: 'frame',
              create_card: f.shapeType || 'geo',
            } as Record<string, string>
          )[f.op];
          if (type) knownTypes.set(normalizeId(f.id), type);
        }
      }
      const pageSnapshot = captureSpatialPageSnapshot(editor);
      const requestId = crypto.randomUUID();
      const pageCenter = editor.getViewportPageBounds().center;
      syncShapesWithWorker();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRef.current
            .get(requestId)
            ?.reject(new Error('Canvas action timed out. Retry.'));
          pendingRef.current.delete(requestId);
        }, 15000);
        const onAbort = () => {
          clearTimeout(timer);
          pendingRef.current.delete(requestId);
          reject(new DOMException('Stopped', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        pendingRef.current.set(requestId, {
          resolve: () => {
            cleanup();
            resolve();
          },
          reject: (e) => {
            cleanup();
            reject(e);
          },
          timer,
          snapshot: pageSnapshot,
          validateBeforeApply,
        });
        workerRef.current!.postMessage({
          type: 'RUN_ACTIONS',
          actions,
          viewportCenter: pageCenter,
          sessionId: sessionId || requestId,
          requestId,
        } satisfies WorkerInMessage);
      });
    },
    [editor, syncShapesWithWorker]
  );

  const solveDAGPlan = useCallback(
    (plan: DAGExecutionPlan, sessionId?: string) => {
      if (!workerRef.current || !editor) return;
      const screenCenter = editor.getViewportScreenCenter();
      const pageCenter = editor.screenToPage(screenCenter);

      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'SOLVE_DAG_PLAN',
        plan,
        viewportCenter: pageCenter,
        sessionId,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker]
  );

  const queryViewport = useCallback(() => {
    if (!workerRef.current || !editor) return;
    const vp = editor.getViewportPageBounds();
    const selectedIds = editor.getSelectedShapeIds() as string[];

    const viewportQuery: ViewportQuery = {
      minX: vp.minX,
      minY: vp.minY,
      maxX: vp.maxX,
      maxY: vp.maxY,
    };

    syncShapesWithWorker();
    workerRef.current.postMessage({
      type: 'QUERY_VIEWPORT',
      viewport: viewportQuery,
      selectedIds,
    } satisfies WorkerInMessage);
  }, [editor, syncShapesWithWorker]);

  const addSkeleton = useCallback((skeleton: SpeculativeSkeletonBounds) => {
    setState((prev) => ({
      ...prev,
      skeletons: [
        ...prev.skeletons.filter((s) => s.id !== skeleton.id),
        skeleton,
      ],
    }));
  }, []);

  const clearSkeletons = useCallback((id?: string) => {
    setState((prev) => ({
      ...prev,
      skeletons: id ? prev.skeletons.filter((s) => s.id !== id) : [],
    }));
  }, []);

  return {
    ...state,
    alignNodes,
    dockNode,
    repelCollisions,
    runSpatialActions,
    solveDAGPlan,
    applyRichCard,
    applyCodeCard,
    patchRichCardContent,
    queryViewport,
    syncShapesWithWorker,
    streamAIAction,
    cancelStream,
    getCulledContextSync,
    addSkeleton,
    clearSkeletons,
  };
}
