import { describe, expect, it } from 'bun:test';
import { getVisibleViewport } from '../hooks/useVisibleViewport';
import {
  getFloatingViewportBounds,
  placeFloatingPopover,
  placeFloatingToolbar,
} from '../hooks/viewportGeometry';

describe('visible viewport and floating toolbar geometry', () => {
  it('uses the visual viewport offsets and size when the browser keyboard resizes it', () => {
    const viewport = getVisibleViewport(
      {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: { offsetLeft: 12, offsetTop: 80, width: 700, height: 360 },
      },
      { top: 20, right: 8, bottom: 24, left: 10 }
    );

    expect(viewport).toEqual({
      left: 12,
      top: 80,
      width: 700,
      height: 360,
      safeAreaInsets: { top: 20, right: 8, bottom: 24, left: 10 },
    });
  });

  it('clamps a measured toolbar for giant selections with offscreen anchors', () => {
    const viewport = getVisibleViewport(
      { innerWidth: 400, innerHeight: 500 },
      { top: 10, right: 20, bottom: 30, left: 10 }
    );
    const toolbar = { width: 180, height: 56 };
    const position = placeFloatingToolbar(
      { x: 1200, top: -500, bottom: 1200 },
      toolbar,
      viewport
    );
    const leftEdge = viewport.left + 12;
    const rightEdge = viewport.left + viewport.width - 20;
    const topEdge = viewport.top + 12;
    const bottomEdge = viewport.top + viewport.height - 30;

    expect(position.left).toBeGreaterThanOrEqual(leftEdge);
    expect(position.left + toolbar.width).toBeLessThanOrEqual(rightEdge);
    expect(position.top).toBeGreaterThanOrEqual(topEdge);
    expect(position.top + toolbar.height).toBeLessThanOrEqual(bottomEdge);
  });

  it('keeps toolbar placement inside a keyboard-shortened viewport', () => {
    const viewport = getVisibleViewport(
      {
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: { offsetLeft: 0, offsetTop: 0, width: 1024, height: 320 },
      },
      { top: 0, right: 0, bottom: 20, left: 0 }
    );
    const toolbar = { width: 240, height: 64 };
    const position = placeFloatingToolbar(
      { x: 510, top: 290, bottom: 305 },
      toolbar,
      viewport
    );

    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + toolbar.height).toBeLessThanOrEqual(288);
  });

  it('anchors an oversized toolbar to the safe edge instead of a guessed center offset', () => {
    const viewport = getVisibleViewport(
      { innerWidth: 320, innerHeight: 240 },
      { top: 0, right: 12, bottom: 0, left: 8 }
    );
    const position = placeFloatingToolbar(
      { x: 160, top: 120, bottom: 120 },
      { width: 400, height: 80 },
      viewport
    );

    expect(position.left).toBe(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it('keeps a long toolbar scroll box and its open menu inside a 320 by 250 viewport', () => {
    const viewport = getVisibleViewport(
      { innerWidth: 320, innerHeight: 250 },
      { top: 0, right: 0, bottom: 0, left: 0 }
    );
    const bounds = getFloatingViewportBounds(viewport);
    expect(bounds.maxWidth).toBe(296);
    expect(bounds.maxHeight).toBe(226);

    // The component applies these viewport caps to its overflow-y scroll box,
    // even when the intrinsic action row is substantially larger.
    const toolbar = {
      width: Math.min(620, bounds.maxWidth),
      height: Math.min(480, bounds.maxHeight),
    };
    const toolbarPosition = placeFloatingToolbar(
      { x: 600, top: -100, bottom: 700 },
      toolbar,
      viewport
    );
    expect(toolbarPosition.left).toBeGreaterThanOrEqual(bounds.left);
    expect(toolbarPosition.left + toolbar.width).toBeLessThanOrEqual(bounds.right);
    expect(toolbarPosition.top).toBeGreaterThanOrEqual(bounds.top);
    expect(toolbarPosition.top + toolbar.height).toBeLessThanOrEqual(bounds.bottom);

    // A portaled size/color menu remains independently measurable and reachable
    // while the long action capsule continues to scroll.
    const menu = { width: 184, height: 190 };
    const menuPosition = placeFloatingPopover(
      { left: 250, top: 196, right: 290, bottom: 236 },
      menu,
      viewport
    );
    expect(menuPosition.left).toBeGreaterThanOrEqual(bounds.left);
    expect(menuPosition.left + menu.width).toBeLessThanOrEqual(bounds.right);
    expect(menuPosition.top).toBeGreaterThanOrEqual(bounds.top);
    expect(menuPosition.top + menu.height).toBeLessThanOrEqual(bounds.bottom);
  });
});
