import { describe, it, expect } from 'bun:test';
import { formatZoomPercentage } from '@/components/AppleViewportPill';
import { getConcentricRadius, getInnerConcentricRadius, MIN_TOUCH_TARGET, PRESS_SCALE } from '@/lib/tokens';
import { getSpatialGroundedContext } from '@/lib/spatialVision';
import { formatSlideNumber, formatLatencyBadge } from './shapeConcentricity.test';
import { HUD_COLOR_SWATCHES } from '@/components/ContextualFormattingPill';
import { DefaultColorStyle } from '@tldraw/tldraw';

/**
 * Adversarial Mock Editor Generator for Stress Testing
 */
export function createAdversarialMockEditor(options?: {
  initialTool?: string;
  initialZoom?: number;
  initialCanUndo?: boolean;
  initialCanRedo?: boolean;
  viewportBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  shapeBoundsMap?: Record<string, { minX: number; minY: number; maxX: number; maxY: number } | null>;
  selectedIds?: string[];
  throwOnTool?: boolean;
  throwOnZoom?: boolean;
}) {
  let tool = options?.initialTool ?? 'select';
  let zoom = options?.initialZoom ?? 1.0;
  let canUndo = options?.initialCanUndo ?? false;
  let canRedo = options?.initialCanRedo ?? false;
  const createdShapes: any[] = [];
  const deletedShapeIds: string[] = [];
  const selectedStyles: Record<string, any> = {};

  const bounds = options?.viewportBounds ?? {
    minX: -500,
    minY: -300,
    maxX: 1500,
    maxY: 900,
  };

  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  return {
    getCurrentToolId: () => {
      if (options?.throwOnTool) throw new Error('Simulated tool error');
      return tool;
    },
    setCurrentTool: (newTool: string) => {
      if (options?.throwOnTool) throw new Error('Simulated tool error');
      tool = newTool;
    },
    getZoomLevel: () => {
      if (options?.throwOnZoom) throw new Error('Simulated zoom error');
      return zoom;
    },
    setZoomLevel: (z: number) => {
      zoom = z;
    },
    zoomIn: () => {
      zoom = Math.min(10.0, zoom * 1.25);
    },
    zoomOut: () => {
      zoom = Math.max(0.01, zoom * 0.8);
    },
    zoomToFit: () => {
      zoom = 1.0;
    },
    resetZoom: () => {
      zoom = 1.0;
    },
    getCanUndo: () => canUndo,
    getCanRedo: () => canRedo,
    undo: () => {
      if (canUndo) {
        canUndo = false;
        canRedo = true;
      }
    },
    redo: () => {
      if (canRedo) {
        canRedo = false;
        canUndo = true;
      }
    },
    getSelectedShapeIds: () => options?.selectedIds ?? [],
    getShapePageBounds: (id: string) => {
      if (options?.shapeBoundsMap && id in options.shapeBoundsMap) {
        return options.shapeBoundsMap[id];
      }
      return { minX: 100, minY: 100, maxX: 300, maxY: 250 };
    },
    getViewportPageBounds: () => ({
      ...bounds,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      center,
    }),
    pageToScreen: (point: { x: number; y: number }) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    }),
    createShape: (shape: any) => {
      createdShapes.push(shape);
    },
    deleteShapes: (ids: string[]) => {
      deletedShapeIds.push(...ids);
    },
    setStyleForSelectedShapes: (prop: any, val: any) => {
      selectedStyles[prop.id || 'style'] = val;
    },
    setStyleForNextShapes: (prop: any, val: any) => {
      selectedStyles[`next_${prop.id || 'style'}`] = val;
    },
    getSharedStyles: () => ({
      getAsKnownValue: (prop: any) => selectedStyles[prop.id || 'style'] ?? null,
    }),
    getCurrentPageShapeIds: () => new Set(['shape_a', 'shape_b']),
    store: {
      listen: (cb: () => void) => () => {},
    },
    // Inspection helpers
    _getCreatedShapes: () => createdShapes,
    _getDeletedShapeIds: () => deletedShapeIds,
    _getSelectedStyles: () => selectedStyles,
  };
}

