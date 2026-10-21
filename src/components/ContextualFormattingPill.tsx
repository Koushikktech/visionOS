'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tldraw/tldraw';
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  DefaultTextAlignStyle,
} from '@tldraw/tldraw';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  CircleDot,
  Square,
  Grid3X3,
  CircleOff,
  Sparkles,
  Layers,
  Send,
  Loader2,
  CornerDownLeft,
  ChevronDown,
  Copy,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  Palette,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { BorderBeam } from 'border-beam';
import { APPLE_SPRING, mapHexToTldrawColor } from '../lib/tokens';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';
import type { useSpatialAI } from '../hooks/useSpatialAI';

/**
 * 8 Iconic Apple color dots mapped to tldraw DefaultColorStyle
 */
export const HUD_COLOR_SWATCHES = [
  { id: 'swatch-white', tldrawColor: 'white', label: 'White', hex: '#f8fafc' },
  { id: 'swatch-grey', tldrawColor: 'grey', label: 'Slate Grey', hex: '#94a3b8' },
  { id: 'swatch-black', tldrawColor: 'black', label: 'Obsidian Black', hex: '#1e293b' },
  { id: 'swatch-blue', tldrawColor: 'blue', label: 'Cobalt Blue', hex: '#3b82f6' },
  { id: 'swatch-violet', tldrawColor: 'violet', label: 'Deep Violet', hex: '#8b5cf6' },
  { id: 'swatch-green', tldrawColor: 'green', label: 'Emerald Green', hex: '#22c55e' },
  { id: 'swatch-yellow', tldrawColor: 'yellow', label: 'Amber Yellow', hex: '#facc15' },
  { id: 'swatch-red', tldrawColor: 'red', label: 'Crimson Red', hex: '#ef4444' },
] as const;

export interface ContextualFormattingPillProps {
  editor: Editor | null;
  spatial?: ReturnType<typeof useSpatialWorker>;
  ai?: ReturnType<typeof useSpatialAI>;
}

