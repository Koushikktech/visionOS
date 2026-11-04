import { describe, expect, it } from 'bun:test';
import {
  buildArtifactCsp,
  buildArtifactRuntimeScript,
  buildArtifactSrcDoc,
  escapeInlineScriptJson,
  getArtifactSourceUpdate,
  hasExternalDependencies,
  usesTailwindUtilities,
} from './artifactRuntime';

describe('artifact runtime policy and source preparation', () => {
  it('revokes network opt-in only when a saved app source changes', () => {
    expect(getArtifactSourceUpdate('<main>same</main>', '<main>same</main>')).toEqual({
      code: '<main>same</main>',
    });
    expect(getArtifactSourceUpdate('<main>new</main>', '<main>old</main>')).toEqual({
      code: '<main>new</main>',
      networkEnabled: false,
    });
  });

  it('limits requests to exact HTTPS origins and keeps forms and remote frames blocked', () => {
    const offline = buildArtifactCsp([]);
    expect(offline).toContain("default-src 'none'");
    expect(offline).toContain("connect-src 'none'");
    expect(offline).toContain("form-action 'none'");
    expect(offline).toContain("frame-src 'none'");
    expect(offline).not.toContain('https:');
    expect(offline).not.toContain('navigate-to');

    const granted = buildArtifactCsp([
      'https://api.example.test',
      'https://cdn.example.test:8443',
      'https://api.example.test/path?ignored=1',
      'https://api.example.test',
      'http://insecure.example.test',
      'https://user:password@private.example.test',
      'https://*.example.test',
    ]);
    expect(granted).toContain('connect-src https://api.example.test wss://api.example.test https://cdn.example.test:8443 wss://cdn.example.test:8443');
    expect(granted).toContain('script-src \'unsafe-inline\' \'unsafe-eval\' data: blob: https://api.example.test https://cdn.example.test:8443');
    expect(granted).toContain("form-action 'none'");
    expect(granted).toContain("frame-src 'none'");
    expect(granted).not.toContain('insecure.example.test');
    expect(granted).not.toContain('private.example.test');
    expect(granted).not.toContain('*.example.test');
  });

  it('places host CSP and bootstrap before hostile or malformed generated markup', () => {
    const hostile = `<script src="https://attacker.example/early.js"></script><meta http-equiv="Content-Security-Policy" content="default-src https:"><div>ready</div>`;
    const srcdoc = buildArtifactSrcDoc(hostile, 'shape:test', {}, []);
    const policyIndex = srcdoc.indexOf("default-src 'none'");
    const bootstrapIndex = srcdoc.indexOf('__visionos_runtime__');
    const hostileScriptIndex = srcdoc.indexOf('https://attacker.example/early.js');

    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(bootstrapIndex).toBeGreaterThan(policyIndex);
    expect(hostileScriptIndex).toBeGreaterThan(bootstrapIndex);
    expect(srcdoc.indexOf('https://cdn.tailwindcss.com')).toBe(-1);
  });

  it('strips markdown fences before installing the policy and app source', () => {
    const srcdoc = buildArtifactSrcDoc(
      '```html\n<div>app</div>\n```',
      'shape:fenced',
      {},
      []
    );
    expect(srcdoc).toContain('<div>app</div>');
    expect(srcdoc).not.toContain('```');
    expect(srcdoc.indexOf("default-src 'none'")).toBeLessThan(
      srcdoc.indexOf('<div>app</div>')
    );
  });

  it('reports the legacy Tailwind dependency without loading it until its exact origin is granted', () => {
    const fragment = '<div class="flex items-center p-4">hello</div>';
    expect(usesTailwindUtilities(fragment)).toBe(true);
    expect(hasExternalDependencies('<script src="https://cdn.example/app.js"></script>')).toBe(true);
    const blocked = buildArtifactSrcDoc(fragment, 'shape:test', {}, []);
    expect(blocked).not.toContain('<script src="https://cdn.tailwindcss.com"></script>');
    expect(blocked).toContain('VISIONOS_NETWORK_BLOCKED');
    expect(blocked).toContain('https://cdn.tailwindcss.com');

    const granted = buildArtifactSrcDoc(fragment, 'shape:test', {}, ['https://cdn.tailwindcss.com']);
    expect(granted).toContain('<script src="https://cdn.tailwindcss.com"></script>');
  });

  it('escapes source data embedded into the storage bridge script', () => {
    const hostile = '</script><script>window.stolen = true</script>\u2028&';
    const encoded = escapeInlineScriptJson(hostile);
    expect(encoded).not.toContain('</script><script>');
    expect(JSON.parse(encoded)).toBe(hostile);

    const runtime = buildArtifactRuntimeScript('shape:evil</script>', {
      payload: hostile,
    }, 'frame:source-a');
    expect(runtime).not.toContain('shape:evil</script>');
    expect(runtime).not.toContain(hostile);
    expect(runtime).toContain('frameToken: frameToken');
    expect(runtime).toContain('"frame:source-a"');
    expect([...runtime].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
        (code >= 0x7f && code <= 0x9f);
    })).toBe(false);
  });

  it('announces a changed app store promptly, coalesces the notice, then sends one snapshot', () => {
    const runtime = buildArtifactRuntimeScript('shape:pending', { count: '0' }, 'frame:pending');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<{ type: string; storage?: Record<string, string> }> = [];
    const listeners = new Map<string, Function>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const windowStub: {
      parent: { postMessage: (message: { type: string; storage?: Record<string, string> }) => void };
      addEventListener: (name: string, listener: Function) => void;
      localStorage?: { setItem: (key: string, value: string) => void };
    } = {
      parent: { postMessage: (message: { type: string; storage?: Record<string, string> }) => messages.push(message) },
      addEventListener: (name: string, listener: Function) => listeners.set(`window:${name}`, listener),
    };
    const documentStub = {
      visibilityState: 'visible',
      addEventListener: (name: string, listener: Function) => listeners.set(`document:${name}`, listener),
    };
    const setTimer = (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    };
    const clearTimer = (id: number) => { timers.delete(id); };

    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub,
      documentStub,
      setTimer,
      clearTimer
    );

    windowStub.localStorage!.setItem('count', '1');
    windowStub.localStorage!.setItem('count', '2');
    windowStub.localStorage!.setItem('count', '0');
    expect(messages.map((message) => message.type)).toEqual(['VISIONOS_STORAGE_PENDING']);

    const syncTimer = Array.from(timers.values()).at(-1);
    expect(syncTimer).toBeDefined();
    syncTimer!();
    expect(messages.map((message) => message.type)).toEqual([
      'VISIONOS_STORAGE_PENDING',
      'VISIONOS_STORAGE_SYNC',
    ]);
    expect(messages[1].storage).toEqual({ count: '0' });

    windowStub.localStorage!.setItem('count', '3');
    expect(messages.at(-1)?.type).toBe('VISIONOS_STORAGE_PENDING');
  });

  it('flushes the current in-frame storage synchronously for a matching host request', () => {
    const runtime = buildArtifactRuntimeScript('shape:flush', { stable: 'old' }, 'frame:flush');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const parentWindow = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const windowStub: {
      parent: typeof parentWindow;
      addEventListener: (name: string, listener: Function) => void;
      localStorage?: { setItem: (key: string, value: string) => void };
      dispatchEvent: () => void;
    } = {
      parent: parentWindow,
      addEventListener: (name, listener) => listeners.set(`window:${name}`, listener),
      dispatchEvent: () => {},
    };
    const documentStub = {
      addEventListener: (name: string, listener: Function) => listeners.set(`document:${name}`, listener),
      visibilityState: 'visible',
    };
    const setTimer = (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    };
    const clearTimer = (id: number) => { timers.delete(id); };

    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, setTimer, clearTimer
    );
    const flushHintsTimer = timers.get(1);
    flushHintsTimer?.();
    windowStub.localStorage!.setItem('draft', 'latest');
    expect(messages.at(-1)?.type).toBe('VISIONOS_STORAGE_PENDING');

    const syncTimerId = Array.from(timers.keys()).at(-1)!;
    listeners.get('window:message')!({
      source: parentWindow,
      data: {
        type: 'VISIONOS_STORAGE_FLUSH_REQUEST',
        shapeId: 'shape:flush',
        frameToken: 'frame:flush',
        requestId: 'flush_1',
      },
    });

    expect(timers.has(syncTimerId)).toBe(false);
    expect(messages.at(-1)).toEqual({
      type: 'VISIONOS_STORAGE_FLUSH_ACK',
      shapeId: 'shape:flush',
      frameToken: 'frame:flush',
      requestId: 'flush_1',
      storage: { stable: 'old', draft: 'latest' },
    });
  });

  it('ignores stale or malformed parent flush requests and bounds CSP origin hints', () => {
    const runtime = buildArtifactRuntimeScript('shape:network', {}, 'frame:network');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const parentWindow = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const windowStub = {
      parent: parentWindow,
      addEventListener: (name: string, listener: Function) => listeners.set(`window:${name}`, listener),
    };
    const documentStub = { addEventListener: () => {}, visibilityState: 'visible' };
    const setTimer = (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    };
    const clearTimer = (id: number) => { timers.delete(id); };

    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, setTimer, clearTimer
    );
    listeners.get('window:securitypolicyviolation')!({
      blockedURI: 'https://api.example.test/path?token=not-for-the-host',
      effectiveDirective: 'connect-src',
    });
    listeners.get('window:securitypolicyviolation')!({
      blockedURI: 'https://api.example.test/other?secret=also-not-for-the-host',
      effectiveDirective: 'connect-src',
    });
    listeners.get('window:securitypolicyviolation')!({
      blockedURI: 'wss://socket.example.test:8443/live?token=secret',
      effectiveDirective: 'connect-src',
    });
    listeners.get('window:securitypolicyviolation')!({
      blockedURI: 'data:text/plain,private',
      effectiveDirective: 'img-src',
    });
    for (const callback of Array.from(timers.values())) callback();

    const reports = messages.filter((message) => message.type === 'VISIONOS_NETWORK_BLOCKED');
    expect(reports).toEqual([
      {
        type: 'VISIONOS_NETWORK_BLOCKED',
        shapeId: 'shape:network',
        frameToken: 'frame:network',
        url: 'https://api.example.test',
        directive: 'connect-src',
      },
      {
        type: 'VISIONOS_NETWORK_BLOCKED',
        shapeId: 'shape:network',
        frameToken: 'frame:network',
        url: 'https://socket.example.test:8443',
        directive: 'connect-src',
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain('token');
    expect(JSON.stringify(reports)).not.toContain('secret');

    for (let index = 0; index < 40; index += 1) {
      listeners.get('window:securitypolicyviolation')!({
        blockedURI: `https://site-${index}.example.test/path?value=${index}`,
        effectiveDirective: 'img-src',
      });
    }
    for (const callback of Array.from(timers.values())) callback();
    expect(messages.filter((message) => message.type === 'VISIONOS_NETWORK_BLOCKED').length).toBe(24);
  });

  it('turns only trusted HTTPS anchor clicks into bounded host link requests', () => {
    const runtime = buildArtifactRuntimeScript('shape:links', {}, 'frame:links');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const parentWindow = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const windowStub = {
      parent: parentWindow,
      navigator: { userActivation: { isActive: true } },
      addEventListener: (name: string, listener: Function) => listeners.set(`window:${name}`, listener),
    };
    const documentStub = {
      baseURI: 'https://visionos.example/app',
      addEventListener: (name: string, listener: Function) => listeners.set(`document:${name}`, listener),
      visibilityState: 'visible',
    };
    const setTimer = (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    };
    const clearTimer = (id: number) => { timers.delete(id); };
    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, setTimer, clearTimer
    );

    const handleClick = listeners.get('document:click')!;
    const click = (href: string, options: { trusted?: boolean; active?: boolean; download?: boolean } = {}) => {
      if (options.active === false) windowStub.navigator.userActivation.isActive = false;
      const anchor = {
        nodeType: 1,
        tagName: 'A',
        href,
        getAttribute: (name: string) => name === 'href' ? href : null,
        hasAttribute: (name: string) => name === 'download' && !!options.download,
      };
      let prevented = false;
      handleClick({
        isTrusted: options.trusted !== false,
        defaultPrevented: false,
        target: anchor,
        composedPath: () => [anchor],
        preventDefault: () => { prevented = true; },
      });
      windowStub.navigator.userActivation.isActive = true;
      return prevented;
    };

    expect(click('https://docs.example.test/start?ref=canvas')).toBe(true);
    expect(messages.at(-1)).toEqual({
      type: 'VISIONOS_EXTERNAL_LINK',
      shapeId: 'shape:links',
      frameToken: 'frame:links',
      url: 'https://docs.example.test/start?ref=canvas',
    });
    expect(click('https://user:password@docs.example.test/private')).toBe(false);
    expect(click('https://docs.example.test/line\nbreak')).toBe(false);
    expect(click(`https://docs.example.test/${'x'.repeat(4096)}`)).toBe(false);
    expect(click('https://docs.example.test/download', { download: true })).toBe(false);
    expect(click('#local-section')).toBe(false);
    expect(click('javascript:void(0)')).toBe(false);
    expect(click('data:text/plain,local')).toBe(false);
    expect(click('blob:https://visionos.example/local')).toBe(false);
    expect(click('https://docs.example.test/scripted', { trusted: false })).toBe(false);
    expect(click('https://docs.example.test/inactive', { active: false })).toBe(false);
    expect(messages.filter((message) => message.type === 'VISIONOS_EXTERNAL_LINK')).toHaveLength(1);
  });

  it('reports blocked embedded frames without exposing their URL or implying site approval', () => {
    const runtime = buildArtifactRuntimeScript('shape:frames', {}, 'frame:frames');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const parentWindow = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const windowStub = {
      parent: parentWindow,
      addEventListener: (name: string, listener: Function) => listeners.set(`window:${name}`, listener),
    };
    const documentStub = { addEventListener: () => {}, visibilityState: 'visible' };
    const setTimer = (callback: () => void) => {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    };
    const clearTimer = (id: number) => { timers.delete(id); };
    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, setTimer, clearTimer
    );
    const onViolation = listeners.get('window:securitypolicyviolation')!;
    onViolation({ blockedURI: 'https://private.example.test/path?token=secret', effectiveDirective: 'frame-src' });
    onViolation({ blockedURI: 'https://another.example.test/', effectiveDirective: 'frame-src' });
    for (const callback of Array.from(timers.values())) callback();

    const reports = messages.filter((message) => message.type === 'VISIONOS_NAVIGATION_BLOCKED');
    expect(reports).toEqual([{
      type: 'VISIONOS_NAVIGATION_BLOCKED',
      shapeId: 'shape:frames',
      frameToken: 'frame:frames',
      directive: 'frame-src',
    }]);
    expect(JSON.stringify(reports)).not.toContain('private.example.test');
    expect(JSON.stringify(reports)).not.toContain('token');
  });

  it('blocks WebRTC constructors before app code as defense in depth', () => {
    const runtime = buildArtifactRuntimeScript('shape:rtc', {}, 'frame:rtc');
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const windowStub: Record<string, unknown> & {
      parent: { postMessage: (message: Record<string, unknown>) => void };
      addEventListener: () => void;
    } = {
      parent: { postMessage: (message: Record<string, unknown>) => messages.push(message) },
      addEventListener: () => {},
      RTCPeerConnection: function NativePeerConnection() {},
      webkitRTCPeerConnection: function NativeWebkitPeerConnection() {},
    };
    const documentStub = { addEventListener: () => {}, visibilityState: 'visible' };
    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, () => 1, () => {}
    );

    expect(() => (windowStub.RTCPeerConnection as Function)()).toThrow('Peer-to-peer connections are unavailable');
    expect(() => (windowStub.webkitRTCPeerConnection as Function)()).toThrow('Peer-to-peer connections are unavailable');
    expect(messages.filter((message) => message.type === 'VISIONOS_FEATURE_BLOCKED')).toEqual([{
      type: 'VISIONOS_FEATURE_BLOCKED',
      shapeId: 'shape:rtc',
      frameToken: 'frame:rtc',
      feature: 'peer-to-peer',
    }]);
  });

  it('leaves native WebRTC constructors intact only when the separate RTC grant is enabled', () => {
    const runtime = buildArtifactRuntimeScript('shape:rtc-allowed', {}, 'frame:rtc-allowed', true);
    const script = runtime.match(/^\s*<script[^>]*>([\s\S]*)<\/script>\s*$/)?.[1];
    expect(script).toBeDefined();

    const messages: Array<Record<string, unknown>> = [];
    const windowStub: Record<string, unknown> & {
      parent: { postMessage: (message: Record<string, unknown>) => void };
      addEventListener: () => void;
    } = {
      parent: { postMessage: (message) => messages.push(message) },
      addEventListener: () => {},
      RTCPeerConnection: function NativePeerConnection(this: { connected: boolean }) { this.connected = true; },
    };
    const nativePeerConnection = windowStub.RTCPeerConnection;
    const documentStub = { addEventListener: () => {}, visibilityState: 'visible' };
    new Function('window', 'document', 'setTimeout', 'clearTimeout', script!)(
      windowStub, documentStub, () => 1, () => {}
    );

    expect(windowStub.RTCPeerConnection).toBe(nativePeerConnection);
    expect(new (windowStub.RTCPeerConnection as new () => { connected: boolean })().connected).toBe(true);
    expect(messages.filter((message) => message.type === 'VISIONOS_FEATURE_BLOCKED')).toHaveLength(0);
  });
});
