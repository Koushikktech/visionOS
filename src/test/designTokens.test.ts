import { describe, it, expect } from 'bun:test';
import {
  getConcentricRadius,
  getInnerConcentricRadius,
  MIN_TOUCH_TARGET,
  RECOMMENDED_TOUCH_TARGET,
  PRESS_SCALE,
  APPLE_EASE,
  APPLE_SPRING,
  ICON_STROKE_WEIGHTS,
  FONT_STACKS,
  APPLE_GLASS,
} from '@/lib/tokens';

/**
 * Utility helper to parse rgba() strings into numerical components
 */
function parseRgba(rgbaStr: string): { r: number; g: number; b: number; a: number } {
  const match = rgbaStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!match) {
    throw new Error(`Invalid rgba string: "${rgbaStr}"`);
  }
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
    a: match[4] !== undefined ? parseFloat(match[4]) : 1.0,
  };
}

describe('Design Tokens & HIG Compliance Suite (src/test/designTokens.test.ts)', () => {
  // =========================================================================
  // 1. Concentric Border Radii Rule: outer = inner + padding
  // =========================================================================
  describe('Concentric Border Radii Formula', () => {
    it('calculates outer radius accurately for standard container combinations', () => {
      // Card padding 16px + inner 12px = outer 28px
      expect(getConcentricRadius(12, 16)).toBe(28);

      // Card padding 12px + inner 8px = outer 20px
      expect(getConcentricRadius(8, 12)).toBe(20);

      // Modal/Dialog padding 24px + inner 16px = outer 40px
      expect(getConcentricRadius(16, 24)).toBe(40);

      // Floating dock padding 8px + inner tool button 12px = outer 20px
      expect(getConcentricRadius(12, 8)).toBe(20);

      // Floating pill padding 4px + inner 8px = outer 12px
      expect(getConcentricRadius(8, 4)).toBe(12);

      // Compact card padding 10px + inner 6px = outer 16px
      expect(getConcentricRadius(6, 10)).toBe(16);
    });

    it('handles boundary and edge cases without producing invalid radii', () => {
      // Zero padding: outer radius equals inner radius
      expect(getConcentricRadius(16, 0)).toBe(16);

      // Zero inner radius: outer radius equals padding
      expect(getConcentricRadius(0, 12)).toBe(12);

      // Both zero
      expect(getConcentricRadius(0, 0)).toBe(0);

      // Decimal values
      expect(getConcentricRadius(10.5, 5.5)).toBe(16);
      expect(getConcentricRadius(7.25, 4.75)).toBe(12);

      // Negative values clamped to 0
      expect(getConcentricRadius(-5, 10)).toBe(5);
      expect(getConcentricRadius(-20, 5)).toBe(0);
      expect(getConcentricRadius(10, -15)).toBe(0);
    });

    it('calculates inner radius inversely and satisfies mathematical symmetry', () => {
      const testCases = [
        { inner: 12, padding: 16, outer: 28 },
        { inner: 8, padding: 12, outer: 20 },
        { inner: 16, padding: 24, outer: 40 },
        { inner: 4, padding: 8, outer: 12 },
      ];

      for (const { inner, padding, outer } of testCases) {
        expect(getConcentricRadius(inner, padding)).toBe(outer);
        expect(getInnerConcentricRadius(outer, padding)).toBe(inner);
      }

      // Clamps to 0 when padding >= outer radius
      expect(getInnerConcentricRadius(10, 15)).toBe(0);
      expect(getInnerConcentricRadius(8, 8)).toBe(0);
    });
  });

  // =========================================================================
  // 2. Touch Target Minimum Size Constant (>= 40px)
  // =========================================================================
  describe('Touch / Click Target Minimums', () => {
    it('enforces desktop touch target constant >= 40px', () => {
      expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(40);
      expect(MIN_TOUCH_TARGET).toBe(40);

      // Hit area surface bounds >= 40x40 = 1600px^2
      const minHitArea = MIN_TOUCH_TARGET * MIN_TOUCH_TARGET;
      expect(minHitArea).toBeGreaterThanOrEqual(1600);
    });

    it('enforces mobile / standard recommended touch target >= 44px', () => {
      expect(RECOMMENDED_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
      expect(RECOMMENDED_TOUCH_TARGET).toBe(44);
    });

    it('enforces tactile press scale of 0.96 with motion restraint', () => {
      expect(PRESS_SCALE).toBe(0.96);
      // Tactile design rule: scale must be between 0.95 and 0.98 (never < 0.95)
      expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.95);
      expect(PRESS_SCALE).toBeLessThanOrEqual(0.98);
    });

    it('configures Apple spring with duration 0.3 and zero bounce', () => {
      expect(APPLE_SPRING.type).toBe('spring');
      expect(APPLE_SPRING.duration).toBe(0.3);
      expect(APPLE_SPRING.bounce).toBe(0);
    });

    it('defines standard Apple fluid easing curve', () => {
      expect(APPLE_EASE).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });
  });

  // =========================================================================
  // 3. Icon Stroke Weight Matching Rules
  // =========================================================================
  describe('Icon Stroke Weight Matching Rules', () => {
    it('matches 1.5px stroke beside regular 400 text', () => {
      expect(ICON_STROKE_WEIGHTS.regular).toBe(1.5);
    });

    it('matches 2.0px stroke beside semibold 600 text', () => {
      expect(ICON_STROKE_WEIGHTS.semibold).toBe(2.0);
    });

    it('maintains correct optical weight ratio between regular and semibold', () => {
      const ratio = ICON_STROKE_WEIGHTS.semibold / ICON_STROKE_WEIGHTS.regular;
      // 2.0 / 1.5 = 1.333...
      expect(ratio).toBeCloseTo(1.333, 2);
    });

    it('maps font weights dynamically to appropriate stroke weights', () => {
      const getStrokeForWeight = (weight: number): number => {
        return weight >= 600 ? ICON_STROKE_WEIGHTS.semibold : ICON_STROKE_WEIGHTS.regular;
      };

      expect(getStrokeForWeight(400)).toBe(1.5);
      expect(getStrokeForWeight(500)).toBe(1.5);
      expect(getStrokeForWeight(600)).toBe(2.0);
      expect(getStrokeForWeight(700)).toBe(2.0);
    });
  });

  // =========================================================================
  // 4. Obsidian Glass Color Values & Opacity Ranges
  // =========================================================================
  describe('Obsidian Glass Values & HIG Opacity Ranges', () => {
    it('verifies dock glass background opacity is within range 0.78 to 0.85', () => {
      const startRgba = parseRgba(APPLE_GLASS.dock.bgStart);
      const endRgba = parseRgba(APPLE_GLASS.dock.bgEnd);

      expect(startRgba.a).toBeGreaterThanOrEqual(0.78);
      expect(startRgba.a).toBeLessThanOrEqual(0.85);

      expect(endRgba.a).toBeGreaterThanOrEqual(0.78);
      expect(endRgba.a).toBeLessThanOrEqual(0.85);

      // Verify dark obsidian tone (neutral dark, not neon saturated)
      expect(startRgba.r).toBeLessThan(30);
      expect(startRgba.g).toBeLessThan(30);
      expect(startRgba.b).toBeLessThan(40);
    });

    it('verifies dock glass specular border opacity is within range 0.08 to 0.12', () => {
      const borderRgba = parseRgba(APPLE_GLASS.dock.border);
      expect(borderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(borderRgba.a).toBeLessThanOrEqual(0.12);
      // Must be pure white highlight
      expect(borderRgba.r).toBe(255);
      expect(borderRgba.g).toBe(255);
      expect(borderRgba.b).toBe(255);
    });

    it('verifies pill glass opacity is within range 0.78 to 0.85 and border in 0.08 to 0.12', () => {
      const bgRgba = parseRgba(APPLE_GLASS.pill.bg);
      expect(bgRgba.a).toBeGreaterThanOrEqual(0.78);
      expect(bgRgba.a).toBeLessThanOrEqual(0.85);

      const borderRgba = parseRgba(APPLE_GLASS.pill.border);
      expect(borderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(borderRgba.a).toBeLessThanOrEqual(0.12);
    });

    it('verifies card glass opacity is within range 0.78 to 0.85 and border in 0.08 to 0.12', () => {
      const bgRgba = parseRgba(APPLE_GLASS.card.bg);
      expect(bgRgba.a).toBeGreaterThanOrEqual(0.78);
      expect(bgRgba.a).toBeLessThanOrEqual(0.85);

      const borderRgba = parseRgba(APPLE_GLASS.card.border);
      expect(borderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(borderRgba.a).toBeLessThanOrEqual(0.12);
    });

    it('verifies card header border opacity is within range 0.08 to 0.12', () => {
      const headerBorderRgba = parseRgba(APPLE_GLASS.header.border);
      expect(headerBorderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(headerBorderRgba.a).toBeLessThanOrEqual(0.12);
    });

    it('verifies elevated and popover glass surfaces have specular borders in 0.08 to 0.12', () => {
      const popoverBorderRgba = parseRgba(APPLE_GLASS.popover.border);
      expect(popoverBorderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(popoverBorderRgba.a).toBeLessThanOrEqual(0.12);

      const elevatedBorderRgba = parseRgba(APPLE_GLASS.elevated.border);
      expect(elevatedBorderRgba.a).toBeGreaterThanOrEqual(0.08);
      expect(elevatedBorderRgba.a).toBeLessThanOrEqual(0.12);
    });
  });

  // =========================================================================
  // 5. Typography Font Stacks
  // =========================================================================
  describe('Apple Typography Stacks', () => {
    it('enforces SF Pro system font stack for sans', () => {
      expect(FONT_STACKS.sans).toContain('-apple-system');
      expect(FONT_STACKS.sans).toContain('BlinkMacSystemFont');
      expect(FONT_STACKS.sans).toContain('SF Pro Text');
    });

    it('enforces SF Mono system font stack for mono', () => {
      expect(FONT_STACKS.mono).toContain('SF Mono');
      expect(FONT_STACKS.mono).toContain('Menlo');
      expect(FONT_STACKS.mono).toContain('monospace');
    });
  });
});
