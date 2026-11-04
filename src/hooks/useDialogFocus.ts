'use client';

import { useEffect, useRef } from 'react';

// Only the front dialog owns Escape and Tab when a safety sheet covers an editor.
const activeDialogs: HTMLElement[] = [];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0
  );
}

/** Gives an open dialog initial focus, contains Tab navigation, handles Escape, and restores focus. */
export function useDialogFocus<T extends HTMLElement>(
  isOpen: boolean,
  onEscape: () => void
) {
  const dialogRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    activeDialogs.push(dialog);
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const initialFocus =
      dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      getFocusableElements(dialog)[0] ??
      dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      // Advance focus ourselves instead of depending on native Tab order. Safari
      // can skip a control clipped by a dialog's scroll container and move focus
      // to the page behind the dialog.
      event.preventDefault();
      const activeIndex = focusableElements.findIndex(
        (element) => element === document.activeElement
      );
      const lastIndex = focusableElements.length - 1;
      let nextIndex: number;
      if (event.shiftKey) {
        nextIndex = activeIndex <= 0 ? lastIndex : activeIndex - 1;
      } else if (activeIndex < 0 || activeIndex === lastIndex) {
        nextIndex = 0;
      } else {
        nextIndex = activeIndex + 1;
      }
      focusableElements[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const wasTopmost = activeDialogs[activeDialogs.length - 1] === dialog;
      const index = activeDialogs.lastIndexOf(dialog);
      if (index >= 0) activeDialogs.splice(index, 1);
      if (wasTopmost && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  return dialogRef;
}
