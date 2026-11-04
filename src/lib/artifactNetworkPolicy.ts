/**
 * Pure policy helpers for generated-app network access.
 *
 * A remembered site consent is deliberately exact-origin scoped. It permits
 * HTTPS subresources and HTTPS/WSS connections for that origin. It does not
 * permit HTTP, form submissions, or remote frames.
 */

export const ARTIFACT_NETWORK_LIMITS = {
  maxSitesPerApp: 24,
  maxHintUrlLength: 4_096,
  maxOriginLength: 512,
} as const;

export type ArtifactNetworkHint = {
  /** Canonical HTTPS origin; request paths, queries, and credentials are omitted. */
  origin: string;
};

export type ArtifactNetworkHintValidation =
  | { status: 'accepted'; hint: ArtifactNetworkHint }
  | { status: 'ignored' };

export type ArtifactNetworkHintMessageValidation =
  | { status: 'accepted'; hint: ArtifactNetworkHint }
  | { status: 'ignored' };

export type ArtifactNetworkCspPolicy = {
  csp: string;
  sites: string[];
};

export type ArtifactExternalLink = { url: string; origin: string };
export type ArtifactExternalLinkValidation =
  | { status: 'accepted'; link: ArtifactExternalLink }
  | { status: 'ignored' };

const CONTROL_CHARACTERS = /[\u0000-\u0020\u007f-\u009f]/;

const RESOURCE_DIRECTIVES = new Set([
  'img-src',
  'style-src',
  'style-src-elem',
  'script-src',
  'script-src-elem',
  'font-src',
  'media-src',
  'worker-src',
]);

function parseHttpsOrigin(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > ARTIFACT_NETWORK_LIMITS.maxOriginLength ||
    CONTROL_CHARACTERS.test(value) ||
    value.includes('*') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    const authorityStart = value.indexOf('//') + 2;
    const authority = value.slice(authorityStart).split(/[/?#]/, 1)[0];
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      authority.includes('@') ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin === 'null'
    ) {
      return null;
    }
    const origin = url.origin;
    return origin.length <= ARTIFACT_NETWORK_LIMITS.maxOriginLength ? origin : null;
  } catch {
    return null;
  }
}

/** Parse a user-entered exact HTTPS origin. Paths, query strings, and credentials are refused. */
export function normalizeArtifactNetworkOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
  return parseHttpsOrigin(value);
}

/**
 * Reduce an untrusted CSP violation hint to an exact HTTPS site. Runtime hints
 * may contain credentials, paths, or query strings; only URL.origin survives.
 * WSS requests map to the corresponding HTTPS site for the site-consent model.
 */
export function normalizeArtifactNetworkHint(
  blockedUrl: unknown,
  violatedDirective: unknown
): ArtifactNetworkHintValidation {
  if (
    typeof blockedUrl !== 'string' ||
    blockedUrl.length === 0 ||
    blockedUrl.length > ARTIFACT_NETWORK_LIMITS.maxHintUrlLength ||
    CONTROL_CHARACTERS.test(blockedUrl) ||
    typeof violatedDirective !== 'string' ||
    violatedDirective.length > 64
  ) {
    return { status: 'ignored' };
  }

  const directive = violatedDirective.toLowerCase().trim();
  if (directive !== 'connect-src' && !RESOURCE_DIRECTIVES.has(directive)) {
    return { status: 'ignored' };
  }

  try {
    const url = new URL(blockedUrl);
    let site: string | null = null;
    if (url.protocol === 'https:') {
      site = parseHttpsOrigin(url.origin);
    } else if (url.protocol === 'wss:' && directive === 'connect-src') {
      site = parseHttpsOrigin(url.origin.replace(/^wss:/, 'https:'));
    }
    return site ? { status: 'accepted', hint: { origin: site } } : { status: 'ignored' };
  } catch {
    return { status: 'ignored' };
  }
}

/**
 * Validate a child-frame hint before displaying it. The frame token correlates
 * messages with a live iframe; it is not treated as proof that the hint itself
 * came from a browser-generated CSP event.
 */
export function validateArtifactNetworkHintMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  expectedShapeId: string,
  expectedFrameToken: string
): ArtifactNetworkHintMessageValidation {
  if (
    !expectedSource ||
    source !== expectedSource ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return { status: 'ignored' };
  }

  const message = data as Record<string, unknown>;
  if (
    message.type !== 'VISIONOS_NETWORK_BLOCKED' ||
    message.shapeId !== expectedShapeId ||
    message.frameToken !== expectedFrameToken
  ) {
    return { status: 'ignored' };
  }

  return normalizeArtifactNetworkHint(message.url, message.directive);
}

/** Validate a user-clicked outbound link while retaining its full URL only for the eventual open action. */
export function normalizeArtifactExternalLink(value: unknown): ArtifactExternalLinkValidation {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > ARTIFACT_NETWORK_LIMITS.maxHintUrlLength ||
    CONTROL_CHARACTERS.test(value)
  ) return { status: 'ignored' };
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0];
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || authority.includes('@')) {
      return { status: 'ignored' };
    }
    const origin = parseHttpsOrigin(url.origin);
    if (!origin || url.href.length > ARTIFACT_NETWORK_LIMITS.maxHintUrlLength) return { status: 'ignored' };
    return { status: 'accepted', link: { url: url.href, origin } };
  } catch {
    return { status: 'ignored' };
  }
}

export function validateArtifactExternalLinkMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  expectedShapeId: string,
  expectedFrameToken: string
): ArtifactExternalLinkValidation {
  if (
    !expectedSource ||
    source !== expectedSource ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) return { status: 'ignored' };
  const message = data as Record<string, unknown>;
  if (
    message.type !== 'VISIONOS_EXTERNAL_LINK' ||
    message.shapeId !== expectedShapeId ||
    message.frameToken !== expectedFrameToken
  ) return { status: 'ignored' };
  return normalizeArtifactExternalLink(message.url);
}

export function isArtifactNavigationBlockedMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  expectedShapeId: string,
  expectedFrameToken: string
): boolean {
  if (
    !expectedSource ||
    source !== expectedSource ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) return false;
  const message = data as Record<string, unknown>;
  return message.type === 'VISIONOS_NAVIGATION_BLOCKED' &&
    message.shapeId === expectedShapeId &&
    message.frameToken === expectedFrameToken;
}

/** Return distinct, canonical origins, bounded for an app's review list. */
export function dedupeArtifactNetworkHints(
  values: readonly unknown[]
): ArtifactNetworkHint[] {
  const origins = new Set<string>();
  const hints: ArtifactNetworkHint[] = [];
  for (const value of values) {
    const origin = typeof value === 'string'
      ? normalizeArtifactNetworkOrigin(value)
      : value && typeof value === 'object' && 'origin' in value
        ? normalizeArtifactNetworkOrigin((value as { origin?: unknown }).origin)
        : null;
    if (!origin || origins.has(origin)) continue;
    if (hints.length >= ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) break;
    origins.add(origin);
    hints.push({ origin });
  }
  return hints;
}

/**
 * Build the strict CSP for the current exact-site grants. Legacy boolean
 * network flags are intentionally not accepted by this API.
 */
export function buildArtifactNetworkCsp(siteValues: readonly unknown[]): ArtifactNetworkCspPolicy {
  const sites = dedupeArtifactNetworkHints(siteValues).map(({ origin }) => origin);
  const resourceSources = sites.length ? ` ${sites.join(' ')}` : '';
  const connectionSources = sites.length
    ? ` ${sites.flatMap((origin) => [origin, origin.replace(/^https:/, 'wss:')]).join(' ')}`
    : " 'none'";
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' data: blob:${resourceSources}`,
    `style-src 'unsafe-inline' data:${resourceSources}`,
    `img-src data: blob:${resourceSources}`,
    `font-src data: blob:${resourceSources}`,
    `media-src data: blob:${resourceSources}`,
    `worker-src data: blob:${resourceSources}`,
    `connect-src${connectionSources}`,
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return { csp, sites };
}
