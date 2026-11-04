import { describe, expect, it } from 'bun:test';
import {
  ARTIFACT_BOUNDARY_FRAME_ID,
  ARTIFACT_BOUNDARY_SANDBOX,
  buildArtifactBoundarySrcDoc,
  normalizeArtifactExternalLink,
} from './artifactFrameBoundary';

class FakeURL extends URL {
  static createObjectURL(_object: Blob | MediaSource): string {
    return 'blob:null/test';
  }

  static revokeObjectURL(_url: string): void {}
}

describe('artifact frame boundary', () => {
  it('keeps approved network origins exact and uses a Blob-only outer frame policy', () => {
    const wrapper = buildArtifactBoundarySrcDoc({
      childSrcDoc: '<!doctype html><p>app</p>',
      shapeId: 'shape:one',
      frameToken: 'frame:one',
      origins: [
        'https://api.example.test',
        'https://cdn.example.test:8443',
        'http://insecure.example.test',
        'https://user:pass@private.example.test',
      ],
    });
    const policyIndex = wrapper.indexOf('http-equiv="Content-Security-Policy"');
    const bridgeIndex = wrapper.indexOf('__visionos_artifact_boundary__');
    const policy = wrapper.slice(policyIndex, wrapper.indexOf('>', policyIndex));

    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(bridgeIndex).toBeGreaterThan(policyIndex);
    expect(policy).toContain('connect-src https://api.example.test wss://api.example.test https://cdn.example.test:8443 wss://cdn.example.test:8443');
    expect(policy).toContain('frame-src blob:');
    expect(policy).not.toContain('frame-src https://api.example.test');
    expect(policy).not.toContain('insecure.example.test');
    expect(policy).not.toContain('private.example.test');
    expect(wrapper).toContain('allow-scripts allow-modals');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).not.toContain('allow-forms');
    expect(wrapper).toContain('id = "' + ARTIFACT_BOUNDARY_FRAME_ID + '"');
    expect(ARTIFACT_BOUNDARY_SANDBOX).toBe('allow-scripts allow-modals');
    expect(wrapper).toContain("form-action 'none'");
  });

  it('keeps the generated document out of wrapper markup and escapes source data for the bridge script', () => {
    const hostileChild = '</script><script>window.stolen=true</script>&\u2028';
    const wrapper = buildArtifactBoundarySrcDoc({
      childSrcDoc: hostileChild,
      shapeId: 'shape:</script><img src=x>',
      frameToken: 'frame:&value',
      origins: [],
    });

    expect(wrapper).not.toContain(hostileChild);
    expect(wrapper).not.toContain('shape:</script>');
    expect(wrapper).toContain('\\u003c/script\\u003e');
    expect(wrapper).toContain('childSrcDoc =');
    expect(wrapper).toContain('new Blob([childSrcDoc], { type: "text/html" })');
    expect(wrapper).toContain('runner.srcdoc = childSrcDoc;');
    expect(wrapper).toContain('runner.setAttribute("sandbox", "allow-scripts allow-modals")');
  });

  it('accepts only credential-free HTTPS external links with bounded URLs', () => {
    expect(normalizeArtifactExternalLink('https://example.test/a?b=1#section')).toBe(
      'https://example.test/a?b=1#section'
    );
    expect(normalizeArtifactExternalLink('https://user:pass@example.test/a')).toBeNull();
    expect(normalizeArtifactExternalLink('http://example.test/a')).toBeNull();
    expect(normalizeArtifactExternalLink('javascript:alert(1)')).toBeNull();
    expect(normalizeArtifactExternalLink('https://example.test/space here')).toBeNull();
    expect(normalizeArtifactExternalLink('https://example.test/' + 'a'.repeat(4_100))).toBeNull();
  });

  it('forwards only typed and source-bound bridge events', () => {
    const wrapper = buildArtifactBoundarySrcDoc({
      childSrcDoc: '<main>app</main>',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      origins: [],
    });
    const script = wrapper.match(/<script id="__visionos_artifact_boundary__">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();

    const childMessages: Array<Record<string, unknown>> = [];
    const hostMessages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const childWindow = { postMessage: (message: Record<string, unknown>) => childMessages.push(message) };
    const parentWindow = { postMessage: (message: Record<string, unknown>) => hostMessages.push(message) };
    const runner = {
      id: '',
      src: '',
      srcdoc: '',
      contentWindow: childWindow,
      style: {} as Record<string, string>,
      setAttribute: (name: string, value: string) => { (runner as unknown as Record<string, unknown>)[name] = value; },
    };
    const documentStub = {
      body: { appendChild: () => {} },
      createElement: () => runner,
      addEventListener: (name: string, listener: Function) => listeners.set('document:' + name, listener),
    };
    class FakeBlob {
      parts: unknown[];
      options: unknown;
      constructor(parts: unknown[], options: unknown) { this.parts = parts; this.options = options; }
    }
    const windowStub = {
      parent: parentWindow,
      addEventListener: (name: string, listener: Function) => listeners.set('window:' + name, listener),
    };

    new Function('window', 'document', 'URL', 'Blob', script!)(windowStub, documentStub, FakeURL, FakeBlob);
    expect(runner.id).toBe(ARTIFACT_BOUNDARY_FRAME_ID);
    expect(runner.src).toBe('blob:null/test');

    const receive = listeners.get('window:message')!;
    receive({
      source: childWindow,
      data: {
        type: 'VISIONOS_STORAGE_SYNC',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        storage: { saved: 'yes' },
        flush: true,
        ignoredField: 'drop',
      },
    });
    expect(hostMessages.at(-1)).toEqual({
      type: 'VISIONOS_STORAGE_SYNC',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      storage: { saved: 'yes' },
      flush: true,
    });

    const count = hostMessages.length;
    receive({ source: {}, data: { type: 'VISIONOS_STORAGE_PENDING', shapeId: 'shape:bridge', frameToken: 'frame:bridge' } });
    receive({ source: childWindow, data: { type: 'VISIONOS_STORAGE_PENDING', shapeId: 'other', frameToken: 'frame:bridge' } });
    receive({ source: childWindow, data: { type: 'VISIONOS_STORAGE_SYNC', shapeId: 'shape:bridge', frameToken: 'frame:bridge', storage: { bad: 1 } } });
    receive({ source: childWindow, data: { type: 'CUSTOM', shapeId: 'shape:bridge', frameToken: 'frame:bridge', payload: 'drop' } });
    expect(hostMessages.slice(count).map((message) => message.type)).toEqual(['VISIONOS_STORAGE_REJECTED']);

    receive({
      source: childWindow,
      data: {
        type: 'VISIONOS_STORAGE_FLUSH_ACK',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        requestId: 'flush_1',
        storage: { saved: 'flushed' },
      },
    });
    expect(hostMessages.at(-1)).toEqual({
      type: 'VISIONOS_STORAGE_FLUSH_ACK',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      requestId: 'flush_1',
      storage: { saved: 'flushed' },
    });

    receive({
      source: childWindow,
      data: {
        type: 'VISIONOS_IFRAME_PINCH_ZOOM',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        deltaY: 12,
        deltaMode: 1,
        clientX: 14,
        clientY: 25,
      },
    });
    receive({
      source: childWindow,
      data: {
        type: 'CANVASOS_IFRAME_PINCH_ZOOM',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        deltaY: 12,
        deltaMode: 3,
        clientX: 14,
        clientY: 25,
      },
    });
    expect(hostMessages.at(-1)).toEqual({
      type: 'VISIONOS_STORAGE_FLUSH_ACK',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      requestId: 'flush_1',
      storage: { saved: 'flushed' },
    });
    receive({
      source: childWindow,
      data: {
        type: 'CANVASOS_IFRAME_PINCH_ZOOM',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        deltaY: 12,
        deltaMode: 1,
        clientX: 14,
        clientY: 25,
      },
    });
    expect(hostMessages.at(-1)).toEqual({
      type: 'CANVASOS_IFRAME_PINCH_ZOOM',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      deltaY: 12,
      deltaMode: 1,
      clientX: 14,
      clientY: 25,
    });

    receive({
      source: childWindow,
      data: {
        type: 'VISIONOS_NETWORK_BLOCKED',
        shapeId: 'shape:bridge',
        frameToken: 'frame:bridge',
        url: 'https://api.example.test/path?token=secret',
        directive: 'connect-src',
      },
    });
    expect(hostMessages.at(-1)).toEqual({
      type: 'VISIONOS_NETWORK_BLOCKED',
      shapeId: 'shape:bridge',
      frameToken: 'frame:bridge',
      url: 'https://api.example.test',
      directive: 'connect-src',
    });
    expect(JSON.stringify(hostMessages.at(-1))).not.toContain('secret');

    receive({ source: parentWindow, data: { type: 'CANVASOS_STORAGE_OVERWRITE', shapeId: 'shape:bridge', storage: { restored: 'ok' } } });
    receive({ source: parentWindow, data: { type: 'CANVASOS_STORAGE_OVERWRITE', shapeId: 'wrong', storage: { ignored: 'yes' } } });
    receive({ source: {}, data: { type: 'VISIONOS_STORAGE_FLUSH_REQUEST', shapeId: 'shape:bridge', frameToken: 'frame:bridge', requestId: 'flush_1' } });
    receive({ source: parentWindow, data: { type: 'VISIONOS_STORAGE_FLUSH_REQUEST', shapeId: 'shape:bridge', frameToken: 'stale', requestId: 'flush_2' } });
    receive({ source: parentWindow, data: { type: 'VISIONOS_STORAGE_FLUSH_REQUEST', shapeId: 'shape:bridge', frameToken: 'frame:bridge', requestId: 'flush_1' } });
    expect(childMessages).toEqual([
      { type: 'CANVASOS_STORAGE_OVERWRITE', shapeId: 'shape:bridge', storage: { restored: 'ok' } },
      { type: 'VISIONOS_STORAGE_FLUSH_REQUEST', shapeId: 'shape:bridge', frameToken: 'frame:bridge', requestId: 'flush_1' },
    ]);

    receive({ source: childWindow, data: { type: 'VISIONOS_EXTERNAL_LINK', shapeId: 'shape:bridge', frameToken: 'frame:bridge', url: 'https://outside.test/path?private=value' } });
    receive({ source: childWindow, data: { type: 'VISIONOS_EXTERNAL_LINK', shapeId: 'shape:bridge', frameToken: 'frame:bridge', url: 'javascript:alert(1)' } });
    receive({ source: childWindow, data: { type: 'VISIONOS_FEATURE_BLOCKED', shapeId: 'shape:bridge', frameToken: 'frame:bridge', feature: 'peer-to-peer' } });
    receive({ source: childWindow, data: { type: 'VISIONOS_FEATURE_BLOCKED', shapeId: 'shape:bridge', frameToken: 'frame:bridge', feature: 'peer-to-peer' } });
    expect(hostMessages.slice(-2)).toEqual([
      { type: 'VISIONOS_EXTERNAL_LINK', shapeId: 'shape:bridge', frameToken: 'frame:bridge', url: 'https://outside.test/path?private=value' },
      { type: 'VISIONOS_FEATURE_BLOCKED', shapeId: 'shape:bridge', frameToken: 'frame:bridge', feature: 'peer-to-peer' },
    ]);
  });

  it('reports one generic frame navigation block without forwarding the target URL', () => {
    const wrapper = buildArtifactBoundarySrcDoc({
      childSrcDoc: '<main>app</main>',
      shapeId: 'shape:navigation',
      frameToken: 'frame:navigation',
      origins: [],
    });
    const script = wrapper.match(/<script id="__visionos_artifact_boundary__">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const hostMessages: Array<Record<string, unknown>> = [];
    const listeners = new Map<string, Function>();
    const runner = {
      id: '', src: '', srcdoc: '', contentWindow: { postMessage: () => {} },
      style: {} as Record<string, string>, setAttribute: () => {},
    };
    const documentStub = { body: { appendChild: () => {} }, createElement: () => runner, addEventListener: (name: string, fn: Function) => listeners.set(name, fn) };
    const windowStub = { parent: { postMessage: (message: Record<string, unknown>) => hostMessages.push(message) }, addEventListener: () => {} };
    new Function('window', 'document', 'URL', 'Blob', script!)(windowStub, documentStub, FakeURL, class { constructor() {} });

    listeners.get('securitypolicyviolation')!({ effectiveDirective: 'frame-src', blockedURI: 'https://private.test/path?secret=value' });
    listeners.get('securitypolicyviolation')!({ effectiveDirective: 'frame-src', blockedURI: 'https://another.test/' });
    expect(hostMessages).toEqual([
      { type: 'VISIONOS_NAVIGATION_BLOCKED', shapeId: 'shape:navigation', frameToken: 'frame:navigation' },
    ]);
    expect(JSON.stringify(hostMessages)).not.toContain('private.test');
    expect(JSON.stringify(hostMessages)).not.toContain('secret');
  });
});
