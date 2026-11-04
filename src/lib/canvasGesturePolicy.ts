export interface CanvasGestureTarget {
  insideCanvas: boolean;
  insideChrome: boolean;
  editable: boolean;
}

/** Browser zoom remains available on app chrome and text editors. */
export function shouldRoutePinchToCanvas(target: CanvasGestureTarget): boolean {
  return target.insideCanvas && !target.insideChrome && !target.editable;
}

/** Keep direct canvas gestures reserved for tldraw, but let content panes pan vertically. */
export function getCanvasTouchAction(isScrollableContent: boolean): 'none' | 'pan-y' {
  return isScrollableContent ? 'pan-y' : 'none';
}