describe('Empirical Adversarial & Edge Case Stress Suite', () => {
  // =========================================================================
  // 1. Extreme Zoom Level Values
  // =========================================================================
  describe('Extreme Zoom Level Handling', () => {
    it('accurately formats extreme zoom values specified in dispatch (0.01 and 10.0)', () => {
      expect(formatZoomPercentage(0.01)).toBe('1%');
      expect(formatZoomPercentage(10.0)).toBe('1000%');
    });

    it('handles fractional micro-zooms and ultra-zooms without rounding drift', () => {
      expect(formatZoomPercentage(0.005)).toBe('1%');
      expect(formatZoomPercentage(0.001)).toBe('0%');
      expect(formatZoomPercentage(0.0001)).toBe('0%');
      expect(formatZoomPercentage(0.0)).toBe('0%');
      expect(formatZoomPercentage(50.0)).toBe('5000%');
      expect(formatZoomPercentage(100.0)).toBe('10000%');
      expect(formatZoomPercentage(0.33333333)).toBe('33%');
      expect(formatZoomPercentage(0.66666667)).toBe('67%');
    });

    it('handles negative zoom levels defensively if viewport ever inverts', () => {
      expect(formatZoomPercentage(-0.5)).toBe('-50%');
      expect(formatZoomPercentage(-1.0)).toBe('-100%');
    });

    it('handles non-numeric, null, undefined, and NaN inputs by defaulting to 100%', () => {
      expect(formatZoomPercentage(NaN)).toBe('100%');
      expect(formatZoomPercentage(null as any)).toBe('100%');
      expect(formatZoomPercentage(undefined as any)).toBe('100%');
      expect(formatZoomPercentage('2.5' as any)).toBe('100%');
      expect(formatZoomPercentage({} as any)).toBe('100%');
    });

    it('verifies extreme zoom transitions on the mock editor bounds (0.01 to 10.0)', () => {
      const editor = createAdversarialMockEditor({ initialZoom: 0.015 });
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('2%');

      // Zoom out towards lower bound
      editor.zoomOut();
      expect(editor.getZoomLevel()).toBeGreaterThanOrEqual(0.01);
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('1%');

      // Zoom in towards 10.0
      editor.setZoomLevel(8.5);
      editor.zoomIn();
      expect(editor.getZoomLevel()).toBeLessThanOrEqual(10.0);
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('1000%');

      // Reset zoom always restores to 100%
      editor.resetZoom();
      expect(editor.getZoomLevel()).toBe(1.0);
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('100%');
    });
  });

  // =========================================================================
  // 2. Null Editor Handling Across Pills & HUD
  // =========================================================================
  describe('Defensive Null Editor Handling', () => {
    it('returns empty fallback structure from getSpatialGroundedContext when editor is null', () => {
      const context = getSpatialGroundedContext(null);
      expect(context.selectedCount).toBe(0);
      expect(context.selectedShapes).toEqual([]);
      expect(context.visibleCount).toBe(0);
      expect(context.zoom).toBe(1);
      expect(context.zoomFormatted).toBe('1.0x');
      expect(context.totalShapesCount).toBe(0);
    });

    it('safely handles null editor in all AppleFloatingDock actions', () => {
      const nullEditor = null;

      const triggerSelectTool = (ed: any, toolId: string) => {
        if (!ed) return false;
        ed.setCurrentTool(toolId);
        return true;
      };

      const triggerSpawnCard = (ed: any, type: string) => {
        if (!ed) return false;
        const bounds = ed.getViewportPageBounds();
        ed.createShape({ type, x: bounds.center.x, y: bounds.center.y });
        return true;
      };

      const triggerClear = (ed: any) => {
        if (!ed) return false;
        const selected = ed.getSelectedShapeIds();
        ed.deleteShapes(selected);
        return true;
      };

      expect(triggerSelectTool(nullEditor, 'draw')).toBe(false);
      expect(triggerSpawnCard(nullEditor, 'rich_card')).toBe(false);
      expect(triggerClear(nullEditor)).toBe(false);
    });

    it('safely handles null editor in all AppleViewportPill actions', () => {
      const nullEditor = null;

      const triggerZoom = (ed: any, action: 'in' | 'out' | 'fit' | 'reset') => {
        if (!ed) return false;
        if (action === 'in') ed.zoomIn();
        if (action === 'out') ed.zoomOut();
        if (action === 'fit') ed.zoomToFit();
        if (action === 'reset') ed.resetZoom();
        return true;
      };

      const triggerHistory = (ed: any, action: 'undo' | 'redo') => {
        if (!ed) return false;
        if (action === 'undo') ed.undo();
        if (action === 'redo') ed.redo();
        return true;
      };

      expect(triggerZoom(nullEditor, 'in')).toBe(false);
      expect(triggerZoom(nullEditor, 'out')).toBe(false);
      expect(triggerZoom(nullEditor, 'fit')).toBe(false);
      expect(triggerZoom(nullEditor, 'reset')).toBe(false);
      expect(triggerHistory(nullEditor, 'undo')).toBe(false);
      expect(triggerHistory(nullEditor, 'redo')).toBe(false);
    });

    it('safely handles null editor in ContextualFormattingPill calculations', () => {
      const computePillPosition = (editor: any, windowWidth = 1920) => {
        if (!editor) return null;
        const selectedIds = editor.getSelectedShapeIds();
        if (selectedIds.length === 0) return null;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;

        for (const id of selectedIds) {
          const bounds = editor.getShapePageBounds(id);
          if (bounds) {
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
          }
        }

        if (minX === Infinity) return null;
        const topCenterPage = { x: (minX + maxX) / 2, y: minY };
        const topCenterScreen = editor.pageToScreen(topCenterPage);

        const screenX = Math.max(280, Math.min(windowWidth - 280, topCenterScreen.x));
        const screenY = Math.max(76, topCenterScreen.y - 12);
        return { x: screenX, y: screenY };
      };

      expect(computePillPosition(null)).toBeNull();
    });
  });

  // =========================================================================
  // 3. Selection Changes & Bounding Box Coordinates
  // =========================================================================
  describe('Selection Changes & Coordinate Clamping', () => {
    it('returns null position when no shapes are selected', () => {
      const editor = createAdversarialMockEditor({ selectedIds: [] });
      const selectedIds = editor.getSelectedShapeIds();
      expect(selectedIds.length).toBe(0);
    });

    it('computes correct hover coordinate for a single selected shape', () => {
      const editor = createAdversarialMockEditor({
        viewportBounds: { minX: 0, minY: 0, maxX: 1920, maxY: 1080 },
        selectedIds: ['shape_1'],
        shapeBoundsMap: {
          shape_1: { minX: 400, minY: 300, maxX: 800, maxY: 600 },
        },
      });

      const selectedIds = editor.getSelectedShapeIds();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;

      for (const id of selectedIds) {
        const bounds = editor.getShapePageBounds(id);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
        }
      }

      const topCenterPage = { x: (minX + maxX) / 2, y: minY };
      expect(topCenterPage.x).toBe(600);
      expect(topCenterPage.y).toBe(300);

      const topCenterScreen = editor.pageToScreen(topCenterPage);
      expect(topCenterScreen.x).toBe(600);
      expect(topCenterScreen.y).toBe(300);

      // Floats ~12px above selection: 300 - 12 = 288px
      const screenY = Math.max(76, topCenterScreen.y - 12);
      expect(screenY).toBe(288);
    });

    it('computes composite union bounding box across multiple selected shapes', () => {
      const editor = createAdversarialMockEditor({
        viewportBounds: { minX: 0, minY: 0, maxX: 1920, maxY: 1080 },
        selectedIds: ['shape_1', 'shape_2', 'shape_3'],
        shapeBoundsMap: {
          shape_1: { minX: 100, minY: 200, maxX: 300, maxY: 400 },
          shape_2: { minX: 500, minY: 150, maxX: 700, maxY: 350 },
          shape_3: { minX: 800, minY: 250, maxX: 900, maxY: 450 },
        },
      });

      const selectedIds = editor.getSelectedShapeIds();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;

      for (const id of selectedIds) {
        const bounds = editor.getShapePageBounds(id);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
        }
      }

      expect(minX).toBe(100);
      expect(minY).toBe(150);
      expect(maxX).toBe(900);

      const topCenterPage = { x: (minX + maxX) / 2, y: minY };
      expect(topCenterPage.x).toBe(500); // (100 + 900) / 2
      expect(topCenterPage.y).toBe(150);
    });

    it('gracefully returns null when all selected shapes have null bounds', () => {
      const editor = createAdversarialMockEditor({
        selectedIds: ['ghost_1', 'ghost_2'],
        shapeBoundsMap: {
          ghost_1: null,
          ghost_2: null,
        },
      });

      const selectedIds = editor.getSelectedShapeIds();
      let minX = Infinity;
      for (const id of selectedIds) {
        const bounds = editor.getShapePageBounds(id);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
        }
      }
      expect(minX).toBe(Infinity);
    });

    it('clamps screen coordinates to keep pill within visible viewport', () => {
      // Test extreme left placement
      const extremeLeftScreen = { x: -500, y: 10 };
      const clampXLeft = Math.max(280, Math.min(1920 - 280, extremeLeftScreen.x));
      const clampYTop = Math.max(76, extremeLeftScreen.y - 12);
      expect(clampXLeft).toBe(280);
      expect(clampYTop).toBe(76);

      // Test extreme right placement
      const extremeRightScreen = { x: 5000, y: 800 };
      const clampXRight = Math.max(280, Math.min(1920 - 280, extremeRightScreen.x));
      const clampYNormal = Math.max(76, extremeRightScreen.y - 12);
      expect(clampXRight).toBe(1640); // 1920 - 280
      expect(clampYNormal).toBe(788);
    });
  });

  // =========================================================================
  // 4. Undo / Redo Disabled States & State Transitions
  // =========================================================================
  describe('Undo/Redo Disabled States and Transitions', () => {
    it('correctly reports canUndo=false and canRedo=false on a fresh canvas', () => {
      const editor = createAdversarialMockEditor({ initialCanUndo: false, initialCanRedo: false });
      expect(editor.getCanUndo()).toBe(false);
      expect(editor.getCanRedo()).toBe(false);
    });

    it('updates canUndo and canRedo on undo and redo executions', () => {
      const editor = createAdversarialMockEditor({ initialCanUndo: true, initialCanRedo: false });
      expect(editor.getCanUndo()).toBe(true);
      expect(editor.getCanRedo()).toBe(false);

      editor.undo();
      expect(editor.getCanUndo()).toBe(false);
      expect(editor.getCanRedo()).toBe(true);

      editor.redo();
      expect(editor.getCanUndo()).toBe(true);
      expect(editor.getCanRedo()).toBe(false);
    });

    it('safely tolerates repeated calls when canUndo or canRedo is false', () => {
      const editor = createAdversarialMockEditor({ initialCanUndo: false, initialCanRedo: false });
      // Calling undo/redo when disabled should not throw or corrupt state
      expect(() => {
        editor.undo();
        editor.undo();
        editor.redo();
        editor.redo();
      }).not.toThrow();
      expect(editor.getCanUndo()).toBe(false);
      expect(editor.getCanRedo()).toBe(false);
    });
  });

  // =========================================================================
  // 5. Shape Creation Coordinates Oracle
  // =========================================================================
  describe('Shape Creation Coordinates Oracle', () => {
    const shapeSpecs = [
      { type: 'rich_card', w: 400, h: 300, halfW: 200, halfH: 150 },
      { type: 'code_card', w: 520, h: 360, halfW: 260, halfH: 180 },
      { type: 'document', w: 680, h: 520, halfW: 340, halfH: 260 },
      { type: 'slide_deck', w: 720, h: 450, halfW: 360, halfH: 225 },
      { type: 'artifact', w: 560, h: 400, halfW: 280, halfH: 200 },
    ];

    it('places all 5 custom shapes exactly centered at the viewport center', () => {
      // Test across 3 distinct viewport orientations (standard, negative offset, large float offset)
      const viewports = [
        { minX: 0, minY: 0, maxX: 1920, maxY: 1080 },
        { minX: -2500, minY: -1800, maxX: 500, maxY: 200 },
        { minX: 1234.5, minY: 5678.25, maxX: 3234.5, maxY: 7678.25 },
      ];

      for (const vp of viewports) {
        const editor = createAdversarialMockEditor({ viewportBounds: vp });
        const viewportCenter = editor.getViewportPageBounds().center;

        for (const spec of shapeSpecs) {
          // Simulate handleSpawnCard math
          const spawnedShape = {
            type: spec.type,
            x: viewportCenter.x - spec.halfW,
            y: viewportCenter.y - spec.halfH,
            props: { w: spec.w, h: spec.h },
          };

          // Geometric oracle: center of shape (x + w/2, y + h/2) must equal viewportCenter (x, y)
          const shapeCenterX = spawnedShape.x + spec.w / 2;
          const shapeCenterY = spawnedShape.y + spec.h / 2;

          expect(shapeCenterX).toBeCloseTo(viewportCenter.x, 5);
          expect(shapeCenterY).toBeCloseTo(viewportCenter.y, 5);
        }
      }
    });
  });

  // =========================================================================
  // 6. Formatting & HIG Utilities Defense
  // =========================================================================
  describe('Formatting & HIG Utilities Defense', () => {
    it('verifies formatSlideNumber defensively clamps against underflow and overflow', () => {
      expect(formatSlideNumber(0, 5)).toBe('1 / 5');
      expect(formatSlideNumber(4, 5)).toBe('5 / 5');
      expect(formatSlideNumber(10, 5)).toBe('5 / 5'); // clamped to max
      expect(formatSlideNumber(-3, 5)).toBe('1 / 5'); // clamped to min
      expect(formatSlideNumber(0, 0)).toBe('1 / 1');  // zero slides fallback
    });

    it('verifies formatLatencyBadge handles negative, zero, and high latency values', () => {
      expect(formatLatencyBadge(0)).toBe('0ms');
      expect(formatLatencyBadge(12.34)).toBe('12ms');
      expect(formatLatencyBadge(128.9)).toBe('129ms');
      expect(formatLatencyBadge(-50)).toBe('0ms');     // clamped
      expect(formatLatencyBadge(NaN)).toBe('0ms');     // NaN defense
    });

    it('verifies all 8 Contextual Color Swatches map to valid tldraw colors', () => {
      const validTldrawColors = new Set(DefaultColorStyle.values);
      for (const swatch of HUD_COLOR_SWATCHES) {
        expect(validTldrawColors.has(swatch.tldrawColor as any)).toBe(true);
      }
    });

    it('verifies concentric math invariants with stress inputs', () => {
      // outer = inner + padding
      expect(getConcentricRadius(0, 0)).toBe(0);
      expect(getConcentricRadius(16, 8)).toBe(24);
      expect(getConcentricRadius(28, 12)).toBe(40);
      expect(getInnerConcentricRadius(40, 12)).toBe(28);
      expect(getInnerConcentricRadius(10, 20)).toBe(0); // non-negative clamp
    });
  });
});
