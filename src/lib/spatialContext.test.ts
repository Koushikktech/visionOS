import { describe, expect, it } from 'bun:test';
import type { Editor, TLBinding, TLShape } from '@tldraw/tldraw';
import type { SpatialNodeItem } from '@/types/spatial';
import {
  assertSpatialPageSnapshotCurrent,
  assertShapesUnlockedForReparent,
  captureSpatialPageSnapshot,
  compactViewportNeighbor,
  createSpatialSerializationCache,
  matchesSpatialPageSnapshot,
  serializeCanvas,
  serializeSpatialShape,
  spatialNodeGeometryPatch,
} from './spatialContext';

function makeEditor() {
  let pageId = 'page:one';
  const frame = {
    id: 'shape:frame',
    type: 'frame',
    parentId: 'page:one',
    isLocked: true,
    rotation: 0,
    props: { w: 400, h: 300 },
  } as unknown as TLShape;
  const app = {
    id: 'shape:app',
    type: 'artifact',
    parentId: 'shape:frame',
    isLocked: false,
    rotation: Math.PI / 4,
    props: { w: 200, h: 80, title: 'Rotated app', code: '<html></html>' },
  } as unknown as TLShape;
  const collider = {
    id: 'shape:collider',
    type: 'geo',
    parentId: 'page:one',
    isLocked: false,
    rotation: 0,
    props: { w: 100, h: 100 },
  } as unknown as TLShape;
  let shapes = [frame, app, collider];
  const bindingsByShape = new Map<string, TLBinding[]>();
  let boundsCalls = 0;
  const editor = {
    getCurrentPageId: () => pageId,
    getCurrentPageShapes: () => shapes,
    getCurrentPageShapesSorted: () => shapes,
    getShape: (id: string) => shapes.find((shape) => shape.id === id),
    getShapePageBounds: (id: string) => {
      boundsCalls++;
      return id === app.id
        ? {
            minX: 10,
            minY: 20,
            maxX: 242,
            maxY: 252,
            w: 232,
            h: 232,
          }
        : {
            minX: 0,
            minY: 0,
            maxX: 400,
            maxY: 300,
            w: 400,
            h: 300,
          };
    },
    getBindingsFromShape: (shape: TLShape | string, type: string) =>
      type === 'arrow'
        ? bindingsByShape.get(typeof shape === 'string' ? shape : (shape.id as string)) || []
        : [],
  } as unknown as Editor;
  return {
    editor,
    app,
    frame,
    collider,
    setPageId: (id: string) => {
      pageId = id;
    },
    replaceShape: (next: TLShape) => {
      shapes = shapes.map((shape) => (shape.id === next.id ? next : shape));
    },
    removeShape: (id: string) => {
      shapes = shapes.filter((shape) => shape.id !== id);
    },
    addShape: (shape: TLShape) => {
      shapes = [...shapes, shape];
    },
    setBindings: (shapeId: string, bindings: TLBinding[]) => {
      bindingsByShape.set(shapeId, bindings);
    },
    getBoundsCalls: () => boundsCalls,
  };
}

