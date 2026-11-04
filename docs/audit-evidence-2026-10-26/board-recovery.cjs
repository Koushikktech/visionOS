process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/private/tmp/visionos-playwright-browsers';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || '/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const { webkit } = require(playwrightModule);
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.VISIONOS_BASE_URL || 'http://127.0.0.1:3006';
const DB_NAME = 'visionos-primary-board-recovery-v1';
const RECORDS = 'document-records';
const META = 'metadata';
const LOCK_NAME = 'visionos-primarycanvas-recovery-copy';

async function readBoard(page) {
  return page.evaluate(async ({ DB_NAME, RECORDS, META }) => {
    const open = indexedDB.open(DB_NAME);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const tx = db.transaction([RECORDS, META], 'readonly');
      const complete = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      const requestValue = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [meta, rows] = await Promise.all([
        requestValue(tx.objectStore(META).get('primarycanvas')),
        requestValue(tx.objectStore(RECORDS).getAll()),
      ]);
      await complete;
      return { meta, rows };
    } finally {
      db.close();
    }
  }, { DB_NAME, RECORDS, META });
}

async function replaceRecoveryPageName(page, newName) {
  return page.evaluate(async ({ DB_NAME, RECORDS, META, newName }) => {
    const open = indexedDB.open(DB_NAME);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([RECORDS, META], 'readwrite');
        const records = tx.objectStore(RECORDS);
        const metadata = tx.objectStore(META);
        const metaRequest = metadata.get('primarycanvas');
        const rowsRequest = records.getAll();
        let meta;
        let rows;
        let ready = 0;
        let result;
        const fail = (error) => {
          try { tx.abort(); } catch { /* transaction already ended */ }
          reject(error);
        };
        const process = () => {
          if (++ready !== 2) return;
          try {
            const pageId = meta?.session?.currentPageId;
            const row = rows.find((item) => item.id === pageId && item.record?.typeName === 'page');
            if (!meta || !row) throw new Error('The active page row was not found in the app-owned recovery DB.');
            row.record.name = newName;
            row.bytes = new TextEncoder().encode(JSON.stringify(row.record)).byteLength;
            for (const item of rows) records.put(item);
            const bytes = rows.reduce((sum, item) => sum + item.bytes, 0);
            meta.revision += 1;
            meta.savedAt = new Date().toISOString();
            meta.recordCount = rows.length;
            meta.bytes = bytes;
            metadata.put(meta);
            result = { revision: meta.revision, pageId, pageName: row.record.name, recordCount: rows.length, bytes };
          } catch (error) {
            fail(error);
          }
        };
        metaRequest.onsuccess = () => { meta = metaRequest.result; process(); };
        rowsRequest.onsuccess = () => { rows = rowsRequest.result; process(); };
        metaRequest.onerror = () => fail(metaRequest.error);
        rowsRequest.onerror = () => fail(rowsRequest.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Fixture transaction aborted.'));
      });
    } finally {
      db.close();
    }
  }, { DB_NAME, RECORDS, META, newName });
}

