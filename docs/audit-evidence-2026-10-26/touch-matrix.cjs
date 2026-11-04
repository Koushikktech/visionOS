process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/private/tmp/visionos-playwright-browsers';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || '/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const { webkit: chromium } = require(playwrightModule);
const base = process.env.VISIONOS_BASE_URL || 'http://127.0.0.1:3006';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    for (const type of ['Rich Card', 'Code Card', 'Document', 'Slide Deck', 'Interactive App']) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.addInitScript(() => { if (window.top === window) localStorage.setItem('visionos_onboarded_v1', 'true'); });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(350);
      await page.getByRole('button', { name: 'Custom Cards Popover' }).tap();
      await page.getByRole('menuitem', { name: type, exact: true }).tap();
      await page.waitForTimeout(180);
      const edit = page.getByRole('button', { name: /Edit content/i });
      const box = await edit.boundingBox();
      const inBounds = Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      await edit.tap();
      await page.waitForTimeout(160);
      const result = { size: `${viewport.width}x${viewport.height}`, type, inBounds, dialogCount: await page.getByRole('dialog').count(), errors };
      results.push(result);
      await context.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.inBounds || result.dialogCount !== 1 || result.errors.length)) process.exit(2);
})().catch((error) => { console.error(error); process.exit(1); });
