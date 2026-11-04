process.env.PLAYWRIGHT_BROWSERS_PATH = '/private/tmp/visionos-playwright-browsers';
const { chromium, webkit } = require('/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const BASE = 'http://127.0.0.1:3010';
const OUT = __dirname;
const TYPES = [
  { type: 'artifact', menu: 'App actions', editor: 'View/Edit Source Code', focused: true },
  { type: 'code_card', menu: 'Code card actions', editor: 'Edit source code', focused: true },
  { type: 'document', menu: 'Document export options', editor: 'Edit document', focused: true },
  { type: 'media_embed', menu: 'Media actions' },
  { type: 'rich_card', menu: 'Note actions', editor: 'Edit note content', focused: true },
  { type: 'slide_deck', menu: 'Deck export options', editor: 'Edit deck', focused: true, menuEditor: true },
];

// Keep discovery in sync with studio-deep-browser.cjs: find the public tldraw
// Editor instance attached to the canvas React tree without app instrumentation.
async function editor(page) {
  await page.locator('.tl-canvas').waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('.tl-canvas');
    let fiber = el?.[Object.keys(el || {}).find((key) => key.startsWith('__reactFiber'))];
    for (let i = 0; fiber && i < 150; i++, fiber = fiber.return) {
      for (const value of Object.values(fiber.memoizedProps || {})) {
        if (value && typeof value.getCurrentPageShapes === 'function') {
          window.__qaEditor = value;
          return true;
        }
      }
      let hook = fiber.memoizedState;
      for (let j = 0; hook && j < 50; j++, hook = hook.next) {
        const value = hook.memoizedState;
        if (value && typeof value.getCurrentPageShapes === 'function') {
          window.__qaEditor = value;
          return true;
        }
      }
    }
    return false;
  });
}

async function setAppearance(page, appearance) {
  await page.emulateMedia({ colorScheme: appearance });
  await page.evaluate((value) => { document.documentElement.dataset.appearance = value; window.dispatchEvent(new Event("visionos:appearance-change")); }, appearance);
  await page.waitForTimeout(100);
}

async function selectAndFrame(page, id) {
  await page.evaluate((shapeId) => {
    const editor = window.__qaEditor;
    editor.setSelectedShapes([shapeId]);
    editor.zoomToSelection({ animation: { duration: 0 } });
  }, id);
  const windowCard = id.endsWith("slide_deck") ? page.locator(".studio-native-deck") : page.locator(`[id="${id}"]`);
  await windowCard.locator('[data-window-header]').waitFor();
  return windowCard;
}

async function openFocusedEditor(page, card, spec) {
  if (!spec.editor) return false;
  if (spec.menuEditor) {
    await card.getByRole('button', { name: spec.menu, exact: true }).click();
    await page.getByRole('menu', { name: spec.menu, exact: true }).waitFor();
    await page.getByRole('menuitem', { name: spec.editor, exact: true }).click();
  } else {
    await card.getByRole('button', { name: spec.editor, exact: true }).click();
  }

  if (spec.sourceEditor) {
    await card.locator('[data-native-editor="source"] textarea').waitFor();
    return true;
  }
  await page.locator('.studio-focus-backdrop[role="dialog"]').waitFor();
  return true;
}

async function closeFocusedEditor(page, card, spec) {
  if (!spec.editor) return;
  if (spec.sourceEditor) {
    await card.getByRole('button', { name: 'View paused app', exact: true }).click();
    await card.locator('[data-native-editor="source"]').waitFor({ state: 'hidden' });
    return;
  }
  await page.keyboard.press('Escape');
  await page.locator('.studio-focus-backdrop[role="dialog"]').waitFor({ state: 'hidden' });
}

async function assertDialogFits(page, width, height) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.studio-focus-backdrop[role="dialog"]');
    if (!dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  });
  const box = await page.locator('.studio-focus-backdrop[role="dialog"]').boundingBox();
  assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1,
    `focused editor must fit ${width}x${height}`);
}

