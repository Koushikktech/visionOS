'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor, TLPage, TLPageId } from '@tldraw/tldraw';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Plus,
  Check,
  Pencil,
  Copy,
  Trash2,
  Grid,
  Magnet,
  Download,
  ChevronDown,
  Layers,
  Image as ImageIcon,
  Code2,
  X,
  LayoutGrid,
} from 'lucide-react';
import { APPLE_SPRING } from '../lib/tokens';
import { runEditorOperationSafely } from '../lib/editorOperation';
import { BoardRecoveryNotice, type BoardRecoveryViewState } from './BoardRecoveryNotice';
import { clearWorkspaceSummary } from '../lib/workspaceStudio';

function scheduleFocusUnlessModal(target: () => HTMLElement | null) {
  requestAnimationFrame(() => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    target()?.focus();
  });
}
import {
  createWorkspaceBackup,
  hasDurableRecoveryCopy,
  MAX_WORKSPACE_BACKUP_BYTES,
  parseWorkspaceBackupText,
  prepareDurableRecoverySnapshot,
  prepareWorkspaceBackup,
  readDurableRecoveryCopy,
  restoreWorkspaceWithRecovery,
} from '../lib/workspaceBackup';

export interface ApplePagesPillProps {
  editor: Editor | null;
  onGoToDashboard?: () => void;
  /** Request that the existing Data & backups menu be opened once. */
  openBackupsRequest?: string;
  /** Acknowledges the request after the menu is scheduled to open. */
  onBackupsOpened?: () => void;
  recovery?: {
    state: BoardRecoveryViewState;
    onKeepCurrent(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: ReturnType<Editor['getSnapshot']>): Promise<void>;
    onRestoreRecovery(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: ReturnType<Editor['getSnapshot']>): Promise<void>;
  };
}

