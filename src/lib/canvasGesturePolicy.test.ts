import { describe, expect, it } from 'bun:test';
import {
  getCanvasTouchAction,
  shouldRoutePinchToCanvas,
} from './canvasGesturePolicy';

describe('canvas gesture policy', () => {
  it('keeps pinch zoom on the canvas only when the pointer is over the drawing surface', () => {
    expect(shouldRoutePinchToCanvas({ insideCanvas: true, insideChrome: false, editable: false })).toBe(true);
    expect(shouldRoutePinchToCanvas({ insideCanvas: true, insideChrome: true, editable: false })).toBe(false);
    expect(shouldRoutePinchToCanvas({ insideCanvas: true, insideChrome: false, editable: true })).toBe(false);
    expect(shouldRoutePinchToCanvas({ insideCanvas: false, insideChrome: false, editable: false })).toBe(false);
  });

  it('allows vertical native pan only from explicitly scrollable canvas content', () => {
    expect(getCanvasTouchAction(true)).toBe('pan-y');
    expect(getCanvasTouchAction(false)).toBe('none');
  });
});