(async () => {
  const results = [];
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const remoteBlocked = [];
      const aiBlocked = [];
      await page.route(/^https?:\/\//, async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== BASE) {
          remoteBlocked.push(url.href);
          await route.abort();
        } else if (url.pathname.startsWith('/api/ai/')) {
          aiBlocked.push(url.pathname);
          await route.abort();
        } else {
          await route.continue();
        }
      });
      await page.goto(`${BASE}/?view=canvas`);
      await editor(page);
      const tip = page.getByRole('button', { name: 'Dismiss canvas tip', exact: true });
      if (await tip.count()) await tip.click();

      const runId = Date.now().toString(36);
      const shapes = TYPES.map((spec, index) => ({
        id: `shape:qa-glass-${runId}-${spec.type}`,
        type: spec.type,
        x: index * 960,
        y: 0,
        ...(spec.type === 'artifact' ? { props: { runtimePaused: true, networkEnabled: false } } : {}),
      }));
      await page.evaluate((items) => { window.__qaEditor.createShapes(items); }, shapes);
      await page.waitForFunction((items) => items.every(({ id, type }) => window.__qaEditor.getShape(id)?.type === type), shapes);
      assert.equal(await page.evaluate((id) => window.__qaEditor.getShape(id).props.runtimePaused, shapes[0].id), true,
        'the default artifact example stays paused during visual verification');

      const ids = Object.fromEntries(shapes.map((shape) => [shape.type, shape.id]));
      for (const appearance of ['light', 'dark']) {
        await setAppearance(page, appearance);
        for (const spec of TYPES) {
          const card = await selectAndFrame(page, ids[spec.type]);
          await page.screenshot({ path: path.join(OUT, `${engineName}-window-${spec.type}-${appearance}.png`) });
          if (spec.editor) {
            await openFocusedEditor(page, card, spec);
            await page.screenshot({ path: path.join(OUT, `${engineName}-window-editor-${spec.type}-${appearance}.png`) });
            await closeFocusedEditor(page, card, spec);
          }
        }
      }

      // Confirm the overflow menus keep keyboard focus, support End, and return
      // focus to their actual accessible trigger when Escape closes them.
      await setAppearance(page, 'light');
      for (const spec of TYPES) {
        const card = await selectAndFrame(page, ids[spec.type]);
        const trigger = card.getByRole('button', { name: spec.menu, exact: true });
        await trigger.click();
        const menu = page.getByRole('menu', { name: spec.menu, exact: true });
        await menu.waitFor();
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="menu"]'))), true,
          `${spec.menu}: End keeps focus in the menu`);
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden' });
        await page.waitForFunction((label) => document.activeElement?.getAttribute('aria-label') === label, spec.menu);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), spec.menu,
          `${spec.menu}: Escape returns focus to the trigger`);
      }

      // Check a focused editor in a narrow viewport and a short desktop viewport.
      const documentSpec = TYPES.find((spec) => spec.type === 'document');
      const documentCard = await selectAndFrame(page, ids.document);
      await openFocusedEditor(page, documentCard, documentSpec);
      for (const [width, height] of [[320, 568], [1024, 500]]) {
        await page.setViewportSize({ width, height });
        await assertDialogFits(page, width, height);
        await page.screenshot({ path: path.join(OUT, `${engineName}-window-editor-document-${width}x${height}.png`) });
      }
      await closeFocusedEditor(page, documentCard, documentSpec);
      assert.deepEqual(aiBlocked, [], 'visual verification never requests AI endpoints');
      results.push({
        engine: engineName,
        defaultShapes: TYPES.map((spec) => spec.type),
        appearanceScreenshots: 12,
        focusedEditorScreenshotsPerAppearance: 5,
        menuKeyboardChecks: TYPES.length,
        focusedEditorBounds: ['320x568', '1024x500'],
        artifactPaused: true,
        aiRequests: aiBlocked.length,
        blockedRemoteOrigins: remoteBlocked,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  await fs.writeFile(path.join(OUT, 'windows-browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
