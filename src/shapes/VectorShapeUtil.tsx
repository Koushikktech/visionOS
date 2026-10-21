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
import React, { useMemo } from 'react';
import { Database, Cloud, Diamond, Cpu, Layers, GripHorizontal, Box } from 'lucide-react';
import { smartStopPropagation } from '../lib/panModifier';
import type { VectorGlyphType } from '../types/spatial';

export type TLVectorShape = TLBaseShape<
  'vector_shape',
  {
    w: number;
    h: number;
    title: string;
    vectorType: VectorGlyphType;
    svgPath?: string;
    label?: string;
    color: string;
  }
>;

export const vectorShapeProps: RecordProps<TLVectorShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  vectorType: T.string as any,
  svgPath: T.optional(T.string),
  label: T.optional(T.string),
  color: T.string,
};

const COLOR_MAP: Record<string, { stroke: string; text: string; bg: string }> = {
  'light-blue': { stroke: '#38bdf8', text: '#bae6fd', bg: 'rgba(56, 189, 248, 0.08)' },
  'light-violet': { stroke: '#c084fc', text: '#e9d5ff', bg: 'rgba(192, 132, 252, 0.08)' },
  'light-green': { stroke: '#4ade80', text: '#bbf7d0', bg: 'rgba(74, 222, 128, 0.08)' },
  yellow: { stroke: '#facc15', text: '#fef08a', bg: 'rgba(250, 204, 21, 0.08)' },
  orange: { stroke: '#fb923c', text: '#fed7aa', bg: 'rgba(251, 146, 60, 0.08)' },
  red: { stroke: '#f87171', text: '#fecaca', bg: 'rgba(248, 113, 113, 0.08)' },
  grey: { stroke: '#94a3b8', text: '#e2e8f0', bg: 'rgba(148, 163, 184, 0.08)' },
};

