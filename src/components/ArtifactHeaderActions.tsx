'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { useWorkspaceActive } from './WorkspaceActivity';
import './canvas-chrome.css';
import './ArtifactHeaderActions.css';

export type ArtifactHeaderAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect?: (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  pressed?: boolean;
};

export type ArtifactHeaderPrimaryAction = Omit<ArtifactHeaderAction, 'id' | 'destructive' | 'separatorBefore'>;

type ArtifactHeaderActionsProps = {
  menuLabel: string;
  primaryAction?: ArtifactHeaderPrimaryAction;
  actions?: ArtifactHeaderAction[];
};

type MenuPosition = { left: number; top: number; maxHeight: number; ready: boolean };

function getFocusableItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) =>
    item.tabIndex >= 0 && !item.matches(':disabled') && item.getAttribute('aria-disabled') !== 'true'
  );
}

export function ArtifactHeaderActions({
  menuLabel,
  primaryAction,
  actions = [],
}: ArtifactHeaderActionsProps) {
  const workspaceActive = useWorkspaceActive();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: 0, top: 0, maxHeight: 0, ready: false });
  const actionMenuLabel = menuLabel;

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus && workspaceActive) {
      requestAnimationFrame(() => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        triggerRef.current?.focus();
      });
    }
  }, [workspaceActive]);

  useEffect(() => {
    if (!workspaceActive) setOpen(false);
  }, [workspaceActive]);

  useLayoutEffect(() => {
    if (!open || !workspaceActive || !menuRef.current || !triggerRef.current) return;
    const measure = () => {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (!menu || !trigger) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const padding = 8;
      const width = Math.min(menu.offsetWidth || 280, Math.max(200, viewportWidth - padding * 2));
      const height = Math.min(menu.scrollHeight, Math.max(88, viewportHeight - padding * 2));
      const anchor = trigger.getBoundingClientRect();
      const left = Math.max(leftEdge + padding, Math.min(anchor.right - width, leftEdge + viewportWidth - width - padding));
      const below = anchor.bottom + 6;
      const above = anchor.top - height - 6;
      const top = below + height <= topEdge + viewportHeight - padding
        ? below
        : Math.max(topEdge + padding, above);
      setPosition({ left, top, maxHeight: viewportHeight - padding * 2, ready: true });
    };

    measure();
    const resizeObserver = typeof ResizeObserver !== 'undefined' && menuRef.current
      ? new ResizeObserver(measure)
      : null;
    if (menuRef.current) resizeObserver?.observe(menuRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [open, workspaceActive, actions.length]);

  useEffect(() => {
    if (!open || !workspaceActive) return;
    const focusFrame = requestAnimationFrame(() => getFocusableItems(menuRef.current)[0]?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      const menu = menuRef.current;
      if (!menu) return;
      const items = getFocusableItems(menu);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number | null = null;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1 + items.length) % items.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = items.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        items[nextIndex]?.focus();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closeMenu, open, workspaceActive]);

  const handleAction = (action: ArtifactHeaderAction, event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    event.stopPropagation();
    action.onSelect?.(event);
    closeMenu(true);
  };

  const renderPrimary = () => {
    if (!primaryAction || !workspaceActive) return null;
    const content = (
      <>
        {primaryAction.icon}
        <span className="studio-artifact-action-label">{primaryAction.label}</span>
      </>
    );
    const className = 'studio-artifact-primary-action';
    if (primaryAction.href) {
      return (
        <a
          href={primaryAction.href}
          target={primaryAction.target}
          rel={primaryAction.rel}
          aria-label={primaryAction.label}
          title={primaryAction.label}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); primaryAction.onSelect?.(event); }}
          className={className}
        >
          {content}
        </a>
      );
    }
    return (
      <button
        type="button"
        disabled={primaryAction.disabled}
        aria-label={primaryAction.label}
        aria-pressed={primaryAction.pressed}
        title={primaryAction.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); primaryAction.onSelect?.(event); }}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {content}
      </button>
    );
  };

  return (
    <div ref={rootRef} data-canvas-chrome="native-header-actions" className="studio-artifact-actions" onPointerDown={(event) => event.stopPropagation()}>
      {renderPrimary()}
      {actions.length > 0 && workspaceActive && (
        <button
          ref={triggerRef}
          type="button"
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          title={menuLabel}
          onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
          className="studio-artifact-overflow-trigger"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {open && workspaceActive && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={actionMenuLabel}
          data-canvas-chrome="native-header-menu"
          className="studio-artifact-overflow-menu"
          style={{
            left: position.left,
            top: position.top,
            maxHeight: position.maxHeight || 'calc(100dvh - 16px)',
            visibility: position.ready ? 'visible' : 'hidden',
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actions.map((action) => (
            <React.Fragment key={action.id}>
              {action.separatorBefore && <div className="studio-artifact-menu-separator" role="separator" />}
              {action.href ? (
                <a
                  role="menuitem"
                  href={action.href}
                  target={action.target}
                  rel={action.rel}
                  aria-disabled={action.disabled || undefined}
                  tabIndex={action.disabled ? -1 : 0}
                  className={`studio-artifact-menu-item ${action.destructive ? 'is-destructive' : ''}`}
                  onClick={(event) => {
                    if (action.disabled) { event.preventDefault(); return; }
                    handleAction(action, event);
                  }}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </a>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  disabled={action.disabled}
                  className={`studio-artifact-menu-item ${action.destructive ? 'is-destructive' : ''}`}
                  onClick={(event) => handleAction(action, event)}
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              )}
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