export const ApplePagesPill: React.FC<ApplePagesPillProps> = ({
  editor,
  recovery,
  onGoToDashboard,
  openBackupsRequest,
  onBackupsOpened,
}) => {
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [fileStatus, setFileStatus] = useState('');
  const [hasRecovery, setHasRecovery] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pages, setPages] = useState<TLPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<TLPageId | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isGridMode, setIsGridMode] = useState(true);
  const [isSnapMode, setIsSnapMode] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPopoverNode, setExportPopoverNode] = useState<HTMLDivElement | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pagesTriggerRef = useRef<HTMLButtonElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const pagesPopoverRef = useRef<HTMLDivElement>(null);
  const exportPopoverRef = useRef<HTMLDivElement>(null);
  const handledBackupsRequestRef = useRef<string | null>(null);
  const [visualViewportHeight, setVisualViewportHeight] = useState(800);
  const popoverMaxHeight = Math.max(80, visualViewportHeight - 72);
  const recoveryNeedsReview = recovery
    ? ['conflict', 'error', 'unavailable'].includes(recovery.state.status)
    : false;
  const setExportPopoverRef = useCallback((node: HTMLDivElement | null) => {
    exportPopoverRef.current = node;
    setExportPopoverNode(node);
  }, []);

  useEffect(() => {
    if (!editor || !openBackupsRequest || handledBackupsRequestRef.current === openBackupsRequest) return;
    handledBackupsRequestRef.current = openBackupsRequest;
    setIsOpen(false);
    setShowExportMenu(true);
    onBackupsOpened?.();
  }, [editor, onBackupsOpened, openBackupsRequest]);

  const closeExportMenu = () => {
    setShowExportMenu(false);
    scheduleFocusUnlessModal(() => exportTriggerRef.current);
  };

  useEffect(() => {
    const updateViewport = () => {
      setVisualViewportHeight(Math.max(160, Math.floor(window.visualViewport?.height ?? window.innerHeight)));
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || editingPageId) return;
      if ((event.target as HTMLElement | null)?.closest('[data-canvas-recovery-dialog="true"]')) return;
      if (showExportMenu) {
        event.preventDefault();
        event.stopPropagation();
        setShowExportMenu(false);
        scheduleFocusUnlessModal(() => exportTriggerRef.current);
      } else if (isOpen) {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        scheduleFocusUnlessModal(() => pagesTriggerRef.current);
      }
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [editingPageId, isOpen, showExportMenu]);

  useEffect(() => {
    if (!isOpen && !showExportMenu) return;
    const frame = requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const popover = isOpen ? pagesPopoverRef.current : exportPopoverRef.current;
      popover?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, showExportMenu]);

  // Sync pages and current page from tldraw store
  const syncState = useCallback(() => {
    if (!editor) return;
    try {
      const allPages = editor.getPages();
      setPages([...allPages]);
      setCurrentPageId(editor.getCurrentPageId());
      const instance = editor.getInstanceState();
      setIsGridMode(instance.isGridMode);
      setIsSnapMode(editor.user.getUserPreferences().isSnapMode);
    } catch {
      // Safe fallback
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    syncState();
    const unsubscribe = editor.store.listen(() => {
      syncState();
    });
    return () => {
      unsubscribe();
    };
  }, [editor, syncState]);

  useEffect(() => {
    let active = true;
    void hasDurableRecoveryCopy()
      .then((exists) => {
        if (active) setHasRecovery(exists);
      })
      .catch(() => {
        if (active) setHasRecovery(false);
      });
    return () => {
      active = false;
    };
  }, [editor]);

  // Recovery-copy availability can change after a board restore. Refresh it
  // when someone opens the existing export/recovery menu, not on every edit.
  useEffect(() => {
    if (!editor || !showExportMenu) return;
    let active = true;
    void hasDurableRecoveryCopy()
      .then((exists) => {
        if (active) setHasRecovery(exists);
      })
      .catch(() => {
        if (active) setHasRecovery(false);
      });
    return () => {
      active = false;
    };
  }, [editor, showExportMenu]);

  // Click outside & canvas click listener to immediately dismiss popovers
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const isInside =
        containerRef.current &&
        (containerRef.current.contains(target) ||
          (e.composedPath && e.composedPath().includes(containerRef.current)));

      if (!isInside) {
        setIsOpen(false);
        setShowExportMenu(false);
        setEditingPageId(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, {
      capture: true,
    });
    window.addEventListener('click', handlePointerDown, { capture: true });

    const handleEditorEvent = (info: any) => {
      if (info.name === 'pointer_down') {
        setIsOpen(false);
        setShowExportMenu(false);
        setEditingPageId(null);
      }
    };

    if (editor) {
      editor.on('event', handleEditorEvent);
    }

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, {
        capture: true,
      });
      window.removeEventListener('click', handlePointerDown, { capture: true });
      if (editor) {
        editor.off('event', handleEditorEvent);
      }
    };
  }, [editor]);

  // Auto-focus rename input
  useEffect(() => {
    if (editingPageId) {
      setTimeout(() => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        renameInputRef.current?.focus();
      }, 50);
    }
  }, [editingPageId]);

  const currentPage = pages.find((p) => p.id === currentPageId);

  const handleSelectPage = (pageId: TLPageId) => {
    if (!editor) return;
    if (pageId !== currentPageId) editor.setCurrentPage(pageId);
    setIsOpen(false);
    scheduleFocusUnlessModal(() => pagesTriggerRef.current);
  };

  const focusRenameButton = (pageId: string) => {
    scheduleFocusUnlessModal(() => renameButtonRefs.current.get(pageId) ?? null);
  };

  const handleCreatePage = () => {
    if (!editor) return;
    const newPageName = `Page ${pages.length + 1}`;
    editor.createPage({ name: newPageName });
    syncState();
  };

  const handleDuplicatePage = (pageId: TLPageId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editor) return;
    editor.duplicatePage(pageId);
    syncState();
  };

  const handleDeletePage = (pageId: TLPageId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editor || pages.length <= 1) return;
    editor.deletePage(pageId);
    syncState();
  };

  const handleStartRename = (page: TLPage, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPageId(page.id);
    setEditingName(page.name);
  };

  const handleSaveRename = (pageId: TLPageId) => {
    if (!editor) return;
    const trimmed = editingName.trim();
    if (trimmed) {
      editor.renamePage(pageId, trimmed);
    }
    setEditingPageId(null);
    syncState();
    focusRenameButton(pageId);
  };

  const handleToggleGrid = () => {
    if (!editor) return;
    const next = !isGridMode;
    editor.updateInstanceState({ isGridMode: next });
    setIsGridMode(next);
  };

  const handleToggleSnap = () => {
    if (!editor) return;
    const next = !isSnapMode;
    editor.user.updateUserPreferences({ isSnapMode: next });
    setIsSnapMode(next);
  };

  const downloadBackup = async () => {
    if (!editor) return;
    try {
      const { blob, portability } = await createWorkspaceBackup(editor.getSnapshot(), {
        resolveAssetUrl: (assetId) =>
          editor.resolveAssetUrl(assetId as Parameters<Editor['resolveAssetUrl']>[0], {
            screenScale: 1,
            shouldResolveToOriginal: true,
          }),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'visionos-workspace.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const excluded = portability.excludedAssets.length;
      setFileStatus(
        excluded
          ? `Backup downloaded with ${portability.embeddedAssetCount} local image/video asset(s) embedded. ${excluded} linked asset(s) could not be packaged; app storage is included, while chat history and provider settings are excluded.`
          : `Backup downloaded with ${portability.embeddedAssetCount} local image/video asset(s) embedded. App storage is included; chat history and provider settings are excluded.`
      );
      closeExportMenu();
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Could not create the workspace backup.');
    }
  };
  const importBackup = async (file?: File) => {
    if (!editor || !file || isRestoring) return;
    setIsRestoring(true);
    try {
      if (file.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Backup exceeds the 25 MB limit.');
      const data = parseWorkspaceBackupText(await file.text());
      const prepared = prepareWorkspaceBackup(data);
      if (
        !window.confirm(
          'Restore this workspace backup? A durable copy of your current workspace will be saved in this browser first. Imported apps will open paused. By default, external resources, connections, and form submissions are restricted; frame navigation can still open a destination that makes requests.'
        )
      )
        return;
      await restoreWorkspaceWithRecovery(
        {
          getSnapshot: () => editor.getSnapshot(),
          loadSnapshot: (snapshot, options) => { editor.loadSnapshot(snapshot, options); },
          runAtomically: (operation) => { runEditorOperationSafely(editor, operation); },
        },
        prepared.snapshot
      );
      clearWorkspaceSummary();
      setHasRecovery(true);
      syncState();
      const excluded = prepared.portability.excludedAssets?.length ?? 0;
      setFileStatus(
        `Workspace restored. Apps are paused with external resources, connections, and form submissions restricted by default. Frame navigation can still open a destination that makes requests.${
          excluded ? ` ${excluded} linked asset(s) were not embedded and may need their original files.` : ''
        }${
          prepared.migratedFrom ? ' This older backup cannot report which linked assets were packaged.' : ''
        }`
      );
    } catch (error) {
      setFileStatus(
        error instanceof Error ? error.message : 'Could not restore the backup.'
      );
    } finally {
      setIsRestoring(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
      closeExportMenu();
    }
  };

  const restorePreviousBackup = async () => {
    if (!editor || isRestoring) return;
    setIsRestoring(true);
    try {
      const savedSnapshot = await readDurableRecoveryCopy();
      if (!savedSnapshot) throw new Error('No previous workspace recovery copy is available.');
      const prepared = prepareDurableRecoverySnapshot(savedSnapshot);
      await restoreWorkspaceWithRecovery(
        {
          getSnapshot: () => editor.getSnapshot(),
          loadSnapshot: (snapshot, options) => { editor.loadSnapshot(snapshot, options); },
          runAtomically: (operation) => { runEditorOperationSafely(editor, operation); },
        },
        prepared.snapshot
      );
      clearWorkspaceSummary();
      syncState();
      setHasRecovery(true);
      setFileStatus('Previous workspace restored. Apps are paused with external resources, connections, and form submissions restricted by default. Frame navigation can still open a destination that makes requests.');
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : 'Could not restore the previous workspace.');
    } finally {
      setIsRestoring(false);
      closeExportMenu();
    }
  };

  const handleExport = async (format: 'png' | 'svg') => {
    if (!editor) return;
    setExporting(true);
    closeExportMenu();
    try {
      const shapeIds = Array.from(editor.getCurrentPageShapeIds());
      if (shapeIds.length === 0) {
        alert('Canvas page is empty. Draw or add content before exporting.');
        setExporting(false);
        return;
      }

      if (format === 'png') {
        const image = await editor.toImage(shapeIds, {
          format: 'png',
          background: true,
          padding: 32,
          scale: 2,
        });
        const url = URL.createObjectURL(image.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentPage?.name || 'canvas'}-export.png`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const svgResult = await editor.getSvgString(shapeIds, {
          background: true,
          padding: 32,
        });
        if (svgResult) {
          const blob = new Blob([svgResult.svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentPage?.name || 'canvas'}-export.svg`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      console.error('[Canvas Export] Error:', err);
      setFileStatus(
        'Export failed. Download an editable workspace backup instead.'
      );
    } finally {
      setExporting(false);
    }
  };

  const getPageShapeCount = (pageId: TLPageId) => {
    if (!editor) return 0;
    try {
      return editor.getSortedChildIdsForParent(pageId).length;
    } catch {
      return 0;
    }
  };

  return (
    <div
      ref={containerRef}
      data-canvas-chrome="pages"
      className={`studio-canvas-chrome fixed top-4 left-2 sm:left-6 ${isOpen || showExportMenu ? 'z-[500]' : 'z-[340]'} flex w-max max-w-[calc(100vw-1rem)] items-center gap-2 select-none`}
    >
      {/* ── Main Liquid Glass Capsule ── */}
      <div className="studio-canvas-chrome flex max-w-full items-center gap-0.5 sm:gap-1 p-1 rounded-full liquid-glass-pill shadow-lg border border-white/10 backdrop-blur-3xl antialiased">
        {/* visionOS Brand Emblem */}
        <div className="hidden sm:flex items-center gap-1.5 pl-3 pr-2 py-1 select-none shrink-0">
          <span className="text-[13px] font-semibold tracking-tight text-white/95">visionOS</span>
          <span className="text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/5">Spatial</span>
        </div>

        {/* Return to Dashboard Hub Button */}
        <button
          type="button"
          onClick={() => {
            if (onGoToDashboard) onGoToDashboard();
            else if (typeof window !== 'undefined') window.location.href = '/?view=dashboard';
          }}
          aria-label="Back to Studio"
          title="Back to Studio"
          className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
        >
          <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {/* Current Page Selector Button */}
        <motion.button
          ref={pagesTriggerRef}
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            setIsOpen(!isOpen);
            setShowExportMenu(false);
          }}
          aria-label={`Pages, current page ${currentPage?.name || 'Page 1'}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls="visionos-pages-popover"
          className="flex min-w-0 items-center gap-1 min-h-[44px] px-2 min-[480px]:gap-2 min-[480px]:px-3 py-1.5 rounded-full hover:bg-white/10 text-white transition-all text-xs font-medium"
        >
          <FileText className="h-3.5 w-3.5 text-white/70" strokeWidth={1.5} />
          <span className="max-w-[76px] min-[480px]:max-w-[120px] truncate">
            {currentPage?.name || 'Page 1'}
          </span>
          <span className="hidden min-[480px]:inline-flex text-[10px] font-mono tabular-nums text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full border border-white/5">
            {currentPage ? getPageShapeCount(currentPage.id) : 0}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-white/60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            strokeWidth={1.5}
          />
        </motion.button>

        <div className="hidden min-[480px]:block h-4 w-[1px] bg-white/10 mx-0.5" />

        {/* Grid Mode Toggle (Dots / Plain) */}
        <button
          type="button"
          onClick={handleToggleGrid}
          aria-label={isGridMode ? 'Hide grid dots' : 'Show grid dots'}
          aria-pressed={isGridMode}
          title={isGridMode ? 'Hide Grid Dots' : 'Show Grid Dots'}
          className={`min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
            isGridMode
              ? 'bg-white/15 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/10'
          }`}
        >
          <Grid className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {/* Snap-to-Objects Magnet Toggle */}
        <button
          type="button"
          onClick={handleToggleSnap}
          aria-label={isSnapMode ? 'Turn snapping off' : 'Turn snapping on'}
          aria-pressed={isSnapMode}
          title={isSnapMode ? 'Snapping is ON' : 'Snapping is OFF'}
          className={`min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
            isSnapMode
              ? 'bg-white/15 text-white shadow-sm'
              : 'text-white/50 hover:text-white hover:bg-white/10'
          }`}
        >
          <Magnet className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {/* Export Canvas Dropdown Trigger */}
        <div className="relative">
          <button
            ref={exportTriggerRef}
            type="button"
            onClick={() => {
              setShowExportMenu(!showExportMenu);
              setIsOpen(false);
            }}
            title={recoveryNeedsReview ? 'Recovery needs review' : 'Data and backups'}
            aria-label="Data and backups"
            aria-describedby={recovery ? 'canvas-recovery-trigger-description' : undefined}
            aria-haspopup="dialog"
            aria-expanded={showExportMenu}
            aria-controls="visionos-export-popover"
            disabled={exporting}
            className={`relative min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
              showExportMenu
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            {recovery && (recoveryNeedsReview || recovery.state.status === 'saving') && (
              <span
                aria-hidden="true"
                className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-[var(--studio-raised)] ${recoveryNeedsReview ? 'bg-amber-300' : 'bg-indigo-300'}`}
              />
            )}
          </button>

          {/* Export Options Popover */}
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                ref={setExportPopoverRef}
                id="visionos-export-popover"
                role="dialog"
                aria-label="Export options"
                aria-modal="false"
                style={{ maxHeight: popoverMaxHeight }}
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={APPLE_SPRING}
                className="absolute left-auto right-0 top-12 z-50 w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[20px] liquid-glass-popover p-2 shadow-2xl border border-white/10 space-y-1"
              >
                <div className="px-2.5 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Data &amp; backups
                </div>
                <button
                  type="button"
                  onClick={() => handleExport('png')}
                  className="w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
                >
                  <ImageIcon
                    className="h-4 w-4 text-white/60"
                    strokeWidth={1.5}
                  />
                  <span>Export as PNG (2x)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('svg')}
                  className="w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
                >
                  <Code2
                    className="h-4 w-4 text-white/60"
                    strokeWidth={1.5}
                  />
                  <span>Export as Vector SVG</span>
                </button>
                <button
                  type="button"
                  onClick={downloadBackup}
                  disabled={isRestoring}
                  className="w-full min-h-[44px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
                >
                  Download editable backup
                </button>
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  disabled={isRestoring}
                  className="w-full min-h-[44px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
                >
                  Restore workspace backup…
                </button>
                {hasRecovery && (
                  <button
                    type="button"
                    onClick={() => void restorePreviousBackup()}
                    disabled={isRestoring}
                    className="w-full min-h-[44px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
                  >
                    Restore previous workspace
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        aria-label="Restore workspace backup"
        className="hidden"
        onChange={(e) => void importBackup(e.target.files?.[0])}
      />
      {recovery && (
        <BoardRecoveryNotice
          editor={editor}
          state={recovery.state}
          menuOpen={showExportMenu}
          menuTarget={exportPopoverNode}
          onKeepCurrent={recovery.onKeepCurrent}
          onRestoreRecovery={recovery.onRestoreRecovery}
        />
      )}
      {fileStatus && (
        <button
          type="button"
          role="status"
          onClick={() => setFileStatus('')}
          className="absolute top-14 left-0 w-72 rounded-xl bg-[#202027] border border-white/20 p-3 text-xs text-white"
        >
          {fileStatus}
        </button>
      )}
      {/* ── Apple Pages Popover Drawer ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={pagesPopoverRef}
            id="visionos-pages-popover"
            role="dialog"
            aria-label="Pages"
            aria-modal="false"
            style={{ maxHeight: popoverMaxHeight }}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={APPLE_SPRING}
            className="absolute left-0 top-14 z-50 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] liquid-glass-popover p-3 shadow-[0_24px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.15)] border border-white/10 backdrop-blur-3xl"
          >
            {/* Header: Title + New Page Button */}
            <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-white/60" strokeWidth={1.5} />
                <span className="text-xs font-semibold text-white">Pages</span>
                <span className="text-[10px] font-mono tabular-nums text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">
                  {pages.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCreatePage}
                title="Create New Page"
                className="flex items-center gap-1 min-h-[44px] px-3 rounded-full bg-white/10 hover:bg-white/20 active:scale-[0.96] text-white text-[11px] font-medium transition-all"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>New</span>
              </button>
            </div>

            {/* Pages List */}
            <div className="space-y-1 max-h-[320px] overflow-y-auto custom-card-scrollbar pr-0.5">
              {pages.map((page) => {
                const isCurrent = page.id === currentPageId;
                const isEditing = editingPageId === page.id;
                const shapeCount = getPageShapeCount(page.id);

                return (
                  <div
                    key={page.id}
                    className={`page-row group relative flex items-center justify-between min-h-[44px] p-1.5 rounded-xl text-xs transition-all ${
                      isCurrent
                        ? 'bg-white/15 text-white shadow-sm border border-white/10'
                        : 'text-white/70 hover:text-white hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          ref={renameInputRef}
                          type="text"
                          aria-label={`Rename ${page.name}`}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(page.id);
                            if (e.key === 'Escape') {
                              setEditingPageId(null);
                              focusRenameButton(page.id);
                            }
                          }}
                          className="w-full min-h-[44px] bg-white/10 px-2 py-1 rounded-lg text-white text-xs outline-none border border-white/20"
                        />
                        <button
                          type="button"
                          aria-label={`Save ${page.name}`}
                          onClick={() => handleSaveRename(page.id)}
                          className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-white/10 active:scale-[0.96] transition-all shrink-0"
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-current={isCurrent ? 'page' : undefined}
                        aria-label={`Select page ${page.name}`}
                        onClick={() => handleSelectPage(page.id)}
                        className="page-row-select flex min-h-[44px] items-center gap-2 min-w-0 flex-1 mr-2 text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
                      >
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 rounded-full shrink-0 transition-all ${
                            isCurrent
                              ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                              : 'bg-white/20'
                          }`}
                        />
                        <span className="truncate font-medium flex-1">{page.name}</span>
                      </button>
                    )}

                    {/* Right: Shape Count & Action Buttons */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="page-row-shape-count text-[10px] font-mono tabular-nums text-slate-500">
                          {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'}
                        </span>

                        {/* Actions stay visible on touch; fine-pointer layouts reveal them on hover/focus. */}
                        <div className="page-row-actions flex items-center gap-0.5">
                          <button
                            type="button"
                            ref={(element) => {
                              if (element) renameButtonRefs.current.set(page.id, element);
                              else renameButtonRefs.current.delete(page.id);
                            }}
                            onClick={(e) => handleStartRename(page, e)}
                            aria-label={`Rename ${page.name}`}
                            title="Rename Page"
                            className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                          >
                            <Pencil className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDuplicatePage(page.id, e)}
                            aria-label={`Duplicate ${page.name}`}
                            title="Duplicate Page"
                            className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                          >
                            <Copy className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                          {pages.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => handleDeletePage(page.id, e)}
                              aria-label={`Delete ${page.name}`}
                              title="Delete Page"
                              className="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-lg text-white/50 hover:text-rose-400 hover:bg-white/10 active:scale-[0.96] transition-all"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ApplePagesPill;
