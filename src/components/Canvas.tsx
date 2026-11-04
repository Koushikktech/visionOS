'use client';

import { Tldraw, Editor, PageRecordType } from '@tldraw/tldraw';
import { useCallback, useState, useEffect, useRef } from 'react';
import { MotionConfig } from 'framer-motion';
import { useSpatialWorker } from '../hooks/useSpatialWorker';
import { useSpatialAI } from '../hooks/useSpatialAI';
import { useBoardRecovery } from '../hooks/useBoardRecovery';
import { customShapeUtils } from '../shapes';
import { initPanModifierTracking, isSpacePanHeld } from '../lib/panModifier';
import { readLocalStorage, writeLocalStorage } from '../lib/browserStorage';
import { ContextualFormattingPill } from './ContextualFormattingPill';
import { AppleFloatingDock } from './AppleFloatingDock';
import { AppleViewportPill } from './AppleViewportPill';
import { ApplePagesPill } from './ApplePagesPill';
import { SpatialAIOmnibar } from './SpatialAIOmnibar';
import { AIAgentCursor } from './AIAgentCursor';
import { SpeculativeSkeletonOverlay } from './SpeculativeSkeletonOverlay';
import { captureWorkspaceSummary, writeWorkspaceSummary, type WorkspaceLaunchIntent } from '../lib/workspaceStudio';
import { WorkspaceActivity } from './WorkspaceActivity';
import { insertStudioExample } from '../lib/studioExamples';
import { runEditorOperationSafely } from '../lib/editorOperation';
import { getCanvasTouchAction, shouldRoutePinchToCanvas } from '../lib/canvasGesturePolicy';

export interface CanvasProps {
  active?: boolean;
  onGoToDashboard?: () => void;
  launchIntent?: WorkspaceLaunchIntent;
  onIntentConsumed?: (id: string) => void;
}

let sessionHintDismissed = false;

