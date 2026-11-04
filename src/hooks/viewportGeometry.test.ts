import { describe, expect, it } from 'bun:test';
import { getFloatingViewportBounds, placeFloatingPopover, placeFloatingToolbar } from './viewportGeometry';
import type { VisibleViewport } from './useVisibleViewport';

describe('floating popover viewport placement', () => {
  it('keeps a dock menu within a tablet viewport when the anchor sits near the bottom', () => {
    const viewport: VisibleViewport = {
      left: 0,
      top: 0,
      width: 768,
      height: 1024,
      safeAreaInsets: { top: 20, right: 0, bottom: 24, left: 0 },
    };
    const placement = placeFloatingPopover(
      { left: 620, right: 664, top: 950, bottom: 994 },
      { width: 220, height: 410 },
      viewport
    );
    const bounds = getFloatingViewportBounds(viewport);

    expect(placement.left).toBeGreaterThanOrEqual(bounds.left);
    expect(placement.left + 220).toBeLessThanOrEqual(bounds.right);
    expect(placement.top).toBeGreaterThanOrEqual(bounds.top);
    expect(placement.top + 410).toBeLessThanOrEqual(bounds.bottom);
    expect(placement.placement).toBe('top');
  });

  it('clamps a menu horizontally in a narrow visible viewport', () => {
    const viewport: VisibleViewport = {
      left: 0,
      top: 0,
      width: 320,
      height: 568,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const placement = placeFloatingPopover(
      { left: 280, right: 320, top: 500, bottom: 540 },
      { width: 220, height: 180 },
      viewport
    );

    expect(placement.left).toBeGreaterThanOrEqual(12);
    expect(placement.left + 220).toBeLessThanOrEqual(308);
    expect(placement.top + 180).toBeLessThanOrEqual(556);
  });

  it('centers the selection toolbar when a large card leaves no room above or below', () => {
    const viewport: VisibleViewport = {
      left: 0,
      top: 0,
      width: 320,
      height: 568,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const placement = placeFloatingToolbar(
      { x: 160, top: 60, bottom: 510 },
      { width: 280, height: 100 },
      viewport
    );
    const bounds = getFloatingViewportBounds(viewport);

    expect(placement.left).toBeGreaterThanOrEqual(bounds.left);
    expect(placement.left + 280).toBeLessThanOrEqual(bounds.right);
    expect(placement.top).toBe(235);
    expect(placement.top).toBeGreaterThanOrEqual(bounds.top);
    expect(placement.top + 100).toBeLessThanOrEqual(bounds.bottom);
  });
});
