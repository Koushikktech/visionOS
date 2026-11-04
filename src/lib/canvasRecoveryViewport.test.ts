import { describe, expect, it } from 'bun:test';
import { getCanvasRecoveryDialogLayout } from './canvasRecoveryViewport';

describe('canvas recovery dialog viewport bounds', () => {
  it('caps the review at 640 by 320 and respects mobile safe areas', () => {
    const layout = getCanvasRecoveryDialogLayout({
      left: 0,
      top: 0,
      width: 320,
      height: 568,
      safeAreaInsets: { top: 24, right: 0, bottom: 20, left: 0 },
    });

    expect(layout.dialogWidth).toBe(296);
    expect(layout.dialogMaxHeight).toBe(320);
    expect(layout.paddingTop).toBe(24);
    expect(layout.paddingBottom).toBe(20);
  });

  it('shrinks and follows the visible viewport when the keyboard is open', () => {
    const layout = getCanvasRecoveryDialogLayout({
      left: 0,
      top: 250,
      width: 320,
      height: 220,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    expect(layout.top).toBe(250);
    expect(layout.height).toBe(220);
    expect(layout.dialogWidth).toBeLessThanOrEqual(640);
    expect(layout.dialogMaxHeight).toBe(184);
    expect(layout.dialogMaxHeight).toBeLessThanOrEqual(layout.height);
  });

  it('keeps a desktop review below 640 by 320', () => {
    const layout = getCanvasRecoveryDialogLayout({
      left: 0,
      top: 0,
      width: 1440,
      height: 900,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    expect(layout.dialogWidth).toBe(640);
    expect(layout.dialogMaxHeight).toBe(320);
  });
});