export const ContextualFormattingPill: React.FC<ContextualFormattingPillProps> = ({
  editor,
  spatial,
  ai,
}) => {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [selectedColor, setSelectedColor] = useState<string>('black');
  const [selectedSize, setSelectedSize] = useState<string>('m');
  const [selectedFill, setSelectedFill] = useState<string>('none');
  const [selectedAlign, setSelectedAlign] = useState<string>('start');
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [customHex, setCustomHex] = useState<string>('#3b82f6');

  // Sub-popovers state
  const [activePopover, setActivePopover] = useState<'color' | 'size' | 'fill' | 'align' | 'more' | null>(null);
  const [showAIActions, setShowAIActions] = useState<boolean>(false);
  const [promptText, setPromptText] = useState<string>('');
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const prevSelectedIdsRef = useRef<string[]>([]);

  const closePopovers = useCallback(() => {
    setActivePopover(null);
  }, []);

  // Track selection bounding box in screen coordinates
  useEffect(() => {
    if (!editor) return;

    const updatePosition = () => {
      const selectedIds = editor.getSelectedShapeIds();
      setSelectedCount(selectedIds.length);

      if (selectedIds.length === 0) {
        setMenuPosition(null);
        closePopovers();
        return;
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const id of selectedIds) {
        const bounds = editor.getShapePageBounds(id);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      }

      if (minX === Infinity) {
        setMenuPosition(null);
        return;
      }

      const topCenterPage = { x: (minX + maxX) / 2, y: minY };
      const topCenterScreen = editor.pageToScreen(topCenterPage);
      const bottomCenterPage = { x: (minX + maxX) / 2, y: maxY };
      const bottomCenterScreen = editor.pageToScreen(bottomCenterPage);

      const shapes = editor.getSelectedShapes();
      const isTextOnly = shapes.length > 0 && shapes.every((s) => s.type === 'text');
      const hasDrawings = shapes.some((s) => s.type === 'draw');
      const isMultiShapeSketch =
        shapes.length >= 2 && shapes.some((s) => s.type === 'draw' || s.type === 'geo');
      const canMakeReal = hasDrawings || isMultiShapeSketch;
      // Dynamic pill width estimate based on active tool set
      const estimatedHalfWidth = canMakeReal ? 240 : isTextOnly ? 170 : 190;

      const screenX = Math.max(
        estimatedHalfWidth + 16,
        Math.min(window.innerWidth - estimatedHalfWidth - 16, topCenterScreen.x)
      );

      // Clean Apple Clearance Positioning:
      const spaceAbove = topCenterScreen.y;
      const spaceBelow = window.innerHeight - bottomCenterScreen.y;

      // When there is ample room above (at least 72px for pill, 180px for popovers)
      // OR more space above than below, position strictly ABOVE the shape with a 14px air gap.
      // Otherwise, flip strictly BELOW the shape with a 14px air gap.
      // In either orientation, the pill NEVER touches or covers the shape!
      if (spaceAbove >= 72 && (spaceAbove >= 180 || spaceAbove >= spaceBelow)) {
        const screenY = topCenterScreen.y - 14;
        setMenuPosition({ x: screenX, y: screenY });
        setPlacement('top');
      } else {
        const screenY = bottomCenterScreen.y + 14;
        setMenuPosition({ x: screenX, y: screenY });
        setPlacement('bottom');
      }

      // Reset dismissed state when the set of selected shapes changes
      const prevIdsStr = prevSelectedIdsRef.current.sort().join(',');
      const currIdsStr = [...selectedIds].sort().join(',');
      if (prevIdsStr !== currIdsStr) {
        prevSelectedIdsRef.current = [...selectedIds];
        setIsDismissed(false);
      }

      // Read current styles for selected shapes
      try {
        const sharedStyles = editor.getSharedStyles();
        const color = sharedStyles.getAsKnownValue(DefaultColorStyle);
        if (color) setSelectedColor(color);
        const size = sharedStyles.getAsKnownValue(DefaultSizeStyle);
        if (size) setSelectedSize(size);
        const fill = sharedStyles.getAsKnownValue(DefaultFillStyle);
        if (fill) setSelectedFill(fill);
        const align = sharedStyles.getAsKnownValue(DefaultTextAlignStyle);
        if (align) setSelectedAlign(align);

        const selectedShapes = editor.getSelectedShapes();
        setIsLocked(selectedShapes.length > 0 && selectedShapes.every((s) => s.isLocked));
      } catch {
        // Safe fallback
      }
    };

    const unsubscribe = editor.store.listen(() => {
      updatePosition();
    });

    updatePosition();

    return () => {
      unsubscribe();
    };
  }, [editor, closePopovers]);

  // Click outside listener with capture: true & editor.on('event')
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopovers();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('click', handlePointerDown, { capture: true });

    const handleEditorEvent = (info: any) => {
      if (info.name === 'pointer_down') {
        closePopovers();
      }
    };

    if (editor) {
      editor.on('event', handleEditorEvent);
    }

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('click', handlePointerDown, { capture: true });
      if (editor) {
        editor.off('event', handleEditorEvent);
      }
    };
  }, [editor, closePopovers]);

  // Color change handler
  const handleColorChange = useCallback(
    (color: (typeof DefaultColorStyle.values)[number]) => {
      if (!editor) return;
      try {
        editor.setStyleForSelectedShapes(DefaultColorStyle, color);
        setSelectedColor(color);
      } catch {}
      closePopovers();
    },
    [editor, closePopovers]
  );

  // Custom hex color picker handler
  const handleCustomColor = useCallback(
    (hex: string) => {
      setCustomHex(hex);
      if (!editor) return;
      try {
        // Update custom shapes
        const selectedShapes = editor.getSelectedShapes();
        for (const shape of selectedShapes) {
          if (['rich_card', 'code_card', 'document', 'slide_deck', 'artifact'].includes(shape.type)) {
            editor.updateShape({
              id: shape.id,
              type: shape.type,
              props: { ...shape.props, color: hex },
            });
          }
        }
        // Map to nearest tldraw style for native shapes
        const mapped = mapHexToTldrawColor(hex);
        editor.setStyleForSelectedShapes(DefaultColorStyle, mapped as any);
        setSelectedColor(mapped);
      } catch {}
    },
    [editor]
  );

  // Size change handler
  const handleSizeChange = useCallback(
    (size: (typeof DefaultSizeStyle.values)[number]) => {
      if (!editor) return;
      try {
        editor.setStyleForSelectedShapes(DefaultSizeStyle, size);
        setSelectedSize(size);
      } catch {}
      closePopovers();
    },
    [editor, closePopovers]
  );

  // Fill change handler
  const handleFillChange = useCallback(
    (fill: (typeof DefaultFillStyle.values)[number]) => {
      if (!editor) return;
      try {
        editor.setStyleForSelectedShapes(DefaultFillStyle, fill);
        setSelectedFill(fill);
      } catch {}
      closePopovers();
    },
    [editor, closePopovers]
  );

  // Align change handler
  const handleAlignChange = useCallback(
    (align: (typeof DefaultTextAlignStyle.values)[number]) => {
      if (!editor) return;
      try {
        editor.setStyleForSelectedShapes(DefaultTextAlignStyle, align);
        setSelectedAlign(align);
      } catch {}
      closePopovers();
    },
    [editor, closePopovers]
  );

  // Duplicate handler
  const handleDuplicate = useCallback(() => {
    if (!editor) return;
    try {
      editor.duplicateShapes(editor.getSelectedShapeIds());
    } catch {}
    closePopovers();
  }, [editor, closePopovers]);

  // Lock / Unlock handler
  const handleToggleLock = useCallback(() => {
    if (!editor) return;
    try {
      editor.toggleLock(editor.getSelectedShapeIds());
      setIsLocked((prev) => !prev);
    } catch {}
    closePopovers();
  }, [editor, closePopovers]);

  // Bring to Front
  const handleBringToFront = useCallback(() => {
    if (!editor) return;
    try {
      editor.bringToFront(editor.getSelectedShapeIds());
    } catch {}
    closePopovers();
  }, [editor, closePopovers]);

  // Send to Back
  const handleSendToBack = useCallback(() => {
    if (!editor) return;
    try {
      editor.sendToBack(editor.getSelectedShapeIds());
    } catch {}
    closePopovers();
  }, [editor, closePopovers]);

  // Delete handler
  const handleDelete = useCallback(() => {
    if (!editor) return;
    try {
      editor.deleteShapes(editor.getSelectedShapeIds());
    } catch {}
    closePopovers();
  }, [editor, closePopovers]);

  // Make Real handler
  const isMakingReal = Boolean(ai?.isGenerating || ai?.isMakingReal || spatial?.isStreaming);

  const handleMakeReal = useCallback(() => {
    if (isMakingReal) return;
    if (ai?.makeReal) {
      ai.makeReal(promptText.trim() || undefined);
    } else if (spatial?.streamAIAction) {
      spatial.streamAIAction('custom', 'Make Real');
    }
  }, [ai, spatial, isMakingReal, promptText]);

  // Submit custom AI prompt
  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = promptText.trim();
    if (!query || isMakingReal) return;

    const lower = query.toLowerCase();
    if (
      lower === 'make real' ||
      lower.startsWith('make real') ||
      lower.includes('turn into live app') ||
      lower.includes('make this real') ||
      lower.includes('convert sketch')
    ) {
      if (ai?.makeReal) {
        ai.makeReal(query);
        setPromptText('');
        return;
      }
    }

    if (ai?.sendMessage) {
      ai.sendMessage(query);
      setPromptText('');
      return;
    }

    if (spatial?.streamAIAction) {
      spatial.streamAIAction('custom', query);
      setPromptText('');
    }
  };

  if (isDismissed || !menuPosition || selectedCount === 0) {
    return null;
  }

  // Hide formatting pill when user is actively using drawing, eraser, or hand tools
  if (editor && editor.getCurrentToolId() !== 'select') {
    return null;
  }

  // When editing or typing text in-situ, completely hide the formatting pill so it never covers the text or cursor!
  if (editor && editor.getEditingShapeId() !== null) {
    return null;
  }

  const selectedShapes = editor ? editor.getSelectedShapes() : [];

  // Interactive window shapes (artifacts, documents, slide decks, media embeds)
  // already have native window titlebar controls. Never spawn an intrusive
  // floating pill that obscures window tabs, headers, or interactive contents!
  const isOnlyComplexWindows =
    selectedShapes.length > 0 &&
    selectedShapes.every((s) =>
      ['artifact', 'document', 'slide_deck', 'media_embed'].includes(s.type)
    );

  if (isOnlyComplexWindows) {
    return null;
  }

  const isOnlyText = selectedShapes.length > 0 && selectedShapes.every((s) => s.type === 'text');
  const hasDrawings = selectedShapes.some((s) => s.type === 'draw');
  const isMultiShapeSketch = selectedShapes.length >= 2 && selectedShapes.some((s) => s.type === 'draw' || s.type === 'geo');
  // Make Real is strictly for drawings and multi-shape diagram sketches (never on solitary text/notes)
  const canMakeReal = hasDrawings || isMultiShapeSketch;
  const supportsFill = selectedShapes.some((s) => s.type === 'geo');
  const supportsAlign = selectedShapes.some((s) => s.type === 'text' || s.type === 'note' || s.type === 'geo');
  const supportsStyling = selectedShapes.some((s) => s.type === 'draw' || s.type === 'geo' || s.type === 'note' || s.type === 'text' || s.type === 'arrow' || s.type === 'rich_card');

  const activeSwatch = HUD_COLOR_SWATCHES.find((s) => s.tldrawColor === selectedColor) || HUD_COLOR_SWATCHES[2];
  // 10px clean gap outside the pill: guarantees popovers NEVER overlap the pill capsule!
  const popoverPlacementClass = placement === 'bottom' ? 'top-[calc(100%+10px)]' : 'bottom-[calc(100%+10px)]';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: `${menuPosition.x}px`,
        top: `${menuPosition.y}px`,
        transform: placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
      className="pointer-events-auto z-[400] flex flex-col items-center select-none"
    >
      <AnimatePresence>
        <motion.div
          key="contextual-formatting-pill"
          initial={{ opacity: 0, y: placement === 'bottom' ? -8 : 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: placement === 'bottom' ? -8 : 8, scale: 0.95 }}
          transition={APPLE_SPRING}
          className="flex flex-col items-center gap-1.5"
        >
          {/* Main Compact Floating Glass Capsule */}
          <div className="flex flex-col gap-1.5 rounded-[18px] liquid-glass-popover p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.16)] border border-white/14 backdrop-blur-3xl">
            {/* Primary Quick Formatting Bar */}
            <div className="flex items-center gap-1">
              {/* Selection Count Badge (shown only for multi-selection) */}
              {selectedCount > 1 && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-200 border border-white/10 tabular-nums">
                    {selectedCount}
                  </span>
                  <div className="h-4 w-[1px] bg-white/10 ml-0.5" />
                </div>
              )}

              {supportsStyling && (
                <>
                  {/* 1. Color Picker Dropdown Trigger */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`Color: ${activeSwatch.label}`}
                      onClick={() => setActivePopover(activePopover === 'color' ? null : 'color')}
                      className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl hover:bg-white/10 transition-all active:scale-[0.96] gap-1"
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-white/30 shadow-sm"
                        style={{ backgroundColor: activeSwatch.hex }}
                      />
                    </button>

                    {/* Color Swatches Popover */}
                    <AnimatePresence>
                      {activePopover === 'color' && (
                        <div className={`absolute left-1/2 -translate-x-1/2 ${popoverPlacementClass} z-50`}>
                          <motion.div
                            initial={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                            transition={APPLE_SPRING}
                            className="p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl w-[184px]"
                          >
                        <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-white/10 px-1">
                          <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">
                            {activeSwatch.label}
                          </span>
                          <label
                            aria-label="Pick custom color spectrum"
                            className="flex items-center gap-1.5 text-[10px] font-medium text-white/80 hover:text-white cursor-pointer px-1.5 py-0.5 rounded-lg hover:bg-white/10 transition-all active:scale-[0.96]"
                          >
                            <div
                              className="h-3.5 w-3.5 rounded-full border border-white/30 shadow-sm"
                              style={{
                                background:
                                  'conic-gradient(from 180deg at 50% 50%, #ef4444 0deg, #f59e0b 60deg, #10b981 120deg, #06b6d4 180deg, #3b82f6 240deg, #8b5cf6 300deg, #ef4444 360deg)',
                              }}
                            />
                            <span>Spectrum</span>
                            <input
                              ref={colorInputRef}
                              type="color"
                              value={customHex}
                              onChange={(e) => handleCustomColor(e.target.value)}
                              className="sr-only"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Color Swatches">
                          {HUD_COLOR_SWATCHES.map((swatch) => (
                            <button
                              key={swatch.id}
                              type="button"
                              aria-label={swatch.label}
                              onClick={() => handleColorChange(swatch.tldrawColor)}
                              className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] hover:bg-white/10 ${
                                selectedColor === swatch.tldrawColor
                                  ? 'bg-white/15'
                                  : 'opacity-85 hover:opacity-100'
                              }`}
                            >
                              <span
                                className={`h-4 w-4 rounded-full border border-white/20 shadow-sm transition-transform ${
                                  selectedColor === swatch.tldrawColor
                                    ? 'scale-110 ring-2 ring-white/90 ring-offset-2 ring-offset-[#121218]'
                                    : ''
                                }`}
                                style={{ backgroundColor: swatch.hex }}
                              />
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* 2. Stroke / Font Size Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Size: ${selectedSize.toUpperCase()}`}
                  onClick={() => setActivePopover(activePopover === 'size' ? null : 'size')}
                  className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
                >
                  <span>{selectedSize.toUpperCase()}</span>
                </button>

                <AnimatePresence>
                  {activePopover === 'size' && (
                    <div className={`absolute left-1/2 -translate-x-1/2 ${popoverPlacementClass} z-50`}>
                      <motion.div
                        initial={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                        transition={APPLE_SPRING}
                        className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                      >
                        {(['s', 'm', 'l', 'xl'] as const).map((size) => (
                          <button
                            key={size}
                            type="button"
                            aria-label={`Size ${size.toUpperCase()}`}
                            onClick={() => handleSizeChange(size)}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-xs font-semibold transition-all active:scale-[0.96] ${
                              selectedSize === size
                                ? 'bg-white/20 text-white shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {size.toUpperCase()}
                          </button>
                        ))}
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* 3. Fill Style Dropdown (Only for geometric shapes) */}
              {supportsFill && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Fill Style: ${selectedFill}`}
                    onClick={() => setActivePopover(activePopover === 'fill' ? null : 'fill')}
                    className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
                  >
                    {selectedFill === 'none' && <CircleOff className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedFill === 'semi' && <CircleDot className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedFill === 'solid' && <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />}
                    {selectedFill === 'pattern' && <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  </button>

                  <AnimatePresence>
                    {activePopover === 'fill' && (
                      <div className={`absolute left-1/2 -translate-x-1/2 ${popoverPlacementClass} z-50`}>
                        <motion.div
                          initial={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          transition={APPLE_SPRING}
                          className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                        >
                          <button
                            type="button"
                            aria-label="No Fill"
                            onClick={() => handleFillChange('none')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedFill === 'none'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <CircleOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Semi Fill"
                            onClick={() => handleFillChange('semi')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedFill === 'semi'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <CircleDot className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Solid Fill"
                            onClick={() => handleFillChange('solid')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedFill === 'solid'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Pattern Fill"
                            onClick={() => handleFillChange('pattern')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedFill === 'pattern'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 4. Text Align Dropdown (Only for text, note, geo) */}
              {supportsAlign && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Text Align: ${selectedAlign}`}
                    onClick={() => setActivePopover(activePopover === 'align' ? null : 'align')}
                    className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
                  >
                    {selectedAlign === 'start' && <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedAlign === 'middle' && <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedAlign === 'end' && <AlignRight className="h-3.5 w-3.5" strokeWidth={1.5} />}
                  </button>

                  <AnimatePresence>
                    {activePopover === 'align' && (
                      <div className={`absolute left-1/2 -translate-x-1/2 ${popoverPlacementClass} z-50`}>
                        <motion.div
                          initial={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          transition={APPLE_SPRING}
                          className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                        >
                          <button
                            type="button"
                            aria-label="Align Left"
                            onClick={() => handleAlignChange('start')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedAlign === 'start'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Align Center"
                            onClick={() => handleAlignChange('middle')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedAlign === 'middle'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Align Right"
                            onClick={() => handleAlignChange('end')}
                            className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                              selectedAlign === 'end'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}

          {/* 5. More Actions Dropdown (Duplicate, Lock, Z-Order) */}
          <div className="relative">
            <button
              type="button"
              aria-label="More Actions"
              onClick={() => setActivePopover(activePopover === 'more' ? null : 'more')}
              className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
            </button>

            <AnimatePresence>
              {activePopover === 'more' && (
                <div className={`absolute left-1/2 -translate-x-1/2 ${popoverPlacementClass} z-50`}>
                  <motion.div
                    initial={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: placement === 'bottom' ? -6 : 6, scale: 0.95 }}
                    transition={APPLE_SPRING}
                    className="w-48 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl space-y-0.5"
                  >
                    <button
                      type="button"
                      onClick={handleDuplicate}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all min-h-[40px]"
                    >
                      <Copy className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleLock}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all min-h-[40px]"
                    >
                      {isLocked ? (
                        <>
                          <Unlock className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                          <span>Unlock Shape</span>
                        </>
                      ) : (
                        <>
                          <Lock className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                          <span>Lock Shape</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleBringToFront}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all min-h-[40px]"
                    >
                      <ArrowUp className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Bring to Front</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSendToBack}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all min-h-[40px]"
                    >
                      <ArrowDown className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Send to Back</span>
                    </button>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>

          {canMakeReal && (
              <>
                <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

                {/* 6. Make Real CTA - Only for drawings/sketches/shapes, never for existing apps! */}
                <BorderBeam size="pulse-inner" active={isMakingReal} className="rounded-xl">
                  <button
                    type="button"
                    onClick={handleMakeReal}
                    disabled={isMakingReal}
                    aria-label="Make Real: Convert drawing to live interactive app"
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white shadow-md transition-all active:scale-[0.96] min-h-[40px] ${
                      isMakingReal
                        ? 'bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 opacity-90 animate-pulse'
                        : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:brightness-110'
                    }`}
                  >
                    {isMakingReal ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.0} />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" strokeWidth={2.0} />
                    )}
                    <span>Make Real</span>
                  </button>
                </BorderBeam>
              </>
            )}

            {/* 7. AI Prompt Toggle */}
            <button
              type="button"
              aria-label="AI Prompt Actions"
              onClick={() => setShowAIActions(!showAIActions)}
              className={`flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl transition-all active:scale-[0.96] ${
                showAIActions ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* 8. Delete Button */}
            <button
              type="button"
              aria-label="Delete Selected"
              onClick={handleDelete}
              className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-all active:scale-[0.96]"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

            {/* 9. Dismiss Button */}
            <button
              type="button"
              aria-label="Hide formatting menu"
              onClick={() => setIsDismissed(true)}
              className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-[0.96]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
            </div>

          {/* AI Action Command Sub-lane */}
          <AnimatePresence>
            {showAIActions && (
              <motion.form
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={APPLE_SPRING}
                onSubmit={handleCustomSubmit}
                className="flex items-center gap-1.5 pt-1 px-1 border-t border-white/10 overflow-hidden"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Ask AI to modify selection, 'Make Real'..."
                  disabled={isMakingReal}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-400 outline-none focus:border-white/30 transition-all font-sans"
                />
                <button
                  type="submit"
                  disabled={!promptText.trim() || isMakingReal}
                  className="flex items-center justify-center min-w-[40px] min-h-[40px] w-10 h-10 rounded-xl bg-white/15 text-white hover:bg-white/25 disabled:opacity-30 disabled:hover:bg-white/15 transition-all active:scale-[0.96]"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  </div>
);
};

export default ContextualFormattingPill;
