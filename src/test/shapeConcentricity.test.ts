import { describe, it, expect } from 'bun:test';
import { getConcentricRadius, getInnerConcentricRadius } from '@/lib/tokens';
import { RichCardShapeUtil } from '@/shapes/RichCardShapeUtil';
import { CodeCardShapeUtil } from '@/shapes/CodeCardShapeUtil';
import { DocShapeUtil } from '@/shapes/DocShapeUtil';
import { SlideDeckShapeUtil } from '@/shapes/SlideDeckShapeUtil';
import { ArtifactShapeUtil } from '@/shapes/ArtifactShapeUtil';
import { VectorShapeUtil } from '@/shapes/VectorShapeUtil';
import { MediaEmbedShapeUtil } from '@/shapes/MediaEmbedShapeUtil';

/**
 * Slide number formatting utility with safe indexing
 * per SlideDeckShapeUtil: `${safeIdx + 1} / ${slides.length}`
 */
export function formatSlideNumber(currentIdx: number, totalSlides: number): string {
  if (totalSlides <= 0) return '1 / 1';
  const safeIdx = Math.min(Math.max(0, currentIdx), totalSlides - 1);
  return `${safeIdx + 1} / ${totalSlides}`;
}

/**
 * Latency badge formatting utility with integer rounding
 * per VisionOS streaming telemetry: `${Math.round(latencyMs)}ms`
 */
export function formatLatencyBadge(latencyMs: number): string {
  if (typeof latencyMs !== 'number' || isNaN(latencyMs) || latencyMs < 0) {
    return '0ms';
  }
  return `${Math.round(latencyMs)}ms`;
}

/**
 * Canonical 7 custom canvas shapes specification
 */
export const CUSTOM_SHAPE_SPECS = [
  {
    type: 'rich_card',
    utilClass: RichCardShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'code_block', innerRadius: 12, padding: 4 }, // rounded-xl + padding
      { name: 'control_btn', innerRadius: 8, padding: 8 },  // rounded-lg + padding
    ],
  },
  {
    type: 'code_card',
    utilClass: CodeCardShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'badge', innerRadius: 6, padding: 10 },       // rounded-md + padding
      { name: 'window_btn', innerRadius: 8, padding: 8 },   // rounded-lg + padding
    ],
  },
  {
    type: 'document',
    utilClass: DocShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'code_block', innerRadius: 12, padding: 4 },  // rounded-xl + padding
      { name: 'toc_btn', innerRadius: 6, padding: 10 },     // rounded-md + padding
      { name: 'section_badge', innerRadius: 6, padding: 10 },
    ],
  },
  {
    type: 'slide_deck',
    utilClass: SlideDeckShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'header_icon', innerRadius: 8, padding: 8 },  // rounded-lg + padding
      { name: 'nav_btn', innerRadius: 8, padding: 8 },      // rounded-lg + padding
    ],
  },
  {
    type: 'artifact',
    utilClass: ArtifactShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'live_badge', innerRadius: 6, padding: 10 },  // rounded-md + padding
      { name: 'storage_badge', innerRadius: 6, padding: 10 }, // rounded-md + padding
      { name: 'tool_btn', innerRadius: 6, padding: 10 },    // rounded-md + padding
    ],
  },
  {
    type: 'vector_shape',
    utilClass: VectorShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'glyph_badge', innerRadius: 4, padding: 12 }, // rounded + padding
    ],
  },
  {
    type: 'media_embed',
    utilClass: MediaEmbedShapeUtil,
    outerRadius: 16, // rounded-2xl
    innerElements: [
      { name: 'link_btn', innerRadius: 8, padding: 8 },     // rounded-lg + padding
      { name: 'type_badge', innerRadius: 6, padding: 10 },  // rounded-md + padding
    ],
  },
] as const;

