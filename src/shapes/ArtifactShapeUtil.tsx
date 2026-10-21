'use client';

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  TLBaseShape,
  T,
  RecordProps,
  stopEventPropagation,
  TLResizeInfo,
} from '@tldraw/tldraw';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { RotateCcw, Code, Eye, Sparkles, Database, Trash2, Copy } from 'lucide-react';
import { readStorageMessage } from '../lib/artifactStorage';
import { smartStopPropagation, isSpacePanHeld } from '../lib/panModifier';

export type TLArtifactShape = TLBaseShape<
  'artifact',
  {
    w: number;
    h: number;
    title: string;
    code: string;
    color: string;
    storage?: Record<string, string>;
  }
>;

export const artifactShapeProps: RecordProps<TLArtifactShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  code: T.string,
  color: T.string,
  storage: T.optional(T.dict(T.string, T.string)),
};

import { stripMarkdownFences } from '../lib/sanitizeHtml';
export { stripMarkdownFences };

function ArtifactComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLArtifactShape;
  editor?: import('@tldraw/tldraw').Editor;
  onUpdate: (updates: Partial<TLArtifactShape['props']>) => void;
}) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [isSelected, setIsSelected] = useState(false);
  const [key, setKey] = useState(0);
  const [editableCode, setEditableCode] = useState(() =>
    stripMarkdownFences(shape.props.code || '')
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!editor) return;
    const checkSelected = () => {
      try {
        setIsSelected(editor.getSelectedShapeIds().includes(shape.id));
      } catch {}
    };
    checkSelected();
    return editor.store.listen(checkSelected);
  }, [editor, shape.id]);

  useEffect(() => {
    setEditableCode(stripMarkdownFences(shape.props.code || ''));
  }, [shape.props.code]);

  const { w, h, title, code, storage } = shape.props;
  const currentStorageRef = useRef<Record<string, string>>(storage || {});
  const pendingStorageRef = useRef<Record<string, string> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef(editor);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Update internal ref whenever props.storage changes externally
  useEffect(() => {
    currentStorageRef.current = storage || {};
  }, [storage]);

  // Flush any pending virtual storage updates immediately
  const flushStorageUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingStorageRef.current) {
      const pending = pendingStorageRef.current;
      pendingStorageRef.current = null;
      onUpdate({ storage: pending });
    }
  }, [onUpdate]);

  // Listen for storage mutations and zoom gestures from the sandboxed iframe virtual environment
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 1. Intercept iframe pinch-to-zoom (trackpad pinch or Ctrl/Meta+wheel) and forward to canvas camera
      if (
        event.data &&
        event.data.type === 'CANVASOS_IFRAME_PINCH_ZOOM' &&
        event.data.shapeId === shape.id &&
        event.source === iframeRef.current?.contentWindow
      ) {
        const ed = editorRef.current;
        const iframe = iframeRef.current;
        if (!ed || !iframe) return;

        const rect = iframe.getBoundingClientRect();
        const iframeW = iframe.clientWidth || rect.width || 1;
        const iframeH = iframe.clientHeight || rect.height || 1;

        // Map relative cursor position in iframe to physical client screen coordinates
        const fractionX = Math.max(0, Math.min(1, (event.data.clientX ?? 0) / iframeW));
        const fractionY = Math.max(0, Math.min(1, (event.data.clientY ?? 0) / iframeH));
        const screenX = rect.left + fractionX * rect.width;
        const screenY = rect.top + fractionY * rect.height;

        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

        let dy = Number(event.data.deltaY) || 0;
        if (event.data.deltaMode === 1) {
          dy *= 16;
        } else if (event.data.deltaMode === 2) {
          dy *= iframeH;
        }

        const clampedDy = Math.max(-120, Math.min(120, dy));
        const { x: cx, y: cy, z: cz } = ed.getCamera();

        // Standard zoom factor calculation: negative deltaY = zoom in (pinch out)
        const zoomFactor = Math.exp(-clampedDy * 0.008);
        const nextZ = Math.min(8.0, Math.max(0.05, cz * zoomFactor));

        if (Math.abs(nextZ - cz) > 0.0001) {
          // Convert anchor screen point to page space
          const pPage = ed.screenToPage({ x: screenX, y: screenY });

          // Compute new camera position anchoring the point under cursor
          const nextCx = ((pPage.x + cx) * cz) / nextZ - pPage.x;
          const nextCy = ((pPage.y + cy) * cz) / nextZ - pPage.y;

          ed.setCamera({ x: nextCx, y: nextCy, z: nextZ }, { immediate: true });
        }
        return;
      }

      const next = readStorageMessage(
        event.data,
        event.source,
        iframeRef.current?.contentWindow,
        shape.id
      );
      if (!next) return;

      // Update immediate memory ref
      currentStorageRef.current = next;

      // Content-equality check against current props or pending update
      const currentSnapshot = pendingStorageRef.current || shape.props.storage || {};
      const currentKeys = Object.keys(currentSnapshot);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((k) => currentSnapshot[k] === next[k])
      ) {
        return;
      }

      pendingStorageRef.current = next;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        flushStorageUpdate();
      }, 300);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      flushStorageUpdate();
    };
  }, [shape.id, shape.props.storage, flushStorageUpdate]);

  const handleClearStorage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingStorageRef.current = null;
    currentStorageRef.current = {};
    onUpdate({ storage: {} });
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'CANVASOS_STORAGE_OVERWRITE',
          shapeId: shape.id,
          storage: {},
        },
        '*'
      );
    }
    setKey((k) => k + 1);
  };

  const storageCount = Object.keys(storage || {}).length;

  // Build the sandboxed virtual environment document.
  // Memoized on [key, code, shape.id] so runtime storage updates do NOT cause
  // the iframe to reload while the user is actively interacting with the widget.
  const srcDoc = useMemo(() => {
    const bootstrapStorage = currentStorageRef.current || {};
    const safeBootstrapStorage = JSON.stringify(bootstrapStorage).replace(
      /</g,
      '\\u003c'
    );
    const safeShapeId = JSON.stringify(shape.id).replace(/</g, '\\u003c');

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src * data: blob: https:; font-src * data: https:; media-src * data: blob: https:; connect-src * https: wss:;">`;

    const runtimeScript = `
    <script id="__canvasos_runtime__">
    (function() {
      const shapeId = ${safeShapeId};
      const initialData = ${safeBootstrapStorage};
      const store = new Map(Object.entries(initialData));
      let syncTimer = null;

      function scheduleSync() {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
          try {
            const snapshot = Object.fromEntries(store.entries());
            window.parent.postMessage({
              type: 'CANVASOS_STORAGE_SYNC',
              shapeId: shapeId,
              storage: snapshot
            }, '*');
          } catch (err) {
            console.error('[CanvasOS Runtime] Storage sync error:', err);
          }
        }, 120);
      }

      const virtualStorage = {
        getItem: function(key) {
          const k = String(key);
          return store.has(k) ? store.get(k) : null;
        },
        setItem: function(key, value) {
          const k = String(key);
          const v = String(value);
          store.set(k, v);
          scheduleSync();
        },
        removeItem: function(key) {
          const k = String(key);
          if (store.delete(k)) {
            scheduleSync();
          }
        },
        clear: function() {
          if (store.size > 0) {
            store.clear();
            scheduleSync();
          }
        },
        key: function(index) {
          const keys = Array.from(store.keys());
          return keys[index] !== undefined ? keys[index] : null;
        },
        get length() {
          return store.size;
        }
      };

      // Intercept standard window.localStorage
      try {
        Object.defineProperty(window, 'localStorage', {
          value: virtualStorage,
          configurable: true,
          enumerable: true,
          writable: false
        });
      } catch (e) {
        try { window.localStorage = virtualStorage; } catch (e2) {}
      }

      // Intercept standard window.sessionStorage
      try {
        Object.defineProperty(window, 'sessionStorage', {
          value: virtualStorage,
          configurable: true,
          enumerable: true,
          writable: false
        });
      } catch (e) {
        try { window.sessionStorage = virtualStorage; } catch (e2) {}
      }

      // Provide native CanvasOS developer & AI helper SDK
      window.CanvasOS = {
        shapeId: shapeId,
        storage: virtualStorage,
        db: {
          get: function(key, fallback) {
            const val = virtualStorage.getItem(key);
            if (val === null || val === undefined) return fallback !== undefined ? fallback : null;
            try {
              return JSON.parse(val);
            } catch {
              return val;
            }
          },
          set: function(key, value) {
            virtualStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
          },
          remove: function(key) {
            virtualStorage.removeItem(key);
          },
          clear: function() {
            virtualStorage.clear();
          },
          getAll: function() {
            return Object.fromEntries(store.entries());
          }
        }
      };

      // Handle programmatic storage overwrite from parent
      window.addEventListener('message', function(e) {
        if (e.source === window.parent && e.data && e.data.type === 'CANVASOS_STORAGE_OVERWRITE' && e.data.shapeId === shapeId) {
          store.clear();
          for (const [k, v] of Object.entries(e.data.storage || {})) {
            store.set(k, String(v));
          }
          try {
            window.dispatchEvent(new Event('storage'));
          } catch (err) {}
        }
      });

      // Intercept trackpad pinch-to-zoom (ctrl/meta + wheel) and Safari gesture events inside the iframe.
      // We prevent the browser default (which zooms the entire webpage window) and forward
      // the gesture to the parent tldraw canvas so it smoothly zooms only the infinite canvas!
      window.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          try {
            window.parent.postMessage({
              type: 'CANVASOS_IFRAME_PINCH_ZOOM',
              shapeId: shapeId,
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              clientX: e.clientX,
              clientY: e.clientY
            }, '*');
          } catch (err) {}
        }
      }, { passive: false, capture: true });

      function preventSafariGesture(e) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (err) {}
      }
      window.addEventListener('gesturestart', preventSafariGesture, { passive: false, capture: true });
      window.addEventListener('gesturechange', preventSafariGesture, { passive: false, capture: true });
      window.addEventListener('gestureend', preventSafariGesture, { passive: false, capture: true });
    })();
    </script>`;

    const baseStyle = `
    <style id="__canvasos_base_style__">
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

    const tailwindCdn = `<script src="https://cdn.tailwindcss.com"></script>`;

    const rawCode = stripMarkdownFences(code || '');
    const isFullHtml =
      /<!DOCTYPE\s+html/i.test(rawCode) || /<html[\s>]/i.test(rawCode);
    const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`;

    if (isFullHtml) {
      let modified = rawCode;
      // Ensure viewport meta tag is present
      if (!/<meta[^>]+name=["']viewport["']/i.test(modified)) {
        if (/<head[\s>]/i.test(modified)) {
          modified = modified.replace(
            /<head([^>]*)>/i,
            `<head$1>\n${viewportMeta}`
          );
        }
      }
      if (/<head[\s>]/i.test(modified)) {
        modified = modified.replace(
          /<head([^>]*)>/i,
          `<head$1>\n${cspMeta}\n${runtimeScript}\n${baseStyle}`
        );
      } else if (/<html[\s>]/i.test(modified)) {
        modified = modified.replace(
          /<html([^>]*)>/i,
          `<html$1>\n<head>\n${viewportMeta}\n${cspMeta}\n${runtimeScript}\n${baseStyle}\n</head>`
        );
      } else {
        modified = `${viewportMeta}\n${cspMeta}\n${runtimeScript}\n${baseStyle}\n${modified}`;
      }
      return modified;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${viewportMeta}
  ${cspMeta}
  ${tailwindCdn}
  ${baseStyle}
  ${runtimeScript}
</head>
<body>
  ${rawCode}
</body>
</html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, code, shape.id]);

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Window Bar */}
      <div className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <Sparkles
            className="h-4 w-4 text-indigo-400 shrink-0"
            strokeWidth={1.5}
          />
          <span
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title}
          >
            {title || 'Interactive Sandbox'}
          </span>
          <span className="shrink-0 rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-slate-400 uppercase tracking-wider">
            Live
          </span>

          {storageCount > 0 && (
            <div
              className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300 select-none tabular-nums"
              title={`Persistent Virtual Storage: ${storageCount} key${storageCount === 1 ? '' : 's'} saved in canvas state`}
            >
              <Database className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
              <span>
                <span className="tabular-nums font-semibold">
                  {storageCount}
                </span>{' '}
                saved
              </span>
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onPointerDown={stopEventPropagation}
        >
          {storageCount > 0 && (
            <button
              type="button"
              onClick={handleClearStorage}
              title="Clear Saved Virtual Storage"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/15 hover:text-red-300 active:scale-[0.96] transition-all"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setViewMode(viewMode === 'preview' ? 'code' : 'preview')
            }
            title={
              viewMode === 'preview'
                ? 'View/Edit Source Code'
                : 'View Live Simulation'
            }
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            {viewMode === 'preview' ? (
              <Code className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Eye className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setKey((k) => k + 1)}
            title="Reload Simulation"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => editor?.duplicateShapes([shape.id])}
            title="Duplicate App"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100 active:scale-[0.96] transition-all"
          >
            <Copy className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => editor?.deleteShapes([shape.id])}
            title="Delete App"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/15 hover:text-rose-400 active:scale-[0.96] transition-all"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Main Sandbox Canvas / Code Area */}
      <div
        className="relative flex-1 min-h-0 w-full overflow-hidden bg-black/40 select-text overscroll-contain"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
      >
        {/* Transparent Selection Shield when unselected: prevents iframe from stealing pointer events so 1-click select & drag work natively */}
        {!isSelected && viewMode === 'preview' && (
          <div className="absolute inset-0 z-10 bg-transparent cursor-pointer" />
        )}
        {viewMode === 'preview' ? (
          <iframe
            ref={iframeRef}
            key={key}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-modals allow-forms"
            title={title}
            className="canvasos-artifact-frame h-full w-full border-none"
          />
        ) : (
          <textarea
            value={editableCode}
            data-scrollable="true"
            onChange={(e) => {
              setEditableCode(e.target.value);
              onUpdate({ code: e.target.value });
            }}
            onPointerDown={isSelected ? smartStopPropagation : undefined}
            className="h-full w-full resize-none p-3 font-mono text-[11px] leading-relaxed text-indigo-200 bg-[#090b14] outline-none custom-card-scrollbar"
          />
        )}
      </div>
    </HTMLContainer>
  );
}

