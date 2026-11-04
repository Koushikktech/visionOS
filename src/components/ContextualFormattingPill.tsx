'use client';

import { AIOrb } from './AIOrb';


import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tldraw/tldraw';
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  DefaultTextAlignStyle,
} from '@tldraw/tldraw';
import type { TLShape, TLShapePartial } from '@tldraw/tldraw';
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
  Pencil,
  MoreHorizontal,
  X,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Group,
  Ungroup,
  Globe,
} from 'lucide-react';
import { APPLE_SPRING, mapHexToTldrawColor } from '../lib/tokens';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';
import type { useSpatialAI } from '../hooks/useSpatialAI';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import {
  getFloatingViewportBounds,
  placeFloatingPopover,
  placeFloatingToolbar,
} from '../hooks/viewportGeometry';
import {
  resolveSiblingTargets,
  resolveStyleTargets,
  resolveUngroupTargets,
} from '../lib/selectionCapabilities';
import { requestShapeEditing } from '../lib/shapeEditing';
import { requestArtifactNetworkReview } from '../lib/artifactNetworkPermissions';

/** Native tldraw color values with display swatches for this toolbar. */
export const HUD_COLOR_SWATCHES = [
  { id: 'swatch-white', tldrawColor: 'white', label: 'White', hex: '#f8fafc' },
  { id: 'swatch-grey', tldrawColor: 'grey', label: 'Slate Grey', hex: '#94a3b8' },
  { id: 'swatch-black', tldrawColor: 'black', label: 'Obsidian Black', hex: '#1e293b' },
  { id: 'swatch-blue', tldrawColor: 'blue', label: 'Cobalt Blue', hex: '#3b82f6' },
  { id: 'swatch-violet', tldrawColor: 'violet', label: 'Deep Violet', hex: '#8b5cf6' },
  { id: 'swatch-green', tldrawColor: 'green', label: 'Emerald Green', hex: '#22c55e' },
  { id: 'swatch-yellow', tldrawColor: 'yellow', label: 'Amber Yellow', hex: '#facc15' },
  { id: 'swatch-orange', tldrawColor: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'swatch-red', tldrawColor: 'red', label: 'Crimson Red', hex: '#ef4444' },
] as const;

export interface ContextualFormattingPillProps {
  editor: Editor | null;
  spatial?: ReturnType<typeof useSpatialWorker>;
  ai?: ReturnType<typeof useSpatialAI>;
}

