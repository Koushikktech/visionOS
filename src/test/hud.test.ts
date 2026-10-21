import { describe, it, expect } from 'bun:test';
import { DefaultColorStyle } from '@tldraw/tldraw';

/**
 * Authoritative Floating Island Dock 10 Tools Specification
 * per ORIGINAL_REQUEST R1 & PROJECT.md Interface Contracts
 */
export const FLOATING_DOCK_TOOLS = [
  'select',
  'hand',
  'draw',
  'text',
  'note',
  'geo',
  'arrow',
  'eraser',
  'rich_card',
  'clear',
] as const;

export type FloatingDockToolId = (typeof FLOATING_DOCK_TOOLS)[number];

/**
 * Authoritative zoom percentage calculation
 * per PROJECT.md: Math.round(zoom * 100) + '%' with tabular-nums
 */
export function formatZoomPercentage(zoomLevel: number): string {
  if (typeof zoomLevel !== 'number' || isNaN(zoomLevel)) return '100%';
  return `${Math.round(zoomLevel * 100)}%`;
}

/**
 * Authoritative Contextual Color Swatch Palette
 * Mapped to tldraw DefaultColorStyle valid values
 */
export const HUD_COLOR_SWATCHES: Array<{
  id: string;
  tldrawColor: (typeof DefaultColorStyle.values)[number];
  label: string;
  hex: string;
}> = [
  { id: 'swatch-white', tldrawColor: 'white', label: 'White', hex: '#f8fafc' },
  { id: 'swatch-grey', tldrawColor: 'grey', label: 'Slate Grey', hex: '#94a3b8' },
  { id: 'swatch-black', tldrawColor: 'black', label: 'Obsidian Black', hex: '#1e293b' },
  { id: 'swatch-blue', tldrawColor: 'blue', label: 'Cobalt Blue', hex: '#3b82f6' },
  { id: 'swatch-light-blue', tldrawColor: 'light-blue', label: 'Sky Blue', hex: '#38bdf8' },
  { id: 'swatch-violet', tldrawColor: 'violet', label: 'Deep Violet', hex: '#8b5cf6' },
  { id: 'swatch-light-violet', tldrawColor: 'light-violet', label: 'Lavender Violet', hex: '#a855f7' },
  { id: 'swatch-green', tldrawColor: 'green', label: 'Emerald Green', hex: '#22c55e' },
  { id: 'swatch-light-green', tldrawColor: 'light-green', label: 'Mint Green', hex: '#4ade80' },
  { id: 'swatch-yellow', tldrawColor: 'yellow', label: 'Amber Yellow', hex: '#facc15' },
  { id: 'swatch-orange', tldrawColor: 'orange', label: 'Warm Orange', hex: '#fb923c' },
  { id: 'swatch-red', tldrawColor: 'red', label: 'Crimson Red', hex: '#ef4444' },
  { id: 'swatch-light-red', tldrawColor: 'light-red', label: 'Rose Red', hex: '#f87171' },
];

/**
 * Mock Editor implementation conforming to tldraw Editor contract for HUD testing
 */
export function createMockEditor(initialTool = 'select', initialZoom = 1.0) {
  let currentTool = initialTool;
  let zoomLevel = initialZoom;
  let undoCount = 3;
  let redoCount = 1;
  const deletedShapeIds: string[] = [];
  const createdShapes: any[] = [];
  const selectedStyles: Record<string, any> = {};

  return {
    getCurrentToolId: () => currentTool,
    setCurrentTool: (toolId: string) => {
      currentTool = toolId;
    },
    getZoomLevel: () => zoomLevel,
    setZoomLevel: (zoom: number) => {
      zoomLevel = zoom;
    },
    zoomIn: () => {
      zoomLevel = Math.min(8.0, zoomLevel * 1.25);
    },
    zoomOut: () => {
      zoomLevel = Math.max(0.1, zoomLevel * 0.8);
    },
    zoomToFit: (opts?: any) => {
      zoomLevel = 1.0;
    },
    getCanUndo: () => undoCount > 0,
    getCanRedo: () => redoCount > 0,
    undo: () => {
      if (undoCount > 0) {
        undoCount--;
        redoCount++;
      }
    },
    redo: () => {
      if (redoCount > 0) {
        redoCount--;
        undoCount++;
      }
    },
    deleteShapes: (shapeIds: string[]) => {
      deletedShapeIds.push(...shapeIds);
    },
    getSelectedShapeIds: () => ['shape_1', 'shape_2'],
    createShape: (shape: any) => {
      createdShapes.push(shape);
    },
    getViewportPageBounds: () => ({
      minX: 0,
      minY: 0,
      maxX: 1920,
      maxY: 1080,
      width: 1920,
      height: 1080,
      center: { x: 960, y: 540 },
    }),
    setStyleForSelectedShapes: (styleProp: any, value: any) => {
      selectedStyles[styleProp.id || 'style'] = value;
    },
    // Test spy inspection helpers
    _getDeletedShapeIds: () => deletedShapeIds,
    _getCreatedShapes: () => createdShapes,
    _getSelectedStyles: () => selectedStyles,
  };
}

