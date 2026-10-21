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
});