function VectorComponent({
  shape,
}: {
  shape: TLVectorShape;
  onUpdate: (updates: Partial<TLVectorShape['props']>) => void;
}) {
  const { w, h, title, vectorType, svgPath, label, color } = shape.props;
  const theme = COLOR_MAP[color] || COLOR_MAP['light-violet'];

  const typeIcon = useMemo(() => {
    switch (vectorType) {
      case 'database':
        return <Database className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
      case 'cloud':
        return <Cloud className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
      case 'decision':
        return <Diamond className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
      case 'service':
        return <Cpu className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
      case 'queue':
        return <Layers className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
      default:
        return <Box className="h-4 w-4" style={{ color: theme.stroke }} strokeWidth={1.5} />;
    }
  }, [vectorType, theme.stroke]);

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col antialiased"
      style={{
        width: w,
        height: h,
        border: '1px solid rgba(255, 255, 255, 0.10)',
        boxShadow: '0 20px 50px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.10)',
        backgroundColor: 'rgba(18, 18, 24, 0.82)',
      }}
    >
      {/* Drag & Title Header */}
      <div
        className="flex h-10 w-full shrink-0 items-center justify-between px-3 select-none cursor-grab active:cursor-grabbing liquid-glass-header"
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          {typeIcon}
          <span className="truncate text-xs font-semibold tracking-wide text-white" title={title}>
            {title || `${vectorType.toUpperCase()} Glyph`}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-mono tabular-nums uppercase tracking-wider font-semibold bg-white/5 border border-white/10 text-slate-300"
          >
            {vectorType}
          </span>
        </div>

        <div className="text-slate-500 hover:text-slate-300 p-1">
          <GripHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </div>
      </div>

      {/* SVG Diagram Canvas */}
      <div
        className="relative flex-1 w-full p-4 flex flex-col items-center justify-center overflow-hidden"
        onPointerDown={smartStopPropagation}
      >
        {/* Render Vector Geometry */}
        <div className="w-full flex-1 flex items-center justify-center">
          {vectorType === 'database' ? (
            <svg viewBox="0 0 100 80" className="h-20 w-24 overflow-visible" fill="none">
              <ellipse cx="50" cy="18" rx="40" ry="12" fill={theme.bg} stroke={theme.stroke} strokeWidth="2.5" />
              <path d="M10 18v44c0 6.6 17.9 12 40 12s40-5.4 40-12V18" stroke={theme.stroke} strokeWidth="2.5" />
              <path d="M10 38c0 6.6 17.9 12 40 12s40-5.4 40-12" stroke={theme.stroke} strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
          ) : vectorType === 'cloud' ? (
            <svg viewBox="0 0 100 65" className="h-20 w-24 overflow-visible" fill="none">
              <path
                d="M25 55h52c11 0 20-8 20-18 0-9-7-16-16-17-1-12-11-20-23-20-10 0-18 6-21 14-3-2-7-3-11-3-10 0-17 7-17 16 0 2 0 4 1 6C4 35 0 42 0 48c0 10 9 17 20 17z"
                fill={theme.bg}
                stroke={theme.stroke}
                strokeWidth="2.5"
              />
            </svg>
          ) : vectorType === 'decision' ? (
            <svg viewBox="0 0 90 90" className="h-20 w-20 overflow-visible" fill="none">
              <polygon points="45,5 85,45 45,85 5,45" fill={theme.bg} stroke={theme.stroke} strokeWidth="2.5" />
            </svg>
          ) : vectorType === 'service' ? (
            <svg viewBox="0 0 90 90" className="h-20 w-20 overflow-visible" fill="none">
              <polygon points="45,5 80,25 80,65 45,85 10,65 10,25" fill={theme.bg} stroke={theme.stroke} strokeWidth="2.5" />
            </svg>
          ) : vectorType === 'queue' ? (
            <svg viewBox="0 0 100 60" className="h-16 w-24 overflow-visible" fill="none">
              <rect x="10" y="10" width="80" height="40" rx="6" fill={theme.bg} stroke={theme.stroke} strokeWidth="2.5" />
              <line x1="30" y1="10" x2="30" y2="50" stroke={theme.stroke} strokeWidth="2" />
              <line x1="50" y1="10" x2="50" y2="50" stroke={theme.stroke} strokeWidth="2" />
              <line x1="70" y1="10" x2="70" y2="50" stroke={theme.stroke} strokeWidth="2" />
            </svg>
          ) : svgPath ? (
            <svg viewBox="0 0 100 100" className="h-20 w-20 overflow-visible" fill="none">
              <path d={svgPath} fill={theme.bg} stroke={theme.stroke} strokeWidth="2.5" />
            </svg>
          ) : (
            <Box className="h-16 w-16" style={{ color: theme.stroke }} />
          )}
        </div>

        {/* Semantic Label */}
        {label && (
          <div className="mt-2 text-center">
            <p className="text-xs font-semibold text-slate-200 truncate">{label}</p>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export class VectorShapeUtil extends BaseBoxShapeUtil<TLVectorShape> {
  static override type = 'vector_shape' as const;
  static override props = vectorShapeProps;

  override getDefaultProps(): TLVectorShape['props'] {
    return {
      w: 240,
      h: 180,
      title: 'Database Component',
      vectorType: 'database',
      color: 'light-blue',
      label: 'Primary Replica',
    };
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return false;
  }

  override onResize(shape: TLVectorShape, info: TLResizeInfo<TLVectorShape>) {
    return {
      props: {
        w: Math.max(160, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(120, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override component(shape: TLVectorShape) {
    const onUpdate = (updates: Partial<TLVectorShape['props']>) => {
      this.editor.updateShape<TLVectorShape>({
        id: shape.id,
        type: 'vector_shape',
        props: {
          ...shape.props,
          ...updates,
        },
      });
    };

    return <VectorComponent shape={shape} onUpdate={onUpdate} />;
  }

  override indicator(shape: TLVectorShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}
