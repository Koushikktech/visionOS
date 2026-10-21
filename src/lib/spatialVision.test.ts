import { describe, it, expect } from 'bun:test';
import {
  extractBase64,
  calculateMakeRealPlacement,
  getSpatialGroundedContext,
  extractPlainTextFromRichText,
  extractShapeSemanticText,
} from './spatialVision';

describe('spatialVision utilities', () => {
  describe('extractBase64', () => {
    it('extracts mimeType and raw base64 from a PNG Data URL', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
      const result = extractBase64(dataUrl);
      expect(result.mimeType).toBe('image/png');
      expect(result.base64).toBe('iVBORw0KGgoAAAANSUhEUgAAAAUA');
    });

    it('extracts mimeType and raw base64 from a JPEG Data URL', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD';
      const result = extractBase64(dataUrl);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.base64).toBe('/9j/4AAQSkZJRgABAQEASABIAAD');
    });

    it('handles raw base64 strings gracefully defaulting to image/png', () => {
      const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUA';
      const result = extractBase64(rawBase64);
      expect(result.mimeType).toBe('image/png');
      expect(result.base64).toBe(rawBase64);
    });
  });

  describe('extractPlainTextFromRichText', () => {
    it('returns undefined for empty, null, or invalid inputs', () => {
      expect(extractPlainTextFromRichText(undefined)).toBeUndefined();
      expect(extractPlainTextFromRichText(null)).toBeUndefined();
      expect(extractPlainTextFromRichText('')).toBeUndefined();
      expect(extractPlainTextFromRichText({})).toBeUndefined();
    });

    it('returns trimmed string for string inputs', () => {
      expect(extractPlainTextFromRichText('   Hello World   ')).toBe('Hello World');
    });

    it('extracts nested text blocks from tldraw v3 richText AST', () => {
      const richText = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'VisionOS ' },
              { type: 'text', text: 'Architecture' },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Spatial Vision Engine' }],
          },
        ],
      };
      const text = extractPlainTextFromRichText(richText);
      expect(text).toBe('VisionOS Architecture\nSpatial Vision Engine');
    });
  });

  describe('extractShapeSemanticText', () => {
    it('extracts content from rich card props', () => {
      const props = { content: '## Microservice Specs\nRedis cluster' };
      expect(extractShapeSemanticText(props)).toBe('## Microservice Specs\nRedis cluster');
    });

    it('extracts text from standard shapes', () => {
      const props = { text: 'User Onboarding Flow' };
      expect(extractShapeSemanticText(props)).toBe('User Onboarding Flow');
    });

    it('extracts text from richText AST in props', () => {
      const props = {
        richText: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Interactive Component' }],
            },
          ],
        },
      };
      expect(extractShapeSemanticText(props)).toBe('Interactive Component');
    });

    it('extracts sections from document shapes', () => {
      const props = {
        sections: [
          { title: 'Intro', content: 'System overview' },
          { title: 'Design', content: 'Linear simplex Kiwi solver' },
        ],
      };
      expect(extractShapeSemanticText(props)).toBe('Intro: System overview\n\nDesign: Linear simplex Kiwi solver');
    });

    it('extracts code snippet from code card props', () => {
      const props = { code: 'const solver = new Solver();' };
      expect(extractShapeSemanticText(props)).toBe('const solver = new Solver();');
    });
  });

  describe('calculateMakeRealPlacement', () => {
    it('places artifact to the right of standard-sized bounds using Kiwi solver', () => {
      const bounds = {
        minX: 100,
        minY: 200,
        maxX: 500,
        maxY: 450,
        w: 400,
        h: 250,
      };

      // When anchor shape ID is provided
      const placementWithAnchor = calculateMakeRealPlacement(bounds, 'shape:card_1');
      expect(placementWithAnchor.w).toBe(780);
      expect(placementWithAnchor.h).toBe(540);
      expect(placementWithAnchor.x).toBe(548); // maxX (500) + margin (48)
      expect(placementWithAnchor.y).toBe(200); // minY
      expect(placementWithAnchor.relative).toBe('right_of:shape:card_1');

      // When anchor shape ID is omitted (selection fallback)
      const placementDefault = calculateMakeRealPlacement(bounds);
      expect(placementDefault.x).toBe(548);
      expect(placementDefault.y).toBe(200);
      expect(placementDefault.relative).toBe('right_of:selection');
    });

    it('places artifact below wide sketches (>900px wide) using Kiwi solver', () => {
      const bounds = {
        minX: 50,
        minY: 100,
        maxX: 1100,
        maxY: 400,
        w: 1050,
        h: 300,
      };

      // When anchor shape ID is provided
      const placementWithAnchor = calculateMakeRealPlacement(bounds, 'shape:wide_sketch');
      expect(placementWithAnchor.w).toBe(780);
      expect(placementWithAnchor.h).toBe(540);
      expect(placementWithAnchor.x).toBe(50); // minX
      expect(placementWithAnchor.y).toBe(448); // maxY (400) + margin (48)
      expect(placementWithAnchor.relative).toBe('below:shape:wide_sketch');

      // When anchor shape ID is omitted
      const placementDefault = calculateMakeRealPlacement(bounds);
      expect(placementDefault.x).toBe(50);
      expect(placementDefault.y).toBe(448);
      expect(placementDefault.relative).toBe('below:selection');
    });

    it('honors custom desired width and height dimensions when provided', () => {
      const bounds = { minX: 100, minY: 100, maxX: 400, maxY: 300, w: 300, h: 200 };
      const placement = calculateMakeRealPlacement(bounds, 'shape:card_1', 880, 600);
      expect(placement.w).toBe(880);
      expect(placement.h).toBe(600);
      expect(placement.x).toBe(448); // 400 + 48
      expect(placement.y).toBe(100);
    });

    it('avoids collision with existing canvas shapes to prevent overlapping', () => {
      const bounds = { minX: 100, minY: 100, maxX: 400, maxY: 300, w: 300, h: 200 };
      // Simulate an existing shape directly in the right-hand placement spot (448 to 1248, 100 to 700)
      const existingShapes = [
        { minX: 440, minY: 80, maxX: 1100, maxY: 650 },
      ];

      const placement = calculateMakeRealPlacement(bounds, 'shape:card_1', 800, 560, existingShapes);
      expect(placement.w).toBe(800);
      expect(placement.h).toBe(560);
      // It should NOT be at (448, 100) because that overlaps the existing shape!
      const overlap = !(
        placement.x + placement.w <= 440 ||
        placement.x >= 1100 ||
        placement.y + placement.h <= 80 ||
        placement.y >= 650
      );
      expect(overlap).toBe(false);
    });
  });

  describe('getSpatialGroundedContext', () => {
    it('returns empty fallback structure when editor is null', () => {
      const ctx = getSpatialGroundedContext(null);
      expect(ctx.selectedCount).toBe(0);
      expect(ctx.selectedShapes).toEqual([]);
      expect(ctx.visibleCount).toBe(0);
      expect(ctx.zoom).toBe(1);
      expect(ctx.zoomFormatted).toBe('1.0x');
      expect(ctx.totalShapesCount).toBe(0);
    });

    it('extracts grounded context from an editor instance mock', () => {
      const mockEditor: any = {
        getSelectedShapes: () => [
          {
            id: 'shape:card_1',
            type: 'rich_card',
            props: { title: 'Auth Service', archetype: 'research', color: 'light-violet' },
          },
          {
            id: 'shape:code_2',
            type: 'code_card',
            props: { title: 'login.ts', language: 'typescript', code: 'export function login() {}' },
          },
        ],
        getShapePageBounds: (id: string) => ({
          minX: 100,
          minY: 150,
          maxX: 400,
          maxY: 350,
          w: 300,
          h: 200,
        }),
        getViewportPageBounds: () => ({
          x: 0,
          y: 0,
          w: 1200,
          h: 800,
          minX: 0,
          minY: 0,
          maxX: 1200,
          maxY: 800,
        }),
        getCurrentPageShapeIds: () => new Set(['shape:card_1', 'shape:code_2', 'shape:outside']),
        getZoomLevel: () => 1.25,
        getViewportScreenCenter: () => ({ x: 600, y: 400 }),
        screenToPage: (pt: any) => ({ x: pt.x, y: pt.y }),
      };

      const ctx = getSpatialGroundedContext(mockEditor);
      expect(ctx.selectedCount).toBe(2);
      expect(ctx.selectedShapes[0].id).toBe('shape:card_1');
      expect(ctx.selectedShapes[0].type).toBe('rich_card');
      expect(ctx.selectedShapes[0].title).toBe('Auth Service');
      expect(ctx.selectedShapes[1].id).toBe('shape:code_2');
      expect(ctx.selectedShapes[1].language).toBe('typescript');
      expect(ctx.selectedShapes[1].code).toBe('export function login() {}');
      expect(ctx.zoom).toBe(1.25);
      expect(ctx.zoomFormatted).toBe('1.3x');
      expect(ctx.totalShapesCount).toBe(3);
    });
  });
});
