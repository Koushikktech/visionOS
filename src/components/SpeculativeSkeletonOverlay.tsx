'use client';

import { GenerationGlow } from './GenerationGlow';
import { AIOrb } from './AIOrb';


import React, { useState, useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { SpeculativeSkeletonBounds } from '../types/spatial';

interface SpeculativeSkeletonOverlayProps {
  editor: Editor | null;
  skeletons: SpeculativeSkeletonBounds[];
}

export const SpeculativeSkeletonOverlay: React.FC<SpeculativeSkeletonOverlayProps> = ({
  editor,
  skeletons,
}) => {
  const [, setTick] = useState(0);
  const reduceMotion = useReducedMotion() ?? false;

  // Subscribe only while visible and only to camera/page-state records.
  useEffect(() => {
    if (!editor || skeletons.length === 0) return;
    const unlisten = editor.store.listen(({ changes }) => {
      const viewportRecords = [
        ...Object.values(changes.added),
        ...Object.values(changes.removed),
        ...Object.values(changes.updated).map(([, next]) => next),
      ];
      if (viewportRecords.some((record) =>
        record.typeName === 'camera' ||
        record.typeName === 'instance_page_state' ||
        record.typeName === 'instance'
      )) {
        setTick((tick) => tick + 1);
      }
    }, { scope: 'session' });
    return () => unlisten();
  }, [editor, skeletons.length]);

  if (!editor || skeletons.length === 0) return null;

  return (
    <div className="studio-canvas-chrome pointer-events-none fixed inset-0 z-[250] overflow-hidden" data-canvas-chrome="speculative">
      <AnimatePresence>
        {skeletons.map((skel) => {
          const screenPos = editor.pageToScreen({ x: skel.x, y: skel.y });
          const zoom = editor.getZoomLevel();
          const screenW = skel.w * zoom;
          const screenH = skel.h * zoom;
          const skeletonCard = (
            <div className="studio-speculative-card relative w-full h-full rounded-2xl border overflow-hidden antialiased">
              <GenerationGlow active radius={16} />
              <div
                style={{
                  width: `${skel.w}px`,
                  height: `${skel.h}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  WebkitTextSizeAdjust: '100%',
                  textSizeAdjust: '100%',
                }}
                className="absolute top-0 left-0 flex flex-col justify-between p-6 select-none"
              >
                <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                  <AIOrb active size={64} className="studio-skeleton-mark h-10 w-10" strokeWidth={1.5} aria-hidden="true" />
                  <span className="text-sm font-medium tracking-wide font-sans">
                    {skel.title || 'Creating…'}
                  </span>
                </div>
                <div className="w-full space-y-2.5" aria-hidden="true">
                  <div className="studio-skeleton-line h-2.5 w-3/4 rounded-full" />
                  <div className="studio-skeleton-line h-2 w-1/2 rounded-full" />
                </div>
              </div>
            </div>
          );

          return (
            <motion.div
              key={skel.id}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                left: `${screenPos.x}px`,
                top: `${screenPos.y}px`,
                width: `${screenW}px`,
                height: `${screenH}px`,
              }}
            >
              {skeletonCard}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
