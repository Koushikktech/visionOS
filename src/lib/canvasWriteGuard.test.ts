import { describe, expect, it } from 'bun:test';
import {
  assertCanvasWritable,
  assertSpatialActionsWritable,
  isSpatialCanvasMutation,
  READONLY_CANVAS_MESSAGE,
} from './canvasWriteGuard';

describe('canvas write guard', () => {
  it('rejects edits when the editor becomes read-only', () => {
    expect(() => assertCanvasWritable({ getIsReadonly: () => true })).toThrow(
      READONLY_CANVAS_MESSAGE
    );
    expect(() => assertCanvasWritable({ getIsReadonly: () => false })).not.toThrow();
  });

  it('allows focus and temporary skeleton frames without granting record writes', () => {
    const focus = { op: 'focus_viewport' } as const;
    const skeleton = { op: 'speculative_skeleton' } as const;
    expect(isSpatialCanvasMutation(focus)).toBe(false);
    expect(isSpatialCanvasMutation(skeleton)).toBe(false);
    expect(() =>
      assertSpatialActionsWritable({ getIsReadonly: () => true }, [focus, skeleton])
    ).not.toThrow();
  });

  it('rejects the full action batch when any frame mutates canvas records', () => {
    const frames = [
      { op: 'focus_viewport' },
      { op: 'create_rich_card' },
    ] as const;

    expect(() =>
      assertSpatialActionsWritable({ getIsReadonly: () => true }, frames)
    ).toThrow(READONLY_CANVAS_MESSAGE);
    expect(() =>
      assertSpatialActionsWritable({ getIsReadonly: () => false }, frames)
    ).not.toThrow();
  });
});
