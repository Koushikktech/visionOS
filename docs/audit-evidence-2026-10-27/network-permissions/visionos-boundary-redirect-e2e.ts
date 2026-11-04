import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { buildArtifactSrcDoc } from '/Users/koushikk/Documents/projects/visionOS/src/lib/artifactRuntime.ts';
import { buildArtifactBoundarySrcDoc } from '/Users/koushikk/Documents/projects/visionOS/src/lib/artifactFrameBoundary.ts';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serverHits: string[] = [];
const server = createServer({ key: readFileSync('/private/tmp/visionos-fixture.key'), cert: readFileSync('/private/tmp/visionos-fixture.crt') }, (request, response) => {
  serverHits.push(request.url || '');
  response.setHeader('access-control-allow-origin', '*');
  if (request.url === '/data') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('loopback-ok'); return; }
  if (request.url === '/redirect') { response.writeHead(302, { location: 'https://evil.test/redirect-target' }); response.end(); return; }
  response.writeHead(404); response.end();
});
const listen = () => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
(async () => {
  await listen();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback fixture did not bind');
  const approvedOrigin = `https://127.0.0.1:${address.port}`;
  const shapeId = 'shape:redirect', frameToken = 'frame:redirect';
  const appCode = [
    '<main>redirect fixture</main>', '<script>',
    "window.VisionOS.storage.setItem('counter','1');",
    `fetch(${JSON.stringify(approvedOrigin + '/data')}).then(r=>r.text()).then(text=>window.VisionOS.storage.setItem('approvedFetch',text)).catch(()=>{});`,
    `fetch(${JSON.stringify(approvedOrigin + '/redirect')}).catch(()=>{});`,
    "fetch('https://evil.test/direct').catch(()=>{});",
    "setTimeout(()=>location.assign('https://evil.test/leave'),1100);",
    '</script>',
  ].join('\n');
  const childSrcDoc = buildArtifactSrcDoc(appCode, shapeId, {}, [approvedOrigin], frameToken);
  const boundarySrcDoc = buildArtifactBoundarySrcDoc({ childSrcDoc, shapeId, frameToken, origins: [approvedOrigin] });
  const appHtml = `<!doctype html><html><body><script>window.__events=[];addEventListener('message',e=>window.__events.push(e.data));const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts allow-modals');f.srcdoc=${JSON.stringify(boundarySrcDoc).replace(/</g,'\\u003c')};document.body.appendChild(f);</script></body></html>`;
  const results: any = {};
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await type.launch(name === 'chromium' ? { headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : { headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const intercepted: string[] = [], errors: string[] = [];
    await context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url.startsWith('blob:')) return route.continue();
      if (url.startsWith('https://app.test/')) return route.fulfill({ status: 200, contentType: 'text/html', body: appHtml });
      if (url.startsWith(approvedOrigin + '/')) return route.continue();
      intercepted.push(url);
      errors.push('unexpected request: ' + url);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', (error: Error) => errors.push('page error: ' + error.message));
    await page.goto('https://app.test/e2e');
    serverHits.length = 0; await page.waitForTimeout(2200);
    const events = await page.evaluate(() => window.__events);
    const requests = await page.evaluate(() => performance.getEntriesByType('resource').map((entry: any) => entry.name));
    results[name] = {
      serverHits: [...serverHits],
      approvedStorage: events.some((event: any) => event?.type === 'VISIONOS_STORAGE_SYNC' && event.storage?.approvedFetch === 'loopback-ok'),
      deniedRedirectHint: events.some((event: any) => event?.type === 'VISIONOS_NETWORK_BLOCKED' && event.url === 'https://evil.test' && event.directive === 'connect-src'),
      genericNavigationBlocked: events.some((event: any) => event?.type === 'VISIONOS_NAVIGATION_BLOCKED'),
      noEvilRequest: !intercepted.some((url) => url.includes('evil.test')),
      interceptedUnexpected: intercepted,
      errors,
      eventTypes: events.map((event: any) => event?.type),
    };
    await browser.close();
  }
  await close();
  console.log(JSON.stringify({ approvedOrigin, results }, null, 2));
})().catch(async (error) => { console.error(error); await close(); process.exitCode = 1; });
