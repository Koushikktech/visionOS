'use client';

import { useWorkspaceActive } from './WorkspaceActivity';

import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useVisibleViewport } from '../hooks/useVisibleViewport';

/** An unscaled, keyboard-aware editing surface for content hosted on the zoomable canvas. */
export function ShapeFocusLayer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const workspaceActive = useWorkspaceActive();
  const viewport = useVisibleViewport();
  const dialogRef = useDialogFocus<HTMLDivElement>(workspaceActive, onClose);
  if (!workspaceActive || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} editor`}
      tabIndex={-1}
      className="studio-focus-backdrop fixed z-[10020] flex items-center justify-center outline-none"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
      onKeyUp={(event) => event.stopPropagation()}
      style={{
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        padding: 'max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))',
      }}
    >
      <section className="studio-focus-surface flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border shadow-2xl">
        <header className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
          <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
          <button
            type="button"
            data-dialog-initial-focus
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 hover:bg-white/10"
            aria-label="Return to canvas"
            title="Return to canvas"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </section>
    </div>,
    document.body
  );
}
