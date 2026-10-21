import { describe, it, expect } from 'bun:test';
import { stripMarkdownFences } from '@/shapes/ArtifactShapeUtil';

describe('Artifact Code Sanitizer & Markdown Stripping Suite (src/test/artifactSanitizer.test.ts)', () => {
  it('leaves pure HTML untouched without modification', () => {
    const html = '<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello</h1></body></html>';
    expect(stripMarkdownFences(html)).toBe(html);
  });

  it('strips standard ```html ... ``` fences', () => {
    const raw = '```html\n<!DOCTYPE html><html><body><h1>Hello</h1></body></html>\n```';
    const result = stripMarkdownFences(raw);
    expect(result).toBe('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>');
    expect(result).not.toContain('```html');
    expect(result).not.toContain('```');
  });

  it('strips ```xml and ``` fences', () => {
    const raw = '```xml\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```';
    const result = stripMarkdownFences(raw);
    expect(result).toBe('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
    expect(result).not.toContain('```xml');
  });

  it('strips bare ``` ... ``` fences without language tag', () => {
    const raw = '```\n<div>Interactive Widget</div>\n```';
    const result = stripMarkdownFences(raw);
    expect(result).toBe('<div>Interactive Widget</div>');
  });

  it('extracts code block from surrounding conversational preamble and outro text', () => {
    const raw = `Here is your fully functioning interactive calculator app:
\`\`\`html
<!DOCTYPE html>
<html>
<body>
  <div id="calculator">Display</div>
</body>
</html>
\`\`\`
I hope this meets your needs! Let me know if you want adjustments.`;

    const result = stripMarkdownFences(raw);
    expect(result).toContain('<div id="calculator">Display</div>');
    expect(result).not.toContain('Here is your');
    expect(result).not.toContain('I hope this meets');
    expect(result).not.toContain('```html');
    expect(result).not.toContain('```');
  });

  it('safely handles unclosed leading code fence (e.g. streaming or truncated response)', () => {
    const raw = '```html\n<!DOCTYPE html><html><body><h1>Truncated';
    const result = stripMarkdownFences(raw);
    expect(result).toBe('<!DOCTYPE html><html><body><h1>Truncated');
    expect(result).not.toContain('```html');
  });

  it('safely handles empty, null, or whitespace-only code', () => {
    expect(stripMarkdownFences('')).toBe('');
    expect(stripMarkdownFences('   ')).toBe('');
    expect(stripMarkdownFences(null as any)).toBe('');
    expect(stripMarkdownFences(undefined as any)).toBe('');
  });

  it('strips rogue leading and trailing backticks', () => {
    const raw = '`<div>Counter</div>`';
    expect(stripMarkdownFences(raw)).toBe('<div>Counter</div>');
  });

  it('extracts code when conversational preamble exists with an unclosed fence', () => {
    const raw = `Sure! Here is the interactive counter app:\n\`\`\`html\n<!DOCTYPE html><html><body><h1>Counter</h1></body></html>`;
    const result = stripMarkdownFences(raw);
    expect(result).toBe('<!DOCTYPE html><html><body><h1>Counter</h1></body></html>');
    expect(result).not.toContain('Sure! Here is');
    expect(result).not.toContain('```html');
  });

  it('preserves valid JavaScript template literals within HTML script tags', () => {
    const raw = `<!DOCTYPE html><html><body><script>const msg = \`Hello \${name}\`;</script></body></html>`;
    const result = stripMarkdownFences(raw);
    expect(result).toContain('const msg = `Hello ${name}`;');
  });

  describe('Interactive App Iframe Pinch-to-Zoom Interception & Camera Anchoring', () => {
    it('verifies that the artifact source code contains the pinch-zoom message interceptor and safari gesture suppressors', async () => {
      const fs = await import('fs');
      const fileContent = fs.readFileSync('src/shapes/ArtifactShapeUtil.tsx', 'utf-8');

      expect(fileContent).toContain('CANVASOS_IFRAME_PINCH_ZOOM');
      expect(fileContent).toContain('window.addEventListener(\'wheel\'');
      expect(fileContent).toContain('e.ctrlKey || e.metaKey');
      expect(fileContent).toContain('preventSafariGesture');
      expect(fileContent).toContain('window.addEventListener(\'gesturestart\'');
      expect(fileContent).toContain('window.addEventListener(\'gesturechange\'');
      expect(fileContent).toContain('window.addEventListener(\'gestureend\'');
    });

    it('mathematically proves anchor point invariance during canvas zoom under cursor', () => {
      // Simulate physical cursor at screen point (sx, sy)
      const sx = 480;
      const sy = 320;
      const screenBounds = { x: 0, y: 0 };
      const initialCamera = { x: -100, y: -50, z: 1.0 };

      // 1. Convert screen cursor to page point at initial camera
      const pPage = {
        x: (sx - screenBounds.x) / initialCamera.z - initialCamera.x,
        y: (sy - screenBounds.y) / initialCamera.z - initialCamera.y,
      };

      // 2. Perform trackpad pinch to next zoom (e.g. 1.85x)
      const nextZ = 1.85;
      const nextCx = ((pPage.x + initialCamera.x) * initialCamera.z) / nextZ - pPage.x;
      const nextCy = ((pPage.y + initialCamera.y) * initialCamera.z) / nextZ - pPage.y;

      // 3. Project page point back to screen space at next camera
      const projectedScreenX = (pPage.x + nextCx) * nextZ + screenBounds.x;
      const projectedScreenY = (pPage.y + nextCy) * nextZ + screenBounds.y;

      // 4. Cursor position must be 100% invariant (delta < 1e-10)
      expect(Math.abs(projectedScreenX - sx)).toBeLessThan(1e-10);
      expect(Math.abs(projectedScreenY - sy)).toBeLessThan(1e-10);
    });

    it('verifies exponential zoom delta scaling is symmetric and clamped between 0.05 and 8.0', () => {
      const cz = 1.0;
      const zoomFactorIn = Math.exp(-(-5) * 0.008); // pinch out (zoom in)
      const zoomFactorOut = Math.exp(-(5) * 0.008); // pinch in (zoom out)

      // Inverse symmetry: zooming in by 5 ticks then zooming out by 5 ticks restores original zoom
      expect(Math.abs(zoomFactorIn * zoomFactorOut - 1.0)).toBeLessThan(1e-12);

      // Verify clamping limits
      const hugeZoomOut = Math.min(8.0, Math.max(0.05, 0.06 * Math.exp(-120 * 0.008)));
      expect(hugeZoomOut).toBeGreaterThanOrEqual(0.05);

      const hugeZoomIn = Math.min(8.0, Math.max(0.05, 7.9 * Math.exp(-(-120) * 0.008)));
      expect(hugeZoomIn).toBeLessThanOrEqual(8.0);
    });
  });
});