export default function Canvas({ active = true, onGoToDashboard, launchIntent, onIntentConsumed }: CanvasProps = {}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [retry, setRetry] = useState(0);
  const [composerDraft, setComposerDraft] = useState<{id: string; text: string}>();
  const [backupsRequest, setBackupsRequest] = useState<string>();
  const spatial = useSpatialWorker(editor);
  const ai = useSpatialAI(editor, spatial);
  const recovery = useBoardRecovery(editor);
  const executed = useRef(new Set<string>());
  const failedIntent = useRef<string | null>(null);

  useEffect(() => {
    setShowHint(!sessionHintDismissed && !readLocalStorage('visionos_onboarded_v1').value);
  }, []);
  const dismissHint = () => {
    sessionHintDismissed = true;
    writeLocalStorage('visionos_onboarded_v1', 'true');
    setShowHint(false);
  };

  const handleMount = useCallback((instance: Editor) => {
    instance.updateInstanceState({ isGridMode: true });
    setEditor(instance);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const syncAppearance = () => {
      const preference = document.documentElement.dataset.appearance;
      editor.user.updateUserPreferences({ colorScheme: preference === 'light' || preference === 'dark' ? preference : 'system' });
    };
    syncAppearance();
    window.addEventListener('visionos:appearance-change', syncAppearance);
    return () => window.removeEventListener('visionos:appearance-change', syncAppearance);
  }, [editor]);

  useEffect(() => {
    if (!active || !editor || !launchIntent || executed.current.has(launchIntent.id) || failedIntent.current === launchIntent.id) return;
    if (recovery.status === 'checking' || recovery.status === 'conflict') return;
    try {
      // Restore public viewport geometry after the single editor becomes visible.
      editor.updateViewportScreenBounds(editor.getContainer(), true);
      if (launchIntent.kind !== 'open' && editor.getIsReadonly()) throw new Error('This canvas is read-only. Open a writable canvas to continue.');
      if (launchIntent.kind === 'open' && launchIntent.pageId) {
        const page = editor.getPages().find((page) => page.id === launchIntent.pageId);
        if (page) editor.setCurrentPage(page.id);
      } else if (launchIntent.kind === 'new-page') {
        const pageId = PageRecordType.createId('studio-' + launchIntent.id);
        if (!editor.getPages().some((page) => page.id === pageId)) {
          if (editor.getPages().length >= editor.options.maxPages) throw new Error('The canvas has reached its page limit. Open an existing page to continue.');
          const mark = editor.markHistoryStoppingPoint('new-studio-page');
          runEditorOperationSafely(editor, () => {
            editor.createPage({ id: pageId, name: 'Untitled page' });
            if (!editor.getPage(pageId)) throw new Error('The page could not be created. Your existing pages are unchanged.');
            editor.setCurrentPage(pageId);
          }, mark, { attempted: false });
        } else editor.setCurrentPage(pageId);
        editor.setCurrentTool('draw');
        setShowHint(true);
      } else if (launchIntent.kind === 'example') {
        insertStudioExample(editor, launchIntent.example ?? 'field-notes', launchIntent.id);
        setShowHint(true);
      } else if (launchIntent.kind === 'draft') {
        setComposerDraft({ id: launchIntent.id, text: launchIntent.draft ?? '' });
      } else if (launchIntent.kind === 'restore') {
        setBackupsRequest(launchIntent.id);
      }
      executed.current.add(launchIntent.id);
      onIntentConsumed?.(launchIntent.id);
      setLaunchError('');
    } catch (error) {
      failedIntent.current = launchIntent.id;
      setLaunchError(error instanceof Error ? error.message : 'Could not open this action. Your canvas is still available.');
    }
  }, [active, editor, launchIntent, recovery.status, onIntentConsumed, retry]);

  // Metadata is a bounded, inert overview of hydrated records, never a save acknowledgement.
  useEffect(() => {
    if (!editor || recovery.status === 'checking' || recovery.status === 'conflict') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = () => {
      try { writeWorkspaceSummary(captureWorkspaceSummary(editor)); } catch { /* Preview failure cannot affect saving. */ }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(capture, 800);
    };
    capture();
    const unlisten = editor.store.listen(schedule, { source: 'all' });
    return () => { clearTimeout(timer); unlisten(); capture(); };
  }, [editor, recovery.status]);

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
    if (!active) return;
    const cleanupPanTracking = initPanModifierTracking();

    const getGestureTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return { insideCanvas: false, insideChrome: false, editable: false };
      }

      return {
        insideCanvas: Boolean(target.closest('.tl-canvas')),
        insideChrome: Boolean(
          target.closest(
            '[data-canvas-chrome], [data-visionos-panel="true"], .visionos-hud, .canvasos-hud, [role="dialog"]'
          )
        ),
        editable: Boolean(
          target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
        ),
      };
    };

    const handleWheelCapture = (e: WheelEvent) => {
      const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;

      // Reserve trackpad pinch for tldraw only over the drawing surface. Over
      // controls and editors, preserve browser zoom for readability.
      if (e.ctrlKey) {
        if (shouldRoutePinchToCanvas(getGestureTarget(hitEl))) e.preventDefault();
        else e.stopPropagation();
        return;
      }

      if (e.metaKey || isSpacePanHeld()) return;
      if (!hitEl) return;

      // Native panes outside the tldraw canvas keep their own wheel handling.
      if (!hitEl.closest('.tl-canvas')) return;

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

    // Safari exposes trackpad pinch separately from wheel events. Block page
    // zoom only over the canvas so browser zoom remains available over chrome
    // and editor dialogs.
    const handleGesture = (e: Event) => {
      if (shouldRoutePinchToCanvas(getGestureTarget(e.target))) e.preventDefault();
      else e.stopPropagation();
    };

    // tldraw intentionally sets touch-action:none on its canvas. Before a
    // touch begins inside a marked content pane, allow the browser's native
    // one-finger vertical scrolling. Blank canvas gestures remain owned by
    // tldraw, including pinch zoom.
    const handleTouchPointerOver = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof Element)) return;
      const canvas = e.target.closest<HTMLElement>('.tl-canvas');
      if (!canvas) return;
      canvas.style.touchAction = getCanvasTouchAction(
        Boolean(e.target.closest('[data-scrollable="true"]'))
      );
    };

    const handleTouchPointerOut = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof Element)) return;
      const canvas = e.target.closest<HTMLElement>('.tl-canvas');
      if (!canvas) return;
      const currentPane = e.target.closest('[data-scrollable="true"]');
      const nextTarget = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      const nextPane = nextTarget?.closest('[data-scrollable="true"]') ?? null;
      if (currentPane !== nextPane) {
        canvas.style.touchAction = getCanvasTouchAction(Boolean(nextPane));
      }
    };

    const resetTouchAction = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof Element)) return;
      const canvas = e.target.closest<HTMLElement>('.tl-canvas');
      if (canvas) canvas.style.touchAction = 'none';
    };

    window.addEventListener('wheel', handleWheelCapture, {
      capture: true,
      passive: false,
    });
    window.addEventListener('gesturestart', handleGesture, { passive: false });
    window.addEventListener('gesturechange', handleGesture, { passive: false });
    window.addEventListener('gestureend', handleGesture, { passive: false });
    window.addEventListener('pointerover', handleTouchPointerOver, true);
    window.addEventListener('pointerout', handleTouchPointerOut, true);
    window.addEventListener('pointerup', resetTouchAction, true);
    window.addEventListener('pointercancel', resetTouchAction, true);

    return () => {
      window.removeEventListener('wheel', handleWheelCapture, {
        capture: true,
      });
      window.removeEventListener('gesturestart', handleGesture);
      window.removeEventListener('gesturechange', handleGesture);
      window.removeEventListener('gestureend', handleGesture);
      window.removeEventListener('pointerover', handleTouchPointerOver, true);
      window.removeEventListener('pointerout', handleTouchPointerOut, true);
      window.removeEventListener('pointerup', resetTouchAction, true);
      window.removeEventListener('pointercancel', resetTouchAction, true);
      cleanupPanTracking();
    };
  }, [active]);

  // Keyboard controls & Esc hierarchy
  useEffect(() => {
    if (!active) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
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
        setShowHint(true);
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
  }, [editor, active]);

  // Synchronize canvas dragging/pointing state to shield iframes from eating pointer events during lasso/pan/drag
  const [isCanvasDragging, setIsCanvasDragging] = useState(false);

  useEffect(() => {
    if (!active) return;
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
        target?.closest('aside[data-visionos-panel="true"], aside[aria-label*="visionOS"], [data-scrollable="true"]')
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
  }, [active]);

  useEffect(() => {
    if (!editor) return;
    if (active) {
      editor.updateViewportScreenBounds(editor.getContainer(), true);
      editor.focus();
    }
    else {
      editor.complete();
      editor.blur();
      try { writeWorkspaceSummary(captureWorkspaceSummary(editor)); } catch {}
    }
  }, [editor, active]);

  return (
    <WorkspaceActivity.Provider value={active}>
    <MotionConfig reducedMotion="user">
      <main
        aria-hidden={!active}
        inert={!active}
        style={active ? undefined : { display: 'none' }}
        className={`canvas-wrapper fixed inset-0 w-screen h-screen bg-[var(--studio-workspace)] select-none ${
          isCanvasDragging ? 'canvas-is-dragging' : ''
        }`}
      >
      {/* Apple-Grade Pages & Canvas Manager Pill (Top-Left) */}
      <ApplePagesPill
        editor={editor}
        openBackupsRequest={backupsRequest}
        onBackupsOpened={() => setBackupsRequest(undefined)}
        onGoToDashboard={onGoToDashboard}
        recovery={{
          state: recovery,
          onKeepCurrent: recovery.keepCurrent,
          onRestoreRecovery: recovery.restoreRecovery,
        }}
      />

      {/* Apple-Grade Floating Island Dock (Bottom HUD Primary Controls) */}
      <AppleFloatingDock editor={editor} />

      {/* Floating Viewport & History Pill (Bottom-Left) */}
      <AppleViewportPill editor={editor} />

      {/* Selection-Attached Contextual Formatting Pill */}
      <ContextualFormattingPill editor={editor} spatial={spatial} ai={ai} />

      {/* visionOS Spatial Intelligence Liquid Glass AI Assistant & Omnibar */}
      <SpatialAIOmnibar active={active} ai={ai} spatial={spatial} initialDraft={composerDraft?.text} draftId={composerDraft?.id} onDraftConsumed={() => setComposerDraft(undefined)} />

      {showHint && <aside data-canvas-chrome className="studio-canvas-hint" aria-label="Canvas tip">
        <div><strong>Try one thing</strong><p>Add a note, draw a shape, or ask AI. Select the sample sketch to explore its finished app.</p></div>
        <button type="button" onClick={dismissHint} aria-label="Dismiss canvas tip">Dismiss</button>
      </aside>}
      {launchIntent && recovery.status === 'conflict' && <aside data-canvas-chrome className="studio-launch-status" role="status">A recovery copy needs review. Review it in Data &amp; backups; your requested action will wait.</aside>}
      {launchError && <aside data-canvas-chrome className="studio-launch-status" role="alert">{launchError}<button type="button" onClick={() => { failedIntent.current = null; setLaunchError(''); setRetry((n) => n + 1); }}>Retry action</button><button type="button" onClick={() => { if (launchIntent) onIntentConsumed?.(launchIntent.id); setLaunchError(''); }}>Dismiss</button></aside>}

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
    </MotionConfig>
    </WorkspaceActivity.Provider>
  );
}