function FloatingPopoverPortal({
  children,
  popoverRef,
  style,
}: {
  children: React.ReactNode;
  popoverRef: React.Ref<HTMLDivElement>;
  style: React.CSSProperties;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={popoverRef} data-formatting-popover style={style} className="fixed z-[450]">
      {children}
    </div>,
    document.body
  );
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
  const [activePopover, setActivePopover] = useState<'color' | 'size' | 'fill' | 'align' | 'more' | 'layout' | null>(null);
  const [showAIActions, setShowAIActions] = useState<boolean>(false);
  const [promptText, setPromptText] = useState<string>('');
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [popoverPlacement, setPopoverPlacement] = useState<'top' | 'bottom'>('top');
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const [measureRevision, setMeasureRevision] = useState(0);
  const viewport = useVisibleViewport();

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const prevSelectedIdsRef = useRef<string[]>([]);

  const closePopovers = useCallback(() => {
    setActivePopover(null);
  }, []);

  useEffect(() => {
    if (!activePopover) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = containerRef.current?.querySelector<HTMLElement>(
        `[data-popover-trigger="${activePopover}"]`
      );
      closePopovers();
      requestAnimationFrame(() => trigger?.focus());
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [activePopover, closePopovers]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setMeasureRevision((revision) => revision + 1));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [selectedCount, isDismissed]);

  // Track selection bounding box in screen coordinates
  useEffect(() => {
    if (!editor) return;

    const updatePosition = () => {
      const selectedIds = editor.getSelectedShapeIds();
      setSelectedCount(selectedIds.length);

      if (selectedIds.length === 0) {
        setMenuPosition(null);
        setSelectionAnchor(null);
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
        setSelectionAnchor(null);
        return;
      }

      const topCenterPage = { x: (minX + maxX) / 2, y: minY };
      const topCenterScreen = editor.pageToScreen(topCenterPage);
      const bottomCenterPage = { x: (minX + maxX) / 2, y: maxY };
      const bottomCenterScreen = editor.pageToScreen(bottomCenterPage);

      setSelectionAnchor({
        x: topCenterScreen.x,
        top: topCenterScreen.y,
        bottom: bottomCenterScreen.y,
      });
      setMenuPosition((current) => current ?? {
        x: viewport.left + viewport.width / 2,
        y: viewport.top + viewport.height / 2,
      });

      // Reset dismissed state when the set of selected shapes changes
      const prevIdsStr = [...prevSelectedIdsRef.current].sort().join(',');
      const currIdsStr = [...selectedIds].sort().join(',');
      if (prevIdsStr !== currIdsStr) {
        prevSelectedIdsRef.current = [...selectedIds];
        setIsDismissed(false);
        setActionFeedback('');
      }

      // Read current styles for selected shapes
      try {
        const sharedStyles = editor.getSharedStyles();
        const color = sharedStyles.getAsKnownValue(DefaultColorStyle);
        setSelectedColor(color || 'mixed');
        const size = sharedStyles.getAsKnownValue(DefaultSizeStyle);
        setSelectedSize(size || 'mixed');
        const fill = sharedStyles.getAsKnownValue(DefaultFillStyle);
        setSelectedFill(fill || 'mixed');
        const align = sharedStyles.getAsKnownValue(DefaultTextAlignStyle);
        setSelectedAlign(align || 'mixed');

        const selectedShapes = editor.getSelectedShapes();
        setIsLocked(
          selectedShapes.length > 0 &&
            selectedShapes.every((shape) => editor.isShapeOrAncestorLocked(shape))
        );
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
  }, [editor, closePopovers, viewport.left, viewport.top, viewport.width, viewport.height]);

  useLayoutEffect(() => {
    if (!selectionAnchor || !toolbarRef.current) return;
    // Measure layout dimensions rather than Framer's animated transform.
    // Depending on the position being set creates a synchronous layout loop after undo.
    const toolbarBounds = { width: toolbarRef.current.offsetWidth, height: toolbarRef.current.offsetHeight };
    const measuredPlacement = placeFloatingToolbar(
      selectionAnchor,
      { width: toolbarBounds.width, height: toolbarBounds.height },
      viewport
    );

    const { left, top } = measuredPlacement;
    setPlacement(measuredPlacement.placement);
    setMenuPosition((current) =>
      current && Math.abs(current.x - left) < 0.5 && Math.abs(current.y - top) < 0.5
        ? current
        : { x: left, y: top }
    );
  }, [selectionAnchor, viewport.left, viewport.top, viewport.width, viewport.height, measureRevision]);

  // Popovers live outside the scrollable capsule, then follow their trigger as
  // the toolbar scrolls or the keyboard changes the visible viewport.
  useLayoutEffect(() => {
    if (!activePopover) {
      return;
    }

    const updatePosition = () => {
      const trigger = containerRef.current?.querySelector<HTMLElement>(
        `[data-popover-trigger="${activePopover}"]`
      );
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const triggerBounds = trigger.getBoundingClientRect();
      const popoverBounds = popover.getBoundingClientRect();
      const next = placeFloatingPopover(
        {
          left: triggerBounds.left,
          top: triggerBounds.top,
          right: triggerBounds.right,
          bottom: triggerBounds.bottom,
        },
        { width: popoverBounds.width, height: popoverBounds.height },
        viewport
      );
      setPopoverPlacement(next.placement);
      setPopoverPosition((current) =>
        current && Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5
          ? current
          : { left: next.left, top: next.top }
      );
    };

    updatePosition();
    const toolbar = toolbarRef.current;
    toolbar?.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      toolbar?.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [activePopover, viewport, measureRevision]);

  // Click outside listener with capture: true & editor.on('event')
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
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

  const getStyleTargets = useCallback(
    <S,>(style: S) => {
      if (!editor) return { targets: [], skippedLocked: 0, skippedUnsupported: 0 };
      return resolveStyleTargets<TLShape, S>({
        selected: editor.getSelectedShapes(),
        style,
        getChildren: (shape) =>
          editor
            .getSortedChildIdsForParent(shape.id)
            .flatMap((id) => {
              const child = editor.getShape(id);
              return child ? [child] : [];
            }),
        isGroup: (shape) => shape.type === 'group',
        isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
        supportsStyle: (shape, candidate) =>
          Boolean(editor.styleProps[shape.type]?.has(candidate as never)),
      });
    },
    [editor]
  );

  const applyNativeStyle = useCallback(
    <S,>(style: S, value: unknown, label: string): boolean => {
      if (!editor) return false;
      if (editor.getIsReadonly()) {
        setActionFeedback('The canvas is read-only.');
        return false;
      }
      const { targets, skippedLocked, skippedUnsupported } = getStyleTargets(style);
      if (!targets.length) {
        setActionFeedback(
          skippedLocked || skippedUnsupported
            ? `${label} is unavailable: the selection contains locked or unsupported items.`
            : `No selected items support ${label.toLowerCase()}.`
        );
        return false;
      }

      const updates = targets.flatMap((shape) => {
        const property = editor.styleProps[shape.type]?.get(style as never);
        return property
          ? [{
              id: shape.id,
              type: shape.type,
              props: { [property]: value },
            } as TLShapePartial]
          : [];
      });
      if (!updates.length) {
        setActionFeedback(`No selected items support ${label.toLowerCase()}.`);
        return false;
      }

      try {
        editor.updateShapes(updates);
        const skipped = skippedLocked + skippedUnsupported;
        setActionFeedback(
          `${label} applied to ${updates.length} ${updates.length === 1 ? 'item' : 'items'}${skipped ? `; ${skipped} locked or unsupported ${skipped === 1 ? 'item was' : 'items were'} skipped` : ''}.`
        );
        return true;
      } catch (error) {
        setActionFeedback(
          `Couldn’t apply ${label.toLowerCase()}: ${error instanceof Error ? error.message : 'the canvas rejected the change.'}`
        );
        return false;
      }
    },
    [editor, getStyleTargets]
  );

  const handleColorChange = useCallback(
    (color: (typeof DefaultColorStyle.values)[number]) => {
      if (applyNativeStyle(DefaultColorStyle, color, 'Color')) setSelectedColor(color);
      closePopovers();
    },
    [applyNativeStyle, closePopovers]
  );

  const handleCustomColor = useCallback(
    (hex: string) => {
      setCustomHex(hex);
      const mapped = mapHexToTldrawColor(hex) as (typeof DefaultColorStyle.values)[number];
      const label = HUD_COLOR_SWATCHES.find((swatch) => swatch.tldrawColor === mapped)?.label || mapped;
      if (applyNativeStyle(DefaultColorStyle, mapped, `Closest native color (${label})`))
        setSelectedColor(mapped);
    },
    [applyNativeStyle]
  );

  const handleSizeChange = useCallback(
    (size: (typeof DefaultSizeStyle.values)[number]) => {
      if (applyNativeStyle(DefaultSizeStyle, size, 'Size')) setSelectedSize(size);
      closePopovers();
    },
    [applyNativeStyle, closePopovers]
  );

  const handleFillChange = useCallback(
    (fill: (typeof DefaultFillStyle.values)[number]) => {
      if (applyNativeStyle(DefaultFillStyle, fill, 'Fill')) setSelectedFill(fill);
      closePopovers();
    },
    [applyNativeStyle, closePopovers]
  );

  const handleAlignChange = useCallback(
    (align: (typeof DefaultTextAlignStyle.values)[number]) => {
      if (applyNativeStyle(DefaultTextAlignStyle, align, 'Text alignment')) setSelectedAlign(align);
      closePopovers();
    },
    [applyNativeStyle, closePopovers]
  );

  const runCanvasAction = useCallback(
    (successMessage: string, action: () => void) => {
      if (!editor) return false;
      if (editor.getIsReadonly()) {
        setActionFeedback('The canvas is read-only.');
        return false;
      }
      try {
        action();
        setActionFeedback(successMessage);
        return true;
      } catch (error) {
        setActionFeedback(
          `Couldn’t complete the action: ${error instanceof Error ? error.message : 'the canvas rejected the change.'}`
        );
        return false;
      }
    },
    [editor]
  );

  // Duplicate handler
  const handleDuplicate = useCallback(() => {
    if (!editor) return;
    const selected = editor
      .getSelectedShapes()
      .filter((shape) => !editor.isShapeOrAncestorLocked(shape));
    if (selected.length)
      runCanvasAction(
        `Duplicated ${selected.length} ${selected.length === 1 ? 'item' : 'items'}.`,
        () => editor.duplicateShapes(selected.map((shape) => shape.id))
      );
    else setActionFeedback('No unlocked items are available to duplicate.');
    closePopovers();
  }, [editor, runCanvasAction, closePopovers]);

  // Lock / Unlock handler
  const handleToggleLock = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelectedShapes();
    const eligible = selected.filter((shape) =>
      editor.getShapeAncestors(shape).every((ancestor) => !ancestor.isLocked)
    );
    if (eligible.length)
      runCanvasAction(
        `${eligible.every((shape) => shape.isLocked) ? 'Unlocked' : 'Locked'} ${eligible.length} ${eligible.length === 1 ? 'item' : 'items'}.`,
        () => editor.toggleLock(eligible.map((shape) => shape.id))
      );
    else setActionFeedback('This selection is inside a locked group.');
    closePopovers();
  }, [editor, runCanvasAction, closePopovers]);

  // Bring to Front
  const handleBringToFront = useCallback(() => {
    if (!editor) return;
    const selected = editor
      .getSelectedShapes()
      .filter((shape) => !editor.isShapeOrAncestorLocked(shape));
    if (selected.length)
      runCanvasAction('Brought selection to front.', () =>
        editor.bringToFront(selected.map((shape) => shape.id))
      );
    else setActionFeedback('No unlocked items are available to reorder.');
    closePopovers();
  }, [editor, runCanvasAction, closePopovers]);

  // Send to Back
  const handleSendToBack = useCallback(() => {
    if (!editor) return;
    const selected = editor
      .getSelectedShapes()
      .filter((shape) => !editor.isShapeOrAncestorLocked(shape));
    if (selected.length)
      runCanvasAction('Sent selection to back.', () =>
        editor.sendToBack(selected.map((shape) => shape.id))
      );
    else setActionFeedback('No unlocked items are available to reorder.');
    closePopovers();
  }, [editor, runCanvasAction, closePopovers]);

  const hasLockedDescendant = useCallback(
    (shape: TLShape, seen = new Set<string>()): boolean => {
      if (!editor || seen.has(shape.id)) return false;
      seen.add(shape.id);
      return editor.getSortedChildIdsForParent(shape.id).some((id) => {
        const child = editor.getShape(id);
        return Boolean(
          child &&
            (editor.isShapeOrAncestorLocked(child) || hasLockedDescendant(child, seen))
        );
      });
    },
    [editor]
  );

  const isProtectedGroup = useCallback(
    (shape: TLShape) => shape.type === 'group' && hasLockedDescendant(shape),
    [hasLockedDescendant]
  );

  // Delete handler
  const handleDelete = useCallback(() => {
    if (!editor) return;
    const selected = editor
      .getSelectedShapes()
      .filter((shape) => !editor.isShapeOrAncestorLocked(shape) && !isProtectedGroup(shape));
    if (selected.length)
      runCanvasAction(`Deleted ${selected.length} ${selected.length === 1 ? 'item' : 'items'}.`, () =>
        editor.deleteShapes(selected.map((shape) => shape.id))
      );
    else setActionFeedback('No unlocked items are available to delete.');
    closePopovers();
  }, [editor, isProtectedGroup, runCanvasAction, closePopovers]);

  const handleAlign = useCallback(
    (operation: 'left' | 'center-horizontal' | 'right' | 'top' | 'center-vertical' | 'bottom') => {
      if (!editor) return;
      try {
        const selected = editor.getSelectedShapes();
        const resolution = resolveSiblingTargets<TLShape>({
          selected,
          isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
          hasLockedDescendant,
          isCompatible: (shape) =>
            editor.getShapeUtil(shape).canBeLaidOut(shape, { type: 'align', shapes: selected }),
        });
        if (resolution.mixedParents) {
          setActionFeedback('Align items within the same page or group.');
        } else if (resolution.targets.length < 2) {
          setActionFeedback('Select at least two unlocked items that support alignment.');
        } else {
          const skipped = resolution.skippedLocked + resolution.skippedUnsupported;
          runCanvasAction(
            `Aligned ${resolution.targets.length} items${skipped ? `; skipped ${skipped} locked or unsupported` : ''}.`,
            () => editor.alignShapes(resolution.targets.map((shape) => shape.id), operation)
          );
        }
      } catch (error) {
        setActionFeedback(`Couldn’t align the selection: ${error instanceof Error ? error.message : 'the canvas rejected the change.'}`);
      }
      closePopovers();
    },
    [editor, hasLockedDescendant, runCanvasAction, closePopovers]
  );

  const handleDistribute = useCallback(
    (operation: 'horizontal' | 'vertical') => {
      if (!editor) return;
      try {
        const selected = editor.getSelectedShapes();
        const resolution = resolveSiblingTargets<TLShape>({
          selected,
          isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
          hasLockedDescendant,
          isCompatible: (shape) =>
            editor.getShapeUtil(shape).canBeLaidOut(shape, { type: 'distribute', shapes: selected }),
        });
        if (resolution.mixedParents) {
          setActionFeedback('Distribute items within the same page or group.');
        } else if (resolution.targets.length < 3) {
          setActionFeedback('Select at least three unlocked items that support distribution.');
        } else {
          const skipped = resolution.skippedLocked + resolution.skippedUnsupported;
          runCanvasAction(
            `Distributed ${resolution.targets.length} items ${operation === 'horizontal' ? 'horizontally' : 'vertically'}${skipped ? `; skipped ${skipped} locked or unsupported` : ''}.`,
            () => editor.distributeShapes(resolution.targets.map((shape) => shape.id), operation)
          );
        }
      } catch (error) {
        setActionFeedback(`Couldn’t distribute the selection: ${error instanceof Error ? error.message : 'the canvas rejected the change.'}`);
      }
      closePopovers();
    },
    [editor, hasLockedDescendant, runCanvasAction, closePopovers]
  );

  const handleGroup = useCallback(() => {
    if (!editor) return;
    const resolution = resolveSiblingTargets<TLShape>({
      selected: editor.getSelectedShapes(),
      isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
      hasLockedDescendant,
      isCompatible: () => true,
    });
    if (resolution.mixedParents) {
      setActionFeedback('Group items within the same page or group.');
    } else if (resolution.targets.length < 2) {
      setActionFeedback('Select at least two unlocked sibling items to group.');
    } else {
      const skipped = resolution.skippedLocked;
      runCanvasAction(
        `Grouped ${resolution.targets.length} items${skipped ? `; skipped ${skipped} locked` : ''}.`,
        () => editor.groupShapes(resolution.targets.map((shape) => shape.id))
      );
    }
    closePopovers();
  }, [editor, hasLockedDescendant, runCanvasAction, closePopovers]);

  const handleUngroup = useCallback(() => {
    if (!editor) return;
    const resolution = resolveUngroupTargets<TLShape>({
      selected: editor.getSelectedShapes(),
      isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
      hasLockedDescendant,
    });
    if (resolution.mixedParents) {
      setActionFeedback('Ungroup items within the same page or group.');
    } else if (!resolution.targets.length) {
      setActionFeedback(
        resolution.skippedLocked || resolution.skippedUnsupported
          ? 'No safe groups can be ungrouped; locked groups or groups with locked items were skipped.'
          : 'Select an unlocked group to ungroup.'
      );
    } else {
      runCanvasAction(
        `Ungrouped ${resolution.targets.length} groups${resolution.skippedLocked + resolution.skippedUnsupported ? `; skipped ${resolution.skippedLocked + resolution.skippedUnsupported} locked or incompatible items` : ''}.`,
        () => editor.ungroupShapes(resolution.targets.map((shape) => shape.id))
      );
    }
    closePopovers();
  }, [editor, hasLockedDescendant, runCanvasAction, closePopovers]);

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

  if (isDismissed || !menuPosition || selectedCount === 0 || typeof document === 'undefined') {
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

  // Media embeds own their interactive chrome. Keep the pill away from them,
  // while letting document and card owners expose their editor from this
  // viewport-clamped control when their native header is offscreen.
  const isOnlyMediaEmbeds =
    selectedShapes.length > 0 &&
    selectedShapes.every((s) => s.type === 'media_embed');

  if (isOnlyMediaEmbeds) {
    return null;
  }

  const hasDrawings = selectedShapes.some((s) => s.type === 'draw');
  const isMultiShapeSketch = selectedShapes.length >= 2 && selectedShapes.some((s) => s.type === 'draw' || s.type === 'geo');
  // Make Real is strictly for drawings and multi-shape diagram sketches (never on solitary text/notes)
  const canMakeReal = hasDrawings || isMultiShapeSketch;
  const colorTargets = getStyleTargets(DefaultColorStyle);
  const sizeTargets = getStyleTargets(DefaultSizeStyle);
  const fillTargets = getStyleTargets(DefaultFillStyle);
  const alignTargets = getStyleTargets(DefaultTextAlignStyle);
  const hasPartialStyleSupport = [colorTargets, sizeTargets, fillTargets, alignTargets].some(
    ({ targets, skippedLocked, skippedUnsupported }) =>
      targets.length > 0 && skippedLocked + skippedUnsupported > 0
  );
  const supportsStyling = colorTargets.targets.length > 0 || sizeTargets.targets.length > 0 ||
    fillTargets.targets.length > 0 || alignTargets.targets.length > 0;
  const isReadonly = Boolean(editor?.getIsReadonly());
  const editRequestShape = selectedShapes.length === 1 &&
    ['document', 'slide_deck', 'rich_card', 'code_card', 'artifact'].includes(selectedShapes[0].type) &&
    editor && !isReadonly && !editor.isShapeOrAncestorLocked(selectedShapes[0])
    ? selectedShapes[0]
    : null;
  const artifactNetworkReviewShape = selectedShapes.length === 1 && selectedShapes[0].type === 'artifact'
    ? selectedShapes[0]
    : null;

  const resolveLayoutSelection = (type: 'align' | 'distribute') => {
    if (!editor) return { targets: [], skippedLocked: 0, skippedUnsupported: 0, mixedParents: false };
    const selected = editor.getSelectedShapes();
    return resolveSiblingTargets<TLShape>({
      selected,
      isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
      hasLockedDescendant,
      isCompatible: (shape) =>
        editor.getShapeUtil(shape).canBeLaidOut(shape, { type, shapes: selected }),
    });
  };
  const alignSelection = resolveLayoutSelection('align');
  const distributeSelection = resolveLayoutSelection('distribute');
  const groupSelection = editor
    ? resolveSiblingTargets<TLShape>({
        selected: selectedShapes,
        isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
        hasLockedDescendant,
        isCompatible: () => true,
      })
    : { targets: [], skippedLocked: 0, skippedUnsupported: 0, mixedParents: false };
  const ungroupSelection = editor
    ? resolveUngroupTargets<TLShape>({
        selected: selectedShapes,
        isLocked: (shape) => editor.isShapeOrAncestorLocked(shape),
        hasLockedDescendant,
      })
    : { targets: [], skippedLocked: 0, skippedUnsupported: 0, mixedParents: false };

  const activeSwatch = HUD_COLOR_SWATCHES.find((s) => s.tldrawColor === selectedColor);
  const viewportBounds = getFloatingViewportBounds(viewport);
  const maxToolbarWidth = viewportBounds.maxWidth;
  const maxPopoverHeight = viewportBounds.maxHeight;
  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    left: popoverPosition?.left ?? 0,
    top: popoverPosition?.top ?? 0,
    maxHeight: maxPopoverHeight,
    maxWidth: maxToolbarWidth,
    overflowY: 'auto',
    touchAction: 'pan-y',
    visibility: popoverPosition ? 'visible' : 'hidden',
  };

  return createPortal((
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: `${menuPosition.x}px`,
        top: `${menuPosition.y}px`,
        transform: 'none',
      }}
      className="studio-canvas-chrome pointer-events-auto z-[400] flex flex-col items-center select-none"
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
          <div
            ref={toolbarRef}
            data-canvas-chrome="formatting-pill"
            // Popovers are portaled, so the capsule can remain scrollable even
            // while a menu is open without clipping that menu.
            style={{
              maxWidth: maxToolbarWidth,
              maxHeight: maxPopoverHeight,
              overflowY: 'auto',
              touchAction: 'pan-y',
            }}
            className="studio-canvas-chrome flex max-w-full flex-col gap-1.5 liquid-glass-popover border border-white/14 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-3xl"
          >
            {/* Primary Quick Formatting Bar */}
            <div className="flex flex-wrap items-center justify-center gap-1">
              {/* Selection Count Badge (shown only for multi-selection) */}
              {selectedCount > 1 && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold text-slate-300">
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-slate-200 border border-white/10 tabular-nums">
                    {selectedCount}
                  </span>
                    <span className="sr-only">items selected</span>
                  <div className="h-4 w-[1px] bg-white/10 ml-0.5" />
                </div>
              )}

              {editRequestShape && (
                <button
                  type="button"
                  aria-label={`Edit content: ${editRequestShape.type.replace('_', ' ')}`}
                  title="Edit selected content"
                  onClick={() => requestShapeEditing(editRequestShape.id)}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  <span>Edit content</span>
                </button>
              )}

              {artifactNetworkReviewShape && (
                <button
                  type="button"
                  aria-label="Website access"
                  title="Review website access for this app"
                  onClick={() => requestArtifactNetworkReview(artifactNetworkReviewShape.id)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Globe className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </button>
              )}

              {(selectedCount > 1 || selectedShapes.some((shape) => shape.type === 'group')) && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Layout selected items"
                    aria-expanded={activePopover === 'layout'}
                    data-popover-trigger="layout"
                    title="Align, distribute, group, or ungroup selected items"
                    onClick={() => setActivePopover(activePopover === 'layout' ? null : 'layout')}
                    className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                      activePopover === 'layout'
                        ? 'border-white/25 bg-white/15 text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <AlignHorizontalDistributeCenter className="h-4 w-4" strokeWidth={1.5} />
                    <span>Layout</span>
                  </button>

                  <AnimatePresence>
                    {activePopover === 'layout' && (
                      <FloatingPopoverPortal key="layout" popoverRef={popoverRef} style={popoverStyle}>
                        <motion.div
                          role="group"
                          aria-label="Selection layout actions"
                          initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.97 }}
                          transition={APPLE_SPRING}
                          className="w-[248px] space-y-2 rounded-[18px] liquid-glass-popover border border-white/15 p-3 shadow-2xl backdrop-blur-3xl"
                        >
                          <section aria-labelledby="layout-align-label">
                            <p id="layout-align-label" className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Align</p>
                            <div className="grid grid-cols-3 gap-1">
                              {([
                                ['left', 'Align left', AlignHorizontalJustifyStart],
                                ['center-horizontal', 'Center horizontally', AlignHorizontalJustifyCenter],
                                ['right', 'Align right', AlignHorizontalJustifyEnd],
                                ['top', 'Align top', AlignVerticalJustifyStart],
                                ['center-vertical', 'Center vertically', AlignVerticalJustifyCenter],
                                ['bottom', 'Align bottom', AlignVerticalJustifyEnd],
                              ] as const).map(([operation, label, Icon]) => (
                                <button
                                  key={operation}
                                  type="button"
                                  aria-label={label}
                                  title={label}
                                  disabled={isReadonly || alignSelection.mixedParents || alignSelection.targets.length < 2}
                                  onClick={() => handleAlign(operation)}
                                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                                >
                                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                                </button>
                              ))}
                            </div>
                          </section>

                          <section aria-labelledby="layout-distribute-label">
                            <p id="layout-distribute-label" className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Distribute</p>
                            <div className="grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                disabled={isReadonly || distributeSelection.mixedParents || distributeSelection.targets.length < 3}
                                onClick={() => handleDistribute('horizontal')}
                                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <AlignHorizontalDistributeCenter className="h-4 w-4" strokeWidth={1.5} />
                                <span>Horizontal</span>
                              </button>
                              <button
                                type="button"
                                disabled={isReadonly || distributeSelection.mixedParents || distributeSelection.targets.length < 3}
                                onClick={() => handleDistribute('vertical')}
                                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <AlignVerticalDistributeCenter className="h-4 w-4" strokeWidth={1.5} />
                                <span>Vertical</span>
                              </button>
                            </div>
                          </section>

                          <section aria-labelledby="layout-group-label">
                            <p id="layout-group-label" className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Groups</p>
                            <div className="grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                disabled={isReadonly || groupSelection.mixedParents || groupSelection.targets.length < 2}
                                onClick={handleGroup}
                                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <Group className="h-4 w-4" strokeWidth={1.5} />
                                <span>Group</span>
                              </button>
                              <button
                                type="button"
                                disabled={isReadonly || ungroupSelection.mixedParents || ungroupSelection.targets.length < 1}
                                onClick={handleUngroup}
                                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <Ungroup className="h-4 w-4" strokeWidth={1.5} />
                                <span>Ungroup</span>
                              </button>
                            </div>
                          </section>

                          {(alignSelection.mixedParents || distributeSelection.mixedParents || groupSelection.mixedParents || ungroupSelection.mixedParents) && (
                            <p role="status" className="px-1 text-xs leading-relaxed text-amber-100/80">Align, distribute, and group actions require selected siblings in one page or group.</p>
                          )}
                          {(alignSelection.skippedUnsupported || distributeSelection.skippedUnsupported) > 0 && (
                            <p role="status" className="px-1 text-xs leading-relaxed text-slate-500">Some selected shapes do not support layout and will be skipped.</p>
                          )}
                          {(alignSelection.skippedLocked || distributeSelection.skippedLocked || groupSelection.skippedLocked || ungroupSelection.skippedLocked || ungroupSelection.skippedUnsupported) > 0 && (
                            <p role="status" className="px-1 text-xs leading-relaxed text-slate-500">Locked items and groups containing locked children are skipped.</p>
                          )}
                          {!isReadonly && !alignSelection.mixedParents && alignSelection.targets.length < 2 && !distributeSelection.mixedParents && distributeSelection.targets.length < 3 && (
                            <p role="status" className="px-1 text-xs leading-relaxed text-slate-500">Select two compatible siblings to align, or three to distribute.</p>
                          )}
                        </motion.div>
                      </FloatingPopoverPortal>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {supportsStyling && (
                <>
                  {/* 1. Color Picker Dropdown Trigger */}
                  {colorTargets.targets.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`Color: ${selectedColor === 'mixed' ? 'Mixed selection' : activeSwatch?.label || selectedColor}`}
                      aria-expanded={activePopover === 'color'}
                      data-popover-trigger="color"
                      onClick={() => setActivePopover(activePopover === 'color' ? null : 'color')}
                      className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] gap-1"
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-white/30 shadow-sm"
                        style={{
                          background: activeSwatch?.hex || 'linear-gradient(135deg, #f8fafc 0 25%, #3b82f6 25% 50%, #22c55e 50% 75%, #ef4444 75%)',
                        }}
                      />
                    </button>

                    {/* Color Swatches Popover */}
                    <AnimatePresence>
                      {activePopover === 'color' && (
                        <FloatingPopoverPortal key="color" popoverRef={popoverRef} style={popoverStyle}>
                          <motion.div
                            initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                            transition={APPLE_SPRING}
                            className="p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl w-[184px]"
                          >
                        <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-white/10 px-1">
                          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {activeSwatch?.label || 'Mixed colors'}
                          </span>
                          <label
                            aria-label="Choose the closest native tldraw color"
                            title="Custom colors map to the nearest native tldraw swatch."
                            className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white cursor-pointer px-1.5 py-0.5 rounded-lg hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] focus-within:ring-2 focus-within:ring-sky-300/70"
                          >
                            <div
                              className="h-3.5 w-3.5 rounded-full border border-white/30 shadow-sm"
                              style={{
                                background:
                                  'conic-gradient(from 180deg at 50% 50%, #ef4444 0deg, #f59e0b 60deg, #10b981 120deg, #06b6d4 180deg, #3b82f6 240deg, #8b5cf6 300deg, #ef4444 360deg)',
                              }}
                            />
                            <span>Nearest native</span>
                            <input
                              ref={colorInputRef}
                              type="color"
                              value={customHex}
                              onChange={(e) => handleCustomColor(e.target.value)}
                              disabled={isReadonly}
                              className="sr-only"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Native color swatches">
                          {HUD_COLOR_SWATCHES.map((swatch) => (
                            <button
                              key={swatch.id}
                              type="button"
                              disabled={isReadonly}
                              aria-label={swatch.label}
                              aria-pressed={selectedColor === swatch.tldrawColor}
                              onClick={() => handleColorChange(swatch.tldrawColor)}
                              className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 ${
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
                        </FloatingPopoverPortal>
                      )}
                </AnimatePresence>
              </div>
                  )}

              {/* 2. Stroke / Font Size Dropdown */}
              {sizeTargets.targets.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Size: ${selectedSize === 'mixed' ? 'Mixed selection' : selectedSize.toUpperCase()}`}
                  aria-expanded={activePopover === 'size'}
                  data-popover-trigger="size"
                  onClick={() => setActivePopover(activePopover === 'size' ? null : 'size')}
                  className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
                >
                  <span>{selectedSize === 'mixed' ? '—' : selectedSize.toUpperCase()}</span>
                </button>

                <AnimatePresence>
                  {activePopover === 'size' && (
                    <FloatingPopoverPortal key="size" popoverRef={popoverRef} style={popoverStyle}>
                      <motion.div
                        initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                        transition={APPLE_SPRING}
                        className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                      >
                        {(['s', 'm', 'l', 'xl'] as const).map((size) => (
                          <button
                            key={size}
                            type="button"
                            disabled={isReadonly}
                            aria-label={`Size ${size.toUpperCase()}`}
                            aria-pressed={selectedSize === size}
                            onClick={() => handleSizeChange(size)}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-xs font-semibold transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedSize === size
                                ? 'bg-white/20 text-white shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {size.toUpperCase()}
                          </button>
                        ))}
                      </motion.div>
                    </FloatingPopoverPortal>
                  )}
                </AnimatePresence>
              </div>
              )}

              {hasPartialStyleSupport && (
                <span className="px-1 text-xs leading-tight text-slate-500" role="status">
                  Style changes apply only to compatible, unlocked items.
                </span>
              )}

              {/* 3. Fill style appears only when the selected ShapeUtil defines it. */}
              {fillTargets.targets.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Fill style: ${selectedFill === 'mixed' ? 'Mixed selection' : selectedFill}`}
                    aria-expanded={activePopover === 'fill'}
                    data-popover-trigger="fill"
                    onClick={() => setActivePopover(activePopover === 'fill' ? null : 'fill')}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
                  >
                    {selectedFill === 'none' && <CircleOff className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedFill === 'semi' && <CircleDot className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedFill === 'solid' && <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />}
                    {selectedFill === 'pattern' && <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedFill === 'mixed' && <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />}
                  </button>

                  <AnimatePresence>
                    {activePopover === 'fill' && (
                      <FloatingPopoverPortal key="fill" popoverRef={popoverRef} style={popoverStyle}>
                        <motion.div
                          initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          transition={APPLE_SPRING}
                          className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                        >
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="No Fill"
                            aria-pressed={selectedFill === 'none'}
                            onClick={() => handleFillChange('none')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedFill === 'none'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <CircleOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Semi Fill"
                            aria-pressed={selectedFill === 'semi'}
                            onClick={() => handleFillChange('semi')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedFill === 'semi'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <CircleDot className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Solid Fill"
                            aria-pressed={selectedFill === 'solid'}
                            onClick={() => handleFillChange('solid')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedFill === 'solid'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Pattern Fill"
                            aria-pressed={selectedFill === 'pattern'}
                            onClick={() => handleFillChange('pattern')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedFill === 'pattern'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </motion.div>
                      </FloatingPopoverPortal>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 4. Text alignment appears only when the ShapeUtil defines it. */}
              {alignTargets.targets.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Text alignment: ${selectedAlign === 'mixed' ? 'Mixed selection' : selectedAlign}`}
                    aria-expanded={activePopover === 'align'}
                    data-popover-trigger="align"
                    onClick={() => setActivePopover(activePopover === 'align' ? null : 'align')}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
                  >
                    {selectedAlign === 'start' && <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedAlign === 'middle' && <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedAlign === 'end' && <AlignRight className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {selectedAlign === 'mixed' && <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />}
                  </button>

                  <AnimatePresence>
                    {activePopover === 'align' && (
                      <FloatingPopoverPortal key="align" popoverRef={popoverRef} style={popoverStyle}>
                        <motion.div
                          initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                          transition={APPLE_SPRING}
                          className="flex items-center gap-1 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl"
                        >
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Align Left"
                            aria-pressed={selectedAlign === 'start'}
                            onClick={() => handleAlignChange('start')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedAlign === 'start'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Align Center"
                            aria-pressed={selectedAlign === 'middle'}
                            onClick={() => handleAlignChange('middle')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedAlign === 'middle'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignCenter className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={isReadonly}
                            aria-label="Align Right"
                            aria-pressed={selectedAlign === 'end'}
                            onClick={() => handleAlignChange('end')}
                            className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35 ${
                              selectedAlign === 'end'
                                ? 'bg-white/20 text-white'
                                : 'text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            <AlignRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </motion.div>
                      </FloatingPopoverPortal>
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
              aria-expanded={activePopover === 'more'}
              data-popover-trigger="more"
              onClick={() => setActivePopover(activePopover === 'more' ? null : 'more')}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
            </button>

            <AnimatePresence>
              {activePopover === 'more' && (
                <FloatingPopoverPortal key="more" popoverRef={popoverRef} style={popoverStyle}>
                  <motion.div
                    initial={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: popoverPlacement === 'bottom' ? -6 : 6, scale: 0.95 }}
                    transition={APPLE_SPRING}
                    className="w-48 p-1.5 rounded-[18px] liquid-glass-popover border border-white/15 shadow-2xl backdrop-blur-3xl space-y-0.5"
                  >
                    <button
                      type="button"
                      disabled={isReadonly}
                      onClick={handleDuplicate}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Copy className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      disabled={isReadonly}
                      aria-pressed={isLocked}
                      onClick={handleToggleLock}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-35"
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
                      disabled={isReadonly}
                      onClick={handleBringToFront}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowUp className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Bring to Front</span>
                    </button>
                    <button
                      type="button"
                      disabled={isReadonly}
                      onClick={handleSendToBack}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform,filter] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowDown className="h-3.5 w-3.5 text-white/60" strokeWidth={1.5} />
                      <span>Send to Back</span>
                    </button>
                  </motion.div>
                </FloatingPopoverPortal>
              )}
            </AnimatePresence>
          </div>

          {canMakeReal && (
              <>
                <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

                {/* 6. Make Real CTA - Only for drawings/sketches/shapes, never for existing apps! */}
                <button
                  type="button"
                  onClick={handleMakeReal}
                  disabled={isReadonly || isMakingReal}
                  aria-label={isMakingReal ? 'Creating interactive app' : 'Make Real: Convert drawing to live interactive app'}
                  aria-busy={isMakingReal}
                  className={`studio-chrome-primary-action relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-45 ${isMakingReal ? 'opacity-80' : ''}`}
                >
                  {isMakingReal ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.0} />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" strokeWidth={2.0} />
                  )}
                  <span>{isMakingReal ? 'Creating…' : 'Make Real'}</span>
                </button>
              </>
            )}

            {/* 7. AI Prompt Toggle */}
            <button
              type="button"
              aria-label="AI Prompt Actions"
              aria-expanded={showAIActions}
              onClick={() => setShowAIActions(!showAIActions)}
              className={`flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] ${
                showAIActions ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <AIOrb className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* 8. Delete Button */}
            <button
              type="button"
              aria-label="Delete Selected"
              onClick={handleDelete}
              disabled={isReadonly}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            <div className="h-5 w-[1px] bg-white/10 mx-0.5" />

            {/* 9. Dismiss Button */}
            <button
              type="button"
              aria-label="Hide formatting menu"
              onClick={() => setIsDismissed(true)}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
            </div>

          {actionFeedback && (
            <p
              role="status"
              aria-live="polite"
              className="max-w-[min(92vw,36rem)] rounded-xl border border-white/10 bg-black/55 px-3 py-1.5 text-center text-xs leading-relaxed text-white/80 shadow-lg backdrop-blur-xl"
            >
              {actionFeedback}
            </p>
          )}

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
                  id="contextual-ai-prompt"
                  ref={inputRef}
                  type="text"
                  aria-label="AI instruction"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Ask AI to modify selection, 'Make Real'..."
                  disabled={isMakingReal}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-50 transition-[color,background-color,border-color,opacity,transform,filter] font-sans"
                />
                <button
                  type="submit"
                  aria-label="Send AI instruction"
                  disabled={!promptText.trim() || isMakingReal}
                  className="flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-white/15 text-white hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/15 transition-[color,background-color,border-color,opacity,transform,filter] active:scale-[0.96]"
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
  ), document.body);
};

export default ContextualFormattingPill;
