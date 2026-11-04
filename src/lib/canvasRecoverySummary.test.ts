import { describe, expect, it } from 'bun:test';
import type { TLEditorSnapshot } from '@tldraw/tldraw';
import { formatRecoverySavedAt, summarizeCanvasRecovery } from './canvasRecoverySummary';

function snapshot(store: Record<string, unknown>): TLEditorSnapshot {
  return { document: { store }, session: {} } as TLEditorSnapshot;
}

describe('canvas recovery review summary', () => {
  it('counts pages and shapes, groups types, and exposes short title samples', () => {
    const summary = summarizeCanvasRecovery(
      snapshot({
        'page:one': { id: 'page:one', typeName: 'page', name: 'Research plan' },
        'shape:doc': {
          id: 'shape:doc',
          typeName: 'shape',
          type: 'document',
          props: { title: 'Quarterly research plan' },
        },
        'shape:card': {
          id: 'shape:card',
          typeName: 'shape',
          type: 'rich_card',
          props: { title: 'Key question' },
        },
        'shape:card-2': {
          id: 'shape:card-2',
          typeName: 'shape',
          type: 'rich_card',
          props: { title: 'Key question' },
        },
        'asset:image': { id: 'asset:image', typeName: 'asset', type: 'image', props: {} },
      })
    );

    expect(summary).toEqual({
      shapeCount: 3,
      pageCount: 1,
      typeCounts: [
        { label: 'Card', count: 2 },
        { label: 'Document', count: 1 },
      ],
      titleSamples: ['Research plan', 'Quarterly research plan', 'Key question'],
    });
  });

  it('limits title length and leaves the recovery timestamp in a readable form', () => {
    const longTitle = 'A'.repeat(120);
    const summary = summarizeCanvasRecovery(
      snapshot({
        'shape:one': {
          id: 'shape:one',
          typeName: 'shape',
          type: 'unknown_shape',
          props: { title: longTitle },
        },
      })
    );

    expect(summary.titleSamples[0]).toBe(`${'A'.repeat(85)}…`);
    expect(summary.typeCounts[0]).toEqual({ label: 'Unknown Shape', count: 1 });
    expect(formatRecoverySavedAt('not-a-date')).toBe('not-a-date');
    expect(formatRecoverySavedAt('2026-10-26T10:00:00.000Z')).not.toBe('2026-10-26T10:00:00.000Z');
  });
});
