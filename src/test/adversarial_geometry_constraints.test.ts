import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ArtifactShapeUtil } from '@/shapes/ArtifactShapeUtil';
import { SlideDeckShapeUtil } from '@/shapes/SlideDeckShapeUtil';
import { getConcentricRadius, getInnerConcentricRadius, MIN_TOUCH_TARGET, PRESS_SCALE } from '@/lib/tokens';
import type { TLArtifactShape } from '@/shapes/ArtifactShapeUtil';
import type { TLSlideDeckShape } from '@/shapes/SlideDeckShapeUtil';
import type { TLResizeInfo } from '@tldraw/tldraw';
import { Vec } from '@tldraw/tldraw';

const ROOT_SRC = path.join(process.cwd(), 'src');

function readComponentFile(relativePath: string): string {
  const fullPath = path.join(ROOT_SRC, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

describe('Challenger 2: Adversarial Geometry, Touch Targets & Constraints Suite', () => {
  // =========================================================================
  // 1. Window Resize Minimum Constraints Stress Testing
  // =========================================================================
  describe('Window Resize Minimum Constraints (Artifact min 480x360, SlideDeck min 640x480)', () => {
    const artifactUtil = new ArtifactShapeUtil({} as any);
    const slideDeckUtil = new SlideDeckShapeUtil({} as any);

    const baseArtifactShape: TLArtifactShape = {
      id: 'shape:artifact-test' as any,
      typeName: 'shape',
      type: 'artifact',
      x: 100,
      y: 100,
      rotation: 0,
      index: 'a1' as any,
      parentId: 'page:page1' as any,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {
        w: 760,
        h: 520,
        title: 'Adversarial Test App',
        code: '<div>Hello</div>',
        color: 'black',
        storage: {},
      },
    };

    const baseSlideShape: TLSlideDeckShape = {
      id: 'shape:slide-test' as any,
      typeName: 'shape',
      type: 'slide_deck',
      x: 100,
      y: 100,
      rotation: 0,
      index: 'a1' as any,
      parentId: 'page:page1' as any,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {
        w: 960,
        h: 600,
        title: 'Adversarial Slide Deck',
        currentSlideIndex: 0,
        slides: [{ id: 's1', title: 'Slide 1', subtitle: 'Test', bullets: ['Point 1'] }],
      },
    };

    it('enforces min 480x360 on ArtifactShapeUtil with extreme negative scales', () => {
      const extremeNegativeScales = [-1, -2, -10, -100, -1000, -1e6];

      for (const scale of extremeNegativeScales) {
        const resizeInfo: TLResizeInfo<TLArtifactShape> = {
          scaleX: scale,
          scaleY: scale,
          initialShape: baseArtifactShape,
          handle: 'bottom_right',
          mode: 'scale_shape',
          newPoint: new Vec(0, 0),
          initialBounds: { minX: 100, minY: 100, maxX: 860, maxY: 620, width: 760, height: 520 } as any,
        };

        const result = artifactUtil.onResize(baseArtifactShape, resizeInfo);
        expect(result.props.w).toBe(480);
        expect(result.props.h).toBe(360);
      }
    });

    it('enforces min 480x360 on ArtifactShapeUtil with zero and sub-minimum positive scales', () => {
      const subMinScales = [0, 0.00001, 0.001, 0.1, 0.2, 0.5]; // 0.5 * 760 = 380 (<480), 0.5 * 520 = 260 (<360)

      for (const scale of subMinScales) {
        const resizeInfo: TLResizeInfo<TLArtifactShape> = {
          scaleX: scale,
          scaleY: scale,
          initialShape: baseArtifactShape,
          handle: 'bottom_right',
          mode: 'scale_shape',
          newPoint: new Vec(0, 0),
          initialBounds: { minX: 100, minY: 100, maxX: 860, maxY: 620, width: 760, height: 520 } as any,
        };

        const result = artifactUtil.onResize(baseArtifactShape, resizeInfo);
        expect(result.props.w).toBe(480);
        expect(result.props.h).toBe(360);
      }
    });

    it('enforces min 480x360 on ArtifactShapeUtil with asymmetric scale deltas', () => {
      // scaleX is negative, scaleY expands
      const resize1: TLResizeInfo<TLArtifactShape> = {
        scaleX: -5,
        scaleY: 2,
        initialShape: baseArtifactShape,
        handle: 'bottom_right',
        mode: 'scale_shape',
        newPoint: new Vec(0, 0),
        initialBounds: {} as any,
      };
      const res1 = artifactUtil.onResize(baseArtifactShape, resize1);
      expect(res1.props.w).toBe(480);
      expect(res1.props.h).toBe(1040); // 520 * 2 = 1040

      // scaleX expands, scaleY is negative
      const resize2: TLResizeInfo<TLArtifactShape> = {
        scaleX: 2,
        scaleY: -0.1,
        initialShape: baseArtifactShape,
        handle: 'bottom_right',
        mode: 'scale_shape',
        newPoint: new Vec(0, 0),
        initialBounds: {} as any,
      };
      const res2 = artifactUtil.onResize(baseArtifactShape, resize2);
      expect(res2.props.w).toBe(1520); // 760 * 2 = 1520
      expect(res2.props.h).toBe(360);
    });

    it('enforces min 640x480 on SlideDeckShapeUtil with extreme negative scales', () => {
      const extremeNegativeScales = [-1, -2, -10, -100, -1000, -1e6];

      for (const scale of extremeNegativeScales) {
        const resizeInfo: TLResizeInfo<TLSlideDeckShape> = {
          scaleX: scale,
          scaleY: scale,
          initialShape: baseSlideShape,
          handle: 'bottom_right',
          mode: 'scale_shape',
          newPoint: new Vec(0, 0),
          initialBounds: {} as any,
        };

        const result = slideDeckUtil.onResize(baseSlideShape, resizeInfo);
        expect(result.props.w).toBe(640);
        expect(result.props.h).toBe(480);
      }
    });

    it('enforces min 640x480 on SlideDeckShapeUtil with zero and sub-minimum positive scales', () => {
      const subMinScales = [0, 0.00001, 0.001, 0.1, 0.3, 0.5]; // 0.5 * 960 = 480 (<640), 0.5 * 600 = 300 (<480)

      for (const scale of subMinScales) {
        const resizeInfo: TLResizeInfo<TLSlideDeckShape> = {
          scaleX: scale,
          scaleY: scale,
          initialShape: baseSlideShape,
          handle: 'bottom_right',
          mode: 'scale_shape',
          newPoint: new Vec(0, 0),
          initialBounds: {} as any,
        };

        const result = slideDeckUtil.onResize(baseSlideShape, resizeInfo);
        expect(result.props.w).toBe(640);
        expect(result.props.h).toBe(480);
      }
    });

    it('enforces min 640x480 on SlideDeckShapeUtil with asymmetric scale deltas', () => {
      // scaleX expands, scaleY negative
      const resize1: TLResizeInfo<TLSlideDeckShape> = {
        scaleX: 1.5,
        scaleY: -10,
        initialShape: baseSlideShape,
        handle: 'bottom_right',
        mode: 'scale_shape',
        newPoint: new Vec(0, 0),
        initialBounds: {} as any,
      };
      const res1 = slideDeckUtil.onResize(baseSlideShape, resize1);
      expect(res1.props.w).toBe(1440); // 960 * 1.5 = 1440
      expect(res1.props.h).toBe(480);

      // scaleX negative, scaleY expands
      const resize2: TLResizeInfo<TLSlideDeckShape> = {
        scaleX: -10,
        scaleY: 1.5,
        initialShape: baseSlideShape,
        handle: 'bottom_right',
        mode: 'scale_shape',
        newPoint: new Vec(0, 0),
        initialBounds: {} as any,
      };
      const res2 = slideDeckUtil.onResize(baseSlideShape, resize2);
      expect(res2.props.w).toBe(640);
      expect(res2.props.h).toBe(900); // 600 * 1.5 = 900
    });

    it('property-based fuzzing: 200 random deltas always satisfy min dimensions', () => {
      for (let i = 0; i < 200; i++) {
        // Uniform random scale in [-100, 100]
        const sx = (Math.random() - 0.5) * 200;
        const sy = (Math.random() - 0.5) * 200;

        const artRes = artifactUtil.onResize(baseArtifactShape, { scaleX: sx, scaleY: sy } as any);
        expect(artRes.props.w).toBeGreaterThanOrEqual(480);
        expect(artRes.props.h).toBeGreaterThanOrEqual(360);
        expect(Number.isInteger(artRes.props.w)).toBe(true);
        expect(Number.isInteger(artRes.props.h)).toBe(true);

        const slideRes = slideDeckUtil.onResize(baseSlideShape, { scaleX: sx, scaleY: sy } as any);
        expect(slideRes.props.w).toBeGreaterThanOrEqual(640);
        expect(slideRes.props.h).toBeGreaterThanOrEqual(480);
        expect(Number.isInteger(slideRes.props.w)).toBe(true);
        expect(Number.isInteger(slideRes.props.h)).toBe(true);
      }
    });
  });

  // =========================================================================
  // 2. Touch Target Dimensions & Tactile Scale Feedback (>= 40x40px, scale-[0.96])
  // =========================================================================
  describe('Touch Targets (>= 40x40px) and Tactile Feedback (scale-[0.96])', () => {
    it('verifies ApplePagesPill interactive buttons meet >= 40x40px and scale-[0.96]', () => {
      const code = readComponentFile('components/ApplePagesPill.tsx');

      // 1. Current Page Selector: min-h-[40px] and whileTap scale 0.96
      expect(code).toContain('min-h-[40px]');
      expect(code).toContain('whileTap={{ scale: 0.96 }}');

      // 2. Grid Toggle: min-w-[40px] min-h-[40px] w-10 h-10 active:scale-[0.96]
      expect(code).toMatch(/handleToggleGrid[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // 3. Snap Toggle: min-w-[40px] min-h-[40px] w-10 h-10 active:scale-[0.96]
      expect(code).toMatch(/handleToggleSnap[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // 4. Export Dropdown Trigger: min-w-[40px] min-h-[40px] w-10 h-10 active:scale-[0.96]
      expect(code).toMatch(/setShowExportMenu[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // 5. Export Popover Options (PNG, SVG, backups): min-h-[40px] active:scale-[0.96]
      expect(code).toMatch(/handleExport\('png'\)[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleExport\('svg'\)[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/downloadBackup[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // 6. New Page button: min-h-[40px] active:scale-[0.96]
      expect(code).toMatch(/handleCreatePage[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // 7. Page item Rename Save, Hover Rename, Duplicate, Delete
      expect(code).toMatch(/handleSaveRename[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleStartRename[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleDuplicatePage[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleDeletePage[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies AppleViewportPill interactive buttons meet >= 40x40px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/AppleViewportPill.tsx');

      // Zoom Out
      expect(code).toMatch(/handleZoomOut[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Zoom Reset (percentage display button)
      expect(code).toMatch(/handleResetZoom[\s\S]*?min-w-\[50px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Zoom In
      expect(code).toMatch(/handleZoomIn[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Zoom to Fit
      expect(code).toMatch(/handleZoomToFit[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Undo
      expect(code).toMatch(/handleUndo[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Redo
      expect(code).toMatch(/handleRedo[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies ContextualFormattingPill buttons meet >= 40x40px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/ContextualFormattingPill.tsx');

      // Palette swatches
      expect(code).toMatch(/HUD_COLOR_SWATCHES\.map[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Stroke size options
      expect(code).toMatch(/handleSizeChange[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Fill style options
      expect(code).toMatch(/handleFillChange[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Text align options
      expect(code).toMatch(/handleAlignChange[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Make Real CTA
      expect(code).toMatch(/handleMakeReal[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // AI Actions toggle
      expect(code).toMatch(/setShowAIActions[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Delete button
      expect(code).toMatch(/handleDelete[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Dismiss button
      expect(code).toMatch(/setIsDismissed\(true\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // In-situ submit
      expect(code).toMatch(/type="submit"[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies AppleFloatingDock primary tools and popovers meet >= 40x40px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/AppleFloatingDock.tsx');

      // Primary tools (10)
      const primaryTools = ['select', 'hand', 'draw', 'text', 'note', 'geo', 'rich_card', 'arrow', 'eraser', 'clear'];
      for (const tool of primaryTools) {
        expect(code).toMatch(new RegExp(`data-tool="${tool}"[\\s\\S]*?min-w-\\[40px\\]\\s+min-h-\\[40px\\]\\s+w-10\\s+h-10[\\s\\S]*?active:scale-\\[0\\.96\\]`));
      }

      // Geo popover shapes
      expect(code).toMatch(/handleSelectGeo\('rectangle'\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleSelectGeo\('ellipse'\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleSelectGeo\('triangle'\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleSelectGeo\('diamond'\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/handleSelectGeo\('star'\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);

      // Custom card spawners
      const cardTypes = ['rich_card', 'code_card', 'document', 'slide_deck', 'artifact'];
      for (const ct of cardTypes) {
        expect(code).toMatch(new RegExp(`handleSpawnCard\\('${ct}'\\)[\\s\\S]*?min-h-\\[40px\\][\\s\\S]*?active:scale-\\[0\\.96\\]`));
      }

      // Sub-chooser close button
      expect(code).toMatch(/onClick=\{closeAllPopovers\}[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\]\s+w-10\s+h-10[\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies SpatialAIOmnibar controls meet >= 40x40px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/SpatialAIOmnibar.tsx');

      // Top circular buttons
      expect(code).toMatch(/handleNewChat[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setShowSettings[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setIsExpanded[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setIsOpen\(false\)[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Copy message button
      expect(code).toMatch(/handleCopy[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Thinking Accordion button
      expect(code).toMatch(/Reasoning Chain[\s\S]*?min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Action menu (+) button
      expect(code).toMatch(/setShowActionMenu[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Voice dictation button
      expect(code).toMatch(/toggleVoice[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);

      // Send / stop button
      expect(code).toMatch(/ai\.stopGeneration[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/type="submit"[\s\S]*?min-w-\[40px\]\s+min-h-\[40px\][\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies zero occurrences of scale-[0.98] across all source files in src/', () => {
      const files: string[] = [];
      function collectFiles(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'test' || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collectFiles(full);
          } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
            files.push(full);
          }
        }
      }
      collectFiles(ROOT_SRC);

      for (const f of files) {
        const content = fs.readFileSync(f, 'utf8');
        expect(content).not.toContain('scale-[0.98]');
      }
    });
  });

  // =========================================================================
  // 3. Concentric Radii Formula Strict Mathematical Verification
  // =========================================================================
  describe('Concentric Radii Formula: R_outer = R_inner + Padding (Zero Geometric Divergence)', () => {
    interface ConcentricSpec {
      component: string;
      outerRadius: number;
      innerRadius: number;
      padding: number;
      description: string;
    }

    const HUD_CONCENTRIC_SPECS: ConcentricSpec[] = [
      {
        component: 'AppleFloatingDock container',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) tools',
      },
      {
        component: 'AppleFloatingDock Geo Popover',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) shapes',
      },
      {
        component: 'AppleFloatingDock Cards Popover',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) card spawners',
      },
      {
        component: 'AppleFloatingDock Subchoosers',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) options',
      },
      {
        component: 'ContextualFormattingPill container',
        outerRadius: 18,
        innerRadius: 12,
        padding: 6,
        description: 'rounded-[18px] outer with p-1.5 (6px) and rounded-xl (12px) tool buttons',
      },
      {
        component: 'ContextualFormattingPill Popovers',
        outerRadius: 18,
        innerRadius: 12,
        padding: 6,
        description: 'rounded-[18px] outer with p-1.5 (6px) and rounded-xl (12px) sub-popover swatches',
      },
      {
        component: 'AppleViewportPill container',
        outerRadius: 18,
        innerRadius: 12,
        padding: 6,
        description: 'rounded-[18px] outer with p-1.5 (6px) and rounded-xl (12px) zoom/undo buttons',
      },
      {
        component: 'ApplePagesPill Export Popover',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) export options',
      },
      {
        component: 'ApplePagesPill Pages Drawer',
        outerRadius: 24,
        innerRadius: 12,
        padding: 12,
        description: 'rounded-[24px] outer with p-3 (12px) and rounded-xl (12px) page list items',
      },
      {
        component: 'SpatialAIOmnibar Panel',
        outerRadius: 32,
        innerRadius: 16,
        padding: 16,
        description: 'rounded-[32px] outer with p-4 (16px) and rounded-2xl (16px) chat message cards',
      },
      {
        component: 'SpatialAIOmnibar Action Menu Popover',
        outerRadius: 20,
        innerRadius: 12,
        padding: 8,
        description: 'rounded-[20px] outer with p-2 (8px) and rounded-xl (12px) preset action cards',
      },
    ];

    for (const spec of HUD_CONCENTRIC_SPECS) {
      it(`verifies concentric math for ${spec.component}: ${spec.outerRadius} = ${spec.innerRadius} + ${spec.padding}`, () => {
        // Direct formula: R_outer = R_inner + padding
        const calculatedOuter = getConcentricRadius(spec.innerRadius, spec.padding);
        expect(calculatedOuter).toBe(spec.outerRadius);

        // Inverse formula: R_inner = R_outer - padding
        const calculatedInner = getInnerConcentricRadius(spec.outerRadius, spec.padding);
        expect(calculatedInner).toBe(spec.innerRadius);

        // Zero divergence
        const divergence = Math.abs(spec.outerRadius - (spec.innerRadius + spec.padding));
        expect(divergence).toBe(0);
      });
    }

    it('verifies concentric radius token declarations in source components', () => {
      const dock = readComponentFile('components/AppleFloatingDock.tsx');
      expect(dock).toContain('rounded-[20px]');
      expect(dock).toContain('p-2');

      const pill = readComponentFile('components/ContextualFormattingPill.tsx');
      expect(pill).toContain('rounded-[18px]');
      expect(pill).toContain('p-1.5');

      const viewport = readComponentFile('components/AppleViewportPill.tsx');
      expect(viewport).toContain('rounded-[18px]');
      expect(viewport).toContain('p-1.5');

      const pages = readComponentFile('components/ApplePagesPill.tsx');
      expect(pages).toContain('rounded-[24px]');
      expect(pages).toContain('p-3');
      expect(pages).toContain('rounded-[20px]');

      const omnibar = readComponentFile('components/SpatialAIOmnibar.tsx');
      expect(omnibar).toContain('rounded-[32px]');
      expect(omnibar).toContain('rounded-[20px]');
    });
  });

  // =========================================================================
  // 4. Iframe Marquee Pointer Events Blocking
  // =========================================================================
  describe('Iframe Marquee Pointer Events Blocking (.canvas-is-dragging)', () => {
    it('verifies globals.css enforces pointer-events: none !important during canvas drag', () => {
      const css = readComponentFile('app/globals.css');

      // Rule must cover .canvas-is-dragging iframe and .canvas-is-dragging .canvasos-artifact-frame
      expect(css).toContain('.canvas-is-dragging iframe');
      expect(css).toContain('.canvas-is-dragging .canvasos-artifact-frame');
      expect(css).toContain('.canvas-pan-mode iframe');
      expect(css).toContain('.canvas-pan-mode .canvasos-artifact-frame');

      // Must be enforced with !important
      const dragBlockMatch = css.match(/\.canvas-is-dragging\s+iframe[\s\S]*?\{[\s\S]*?pointer-events:\s*none\s*!important;[\s\S]*?\}/);
      expect(dragBlockMatch).not.toBeNull();
    });

    it('verifies Canvas.tsx manages canvas-is-dragging class on documentElement and wrapper', () => {
      const code = readComponentFile('components/Canvas.tsx');

      // DocumentElement class toggle on drag active
      expect(code).toContain("document.documentElement.classList.toggle('canvas-is-dragging', active)");

      // Unmount cleanup removes class
      expect(code).toContain("document.documentElement.classList.remove('canvas-is-dragging')");

      // Wrapper element class binding
      expect(code).toContain("isCanvasDragging ? 'canvas-is-dragging' : ''");

      // HUD protection check: clicks on dock or popovers do not trigger canvas drag
      expect(code).toContain(".closest('.liquid-glass-dock, .liquid-glass-popover, aside[aria-label*=\"Siri\"], .canvasos-hud')");
    });
  });
});
