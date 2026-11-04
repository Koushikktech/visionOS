import { buildArtifactNetworkCsp } from './artifactNetworkPolicy';

export const ARTIFACT_BOUNDARY_FRAME_ID = 'visionos-app-runner';
export const ARTIFACT_BOUNDARY_SANDBOX = 'allow-scripts allow-modals';

export interface ArtifactFrameBoundaryOptions {
  childSrcDoc: string;
  shapeId: string;
  frameToken: string;
  origins: readonly unknown[];
  /** Pass the same value to the child runtime builder; CSP does not control WebRTC. */
  allowPeerConnections?: boolean;
}

/** Normalize a user-clicked outbound link without exposing credentials or accepting other schemes. */
export function normalizeArtifactExternalLink(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    /[\u0000-\u0020\u007f-\u009f]/.test(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.href.length > 4_096
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case '<': return '\\u003c';
      case '>': return '\\u003e';
      case '&': return '\\u0026';
      case '\u2028': return '\\u2028';
      default: return '\\u2029';
    }
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildBoundaryScript(shapeId: string, frameToken: string, childSrcDoc: string): string {
  const safeShapeId = escapeInlineJson(shapeId);
  const safeFrameToken = escapeInlineJson(frameToken);
  const safeChildSrcDoc = escapeInlineJson(childSrcDoc);

  return [
    '(function () {',
    '  "use strict";',
    '  const shapeId = ' + safeShapeId + ';',
    '  const frameToken = ' + safeFrameToken + ';',
    '  const childSrcDoc = ' + safeChildSrcDoc + ';',
    '  const runner = document.createElement("iframe");',
    '  runner.id = "visionos-app-runner";',
    '  runner.setAttribute("sandbox", "allow-scripts allow-modals");',
    '  runner.setAttribute("referrerpolicy", "no-referrer");',
    '  runner.setAttribute("title", "App preview");',
    '  runner.style.width = "100%";',
    '  runner.style.height = "100%";',
    '  runner.style.border = "0";',
    '  runner.style.display = "block";',
    '  runner.style.background = "transparent";',
    '  const childWindow = () => runner.contentWindow;',
    '  let navigationBlockedSent = false;',
    '  const networkHintsSent = new Set();',
    '  const blockedFeaturesSent = new Set();',
    '  const parentWindow = window.parent;',
    '',
    '  function isRecord(value) {',
    '    return !!value && typeof value === "object" && !Array.isArray(value);',
    '  }',
    '',
    '  function validateStorageSnapshot(value) {',
    '    if (!isRecord(value)) return { status: "rejected", reason: "invalid" };',
    '    try {',
    '      const entries = Object.entries(value);',
    '      if (entries.length > 500) return { status: "rejected", reason: "too-many-keys" };',
    '      const storage = Object.create(null);',
    '      for (const [key, item] of entries) {',
    '        if (key.length > 512 || typeof item !== "string") return { status: "rejected", reason: "invalid" };',
    '        if (item.length > 250000) return { status: "rejected", reason: "too-large" };',
    '        storage[key] = item;',
    '      }',
    '      if (JSON.stringify(storage).length > 1000000) return { status: "rejected", reason: "too-large" };',
    '      return { status: "accepted", storage: storage };',
    '    } catch (error) { return { status: "rejected", reason: "invalid" }; }',
    '  }',
    '',
    '  function normalizeNetworkHint(urlValue, directiveValue) {',
    '    if (typeof urlValue !== "string" || !urlValue.length || urlValue.length > 4096 ||',
    '      /[\\u0000-\\u0020\\u007f-\\u009f]/.test(urlValue) || typeof directiveValue !== "string" || directiveValue.length > 64) return null;',
    '    let directive = directiveValue.toLowerCase().trim();',
    '    if (directive === "img-src-elem") directive = "img-src";',
    '    const allowed = new Set(["connect-src", "img-src", "style-src", "style-src-elem", "script-src", "script-src-elem", "font-src", "media-src", "worker-src"]);',
    '    if (!allowed.has(directive)) return null;',
    '    try {',
    '      const url = new URL(urlValue);',
    '      let origin = null;',
    '      if (url.protocol === "https:") origin = url.origin;',
    '      else if (url.protocol === "wss:" && directive === "connect-src") origin = url.origin.replace(/^wss:/, "https:");',
    '      if (!origin || origin === "null" || origin.length > 512) return null;',
    '      return { origin: origin, directive: directive };',
    '    } catch (error) { return null; }',
    '  }',
    '',
    '  function normalizeExternalLink(value) {',
    '    if (typeof value !== "string" || !value.length || value.length > 4096 ||',
    '      /[\\u0000-\\u0020\\u007f-\\u009f]/.test(value)) return null;',
    '    try {',
    '      const url = new URL(value);',
    '      if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.href.length > 4096) return null;',
    '      return url.href;',
    '    } catch (error) { return null; }',
    '  }',
    '',
    '  function hasIdentity(data, requireToken) {',
    '    return isRecord(data) && data.shapeId === shapeId &&',
    '      (requireToken ? data.frameToken === frameToken :',
    '        data.frameToken === undefined || data.frameToken === frameToken);',
    '  }',
    '',
    '  function validRequestId(value) {',
    '    return typeof value === "string" && value.length > 0 && value.length <= 128 &&',
    '      /^[A-Za-z0-9:_-]+$/.test(value);',
    '  }',
    '',
    '  function sendToHost(message) {',
    '    try { parentWindow.postMessage(message, "*"); } catch (error) {}',
    '  }',
    '',
    '  function sendNavigationBlocked() {',
    '    if (navigationBlockedSent) return;',
    '    navigationBlockedSent = true;',
    '    sendToHost({ type: "VISIONOS_NAVIGATION_BLOCKED", shapeId: shapeId, frameToken: frameToken });',
    '  }',
    '',
    '  function sendStorageRejected(reason) {',
    '    if (reason !== "invalid" && reason !== "too-many-keys" && reason !== "too-large") return;',
    '    sendToHost({ type: "VISIONOS_STORAGE_REJECTED", shapeId: shapeId, frameToken: frameToken, reason: reason });',
    '  }',
    '',
    '  function forwardChildMessage(data) {',
    '    if (!hasIdentity(data, true) || typeof data.type !== "string") return;',
    '    switch (data.type) {',
    '      case "VISIONOS_STORAGE_PENDING":',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken });',
    '        return;',
    '      case "VISIONOS_STORAGE_SYNC": {',
    '        const validation = validateStorageSnapshot(data.storage);',
    '        if (validation.status !== "accepted") { sendStorageRejected(validation.reason); return; }',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken,',
    '          storage: validation.storage, flush: data.flush === true });',
    '        return;',
    '      }',
    '      case "VISIONOS_STORAGE_REJECTED":',
    '        if (data.reason === "invalid" || data.reason === "too-many-keys" || data.reason === "too-large") {',
    '          sendStorageRejected(data.reason);',
    '        }',
    '        return;',
    '      case "VISIONOS_STORAGE_FLUSH_ACK": {',
    '        if (!validRequestId(data.requestId)) return;',
    '        const validation = validateStorageSnapshot(data.storage);',
    '        if (validation.status !== "accepted") { sendStorageRejected(validation.reason); return; }',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken,',
    '          requestId: data.requestId, storage: validation.storage });',
    '        return;',
    '      }',
    '      case "CANVASOS_IFRAME_PINCH_ZOOM":',
    '        if (!Number.isFinite(data.deltaY) || !Number.isFinite(data.clientX) ||',
    '          !Number.isFinite(data.clientY) || ![0, 1, 2].includes(data.deltaMode)) return;',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken,',
    '          deltaY: data.deltaY, deltaMode: data.deltaMode,',
    '          clientX: data.clientX, clientY: data.clientY });',
    '        return;',
    '      case "VISIONOS_NETWORK_BLOCKED": {',
    '        const hint = normalizeNetworkHint(data.url, data.directive);',
    '        if (!hint || networkHintsSent.size >= 24) return;',
    '        const key = hint.origin + "|" + hint.directive;',
    '        if (networkHintsSent.has(key)) return;',
    '        networkHintsSent.add(key);',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken,',
    '          url: hint.origin, directive: hint.directive });',
    '        return;',
    '      }',
    '      case "VISIONOS_EXTERNAL_LINK": {',
    '        const url = normalizeExternalLink(data.url);',
    '        if (!url) return;',
    '        sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken, url: url });',
    '        return;',
    '      }',
    '      case "VISIONOS_NAVIGATION_BLOCKED":',
    '        sendNavigationBlocked();',
    '        return;',
    '      case "VISIONOS_FEATURE_BLOCKED":',
    '        if (data.feature === "peer-to-peer" && !blockedFeaturesSent.has(data.feature)) {',
    '          blockedFeaturesSent.add(data.feature);',
    '          sendToHost({ type: data.type, shapeId: shapeId, frameToken: frameToken, feature: "peer-to-peer" });',
    '        }',
    '        return;',
    '      default:',
    '        return;',
    '    }',
    '  }',
    '',
    '  function forwardHostMessage(data) {',
    '    if (!hasIdentity(data, false) || typeof data.type !== "string") return;',
    '    if (data.type === "CANVASOS_STORAGE_OVERWRITE") {',
    '      const validation = validateStorageSnapshot(data.storage);',
    '      if (validation.status !== "accepted") return;',
    '      childWindow().postMessage({ type: data.type, shapeId: shapeId,',
    '        storage: validation.storage }, "*");',
    '      return;',
    '    }',
    '    if (data.type === "VISIONOS_STORAGE_FLUSH_REQUEST" &&',
    '      data.frameToken === frameToken && validRequestId(data.requestId)) {',
    '      childWindow().postMessage({ type: data.type, shapeId: shapeId,',
    '        frameToken: frameToken, requestId: data.requestId }, "*");',
    '    }',
    '  }',
    '',
    '  window.addEventListener("message", function (event) {',
    '    if (event.source === childWindow()) { forwardChildMessage(event.data); return; }',
    '    if (event.source === parentWindow) forwardHostMessage(event.data);',
    '  });',
    '',
    '  document.addEventListener("securitypolicyviolation", function (event) {',
    '    const directive = typeof event.effectiveDirective === "string"',
    '      ? event.effectiveDirective.toLowerCase()',
    '      : typeof event.violatedDirective === "string" ? event.violatedDirective.toLowerCase() : "";',
    '    if (directive === "frame-src" || directive === "child-src") sendNavigationBlocked();',
    '  }, true);',
    '',
    '  try {',
    '    if (typeof Blob === "function" && typeof URL !== "undefined" &&',
    '      typeof URL.createObjectURL === "function") {',
    '      const childUrl = URL.createObjectURL(new Blob([childSrcDoc], { type: "text/html" }));',
    '      runner.src = childUrl;',
    '      window.addEventListener("pagehide", function () { URL.revokeObjectURL(childUrl); }, { once: true });',
    '    } else {',
    '      runner.srcdoc = childSrcDoc;',
    '    }',
    '  } catch (error) {',
    '    runner.srcdoc = childSrcDoc;',
    '  }',
    '  document.body.appendChild(runner);',
    '})();',
  ].join('\n');
}

/** Build the trusted wrapper document that applies an inherited CSP to the generated Blob child. */
export function buildArtifactBoundarySrcDoc(options: ArtifactFrameBoundaryOptions): string {
  const { childSrcDoc, shapeId, frameToken, origins } = options;
  const networkPolicy = buildArtifactNetworkCsp(origins);
  const wrapperCsp = networkPolicy.csp.replace("frame-src 'none'", 'frame-src blob:');
  const safePolicy = escapeAttribute(wrapperCsp);
  const script = buildBoundaryScript(shapeId, frameToken, childSrcDoc);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta http-equiv="Content-Security-Policy" content="' + safePolicy + '">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <style>html,body{width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:transparent}*{box-sizing:border-box}</style>',
    '</head>',
    '<body>',
    '  <script id="__visionos_artifact_boundary__">' + script + '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}
