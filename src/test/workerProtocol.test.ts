import { describe, it, expect } from 'bun:test';
import type {
  WorkerInMessage,
  WorkerOutMessage,
  SpatialNodeItem,
} from '@/types/spatial';
// Execute the actual worker module, including its message handler and Kiwi/R-tree.
const outputs: WorkerOutMessage[] = [];
const workerScope: {
  onmessage?: (event: MessageEvent<WorkerInMessage>) => void;
  postMessage: (message: WorkerOutMessage) => void;
} = { postMessage: (m) => outputs.push(m) };
(globalThis as any).self = workerScope;
await import('@/workers/spatial.worker');
function send(data: WorkerInMessage) {
  outputs.length = 0;
  workerScope.onmessage!({ data } as MessageEvent<WorkerInMessage>);
  return outputs.at(-1)!;
}
const node: SpatialNodeItem = {
  id: 'shape:app',
  type: 'artifact',
  minX: 120,
  minY: -80,
  maxX: 900,
  maxY: 460,
  title: 'Counter',
  code: 'old',
  storage: { count: '5' },
};
function run(actions: any[]) {
  send({
    type: 'SYNC_INDEX',
    nodes: [node, { ...node, id: 'shape:b', minX: 1200, maxX: 1980 }],
  });
  return send({ type: 'RUN_ACTIONS', requestId: 'test', actions });
}
describe('Actual worker action protocol', () => {
  it('preserves regeneration identity, position, size and storage', () => {
    const result: any = run([
      { t: 'patch', op: 'mutate_artifact', target: 'shape:app', code: 'new' },
    ]);
    expect(result.type).toBe('LAYOUT_SOLVED');
    expect(result.requestId).toBe('test');
    expect(result.result.artifacts[0]).toMatchObject({
      id: 'shape:app',
      code: 'new',
      x: 120,
      y: -80,
      w: 780,
      h: 540,
      storage: { count: '5' },
    });
  });
  it('replaces speculative worker state when the host rejects a solved batch', () => {
    const original = { ...node, code: 'canvas source' };
    send({ type: 'SYNC_INDEX', nodes: [structuredClone(original)] });

    const rejected: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'rejected-batch',
      actions: [
        {
          t: 'patch', op: 'mutate_artifact', target: 'shape:app',
          code: 'speculative source',
        },
      ],
    });
    expect(rejected.result.artifacts[0].code).toBe('speculative source');

    // The host rejects this result and sends a fresh snapshot of the real
    // editor state. A later action must start from that snapshot.
    send({ type: 'SYNC_INDEX', nodes: [structuredClone(original)] });
    const next: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'after-rebase',
      actions: [
        { t: 'patch', op: 'mutate_artifact', target: 'shape:app' },
      ],
    });
    expect(next.result.artifacts[0].code).toBe('canvas source');
  });
  it('uses intrinsic dimensions when regenerating a rotated artifact inside a frame', () => {
    send({
      type: 'SYNC_INDEX',
      nodes: [
        {
          ...node,
          id: 'shape:rotated-app',
          parentId: 'shape:rotated-frame',
          minX: 80,
          minY: 100,
          maxX: 312,
          maxY: 332,
          intrinsicW: 200,
          intrinsicH: 80,
          rotation: Math.PI / 4,
        },
      ],
    });
    const result: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'rotated-artifact',
      actions: [
        {
          t: 'patch',
          op: 'mutate_artifact',
          target: 'shape:rotated-app',
          code: '<!doctype html><html></html>',
        },
      ],
    });

    expect(result.result.artifacts[0]).toMatchObject({
      id: 'shape:rotated-app',
      w: 200,
      h: 80,
    });
  });
  it('rejects an unknown target instead of updating the first app', () => {
    const result: any = run([
      {
        t: 'patch',
        op: 'mutate_artifact',
        target: 'shape:missing',
        code: 'new',
      },
    ]);
    expect(result.type).toBe('ERROR');
    expect(result.requestId).toBe('test');
  });
  it('does not discard delete, restyle, or focus batch results', () => {
    const result: any = run([
      { t: 'patch', op: 'restyle_shape', target: 'shape:app', color: 'yellow' },
      { t: 'patch', op: 'focus_viewport', nodeIds: ['shape:app'] },
      { t: 'patch', op: 'delete_shape', nodeIds: ['shape:b'] },
    ]);
    expect(result.result.restyles[0]).toMatchObject({
      id: 'shape:app',
      color: 'yellow',
    });
    expect(result.result.deletedIds).toEqual(['shape:b']);
    expect(result.result.focusIds).toEqual(['shape:app']);
  });
  it('aligns real indexed nodes without overlap', () => {
    const result: any = run([
      {
        t: 'patch',
        op: 'align',
        nodeIds: ['shape:app', 'shape:b'],
        direction: 'horizontal',
        margin: 40,
      },
    ]);
    const [a, b] = result.result.nodes;
    expect(a.y).toBe(b.y);
    expect(b.x - a.x).toBe(820);
  });
  it('echoes direct layout request IDs for guarded application', () => {
    send({
      type: 'SYNC_INDEX',
      nodes: [node, { ...node, id: 'shape:b', minX: 1200, maxX: 1980 }],
    });
    const result: any = send({
      type: 'ALIGN_NODES',
      requestId: 'direct-align',
      nodeIds: ['shape:app', 'shape:b'],
      direction: 'horizontal',
      margin: 40,
    });

    expect(result.requestId).toBe('direct-align');
    expect(result.result.nodes).toHaveLength(2);
  });
  it('supports explicit move and resize actions', () => {
    const result: any = run([
      { t: 'patch', op: 'move_shape', target: 'shape:app', x: 0, y: 0 },
      { t: 'patch', op: 'resize_shape', target: 'shape:b', w: 960, h: 640 },
    ]);
    expect(result.result.nodes[0]).toMatchObject({
      id: 'shape:app',
      x: 0,
      y: 0,
    });
    expect(result.result.nodes[1]).toMatchObject({ w: 960, h: 640 });
  });
  it('never moves locked collision neighbors', () => {
    send({
      type: 'SYNC_INDEX',
      nodes: [
        {
          id: 'shape:anchor',
          type: 'geo',
          minX: 0,
          minY: 0,
          maxX: 100,
          maxY: 100,
        },
        {
          id: 'shape:locked-neighbor',
          type: 'geo',
          minX: 20,
          minY: 20,
          maxX: 80,
          maxY: 80,
          isLocked: true,
        },
        {
          id: 'shape:movable-neighbor',
          type: 'geo',
          minX: 30,
          minY: 30,
          maxX: 70,
          maxY: 70,
        },
      ],
    });
    const result: any = send({
      type: 'REPEL_COLLISIONS',
      anchorId: 'shape:anchor',
      margin: 20,
    });

    expect(result.result.nodes.map((item: any) => item.id)).toEqual([
      'shape:movable-neighbor',
    ]);
  });
  it('repels identical-center peers without creating peer collisions', () => {
    const anchor: SpatialNodeItem = {
      id: 'shape:anchor-peer', type: 'geo',
      minX: -100, minY: -100, maxX: 0, maxY: 0,
    };
    const peers: SpatialNodeItem[] = [
      { id: 'shape:peer-a', type: 'geo', minX: -70, minY: -70, maxX: -30, maxY: -30 },
      { id: 'shape:peer-b', type: 'geo', minX: -70, minY: -70, maxX: -30, maxY: -30 },
    ];
    send({ type: 'SYNC_INDEX', nodes: [anchor, ...peers] });

    const result: any = send({
      type: 'REPEL_COLLISIONS',
      anchorId: anchor.id,
      margin: 10,
    });
    const moved = new Map<string, { x: number; y: number; w: number; h: number }>(
      result.result.nodes.map((item: any) => [
        item.id,
        { x: item.x, y: item.y, w: 40, h: 40 },
      ])
    );
    const finalPeers = peers.map((peer) => {
      const position = moved.get(peer.id) as any;
      return position
        ? {
            ...peer,
            minX: position.x,
            minY: position.y,
            maxX: position.x + position.w,
            maxY: position.y + position.h,
          }
        : peer;
    });
    const overlaps = (a: SpatialNodeItem, b: SpatialNodeItem) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

    expect(result.result.nodes).toHaveLength(2);
    expect(finalPeers.every((peer) => !overlaps(peer, anchor))).toBe(true);
    expect(overlaps(finalPeers[0], finalPeers[1])).toBe(false);
    expect(finalPeers.every((peer) => Number.isFinite(peer.minX + peer.minY))).toBe(true);
  });
  it('pushes peers beyond dense obstacle chains while keeping negative coordinates valid', () => {
    const anchor: SpatialNodeItem = {
      id: 'shape:negative-anchor', type: 'geo',
      minX: -100, minY: -100, maxX: 0, maxY: 0,
    };
    const peer: SpatialNodeItem = {
      id: 'shape:negative-peer', type: 'geo',
      minX: -50, minY: -50, maxX: -20, maxY: -20,
    };
    const obstacles: SpatialNodeItem[] = Array.from({ length: 14 }, (_, index) => ({
      id: `repel-chain-${index}`,
      type: 'geo',
      minX: 20 + index * 35,
      minY: -60,
      maxX: 55 + index * 35,
      maxY: -10,
    }));
    send({ type: 'SYNC_INDEX', nodes: [anchor, peer, ...obstacles] });

    const result: any = send({
      type: 'REPEL_COLLISIONS',
      anchorId: anchor.id,
      margin: 10,
    });
    const moved = result.result.nodes.find((item: any) => item.id === peer.id);

    expect(moved).toBeDefined();
    expect(moved.x).toBeGreaterThan(Math.max(...obstacles.map((item) => item.maxX)));
    expect(moved.y).toBe(-50);
    expect(
      moved.x < anchor.maxX && moved.x + 30 > anchor.minX &&
      moved.y < anchor.maxY && moved.y + 30 > anchor.minY
    ).toBe(false);
    expect(obstacles.some((item) =>
      moved.x < item.maxX && moved.x + 30 > item.minX &&
      moved.y < item.maxY && moved.y + 30 > item.minY
    )).toBe(false);
  });
  it('keeps nested peers inside their unlocked parent frame and leaves locked peers fixed', () => {
    const frame: SpatialNodeItem = {
      id: 'shape:parent-frame', type: 'frame',
      minX: 0, minY: 0, maxX: 300, maxY: 240,
    };
    const anchor: SpatialNodeItem = {
      id: 'shape:nested-anchor', type: 'geo', parentId: frame.id,
      minX: 100, minY: 80, maxX: 180, maxY: 160,
    };
    const peer: SpatialNodeItem = {
      id: 'shape:nested-peer', type: 'geo', parentId: frame.id,
      minX: 120, minY: 100, maxX: 160, maxY: 140,
    };
    const lockedPeer: SpatialNodeItem = {
      id: 'shape:locked-nested-peer', type: 'geo', parentId: frame.id,
      minX: 110, minY: 90, maxX: 150, maxY: 130, isLocked: true,
    };
    send({ type: 'SYNC_INDEX', nodes: [frame, anchor, peer, lockedPeer] });

    const result: any = send({
      type: 'REPEL_COLLISIONS',
      anchorId: anchor.id,
      margin: 10,
    });
    const moved = result.result.nodes.find((item: any) => item.id === peer.id);

    expect(moved).toBeDefined();
    expect(moved.x).toBeGreaterThanOrEqual(frame.minX);
    expect(moved.y).toBeGreaterThanOrEqual(frame.minY);
    expect(moved.x + 40).toBeLessThanOrEqual(frame.maxX);
    expect(moved.y + 40).toBeLessThanOrEqual(frame.maxY);
    expect(result.result.nodes.some((item: any) => item.id === lockedPeer.id)).toBe(false);
    expect(result.result.nodes.some((item: any) => item.id === frame.id)).toBe(false);
  });
  it('keeps grouped peers inside a mixed-format group parent and does not move the group', () => {
    const group: SpatialNodeItem = {
      id: 'shape:group-parent', type: 'group',
      minX: 0, minY: 0, maxX: 300, maxY: 240,
    };
    const anchor: SpatialNodeItem = {
      id: 'shape:group-anchor', type: 'geo', parentId: 'group-parent',
      minX: 100, minY: 80, maxX: 180, maxY: 160,
    };
    const peer: SpatialNodeItem = {
      id: 'shape:group-peer', type: 'geo', parentId: 'group-parent',
      minX: 120, minY: 100, maxX: 160, maxY: 140,
    };
    send({ type: 'SYNC_INDEX', nodes: [group, anchor, peer] });

    const result: any = send({
      type: 'REPEL_COLLISIONS', anchorId: anchor.id, margin: 10,
    });
    const moved = result.result.nodes.find((item: any) => item.id === peer.id);

    expect(moved).toBeDefined();
    expect(moved.x).toBeGreaterThanOrEqual(group.minX);
    expect(moved.y).toBeGreaterThanOrEqual(group.minY);
    expect(moved.x + 40).toBeLessThanOrEqual(group.maxX);
    expect(moved.y + 40).toBeLessThanOrEqual(group.maxY);
    expect(result.result.nodes.some((item: any) => item.id === group.id)).toBe(false);
  });
  it('does not move a child across its frame or move descendants of a frame anchor', () => {
    const frame: SpatialNodeItem = {
      id: 'shape:fenced-frame', type: 'frame',
      minX: 0, minY: 0, maxX: 100, maxY: 100,
    };
    const child: SpatialNodeItem = {
      id: 'shape:fenced-child', type: 'geo', parentId: frame.id,
      minX: 10, minY: 10, maxX: 90, maxY: 90,
    };
    const peer: SpatialNodeItem = {
      id: 'shape:fenced-peer', type: 'geo', parentId: frame.id,
      minX: 20, minY: 20, maxX: 80, maxY: 80,
    };
    send({ type: 'SYNC_INDEX', nodes: [frame, child, peer] });
    const fenced: any = send({
      type: 'REPEL_COLLISIONS', anchorId: child.id, margin: 40,
    });
    expect(fenced.result.nodes).toEqual([]);

    const anchorFrame: SpatialNodeItem = {
      id: 'shape:container-anchor', type: 'frame',
      minX: -50, minY: -50, maxX: 50, maxY: 50,
    };
    const descendant: SpatialNodeItem = {
      id: 'shape:container-child', type: 'geo', parentId: anchorFrame.id,
      minX: -20, minY: -20, maxX: 20, maxY: 20,
    };
    send({ type: 'SYNC_INDEX', nodes: [anchorFrame, descendant] });
    const related: any = send({
      type: 'REPEL_COLLISIONS', anchorId: anchorFrame.id, margin: 20,
    });
    expect(related.result.nodes).toEqual([]);
  });
  it('reports peers left in place when a full parent frame has no safe repel position', () => {
    const frame: SpatialNodeItem = {
      id: 'shape:full-frame', type: 'frame',
      minX: 0, minY: 0, maxX: 100, maxY: 100,
    };
    const anchor: SpatialNodeItem = {
      id: 'shape:full-anchor', type: 'geo', parentId: frame.id,
      minX: 10, minY: 10, maxX: 90, maxY: 90,
    };
    const peer: SpatialNodeItem = {
      id: 'shape:full-peer', type: 'geo', parentId: frame.id,
      minX: 20, minY: 20, maxX: 80, maxY: 80,
    };
    send({ type: 'SYNC_INDEX', nodes: [frame, anchor, peer] });

    const result: any = send({
      type: 'REPEL_COLLISIONS', anchorId: anchor.id, margin: 10,
    });

    expect(result.result.nodes).toEqual([]);
    expect(result.result.actionSummary).toBe(
      'Could not repel 1 of 1 colliding elements; no safe position was available'
    );
  });
  it('preserves document sections for metadata-only updates', () => {
    send({
      type: 'SYNC_INDEX',
      nodes: [
        {
          ...node,
          id: 'shape:doc',
          type: 'document',
          sections: [{ id: 's', title: 'Intro', content: 'Keep me' }],
        },
      ],
    });
    const result: any = send({
      type: 'RUN_ACTIONS',
      actions: [
        {
          t: 'patch',
          op: 'mutate_document',
          target: 'shape:doc',
          title: 'New title',
        },
      ],
    });
    expect(result.result.documents[0].sections[0].content).toBe('Keep me');
  });

  it('creates and then mutates a native presentation deck in one worker batch', () => {
    send({ type: 'SYNC_INDEX', nodes: [] });
    const result: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'deck-ai-batch',
      viewportCenter: { x: 300, y: 220 },
      actions: [
        {
          t: 'patch', op: 'create_slide_deck', id: 'deck-ai',
          title: 'Launch brief', theme: 'ocean', currentSlideIndex: 0,
          slides: [{ id: 'slide-1', title: 'Launch', layout: 'hero', speakerNotes: 'Introduce the launch.' }],
        },
        {
          t: 'patch', op: 'mutate_slide_deck', target: 'shape:deck-ai',
          title: 'Launch plan', theme: 'plum', currentSlideIndex: 1,
          slides: [
            { id: 'slide-1', title: 'Launch', layout: 'hero', speakerNotes: 'Introduce the launch.' },
            { id: 'slide-2', title: 'Milestones', layout: 'timeline', timelineSteps: [{ step: '1', title: 'Build', desc: 'Prepare the release.' }] },
          ],
        },
      ],
    });

    expect(result.type).toBe('LAYOUT_SOLVED');
    expect(result.result.decks).toHaveLength(2);
    expect(result.result.actions[0].deck).toMatchObject({
      id: 'deck-ai', title: 'Launch brief', theme: 'ocean', w: 800, h: 500,
    });
    expect(result.result.actions[1].deck).toMatchObject({
      id: 'shape:deck-ai', title: 'Launch plan', theme: 'plum', currentSlideIndex: 1,
      slides: [{ id: 'slide-1' }, { id: 'slide-2', layout: 'timeline' }],
    });
  });

  it('keeps existing deck placement and intrinsic size during AI replacement', () => {
    const deckNode: SpatialNodeItem = {
      id: 'shape:existing-deck', type: 'slide_deck',
      minX: -200, minY: 80, maxX: 700, maxY: 580,
      intrinsicW: 900, intrinsicH: 500,
      title: 'Existing', theme: 'paper', currentSlideIndex: 0,
      slides: [{ id: 'slide-a', title: 'Summary', layout: 'split' }],
    };
    send({ type: 'SYNC_INDEX', nodes: [deckNode] });
    const result: any = send({
      type: 'RUN_ACTIONS',
      actions: [{
        t: 'patch', op: 'mutate_slide_deck', target: 'shape:existing-deck',
        theme: 'midnight', slides: [{ id: 'slide-a', title: 'Summary', layout: 'takeaway' }],
      }],
    });
    expect(result.result.decks[0]).toMatchObject({
      id: 'shape:existing-deck', x: -200, y: 80, w: 900, h: 500,
      theme: 'midnight', slides: [{ id: 'slide-a', layout: 'takeaway' }],
    });
  });

  it('finds a verified open slot beyond more than ten chained obstacles', () => {
    const obstacles: SpatialNodeItem[] = Array.from({ length: 14 }, (_, index) => ({
      id: `chain-obstacle-${index}`,
      type: 'geo',
      minX: index * 152,
      minY: 0,
      maxX: index * 152 + 100,
      maxY: 100,
    }));
    send({ type: 'SYNC_INDEX', nodes: obstacles });

    const result: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'dense-placement',
      viewportCenter: { x: 130, y: 75 },
      actions: [{ t: 'patch', op: 'create_card', id: 'dense-created', w: 260, h: 150 }],
    });

    expect(result.type).toBe('LAYOUT_SOLVED');
    const [created] = result.result.createdCards;
    expect(created.x).toBeGreaterThan(Math.max(...obstacles.map((item) => item.maxX)));
    const overlaps = obstacles.some(
      (item) =>
        created.x < item.maxX &&
        created.x + created.w > item.minX &&
        created.y < item.maxY &&
        created.y + created.h > item.minY
    );
    expect(overlaps).toBe(false);
  });
  it('replaces prior page entries when syncing the index', () => {
    const oldPageSync: any = send({
      type: 'SYNC_INDEX',
      nodes: [{ ...node, id: 'shape:old-page-app' }],
    });
    expect(oldPageSync.count).toBe(1);

    const newPageSync: any = send({ type: 'SYNC_INDEX', nodes: [] });
    expect(newPageSync.count).toBe(0);
    const staleTarget: any = send({
      type: 'RUN_ACTIONS',
      requestId: 'stale-page-target',
      actions: [
        {
          t: 'patch',
          op: 'mutate_artifact',
          target: 'shape:old-page-app',
          code: '<!doctype html><html></html>',
        },
      ],
    });
    expect(staleTarget.type).toBe('ERROR');
    expect(staleTarget.requestId).toBe('stale-page-target');

    const newPagePlacement: any = send({
      type: 'RUN_ACTIONS',
      sessionId: 'new-page-session',
      viewportCenter: { x: 130, y: 75 },
      actions: [{ t: 'patch', op: 'create_card', id: 'new-page-card', w: 260, h: 150 }],
    });
    expect(newPagePlacement.result.createdCards[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('applies only the next page revision and rejects stale worker patches', () => {
    const first: SpatialNodeItem = {
      id: 'shape:patch-one', type: 'geo',
      minX: 0, minY: 0, maxX: 100, maxY: 100,
      title: 'Preserve source',
    };
    const deleted: SpatialNodeItem = {
      id: 'shape:patch-delete', type: 'geo',
      minX: 200, minY: 0, maxX: 300, maxY: 100,
    };
    const initial: any = send({
      type: 'SYNC_INDEX', pageId: 'page:patch', revision: 7,
      nodes: [first, deleted],
    });
    expect(initial).toMatchObject({ type: 'INDEX_SYNCED', pageId: 'page:patch', revision: 7, count: 2 });

    const patched: any = send({
      type: 'PATCH_INDEX', pageId: 'page:patch', revision: 8,
      nodes: [{ id: first.id, minX: 500, maxX: 600 }],
      deletedIds: [deleted.id],
    });
    expect(patched).toMatchObject({ type: 'INDEX_PATCHED', count: 1, updatedCount: 1, deletedCount: 1 });

    const stale: any = send({
      type: 'PATCH_INDEX', pageId: 'page:patch', revision: 10,
      nodes: [{ id: first.id, minX: 900, maxX: 1000 }],
      deletedIds: [],
    });
    expect(stale).toMatchObject({
      type: 'INDEX_RESYNC_REQUIRED',
      expectedRevision: 9,
      receivedRevision: 10,
    });

    const current: any = send({
      type: 'QUERY_VIEWPORT',
      viewport: { minX: -1000, minY: -1000, maxX: 2000, maxY: 1000 },
      selectedIds: [first.id, deleted.id],
    });
    expect(current.payload.selectedNodes.map((item: SpatialNodeItem) => item.id)).toEqual([first.id]);
    expect(current.payload.selectedNodes[0].minX).toBe(500);
    expect(current.payload.selectedNodes[0].title).toBe('Preserve source');
  });

  it('measures one-node sync payload and actual worker update cost on a dense source page', () => {
    const largeNodes: SpatialNodeItem[] = Array.from({ length: 300 }, (_, index) => ({
      id: `shape:large-${index}`,
      type: 'artifact',
      minX: index * 900,
      minY: 0,
      maxX: index * 900 + 780,
      maxY: 540,
      title: `App ${index}`,
      code: '<!doctype html><html><body>' + 'x'.repeat(12_000) + '</body></html>',
      storage: { payload: 'y'.repeat(1_000) },
      metadata: { revision: String(index) },
    }));
    const fullBytes = new TextEncoder().encode(JSON.stringify({
      type: 'SYNC_INDEX', pageId: 'page:benchmark', revision: 20,
      nodes: largeNodes,
    })).length;
    const changed = { id: largeNodes[0].id, minX: -200, maxX: 580 };
    const patchBytes = new TextEncoder().encode(JSON.stringify({
      type: 'PATCH_INDEX', pageId: 'page:benchmark', revision: 21,
      nodes: [changed], deletedIds: [],
    })).length;

    const fullStart = performance.now();
    const fullReply: any = send({
      type: 'SYNC_INDEX', pageId: 'page:benchmark', revision: 20,
      nodes: largeNodes,
    });
    const fullWorkerMs = performance.now() - fullStart;
    const patchStart = performance.now();
    const patchReply: any = send({
      type: 'PATCH_INDEX', pageId: 'page:benchmark', revision: 21,
      nodes: [changed], deletedIds: [],
    });
    const patchWorkerMs = performance.now() - patchStart;

    expect(fullReply.type).toBe('INDEX_SYNCED');
    expect(patchReply).toMatchObject({ type: 'INDEX_PATCHED', updatedCount: 1, count: 300 });
    expect(patchBytes * 100).toBeLessThan(fullBytes);
    const afterPatch: any = send({
      type: 'QUERY_VIEWPORT',
      viewport: { minX: -500, minY: -100, maxX: 1000, maxY: 1000 },
      selectedIds: [largeNodes[0].id],
    });
    expect(afterPatch.payload.selectedNodes[0].minX).toBe(-200);
    expect(afterPatch.payload.selectedNodes[0].code).toBe(largeNodes[0].code);
    console.info(
      `[spatial-sync benchmark] 300 source-heavy nodes: ${fullBytes} full-sync bytes vs ${patchBytes} one-node patch bytes; worker ${fullWorkerMs.toFixed(2)}ms full / ${patchWorkerMs.toFixed(2)}ms patch`
    );
  });
});
