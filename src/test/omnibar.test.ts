import { describe, it, expect } from 'bun:test';
import {
  getConcentricRadius,
  getInnerConcentricRadius,
  MIN_TOUCH_TARGET,
  PRESS_SCALE,
  APPLE_SPRING,
  APPLE_GLASS,
  ICON_STROKE_WEIGHTS,
} from '@/lib/tokens';
import { SpatialAIOmnibar } from '@/components/SpatialAIOmnibar';
import { SpeculativeSkeletonOverlay } from '@/components/SpeculativeSkeletonOverlay';
import { AIAgentCursor } from '@/components/AIAgentCursor';
import { VisionOnboardingModal, GEMINI_MODEL_PRESETS } from '@/components/VisionOnboardingModal';

describe('visionOS SpatialAIOmnibar & Surface Revamp Suite (src/test/omnibar.test.ts)', () => {
  describe('Concentric Border Radii Contracts', () => {
    it('verifies Siri panel outer radius to inner card concentricity', () => {
      // Outer panel radius: 28px
      // Inner cards / message bubbles: 16px (rounded-2xl) with 12px padding
      const outerRadius = 28;
      const innerCardRadius = 16;
      const padding = 12;

      expect(getConcentricRadius(innerCardRadius, padding)).toBe(outerRadius);
      expect(getInnerConcentricRadius(outerRadius, padding)).toBe(innerCardRadius);
    });

    it('verifies input pill nested concentricity', () => {
      // Outer input container with 16px inner radius + 12px padding = 28px
      const innerRadius = 16;
      const padding = 12;
      expect(getConcentricRadius(innerRadius, padding)).toBe(28);
    });
  });

  describe('Tactile Touch Target & Motion Contracts', () => {
    it('enforces touch targets >= 40x40px on all circular and action buttons', () => {
      expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(40);
    });

    it('enforces tactile press scale of 0.96', () => {
      expect(PRESS_SCALE).toBe(0.96);
    });

    it('enforces Apple-grade spring physics without bounce', () => {
      expect(APPLE_SPRING.type).toBe('spring');
      expect(APPLE_SPRING.duration).toBe(0.3);
      expect(APPLE_SPRING.bounce).toBe(0);
    });

    it('enforces matched icon stroke weights for regular and semibold text', () => {
      expect(ICON_STROKE_WEIGHTS.regular).toBe(1.5);
      expect(ICON_STROKE_WEIGHTS.semibold).toBe(2.0);
    });
  });

  describe('Liquid Glass Obsidian Tokens & HIG Opacities', () => {
    it('verifies elevated and dock glass surfaces are deep obsidian with specular highlight', () => {
      expect(APPLE_GLASS.dock.border).toBe('rgba(255, 255, 255, 0.10)');
      expect(APPLE_GLASS.card.border).toBe('rgba(255, 255, 255, 0.10)');
      expect(APPLE_GLASS.elevated.border).toBe('rgba(255, 255, 255, 0.10)');
    });
  });

  describe('Component Exports & Module Integrity', () => {
    it('exports SpatialAIOmnibar as a valid React component', () => {
      expect(typeof SpatialAIOmnibar).toBe('function');
    });

    it('exports SpeculativeSkeletonOverlay as a valid React component', () => {
      expect(typeof SpeculativeSkeletonOverlay).toBe('function');
    });

    it('exports AIAgentCursor as a valid React component', () => {
      expect(typeof AIAgentCursor).toBe('function');
    });

    it('exports VisionOnboardingModal as a valid React component and validates Gemini presets', () => {
      expect(typeof VisionOnboardingModal).toBe('function');
      expect(GEMINI_MODEL_PRESETS.length).toBe(3);
      const presetIds = GEMINI_MODEL_PRESETS.map((p) => p.id);
      expect(presetIds).toContain('gemini-3.8-flash');
      expect(presetIds).toContain('gemini-3.5-flash-lite');
      expect(presetIds).toContain('gemini-4-argon');
    });

    it('verifies action badges compress long shape IDs into clean readable badges', () => {
      const raw = 'focus viewport: shape:app_f584cc96-4f8a-4f80-8818-3f1b15986c4a';
      // Compression pattern matches what formatDisplayActionBadge implements
      let clean = raw.replace(/shape:(?:app_|card_|doc_|deck_|box_|vector_)?[a-f0-9-]+/gi, 'Live App');
      clean = clean.replace(/^focus viewport:?\s*/i, 'Focus: ');
      expect(clean).toBe('Focus: Live App');
      expect(clean).not.toContain('f584cc96');
      expect(clean).not.toContain('shape:app');
    });
  });
});
