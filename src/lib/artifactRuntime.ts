import { ARTIFACT_STORAGE_LIMITS, validateStorageSnapshot } from './artifactStorage';
import { buildArtifactNetworkCsp, normalizeArtifactNetworkHint } from './artifactNetworkPolicy';
import { stripMarkdownFences } from './sanitizeHtml';

/** Keep HTML attributes and inline script literals safe from generated source data. */
export function escapeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      default:
        return '\\u2029';
    }
  });
}

/** Build the artifact's CSP from exact approved HTTPS origins. */
export function buildArtifactCsp(siteOrigins: readonly unknown[]): string {
  return buildArtifactNetworkCsp(siteOrigins).csp;
}

/** Revoke a previous network grant when a user commits a different app source. */
export function getArtifactSourceUpdate(nextCode: string, currentCode: string) {
  if (nextCode === stripMarkdownFences(currentCode || '')) {
    return { code: nextCode };
  }
  return { code: nextCode, networkEnabled: false };
}

export function hasExternalDependencies(code: string): boolean {
  return /(?:https?:)?\/\/[^\s"'<>`]+|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|\bimport\s*\(\s*['"]https?:/i.test(
    code
  );
}

export function usesTailwindUtilities(code: string): boolean {
  const attributes = code.matchAll(/\bclass(?:Name)?\s*=\s*(["'`])([\s\S]*?)\1/gi);
  const utility = /(?:^|\s)(?:flex|grid|inline-flex|block|hidden|items-[\w-]+|justify-[\w-]+|gap-\d+|p[xytrbl]?-(?:\d+|\[[^\]]+\])|m[xytrbl]?-(?:\d+|\[[^\]]+\])|w-(?:\d+|full|screen)|h-(?:\d+|full|screen)|text-(?:xs|sm|base|lg|xl|\d+xl)|bg-[\w-]+)(?=\s|$)/;
  for (const match of attributes) {
    if (utility.test(match[2])) return true;
  }
  return false;
}

/** Construct the `srcdoc` shell with host policy and bridge before app source. */
export function buildArtifactSrcDoc(
  code: string,
  shapeId: string,
  storage: unknown,
  siteOrigins: readonly unknown[],
  frameToken = 'legacy-frame',
  peerConnectionsAllowed = false
): string {
  const rawCode = stripMarkdownFences(code || '');
  const isFullHtml = /<!DOCTYPE\s+html/i.test(rawCode) || /<html[\s>]/i.test(rawCode);
  const networkPolicy = buildArtifactNetworkCsp(siteOrigins);
  const tailwindOrigin = 'https://cdn.tailwindcss.com';
  const needsTailwind = !isFullHtml && usesTailwindUtilities(rawCode);
  const tailwindAllowed = networkPolicy.sites.includes(tailwindOrigin);
  const blockedDependencies = needsTailwind && !tailwindAllowed
    ? [{ origin: tailwindOrigin, directive: 'script-src' }]
    : [];
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${networkPolicy.csp}">`;
  const runtimeScript = buildArtifactRuntimeScript(
    shapeId,
    storage,
    frameToken,
    peerConnectionsAllowed,
    blockedDependencies
  );
  const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">';
  const baseStyle = `
    <style id="__visionos_base_style__">
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: 100vh;
        background-color: #0b0e1c;
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow-x: hidden;
        -webkit-text-size-adjust: 100% !important;
        -moz-text-size-adjust: 100% !important;
        text-size-adjust: 100% !important;
      }
    </style>`;
  const tailwindCdn =
    tailwindAllowed && needsTailwind
      ? '<script src="https://cdn.tailwindcss.com"></script>'
      : '';

  // The security meta and bridge are parsed before any generated markup, even
  // if that markup has a script before <head>, a missing head, or another CSP.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${viewportMeta}
  ${cspMeta}
  ${runtimeScript}
  ${baseStyle}
  ${tailwindCdn}
</head>
${rawCode}`;
}

/** Builds the host bridge installed before generated app code in the iframe. */
export function buildArtifactRuntimeScript(
  shapeId: string,
  initialStorage: unknown,
  frameToken = 'legacy-frame',
  peerConnectionsAllowed = false,
  blockedDependencies: readonly { origin: string; directive: string }[] = []
): string {
  const validatedStorage = validateStorageSnapshot(initialStorage);
  const safeStorage =
    validatedStorage.status === 'accepted' ? validatedStorage.storage : {};
  const limits = ARTIFACT_STORAGE_LIMITS;
  const safeShapeId = escapeInlineScriptJson(shapeId);
  const safeFrameToken = escapeInlineScriptJson(frameToken);
  const safeBootstrapStorage = escapeInlineScriptJson(safeStorage);
  const safeBlockedDependencies = escapeInlineScriptJson(
    blockedDependencies.slice(0, 24).flatMap((dependency) => {
      const result = normalizeArtifactNetworkHint(dependency.origin, dependency.directive);
      return result.status === 'accepted'
        ? [{ origin: result.hint.origin, directive: dependency.directive }]
        : [];
    })
  );

  return `
    <script id="__visionos_runtime__">
    (function() {
      const shapeId = ${safeShapeId};
      const frameToken = ${safeFrameToken};
      const initialData = ${safeBootstrapStorage};
      const blockedDependencies = ${safeBlockedDependencies};
      const peerConnectionsAllowed = ${peerConnectionsAllowed === true ? 'true' : 'false'};
      const limits = ${JSON.stringify(limits)};
      const store = new Map(Object.entries(initialData));
      let syncTimer = null;
      let storagePendingPosted = false;
      const reportedNetworkHints = new Set();
      const maxNetworkHints = 24;
      const pendingNetworkHints = [];
      let networkHintsReady = false;
      let embeddedFrameWarningSent = false;
      let embeddedFrameWarningPending = false;
      let peerConnectionWarningSent = false;
      let externalLinkRequests = 0;
      const maxExternalLinkRequests = 24;
      const networkDirectives = new Set([
        'connect-src', 'font-src', 'img-src', 'media-src', 'script-src',
        'script-src-elem', 'style-src', 'style-src-elem', 'worker-src'
      ]);

      const networkDirectiveAliases = {
        'img-src-elem': 'img-src'
      };

      function hasControlCharacters(value) {
        for (let index = 0; index < value.length; index += 1) {
          const character = value.charCodeAt(index);
          if (character <= 0x1f || (character >= 0x7f && character <= 0x9f)) return true;
        }
        return false;
      }

      function normalizeBlockedNetworkHint(blockedUrl, rawDirective) {
        if (typeof blockedUrl !== 'string' || blockedUrl.length < 1 || blockedUrl.length > 4096 ||
          hasControlCharacters(blockedUrl) ||
          typeof rawDirective !== 'string' || rawDirective.length > 64) return null;
        const directive = networkDirectiveAliases[rawDirective.toLowerCase().trim()] || rawDirective.toLowerCase().trim();
        if (!networkDirectives.has(directive)) return null;
        try {
          const url = new URL(blockedUrl);
          let origin = null;
          if (url.protocol === 'https:') origin = url.origin;
          else if (url.protocol === 'wss:' && directive === 'connect-src') {
            origin = url.origin.replace(/^wss:/, 'https:');
          }
          if (!origin || origin === 'null' || origin.length > 512) return null;
          return { origin: origin, directive: directive };
        } catch (err) {
          return null;
        }
      }

      function reportBlockedNetwork(originUrl, rawDirective) {
        if (reportedNetworkHints.size >= maxNetworkHints) return;
        const result = normalizeBlockedNetworkHint(originUrl, rawDirective);
        if (!result) return;
        const reportKey = result.origin + '|' + result.directive;
        if (reportedNetworkHints.has(reportKey)) return;
        reportedNetworkHints.add(reportKey);
        if (!networkHintsReady) {
          pendingNetworkHints.push(result);
          return;
        }
        sendNetworkHint(result);
      }

      function sendNetworkHint(hint) {
        try {
          window.parent.postMessage({
            type: 'VISIONOS_NETWORK_BLOCKED',
            shapeId: shapeId,
            frameToken: frameToken,
            url: hint.origin,
            directive: hint.directive
          }, '*');
        } catch (err) {}
      }

      function flushNetworkHints() {
        if (networkHintsReady) return;
        networkHintsReady = true;
        for (const hint of pendingNetworkHints.splice(0)) sendNetworkHint(hint);
        if (embeddedFrameWarningPending) sendBlockedEmbeddedFrame();
      }

      function sendBlockedEmbeddedFrame() {
        if (!embeddedFrameWarningPending || embeddedFrameWarningSent) return;
        embeddedFrameWarningPending = false;
        embeddedFrameWarningSent = true;
        try {
          window.parent.postMessage({
            type: 'VISIONOS_NAVIGATION_BLOCKED',
            shapeId: shapeId,
            frameToken: frameToken,
            directive: 'frame-src'
          }, '*');
        } catch (err) {}
      }

      function reportBlockedEmbeddedFrame() {
        if (embeddedFrameWarningSent || embeddedFrameWarningPending) return;
        embeddedFrameWarningPending = true;
        if (networkHintsReady) sendBlockedEmbeddedFrame();
      }

      function reportPolicyViolation(event) {
        if (!event || typeof event !== 'object') return;
        const blockedURI = typeof event.blockedURI === 'string' ? event.blockedURI : '';
        const directive = typeof event.effectiveDirective === 'string' && event.effectiveDirective
          ? event.effectiveDirective
          : event.violatedDirective;
        if (typeof directive === 'string' && directive.toLowerCase().trim() === 'frame-src') {
          reportBlockedEmbeddedFrame();
          return;
        }
        if (typeof directive === 'string') reportBlockedNetwork(blockedURI, directive);
      }

      window.addEventListener('securitypolicyviolation', reportPolicyViolation, true);
      window.addEventListener('DOMContentLoaded', flushNetworkHints, { once: true });
      setTimeout(flushNetworkHints, 0);
      for (const dependency of blockedDependencies) {
        if (dependency && typeof dependency.origin === 'string' && typeof dependency.directive === 'string') {
          reportBlockedNetwork(dependency.origin, dependency.directive);
        }
      }

      function findActivatedAnchor(event) {
        if (!event || event.isTrusted !== true || event.defaultPrevented === true) return null;
        const activation = window.navigator && window.navigator.userActivation;
        if (activation && activation.isActive !== true) return null;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        for (const node of path) {
          if (node && node.nodeType === 1 && String(node.tagName).toLowerCase() === 'a' &&
            typeof node.getAttribute === 'function') return node;
        }
        const target = event.target;
        if (target && typeof target.closest === 'function') return target.closest('a[href]');
        return null;
      }

      function reportExternalLink(event) {
        const anchor = findActivatedAnchor(event);
        if (!anchor || anchor.hasAttribute('download') || externalLinkRequests >= maxExternalLinkRequests) return;
        const rawHref = anchor.getAttribute('href');
        if (typeof rawHref !== 'string' || rawHref.length === 0 || rawHref.length > 4096 ||
          hasControlCharacters(rawHref) || rawHref.trim().startsWith('#')) return;
        let url;
        try {
          url = new URL(anchor.href, document.baseURI);
        } catch (err) {
          return;
        }
        if (url.protocol !== 'https:' || !url.hostname || url.origin === 'null' || url.username || url.password) return;
        const fullUrl = url.href;
        if (fullUrl.length > 4096 || hasControlCharacters(fullUrl)) return;
        event.preventDefault();
        externalLinkRequests += 1;
        try {
          window.parent.postMessage({
            type: 'VISIONOS_EXTERNAL_LINK',
            shapeId: shapeId,
            frameToken: frameToken,
            url: fullUrl
          }, '*');
        } catch (err) {}
      }

      document.addEventListener('click', reportExternalLink, true);

      function reportRejectedStorage(reason) {
        try {
          window.parent.postMessage({
            type: 'VISIONOS_STORAGE_REJECTED',
            shapeId: shapeId,
            frameToken: frameToken,
            reason: reason
          }, '*');
        } catch (err) {}
      }

      function storageLimitError() {
        if (store.size > limits.maxEntries) return 'too-many-keys';
        for (const [key, value] of store.entries()) {
          if (key.length > limits.maxKeyLength) return 'invalid';
          if (value.length > limits.maxValueLength) return 'too-large';
        }
        return JSON.stringify(Object.fromEntries(store.entries())).length <= limits.maxSerializedLength
          ? null
          : 'too-large';
      }

      function postStorageSnapshot(flushNow) {
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = null;
        }
        storagePendingPosted = false;
        try {
          const snapshot = Object.fromEntries(store.entries());
          window.parent.postMessage({
            type: 'VISIONOS_STORAGE_SYNC',
            shapeId: shapeId,
            frameToken: frameToken,
            storage: snapshot,
            flush: flushNow
          }, '*');
        } catch (err) {
          reportRejectedStorage('invalid');
        }
      }

      // Tell the host as soon as a value changes, without serializing the
      // complete app store on every edit. The next debounced snapshot carries
      // the actual data and remains the only save request.
      function announceStoragePending() {
        if (storagePendingPosted) return;
        storagePendingPosted = true;
        try {
          window.parent.postMessage({
            type: 'VISIONOS_STORAGE_PENDING',
            shapeId: shapeId,
            frameToken: frameToken
          }, '*');
        } catch (err) {}
      }

      function scheduleSync() {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => postStorageSnapshot(false), 120);
      }

      window.addEventListener('pagehide', function() { postStorageSnapshot(true); });
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') postStorageSnapshot(true);
      });

      const virtualStorage = {
        getItem: function(key) {
          const k = String(key);
          return store.has(k) ? store.get(k) : null;
        },
        setItem: function(key, value) {
          const k = String(key);
          const v = String(value);
          const hadKey = store.has(k);
          const previous = store.get(k);
          if (hadKey && previous === v) return;
          store.set(k, v);
          const reason = storageLimitError();
          if (reason) {
            if (hadKey) store.set(k, previous); else store.delete(k);
            reportRejectedStorage(reason);
            throw new DOMException('VisionOS app storage limit exceeded', 'QuotaExceededError');
          }
          announceStoragePending();
          scheduleSync();
        },
        removeItem: function(key) {
          if (store.delete(String(key))) {
            announceStoragePending();
            scheduleSync();
          }
        },
        clear: function() {
          if (store.size > 0) {
            store.clear();
            announceStoragePending();
            scheduleSync();
          }
        },
        key: function(index) {
          const keys = Array.from(store.keys());
          return keys[index] !== undefined ? keys[index] : null;
        },
        get length() { return store.size; }
      };

      try {
        Object.defineProperty(window, 'localStorage', {
          value: virtualStorage, configurable: true, enumerable: true, writable: false
        });
      } catch (e) {
        try { window.localStorage = virtualStorage; } catch (e2) {}
      }
      try {
        Object.defineProperty(window, 'sessionStorage', {
          value: virtualStorage, configurable: true, enumerable: true, writable: false
        });
      } catch (e) {
        try { window.sessionStorage = virtualStorage; } catch (e2) {}
      }

      const sdk = {
        shapeId: shapeId,
        storage: virtualStorage,
        db: {
          get: function(key, fallback) {
            const val = virtualStorage.getItem(key);
            if (val === null || val === undefined) return fallback !== undefined ? fallback : null;
            try { return JSON.parse(val); } catch { return val; }
          },
          set: function(key, value) {
            virtualStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
          },
          remove: function(key) { virtualStorage.removeItem(key); },
          clear: function() { virtualStorage.clear(); },
          getAll: function() { return Object.fromEntries(store.entries()); }
        }
      };
      window.VisionOS = sdk;
      window.CanvasOS = sdk;

      window.addEventListener('message', function(e) {
        if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
        if (e.data.type === 'CANVASOS_STORAGE_OVERWRITE') {
          if (e.data.shapeId !== shapeId) return;
          store.clear();
          for (const [k, v] of Object.entries(e.data.storage || {})) store.set(k, String(v));
          try { window.dispatchEvent(new Event('storage')); } catch (err) {}
          return;
        }
        if (e.data.type !== 'VISIONOS_STORAGE_FLUSH_REQUEST' || e.data.shapeId !== shapeId ||
          e.data.frameToken !== frameToken) return;
        const requestId = e.data.requestId;
        if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128 ||
          !/^[A-Za-z0-9:_-]+$/.test(requestId)) return;

        // The host can remount the policy frame only after this synchronous
        // snapshot reaches it and its durable storage write has completed.
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = null;
        }
        storagePendingPosted = false;
        const reason = storageLimitError();
        if (reason) {
          reportRejectedStorage(reason);
          return;
        }
        try {
          window.parent.postMessage({
            type: 'VISIONOS_STORAGE_FLUSH_ACK',
            shapeId: shapeId,
            frameToken: frameToken,
            requestId: requestId,
            storage: Object.fromEntries(store.entries())
          }, '*');
        } catch (err) {
          reportRejectedStorage('invalid');
        }
      });

      // The canvas mode button disables iframe pointer events, letting canvas
      // gestures escape. Pinch over the active app is translated to canvas zoom.
      window.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          try {
            window.parent.postMessage({
              type: 'CANVASOS_IFRAME_PINCH_ZOOM', shapeId: shapeId, frameToken: frameToken,
              deltaY: e.deltaY, deltaMode: e.deltaMode,
              clientX: e.clientX, clientY: e.clientY
            }, '*');
          } catch (err) {}
        }
      }, { passive: false, capture: true });

      function preventSafariGesture(e) {
        e.preventDefault();
        e.stopPropagation();
      }
      window.addEventListener('gesturestart', preventSafariGesture, { passive: false, capture: true });
      window.addEventListener('gesturechange', preventSafariGesture, { passive: false, capture: true });
      window.addEventListener('gestureend', preventSafariGesture, { passive: false, capture: true });

      // Best-effort defense in depth only. The app's network boundary remains
      // CSP and browser frame policy, not writable native-global overrides.
      if (!peerConnectionsAllowed) {
        function deniedPeerConnection() {
          if (!peerConnectionWarningSent) {
            peerConnectionWarningSent = true;
            try {
              window.parent.postMessage({
                type: 'VISIONOS_FEATURE_BLOCKED',
                shapeId: shapeId,
                frameToken: frameToken,
                feature: 'peer-to-peer'
              }, '*');
            } catch (err) {}
          }
          throw new DOMException('Peer-to-peer connections are unavailable in this app.', 'NotAllowedError');
        }
        for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
          try {
            Object.defineProperty(window, name, {
              value: deniedPeerConnection,
              configurable: false,
              enumerable: false,
              writable: false
            });
          } catch (err) {
            try { window[name] = deniedPeerConnection; } catch (err2) {}
          }
        }
      }
    })();
    </script>`;
}
