'use client';

import React, { useState, useEffect } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { motion, AnimatePresence } from 'framer-motion';
import { ThinkingOrb } from 'thinking-orbs';
import { BorderBeam } from 'border-beam';
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

  // Re-render overlay when camera zooms/pans
  useEffect(() => {
    if (!editor) return;
    const unlisten = editor.store.listen(() => {
      setTick((t) => t + 1);
    });
    return () => unlisten();
  }, [editor]);

  if (!editor || skeletons.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[250] overflow-hidden">
      <AnimatePresence>
        {skeletons.map((skel) => {
          const screenPos = editor.pageToScreen({ x: skel.x, y: skel.y });
          const zoom = editor.getZoomLevel();
          const screenW = skel.w * zoom;
          const screenH = skel.h * zoom;

          return (
            <motion.div
              key={skel.id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                left: `${screenPos.x}px`,
                top: `${screenPos.y}px`,
                width: `${screenW}px`,
                height: `${screenH}px`,
              }}
            >
              <BorderBeam size="md" active={true} className="w-full h-full">
                <div className="relative w-full h-full rounded-2xl border border-white/10 bg-[#121218]/90 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden antialiased">
                  {/* Proportional Zoom Canvas Container: scales in exact lockstep with canvas zoom */}
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
                    {/* Centered ThinkingOrb and synthesis animation */}
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-4">
                      <ThinkingOrb size={64} state="shaping" theme="dark" />
                      <span className="text-sm font-medium tracking-wide text-white/80 font-sans">
                        {skel.title || 'Synthesizing Live App...'}
                      </span>
                    </div>

                    {/* Tactile Wireframe placeholder lines */}
                    <div className="w-full space-y-2.5">
                      <div className="h-2.5 w-3/4 rounded-full bg-white/10" />
                      <div className="h-2 w-1/2 rounded-full bg-white/5" />
                    </div>
                  </div>
                </div>
              </BorderBeam>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
