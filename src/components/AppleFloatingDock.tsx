'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Editor, TLShape, TLShapePartial } from '@tldraw/tldraw';
import {
  createShapeId,
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  DefaultTextAlignStyle,
  GeoShapeGeoStyle,
} from '@tldraw/tldraw';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MousePointer2,
  Hand,
  Pencil,
  Type,
  StickyNote,
  Square,
  Circle,
  Triangle,
  Diamond,
  Star,
  Layers,
  ArrowUpRight,
  Eraser,
  Trash2,
  FileText,
  Code2,
  BookOpen,
  Presentation,
  AppWindow,
  Check,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronUp,
  X,
} from 'lucide-react';
import { APPLE_SPRING, mapHexToTldrawColor } from '../lib/tokens';
import { resolveStyleTargets } from '../lib/selectionCapabilities';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import { getFloatingViewportBounds, placeFloatingPopover } from '../hooks/viewportGeometry';
import './canvas-chrome.css';

export const FLOATING_DOCK_TOOLS = [
  'select',
  'hand',
  'draw',
  'text',
  'note',
  'geo',
  'arrow',
  'eraser',
  'rich_card',
  'clear',
] as const;

export type FloatingDockToolId = (typeof FLOATING_DOCK_TOOLS)[number];

export interface AppleFloatingDockProps {
  editor: Editor | null;
}

// Curated 9 Apple-grade color swatches (+ 1 custom spectrum picker = 10 items in a 5x2 grid)
export const DOCK_SWATCHES = [
  { id: 'black', tldrawColor: 'black', hex: '#1e293b', label: 'Obsidian' },
  { id: 'grey', tldrawColor: 'grey', hex: '#94a3b8', label: 'Slate' },
  { id: 'blue', tldrawColor: 'blue', hex: '#3b82f6', label: 'Blue' },
  { id: 'violet', tldrawColor: 'violet', hex: '#8b5cf6', label: 'Violet' },
  { id: 'green', tldrawColor: 'green', hex: '#22c55e', label: 'Emerald' },
  { id: 'yellow', tldrawColor: 'yellow', hex: '#facc15', label: 'Amber' },
  { id: 'orange', tldrawColor: 'orange', hex: '#fb923c', label: 'Orange' },
  { id: 'red', tldrawColor: 'red', hex: '#ef4444', label: 'Coral' },
  { id: 'white', tldrawColor: 'white', hex: '#f8fafc', label: 'White' },
] as const;

export const SIZES = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
] as const;

export const FILLS = [
  { id: 'none', label: 'Outline' },
  { id: 'semi', label: 'Glass' },
  { id: 'solid', label: 'Solid' },
  { id: 'pattern', label: 'Pattern' },
] as const;

