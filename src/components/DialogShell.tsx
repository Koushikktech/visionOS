'use client';

import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import './provider-dialog.css';
import './assistant-glass.css';

export interface DialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
  className?: string;
}

/** Shared, viewport-bounded dialog used by provider setup and optional help. */
export function DialogShell({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  dismissOnBackdrop = true,
  labelledBy,
  className = '',
}: DialogShellProps) {
  const generatedId = useId();
  const titleId = labelledBy ?? `studio-dialog-title-${generatedId}`;
  const descriptionId = description ? `studio-dialog-description-${generatedId}` : undefined;
  const viewport = useVisibleViewport();
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);

  if (!isOpen || typeof document === 'undefined') return null;

  const top = viewport.top + viewport.safeAreaInsets.top + 12;
  const left = viewport.left + viewport.safeAreaInsets.left + 12;
  const width = Math.max(0, viewport.width - viewport.safeAreaInsets.left - viewport.safeAreaInsets.right - 24);
  const height = Math.max(0, viewport.height - viewport.safeAreaInsets.top - viewport.safeAreaInsets.bottom - 24);

  return createPortal(
    <div
      className="studio-dialog-backdrop"
      style={{ position: 'fixed', left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height }}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="studio-dialog-positioner"
        style={{ left, top, width, height }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={`studio-dialog-surface ${className}`.trim()}
        >
          <header className="studio-dialog-header">
            <div className="studio-dialog-heading">
              <h2 id={titleId} data-dialog-initial-focus tabIndex={-1} className="studio-dialog-title">
                {title}
              </h2>
              {description && <p id={descriptionId} className="studio-dialog-description">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="studio-dialog-close"
            >
              <X aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          </header>
          <div className="studio-dialog-body">{children}</div>
          {footer && <footer className="studio-dialog-footer">{footer}</footer>}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default DialogShell;
