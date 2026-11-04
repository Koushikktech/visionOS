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
  Play,
  Hand,
} from 'lucide-react';
import { smartStopPropagation } from '../lib/panModifier';
import { resolveMediaEmbedPlan } from '../lib/mediaEmbed';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';

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

function MediaEmbedComponent({
  shape,
  editor,
}: {
  shape: TLMediaEmbedShape;
  editor?: import('@tldraw/tldraw').Editor;
}) {
  const [isSelected, setIsSelected] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const { w, h, title, mediaType } = shape.props;
  const plan = useMemo(
    () => resolveMediaEmbedPlan(shape.props.url, mediaType),
    [shape.props.url, mediaType]
  );
  const url = plan.url?.href ?? '';

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
    if (!isSelected) setIsInteracting(false);
  }, [isSelected]);

  useEffect(() => setAudioFailed(false), [url]);

  const effectiveType = plan.kind === 'youtube' ? 'youtube' : mediaType || 'web';

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
      className="studio-native-window studio-native-media-window pointer-events-auto overflow-hidden rounded-2xl transition-colors flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Drag & Control Header */}
      <div data-window-header="media" className="flex h-11 w-full shrink-0 items-center justify-between liquid-glass-header px-3.5 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          {typeIcon}
          <span
            data-window-title
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

        <ArtifactHeaderActions
          menuLabel="Media actions"
          primaryAction={plan.kind === 'youtube' || plan.kind === 'audio'
            ? {
                label: isInteracting ? 'Return to canvas' : 'Interact',
                icon: isInteracting ? <Hand /> : <Play />,
                pressed: isInteracting,
                onSelect: () => {
                  if (!isInteracting) editor?.setSelectedShapes([shape.id]);
                  setIsInteracting((current) => !current);
                },
              }
            : url
              ? { label: 'Open link in new tab', icon: <ExternalLink />, href: url, target: '_blank', rel: 'noopener noreferrer' }
              : undefined}
          actions={url && (plan.kind === 'youtube' || plan.kind === 'audio')
            ? [{ id: 'open-link', label: 'Open link in new tab', icon: <ExternalLink />, href: url, target: '_blank', rel: 'noopener noreferrer' }]
            : []}
        />
      </div>

      {/* Main Content Area */}
      <div
        className="relative flex-1 w-full bg-[#0b0e1c] overflow-hidden flex items-center justify-center"
        onPointerDown={isSelected && isInteracting ? smartStopPropagation : undefined}
      >
        {plan.kind === 'youtube' && isInteracting && isSelected ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${plan.videoId}?autoplay=0&rel=0`}
            title={title || 'YouTube video'}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : plan.kind === 'audio' && isInteracting && isSelected ? (
          <div className="flex flex-col items-center justify-center gap-4 p-6 w-full text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg">
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
            {audioFailed ? (
              <p role="status" className="text-xs text-amber-200">
                Audio playback failed here. Use Open link above to try the source directly.
              </p>
            ) : (
              <audio
                controls
                src={url}
                onError={() => setAudioFailed(true)}
                className="w-full max-w-sm mt-2 rounded-lg opacity-90"
              >
                Your browser does not support audio playback.
              </audio>
            )}
          </div>
        ) : plan.kind === 'unsupported' ? (
          <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
            <Globe className="h-8 w-8 text-sky-300" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-slate-100">Web preview unavailable</h4>
            <p className="text-xs leading-relaxed text-slate-300">
              This site is not a supported embedded player. Open the link above to view it.
            </p>
            {!url && (
              <p role="status" className="text-xs text-amber-200">
                This address is not a safe HTTP or HTTPS link.
              </p>
            )}
          </div>
        ) : (
          <div className="flex max-w-md flex-col items-center gap-3 p-6 text-center">
            <Video className="h-8 w-8 text-red-300" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-slate-100">{title || 'YouTube video'}</h4>
            <p className="text-xs leading-relaxed text-slate-300">
              Choose Interact to load the YouTube player, or open the source link above.
            </p>
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
    return <MediaEmbedComponent shape={shape} editor={this.editor} />;
  }

  override indicator(shape: TLMediaEmbedShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}
