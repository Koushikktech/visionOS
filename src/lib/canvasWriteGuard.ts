import type { SpatialActionFrame } from '../types/spatial';

export const READONLY_CANVAS_MESSAGE =
  'The canvas is read-only. No canvas changes were applied.';

export interface CanvasWriteCapability {
  getIsReadonly(): boolean;
}

/** Viewport focus and temporary skeletons do not write canvas records. */
export function isSpatialCanvasMutation(frame: Pick<SpatialActionFrame, 'op'>): boolean {
  return frame.op !== 'focus_viewport' && frame.op !== 'speculative_skeleton';
}

export function assertCanvasWritable(editor: CanvasWriteCapability): void {
  if (editor.getIsReadonly()) throw new Error(READONLY_CANVAS_MESSAGE);
}

export function assertSpatialActionsWritable(
  editor: CanvasWriteCapability,
  frames: readonly Pick<SpatialActionFrame, 'op'>[]
): void {
  if (editor.getIsReadonly() && frames.some(isSpatialCanvasMutation)) {
    throw new Error(READONLY_CANVAS_MESSAGE);
  }
}
