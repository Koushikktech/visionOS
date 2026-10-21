import { describe, expect, it } from 'bun:test';
import {
  APPLE_EASE,
  APPLE_GLASS,
  APPLE_SPRING,
  FONT_STACKS,
  getConcentricRadius,
  getInnerConcentricRadius,
  ICON_STROKE_WEIGHTS,
  MIN_TOUCH_TARGET,
  PRESS_SCALE,
  RECOMMENDED_TOUCH_TARGET,
} from './tokens';

describe('Design Tokens & Utilities', () => {
  describe('Concentric Border Radius Calculation', () => {
    it('calculates outer radius as inner + padding', () => {
      expect(getConcentricRadius(12, 8)).toBe(20);
      expect(getConcentricRadius(16, 12)).toBe(28);
      expect(getConcentricRadius(8, 4)).toBe(12);
    });

    it('handles zero padding correctly', () => {
      expect(getConcentricRadius(16, 0)).toBe(16);
    });

    it('handles zero inner radius correctly', () => {
      expect(getConcentricRadius(0, 12)).toBe(12);
    });

    it('handles decimal values accurately', () => {
      expect(getConcentricRadius(10.5, 4.5)).toBe(15);
    });

    it('clamps negative values to non-negative results', () => {
      expect(getConcentricRadius(-5, -5)).toBe(0);
      expect(getConcentricRadius(-10, 6)).toBe(0);
    });

    it('calculates inner radius from outer radius and padding', () => {
      expect(getInnerConcentricRadius(20, 8)).toBe(12);
      expect(getInnerConcentricRadius(28, 12)).toBe(16);
      expect(getInnerConcentricRadius(6, 10)).toBe(0);
    });
  });

  describe('Touch Target Constants', () => {
    it('enforces desktop minimum touch target dimension >= 40px', () => {
      expect(MIN_TOUCH_TARGET).toBe(40);
      expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(40);
    });

    it('enforces mobile / standard recommended touch target dimension >= 44px', () => {
      expect(RECOMMENDED_TOUCH_TARGET).toBe(44);
      expect(RECOMMENDED_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
    });
  });

  describe('Tactile Physics & Motion Tokens', () => {
    it('defines tactile scale on press as 0.96', () => {
      expect(PRESS_SCALE).toBe(0.96);
    });

    it('configures Apple spring with duration 0.3 and bounce 0', () => {
      expect(APPLE_SPRING.type).toBe('spring');
      expect(APPLE_SPRING.duration).toBe(0.3);
      expect(APPLE_SPRING.bounce).toBe(0);
    });

    it('defines Apple fluid easing curve', () => {
      expect(APPLE_EASE).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });

    it('matches icon stroke weights to text weights', () => {
      expect(ICON_STROKE_WEIGHTS.regular).toBe(1.5);
      expect(ICON_STROKE_WEIGHTS.semibold).toBe(2.0);
    });
  });

  describe('Apple Obsidian Glass Tokens', () => {
    it('defines dock glass with dark obsidian hues and layered depth shadows', () => {
      expect(APPLE_GLASS.dock.bgStart).toContain('18, 18, 24');
      expect(APPLE_GLASS.dock.bgEnd).toContain('24, 24, 32');
      expect(APPLE_GLASS.dock.border).toContain('255, 255, 255, 0.10');
      expect(APPLE_GLASS.dock.blur).toContain('blur(40px)');
      expect(APPLE_GLASS.dock.shadow).toContain('0 20px 50px');
      expect(APPLE_GLASS.dock.shadow).toContain('inset');
    });

    it('defines pill glass with subtle top highlight and high blur', () => {
      expect(APPLE_GLASS.pill.bg).toContain('18, 18, 24, 0.82');
      expect(APPLE_GLASS.pill.border).toContain('255, 255, 255, 0.10');
      expect(APPLE_GLASS.pill.blur).toContain('blur(30px)');
      expect(APPLE_GLASS.pill.shadow).toContain('0 10px 30px');
    });

    it('defines popover glass with dense obsidian background and deep elevation', () => {
      expect(APPLE_GLASS.popover.bg).toContain('18, 18, 24, 0.92');
      expect(APPLE_GLASS.popover.border).toContain('255, 255, 255, 0.12');
      expect(APPLE_GLASS.popover.shadow).toContain('0 24px 60px');
    });

    it('defines card, codeBg, and elevated glass tokens cleanly without neon tints', () => {
      expect(APPLE_GLASS.card.bg).toContain('18, 18, 24, 0.80');
      expect(APPLE_GLASS.card.border).toContain('255, 255, 255, 0.10');
      expect(APPLE_GLASS.codeBg).toContain('12, 12, 16, 0.85');
      expect(APPLE_GLASS.elevated.bg).toContain('20, 20, 28, 0.85');
    });
  });

  describe('Typography Stacks', () => {
    it('enforces Apple SF Pro system typography stack for sans', () => {
      expect(FONT_STACKS.sans).toContain('-apple-system');
      expect(FONT_STACKS.sans).toContain('SF Pro Text');
      expect(FONT_STACKS.sans).toContain('SF Pro Display');
    });

    it('enforces SF Mono monospace stack for code', () => {
      expect(FONT_STACKS.mono).toContain('SF Mono');
      expect(FONT_STACKS.mono).toContain('Menlo');
      expect(FONT_STACKS.mono).toContain('Monaco');
    });
  });
});
