import type { VisibleViewport } from './useVisibleViewport';

export interface SelectionScreenAnchor {
  x: number;
  top: number;
  bottom: number;
}

export interface FloatingToolbarPlacement {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

export interface FloatingPopoverAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FloatingViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  maxWidth: number;
  maxHeight: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function getFloatingViewportBounds(
  viewport: VisibleViewport,
  gap = 12
): FloatingViewportBounds {
  const insets = viewport.safeAreaInsets;
  const left = viewport.left + Math.max(gap, insets.left);
  const right = viewport.left + viewport.width - Math.max(gap, insets.right);
  const top = viewport.top + Math.max(gap, insets.top);
  const bottom = viewport.top + viewport.height - Math.max(gap, insets.bottom);

  return {
    left,
    top,
    right,
    bottom,
    maxWidth: Math.max(0, right - left),
    maxHeight: Math.max(0, bottom - top),
  };
}

/** Places a measured toolbar inside the unobscured visible viewport. */
export function placeFloatingToolbar(
  anchor: SelectionScreenAnchor,
  toolbar: { width: number; height: number },
  viewport: VisibleViewport,
  gap = 12
): FloatingToolbarPlacement {
  const bounds = getFloatingViewportBounds(viewport, gap);
  const { left: leftEdge, right: rightEdge, top: topEdge, bottom: bottomEdge } = bounds;
  const maximumLeft = rightEdge - toolbar.width;
  const maximumTop = bottomEdge - toolbar.height;

  const topAnchor = clamp(anchor.top, topEdge, bottomEdge);
  const bottomAnchor = clamp(anchor.bottom, topEdge, bottomEdge);
  const roomAbove = topAnchor - topEdge;
  const roomBelow = bottomEdge - bottomAnchor;
  const fitsAbove = roomAbove >= toolbar.height + gap;
  const fitsBelow = roomBelow >= toolbar.height + gap;
  const placement: 'top' | 'bottom' = fitsAbove
    ? 'top'
    : fitsBelow
      ? 'bottom'
      : roomAbove >= roomBelow ? 'top' : 'bottom';
  const proposedTop = fitsAbove
    ? topAnchor - toolbar.height - gap
    : fitsBelow
      ? bottomAnchor + gap
      : (topAnchor + bottomAnchor - toolbar.height) / 2;

  return {
    left: clamp(anchor.x - toolbar.width / 2, leftEdge, maximumLeft),
    top: clamp(proposedTop, topEdge, maximumTop),
    placement,
  };
}

/** Positions a measured toolbar menu beside its trigger without depending on the toolbar's scroll box. */
export function placeFloatingPopover(
  anchor: FloatingPopoverAnchor,
  popover: { width: number; height: number },
  viewport: VisibleViewport,
  gap = 10
): FloatingToolbarPlacement {
  const bounds = getFloatingViewportBounds(viewport);
  const { left: leftEdge, right: rightEdge, top: topEdge, bottom: bottomEdge } = bounds;
  const roomAbove = anchor.top - topEdge;
  const roomBelow = bottomEdge - anchor.bottom;
  const placement: 'top' | 'bottom' =
    roomAbove >= popover.height + gap || roomAbove >= roomBelow ? 'top' : 'bottom';
  const proposedTop = placement === 'top'
    ? anchor.top - popover.height - gap
    : anchor.bottom + gap;

  return {
    left: clamp((anchor.left + anchor.right - popover.width) / 2, leftEdge, rightEdge - popover.width),
    top: clamp(proposedTop, topEdge, bottomEdge - popover.height),
    placement,
  };
}