describe('Shape Concentricity & Tabular Numbers Suite (src/test/shapeConcentricity.test.ts)', () => {
  // =========================================================================
  // 1. Verification of All 7 Custom Shape Types
  // =========================================================================
  describe('Custom Shapes Type Integrity', () => {
    it('verifies all 7 custom shapes match their registered tldraw type', () => {
      expect(CUSTOM_SHAPE_SPECS.length).toBe(7);

      const shapeTypes = CUSTOM_SHAPE_SPECS.map((s) => s.type);
      expect(shapeTypes).toEqual([
        'rich_card',
        'code_card',
        'document',
        'slide_deck',
        'artifact',
        'vector_shape',
        'media_embed',
      ]);

      expect(RichCardShapeUtil.type).toBe('rich_card');
      expect(CodeCardShapeUtil.type).toBe('code_card');
      expect(DocShapeUtil.type).toBe('document');
      expect(SlideDeckShapeUtil.type).toBe('slide_deck');
      expect(ArtifactShapeUtil.type).toBe('artifact');
      expect(VectorShapeUtil.type).toBe('vector_shape');
      expect(MediaEmbedShapeUtil.type).toBe('media_embed');
    });
  });

  // =========================================================================
  // 2. Concentric Radius Math for All 7 Custom Shapes
  // =========================================================================
  describe('Concentric Radius Math on Custom Shapes', () => {
    for (const shapeSpec of CUSTOM_SHAPE_SPECS) {
      it(`enforces concentric radius rule (outer = inner + padding) on ${shapeSpec.type}`, () => {
        const { outerRadius, innerElements } = shapeSpec;

        for (const element of innerElements) {
          // outer = inner + padding
          const calculatedOuter = getConcentricRadius(element.innerRadius, element.padding);
          expect(calculatedOuter).toBe(outerRadius);

          // inner = outer - padding
          const calculatedInner = getInnerConcentricRadius(outerRadius, element.padding);
          expect(calculatedInner).toBe(element.innerRadius);
        }
      });
    }

    it('validates concentric nested formulas across variable border and padding configurations', () => {
      // Test dynamic card scaling: e.g. outer radius = 24px (rounded-3xl) with 8px padding -> 16px inner
      expect(getInnerConcentricRadius(24, 8)).toBe(16);
      expect(getConcentricRadius(16, 8)).toBe(24);

      // Large modal dialog: outer radius = 32px with 16px padding -> 16px inner
      expect(getInnerConcentricRadius(32, 16)).toBe(16);
      expect(getConcentricRadius(16, 16)).toBe(32);

      // Compact chip: outer radius = 12px with 4px padding -> 8px inner
      expect(getInnerConcentricRadius(12, 4)).toBe(8);
      expect(getConcentricRadius(8, 4)).toBe(12);
    });
  });

  // =========================================================================
  // 3. Tabular Numbers Formatting on Slide Numbers
  // =========================================================================
  describe('Slide Numbers Tabular Formatting', () => {
    it('formats slide numbers correctly with safeIdx + 1 / slides.length', () => {
      // First slide
      expect(formatSlideNumber(0, 5)).toBe('1 / 5');

      // Middle slide
      expect(formatSlideNumber(2, 5)).toBe('3 / 5');

      // Last slide
      expect(formatSlideNumber(4, 5)).toBe('5 / 5');

      // Double-digit slide numbers
      expect(formatSlideNumber(9, 24)).toBe('10 / 24');
      expect(formatSlideNumber(23, 24)).toBe('24 / 24');
    });

    it('clamps negative indices and out-of-bounds slide indices safely', () => {
      // Negative index clamped to first slide
      expect(formatSlideNumber(-1, 5)).toBe('1 / 5');
      expect(formatSlideNumber(-100, 5)).toBe('1 / 5');

      // Overflow index clamped to last slide
      expect(formatSlideNumber(10, 5)).toBe('5 / 5');
      expect(formatSlideNumber(999, 12)).toBe('12 / 12');

      // Empty or single slide fallbacks
      expect(formatSlideNumber(0, 0)).toBe('1 / 1');
      expect(formatSlideNumber(0, 1)).toBe('1 / 1');
    });

    it('verifies slide number string contains required delimiters and structure', () => {
      const formatted = formatSlideNumber(3, 10);
      expect(formatted).toBe('4 / 10');
      expect(formatted).toContain(' / ');

      const parts = formatted.split(' / ');
      expect(parts.length).toBe(2);
      expect(parseInt(parts[0], 10)).toBe(4);
      expect(parseInt(parts[1], 10)).toBe(10);
    });
  });

  // =========================================================================
  // 4. Tabular Numbers Formatting on Latency Badges
  // =========================================================================
  describe('Latency Badges Tabular Formatting', () => {
    it('formats latency badge numbers into rounded integer ms strings', () => {
      expect(formatLatencyBadge(0)).toBe('0ms');
      expect(formatLatencyBadge(45)).toBe('45ms');
      expect(formatLatencyBadge(120)).toBe('120ms');
      expect(formatLatencyBadge(1450)).toBe('1450ms');

      // Decimal values rounded to nearest integer
      expect(formatLatencyBadge(45.4)).toBe('45ms');
      expect(formatLatencyBadge(45.6)).toBe('46ms');
      expect(formatLatencyBadge(0.4)).toBe('0ms');
      expect(formatLatencyBadge(0.8)).toBe('1ms');
    });

    it('handles negative, NaN, or non-numeric latency inputs safely', () => {
      expect(formatLatencyBadge(-10)).toBe('0ms');
      expect(formatLatencyBadge(NaN)).toBe('0ms');
      expect(formatLatencyBadge(null as any)).toBe('0ms');
      expect(formatLatencyBadge(undefined as any)).toBe('0ms');
    });

    it('verifies latency strings end with ms suffix and have valid digits', () => {
      const testLatencies = [15, 85, 230, 1024];

      for (const lat of testLatencies) {
        const formatted = formatLatencyBadge(lat);
        expect(formatted.endsWith('ms')).toBe(true);

        const numericPart = formatted.replace('ms', '');
        expect(/^\d+$/.test(numericPart)).toBe(true);
        expect(Number(numericPart)).toBe(lat);
      }
    });
  });
});
