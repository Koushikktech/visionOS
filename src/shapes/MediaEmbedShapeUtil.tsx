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
import React, { useState, useEffect, useMemo } from 'react';
import {
  Video,
  Globe,
  Music,
  ExternalLink,
  GripHorizontal,
  Play,
} from 'lucide-react';
import { smartStopPropagation, isSpacePanHeld } from '../lib/panModifier';

export type TLMediaEmbedShape = TLBaseShape<
  'media_embed',
  {
    w: number;
    h: number;
    title: string;
    url: string;
    mediaType: 'youtube' | 'web' | 'audio';
    color: string;
  }
>;

export const mediaEmbedShapeProps: RecordProps<TLMediaEmbedShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  url: T.string,
  mediaType: T.string as any,
  color: T.string,
};

function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

function MediaEmbedComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLMediaEmbedShape;
  editor?: import('@tldraw/tldraw').Editor;
  onUpdate: (updates: Partial<TLMediaEmbedShape['props']>) => void;
}) {
  const [isSelected, setIsSelected] = useState(false);
  const { w, h, title, mediaType, color } = shape.props;
  const url = /^https?:\/\//i.test(shape.props.url) ? shape.props.url : '';

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

  const youtubeVideoId = useMemo(() => {
    if (
      mediaType === 'youtube' ||
      url.includes('youtube.com') ||
      url.includes('youtu.be')
    ) {
      return extractYouTubeVideoId(url);
    }
    return null;
  }, [url, mediaType]);

  const effectiveType = youtubeVideoId ? 'youtube' : mediaType || 'web';

  const typeIcon = useMemo(() => {
    switch (effectiveType) {
      case 'youtube':
        return <Video className="h-3.5 w-3.5 text-red-400 shrink-0" />;
      case 'audio':
        return <Music className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
      default:
        return <Globe className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
    }
  }, [effectiveType]);

  return (
    <HTMLContainer
      id={shape.id}
      className="pointer-events-auto overflow-hidden rounded-2xl liquid-glass-card transition-all flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Drag & Control Header */}
      <div className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          {typeIcon}
          <span
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title || url}
          >
            {title ||
              (effectiveType === 'youtube' ? 'YouTube Media' : 'Web Resource')}
          </span>
          <span className="shrink-0 rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400 uppercase tracking-wider">
            {effectiveType}
          </span>
        </div>

        <div
          className="flex items-center gap-1 shrink-0"
          onPointerDown={stopEventPropagation}
        >
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open link in new tab"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            </a>
          )}
          <div className="text-slate-500 hover:text-slate-300 p-1">
            <GripHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="relative flex-1 w-full bg-[#0b0e1c] overflow-hidden flex items-center justify-center"
        onPointerDown={isSelected ? smartStopPropagation : undefined}
      >
        {/* Transparent Selection Shield when unselected: prevents iframe from stealing pointer events so 1-click select & drag work natively */}
        {!isSelected && (
          <div className="absolute inset-0 z-10 bg-transparent cursor-pointer" />
        )}
        {effectiveType === 'youtube' && youtubeVideoId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}?autoplay=0&rel=0`}
            title={title || 'YouTube video'}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : effectiveType === 'audio' ? (
          <div className="flex flex-col items-center justify-center gap-4 p-6 w-full text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg animate-pulse">
              <Play className="h-7 w-7 ml-0.5" />
            </div>
            <div className="max-w-[80%]">
              <h4 className="text-xs font-semibold text-slate-200 truncate">
                {title || 'Audio Stream'}
              </h4>
              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                {url}
              </p>
            </div>
            <audio
              controls
              src={url}
              className="w-full max-w-sm mt-2 rounded-lg opacity-90"
            >
              Your browser does not support audio playback.
            </audio>
          </div>
        ) : (
          <div className="relative w-full h-full flex flex-col">
            <iframe
              src={url}
              title={title || 'Web Preview'}
              sandbox="allow-scripts allow-popups"
              className="w-full h-full border-0 bg-white"
            />
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export class MediaEmbedShapeUtil extends BaseBoxShapeUtil<TLMediaEmbedShape> {
  static override type = 'media_embed' as const;
  static override props = mediaEmbedShapeProps;

  override getDefaultProps(): TLMediaEmbedShape['props'] {
    return {
      w: 480,
      h: 320,
      title: 'Media Player',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      mediaType: 'youtube',
      color: 'light-blue',
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

  override onResize(
    shape: TLMediaEmbedShape,
    info: TLResizeInfo<TLMediaEmbedShape>
  ) {
    return {
      props: {
        w: Math.max(280, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(180, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override component(shape: TLMediaEmbedShape) {
    const onUpdate = (updates: Partial<TLMediaEmbedShape['props']>) => {
      this.editor.updateShape<TLMediaEmbedShape>({
        id: shape.id,
        type: 'media_embed',
        props: {
          ...shape.props,
          ...updates,
        },
      });
    };

    return <MediaEmbedComponent shape={shape} editor={this.editor} onUpdate={onUpdate} />;
  }

  override indicator(shape: TLMediaEmbedShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}
