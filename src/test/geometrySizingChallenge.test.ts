import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { getConcentricRadius, getInnerConcentricRadius, MIN_TOUCH_TARGET, PRESS_SCALE } from '@/lib/tokens';

const ROOT_SRC = path.join(process.cwd(), 'src');

function readComponentFile(relativePath: string): string {
  const fullPath = path.join(ROOT_SRC, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

describe('Challenger 2 Round 2: Empirical Geometry & Sizing Stress Test', () => {
  // =========================================================================
  // 1. Concentric Border Radii Verification
  // =========================================================================
  describe('Concentric Border Radii: outer = inner + padding', () => {
    it('verifies ContextualFormattingPill outer=[18px], inner=12px (rounded-xl), padding=6px (p-1.5)', () => {
      const code = readComponentFile('components/ContextualFormattingPill.tsx');
      
      // Check container declaration
      expect(code).toContain('rounded-[18px]');
      expect(code).toContain('p-1.5');
      
      // Mathematical verification
      const innerRadius = 12; // rounded-xl
      const padding = 6;      // p-1.5 = 6px
      const expectedOuter = getConcentricRadius(innerRadius, padding);
      expect(expectedOuter).toBe(18);
      expect(getInnerConcentricRadius(18, padding)).toBe(12);
    });

    it('verifies AppleFloatingDock outer=[20px], inner=12px (rounded-xl), padding=8px (p-2)', () => {
      const code = readComponentFile('components/AppleFloatingDock.tsx');
      
      // Check dock container declaration
      expect(code).toContain('rounded-[20px]');
      expect(code).toContain('p-2');
      
      // Mathematical verification
      const innerRadius = 12; // rounded-xl
      const padding = 8;      // p-2 = 8px
      const expectedOuter = getConcentricRadius(innerRadius, padding);
      expect(expectedOuter).toBe(20);
      expect(getInnerConcentricRadius(20, padding)).toBe(12);
    });

    it('verifies SpatialAIOmnibar clamps its compact, expanded, and default widths to the viewport', () => {
      const code = readComponentFile('components/SpatialAIOmnibar.tsx');

      expect(code).toContain('const isCompact = viewport.width <= 640;');
      expect(code).toContain(
        'const availablePanelWidth = Math.max(\n    0,\n    viewport.width - viewportPadding.left - viewportPadding.right\n  );'
      );
      expect(code).toContain(
        'const panelWidth = Math.min(isCompact ? 520 : isExpanded ? 680 : 480, availablePanelWidth);'
      );
      expect(code).toContain('width: panelWidth');
      expect(code).toContain("isCompact ? 'rounded-[20px]' : 'rounded-[24px]'");
    });

    it('verifies AppleFloatingDock popovers adhere to concentric radius formula', () => {
      const code = readComponentFile('components/AppleFloatingDock.tsx');
      
      // Geo popover: p-2 rounded-[20px] with rounded-xl inner buttons
      const geoPopoverMatch = code.match(/className="[^"]*p-2\s+rounded-\[20px\]\s+liquid-glass-popover[^"]*"/);
      expect(geoPopoverMatch).not.toBeNull();
      
      // Custom cards popover: p-2 rounded-[20px] with rounded-xl inner buttons
      const cardsPopoverMatch = code.match(/className="[^"]*p-2\s+rounded-\[20px\]\s+liquid-glass-popover[^"]*min-w-\[200px\][^"]*"/);
      expect(cardsPopoverMatch).not.toBeNull();
      
      // Inner buttons have rounded-xl (12px)
      expect(code).toContain('handleSelectGeo');
      expect(code).toContain('handleSpawnCard');
      expect(getConcentricRadius(12, 8)).toBe(20);
    });

    it('verifies SpatialAIOmnibar Action Menu popover adheres to concentric radius formula', () => {
      const code = readComponentFile('components/SpatialAIOmnibar.tsx');
      
      // Action menu: rounded-[20px] ... p-2
      const actionMenuMatch = code.match(/rounded-\[20px\][^"]*p-2/);
      expect(actionMenuMatch).not.toBeNull();
      expect(getConcentricRadius(12, 8)).toBe(20);
    });
  });

  // =========================================================================
  // 2. Touch Targets & Scale Feedback Verification
  // =========================================================================
  describe('Touch Targets (>= 44x44px) and Tactile Scale Feedback (active:scale-[0.96])', () => {
    it('verifies color swatches in ContextualFormattingPill meet >= 44x44px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/ContextualFormattingPill.tsx');
      
      // Swatch button class inspection
      const swatchSection = code.match(/HUD_COLOR_SWATCHES\.map\([\s\S]*?className=\{`([\s\S]*?)`\}/);
      expect(swatchSection).not.toBeNull();
      const swatchClasses = swatchSection![1];
      
      expect(swatchClasses).toContain('min-w-[44px]');
      expect(swatchClasses).toContain('min-h-[44px]');
      expect(swatchClasses).toContain('w-11');
      expect(swatchClasses).toContain('h-11');
      expect(swatchClasses).toContain('active:scale-[0.96]');
    });

    it('verifies all quick formatting buttons in ContextualFormattingPill meet >= 44x44px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/ContextualFormattingPill.tsx');
      
      // Stroke weight buttons
      expect(code).toMatch(/handleSizeChange[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // Fill style buttons
      expect(code).toMatch(/handleFillChange\('none'\)[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // Text align buttons
      expect(code).toMatch(/handleAlignChange\('start'\)[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // Make Real button
      expect(code).toMatch(/handleMakeReal[\s\S]*?min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // AI Toggle button
      expect(code).toMatch(/setShowAIActions[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // Delete button
      expect(code).toMatch(/handleDelete[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // In-situ submit button
      expect(code).toMatch(/type="submit"[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
    });

    it('verifies popover buttons in AppleFloatingDock meet >= 44x44px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/AppleFloatingDock.tsx');
      
      // Geo shape popover buttons
      const geoButtons = [
        'handleSelectGeo(\'rectangle\')',
        'handleSelectGeo(\'ellipse\')',
        'handleSelectGeo(\'triangle\')',
        'handleSelectGeo(\'diamond\')',
        'handleSelectGeo(\'star\')',
      ];
      
      for (const handler of geoButtons) {
        const regex = new RegExp(`${handler.replace(/[()']/g, '\\$&')}[\\s\\S]*?min-w-\\[44px\\]\\s+min-h-\\[44px\\][\\s\\S]*?active:scale-\\[0\\.96\\]`);
        expect(code).toMatch(regex);
      }

      // Custom card spawner buttons
      const cardSpawners = [
        'handleSpawnCard(\'rich_card\')',
        'handleSpawnCard(\'code_card\')',
        'handleSpawnCard(\'document\')',
        'handleSpawnCard(\'slide_deck\')',
        'handleSpawnCard(\'artifact\')',
      ];

      for (const handler of cardSpawners) {
        const regex = new RegExp(`${handler.replace(/[()']/g, '\\$&')}[\\s\\S]*?min-h-\\[44px\\][\\s\\S]*?active:scale-\\[0\\.96\\]`);
        expect(code).toMatch(regex);
      }
    });

    it('verifies the slide pager exposes accessible 44px previous, next, and numeric controls', () => {
      const code = readComponentFile('shapes/SlideDeckShapeUtil.tsx');

      expect(code).toContain('aria-label="Previous slide"');
      expect(code).toContain('aria-label="Next slide"');
      expect(code).toContain('aria-label="Go to slide number"');
      expect(code).toMatch(/min-h-\[44px\] min-w-\[44px\][\s\S]{0,200}aria-label="Previous slide"/);
      expect(code).toMatch(/min-h-\[44px\] min-w-\[44px\][\s\S]{0,200}aria-label="Next slide"/);
      expect(code).toContain('inputMode="numeric"');
      expect(code).toMatch(/aria-label="Go to slide number"[\s\S]{0,500}className="h-11 w-16/);
    });

    it('verifies SpatialAIOmnibar top controls and action menu buttons meet >= 44x44px and active:scale-[0.96]', () => {
      const code = readComponentFile('components/SpatialAIOmnibar.tsx');
      
      // Top circular controls
      expect(code).toMatch(/handleNewChat[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setShowProviderSetup[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setIsExpanded[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      expect(code).toMatch(/setIsOpen\(false\)[\s\S]*?min-w-\[44px\]\s+min-h-\[44px\][\s\S]*?active:scale-\[0\.96\]/);
      
      // Action menu presets in Action Menu popover
      const actionMenuSection = code.match(/Action Menu Popover[\s\S]*?handleActionPreset\(item\.prompt\)[\s\S]*?className="([^"]*)"/);
      expect(actionMenuSection).not.toBeNull();
      const actionClasses = actionMenuSection![1];
      expect(actionClasses).toContain('min-h-[44px]');
      expect(actionClasses).toContain('active:scale-[0.96]');

      // Quick starters in empty state
      const quickStarterSection = code.match(/quickStarters(?:\.slice\(0, 2\))?\.map\([\s\S]*?handleActionPreset\(item\.prompt\)[\s\S]*?className="([^"]*)"/);
      expect(quickStarterSection).not.toBeNull();
      const quickClasses = quickStarterSection![1];
      expect(quickClasses).toContain('p-3');
      expect(quickClasses).toContain('active:scale-[0.96]');
    });
  });

  // =========================================================================
  // 3. Tabular Numbers Verification
  // =========================================================================
  describe('Tabular Numbers: font-variant-numeric: tabular-nums', () => {
    it('verifies tabular numerals are applied to displayed stat values and slide indexes', () => {
      const code = readComponentFile('shapes/SlideDeckShapeUtil.tsx');
      const statValueIndex = code.indexOf('{stat.value}');
      const statClassStart = code.lastIndexOf('className=', statValueIndex);
      expect(statValueIndex).toBeGreaterThanOrEqual(0);
      expect(code.slice(statClassStart, statValueIndex)).toContain('tabular-nums');

      const slidesNavStart = code.indexOf('aria-label="Slides"');
      const slideIndex = code.indexOf('{index + 1}', slidesNavStart);
      const slideClassStart = code.lastIndexOf('className=', slideIndex);
      expect(slidesNavStart).toBeGreaterThanOrEqual(0);
      expect(slideIndex).toBeGreaterThanOrEqual(slidesNavStart);
      expect(code.slice(slideClassStart, slideIndex)).toContain('tabular-nums');
    });

    it('keeps tabular numeral styling on numeric display elements without depending on an occurrence count', () => {
      const code = readComponentFile('shapes/SlideDeckShapeUtil.tsx');
      expect(code).toMatch(/font-bold tabular-nums[^>]*>\{stat\.value\}<\/p>/);
      expect(code).toMatch(/text-\[10px\] tabular-nums[^>]*>\{index \+ 1\}<\/span>/);
    });

    it('verifies global CSS defines .tabular-nums correctly', () => {
      const css = readComponentFile('app/globals.css');
      expect(css).toContain('.tabular-nums {');
      expect(css).toContain('font-variant-numeric: tabular-nums;');
    });
  });

  // =========================================================================
  // 4. Global Anti-Regression Invariants
  // =========================================================================
  describe('Global Anti-Regression Invariants', () => {
    it('verifies zero occurrences of scale-[0.98] across all implementation files in src/', () => {
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

    it('verifies zero sub-40px button classes in ContextualFormattingPill and AppleFloatingDock', () => {
      const pillCode = readComponentFile('components/ContextualFormattingPill.tsx');
      const dockCode = readComponentFile('components/AppleFloatingDock.tsx');

      // Neither should have legacy sub-40px dimensions on buttons
      expect(pillCode).not.toContain('min-w-[32px]');
      expect(pillCode).not.toContain('min-h-[32px]');
      expect(pillCode).not.toContain('min-w-[36px]');
      expect(pillCode).not.toContain('min-h-[36px]');

      expect(dockCode).not.toContain('min-w-[32px]');
      expect(dockCode).not.toContain('min-h-[32px]');
      expect(dockCode).not.toContain('min-w-[36px]');
      expect(dockCode).not.toContain('min-h-[36px]');
    });
  });
});
