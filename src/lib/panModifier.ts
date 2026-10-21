// ─────────────────────────────────────────────────────────────────────────
// SHARED CANVAS PAN-MODIFIER TRACKER
// ─────────────────────────────────────────────────────────────────────────
//
// Provides a single source of truth for "the user explicitly wants to pan
// the canvas right now" — used by both the global wheel interceptor
// (Canvas.tsx) and every card shape's pointerdown handler, so that:
//
//   1. Holding Space (tldraw's own established pan modifier) always pans,
//      even if the pointer/wheel started on top of a card's content.
//   2. Middle-mouse-button drags always pan, matching standard app
//      conventions (Figma, Miro, VS Code, browsers, etc.).
//
// The listeners are attached exactly once (guarded by `attached`), no
// matter how many cards/components import this module.
// ─────────────────────────────────────────────────────────────────────────

let spaceHeld = false;
let attached = false;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function setPanMode(active: boolean) {
  spaceHeld = active;
  document.documentElement.classList.toggle('canvas-pan-mode', active);
}

function onKeyDown(e: KeyboardEvent) {
  // Never hijack Space while the user is typing in an editable field.
  if (e.code === 'Space' && !e.repeat && !isEditableTarget(e.target)) {
    setPanMode(true);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    setPanMode(false);
  }
}

function reset() {
  setPanMode(false);
}

/**
 * Attaches the (singleton) window-level listeners that track the pan
 * modifier. Safe to call from multiple components; only attaches once.
 * Returns a cleanup function (only the first caller's cleanup actually
 * detaches the listeners).
 */
export function initPanModifierTracking(): () => void {
  if (typeof window === 'undefined' || attached) {
    return () => {};
  }
  attached = true;

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);

  return () => {
    attached = false;
    setPanMode(false);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', reset);
    document.removeEventListener('visibilitychange', reset);
  };
}

export function isSpacePanHeld(): boolean {
  return spaceHeld;
}

/** True when the given pointer/mouse event should force canvas panning. */
export function isForcePanEvent(e: { button?: number }): boolean {
  return spaceHeld || e.button === 1;
}

/**
 * Drop-in replacement for tldraw's `stopEventPropagation` that lets the
 * event through (so tldraw can pan/select as usual) whenever the pan
 * modifier is active, and otherwise stops it as before (so text
 * selection, scrolling, and inputs inside cards keep working normally).
 */
export function smartStopPropagation(e: { stopPropagation: () => void; button?: number }): void {
  if (isForcePanEvent(e)) return;
  e.stopPropagation();
}
