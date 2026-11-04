import { describe, expect, it } from 'bun:test';
import {
  ARTIFACT_NETWORK_LIMITS,
  buildArtifactNetworkCsp,
  dedupeArtifactNetworkHints,
  normalizeArtifactNetworkHint,
  normalizeArtifactNetworkOrigin,
  validateArtifactNetworkHintMessage,
} from './artifactNetworkPolicy';

describe('artifact network policy', () => {
  it('accepts only exact HTTPS origins for manual site grants', () => {
    expect(normalizeArtifactNetworkOrigin('https://Example.com')).toBe('https://example.com');
    expect(normalizeArtifactNetworkOrigin('https://example.com:8443/')).toBe('https://example.com:8443');
    for (const value of [
      'http://example.com',
      'wss://example.com',
      'https://example.com/path',
      'https://example.com?token=secret',
      'https://example.com#fragment',
      'https://user:pass@example.com',
      'https://@example.com',
      'https://*.example.com',
      'https://example.com\n.evil.test',
      ' https://example.com',
    ]) {
      expect(normalizeArtifactNetworkOrigin(value)).toBeNull();
    }
  });

  it('reduces runtime resource and WSS hints to a secret-free HTTPS origin', () => {
    expect(normalizeArtifactNetworkHint(
      'https://user:secret@cdn.example.test:8443/assets/app.js?token=private#x',
      'script-src-elem'
    )).toEqual({ status: 'accepted', hint: { origin: 'https://cdn.example.test:8443' } });
    expect(normalizeArtifactNetworkHint(
      'wss://api.example.test:9443/socket?key=private',
      'connect-src'
    )).toEqual({ status: 'accepted', hint: { origin: 'https://api.example.test:9443' } });
    for (const [url, directive] of [
      ['http://example.com/api', 'connect-src'],
      ['https://example.com/submit', 'form-action'],
      ['https://example.com/embed', 'frame-src'],
      ['data:text/plain,hi', 'img-src'],
      ['https://example.com/api', 'navigate-to'],
      ['https://example.com/\u0000x', 'img-src'],
    ]) {
      expect(normalizeArtifactNetworkHint(url, directive).status).toBe('ignored');
    }
    expect(normalizeArtifactNetworkHint(
      `https://example.com/${'x'.repeat(ARTIFACT_NETWORK_LIMITS.maxHintUrlLength)}`,
      'img-src'
    ).status).toBe('ignored');
  });

  it('correlates hint messages and ignores mismatched frames or shapes', () => {
    const source = {};
    const message = {
      type: 'VISIONOS_NETWORK_BLOCKED',
      shapeId: 'shape:app',
      frameToken: 'current-frame',
      directive: 'connect-src',
      url: 'https://api.example.test/v1?secret=omitted',
    };
    expect(validateArtifactNetworkHintMessage(message, {}, source, 'shape:app', 'current-frame'))
      .toEqual({ status: 'ignored' });
    expect(validateArtifactNetworkHintMessage(message, source, source, 'shape:other', 'current-frame'))
      .toEqual({ status: 'ignored' });
    expect(validateArtifactNetworkHintMessage(message, source, source, 'shape:app', 'old-frame'))
      .toEqual({ status: 'ignored' });
    expect(validateArtifactNetworkHintMessage(message, source, source, 'shape:app', 'current-frame'))
      .toEqual({ status: 'accepted', hint: { origin: 'https://api.example.test' } });
    expect(validateArtifactNetworkHintMessage({ ...message, url: 'x'.repeat(5_000) }, source, source, 'shape:app', 'current-frame'))
      .toEqual({ status: 'ignored' });
  });

  it('deduplicates canonical origins and caps review sites', () => {
    const inputs: unknown[] = [
      'https://example.test/path',
      'https://example.test',
      { origin: 'https://second.example.test' },
      { origin: 'http://insecure.example.test' },
    ];
    for (let index = 0; index < ARTIFACT_NETWORK_LIMITS.maxSitesPerApp + 3; index++) {
      inputs.push(`https://site-${index}.example.test`);
    }
    const result = dedupeArtifactNetworkHints(inputs);
    expect(result[0]).toEqual({ origin: 'https://example.test' });
    expect(result[1]).toEqual({ origin: 'https://second.example.test' });
    expect(result).toHaveLength(ARTIFACT_NETWORK_LIMITS.maxSitesPerApp);
    expect(new Set(result.map(({ origin }) => origin)).size).toBe(result.length);
  });

  it('builds exact-origin HTTPS/WSS policy while keeping frames and forms blocked', () => {
    const { csp, sites } = buildArtifactNetworkCsp([
      'https://api.example.test:8443',
      'https://cdn.example.test',
      true, // Legacy networkEnabled booleans never imply a grant.
    ]);
    expect(sites).toEqual(['https://api.example.test:8443', 'https://cdn.example.test']);
    expect(csp).toContain('script-src');
    expect(csp).toContain('https://api.example.test:8443');
    expect(csp).toContain('connect-src https://api.example.test:8443 wss://api.example.test:8443 https://cdn.example.test wss://cdn.example.test');
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toMatch(/(^|\s)https:(\s|;)/);
    expect(csp).not.toMatch(/(^|\s)wss:(\s|;)/);
    expect(csp).not.toContain('*.example.test');

    const restricted = buildArtifactNetworkCsp([]).csp;
    expect(restricted).toContain("connect-src 'none'");
    expect(restricted).toContain("form-action 'none'");
    expect(restricted).toContain("frame-src 'none'");
  });
});
