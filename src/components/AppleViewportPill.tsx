'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { Minus, Plus, Maximize2, Undo2, Redo2 } from 'lucide-react';

/**
 * Authoritative zoom percentage calculation
 * per PROJECT.md: Math.round(zoom * 100) + '%' with tabular-nums
 */
export function formatZoomPercentage(zoomLevel: number): string {
  if (typeof zoomLevel !== 'number' || isNaN(zoomLevel)) return '100%';
  return `${Math.round(zoomLevel * 100)}%`;
}

export interface AppleViewportPillProps {
  editor: Editor | null;
}

export const AppleViewportPill: React.FC<AppleViewportPillProps> = ({ editor }) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const syncViewport = () => {
      try {
        setZoomLevel(editor.getZoomLevel());
        setCanUndo(editor.getCanUndo());
        setCanRedo(editor.getCanRedo());
      } catch (err) {
        // Safe fallback
      }
    };

    syncViewport();
    const unsubscribe = editor.store.listen(() => {
      syncViewport();
    });

    return () => {
      unsubscribe();
    };
  }, [editor]);

  const handleZoomOut = useCallback(() => {
    if (!editor) return;
    try {
      editor.zoomOut();
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  const handleZoomIn = useCallback(() => {
    if (!editor) return;
    try {
      editor.zoomIn();
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  const handleZoomToFit = useCallback(() => {
    if (!editor) return;
    try {
      editor.zoomToFit({ animation: { duration: 250 } });
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  const handleResetZoom = useCallback(() => {
    if (!editor) return;
    try {
      editor.resetZoom();
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  const handleUndo = useCallback(() => {
    if (!editor) return;
    try {
      editor.undo();
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  const handleRedo = useCallback(() => {
    if (!editor) return;
    try {
      editor.redo();
    } catch (err) {
      // Fallback
    }
  }, [editor]);

  return (
    <aside
      aria-label="Viewport and History Controls"
      className="fixed bottom-6 left-6 z-[300] flex items-center gap-0.5 p-1.5 rounded-[18px] liquid-glass-pill select-none"
    >
      {/* Zoom Out Button */}
      <button
        type="button"
        title="Zoom Out (Cmd -)"
        aria-label="Zoom Out"
        onClick={handleZoomOut}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
      >
        <Minus className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>

      {/* Tabular Zoom Percentage Display (Click to Reset 100%) */}
      <button
        type="button"
        title="Reset Zoom to 100% (Shift 0)"
        aria-label="Reset Zoom"
        onClick={handleResetZoom}
        className="flex items-center justify-center min-w-[50px] min-h-[40px] px-2 text-xs font-semibold text-slate-200 hover:text-white tabular-nums hover:bg-white/10 rounded-xl transition-all active:scale-[0.96]"
      >
        <span>{formatZoomPercentage(zoomLevel)}</span>
      </button>

      {/* Zoom In Button */}
      <button
        type="button"
        title="Zoom In (Cmd +)"
        aria-label="Zoom In"
        onClick={handleZoomIn}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>

      {/* Zoom to Fit */}
      <button
        type="button"
        title="Zoom to Fit Content (Shift 1)"
        aria-label="Zoom to Fit"
        onClick={handleZoomToFit}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
      >
        <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>

      {/* Vertical Divider */}
      <div className="h-5 w-[1px] bg-white/10 mx-1" />

      {/* Undo Button */}
      <button
        type="button"
        title="Undo (Cmd Z)"
        aria-label="Undo"
        onClick={handleUndo}
        disabled={!canUndo}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:pointer-events-none transition-all active:scale-[0.96]"
      >
        <Undo2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>

      {/* Redo Button */}
      <button
        type="button"
        title="Redo (Cmd Shift Z)"
        aria-label="Redo"
        onClick={handleRedo}
        disabled={!canRedo}
        className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:pointer-events-none transition-all active:scale-[0.96]"
      >
        <Redo2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>
    </aside>
  );
};

export default AppleViewportPill;