export class ArtifactShapeUtil extends BaseBoxShapeUtil<TLArtifactShape> {
  static override type = 'artifact' as const;
  static override props = artifactShapeProps;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(
    shape: TLArtifactShape,
    info: TLResizeInfo<TLArtifactShape>
  ) {
    return {
      props: {
        w: Math.max(480, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(360, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLArtifactShape['props'] {
    return {
      w: 760,
      h: 520,
      title: 'Particle Gravity Physics Sandbox',
      code: `<canvas id="c"></canvas>
<script>
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  function resize(){ c.width = window.innerWidth; c.height = window.innerHeight; }
  window.onresize = resize; resize();
  
  const particles = [];
  for(let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * c.width,
      y: Math.random() * c.height,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3,
      radius: Math.random() * 4 + 2,
      color: "hsl(" + (Math.random() * 60 + 220) + ", 85%, 65%)"
    });
  }

  let mouse = { x: -1000, y: -1000 };
  window.onmousemove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };

  function loop() {
    ctx.fillStyle = "rgba(11, 14, 28, 0.25)";
    ctx.fillRect(0, 0, c.width, c.height);

    for(let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if(p.x < 0 || p.x > c.width) p.vx *= -1;
      if(p.y < 0 || p.y > c.height) p.vy *= -1;

      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < 120 && dist > 0) {
        p.vx -= (dx / dist) * 0.4;
        p.vy -= (dy / dist) * 0.4;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      for(let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const d2 = Math.hypot(p.x - p2.x, p.y - p2.y);
        if(d2 < 90) {
          ctx.strokeStyle = "rgba(129, 140, 248, " + (1 - d2/90)*0.4 + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
</script>`,
      color: 'light-violet',
      storage: {},
    };
  }

  override component(shape: TLArtifactShape) {
    return (
      <ArtifactComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.run(
            () =>
              this.editor.updateShape({
                id: shape.id,
                type: 'artifact',
                props: updates,
              }),
            {
              history: Object.keys(updates).every((k) => k === 'storage')
                ? 'ignore'
                : 'record',
            }
          );
        }}
      />
    );
  }

  override indicator(shape: TLArtifactShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}
