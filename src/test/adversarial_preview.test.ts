import { describe, it, expect } from 'bun:test';
import { stripMarkdownFences } from '@/lib/sanitizeHtml';
import { calculateMakeRealPlacement } from '@/lib/spatialVision';
import { readStorageMessage } from '@/lib/artifactStorage';

// ============================================================================
// Virtual localStorage Debouncer Test Harness
// Faithfully replicates ArtifactShapeUtil.tsx lines 73-137 debouncing mechanics
// ============================================================================
class VirtualStorageDebouncerHarness {
  public currentStorage: Record<string, string>;
  public pendingStorage: Record<string, string> | null = null;
  public debounceTimer: ReturnType<typeof setTimeout> | null = null;
  public updateCalls: Array<{ storage: Record<string, string> }> = [];
  public shapeId: string;
  public expectedSource: unknown;

  constructor(
    shapeId: string,
    initialStorage: Record<string, string> = {},
    expectedSource: unknown
  ) {
    this.shapeId = shapeId;
    this.currentStorage = { ...initialStorage };
    this.expectedSource = expectedSource;
  }

  public flushStorageUpdate() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingStorage) {
      const pending = this.pendingStorage;
      this.pendingStorage = null;
      this.updateCalls.push({ storage: pending });
    }
  }

  public handleMessage(event: { data: unknown; source: unknown }) {
    const next = readStorageMessage(
      event.data,
      event.source,
      this.expectedSource,
      this.shapeId
    );
    if (!next) return;

    this.currentStorage = next;

    const currentSnapshot = this.pendingStorage || this.currentStorage;
    const currentKeys = Object.keys(currentSnapshot);
    const nextKeys = Object.keys(next);
    if (
      this.pendingStorage !== null &&
      currentKeys.length === nextKeys.length &&
      currentKeys.every((k) => currentSnapshot[k] === next[k])
    ) {
      return;
    }

    this.pendingStorage = next;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushStorageUpdate();
    }, 300);
  }

  public unmount() {
    this.flushStorageUpdate();
  }
}

