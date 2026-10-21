import React from 'react';
import type { Editor } from '@tldraw/tldraw';
import {
  Sparkles,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Grid,
  Magnet,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  FileText,
} from 'lucide-react';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';

interface SpatialToolbarProps {
  editor: Editor | null;
  spatial: ReturnType<typeof useSpatialWorker>;
}

export const SpatialToolbar: React.FC<SpatialToolbarProps> = ({ editor, spatial }) => {
  const handleUndo = () => editor?.undo();
  const handleRedo = () => editor?.redo();
  const handleZoomIn = () => editor?.zoomIn();
  const handleZoomOut = () => editor?.zoomOut();
  const handleResetZoom = () => editor?.resetZoom();

  const handleCreateDoc = () => {
    if (!editor) return;
    const center = editor.getViewportPageBounds().center;
    editor.createShape({
      type: 'document',
      x: center.x - 340,
      y: center.y - 260,
      props: {
        w: 680,
        h: 520,
        title: 'New Technical Document',
        subtitle: 'Structured Notion-grade documentation card',
        author: 'User',
        date: 'September 2026',
        sections: [
          {
            id: `sec_${Date.now()}_1`,
            title: '1. Executive Summary',
            badge: 'Introduction',
            content: 'Write your documentation here with markdown, math, and tables.',
          },
          {
            id: `sec_${Date.now()}_2`,
            title: '2. Architecture Specification',
            badge: 'System Design',
            content: 'Detailed system architecture, components, and implementation specifications.',
          },
        ],
      },
    });
  };

  return (
    <header className="visionos-toolbar canvasos-toolbar pointer-events-none fixed top-16 left-6 right-6 z-[320] flex items-center justify-between">
      {/* Left: Brand & Engine Telemetry */}
      <div className="visionos-brand canvasos-brand pointer-events-auto flex items-center gap-3 rounded-2xl liquid-glass-elevated px-3.5 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-wider text-white">
              VisionOS
            </span>
            <span className="text-[9px] font-mono text-indigo-300">
              AI-First Spatial OS
            </span>
          </div>
        </div>

        <div className="h-4 w-[1px] bg-white/10" />

        {/* Worker & Latency SLA Badge */}
        <div className="flex items-center gap-2 text-[11px] text-slate-300">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-mono text-[10px]">
            {spatial.lastLatencyMs !== null
              ? `${spatial.lastLatencyMs}ms`
              : `${spatial.indexedCount} nodes indexed`}
          </span>
        </div>
      </div>



      {/* Right: Canvas & Layout Controls */}
      <div className="visionos-toolbar-actions canvasos-toolbar-actions pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 flex items-center gap-1.5 rounded-2xl liquid-glass-elevated p-1.5">
        {/* Undo / Redo */}
        <button
          onClick={handleUndo}
          title="Undo AI Batch (Cmd+Z)"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleRedo}
          title="Redo (Cmd+Shift+Z)"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <div className="h-4 w-[1px] bg-white/10" />

        {/* Quick Shape Spawners */}
        <button
          onClick={handleCreateDoc}
          title="Create Longform Document (Notion grade)"
          className="flex items-center gap-1 rounded-xl p-2 text-indigo-300 hover:bg-indigo-500/20 hover:text-white transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
        </button>

        <div className="h-4 w-[1px] bg-white/10" />

        {/* Spatial Constraint Triggers */}
        <button
          onClick={() => spatial.alignNodes('horizontal')}
          title="Cassowary Horizontal Alignment"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => spatial.alignNodes('vertical')}
          title="Cassowary Vertical Alignment"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => spatial.alignNodes('grid')}
          title="Cassowary Grid Matrix Alignment"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Grid className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => spatial.repelCollisions()}
          title="Repel Overlapping Shapes"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Magnet className="h-3.5 w-3.5" />
        </button>

        <div className="h-4 w-[1px] bg-white/10" />

        {/* Zoom Controls */}
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleResetZoom}
          title="Reset Zoom"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Maximize className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
};
