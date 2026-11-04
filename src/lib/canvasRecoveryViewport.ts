import type { VisibleViewport } from '../hooks/useVisibleViewport';

export interface CanvasRecoveryDialogLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  dialogWidth: number;
  dialogMaxHeight: number;
}

/** Keeps the recovery review inside the visual viewport, including a mobile keyboard. */
export function getCanvasRecoveryDialogLayout(
  viewport: VisibleViewport,
  padding = 12
): CanvasRecoveryDialogLayout {
  const paddingTop = Math.max(viewport.safeAreaInsets.top, padding);
  const paddingRight = Math.max(viewport.safeAreaInsets.right, padding);
  const paddingBottom = Math.max(viewport.safeAreaInsets.bottom, padding);
  const paddingLeft = Math.max(viewport.safeAreaInsets.left, padding);

  return {
    left: viewport.left,
    top: viewport.top,
    width: viewport.width,
    height: viewport.height,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    dialogWidth: Math.max(1, Math.min(640, viewport.width - paddingLeft - paddingRight)),
    dialogMaxHeight: Math.max(
      1,
      Math.min(320, viewport.height - paddingTop - paddingBottom - padding)
    ),
  };
}