describe('Empirical Adversarial Challenge Suite: Sanitization, Skeletons & Storage', () => {
  // ==========================================================================
  // Section 1: Markdown Fence Stripping Resilience (src/lib/sanitizeHtml.ts)
  // ==========================================================================
  describe('1. Markdown Fence Stripping Resilience', () => {
    it('strips 4+ backticks fences (````html ... ````)', () => {
      const raw4 = '````html\n<!DOCTYPE html><html><body><h1>Four Backticks</h1></body></html>\n````';
      expect(stripMarkdownFences(raw4)).toBe('<!DOCTYPE html><html><body><h1>Four Backticks</h1></body></html>');

      const raw5 = '`````html\n<div>Five Backticks</div>\n`````';
      expect(stripMarkdownFences(raw5)).toBe('<div>Five Backticks</div>');

      const raw6 = '``````html\n<div>Six Backticks</div>\n``````';
      expect(stripMarkdownFences(raw6)).toBe('<div>Six Backticks</div>');
    });

    it('strips 4+ backticks with file metadata info strings (e.g. ````html:app.html)', () => {
      const raw = '````html:components/App.html\n<div id="root">App Content</div>\n````';
      expect(stripMarkdownFences(raw)).toBe('<div id="root">App Content</div>');

      const rawMeta = '`````xml:export.svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n`````';
      expect(stripMarkdownFences(rawMeta)).toBe('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
    });

    it('strips tildes fences (~~~, ~~~~, ~~~~~)', () => {
      const raw3 = '~~~html\n<!DOCTYPE html><html><body><h1>Three Tildes</h1></body></html>\n~~~';
      expect(stripMarkdownFences(raw3)).toBe('<!DOCTYPE html><html><body><h1>Three Tildes</h1></body></html>');

      const raw4 = '~~~~html\n<!DOCTYPE html><html><body><h1>Four Tildes</h1></body></html>\n~~~~';
      expect(stripMarkdownFences(raw4)).toBe('<!DOCTYPE html><html><body><h1>Four Tildes</h1></body></html>');

      const raw5Meta = '~~~~~html:main.html\n<div>Five Tildes with Meta</div>\n~~~~~';
      expect(stripMarkdownFences(raw5Meta)).toBe('<div>Five Tildes with Meta</div>');
    });

    it('safely handles unclosed code blocks from truncated or streaming outputs', () => {
      const rawUnclosed4 = '````html\n<!DOCTYPE html><html><body><h1>Truncated Stream</h1>';
      expect(stripMarkdownFences(rawUnclosed4)).toBe('<!DOCTYPE html><html><body><h1>Truncated Stream</h1>');

      const rawUnclosedTilde = '~~~~html\n<main>Streaming Content';
      expect(stripMarkdownFences(rawUnclosedTilde)).toBe('<main>Streaming Content');

      const rawUnclosedBare = '```\n<section>No Closing Fence';
      expect(stripMarkdownFences(rawUnclosedBare)).toBe('<section>No Closing Fence');
    });

    it('strips conversational reasoning preambles and outros surrounding code fences', () => {
      const reasoningPreamble = `Thinking Process:
1. Understand user request for an interactive counter.
2. Structure HTML with accessible buttons.
3. Add Tailwind styles and vanilla state management.

\`\`\`html
<!DOCTYPE html>
<html>
<body>
  <button id="inc">Increment</button>
</body>
</html>
\`\`\`
I have built the requested counter with obsidian dark mode styling. Enjoy!`;

      const result = stripMarkdownFences(reasoningPreamble);
      expect(result).toContain('<button id="inc">Increment</button>');
      expect(result).not.toContain('Thinking Process');
      expect(result).not.toContain('Tailwind styles');
      expect(result).not.toContain('I have built the requested');
      expect(result).not.toContain('```html');
      expect(result).not.toContain('```');
    });

    it('extracts unclosed code blocks preceded by conversational reasoning text', () => {
      const input = `Sure! I have carefully synthesized the spatial application for your canvas:
\`\`\`\`html
<!DOCTYPE html><html><body><h1>Streamed Mid-Way`;

      const result = stripMarkdownFences(input);
      expect(result).toBe('<!DOCTYPE html><html><body><h1>Streamed Mid-Way');
      expect(result).not.toContain('Sure! I have carefully');
      expect(result).not.toContain('````html');
    });

    it('extracts full HTML documents embedded directly in conversational text without code fences', () => {
      const input = `Here is your requested app: <!DOCTYPE html><html><head><title>Bare</title></head><body><div id="app">Hello World</div></body></html> Let me know if you need changes.`;
      const result = stripMarkdownFences(input);
      expect(result).toBe('<!DOCTYPE html><html><head><title>Bare</title></head><body><div id="app">Hello World</div></body></html>');
      expect(result).not.toContain('Here is your requested app');
      expect(result).not.toContain('Let me know if you need changes');
    });

    it('extracts pure <html> document without doctype from conversational text', () => {
      const input = `I synthesized this component:\n<html><body><span>Interactive Card</span></body></html>\nIt is ready.`;
      const result = stripMarkdownFences(input);
      expect(result).toBe('<html><body><span>Interactive Card</span></body></html>');
      expect(result).not.toContain('I synthesized this component');
      expect(result).not.toContain('It is ready');
    });

    it('handles multiple sequential code blocks by cleanly extracting the primary HTML block', () => {
      const multi = `Here is the app code:
\`\`\`html
<!DOCTYPE html><html><body><h1>Primary App</h1></body></html>
\`\`\`
And here is a CSS snippet for reference:
\`\`\`css
body { background: #000; }
\`\`\``;

      const result = stripMarkdownFences(multi);
      expect(result).toBe('<!DOCTYPE html><html><body><h1>Primary App</h1></body></html>');
      expect(result).not.toContain('Primary App</h1></body></html>\n```');
      expect(result).not.toContain('body { background: #000; }');
    });

    it('handles Windows CRLF (\\r\\n) newlines and edge-case whitespace cleanly', () => {
      const crlf = '````html\r\n<!DOCTYPE html>\r\n<html>\r\n<body><h1>CRLF Support</h1></body>\r\n</html>\r\n````';
      const result = stripMarkdownFences(crlf);
      expect(result).toBe('<!DOCTYPE html>\r\n<html>\r\n<body><h1>CRLF Support</h1></body>\r\n</html>');

      const padded = '   \t\n````html   \n<div>Padded</div>\n````   \t\n';
      expect(stripMarkdownFences(padded)).toBe('<div>Padded</div>');
    });

    it('preserves valid JavaScript template literals and backticks inside HTML scripts', () => {
      const raw = `<!DOCTYPE html>
<html>
<body>
<script>
  const title = 'VisionOS';
  const header = \`Welcome to \${title}\`;
  const code = \`const x = 1;\`;
</script>
</body>
</html>`;
      const result = stripMarkdownFences(raw);
      expect(result).toContain('`Welcome to ${title}`');
      expect(result).toContain('`const x = 1;`');
    });

    it('safely handles non-string, empty, null, or whitespace-only inputs without throwing', () => {
      expect(stripMarkdownFences('')).toBe('');
      expect(stripMarkdownFences('   \n\t  ')).toBe('');
      expect(stripMarkdownFences(null as any)).toBe('');
      expect(stripMarkdownFences(undefined as any)).toBe('');
      expect(stripMarkdownFences(12345 as any)).toBe('');
      expect(stripMarkdownFences({} as any)).toBe('');
    });
  });

  // ==========================================================================
  // Section 2: Speculative Skeleton Overlay Placement (src/lib/spatialVision.ts)
  // ==========================================================================
  describe('2. Speculative Skeleton Placement & Collision Avoidance', () => {
    it('places skeleton immediately to the right for standard bounds (w <= 900)', () => {
      const bounds = { minX: 100, minY: 150, maxX: 500, maxY: 450, w: 400, h: 300 };
      const placement = calculateMakeRealPlacement(bounds, 'anchor_card_1');

      // margin = 48, default w = 780, h = 540
      expect(placement.x).toBe(500 + 48); // bounds.maxX + 48
      expect(placement.y).toBe(150);      // bounds.minY
      expect(placement.w).toBe(780);
      expect(placement.h).toBe(540);
      expect(placement.relative).toBe('right_of:anchor_card_1');
    });

    it('places skeleton directly beneath sketch for wide bounds (w > 900)', () => {
      const wideBounds = { minX: 100, minY: 100, maxX: 1100, maxY: 400, w: 1000, h: 300 };
      const placement = calculateMakeRealPlacement(wideBounds, 'wide_sketch_1');

      // margin = 48, default w = 780, h = 540
      expect(placement.x).toBe(100);       // bounds.minX
      expect(placement.y).toBe(400 + 48); // bounds.maxY + 48
      expect(placement.w).toBe(780);
      expect(placement.h).toBe(540);
      expect(placement.relative).toBe('below:wide_sketch_1');
    });

    it('honors custom desired width and height dimensions', () => {
      const bounds = { minX: 200, minY: 200, maxX: 600, maxY: 500, w: 400, h: 300 };
      const placement = calculateMakeRealPlacement(bounds, undefined, 880, 620);

      expect(placement.w).toBe(880);
      expect(placement.h).toBe(620);
      expect(placement.x).toBe(600 + 48);
      expect(placement.y).toBe(200);
      expect(placement.relative).toBe('right_of:selection');
    });

    it('diverts placement below sketch when right position collides with existing shape', () => {
      const bounds = { minX: 100, minY: 100, maxX: 400, maxY: 300, w: 300, h: 200 };
      // Default right would be [448, 1228] x [100, 640]
      // Place an obstacle that intersects the right placement
      const existing = [
        { minX: 430, minY: 80, maxX: 700, maxY: 250 },
      ];

      const placement = calculateMakeRealPlacement(bounds, 'shape_1', 780, 540, existing);

      // Diverts to below sketch: [100, 880] x [348, 888]
      expect(placement.x).toBe(100);
      expect(placement.y).toBe(348);
      expect(placement.relative).toBe('below:shape_1');

      // Verify zero intersection with obstacle
      const collides = !(
        placement.x + placement.w <= existing[0].minX ||
        placement.x >= existing[0].maxX ||
        placement.y + placement.h <= existing[0].minY ||
        placement.y >= existing[0].maxY
      );
      expect(collides).toBe(false);
    });

    it('cascades downward past obstacles when both right and below are blocked', () => {
      const bounds = { minX: 100, minY: 100, maxX: 400, maxY: 300, w: 300, h: 200 };
      // Block both right and below
      const existing = [
        { minX: 440, minY: 90, maxX: 1240, maxY: 650 }, // blocks right
        { minX: 80, minY: 340, maxX: 900, maxY: 800 },   // blocks below
      ];

      const placement = calculateMakeRealPlacement(bounds, 'shape_1', 780, 540, existing);

      // Verify zero intersection with ALL existing shapes
      for (const obs of existing) {
        const collides = !(
          placement.x + placement.w <= obs.minX ||
          placement.x >= obs.maxX ||
          placement.y + placement.h <= obs.minY ||
          placement.y >= obs.maxY
        );
        expect(collides).toBe(false);
      }
    });

    it('finds collision-free placement in a dense field of 20 randomized existing shapes', () => {
      const bounds = { minX: 200, minY: 200, maxX: 500, maxY: 400, w: 300, h: 200 };
      const denseObstacles: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];

      // Generate a grid of obstacles around the canvas
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 4; col++) {
          denseObstacles.push({
            minX: 550 + col * 200,
            minY: 100 + row * 150,
            maxX: 700 + col * 200,
            maxY: 220 + row * 150,
          });
        }
      }

      const placement = calculateMakeRealPlacement(bounds, 'anchor_dense', 780, 540, denseObstacles);

      // Strict geometric verification: placement must NOT collide with ANY obstacle
      for (const obs of denseObstacles) {
        const overlap = !(
          placement.x + placement.w <= obs.minX ||
          placement.x >= obs.maxX ||
          placement.y + placement.h <= obs.minY ||
          placement.y >= obs.maxY
        );
        expect(overlap).toBe(false);
      }
    });

    it('ignores shapes that are within the sketch bounds itself (self-bounds filtering)', () => {
      const bounds = { minX: 100, minY: 100, maxX: 400, maxY: 300, w: 300, h: 200 };
      // Shape completely inside the sketch (e.g. child stroke / shape)
      const selfShape = [
        { minX: 150, minY: 120, maxX: 350, maxY: 280 },
      ];

      const placement = calculateMakeRealPlacement(bounds, 'sketch_root', 780, 540, selfShape);

      // Should place normally to the right without falsely thinking selfShape is a collision
      expect(placement.x).toBe(400 + 48);
      expect(placement.y).toBe(100);
    });

    it('robustly calculates placement for negative and extreme canvas coordinates', () => {
      const negBounds = { minX: -1500, minY: -800, maxX: -1000, maxY: -400, w: 500, h: 400 };
      const placement = calculateMakeRealPlacement(negBounds, 'neg_shape');

      expect(placement.x).toBe(-1000 + 48);
      expect(placement.y).toBe(-800);
      expect(placement.w).toBe(780);
      expect(placement.h).toBe(540);
    });
  });

  // ==========================================================================
  // Section 3: Virtual localStorage Debouncer (ArtifactShapeUtil.tsx & artifactStorage.ts)
  // ==========================================================================
  describe('3. Virtual localStorage Debouncing & High-Frequency Stress', () => {
    const mockWindow = { name: 'sandboxed_iframe_window' };

    it('debounces 100 rapid writes within 10ms to a single update with zero data loss', async () => {
      const harness = new VirtualStorageDebouncerHarness('artifact_shape_1', {}, mockWindow);

      // Simulate 100 rapid storage writes within 10ms
      for (let i = 1; i <= 100; i++) {
        harness.handleMessage({
          source: mockWindow,
          data: {
            type: 'CANVASOS_STORAGE_SYNC',
            shapeId: 'artifact_shape_1',
            storage: {
              counter: String(i),
              lastOperation: `write_${i}`,
              timestamp: `${Date.now()}_${i}`,
            },
          },
        });
      }

      // Assert debouncing prevented synchronous state updates (0 immediate flushes)
      expect(harness.updateCalls.length).toBe(0);

      // Wait for the trailing 300ms debounce timer to fire
      await new Promise((r) => setTimeout(r, 350));

      // Assert exactly 1 flush occurred after the quiet period
      expect(harness.updateCalls.length).toBe(1);

      // Assert the final state reflects the 100th write with 100% fidelity (zero data loss)
      const finalPayload = harness.updateCalls[0].storage;
      expect(finalPayload.counter).toBe('100');
      expect(finalPayload.lastOperation).toBe('write_100');
      expect(finalPayload.timestamp).toContain('_100');
    });

    it('resets debounce timer on successive writes and flushes 300ms after the LAST write', async () => {
      const harness = new VirtualStorageDebouncerHarness('artifact_shape_2', {}, mockWindow);

      // Send 4 writes spaced 80ms apart (total elapsed 240ms < 300ms)
      for (let i = 1; i <= 4; i++) {
        harness.handleMessage({
          source: mockWindow,
          data: {
            type: 'CANVASOS_STORAGE_SYNC',
            shapeId: 'artifact_shape_2',
            storage: { step: `step_${i}` },
          },
        });
        await new Promise((r) => setTimeout(r, 80));
      }

      // 240ms elapsed since first write, but each write reset the 300ms timer
      // Still 0 flushes because quiet period hasn't elapsed
      expect(harness.updateCalls.length).toBe(0);

      // Wait 350ms after the 4th write
      await new Promise((r) => setTimeout(r, 350));

      // Now exactly 1 flush has occurred with the final step
      expect(harness.updateCalls.length).toBe(1);
      expect(harness.updateCalls[0].storage.step).toBe('step_4');
    });

    it('immediately flushes pending storage on unmount before debounce timer fires (zero data loss on unmount)', () => {
      const harness = new VirtualStorageDebouncerHarness('artifact_shape_3', {}, mockWindow);

      // Rapidly write 50 updates
      for (let i = 1; i <= 50; i++) {
        harness.handleMessage({
          source: mockWindow,
          data: {
            type: 'CANVASOS_STORAGE_SYNC',
            shapeId: 'artifact_shape_3',
            storage: { progress: `${i}%` },
          },
        });
      }

      // Before timer fires (t = 0), component is unmounted
      expect(harness.updateCalls.length).toBe(0);
      harness.unmount();

      // Immediate flush on unmount: 1 call with 50%
      expect(harness.updateCalls.length).toBe(1);
      expect(harness.updateCalls[0].storage.progress).toBe('50%');

      // Verify timer is canceled: waiting 350ms produces NO second flush
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(harness.updateCalls.length).toBe(1);
          resolve();
        }, 350);
      });
    });

    it('deduplicates identical content without scheduling unnecessary update timers', () => {
      const harness = new VirtualStorageDebouncerHarness('artifact_shape_4', {}, mockWindow);

      const msg = {
        source: mockWindow,
        data: {
          type: 'CANVASOS_STORAGE_SYNC',
          shapeId: 'artifact_shape_4',
          storage: { mode: 'dark', volume: '80' },
        },
      };

      // First message schedules timer
      harness.handleMessage(msg);
      expect(harness.debounceTimer).not.toBeNull();

      // Second message with identical content is deduplicated
      const timerBefore = harness.debounceTimer;
      harness.handleMessage(msg);
      // Timer was not replaced or re-triggered unnecessarily
      expect(harness.debounceTimer).toBe(timerBefore);

      harness.flushStorageUpdate();
      expect(harness.updateCalls.length).toBe(1);
    });

    it('rejects malformed, spoofed, or adversarial storage messages via readStorageMessage', () => {
      const shapeId = 'artifact_shape_secure';

      // 1. Spoofed alien source window
      const alienWindow = { name: 'malicious_origin' };
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: { a: 'b' } },
          alienWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 2. Mismatched shapeId
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId: 'wrong_shape', storage: { a: 'b' } },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 3. Wrong message type
      expect(
        readStorageMessage(
          { type: 'OTHER_TYPE', shapeId, storage: { a: 'b' } },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 4. Non-string storage values (e.g. code injection / numbers / objects)
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: { count: 123 } },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 5. Array instead of key-value map
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: ['val1', 'val2'] },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 6. Excessive key length (> 512 characters)
      const oversizedKey = 'k'.repeat(513);
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: { [oversizedKey]: 'v' } },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 7. Excessive entry count (> 500 entries)
      const excessiveMap: Record<string, string> = {};
      for (let i = 0; i < 501; i++) {
        excessiveMap[`key_${i}`] = `val_${i}`;
      }
      expect(
        readStorageMessage(
          { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: excessiveMap },
          mockWindow,
          mockWindow,
          shapeId
        )
      ).toBeNull();

      // 8. Valid message returns parsed dictionary
      const valid = readStorageMessage(
        { type: 'CANVASOS_STORAGE_SYNC', shapeId, storage: { authToken: 'xyz', state: 'active' } },
        mockWindow,
        mockWindow,
        shapeId
      );
      expect(valid).toEqual({ authToken: 'xyz', state: 'active' });
    });
  });
});
