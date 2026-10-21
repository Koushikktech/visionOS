'use client';

import { Tldraw, Editor } from '@tldraw/tldraw';
import { useCallback, useState, useEffect } from 'react';
import { useSpatialWorker } from '../hooks/useSpatialWorker';
import { useSpatialAI } from '../hooks/useSpatialAI';
import { customShapeUtils } from '../shapes';
import { initPanModifierTracking, isSpacePanHeld } from '../lib/panModifier';
import { ContextualFormattingPill } from './ContextualFormattingPill';
import { AppleFloatingDock } from './AppleFloatingDock';
import { AppleViewportPill } from './AppleViewportPill';
import { ApplePagesPill } from './ApplePagesPill';
import { SpatialAIOmnibar } from './SpatialAIOmnibar';
import { AIAgentCursor } from './AIAgentCursor';
import { SpeculativeSkeletonOverlay } from './SpeculativeSkeletonOverlay';
import { VisionOnboardingModal } from './VisionOnboardingModal';

export default function Canvas() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const spatial = useSpatialWorker(editor);
  const ai = useSpatialAI(editor, spatial);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const onboarded = localStorage.getItem('visionos_onboarded_v1');
      if (!onboarded) {
        setShowOnboarding(true);
      }
    }
  }, []);

  const handleMount = useCallback((editorInstance: Editor) => {
    // Enable dotted grid mode and dark color scheme by default
    editorInstance.updateInstanceState({
      isGridMode: true,
    });
    editorInstance.user.updateUserPreferences({
      colorScheme: 'dark',
    });

    setEditor(editorInstance);
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // GLOBAL IN-CARD WHEEL & TRACKPAD INTERCEPTOR
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Decides, per wheel/trackpad event, whether the gesture should scroll a
  // card's inner content or pan/zoom the infinite canvas — using the same
  // rules as Figma/Miro/Notion-style canvases:
  //
  // 1. Pinch-to-zoom (ctrl/meta+wheel) and the Space pan-modifier ALWAYS
  //    fall straight through to tldraw, no matter what's underneath the
  //    cursor — this fixes pinch-zoom or forced-pan being swallowed by
  //    scrollable cards.
  // 2. `document.elementFromPoint()` performs a real hit-test, respecting
  //    actual paint/z-index order and `pointer-events`, so a card that is
  //    visually hidden behind a floating panel (toolbar, AI chat, etc.)
  //    never steals the wheel event. This replaces the old approach of
  //    scanning every scrollable element's bounding box in DOM order,
  //    which is both slow and blind to real stacking order — the root
  //    cause of the "glitchy near the toolbar" behavior.
  // 3. Boundary-aware hand-off: a card only consumes the wheel event while
  //    it still has room to scroll in the gesture's direction. Once a card
  //    is scrolled all the way to an edge, further scrolling in that
  //    direction passes straight through to canvas pan — so panning away
  //    from a fully-read card feels seamless instead of "stuck".
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cleanupPanTracking = initPanModifierTracking();

    const handleWheelCapture = (e: WheelEvent) => {
      // Trackpad pinch-to-zoom (ctrlKey is true on macOS trackpad pinch gestures in Chrome/Safari).
      // We MUST call preventDefault to stop the browser from zooming the entire page/GUI,
      // letting tldraw cleanly zoom only the infinite canvas!
      if (e.ctrlKey) {
        e.preventDefault();
        return;
      }

      if (e.metaKey || isSpacePanHeld()) return;

      // Real hit-test at the cursor — respects actual visual stacking order,
      // so a floating panel that visually covers a card always wins, and a
      // card is only ever a candidate when the cursor is genuinely over it.
      const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!hitEl) return;

      const scrollable = hitEl.closest<HTMLElement>('[data-scrollable="true"]');
      if (!scrollable) return; // Not over scrollable card content -> let tldraw pan/zoom normally.

      // Normalize deltas across trackpads, smooth mice, and notch wheels.
      let dy = e.deltaY;
      let dx = e.deltaX;
      if (e.deltaMode === 1) {
        // "line" mode
        dy *= 16;
        dx *= 16;
      } else if (e.deltaMode === 2) {
        // "page" mode
        dy *= scrollable.clientHeight;
        dx *= scrollable.clientWidth;
      }

      // Boundary-aware intent check: only claim the event if the card still
      // has room to scroll in the gesture's direction. Once it's fully
      // scrolled to an edge, the event falls through to canvas panning.
      const canScrollUp = scrollable.scrollTop > 0;
      const canScrollDown = scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 1;
      const canScrollLeft = scrollable.scrollLeft > 0;
      const canScrollRight = scrollable.scrollLeft + scrollable.clientWidth < scrollable.scrollWidth - 1;

      const verticalIntent = dy !== 0 && ((dy > 0 && canScrollDown) || (dy < 0 && canScrollUp));
      const horizontalIntent = dx !== 0 && ((dx > 0 && canScrollRight) || (dx < 0 && canScrollLeft));

      if (!verticalIntent && !horizontalIntent) return;

      e.preventDefault();
      e.stopPropagation();

      if (verticalIntent) scrollable.scrollTop += dy;
      if (horizontalIntent) scrollable.scrollLeft += dx;
    };

    // Safari-specific gesture prevention to stop whole-page rubberband / zoom
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    window.addEventListener('wheel', handleWheelCapture, {
      capture: true,
      passive: false,
    });
    window.addEventListener('gesturestart', preventGesture, { passive: false });
    window.addEventListener('gesturechange', preventGesture, { passive: false });
    window.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheelCapture, {
        capture: true,
      });
      window.removeEventListener('gesturestart', preventGesture);
      window.removeEventListener('gesturechange', preventGesture);
      window.removeEventListener('gestureend', preventGesture);
      cleanupPanTracking();
    };
  }, []);

  // Keyboard controls & Esc hierarchy
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);

      if (e.key === 'Escape') {
        // 1. If typing in an input, blur it
        if (isEditingText) {
          target?.blur();
          return;
        }

        // 2. If any popup/popover is currently open, let its local handler close it
        const hasOpenPopup = document.querySelector(
          '.liquid-glass-popover, aside[aria-label*="Siri"], aside[aria-label*="visionOS"], aside[data-visionos-panel="true"]'
        );
        if (hasOpenPopup) {
          return;
        }

        if (!editor) return;

        // 3. If shapes are selected, deselect them smoothly
        const selectedIds = editor.getSelectedShapeIds();
        if (selectedIds.length > 0) {
          e.preventDefault();
          editor.selectNone();
          return;
        }

        // 4. If in a non-default tool (draw, text, note, geo, arrow, eraser, hand),
        // smoothly default back to selection tool
        const currentTool = editor.getCurrentToolId();
        if (currentTool !== 'select') {
          e.preventDefault();
          editor.setCurrentTool('select');
        }
      } else if (!isEditingText && (!editor || editor.getEditingShapeId() === null)) {
        // Mac Delete / Backspace or PC Delete to delete selected shapes
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (!editor) return;
          const selectedIds = editor.getSelectedShapeIds();
          if (selectedIds.length > 0) {
            e.preventDefault();
            editor.deleteShapes(selectedIds);
            return;
          }
        }

        // Canvas Undo (Cmd+Z / Ctrl+Z) & Redo (Cmd+Shift+Z / Ctrl+Y)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          if (!editor) return;
          e.preventDefault();
          if (e.shiftKey) {
            if (editor.getCanRedo()) editor.redo();
          } else {
            if (editor.getCanUndo()) editor.undo();
          }
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
          if (!editor) return;
          e.preventDefault();
          if (editor.getCanRedo()) editor.redo();
        } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          // Standard single-key tool shortcuts
          if (!editor) return;
          const key = e.key.toLowerCase();
          if (key === 'v') {
            editor.setCurrentTool('select');
          } else if (key === 'h') {
            editor.setCurrentTool('hand');
          } else if (key === 'd' || key === 'p') {
            editor.setCurrentTool('draw');
          } else if (key === 't') {
            editor.setCurrentTool('text');
          } else if (key === 'n') {
            editor.setCurrentTool('note');
          } else if (key === 'r') {
            editor.setCurrentTool('geo');
          } else if (key === 'a') {
            editor.setCurrentTool('arrow');
          } else if (key === 'e') {
            editor.setCurrentTool('eraser');
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [editor]);

  // Synchronize canvas dragging/pointing state to shield iframes from eating pointer events during lasso/pan/drag
  const [isCanvasDragging, setIsCanvasDragging] = useState(false);

  useEffect(() => {
    let isPointerDown = false;

    const setDragActive = (active: boolean) => {
      setIsCanvasDragging(active);
      document.documentElement.classList.toggle('canvas-is-dragging', active);
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Ignore HUD interactions
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('.liquid-glass-dock, .liquid-glass-popover, aside[aria-label*="Siri"], .canvasos-hud, .visionos-hud') ||
        target?.closest('aside[data-visionos-panel="true"], aside[aria-label*="visionOS"]')
      ) {
        return;
      }
      if (e.button === 0 || e.button === 1) {
        isPointerDown = true;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isPointerDown && e.buttons > 0) {
        setDragActive(true);
      }
    };

    const handlePointerUp = () => {
      isPointerDown = false;
      setDragActive(false);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('pointermove', handlePointerMove, { capture: true });
    window.addEventListener('pointerup', handlePointerUp, { capture: true });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true });
    window.addEventListener('blur', handlePointerUp);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
      window.removeEventListener('pointerup', handlePointerUp, { capture: true });
      window.removeEventListener('pointercancel', handlePointerUp, { capture: true });
      window.removeEventListener('blur', handlePointerUp);
      document.documentElement.classList.remove('canvas-is-dragging');
    };
  }, []);

  return (
    <main
      className={`canvas-wrapper fixed inset-0 w-screen h-screen bg-[#0b0d18] select-none ${
        isCanvasDragging ? 'canvas-is-dragging' : ''
      }`}
    >
      {/* Apple-Grade Pages & Canvas Manager Pill (Top-Left) */}
      <ApplePagesPill editor={editor} />

      {/* Apple-Grade Floating Island Dock (Bottom HUD Primary Controls) */}
      <AppleFloatingDock editor={editor} />

      {/* Floating Viewport & History Pill (Bottom-Left) */}
      <AppleViewportPill editor={editor} />

      {/* Selection-Attached Contextual Formatting Pill */}
      <ContextualFormattingPill editor={editor} spatial={spatial} ai={ai} />

      {/* visionOS Spatial Intelligence Liquid Glass AI Assistant & Omnibar */}
      <SpatialAIOmnibar ai={ai} spatial={spatial} />

      {/* visionOS First-Time User Interactive Onboarding Flow */}
      <VisionOnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        geminiKeys={ai.geminiApiKeys}
        onSaveGeminiKey={(k) => {
          ai.addGeminiKey(k);
          ai.setProvider('gemini');
        }}
        selectedModel={ai.geminiModel}
        onSelectModel={(m) => {
          ai.setGeminiModel(m);
          ai.setProvider('gemini');
        }}
        editor={editor}
      />

      {/* Glowing Speculative Skeleton Overlay (<150ms TTFT Wireframes) */}
      <SpeculativeSkeletonOverlay editor={editor} skeletons={spatial.skeletons} />

      {/* Visual Spatial Ghost Cursor showing live AI creation coordinates */}
      <AIAgentCursor presence={ai.agentPresence} multiPresences={ai.multiPresences} />

      {/* Tldraw Canvas Core with Custom Shape Utilities & Persistence.
          Default tldraw UI chrome is completely hidden (hideUi={true}) in favor
          of the custom Apple-grade floating Island Dock and HUD system. */}
      <Tldraw
        hideUi={true}
        persistenceKey="visionos-board-store"
        shapeUtils={customShapeUtils}
        autoFocus
        inferDarkMode
        onMount={handleMount}
      />
    </main>
  );
}
