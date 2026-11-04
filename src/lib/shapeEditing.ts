export const SHAPE_EDIT_REQUEST_EVENT = 'visionos:request-shape-editing';

export interface ShapeEditRequestDetail {
  shapeId: string;
}

export function requestShapeEditing(shapeId: string): void {
  if (!shapeId || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ShapeEditRequestDetail>(SHAPE_EDIT_REQUEST_EVENT, {
      detail: { shapeId },
    })
  );
}

export function subscribeToShapeEditing(shapeId: string, handler: () => void): () => void {
  if (!shapeId || typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ShapeEditRequestDetail>).detail;
    if (detail?.shapeId === shapeId) handler();
  };
  window.addEventListener(SHAPE_EDIT_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SHAPE_EDIT_REQUEST_EVENT, listener);
}