function DockPopoverPortal({
  anchorRef,
  returnFocusRef,
  popoverRef,
  onClose,
  className,
  label,
  role = 'menu',
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  className: string;
  label: string;
  role?: 'menu' | 'dialog';
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const viewport = useVisibleViewport();
  const [position, setPosition] = useState<{ left: number; top: number; ready: boolean }>({
    left: 0,
    top: 0,
    ready: false,
  });

  useLayoutEffect(() => {
    const measure = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const menu = contentRef.current;
      if (!anchor || !menu) return;
      const bounds = getFloatingViewportBounds(viewport);
      const placement = placeFloatingPopover(
        { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom },
        { width: menu.offsetWidth, height: Math.min(menu.scrollHeight, bounds.maxHeight) },
        viewport
      );
      setPosition({ ...placement, ready: true });
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined' && contentRef.current
      ? new ResizeObserver(measure)
      : null;
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [anchorRef, viewport]);

  useEffect(() => {
    const menu = contentRef.current;
    if (!menu) return;
    const focusable = () => Array.from(menu.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter((item) => {
      // Exclude hidden controls, while retaining laid-out items that may sit
      // outside the current scroll viewport and can be revealed by focus.
      if (item.tabIndex < 0 || item.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
      if (item.getClientRects().length === 0) return false;
      const style = window.getComputedStyle(item);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    });
    let frame: number | null = requestAnimationFrame(() => {
      frame = null;
      const activeModal = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (menu.contains(document.activeElement) || (activeModal && !menu.contains(activeModal))) return;
      focusable()[0]?.focus();
    });
    const cancelPendingAutofocus = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      cancelPendingAutofocus();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        returnFocusRef.current?.focus();
        return;
      }
      if (role === 'menu') {
        const items = focusable();
        const index = items.indexOf(document.activeElement as HTMLElement);
        let nextIndex: number | null = null;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          nextIndex = (index + 1 + items.length) % items.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          nextIndex = (index - 1 + items.length) % items.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = items.length - 1;
        }
        if (nextIndex !== null && items.length > 0) {
          event.preventDefault();
          items[nextIndex]?.focus();
          return;
        }
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        menu.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === items.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    menu.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', cancelPendingAutofocus, true);
    return () => {
      cancelPendingAutofocus();
      menu.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', cancelPendingAutofocus, true);
    };
  }, [onClose, returnFocusRef]);

  if (typeof document === 'undefined') return null;
  const bounds = getFloatingViewportBounds(viewport);
  const setMenuRef = (node: HTMLDivElement | null) => {
    contentRef.current = node;
    (popoverRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return createPortal(
    <motion.div
      ref={setMenuRef}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: position.ready ? 1 : 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={APPLE_SPRING}
      role={role}
      aria-label={label}
      tabIndex={-1}
      data-dock-popover
      className={`studio-canvas-chrome ${className}`}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        maxWidth: bounds.maxWidth,
        maxHeight: bounds.maxHeight,
        overflowY: 'auto',
        overflowX: 'hidden',
        visibility: position.ready ? 'visible' : 'hidden',
        zIndex: 500,
      }}
    >
      {children}
    </motion.div>,
    document.body
  );
}

function getHexForColorName(colorName: string, fallbackHex: string): string {
  const match = DOCK_SWATCHES.find((s) => s.tldrawColor === colorName);
  return match ? match.hex : fallbackHex;
}

export const AppleFloatingDock: React.FC<AppleFloatingDockProps> = ({ editor }) => {
  const [activeTool, setActiveTool] = useState<string>('select');
  const [activeSubChooser, setActiveSubChooser] = useState<string | null>(null);
  const [geoPopoverOpen, setGeoPopoverOpen] = useState(false);
  const [cardsPopoverOpen, setCardsPopoverOpen] = useState(false);
  const [selectedGeo, setSelectedGeo] = useState<'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star'>('rectangle');

  // Tool specific attribute states
  const [toolColors, setToolColors] = useState<Record<string, { color: string; customHex: string }>>({
    draw: { color: 'black', customHex: '#1e293b' },
    text: { color: 'black', customHex: '#1e293b' },
    note: { color: 'yellow', customHex: '#facc15' },
    geo: { color: 'black', customHex: '#1e293b' },
    arrow: { color: 'blue', customHex: '#3b82f6' },
  });

  const [toolSizes, setToolSizes] = useState<Record<string, 's' | 'm' | 'l' | 'xl'>>({
    draw: 'm',
    text: 'm',
    note: 'm',
    geo: 'm',
    arrow: 'm',
  });

  const [geoFill, setGeoFill] = useState<'none' | 'semi' | 'solid' | 'pattern'>('none');
  const [textAlign, setTextAlign] = useState<'start' | 'middle' | 'end'>('start');

  const dockRef = useRef<HTMLDivElement>(null);
  const geoRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const geoTriggerRef = useRef<HTMLButtonElement>(null);
  const cardsTriggerRef = useRef<HTMLButtonElement>(null);
  const geoPopoverRef = useRef<HTMLDivElement>(null);
  const cardsPopoverRef = useRef<HTMLDivElement>(null);
  const drawTriggerRef = useRef<HTMLButtonElement>(null);
  const textTriggerRef = useRef<HTMLButtonElement>(null);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const arrowTriggerRef = useRef<HTMLButtonElement>(null);
  const unifiedPopoverRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const applySelectedStyle = useCallback(
    <S,>(style: S, value: unknown) => {
      if (!editor || editor.getIsReadonly()) return;
      const result = resolveStyleTargets<TLShape, S>({
        selected: editor.getSelectedShapes(),
        style,
        getChildren: (shape) =>
          editor.getSortedChildIdsForParent(shape.id).flatMap((id) => {
            const child = editor.getShape(id);
            return child ? [child] : [];
          }),
        isGroup: (shape) => shape.type === 'group',
        isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
        supportsStyle: (shape, candidate) =>
          Boolean(editor.styleProps[shape.type]?.has(candidate as never)),
      });
      const updates = result.targets.flatMap((shape) => {
        const property = editor.styleProps[shape.type]?.get(style as never);
        return property
          ? [{ id: shape.id, type: shape.type, props: { [property]: value } } as TLShapePartial]
          : [];
      });
      if (updates.length) editor.updateShapes(updates);
    },
    [editor]
  );

  // Subscribe to active tool changes via tldraw store
  useEffect(() => {
    if (!editor) return;

    const syncTool = () => {
      try {
        const toolId = editor.getCurrentToolId();
        setActiveTool(toolId);
      } catch (err) {
        // Safe fallback
      }
    };

    syncTool();
    const unsubscribe = editor.store.listen(() => {
      syncTool();
    });

    return () => {
      unsubscribe();
    };
  }, [editor]);

  // Dismiss all popovers and sub-choosers back to default state
  const closeAllPopovers = useCallback(() => {
    setActiveSubChooser(null);
    setGeoPopoverOpen(false);
    setCardsPopoverOpen(false);
  }, []);

  const closeSubChooser = useCallback(() => setActiveSubChooser(null), []);

  // Click outside & canvas click listener to immediately dismiss popovers back to default state
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const isInside =
        dockRef.current &&
        (dockRef.current.contains(target) ||
          geoPopoverRef.current?.contains(target) ||
          cardsPopoverRef.current?.contains(target) ||
          unifiedPopoverRef.current?.contains(target) ||
          (e.composedPath && (
            e.composedPath().includes(dockRef.current) ||
            (geoPopoverRef.current ? e.composedPath().includes(geoPopoverRef.current) : false) ||
            (cardsPopoverRef.current ? e.composedPath().includes(cardsPopoverRef.current) : false) ||
            (unifiedPopoverRef.current ? e.composedPath().includes(unifiedPopoverRef.current) : false)
          )));

      if (!isInside) {
        closeAllPopovers();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'Escape') {
        closeAllPopovers();
      }
    };

    // Use capture: true so window catches event before tldraw calls stopPropagation()
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('click', handlePointerDown, { capture: true });
    window.addEventListener('keydown', handleKeyDown);

    const handleEditorEvent = (info: any) => {
      if (info.name === 'pointer_down') {
        closeAllPopovers();
      }
    };

    if (editor) {
      editor.on('event', handleEditorEvent);
    }

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('click', handlePointerDown, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
      if (editor) {
        editor.off('event', handleEditorEvent);
      }
    };
  }, [editor, closeAllPopovers]);

  // Set tool in tldraw editor
  const handleSelectTool = useCallback(
    (toolId: string) => {
      if (!editor) return;
      try {
        editor.setCurrentTool(toolId);
        setActiveTool(toolId);
      } catch (err) {
        // Fallback
      }
    },
    [editor]
  );

  // Set color for a tool (both for next created shapes and currently selected shapes)
  const handleSetToolColor = useCallback(
    (tool: string, tldrawColor: string, hex?: string) => {
      if (!editor) return;
      const targetHex = hex || getHexForColorName(tldrawColor, '#1e293b');

      setToolColors((prev) => ({
        ...prev,
        [tool]: { color: tldrawColor, customHex: targetHex },
      }));

      try {
        editor.setStyleForNextShapes(DefaultColorStyle, tldrawColor as any);
        applySelectedStyle(DefaultColorStyle, tldrawColor);
        const selectedArtifacts = editor.getSelectedShapes().filter(
          (shape) => shape.type === 'artifact' && !editor.isShapeOrAncestorLocked(shape)
        );
        if (selectedArtifacts.length) {
          editor.updateShapes(
            selectedArtifacts.map((shape) => ({
              id: shape.id,
              type: shape.type,
              props: { color: targetHex },
            }))
          );
        }
      } catch (err) {
        // Safe fallback
      }
    },
    [editor, applySelectedStyle]
  );

  // Custom hex color picked via native spectrum picker
  const handleCustomColor = useCallback(
    (tool: string, hex: string) => {
      const mappedColor = mapHexToTldrawColor(hex);
      handleSetToolColor(tool, mappedColor, hex);
    },
    [handleSetToolColor]
  );

  // Set size for a tool
  const handleSetToolSize = useCallback(
    (tool: string, size: 's' | 'm' | 'l' | 'xl') => {
      if (!editor) return;
      setToolSizes((prev) => ({ ...prev, [tool]: size }));

      try {
        editor.setStyleForNextShapes(DefaultSizeStyle, size);
        applySelectedStyle(DefaultSizeStyle, size);
      } catch (err) {
        // Safe fallback
      }
    },
    [editor, applySelectedStyle]
  );

  // Set fill for geo shapes
  const handleSetGeoFill = useCallback(
    (fill: 'none' | 'semi' | 'solid' | 'pattern') => {
      if (!editor) return;
      setGeoFill(fill);

      try {
        editor.setStyleForNextShapes(DefaultFillStyle, fill);
        applySelectedStyle(DefaultFillStyle, fill);
      } catch (err) {
        // Safe fallback
      }
    },
    [editor, applySelectedStyle]
  );

  // Set text alignment
  const handleSetTextAlign = useCallback(
    (align: 'start' | 'middle' | 'end') => {
      if (!editor) return;
      setTextAlign(align);

      try {
        editor.setStyleForNextShapes(DefaultTextAlignStyle, align);
        applySelectedStyle(DefaultTextAlignStyle, align);
      } catch (err) {
        // Safe fallback
      }
    },
    [editor, applySelectedStyle]
  );

  // Geo Shape Selection handler
  const handleSelectGeo = useCallback(
    (geoShape: 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star') => {
      if (!editor) return;
      setSelectedGeo(geoShape);
      try {
        editor.setStyleForNextShapes(GeoShapeGeoStyle, geoShape);
        applySelectedStyle(GeoShapeGeoStyle, geoShape);
        editor.setCurrentTool('geo');
        setActiveTool('geo');
      } catch (err) {
        // Fallback
      }
    },
    [editor, applySelectedStyle]
  );

  // Spawner for custom native canvas cards
  const handleSpawnCard = useCallback(
    (cardType: 'rich_card' | 'code_card' | 'document' | 'slide_deck' | 'artifact') => {
      if (!editor || editor.getIsReadonly()) return;
      const bounds = editor.getViewportPageBounds();
      const center = bounds.center;
      const shapeId = createShapeId();

      switch (cardType) {
        case 'rich_card':
          editor.createShape({
            id: shapeId,
            type: 'rich_card',
            x: center.x - 200,
            y: center.y - 150,
            props: {
              w: 400,
              h: 300,
              title: 'New Card',
              content: 'Synthesized card content',
              archetype: 'note',
              color: '#6366f1',
              isStreaming: false,
            },
          });
          break;
        case 'code_card':
          editor.createShape({
            id: shapeId,
            type: 'code_card',
            x: center.x - 260,
            y: center.y - 180,
            props: {
              w: 520,
              h: 360,
              title: 'Code Component',
              language: 'typescript',
              code: '// TypeScript Component\nexport default function Widget() {\n  return <div>Component</div>;\n}',
              color: '#3b82f6',
              isStreaming: false,
            },
          });
          break;
        case 'document':
          editor.createShape({
            id: shapeId,
            type: 'document',
            x: center.x - 340,
            y: center.y - 260,
            props: {
              w: 680,
              h: 520,
              title: 'New Technical Document',
              subtitle: 'Structured Notion-grade documentation card',
              author: 'User',
              date: '2026',
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
          break;
        case 'slide_deck':
          editor.createShape({
            id: shapeId,
            type: 'slide_deck',
            x: center.x - 360,
            y: center.y - 225,
            props: {
              w: 720,
              h: 450,
              title: 'Presentation Deck',
              subtitle: 'Keynote & presentation slides',
              theme: 'dark',
              currentSlideIndex: 0,
              slides: [
                {
                  id: `slide_${Date.now()}_1`,
                  title: 'VisionOS Spatial Canvas',
                  subtitle: 'AI-Native Spatial Operating System',
                  layout: 'hero',
                  content: 'Welcome to the presentation.',
                },
              ],
            },
          });
          break;
        case 'artifact':
          editor.createShape({
            id: shapeId,
            type: 'artifact',
            x: center.x - 280,
            y: center.y - 200,
            props: {
              w: 560,
              h: 400,
              title: 'Interactive App',
              code: '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#121218;color:white;font-family:sans-serif;"><h1>Interactive App</h1></body></html>',
              color: '#8b5cf6',
            },
          });
          break;
      }
      // A new card is otherwise easy to lose on a narrow canvas, where its
      // native header and edit button can sit beyond the visible viewport.
      // Selecting it exposes the viewport-clamped edit action immediately.
      if (editor.getShape(shapeId)) {
        editor.setCurrentTool('select');
        editor.setSelectedShapes([shapeId]);
      }
      setCardsPopoverOpen(false);
      setActiveSubChooser(null);
      cardsTriggerRef.current?.focus();
    },
    [editor]
  );

  const handleClear = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelectedShapeIds();
    if (selected.length > 0) {
      editor.deleteShapes(selected);
    } else {
      const all = Array.from(editor.getCurrentPageShapeIds());
      if (all.length > 0) {
        if (typeof window !== 'undefined' && window.confirm('Clear all shapes from canvas?')) {
          editor.deleteShapes(all);
        }
      }
    }
  }, [editor]);

  // Current active sub-chooser tool info
  const currentSubTool = activeSubChooser || '';
  const currentToolColor = currentSubTool && toolColors[currentSubTool] ? toolColors[currentSubTool] : { color: 'black', customHex: '#1e293b' };
  const currentToolSize = currentSubTool && toolSizes[currentSubTool] ? toolSizes[currentSubTool] : 'm';

  // Render the unified, compact vertical attributes popover
  const renderUnifiedAttributesPopover = (
    tool: string,
    anchorRef: React.RefObject<HTMLButtonElement | null>
  ) => {
    const isGeo = tool === 'geo';
    const isText = tool === 'text';

    return (
      <DockPopoverPortal
        anchorRef={anchorRef}
        returnFocusRef={anchorRef}
        popoverRef={unifiedPopoverRef}
        onClose={closeSubChooser}
        label={`${tool === 'geo' ? 'Geometric shapes' : tool} attributes`}
        role="dialog"
        className="w-[240px] p-2 rounded-[20px] liquid-glass-popover shadow-2xl backdrop-blur-3xl border border-white/10 select-none flex flex-col gap-2"
      >
        {/* Apple HIG Downward Pointer Beak / Triangle pointing directly to clicked button */}
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[#12141c] border-r border-b border-white/15 pointer-events-none" />

        {/* 1. Header with Tool Identity & Dismiss Button */}
        <div className="flex items-center justify-between px-1 pt-0.5">
          <div className="flex items-center gap-2">
            {tool === 'draw' && <Pencil className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />}
            {tool === 'text' && <Type className="h-4 w-4 text-sky-400" strokeWidth={1.5} />}
            {tool === 'note' && <StickyNote className="h-4 w-4 text-amber-400" strokeWidth={1.5} />}
            {tool === 'geo' && <Square className="h-4 w-4 text-purple-400" strokeWidth={1.5} />}
            {tool === 'arrow' && <ArrowUpRight className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />}
            <span className="text-xs font-semibold text-white capitalize">
              {tool === 'draw' ? 'Pen' : tool === 'geo' ? 'Shapes' : tool}
            </span>
          </div>

          <button
            type="button"
            title="Close"
            aria-label="Close tool settings"
            onClick={() => { closeAllPopovers(); anchorRef.current?.focus(); }}
            className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter]"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* 2. Geo-Specific: Shape Selection & Fill Mode */}
        {isGeo && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
              Shape
            </span>
            <div className="grid grid-cols-5 gap-1">
              <button
                type="button"
                aria-label="Rectangle"
                aria-pressed={selectedGeo === 'rectangle'}
                title="Rectangle"
                onClick={() => handleSelectGeo('rectangle')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'rectangle' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Square className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Ellipse or circle"
                aria-pressed={selectedGeo === 'ellipse'}
                title="Ellipse / Circle"
                onClick={() => handleSelectGeo('ellipse')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'ellipse' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Circle className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Triangle"
                aria-pressed={selectedGeo === 'triangle'}
                title="Triangle"
                onClick={() => handleSelectGeo('triangle')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'triangle' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Triangle className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Diamond"
                aria-pressed={selectedGeo === 'diamond'}
                title="Diamond"
                onClick={() => handleSelectGeo('diamond')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'diamond' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Diamond className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Star"
                aria-pressed={selectedGeo === 'star'}
                title="Star"
                onClick={() => handleSelectGeo('star')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'star' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Star className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mt-1">
              Fill
            </span>
            <div className="grid grid-cols-4 gap-1">
              {FILLS.map((fill) => (
                <button
                  key={fill.id}
                  type="button"
                  title={`Fill: ${fill.label}`}
                  aria-pressed={geoFill === fill.id}
                  onClick={() => handleSetGeoFill(fill.id)}
                  className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl text-xs font-medium transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                    geoFill === fill.id ? 'bg-white/20 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {fill.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Text-Specific: Alignment Options */}
        {isText && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
              Alignment
            </span>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                aria-label="Align left"
                aria-pressed={textAlign === 'start'}
                title="Align Left"
                onClick={() => handleSetTextAlign('start')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  textAlign === 'start' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <AlignLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Align center"
                aria-pressed={textAlign === 'middle'}
                title="Align Center"
                onClick={() => handleSetTextAlign('middle')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  textAlign === 'middle' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <AlignCenter className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="Align right"
                aria-pressed={textAlign === 'end'}
                title="Align Right"
                onClick={() => handleSetTextAlign('end')}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  textAlign === 'end' ? 'bg-white/20 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <AlignRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* 4. Common Color Grid (5x2: 9 swatches + 1 custom spectrum picker) */}
        <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Color
            </span>
            <span className="text-xs font-mono text-slate-400 uppercase">
              {currentToolColor.customHex}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {DOCK_SWATCHES.map((swatch) => {
              const isSelected = currentToolColor.color === swatch.tldrawColor;
              return (
                <button
                  key={swatch.id}
                  type="button"
                  title={`Color: ${swatch.label}`}
                  aria-label={`Color: ${swatch.label}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSetToolColor(tool, swatch.tldrawColor, swatch.hex)}
                  className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] hover:bg-white/10"
                >
                  <span
                    className="w-5 h-5 rounded-full border border-white/20 shadow-sm flex items-center justify-center transition-transform"
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white drop-shadow-md" strokeWidth={2.5} />}
                  </span>
                </button>
              );
            })}

            {/* Custom Arbitrary Color Spectrum Picker Button */}
            <div className="relative">
              <button
                type="button"
                title="Choose Any Custom Color"
                aria-label="Custom Color Spectrum Picker"
                onClick={() => colorInputRef.current?.click()}
                className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl p-0.5 border border-white/20 hover:border-white/40 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter] hover:bg-white/10"
              >
                <span
                  className="w-5 h-5 rounded-full border border-white/30 shadow-sm flex items-center justify-center"
                  style={{
                    background:
                      'conic-gradient(from 180deg at 50% 50%, #ef4444 0deg, #f59e0b 60deg, #10b981 120deg, #06b6d4 180deg, #3b82f6 240deg, #8b5cf6 300deg, #ef4444 360deg)',
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/40"
                    style={{ backgroundColor: currentToolColor.customHex }}
                  />
                </span>
              </button>
              <input
                ref={colorInputRef}
                type="color"
                tabIndex={-1}
                value={currentToolColor.customHex}
                onChange={(e) => handleCustomColor(tool, e.target.value)}
                className="sr-only"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>

        {/* 5. Common Size Section */}
        <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
            {isText ? 'Font Size' : 'Stroke Weight'}
          </span>
          <div className="grid grid-cols-4 gap-1">
            {SIZES.map((size) => (
              <button
                key={size.id}
                type="button"
                title={`Size: ${size.label}`}
                aria-label={`Size: ${size.label}`}
                aria-pressed={currentToolSize === size.id}
                onClick={() => handleSetToolSize(tool, size.id)}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl text-xs font-semibold tabular-nums transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  currentToolSize === size.id
                    ? 'bg-white/20 text-white shadow-sm border border-white/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </div>
      </DockPopoverPortal>
    );
  };

  return (
    <nav
      ref={dockRef}
      aria-label="Floating Canvas Island Dock"
      data-canvas-chrome="dock"
      className="studio-canvas-chrome fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-1 p-2 liquid-glass-dock select-none"
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. Select Tool                                                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        data-tool="select"
        title="Select Tool (V)"
        aria-label="Select Tool"
        aria-pressed={activeTool === 'select'}
        onClick={() => {
          handleSelectTool('select');
          closeAllPopovers();
        }}
        className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
      >
        {activeTool === 'select' && (
          <motion.div
            layoutId="activeDockToolIndicator"
            className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
            transition={APPLE_SPRING}
          />
        )}
        <span className="relative z-10 flex items-center justify-center">
          <MousePointer2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </span>
      </button>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. Hand / Pan Tool                                                  */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        data-tool="hand"
        title="Hand / Pan Tool (H / Space)"
        aria-label="Pan Tool"
        aria-pressed={activeTool === 'hand'}
        onClick={() => {
          handleSelectTool('hand');
          closeAllPopovers();
        }}
        className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
      >
        {activeTool === 'hand' && (
          <motion.div
            layoutId="activeDockToolIndicator"
            className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
            transition={APPLE_SPRING}
          />
        )}
        <span className="relative z-10 flex items-center justify-center">
          <Hand className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </span>
      </button>

      {/* Divider */}
      <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. Draw / Pencil Tool with Attached Vertical Attributes Popover     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <button
          type="button"
          ref={drawTriggerRef}
          data-tool="draw"
          title="Draw / Pencil (D)"
          aria-label="Draw Tool"
          aria-pressed={activeTool === 'draw'}
          aria-haspopup="dialog"
          aria-expanded={activeSubChooser === 'draw'}
          onClick={() => {
            if (activeTool === 'draw') {
              setActiveSubChooser((prev) => (prev === 'draw' ? null : 'draw'));
            } else {
              handleSelectTool('draw');
              setActiveSubChooser(null);
            }
            setCardsPopoverOpen(false);
            setGeoPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'draw' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            <Pencil className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </span>
        </button>

        {/* Attached Vertical Attributes Popover */}
        <AnimatePresence>
          {activeSubChooser === 'draw' && renderUnifiedAttributesPopover('draw', drawTriggerRef)}
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. Text Tool with Attached Vertical Attributes Popover              */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <button
          type="button"
          ref={textTriggerRef}
          data-tool="text"
          title="Text (T)"
          aria-label="Text Tool"
          aria-pressed={activeTool === 'text'}
          aria-haspopup="dialog"
          aria-expanded={activeSubChooser === 'text'}
          onClick={() => {
            if (activeTool === 'text') {
              setActiveSubChooser((prev) => (prev === 'text' ? null : 'text'));
            } else {
              handleSelectTool('text');
              setActiveSubChooser(null);
            }
            setCardsPopoverOpen(false);
            setGeoPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'text' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            <Type className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </span>
        </button>

        {/* Attached Vertical Attributes Popover */}
        <AnimatePresence>
          {activeSubChooser === 'text' && renderUnifiedAttributesPopover('text', textTriggerRef)}
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 5. Note / Sticky Tool with Attached Vertical Attributes Popover     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <button
          type="button"
          ref={noteTriggerRef}
          data-tool="note"
          title="Sticky Note (N)"
          aria-label="Note Tool"
          aria-pressed={activeTool === 'note'}
          aria-haspopup="dialog"
          aria-expanded={activeSubChooser === 'note'}
          onClick={() => {
            if (activeTool === 'note') {
              setActiveSubChooser((prev) => (prev === 'note' ? null : 'note'));
            } else {
              handleSelectTool('note');
              setActiveSubChooser(null);
            }
            setCardsPopoverOpen(false);
            setGeoPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'note' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            <StickyNote className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </span>
        </button>

        {/* Attached Vertical Attributes Popover */}
        <AnimatePresence>
          {activeSubChooser === 'note' && renderUnifiedAttributesPopover('note', noteTriggerRef)}
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 6. Geometric Shapes Popover & Sub-Chooser                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div ref={geoRef} className="relative shrink-0">
        <button
          type="button"
          ref={geoTriggerRef}
          data-tool="geo"
          title="Geometric Shapes (R)"
          aria-label="Geometric Shapes"
          aria-pressed={activeTool === 'geo'}
          aria-haspopup="dialog"
          aria-expanded={geoPopoverOpen || activeSubChooser === 'geo'}
          onClick={() => {
            if (activeTool === 'geo') {
              setActiveSubChooser((prev) => (prev === 'geo' ? null : 'geo'));
            } else {
              handleSelectGeo(selectedGeo);
              setActiveSubChooser(null);
            }
            setGeoPopoverOpen(false);
            setCardsPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'geo' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            {selectedGeo === 'rectangle' && <Square className="h-[18px] w-[18px]" strokeWidth={1.5} />}
            {selectedGeo === 'ellipse' && <Circle className="h-[18px] w-[18px]" strokeWidth={1.5} />}
            {selectedGeo === 'triangle' && <Triangle className="h-[18px] w-[18px]" strokeWidth={1.5} />}
            {selectedGeo === 'diamond' && <Diamond className="h-[18px] w-[18px]" strokeWidth={1.5} />}
            {selectedGeo === 'star' && <Star className="h-[18px] w-[18px]" strokeWidth={1.5} />}
          </span>
        </button>

        {/* Attached Vertical Attributes Popover */}
        <AnimatePresence>
          {activeSubChooser === 'geo' && renderUnifiedAttributesPopover('geo', geoTriggerRef)}
        </AnimatePresence>

        {/* Geo shapes portal stays above the dock scroll region on compact screens. */}
        <AnimatePresence>
          {geoPopoverOpen && !activeSubChooser && (
            <DockPopoverPortal
              anchorRef={geoRef}
              returnFocusRef={geoTriggerRef}
              popoverRef={geoPopoverRef}
              onClose={() => setGeoPopoverOpen(false)}
              label="Geometric shapes"
              className="flex items-center gap-1 p-2 rounded-[20px] liquid-glass-popover"
            >
              <button
                type="button"
                role="menuitem"
                aria-label="Rectangle"
                title="Rectangle"
                onClick={() => { handleSelectGeo('rectangle'); setGeoPopoverOpen(false); geoTriggerRef.current?.focus(); }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'rectangle' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Square className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Ellipse or circle"
                title="Ellipse / Circle"
                onClick={() => { handleSelectGeo('ellipse'); setGeoPopoverOpen(false); geoTriggerRef.current?.focus(); }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'ellipse' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Circle className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Triangle"
                title="Triangle"
                onClick={() => { handleSelectGeo('triangle'); setGeoPopoverOpen(false); geoTriggerRef.current?.focus(); }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'triangle' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Triangle className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Diamond"
                title="Diamond"
                onClick={() => { handleSelectGeo('diamond'); setGeoPopoverOpen(false); geoTriggerRef.current?.focus(); }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'diamond' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Diamond className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label="Star"
                title="Star"
                onClick={() => { handleSelectGeo('star'); setGeoPopoverOpen(false); geoTriggerRef.current?.focus(); }}
                className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                  selectedGeo === 'star' ? 'bg-white/20 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Star className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </DockPopoverPortal>
          )}
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 7. Custom Cards Popover (rich_card, code_card, document, slide, app)*/}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div ref={cardsRef} className="relative shrink-0">
        <button
          type="button"
          ref={cardsTriggerRef}
          data-tool="rich_card"
          title="Custom Cards & Artifacts"
          aria-label="Custom Cards Popover"
          aria-pressed={activeTool === 'rich_card'}
          aria-haspopup="menu"
          aria-expanded={cardsPopoverOpen}
          onClick={() => {
            setCardsPopoverOpen((prev) => !prev);
            setActiveSubChooser(null);
            setGeoPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'rich_card' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            <Layers className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </span>
        </button>

        {/* Custom cards portal avoids clipping by the horizontally scrolling dock. */}
        <AnimatePresence>
          {cardsPopoverOpen && (
            <DockPopoverPortal
              anchorRef={cardsRef}
              returnFocusRef={cardsTriggerRef}
              popoverRef={cardsPopoverRef}
              onClose={() => setCardsPopoverOpen(false)}
              label="Create canvas shape"
              className="flex flex-col gap-1 p-2 rounded-[20px] liquid-glass-popover min-w-[200px]"
            >
              <div className="px-2 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Create Canvas Shape
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => handleSpawnCard('rich_card')}
                className="flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
              >
                <FileText className="h-4 w-4 text-indigo-400" strokeWidth={1.5} />
                <span>Rich Card</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => handleSpawnCard('code_card')}
                className="flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
              >
                <Code2 className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
                <span>Code Card</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => handleSpawnCard('document')}
                className="flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
              >
                <BookOpen className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
                <span>Document</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => handleSpawnCard('slide_deck')}
                className="flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
              >
                <Presentation className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
                <span>Slide Deck</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => handleSpawnCard('artifact')}
                className="flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
              >
                <AppWindow className="h-4 w-4 text-purple-400" strokeWidth={1.5} />
                <span>Interactive App</span>
              </button>
            </DockPopoverPortal>
          )}
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 8. Connector Arrow Tool with Attached Vertical Attributes Popover   */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <button
          type="button"
          ref={arrowTriggerRef}
          data-tool="arrow"
          title="Connector Arrow (A)"
          aria-label="Arrow Tool"
          aria-pressed={activeTool === 'arrow'}
          aria-haspopup="dialog"
          aria-expanded={activeSubChooser === 'arrow'}
          onClick={() => {
            if (activeTool === 'arrow') {
              setActiveSubChooser((prev) => (prev === 'arrow' ? null : 'arrow'));
            } else {
              handleSelectTool('arrow');
              setActiveSubChooser(null);
            }
            setCardsPopoverOpen(false);
            setGeoPopoverOpen(false);
          }}
          className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
        >
          {activeTool === 'arrow' && (
            <motion.div
              layoutId="activeDockToolIndicator"
              className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
              transition={APPLE_SPRING}
            />
          )}
          <span className="relative z-10 flex items-center justify-center">
            <ArrowUpRight className="h-[18px] w-[18px]" strokeWidth={1.5} />
          </span>
        </button>

        {/* Attached Vertical Attributes Popover */}
        <AnimatePresence>
          {activeSubChooser === 'arrow' && renderUnifiedAttributesPopover('arrow', arrowTriggerRef)}
        </AnimatePresence>
      </div>

      {/* Divider */}
      <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 9. Eraser Tool                                                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        data-tool="eraser"
        title="Eraser (E)"
        aria-label="Eraser Tool"
        aria-pressed={activeTool === 'eraser'}
        onClick={() => {
          handleSelectTool('eraser');
          closeAllPopovers();
        }}
        className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-white transition-[color,transform] active:scale-[0.96]"
      >
        {activeTool === 'eraser' && (
          <motion.div
            layoutId="activeDockToolIndicator"
            className="absolute inset-0 rounded-xl bg-white/15 border border-white/20 shadow-sm"
            transition={APPLE_SPRING}
          />
        )}
        <span className="relative z-10 flex items-center justify-center">
          <Eraser className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </span>
      </button>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 10. Clear / Delete Action                                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <button
        type="button"
        data-tool="clear"
        title="Clear Selected or Canvas"
        aria-label="Clear Canvas"
        onClick={handleClear}
        className="relative flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-300 hover:text-rose-400 hover:bg-rose-500/10 transition-[color,transform] active:scale-[0.96]"
      >
        <span className="relative z-10 flex items-center justify-center">
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </span>
      </button>
    </nav>
  );
};

export default AppleFloatingDock;
