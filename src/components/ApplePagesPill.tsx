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
} from 'lucide-react';
import { APPLE_SPRING } from '../lib/tokens';

export interface ApplePagesPillProps {
  editor: Editor | null;
}

export const ApplePagesPill: React.FC<ApplePagesPillProps> = ({ editor }) => {
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [fileStatus, setFileStatus] = useState('');
  const [previousBackup, setPreviousBackup] = useState<ReturnType<
    Editor['getSnapshot']
  > | null>(null);
  const [pages, setPages] = useState<TLPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<TLPageId | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isGridMode, setIsGridMode] = useState(true);
  const [isSnapMode, setIsSnapMode] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [editingPageId]);

  const currentPage = pages.find((p) => p.id === currentPageId);

  const handleSelectPage = (pageId: TLPageId) => {
    if (!editor || pageId === currentPageId) return;
    editor.setCurrentPage(pageId);
    setIsOpen(false);
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

  const downloadBackup = () => {
    if (!editor) return;
    const blob = new Blob(
      [
        JSON.stringify({
          format: 'canvasos-backup-v1',
          snapshot: editor.getSnapshot(),
        }),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'canvasos-workspace.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFileStatus('Workspace backup downloaded.');
    setShowExportMenu(false);
  };
  const importBackup = async (file?: File) => {
    if (!editor || !file) return;
    const previous = editor.getSnapshot();
    try {
      if (file.size > 25_000_000) throw new Error('Backup exceeds 25 MB.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'canvasos-backup-v1' || !data.snapshot?.document)
        throw new Error('Choose a CanvasOS workspace backup.');
      if (
        !window.confirm(
          'Restore this workspace backup? Your current workspace can be recovered with Restore previous workspace until you refresh.'
        )
      )
        return;
      editor.loadSnapshot(data.snapshot);
      setPreviousBackup(previous);
      setFileStatus('Workspace restored.');
    } catch (error) {
      editor.loadSnapshot(previous);
      setFileStatus(
        error instanceof Error ? error.message : 'Could not restore the backup.'
      );
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
      setShowExportMenu(false);
    }
  };

  const handleExport = async (format: 'png' | 'svg') => {
    if (!editor) return;
    setExporting(true);
    setShowExportMenu(false);
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
      className="fixed top-4 left-6 z-[300] flex items-center gap-2 select-none"
    >
      {/* ── Main Liquid Glass Capsule ── */}
      <div className="flex items-center gap-1 p-1 rounded-full liquid-glass-pill shadow-lg border border-white/10 backdrop-blur-3xl antialiased">
        {/* visionOS Brand Emblem */}
        <div className="flex items-center gap-1.5 pl-3 pr-2 py-1 select-none shrink-0">
          <span className="text-[13px] font-semibold tracking-tight text-white/95">visionOS</span>
          <span className="text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/5">Spatial</span>
        </div>

        {/* Current Page Selector Button */}
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            setIsOpen(!isOpen);
            setShowExportMenu(false);
          }}
          className="flex items-center gap-2 min-h-[40px] px-3 py-1.5 rounded-full hover:bg-white/10 text-white transition-all text-xs font-medium"
        >
          <FileText className="h-3.5 w-3.5 text-white/70" strokeWidth={1.5} />
          <span className="max-w-[120px] truncate">
            {currentPage?.name || 'Page 1'}
          </span>
          <span className="text-[10px] font-mono tabular-nums text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full border border-white/5">
            {currentPage ? getPageShapeCount(currentPage.id) : 0}
          </span>
          <ChevronDown
            className={`h-3 w-3 text-white/60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            strokeWidth={1.5}
          />
        </motion.button>

        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

        {/* Grid Mode Toggle (Dots / Plain) */}
        <button
          type="button"
          onClick={handleToggleGrid}
          title={isGridMode ? 'Hide Grid Dots' : 'Show Grid Dots'}
          className={`min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
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
          title={isSnapMode ? 'Snapping is ON' : 'Snapping is OFF'}
          className={`min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
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
            type="button"
            onClick={() => {
              setShowExportMenu(!showExportMenu);
              setIsOpen(false);
            }}
            title="Export Canvas Notes"
            disabled={exporting}
            className={`min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-[0.96] ${
              showExportMenu
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
          </button>

          {/* Export Options Popover */}
          <AnimatePresence>
            {showExportMenu && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={APPLE_SPRING}
                className="absolute left-0 top-12 z-50 w-52 rounded-[20px] liquid-glass-popover p-2 shadow-2xl border border-white/10 space-y-1"
              >
                <div className="px-2.5 py-1 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                  Export Canvas
                </div>
                <button
                  type="button"
                  onClick={() => handleExport('png')}
                  className="w-full flex items-center gap-2.5 min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
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
                  className="w-full flex items-center gap-2.5 min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-all"
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
                  className="w-full min-h-[40px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
                >
                  Download editable backup
                </button>
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="w-full min-h-[40px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
                >
                  Restore workspace backup…
                </button>
                {previousBackup && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editor) {
                        editor.loadSnapshot(previousBackup);
                        setPreviousBackup(null);
                        setFileStatus('Previous workspace restored.');
                      }
                    }}
                    className="w-full min-h-[40px] px-3 text-left text-xs rounded-xl hover:bg-white/10 active:scale-[0.96] transition-all"
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
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={APPLE_SPRING}
            className="absolute left-0 top-14 z-50 w-72 rounded-[24px] liquid-glass-popover p-3 shadow-[0_24px_60px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.15)] border border-white/10 backdrop-blur-3xl"
          >
            {/* Header: Title + New Page Button */}
            <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-white/60" strokeWidth={1.5} />
                <span className="text-xs font-semibold text-white">Pages</span>
                <span className="text-[10px] font-mono tabular-nums text-white/40 bg-white/5 px-1.5 py-0.5 rounded-full">
                  {pages.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCreatePage}
                title="Create New Page"
                className="flex items-center gap-1 min-h-[40px] px-3 rounded-full bg-white/10 hover:bg-white/20 active:scale-[0.96] text-white text-[11px] font-medium transition-all"
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
                    onClick={() => handleSelectPage(page.id)}
                    className={`group relative flex items-center justify-between min-h-[44px] p-1.5 rounded-xl text-xs transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-white/15 text-white shadow-sm border border-white/10'
                        : 'text-white/70 hover:text-white hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    {/* Left: Active Indicator & Page Name */}
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <div
                        className={`h-2 w-2 rounded-full shrink-0 transition-all ${
                          isCurrent
                            ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                            : 'bg-white/20'
                        }`}
                      />
                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 flex-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(page.id);
                              if (e.key === 'Escape') setEditingPageId(null);
                            }}
                            className="w-full bg-white/10 px-2 py-1 rounded-lg text-white text-xs outline-none border border-white/20"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(page.id)}
                            className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-white/10 active:scale-[0.96] transition-all shrink-0"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span
                          className="truncate font-medium flex-1"
                          onDoubleClick={(e) => handleStartRename(page, e)}
                        >
                          {page.name}
                        </span>
                      )}
                    </div>

                    {/* Right: Shape Count & Action Buttons */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono tabular-nums text-white/40 group-hover:hidden">
                          {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'}
                        </span>

                        {/* Hover Actions: Rename, Duplicate, Delete */}
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(page, e)}
                            title="Rename Page"
                            className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                          >
                            <Pencil className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDuplicatePage(page.id, e)}
                            title="Duplicate Page"
                            className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-all"
                          >
                            <Copy className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                          {pages.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => handleDeletePage(page.id, e)}
                              title="Delete Page"
                              className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-lg text-white/50 hover:text-rose-400 hover:bg-white/10 active:scale-[0.96] transition-all"
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