describe('spatial page serialization', () => {
  it('keeps only deck count in nearby context while retaining selected source elsewhere', () => {
    const preview = compactViewportNeighbor({
      id: 'shape:nearby', type: 'slide_deck',
      minX: 0, minY: 0, maxX: 800, maxY: 500,
      title: 'Nearby deck', theme: 'paper',
      slides: Array.from({ length: 12 }, (_, index) => ({
        id: `slide-${index}`, title: `Slide ${index}`, speakerNotes: 'Private notes'.repeat(200),
      })),
    } satisfies SpatialNodeItem);
    expect(preview.slideCount).toBe(12);
    expect(preview.slides).toBeUndefined();
  });

  it('retains intrinsic dimensions and inherited lock state for rotated shapes', () => {
    const { editor } = makeEditor();
    const app = serializeCanvas(editor).find((shape) => shape.id === 'shape:app');

    expect(app).toMatchObject({
      minX: 10,
      minY: 20,
      maxX: 242,
      maxY: 252,
      intrinsicW: 200,
      intrinsicH: 80,
      rotation: Math.PI / 4,
      isLocked: true,
    });
  });

  it('reuses exact source provenance for geometry-only worker deltas', () => {
    const { editor, app } = makeEditor();
    const previous = serializeCanvas(editor).find((shape) => shape.id === app.id)!;
    const shapeWithUnchangedSource = {
      ...app,
      props: {
        w: 200,
        h: 80,
        get title() {
          throw new Error('geometry-only serialization read source title');
        },
        get code() {
          throw new Error('geometry-only serialization read source code');
        },
      },
    } as unknown as TLShape;
    const editorWithMovedBounds = {
      ...editor,
      getShapePageBounds: () => ({
        minX: -30,
        minY: 40,
        maxX: 202,
        maxY: 272,
        w: 232,
        h: 232,
      }),
    } as unknown as Editor;

    const node = serializeSpatialShape(
      editorWithMovedBounds,
      shapeWithUnchangedSource,
      4,
      previous
    );

    expect(node).toMatchObject({
      id: 'shape:app',
      minX: -30,
      minY: 40,
      zIndex: 4,
      code: '<html></html>',
      metadata: previous.metadata,
      isLocked: true,
    });
  });

  it('keeps source and storage out of unchanged-content geometry patches', () => {
    const node = {
      id: 'shape:large-app',
      type: 'artifact',
      minX: 1,
      minY: 2,
      maxX: 781,
      maxY: 542,
      code: '<html>' + 'x'.repeat(50_000) + '</html>',
      storage: { cache: 'y'.repeat(10_000) },
      metadata: { revision: 'stable' },
      title: 'App',
    } satisfies SpatialNodeItem;
    const patch = spatialNodeGeometryPatch({ ...node, minX: -20, maxX: 760 });

    expect(patch).toMatchObject({ id: node.id, minX: -20, maxX: 760 });
    expect(patch.code).toBeUndefined();
    expect(patch.storage).toBeUndefined();
    expect(JSON.stringify(patch).length).toBeLessThan(JSON.stringify(node).length / 100);
  });

  it('refreshes descendant bounds and inherited lock state after an ancestor transform', () => {
    const { editor, app, frame } = makeEditor();
    const previous = serializeCanvas(editor).find((shape) => shape.id === app.id)!;
    const transformedEditor = {
      ...editor,
      getShapePageBounds: (id: string) =>
        id === app.id
          ? {
              minX: frame.rotation === 0 ? 10 : -40,
              minY: frame.rotation === 0 ? 20 : 35,
              maxX: frame.rotation === 0 ? 242 : 192,
              maxY: frame.rotation === 0 ? 252 : 267,
              w: 232,
              h: 232,
            }
          : editor.getShapePageBounds(id as any),
    } as unknown as Editor;

    (frame as any).rotation = Math.PI / 2;
    (frame as any).isLocked = false;
    const transformed = serializeSpatialShape(transformedEditor, app, 2, previous)!;
    const patch = spatialNodeGeometryPatch(transformed);

    expect(patch).toMatchObject({
      minX: -40,
      minY: 35,
      maxX: 192,
      maxY: 267,
      rotation: app.rotation,
      isLocked: false,
    });
    expect(transformed.code).toBe(previous.code);
    expect(transformed.metadata).toBe(previous.metadata);
  });

  it('refreshes arrow binding endpoints on geometry patches despite cached props', () => {
    const { editor } = makeEditor();
    const arrow = {
      id: 'shape:arrow',
      type: 'arrow',
      parentId: 'page:one',
      isLocked: false,
      rotation: 0,
      props: { color: 'black' },
    } as unknown as TLShape;
    let bindings = [
      { props: { terminal: 'start' }, toId: 'shape:from-before' },
      { props: { terminal: 'end' }, toId: 'shape:to-before' },
    ];
    const arrowEditor = {
      ...editor,
      getBindingsFromShape: () => bindings,
    } as unknown as Editor;
    const previous = serializeSpatialShape(arrowEditor, arrow, 0)!;
    bindings = [
      { props: { terminal: 'start' }, toId: 'shape:from-after' },
      { props: { terminal: 'end' }, toId: 'shape:to-after' },
    ];

    const updated = serializeSpatialShape(arrowEditor, arrow, 0, previous)!;
    const patch = spatialNodeGeometryPatch(updated);

    expect(patch).toMatchObject({
      id: arrow.id,
      from: 'shape:from-after',
      to: 'shape:to-after',
    });
  });

  it('invalidates a pending snapshot after page changes or any shape changes', () => {
    const { editor, app, setPageId, replaceShape } = makeEditor();
    const snapshot = captureSpatialPageSnapshot(editor);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(true);

    setPageId('page:two');
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);
    setPageId('page:one');

    const changedApp = { ...app, isLocked: true } as TLShape;
    replaceShape(changedApp);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);
  });

  it('uses immutable record identity for edits, same-id recreation, and undo restoration', () => {
    const { editor, app, replaceShape, removeShape } = makeEditor();
    const snapshot = captureSpatialPageSnapshot(editor);

    const sourceEdit = {
      ...app,
      props: { ...(app.props as Record<string, unknown>), code: '<html>changed</html>' },
    } as TLShape;
    replaceShape(sourceEdit);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);

    // Restoring the original store record models undo to the exact captured state.
    replaceShape(app);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(true);

    replaceShape({ ...app, meta: { revision: 'changed' } } as TLShape);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);
    replaceShape(app);

    removeShape(app.id as string);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);
    const recreated = { ...app } as TLShape;
    replaceShape(recreated);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);
  });

  it('invalidates a page snapshot when an arrow binding changes without shape edits', () => {
    const { editor, addShape, setBindings } = makeEditor();
    const arrow = {
      id: 'shape:arrow',
      type: 'arrow',
      parentId: 'page:one',
      rotation: 0,
      isLocked: false,
      props: {},
    } as unknown as TLShape;
    addShape(arrow);

    const binding = {
      id: 'binding:arrow-current',
      typeName: 'binding',
      type: 'arrow',
      fromId: arrow.id,
      toId: 'shape:app',
      props: { terminal: 'end' },
      meta: {},
    } as unknown as TLBinding;
    setBindings(arrow.id as string, [binding]);
    const snapshot = captureSpatialPageSnapshot(editor);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(true);

    const retargetedBinding = { ...binding, toId: 'shape:collider' } as TLBinding;
    setBindings(arrow.id as string, [retargetedBinding]);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(false);

    setBindings(arrow.id as string, [binding]);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(true);
    setBindings('shape:arrow-on-other-page', [
      { ...binding, id: 'binding:other-page' } as TLBinding,
    ]);
    expect(matchesSpatialPageSnapshot(editor, snapshot)).toBe(true);
  });

  it('reuses unchanged source fields while refreshing geometry and caller-owned nodes', () => {
    const { editor, app, replaceShape, getBoundsCalls, setPageId } = makeEditor();
    const cache = createSpatialSerializationCache();
    const first = serializeCanvas(editor, cache);
    const appNode = first.find((node) => node.id === app.id)!;
    const cachedSource = cache.entries.get(app.id as string)!.node;
    const oldBoundsCalls = getBoundsCalls();

    // tldraw geometry edits replace the shape record but preserve props identity.
    replaceShape({ ...app, x: 120 } as TLShape);
    const second = serializeCanvas(editor, cache);
    const secondAppNode = second.find((node) => node.id === app.id)!;
    expect(secondAppNode).not.toBe(appNode);
    expect(cache.entries.get(app.id as string)!.node).not.toBe(cachedSource);
    expect(secondAppNode.code).toBe(appNode.code);
    expect(secondAppNode.metadata).toBe(appNode.metadata);
    expect(getBoundsCalls()).toBeGreaterThan(oldBoundsCalls);

    // Context callers own the returned array and top-level node objects.
    second.pop();
    (secondAppNode as any).code = 'caller mutation';
    const third = serializeCanvas(editor, cache);
    expect(third).toHaveLength(3);
    expect(third.find((node) => node.id === app.id)?.code).toBe('<html></html>');

    const changedSource = {
      ...app,
      props: { ...(app.props as Record<string, unknown>), code: '<html>source edit</html>' },
    } as TLShape;
    replaceShape(changedSource);
    const sourceEdited = serializeCanvas(editor, cache);
    expect(sourceEdited.find((node) => node.id === app.id)?.code).toBe(
      '<html>source edit</html>'
    );

    const slides = [{ id: 'slide-1', title: 'Selected full source', speakerNotes: 'Keep exact' }];
    const deck = {
      id: 'shape:deck',
      type: 'slide_deck',
      parentId: 'page:one',
      rotation: 0,
      isLocked: false,
      props: { w: 400, h: 300, title: 'Deck', slides },
    } as unknown as TLShape;
    const deckEditor = {
      ...editor,
      getCurrentPageShapes: () => [...editor.getCurrentPageShapes(), deck],
      getCurrentPageShapesSorted: () => [...editor.getCurrentPageShapesSorted(), deck],
      getShape: (id: string) => (id === deck.id ? deck : editor.getShape(id as any)),
    } as unknown as Editor;
    const withDeck = serializeCanvas(deckEditor, cache);
    const deckNode = withDeck.find((node) => node.id === deck.id)!;
    const preview = compactViewportNeighbor(deckNode);
    expect(preview.slides).toBeUndefined();
    expect(cache.entries.get(deck.id as string)?.node.slides).toEqual(slides);
    expect(serializeCanvas(deckEditor, cache).find((node) => node.id === deck.id)?.slides).toEqual(
      slides
    );

    // A page change drops prior page source entries before serializing the new page.
    setPageId('page:two');
    serializeCanvas(editor, cache);
    expect(cache.pageId).toBe('page:two');
    expect(cache.entries.size).toBe(3);
  });

  it('measures whole-page guards and source caching on the 300-node C13 fixture', () => {
    const shapes = Array.from({ length: 300 }, (_, index) => ({
      id: `shape:heavy-${index}`,
      type: 'artifact',
      parentId: 'page:heavy',
      x: index * 10,
      y: index * 5,
      rotation: 0,
      isLocked: false,
      props: {
        w: 320,
        h: 240,
        title: `Heavy artifact ${index}`,
        code: `<html>${'x'.repeat(12_800)}</html>`,
      },
    })) as TLShape[];
    const editor = {
      getCurrentPageId: () => 'page:heavy',
      getCurrentPageShapes: () => shapes,
      getCurrentPageShapesSorted: () => shapes,
      getShape: (id: string) => shapes.find((shape) => shape.id === id),
      getShapePageBounds: (id: string) => {
        const index = Number(id.split('-').at(-1));
        return {
          minX: index * 10,
          minY: index * 5,
          maxX: index * 10 + 320,
          maxY: index * 5 + 240,
          w: 320,
          h: 240,
        };
      },
      getBindingsFromShape: () => [],
    } as unknown as Editor;

    const cache = createSpatialSerializationCache();
    const baselineNodes = serializeCanvas(editor);
    const cachedNodes = serializeCanvas(editor, cache);
    expect(serializeCanvas(editor, cache)).toEqual(baselineNodes);

    const currentShapes = editor.getCurrentPageShapes();
    const baselineSnapshot = () =>
      new Map(currentShapes.map((shape) => [shape.id as string, JSON.stringify(shape)]));
    const baselineMatches = (snapshot: Map<string, string>) =>
      currentShapes.length === snapshot.size &&
      currentShapes.every((shape) => snapshot.get(shape.id as string) === JSON.stringify(shape));
    const measureMedianMs = (run: () => void) => {
      const samples: number[] = [];
      for (let i = 0; i < 9; i++) {
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    };
    const baselineGuardMs = measureMedianMs(() => {
      const snapshot = baselineSnapshot();
      if (!baselineMatches(snapshot)) throw new Error('baseline snapshot changed');
    });
    const referenceGuardMs = measureMedianMs(() => {
      const snapshot = captureSpatialPageSnapshot(editor);
      if (!matchesSpatialPageSnapshot(editor, snapshot))
        throw new Error('reference snapshot changed');
    });
    const uncachedSerializationMs = measureMedianMs(() => {
      serializeCanvas(editor);
    });
    const cachedSerializationMs = measureMedianMs(() => {
      serializeCanvas(editor, cache);
    });
    const sourceJsonBytes = new TextEncoder().encode(JSON.stringify(baselineNodes)).length;
    const baselineScannedBytes = currentShapes.reduce(
      (total, shape) => total + JSON.stringify(shape).length,
      0
    );

    console.log(
      `[C13 300-node host microbenchmark] full node JSON=${sourceJsonBytes} bytes (~${Math.ceil(sourceJsonBytes / 4)} chars/4 token estimate); unchanged-page source scanned=${baselineScannedBytes} chars/pass; whole-page guard median=${baselineGuardMs.toFixed(2)}ms JSON vs ${referenceGuardMs.toFixed(2)}ms record refs; serialize median=${uncachedSerializationMs.toFixed(2)}ms uncached vs ${cachedSerializationMs.toFixed(2)}ms source-cache. Bounds and output JSON are still recomputed/serialized.`
    );
    expect(cachedNodes).toEqual(baselineNodes);
  });

  it('rejects solver-neighbor edits and ancestor lock changes before commit', () => {
    const neighborCase = makeEditor();
    const neighborSnapshot = captureSpatialPageSnapshot(neighborCase.editor);
    neighborCase.replaceShape({ ...neighborCase.collider, x: 500 } as TLShape);
    expect(() =>
      assertSpatialPageSnapshotCurrent(neighborCase.editor, neighborSnapshot)
    ).toThrow('Canvas changed while applying the action. Please retry.');

    const ancestorCase = makeEditor();
    const ancestorSnapshot = captureSpatialPageSnapshot(ancestorCase.editor);
    ancestorCase.replaceShape({ ...ancestorCase.frame, isLocked: false } as TLShape);
    expect(() =>
      assertSpatialPageSnapshotCurrent(ancestorCase.editor, ancestorSnapshot)
    ).toThrow('Canvas changed while applying the action. Please retry.');
  });

  it('rejects reparenting a child of a locked frame', () => {
    const { editor } = makeEditor();
    expect(() =>
      assertShapesUnlockedForReparent(editor, ['shape:app'])
    ).toThrow('Unlock every selected object and its frame');
  });
});
