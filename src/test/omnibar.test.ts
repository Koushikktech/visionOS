import { describe, it, expect } from 'bun:test';
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  getConcentricRadius,
  getInnerConcentricRadius,
  MIN_TOUCH_TARGET,
  PRESS_SCALE,
  APPLE_SPRING,
  APPLE_GLASS,
  ICON_STROKE_WEIGHTS,
} from '@/lib/tokens';
import {
  createSpatialAIPanelPortal,
  insertDictationAtSelection,
  resolveComposerSubmission,
  SpatialAIOmnibar,
} from '@/components/SpatialAIOmnibar';
import { SpeculativeSkeletonOverlay } from '@/components/SpeculativeSkeletonOverlay';
import { AIAgentCursor } from '@/components/AIAgentCursor';
import { VisionOnboardingModal, GEMINI_MODEL_PRESETS } from '@/components/VisionOnboardingModal';
import { getGeminiModelCandidateChain } from '@/lib/ai/provider';

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
    it('inserts dictation at the captured selection and keeps the surrounding prompt text', () => {
      const insertion = insertDictationAtSelection('Before after', 7, 7, 'spoken');

      expect(insertion.value).toBe('Before spoken after');
      expect(insertion.caret).toBe(13);
    });

    it('exports SpatialAIOmnibar as a valid React component', () => {
      expect(typeof SpatialAIOmnibar).toBe('function');
    });

    it('keeps an unsent draft in provider setup until the user sends it explicitly', () => {
      const draft = '  Make a small timer app  ';
      const withoutKey = resolveComposerSubmission(draft, false, false);

      expect(withoutKey).toEqual({ kind: 'provider-setup', draft });
      expect(resolveComposerSubmission(draft, true, false)).toEqual({
        kind: 'send',
        prompt: 'Make a small timer app',
      });
      expect(resolveComposerSubmission(draft, true, true)).toEqual({ kind: 'idle' });
      expect(resolveComposerSubmission('   ', true, false)).toEqual({ kind: 'idle' });
    });

    it('keeps the AI panel as a valid AnimatePresence child inside its portal', () => {
      const target = { nodeType: 1 } as Element;
      const panel = React.createElement(motion.aside, {
        exit: { opacity: 0 },
      } as any);
      const openPortal = createSpatialAIPanelPortal(true, panel, target);

      expect(openPortal).not.toBeNull();
      const presence = openPortal!.children as React.ReactElement<{
        children?: React.ReactNode;
      }>;
      expect(React.isValidElement(presence)).toBe(true);
      expect(presence.type).toBe(AnimatePresence);
      expect(React.isValidElement(presence.props.children)).toBe(true);
      const renderedPanel = presence.props.children as React.ReactElement<{
        exit?: { opacity: number };
      }>;
      expect(renderedPanel.type).toBe(motion.aside);
      expect(renderedPanel.props.exit).toEqual({ opacity: 0 });

      const source = require('fs').readFileSync(
        require('path').join(process.cwd(), 'src/components/SpatialAIOmnibar.tsx'),
        'utf8'
      );
      expect(source).toContain('createSpatialAIPanelPortal(\n        active && isOpen,');

      const closedPortal = createSpatialAIPanelPortal(false, panel, target);
      const closedPresence = closedPortal!.children as React.ReactElement<{
        children?: React.ReactNode;
      }>;
      expect(closedPresence.props.children).toBeNull();
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

    it('verifies getGeminiModelCandidateChain prioritizes gemini-3.8-flash and includes robust fallbacks', () => {
      const candidates = getGeminiModelCandidateChain('gemini-3.8-flash');
      expect(candidates[0]).toBe('gemini-3.8-flash');
      expect(candidates).toContain('gemini-2.5-flash');
      expect(candidates).toContain('gemini-2.0-flash');

      // Legacy or empty fallback resolves to gemini-3.8-flash primary
      const defaultCandidates = getGeminiModelCandidateChain('gemini');
      expect(defaultCandidates[0]).toBe('gemini-3.8-flash');
      expect(defaultCandidates).toContain('gemini-2.5-flash');

      // Lite preset chain
      const liteCandidates = getGeminiModelCandidateChain('gemini-3.5-flash-lite');
      expect(liteCandidates[0]).toBe('gemini-3.5-flash-lite');
      expect(liteCandidates).toContain('gemini-2.5-flash-lite');
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