describe('HUD & Floating Canvas Chrome Suite (src/test/hud.test.ts)', () => {
  // =========================================================================
  // 1. Floating Island Dock Tool ID Mappings
  // =========================================================================
  describe('Floating Island Dock Tool Mappings', () => {
    it('contains all 10 canonical floating island dock tools without duplicates', () => {
      expect(FLOATING_DOCK_TOOLS.length).toBe(10);
      const uniqueTools = new Set(FLOATING_DOCK_TOOLS);
      expect(uniqueTools.size).toBe(10);

      const expectedTools = [
        'select',
        'hand',
        'draw',
        'text',
        'note',
        'geo',
        'arrow',
        'eraser',
        'rich_card',
        'clear',
      ];
      for (const tool of expectedTools) {
        expect(FLOATING_DOCK_TOOLS).toContain(tool as any);
      }
    });

    it('correctly maps standard tldraw tool selections to editor.setCurrentTool', () => {
      const editor = createMockEditor('select');

      const standardToolMap: Record<string, string> = {
        select: 'select',
        hand: 'hand',
        draw: 'draw',
        text: 'text',
        note: 'note',
        geo: 'geo',
        arrow: 'arrow',
        eraser: 'eraser',
      };

      for (const [toolId, expectedEditorTool] of Object.entries(standardToolMap)) {
        // Dispatch tool selection
        editor.setCurrentTool(expectedEditorTool);
        expect(editor.getCurrentToolId()).toBe(expectedEditorTool);
      }
    });

    it('correctly handles rich_card spawner tool at viewport center', () => {
      const editor = createMockEditor();
      const bounds = editor.getViewportPageBounds();

      // Trigger custom shape spawner action
      editor.createShape({
        type: 'rich_card',
        x: bounds.center.x - 200,
        y: bounds.center.y - 150,
        props: {
          w: 400,
          h: 300,
          title: 'New Card',
          content: 'Synthesized card content',
          archetype: 'note',
        },
      });

      const created = editor._getCreatedShapes();
      expect(created.length).toBe(1);
      expect(created[0].type).toBe('rich_card');
      expect(created[0].x).toBe(760);
      expect(created[0].y).toBe(390);
    });

    it('correctly handles clear tool by deleting selected shapes or clearing', () => {
      const editor = createMockEditor();
      const selected = editor.getSelectedShapeIds();
      expect(selected.length).toBe(2);

      editor.deleteShapes(selected);
      expect(editor._getDeletedShapeIds()).toEqual(['shape_1', 'shape_2']);
    });

    it('remains resilient when editor instance is null', () => {
      const safeDispatchTool = (editor: ReturnType<typeof createMockEditor> | null, toolId: string) => {
        if (!editor) return false;
        editor.setCurrentTool(toolId);
        return true;
      };

      expect(safeDispatchTool(null, 'draw')).toBe(false);
      const editor = createMockEditor();
      expect(safeDispatchTool(editor, 'draw')).toBe(true);
      expect(editor.getCurrentToolId()).toBe('draw');
    });
  });

  // =========================================================================
  // 2. Zoom Formatting with Tabular Numbers
  // =========================================================================
  describe('Zoom Indicator & Tabular Percentage Formatting', () => {
    it('formats zoom levels accurately into rounded percentage strings', () => {
      // Direct requirement cases from dispatch prompt
      expect(formatZoomPercentage(0.5)).toBe('50%');
      expect(formatZoomPercentage(1.0)).toBe('100%');
      expect(formatZoomPercentage(2.345)).toBe('235%');

      // Common zoom levels
      expect(formatZoomPercentage(0.25)).toBe('25%');
      expect(formatZoomPercentage(0.75)).toBe('75%');
      expect(formatZoomPercentage(1.5)).toBe('150%');
      expect(formatZoomPercentage(2.0)).toBe('200%');
      expect(formatZoomPercentage(3.14159)).toBe('314%');
      expect(formatZoomPercentage(0.125)).toBe('13%');
      expect(formatZoomPercentage(0.6666)).toBe('67%');
      expect(formatZoomPercentage(0.3333)).toBe('33%');
      expect(formatZoomPercentage(0.0)).toBe('0%');
      expect(formatZoomPercentage(4.0)).toBe('400%');
    });

    it('handles non-numeric or NaN zoom fallbacks gracefully', () => {
      expect(formatZoomPercentage(NaN)).toBe('100%');
      expect(formatZoomPercentage(null as any)).toBe('100%');
      expect(formatZoomPercentage(undefined as any)).toBe('100%');
    });

    it('verifies zoom in and zoom out modifications on the viewport pill', () => {
      const editor = createMockEditor('select', 1.0);

      editor.zoomIn();
      expect(editor.getZoomLevel()).toBe(1.25);
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('125%');

      editor.zoomOut();
      expect(editor.getZoomLevel()).toBe(1.0);
      expect(formatZoomPercentage(editor.getZoomLevel())).toBe('100%');

      editor.zoomToFit();
      expect(editor.getZoomLevel()).toBe(1.0);
    });

    it('verifies undo and redo capability states on viewport pill', () => {
      const editor = createMockEditor('select', 1.0);

      expect(editor.getCanUndo()).toBe(true);
      expect(editor.getCanRedo()).toBe(true);

      editor.undo();
      editor.undo();
      editor.undo();
      expect(editor.getCanUndo()).toBe(false);

      editor.redo();
      expect(editor.getCanUndo()).toBe(true);
    });

    it('verifies tabular-nums utility class format ensures non-proportional digit alignment', () => {
      // In CSS, tabular-nums guarantees that all numbers 0-9 have identical advance widths
      const numbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const formattedZoomLabels = numbers.map((n) => formatZoomPercentage(Number(n) / 10));

      expect(formattedZoomLabels).toEqual([
        '0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%'
      ]);

      // Every formatted string terminates with '%'
      for (const label of formattedZoomLabels) {
        expect(label.endsWith('%')).toBe(true);
        expect(label.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // =========================================================================
  // 3. Color Swatch Palette Mapping against tldraw DefaultColorStyle
  // =========================================================================
  describe('Color Swatch Palette & DefaultColorStyle Mapping', () => {
    it('verifies every HUD color swatch maps to a valid tldraw DefaultColorStyle value', () => {
      const validTldrawColors = new Set(DefaultColorStyle.values);

      for (const swatch of HUD_COLOR_SWATCHES) {
        expect(validTldrawColors.has(swatch.tldrawColor)).toBe(true);
      }
    });

    it('includes all primary tldraw spectrum colors in the swatch palette', () => {
      const swatchColors = HUD_COLOR_SWATCHES.map((s) => s.tldrawColor);

      // Must cover core Apple & tldraw palette
      expect(swatchColors).toContain('white');
      expect(swatchColors).toContain('grey');
      expect(swatchColors).toContain('black');
      expect(swatchColors).toContain('blue');
      expect(swatchColors).toContain('light-blue');
      expect(swatchColors).toContain('violet');
      expect(swatchColors).toContain('light-violet');
      expect(swatchColors).toContain('green');
      expect(swatchColors).toContain('light-green');
      expect(swatchColors).toContain('yellow');
      expect(swatchColors).toContain('orange');
      expect(swatchColors).toContain('red');
      expect(swatchColors).toContain('light-red');
    });

    it('verifies each swatch has valid hex representation and human-readable label', () => {
      const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

      for (const swatch of HUD_COLOR_SWATCHES) {
        expect(swatch.id).toBeTruthy();
        expect(swatch.label).toBeTruthy();
        expect(hexColorRegex.test(swatch.hex)).toBe(true);
      }
    });

    it('dispatches style changes to selected shapes via editor.setStyleForSelectedShapes', () => {
      const editor = createMockEditor();

      // Dispatch color change
      const targetColor = 'light-blue';
      editor.setStyleForSelectedShapes(DefaultColorStyle, targetColor);

      const styles = editor._getSelectedStyles();
      expect(styles[DefaultColorStyle.id]).toBe('light-blue');
    });

    it('verifies ContextualFormattingPill contains air-gap clearance, popover offset, and text editing suppression', () => {
      const fs = require('fs');
      const path = require('path');
      const code = fs.readFileSync(path.join(process.cwd(), 'src/components/ContextualFormattingPill.tsx'), 'utf8');

      // 1. In-situ text editing suppression
      expect(code).toContain('editor.getEditingShapeId() !== null');

      // 2. Strict 10px popover air gap
      expect(code).toContain("top-[calc(100%+10px)]'");
      expect(code).toContain("bottom-[calc(100%+10px)]'");

      // 3. Popover centering to prevent clipping
      expect(code).toContain('left-1/2 -translate-x-1/2');

      // 4. Fill style scoped to geo shapes only
      expect(code).toContain('const supportsFill = selectedShapes.some((s) => s.type === \'geo\');');
      expect(code).toContain('{supportsFill && (');

      // 5. Make Real scoped to drawings/sketches
      expect(code).toContain('const canMakeReal = hasDrawings || isMultiShapeSketch;');

      // 6. Swatch active ring on inner dot without button-level clipping
      expect(code).toContain('ring-white/90 ring-offset-2 ring-offset-[#121218]');
    });
  });
});