async function waitForCommittedPage(page, expectedName, afterRevision) {
  const deadline = Date.now() + 12_000;
  let current;
  while (Date.now() < deadline) {
    current = await readBoard(page);
    const row = current.rows.find((item) => item.id === current.meta?.session?.currentPageId);
    if (current.meta?.revision > afterRevision && row?.record?.name === expectedName) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for exact IndexedDB recovery commit: ${JSON.stringify({ revision: current?.meta?.revision, expectedAfter: afterRevision, page: current?.rows.find((item) => item.id === current?.meta?.session?.currentPageId)?.record?.name, expectedName })}`);
}

async function readWorkspacePreviousSnapshot(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('visionos-workspace-recovery-v1');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      if (!db.objectStoreNames.contains('snapshots')) return null;
      const tx = db.transaction('snapshots', 'readonly');
      const complete = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      const request = tx.objectStore('snapshots').get('before-last-restore');
      const saved = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await complete;
      return saved ?? null;
    } finally {
      db.close();
    }
  });
}

async function runScenario(browser, mode) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: true });
  await context.addInitScript(() => {
    if (window.top !== window) return;
    try { localStorage.setItem('visionos_onboarded_v1', 'true'); } catch { /* opaque child frame */ }
    window.__webkitLockAcquisitions = [];
    const manager = navigator.locks;
    if (manager && typeof manager.request === 'function') {
      const prototype = Object.getPrototypeOf(manager);
      const original = prototype.request;
      try {
        Object.defineProperty(prototype, 'request', {
          configurable: true,
          value: function (...args) {
            const callbackIndex = args.length - 1;
            if (typeof args[callbackIndex] === 'function') {
              const callback = args[callbackIndex];
              args[callbackIndex] = (...callbackArgs) => {
                window.__webkitLockAcquisitions.push(String(args[0]));
                return callback(...callbackArgs);
              };
            }
            return original.apply(this, args);
          },
        });
        window.__webkitLockProbeInstalled = true;
      } catch {
        window.__webkitLockProbeInstalled = false;
      }
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.getByText('Recovery copy saved on this device', { exact: true }).first().waitFor();
    let db = await readBoard(page);
    assert.equal(db.meta?.key, 'primarycanvas', 'the application seeded its app-owned recovery DB');
    assert.ok(db.meta.recordCount > 0 && db.rows.length === db.meta.recordCount, 'seed record count matches durable rows');
    const initialRevision = db.meta.revision;
    const liveName = `Live ${mode} fixture`;
    const recoveryName = `Recovery ${mode} fixture`;

    await page.getByRole('button', { name: /^Pages, current page/ }).click();
    await page.getByRole('button', { name: /^Rename Page / }).click();
    const rename = page.getByRole('textbox', { name: /^Rename Page / });
    await rename.fill(liveName);
    await rename.press('Enter');
    const committedLive = await waitForCommittedPage(page, liveName, initialRevision);
    assert.equal(committedLive.meta.recordCount, committedLive.rows.length, 'manual page-name document delta committed with matching record count');

    const fixture = await replaceRecoveryPageName(page, recoveryName);
    assert.equal(fixture.pageName, recoveryName);
    const channelResult = await page.evaluate(({ revision }) => {
      if (typeof BroadcastChannel === 'undefined') return false;
      const channel = new BroadcastChannel('visionos-primary-board-recovery-v1');
      channel.postMessage({ workspace: 'primarycanvas', revision, source: 'webkit-recovery-fixture' });
      channel.close();
      return true;
    }, { revision: fixture.revision });
    assert.equal(channelResult, true, 'WebKit BroadcastChannel is available to exercise the real controller refresh path');
    await page.getByRole('button', { name: 'Export canvas and workspace' }).click();
    const exportMenu = page.getByRole('dialog', { name: 'Export options', exact: true });
    await exportMenu.waitFor();
    await page.waitForFunction(() => {
      const popover = document.querySelector('#visionos-export-popover');
      return !!popover && popover.contains(document.activeElement);
    });
    await page.getByText('This canvas and its recovery copy differ', { exact: true }).first().waitFor();

    const reviewButton = page.getByRole('button', { name: 'Review recovery', exact: true });
    await reviewButton.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Review recovery copy', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByText(liveName, { exact: true }).waitFor();
    await dialog.getByText(recoveryName, { exact: true }).waitFor();
    const heading = dialog.locator('[data-dialog-initial-focus]');
    await page.waitForFunction(() => {
      const initial = document.querySelector('[data-canvas-recovery-dialog="true"] [data-dialog-initial-focus]');
      return !!initial && document.activeElement === initial;
    });
    assert.equal(await heading.evaluate((el) => el === document.activeElement), true, 'recovery review receives initial focus');
    await page.keyboard.press('Tab');
    const closeReview = dialog.getByRole('button', { name: 'Close recovery review', exact: true });
    assert.equal(await closeReview.evaluate((el) => el === document.activeElement), true, 'Tab from recovery heading enters the first dialog control');
    await page.keyboard.press('Shift+Tab');
    const downloadButton = dialog.getByRole('button', { name: 'Download copy', exact: true });
    assert.equal(await downloadButton.evaluate((el) => el === document.activeElement), true, 'Shift+Tab wraps to the last recovery dialog control');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await reviewButton.evaluate((el) => el === document.activeElement), true, 'Escape returns focus to the recovery review trigger');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'visible' });

    if (mode === 'stale') {
      const latestRecoveryName = 'Recovery stale latest fixture';
      const unannounced = await replaceRecoveryPageName(page, latestRecoveryName);
      assert.equal(unannounced.revision, fixture.revision + 1);
      // Intentionally do not post a BroadcastChannel notice: the restore path
      // itself must reread the owned database and reject a stale review.
      await dialog.getByRole('button', { name: 'Restore reviewed recovery copy', exact: true }).click();
      const actionAlert = dialog.getByText(/The recovery copy changed in another tab/);
      await actionAlert.waitFor();
      const rejection = await actionAlert.innerText();
      assert.match(rejection, /recovery copy changed/i, 'Restore rejects a copy changed after review');
      const afterRejectedRestore = await readBoard(page);
      const stillStoredRecoveryPage = afterRejectedRestore.rows.find((row) => row.id === afterRejectedRestore.meta.session.currentPageId)?.record;
      assert.equal(stillStoredRecoveryPage?.name, latestRecoveryName, 'rejected restore leaves the newer recovery copy intact');
      assert.equal(afterRejectedRestore.meta.revision, unannounced.revision, 'rejected restore does not overwrite the newer recovery copy');
      const livePageButton = page.getByRole('button', { name: `Pages, current page ${liveName}`, exact: true });
      await livePageButton.waitFor();
      const reviewLatest = dialog.getByRole('button', { name: 'Review latest copy', exact: true });
      await reviewLatest.waitFor();
      await reviewLatest.click();
      await dialog.getByText(latestRecoveryName, { exact: true }).waitFor();
      const restoreEnabled = await dialog.getByRole('button', { name: 'Restore reviewed recovery copy', exact: true }).isEnabled();
      assert.equal(restoreEnabled, true, 'reviewing the latest copy re-enables the restore choice');
      assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join('; ')}`);
      return {
        mode,
        webkit: await page.evaluate(() => navigator.userAgent),
        lockManagerPresent: await page.evaluate(() => typeof navigator.locks?.request === 'function'),
        lockProbeInstalled: await page.evaluate(() => window.__webkitLockProbeInstalled),
        lockAcquisitions: await page.evaluate(() => window.__webkitLockAcquisitions),
        liveDocumentDelta: { revision: committedLive.meta.revision, pageName: liveName },
        conflictFixture: fixture,
        unannouncedUpdate: unannounced,
        staleRestoreRejection: { message: rejection, livePageStill: liveName, recoveryCopyStill: stillStoredRecoveryPage.name, dbRevision: afterRejectedRestore.meta.revision },
        reviewLatest: { pageName: latestRecoveryName, restoreEnabled },
        pageErrors,
      };
    }

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download copy', exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = `/private/tmp/visionos-webkit-recovery-${mode}.json`;
    await download.saveAs(downloadPath);
    const downloaded = JSON.parse(await fs.readFile(downloadPath, 'utf8'));
    assert.equal(downloaded.format, 'visionos-backup');
    const downloadedPage = Object.values(downloaded.snapshot.document.store).find((record) => record.typeName === 'page' && record.id === downloaded.snapshot.session.currentPageId);
    assert.equal(downloadedPage?.name, recoveryName, 'downloaded copy contains the reviewed recovery page');
    await dialog.getByText(/Backup downloaded with 0 media item/).waitFor();

    if (mode === 'keep') {
      await dialog.getByRole('button', { name: 'Keep current and replace recovery copy', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const kept = await waitForCommittedPage(page, liveName, fixture.revision);
      assert.equal(kept.meta.revision, fixture.revision + 1);
      assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join('; ')}`);
      return {
        mode,
        webkit: await page.evaluate(() => navigator.userAgent),
        lockManagerPresent: await page.evaluate(() => typeof navigator.locks?.request === 'function'),
        lockProbeInstalled: await page.evaluate(() => window.__webkitLockProbeInstalled),
        lockAcquisitions: await page.evaluate(() => window.__webkitLockAcquisitions),
        seed: { revision: initialRevision, records: db.meta.recordCount },
        liveDocumentDelta: { revision: committedLive.meta.revision, pageName: liveName },
        conflictFixture: fixture,
        reviewFocus: { initial: true, tabIntoDialog: true, reverseBoundaryWrap: true, escapeReturnsFocus: true },
        download: { format: downloaded.format, pageName: downloadedPage.name, bytes: (await fs.stat(downloadPath)).size },
        keepCurrent: { revision: kept.meta.revision, pageName: kept.rows.find((row) => row.id === kept.meta.session.currentPageId).record.name },
        pageErrors,
      };
    }

    const lockManagerPresent = await page.evaluate(() => typeof navigator.locks?.request === 'function');
    assert.equal(lockManagerPresent, true, 'WebKit public Web Locks API is available for the restore');
    await dialog.getByRole('button', { name: 'Restore reviewed recovery copy', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 20_000 });
    const restored = await waitForCommittedPage(page, recoveryName, fixture.revision);
    assert.equal(restored.meta.revision, fixture.revision + 1, 'restore replaced the app-owned recovery copy at next revision');
    const previous = await readWorkspacePreviousSnapshot(page);
    assert.ok(previous?.snapshot?.document?.store, 'C8 restore wrote a durable pre-restore workspace snapshot');
    const previousPage = Object.values(previous.snapshot.document.store).find((record) => record.typeName === 'page' && record.id === previous.snapshot.session.currentPageId);
    assert.equal(previousPage?.name, liveName, 'C8 durable pre-restore snapshot contains the live board before replacement');
    assert.equal(pageErrors.length, 0, `no page errors: ${pageErrors.join('; ')}`);
    return {
      mode,
      webkit: await page.evaluate(() => navigator.userAgent),
      lockManagerPresent,
      lockProbeInstalled: await page.evaluate(() => window.__webkitLockProbeInstalled),
      lockAcquisitions: await page.evaluate(() => window.__webkitLockAcquisitions),
      seed: { revision: initialRevision, records: db.meta.recordCount },
      liveDocumentDelta: { revision: committedLive.meta.revision, pageName: liveName },
      conflictFixture: fixture,
      review: { liveName, recoveryName },
      reviewFocus: { initial: true, tabIntoDialog: true, reverseBoundaryWrap: true, escapeReturnsFocus: true },
      download: { format: downloaded.format, pageName: downloadedPage.name, bytes: (await fs.stat(downloadPath)).size },
      restore: { revision: restored.meta.revision, pageName: restored.rows.find((row) => row.id === restored.meta.session.currentPageId).record.name },
      c8DurableBackup: { key: previous.key, pageName: previousPage?.name, savedAt: previous.savedAt },
      pageErrors,
    };
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const results = [];
    for (const mode of ['keep', 'restore', 'stale']) results.push(await runScenario(browser, mode));
    console.log(JSON.stringify({ base, engine: 'Playwright WebKit headless (not Safari app/device)', results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
