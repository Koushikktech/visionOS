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
  DAGExecutionPlan,
  CardArchetype,
  SolvedArtifactItem,
  SolvedRestyle,
  SolvedActionPayload,
  SpeculativeSkeletonBounds,
  ViewportQuery,
  AIIntentPreset,
  AISpatialStreamRequest,
} from '../types/spatial';
import { serializeCanvas, compactBoard } from '../lib/spatialContext';
import { validateAction, shapeId as normalizeId } from '../lib/ai/actions';
import { extractShapeSemanticText } from '../lib/spatialVision';

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
        originals: Map<string, string>;
      }
    >()
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const streamStartTimeRef = useRef<number>(0);
  const firstTokenReceivedRef = useRef<boolean>(false);

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

  // Extract spatial nodes from tldraw editor
  const extractSpatialNodes = useCallback((): SpatialNodeItem[] => {
    if (!editor) return [];
    return serializeCanvas(editor);
  }, [editor]);

  // Spring animation runner for smooth 60 FPS transitions
  const animateShapesToTargets = useCallback(
    (solvedNodes: SolvedNodeCoordinate[]) => {
      if (!editor || solvedNodes.length === 0) return;

      // Commit once: animated document writes polluted undo and raced manual drags.
      editor.updateShapes(
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
      );
    },
    [editor]
  );

  // Creates or updates a card on canvas
  const applyCreatedCard = useCallback(
    (card: SolvedCreatedCard) => {
      if (!editor) return;
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;

      editor.run(() => {
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
        console.error(
          '[applyRichCard] ❌ editor is null, card:',
          card.id,
          card.title
        );
        return;
      }
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;
      console.log(
        `[applyRichCard] 🎯 Applying card "${card.title}" id=${shapeId} at (${card.x}, ${card.y}) size=${card.w}x${card.h}`
      );

      try {
        editor.run(() => {
          const existing = editor.getShape(shapeId);
          if (existing) {
            console.log(
              `[applyRichCard] ♻️ Updating existing shape ${shapeId}`
            );
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
            console.log(`[applyRichCard] ✨ Creating NEW shape ${shapeId}`);
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

        // Verify shape actually exists after creation
        const verifyShape = editor.getShape(shapeId);
        console.log(
          `[applyRichCard] ✅ Post-create verify: shape exists = ${!!verifyShape}, id = ${shapeId}`
        );
      } catch (err) {
        console.error(
          `[applyRichCard] 💥 Error creating shape ${shapeId}:`,
          err
        );
      }

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
      if (!editor) return;
      const shapeId = (
        card.id.startsWith('shape:') ? card.id : `shape:${card.id}`
      ) as TLShapeId;

      editor.run(() => {
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
      if (!editor) return;
      const shapeId = (
        artifact.id.startsWith('shape:') ? artifact.id : `shape:${artifact.id}`
      ) as TLShapeId;

      editor.run(() => {
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
      if (!editor) return;
      const shapeId = (
        media.id.startsWith('shape:') ? media.id : `shape:${media.id}`
      ) as TLShapeId;

      editor.run(() => {
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
      if (!editor) return;
      const shapeId = (
        vector.id.startsWith('shape:') ? vector.id : `shape:${vector.id}`
      ) as TLShapeId;

      editor.run(() => {
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
      if (!editor) return;
      const shapeId = (
        doc.id.startsWith('shape:') ? doc.id : `shape:${doc.id}`
      ) as TLShapeId;

      editor.run(() => {
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

  // Creates or updates a group container visual bounding frame
  const applyGroupFrame = useCallback(
    (group: SolvedGroupItem) => {
      if (!editor) return;

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

        editor.run(() => {
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
      if (!editor) return;

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

        if (!fromShape || !toShape) return false;

        const fromBounds = editor.getShapePageBounds(fromShapeId);
        const toBounds = editor.getShapePageBounds(toShapeId);

        if (!fromBounds || !toBounds) return false;

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

        editor.run(() => {
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
      if (!editor) return;
      const shapeId = (
        restyle.id.startsWith('shape:') ? restyle.id : `shape:${restyle.id}`
      ) as TLShapeId;
      const shape = editor.getShape(shapeId);
      if (!shape) return;

      if (restyle.color && !('color' in shape.props))
        throw new Error('This shape does not support a color style.');
      editor.run(() => {
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
      if (!editor || ids.length === 0) return;
      const shapeIds = ids.map(
        (id) => (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId
      );
      editor.deleteShapes(shapeIds);
    },
    [editor]
  );

  // Updates shape text / markdown content in-place
  const applyTextMutation = useCallback(
    (mutation: SolvedTextMutation) => {
      if (!editor) return;
      const shapeId = (
        mutation.id.startsWith('shape:') ? mutation.id : `shape:${mutation.id}`
      ) as TLShapeId;
      const shape = editor.getShape(shapeId);
      if (!shape) return;

      editor.run(() => {
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
          // If mutation text contains html/canvas/script, update code, else update title
          const isCode =
            mutation.text.includes('<canvas') ||
            mutation.text.includes('<script') ||
            mutation.text.includes('function') ||
            mutation.text.includes('const ');
          editor.updateShape({
            id: shapeId,
            type: 'artifact',
            props: {
              ...(isCode ? { code: mutation.text } : { title: mutation.text }),
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
        editor.setSelectedShapes(
          payload.focusIds.map((id) => normalizeId(id) as TLShapeId)
        );
        editor.zoomToSelection();
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
      editor,
    ]
  );

  // Sync editor shapes with Worker R-Tree index
  const syncShapesWithWorker = useCallback(() => {
    if (!workerRef.current || !editor) return;
    const nodes = extractSpatialNodes();
    workerRef.current.postMessage({
      type: 'SYNC_INDEX',
      nodes,
    } satisfies WorkerInMessage);
  }, [editor, extractSpatialNodes]);

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

        case 'DAG_PLAN_SOLVED':
          setState((prev) => ({
            ...prev,
            skeletons: msg.skeletons,
            lastActionSummary: `DAG Plan: ${msg.plan.nodes.length} specialists dispatched (<150ms TTFT)`,
          }));
          break;

        case 'STREAM_ACTION_SOLVED':
          handleSolvedAction(msg.payload);
          break;

        case 'STREAM_COMPLETE':
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            totalStreamTimeMs: msg.totalDurationMs,
            lastActionSummary: `Stream complete: ${msg.totalFrames} actions resolved in ${msg.totalDurationMs}ms`,
            skeletons: [], // clear remaining skeletons
          }));
          activeSessionIdRef.current = null;
          break;

        case 'STREAM_ERROR':
          console.error('[Worker Stream Error]', msg.error);
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            lastActionSummary: `Stream Error: ${msg.error}`,
            skeletons: [],
          }));
          activeSessionIdRef.current = null;
          break;

        case 'LAYOUT_SOLVED': {
          const pending = msg.requestId
            ? pendingRef.current.get(msg.requestId)
            : undefined;
          if (msg.requestId && !pending) break; // cancelled or timed-out request
          if (pending && editor) {
            for (const [id, original] of pending.originals) {
              if (
                JSON.stringify(editor.getShape(id as TLShapeId)) !== original
              ) {
                clearTimeout(pending.timer);
                pendingRef.current.delete(msg.requestId!);
                pending.reject(
                  new Error(
                    'Canvas changed while applying the action. Please retry.'
                  )
                );
                return;
              }
            }
          }
          const mark = editor?.markHistoryStoppingPoint('ai_batch_start');
          try {
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
              for (const payload of msg.result.actions)
                handleSolvedAction(payload);
              editor?.markHistoryStoppingPoint('ai_batch_end');
              if (pending) {
                clearTimeout(pending.timer);
                pendingRef.current.delete(msg.requestId!);
                pending.resolve();
              }
              break;
            }
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
            if (editor) editor.markHistoryStoppingPoint('ai_batch_end');
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId!);
              pending.resolve();
            }
          } catch (error) {
            if (mark && editor) editor.bailToMark(mark);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId!);
              pending.reject(
                error instanceof Error ? error : new Error(String(error))
              );
            } else console.error('[SpatialWorker apply]', error);
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
            const pending = pendingRef.current.get(msg.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingRef.current.delete(msg.requestId);
              pending.reject(new Error(msg.error));
            }
          }
          console.error('[SpatialWorker Error]', msg.error);
          break;
      }
    };

    worker.onerror = () => {
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
      worker.terminate();
      workerRef.current = null;
    };
  }, [
    animateShapesToTargets,
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

    let timeoutId: NodeJS.Timeout;
    const unsubscribe = editor.store.listen(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        syncShapesWithWorker();
      }, 60);
    });

    syncShapesWithWorker();

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [editor, syncShapesWithWorker]);

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

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const sessionId = `stream_${Date.now()}`;
      activeSessionIdRef.current = sessionId;
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
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            streamingAction: null,
            lastActionSummary: 'Stream cancelled',
            skeletons: [],
          }));
        } else {
          console.error('[AI Stream Error]', err);
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
    [editor, syncShapesWithWorker, getCulledContextSync]
  );

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Spatial Action Dispatchers
  const alignNodes = useCallback(
    (direction: 'horizontal' | 'vertical' | 'grid', margin = 28) => {
      if (!workerRef.current || !editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      const allPageShapeIds = Array.from(editor.getCurrentPageShapeIds());
      const targetIds = selectedIds.length > 1 ? selectedIds : allPageShapeIds;

      if (targetIds.length < 2) return;

      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'ALIGN_NODES',
        nodeIds: targetIds as string[],
        direction,
        margin,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker]
  );

  const dockNode = useCallback(
    (
      targetId: string,
      anchorId: string,
      slot: 'top' | 'bottom' | 'left' | 'right' | 'center',
      margin = 24
    ) => {
      if (!workerRef.current) return;
      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'DOCK_NODE',
        targetId,
        groupOrAnchorId: anchorId,
        slot,
        margin,
      } satisfies WorkerInMessage);
    },
    [syncShapesWithWorker]
  );

  const repelCollisions = useCallback(
    (anchorId?: string, margin = 40) => {
      if (!workerRef.current || !editor) return;
      const targetAnchor = anchorId || editor.getOnlySelectedShape()?.id;
      if (!targetAnchor) return;

      syncShapesWithWorker();
      workerRef.current.postMessage({
        type: 'REPEL_COLLISIONS',
        anchorId: targetAnchor as string,
        margin,
      } satisfies WorkerInMessage);
    },
    [editor, syncShapesWithWorker]
  );

  const runSpatialActions = useCallback(
    async (
      actions: SpatialActionFrame[],
      sessionId?: string,
      signal?: AbortSignal
    ) => {
      if (!workerRef.current || !editor)
        throw new Error('Canvas engine is not ready.');
      signal?.throwIfAborted();
      actions.forEach(validateAction);
      const known = new Set(
        editor.getCurrentPageShapes().map((s) => s.id as string)
      );
      const knownTypes = new Map(
        editor
          .getCurrentPageShapes()
          .map((s) => [s.id as string, s.type as string])
      );
      const originals = new Map<string, string>();
      for (const f of actions) {
        for (const id of [f.target, f.from, f.to, ...(f.nodeIds || [])].filter(
          Boolean
        ) as string[]) {
          const normalized = normalizeId(id);
          if (!known.has(normalized))
            throw new Error(
              `Canvas target ${id} no longer exists. Select a target and retry.`
            );
          const shape = editor.getShape(normalized as TLShapeId);
          if (shape?.isLocked && !['focus_viewport', 'connect'].includes(f.op))
            throw new Error('Unlock the target before asking AI to change it.');
          if (shape) originals.set(normalized, JSON.stringify(shape));
        }
        const expected = (
          {
            mutate_artifact: 'artifact',
            mutate_document: 'document',
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
          if (known.has(normalizeId(f.id)))
            throw new Error('Creation would overwrite an existing shape.');
          known.add(normalizeId(f.id));
          const type = (
            {
              spawn_artifact: 'artifact',
              create_rich_card: 'rich_card',
              create_code_card: 'code_card',
              create_document: 'document',
              embed_media: 'media_embed',
              draw_vector: 'vector_shape',
              create_group: 'frame',
              create_card: f.shapeType || 'geo',
            } as Record<string, string>
          )[f.op];
          if (type) knownTypes.set(normalizeId(f.id), type);
        }
      }
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
          originals,
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
