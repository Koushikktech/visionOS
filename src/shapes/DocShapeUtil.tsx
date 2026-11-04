'use client';

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  TLBaseShape,
  T,
  RecordProps,
  stopEventPropagation,
  TLResizeInfo,
  type Editor,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
} from '@tldraw/tldraw';
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  FileText,
  Copy,
  Check,
  Download,
  ListCollapse,
  ChevronRight,
  User,
  Calendar,
  Clock,
  Pencil,
  Eye,
  Bookmark,
  Printer,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import { smartStopPropagation } from '../lib/panModifier';
import type { DocSection } from '../types/spatial';
import {
  docSectionsValidator,
  documentAuthorValidator,
  documentDateValidator,
  documentSubtitleValidator,
  documentTitleValidator,
} from '../lib/shapeContentSchema';
import { useShapeDraft } from '../hooks/useShapeDraft';
import { isCanvasShapeLocked } from '../lib/spatialContext';
import {
  documentToMarkdown,
  isValidDocumentDraft,
  makeContentId,
  moveItem,
  safeContentFilename,
  type DocumentDraft,
} from '../lib/contentEditing';
import type { TLShapeId } from '@tldraw/tldraw';
import { copyTextToClipboard } from '../components/SpatialAIOmnibar';
import { ShapeFocusLayer } from '../components/ShapeFocusLayer';
import { ArtifactHeaderActions } from '../components/ArtifactHeaderActions';
import { subscribeToShapeEditing } from '../lib/shapeEditing';

export type TLDocShape = TLBaseShape<
  'document',
  {
    w: number;
    h: number;
    title: string;
    subtitle?: string;
    author?: string;
    date?: string;
    sections: DocSection[];
    activeSectionId?: string;
  }
>;

export const docShapeProps: RecordProps<TLDocShape> = {
  w: T.number,
  h: T.number,
  title: documentTitleValidator,
  subtitle: documentSubtitleValidator,
  author: documentAuthorValidator,
  date: documentDateValidator,
  sections: docSectionsValidator as unknown as T.Validator<DocSection[]>,
  activeSectionId: T.optional(T.string),
};

const docShapeVersions = createShapePropsMigrationIds('document', {
  AddSectionDefaults: 1,
});

export const docShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: docShapeVersions.AddSectionDefaults,
      up: (props) => {
        // Older records were only checked as arrays of arbitrary values. Preserve
        // valid sections and fill fields that the old UI treated as optional.
        if (props.sections === undefined) props.sections = [];
        if (Array.isArray(props.sections)) {
          props.sections = props.sections.map((section: unknown, index: number) => {
            if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
            const legacy = section as Record<string, unknown>;
            return {
              ...legacy,
              id: legacy.id === undefined ? `section-${index + 1}` : legacy.id,
              title: legacy.title === undefined ? `Section ${index + 1}` : legacy.title,
              content: legacy.content === undefined ? '' : legacy.content,
            };
          });
        }
      },
      down: 'retired',
    },
  ],
});

const customRenderer = new marked.Renderer();

const htmlTextEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtmlText(value: string | undefined): string {
  return (value || '').replace(/[&<>"']/g, (character) => htmlTextEntities[character]);
}

customRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = (lang || 'text').toLowerCase();
  const grammar = Prism.languages[language] || Prism.languages.javascript || Prism.languages.text;
  let highlighted = text;
  if (grammar) {
    try {
      highlighted = Prism.highlight(text, grammar, language);
    } catch {
      highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } else {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return `
<div class="my-3 rounded-xl overflow-hidden border border-white/10 bg-[#0c0e18]/90 font-mono text-[11px] leading-relaxed shadow-lg">
  <div class="flex items-center justify-between px-3 py-1 bg-white/5 border-b border-white/5 text-[10px] text-slate-400 font-sans select-none">
    <span class="font-mono text-indigo-300 font-semibold uppercase tracking-wider text-[9px]">${language}</span>
    <span class="text-[9px] text-slate-500">code</span>
  </div>
  <pre class="p-3 overflow-x-auto text-slate-200 custom-card-scrollbar"><code class="language-${language}">${highlighted}</code></pre>
</div>
`;
};

function renderMarkdownWithMath(
  content: string,
  mathOutput: 'htmlAndMathml' | 'mathml' = 'htmlAndMathml'
): string {
  if (!content) return '';

  // Process LaTeX math formulas ($inline$, $$block$$)
  let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false, output: mathOutput });
    } catch {
      return `<div class="katex-error text-xs text-red-400 my-1">${math}</div>`;
    }
  });

  processed = processed.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false, output: mathOutput });
    } catch {
      return `<span class="katex-error text-xs text-red-400">${math}</span>`;
    }
  });

  const rawHtml = marked.parse(processed, {
    renderer: customRenderer,
    breaks: true,
    gfm: true,
  }) as string;

  return DOMPurify.sanitize(rawHtml);
}

function buildPrintableDocumentHTML(document: DocumentDraft): string {
  const metadata = [
    document.author ? `<span>Author: ${escapeHtmlText(document.author)}</span>` : '',
    document.date ? `<span>Date: ${escapeHtmlText(document.date)}</span>` : '',
  ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  const sections = document.sections.map((section) => `
    <section>
      <h2>${escapeHtmlText(section.title)}</h2>
      ${section.badge ? `<p class="badge">${escapeHtmlText(section.badge)}</p>` : ''}
      <div class="markdown">${renderMarkdownWithMath(section.content, 'mathml')}</div>
    </section>
  `).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(document.title)}</title>
  <style>
    :root { color-scheme: light; }
    body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1c2431; max-width: 780px; margin: 40px auto; padding: 0 28px; }
    h1 { font-size: 34px; line-height: 1.15; letter-spacing: -.025em; margin: 0 0 10px; color: #111827; }
    h2 { font-size: 23px; line-height: 1.3; margin: 30px 0 10px; padding-bottom: 7px; border-bottom: 1px solid #d9dee8; color: #3445a8; }
    .subtitle { font-size: 18px; color: #475569; margin: 0 0 14px; }
    .meta, .badge { color: #64748b; font-size: 13px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0 0 30px; }
    .badge { display: inline-block; border: 1px solid #d9dee8; border-radius: 999px; padding: 2px 9px; }
    p { margin: 0 0 14px; }
    ul, ol { padding-left: 24px; margin: 0 0 18px; }
    li { padding-left: 3px; margin: 4px 0; }
    blockquote { margin: 16px 0; border-left: 3px solid #8994e8; padding: 8px 14px; color: #475569; background: #f7f8fc; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f1f5f9; border: 1px solid #d9dee8; border-radius: 7px; padding: 12px; color: #111827; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .katex-display { display: block; text-align: center; margin: 10px 0; overflow-wrap: anywhere; }
    math { font-size: 1.05em; }
    section { break-inside: avoid; }
    @media print { body { max-width: none; margin: 0; padding: 0 12mm; } section { break-inside: auto; } h2 { break-after: avoid; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtmlText(document.title)}</h1>
    ${document.subtitle ? `<p class="subtitle">${escapeHtmlText(document.subtitle)}</p>` : ''}
    ${metadata ? `<p class="meta">${metadata}</p>` : ''}
  </header>
  ${sections}
</body>
</html>`;
}

function DocComponent({
  shape,
  editor,
  onUpdate,
}: {
  shape: TLDocShape;
  editor?: Editor;
  onUpdate: (updates: Partial<TLDocShape['props']>) => void;
}) {
  const isSelected = Boolean(editor?.getSelectedShapeIds?.()?.includes(shape.id));
  const {
    w,
    h,
    title = 'Untitled Document',
    subtitle,
    author,
    date,
    sections = [],
  } = shape.props;

  const persistedDocument = useMemo<DocumentDraft>(() => ({
    title: shape.props.title,
    subtitle: shape.props.subtitle,
    author: shape.props.author,
    date: shape.props.date,
    sections: shape.props.sections,
  }), [shape.props.title, shape.props.subtitle, shape.props.author, shape.props.date, shape.props.sections]);
  const validateRecovered = useCallback((candidate: unknown) => isValidDocumentDraft(candidate), []);
  const draft = useShapeDraft<DocumentDraft>(`document:${shape.id}:content`, persistedDocument, {
    editor,
    shapeId: shape.id,
    validateRecovered,
  });
  const locked = editor ? editor.isShapeOrAncestorLocked(shape.id) : Boolean(shape.isLocked);
  const [isEditing, setIsEditing] = useState(false);
  const [editSectionId, setEditSectionId] = useState<string>(sections[0]?.id || '');
  const [editError, setEditError] = useState('');
  const [exportFeedback, setExportFeedback] = useState('');

  const [showTOC, setShowTOC] = useState(true);
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id || 'sec_1');
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeToShapeEditing(shape.id, () => {
    if (editor?.isShapeOrAncestorLocked(shape.id) || (!editor && shape.isLocked)) {
      setEditError('Unlock this document and its containing frame before editing.');
      return;
    }
    setEditError('');
    setIsEditing(true);
  }), [editor, shape.id, shape.isLocked]);

  const safeSections = useMemo<DocSection[]>(() => {
    if (sections && sections.length > 0) return sections;
    return [];
  }, [sections]);

  useEffect(() => {
    if (draft.recovered) setIsEditing(true);
  }, [draft.recovered]);

  const editSections = draft.value.sections;
  const selectedEditSection = editSections.find((section) => section.id === editSectionId) || editSections[0];

  useEffect(() => {
    if (editSections.length && !editSections.some((section) => section.id === editSectionId))
      setEditSectionId(editSections[0].id);
    if (!editSections.length) setEditSectionId('');
  }, [editSections, editSectionId]);

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.id === activeSection))
      setActiveSection(sections[0].id);
    if (!sections.length) setActiveSection('');
  }, [sections, activeSection]);

  // Estimate read time
  const readTimeMin = useMemo(() => {
    const totalWords = safeSections.reduce(
      (acc, s) => acc + (s.content ? s.content.split(/\s+/).length : 0),
      0
    );
    return totalWords ? Math.ceil(totalWords / 200) : 0;
  }, [safeSections]);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const targetElement = Array.from(
      scrollContainerRef.current?.querySelectorAll<HTMLElement>('[data-doc-section]') || []
    ).find((element) => element.dataset.docSection === sectionId);
    if (targetElement) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      targetElement.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }, []);

  const handleCopyMarkdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void copyTextToClipboard(
        documentToMarkdown({ title, subtitle, author, date, sections: safeSections })
      ).then((succeeded) => {
          setExportFeedback(succeeded ? '' : 'Could not copy the document. Check clipboard access and try again.');
          if (succeeded) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          }
        });
    },
    [title, subtitle, author, date, safeSections]
  );

  const handleExportMarkdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const md = documentToMarkdown({ title, subtitle, author, date, sections: safeSections });

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeContentFilename(title, 'document')}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [title, subtitle, author, date, safeSections]
  );

  const handleExportHTML = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const htmlContent = buildPrintableDocumentHTML({ title, subtitle, author, date, sections: safeSections });

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeContentFilename(title, 'document')}.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [title, subtitle, author, date, safeSections]
  );

  const openPrintView = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const printWindow = window.open('', '_blank');
    if (!printWindow || printWindow.closed) {
      setExportFeedback('The print window was blocked. Allow pop-ups and try again.');
      return;
    }
    printWindow.opener = null;
    const html = buildPrintableDocumentHTML({ title, subtitle, author, date, sections: safeSections });
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    const printWhenReady = () => {
      void printWindow.document.fonts.ready.then(() => {
        if (printWindow.closed) return;
        try {
          printWindow.focus();
          printWindow.print();
        } catch {
          setExportFeedback('The document opened, but this browser could not start printing. Use its Print command.');
        }
      });
    };
    if (printWindow.document.readyState === 'complete') printWhenReady();
    else printWindow.addEventListener('load', printWhenReady, { once: true });
  }, [author, date, safeSections, subtitle, title]);

  const updateDraft = useCallback((patch: Partial<DocumentDraft>) => {
    draft.setValue((current) => ({ ...current, ...patch }));
    setEditError('');
  }, [draft.setValue]);

  const updateSection = useCallback((sectionId: string, patch: Partial<DocSection>) => {
    draft.setValue((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section),
    }));
    setEditError('');
  }, [draft.setValue]);

  const commitDraft = useCallback((replaceConflict = false) => {
    if (!editor) return;
    const current = editor.getShape(shape.id as TLShapeId);
    if (!current) { setEditError('This document was deleted.'); return; }
    if (editor.isShapeOrAncestorLocked(current)) { setEditError('Unlock this document and its containing frame before saving.'); return; }
    if (!isValidDocumentDraft(draft.value)) { setEditError('Check the section fields and size limits before saving.'); return; }
    if (draft.hasConflict && !replaceConflict) { setEditError('The canvas changed while you edited this document. Choose how to resolve the conflict.'); return; }
    try {
      onUpdate(draft.value);
      const saved = editor.getShape(shape.id as TLShapeId);
      const savedProps = saved?.props as TLDocShape['props'] | undefined;
      if (!savedProps || JSON.stringify({
        title: savedProps.title,
        subtitle: savedProps.subtitle,
        author: savedProps.author,
        date: savedProps.date,
        sections: savedProps.sections,
      }) !== JSON.stringify(draft.value)) {
        setEditError('The canvas did not confirm this save. Your draft is still available.');
        return;
      }
      draft.save(draft.value);
      setEditError('');
      setIsEditing(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not save the document. Your draft is still available.');
    }
  }, [draft, editor, onUpdate, shape.id]);

  const addSection = useCallback(() => {
    const section: DocSection = { id: makeContentId('section'), title: `Section ${editSections.length + 1}`, content: '' };
    draft.setValue((current) => ({ ...current, sections: [...current.sections, section] }));
    setEditSectionId(section.id);
  }, [draft.setValue, editSections.length]);

  const deleteSection = useCallback((sectionId: string) => {
    const section = editSections.find((item) => item.id === sectionId);
    if (!section || !window.confirm(`Delete “${section.title || 'Untitled section'}”?`)) return;
    const next = editSections.filter((item) => item.id !== sectionId);
    draft.setValue((current) => ({ ...current, sections: next }));
    const selectedId = editSectionId === sectionId ? next[Math.max(0, editSections.indexOf(section) - 1)]?.id || '' : next.some((item) => item.id === editSectionId) ? editSectionId : next[0]?.id || '';
    setEditSectionId(selectedId);
  }, [draft.setValue, editSectionId, editSections]);

  return (
    <HTMLContainer
      id={shape.id}
      className="studio-native-window studio-native-document pointer-events-auto overflow-hidden rounded-2xl transition-colors flex flex-col antialiased"
      style={{
        width: w,
        height: h,
      }}
    >
      {/* Top Navigation Bar */}
      <div data-window-header="document" className="relative flex h-12 w-full shrink-0 items-center justify-between liquid-glass-header px-3 select-none cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden flex-1 mr-2">
          <FileText className="h-4 w-4 text-slate-300 shrink-0" strokeWidth={1.5} />
          <span
            data-window-title
            className="truncate text-xs font-semibold tracking-wide text-slate-200"
            title={title}
          >
            {title}
          </span>
          {draft.isDirty && !isEditing && <span className="shrink-0 rounded-md border border-amber-200/20 bg-amber-200/10 px-1.5 py-0.5 text-[9px] text-amber-100">Unsaved draft</span>}
          <span className="hidden shrink-0 rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-slate-400 sm:inline-flex">
            {safeSections.length} sections
          </span>
        </div>

        <ArtifactHeaderActions
          menuLabel="Document export options"
          primaryAction={{
            label: isEditing ? 'Close document editor' : locked ? 'Document is locked' : 'Edit document',
            icon: isEditing ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />,
            disabled: locked,
            onSelect: () => { setIsEditing((current) => !current); setEditError(''); },
          }}
          actions={[
            { id: 'outline', label: showTOC ? 'Hide outline' : 'Show outline', icon: <ListCollapse />, disabled: isEditing, onSelect: () => setShowTOC((prev) => !prev) },
            { id: 'copy', label: copied ? 'Markdown copied' : 'Copy document as Markdown', icon: copied ? <Check /> : <Copy />, disabled: isEditing, onSelect: handleCopyMarkdown },
            { id: 'export-markdown', label: 'Download Markdown (.md)', icon: <Download />, disabled: isEditing, separatorBefore: true, onSelect: handleExportMarkdown },
            { id: 'export-html', label: 'Download HTML (.html)', icon: <Download />, disabled: isEditing, onSelect: handleExportHTML },
            { id: 'print', label: 'Print / Save as PDF', icon: <Printer />, disabled: isEditing, onSelect: openPrintView },
          ]}
        />
      </div>

      {/* Main Document Split Workspace */}
      {isEditing ? (
        <ShapeFocusLayer title={title || 'Untitled Document'} onClose={() => setIsEditing(false)}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden" onPointerDown={stopEventPropagation}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            <aside className="studio-document-sections flex max-h-32 w-full shrink-0 flex-row gap-2 overflow-x-auto overflow-y-hidden border-b border-white/10 bg-black/25 p-2 custom-card-scrollbar sm:max-h-none sm:w-44 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-b-0 sm:border-r">
              <button type="button" disabled={locked || editSections.length >= 100} onClick={addSection} className="flex min-h-[44px] w-28 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-medium text-slate-100 hover:bg-white/10 disabled:opacity-40 sm:w-full"><Plus className="h-4 w-4" />Add section</button>
              <label className="studio-compact-sections">Section
                <select aria-label="Choose document section" value={editSectionId || ''} onChange={(event) => setEditSectionId(event.target.value)}>
                  {editSections.map((section) => <option key={section.id} value={section.id}>{section.title || 'Untitled section'}</option>)}
                </select>
              </label>
              <nav aria-label="Document sections" className="studio-wide-sections flex shrink-0 items-stretch gap-1 sm:w-full sm:flex-col sm:gap-0 sm:space-y-1">
                {editSections.map((section, index) => (
                  <div key={section.id} className={`w-44 shrink-0 rounded-lg border sm:w-full ${editSectionId === section.id ? 'border-indigo-400/40 bg-indigo-500/10' : 'border-transparent hover:bg-white/5'}`}>
                    <button type="button" onClick={() => setEditSectionId(section.id)} aria-current={editSectionId === section.id ? 'page' : undefined} className="flex min-h-[44px] w-full items-center px-2 text-left text-xs text-slate-100"><span className="mr-2 w-4 shrink-0 text-[10px] tabular-nums text-slate-500">{index + 1}</span><span className="truncate">{section.title || 'Untitled section'}</span></button>
                    <div className="flex justify-end gap-1 px-1 pb-1">
                      <button type="button" disabled={locked || index === 0} onClick={() => draft.setValue((current) => ({ ...current, sections: moveItem(current.sections, index, index - 1) }))} aria-label={`Move ${section.title || `section ${index + 1}`} up`} className="min-h-[44px] min-w-[44px] rounded-md text-slate-400 hover:bg-white/10 disabled:opacity-30"><ArrowUp className="mx-auto h-4 w-4" /></button>
                      <button type="button" disabled={locked || index === editSections.length - 1} onClick={() => draft.setValue((current) => ({ ...current, sections: moveItem(current.sections, index, index + 1) }))} aria-label={`Move ${section.title || `section ${index + 1}`} down`} className="min-h-[44px] min-w-[44px] rounded-md text-slate-400 hover:bg-white/10 disabled:opacity-30"><ArrowDown className="mx-auto h-4 w-4" /></button>
                      <button type="button" disabled={locked} onClick={() => deleteSection(section.id)} aria-label={`Delete ${section.title || `section ${index + 1}`}`} className="min-h-[44px] min-w-[44px] rounded-md text-rose-300 hover:bg-rose-500/10 disabled:opacity-30"><Trash2 className="mx-auto h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
              </nav>
            </aside>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-card-scrollbar">
              <div className="studio-document-heading">
                <label className="text-[11px] text-slate-300">Document title<input aria-label="Document title" maxLength={4000} value={draft.value.title} onChange={(event) => updateDraft({ title: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                <details className="studio-document-metadata"><summary>Document details</summary><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[11px] text-slate-300">Subtitle<input aria-label="Document subtitle" maxLength={4000} value={draft.value.subtitle || ''} onChange={(event) => updateDraft({ subtitle: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                <label className="text-[11px] text-slate-300">Author<input aria-label="Document author" maxLength={1000} value={draft.value.author || ''} onChange={(event) => updateDraft({ author: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                <label className="text-[11px] text-slate-300">Date<input aria-label="Document date" maxLength={256} value={draft.value.date || ''} onChange={(event) => updateDraft({ date: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                </div></details>
              </div>
              {selectedEditSection ? (
                <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <h2 className="text-xs font-semibold text-slate-100">Section content</h2>
                  <label className="block text-[11px] text-slate-300">Section title<input aria-label="Section title" maxLength={2000} value={selectedEditSection.title} onChange={(event) => updateSection(selectedEditSection.id, { title: event.target.value })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  <label className="block text-[11px] text-slate-300">Badge (optional)<input aria-label="Section badge" maxLength={256} value={selectedEditSection.badge || ''} onChange={(event) => updateSection(selectedEditSection.id, { badge: event.target.value || undefined })} disabled={locked} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                  <label className="block text-[11px] text-slate-300">Markdown content<textarea aria-label="Section Markdown content" maxLength={180000} value={selectedEditSection.content} onChange={(event) => updateSection(selectedEditSection.id, { content: event.target.value })} disabled={locked} className="mt-1 min-h-[280px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-6 text-white outline-none focus:border-indigo-400/60 disabled:opacity-50" /></label>
                </div>
              ) : <p className="mt-4 rounded-lg border border-dashed border-white/15 p-4 text-sm text-slate-400">Add a section to begin writing.</p>}
              {(draft.recovered || !draft.recoveryAvailable) && <p role="status" className="mt-3 text-xs text-amber-200">{draft.recovered ? 'Recovered an unsaved document draft.' : 'Draft recovery storage is unavailable. Keep this editor open until you save.'}</p>}
              {draft.hasConflict && <p role="alert" className="mt-3 text-xs text-amber-200">The saved document changed while this draft was open. Review it before choosing which version to keep.</p>}
              {locked && <p role="status" className="mt-3 text-xs text-amber-200">This document or its containing frame is locked. Unlock it to make changes.</p>}
              {editError && <p role="alert" className="mt-3 text-xs text-rose-200">{editError}</p>}
            </div>
          </div>
          <div className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/20 px-3 py-1.5">
            <span className="text-[11px] text-slate-400">{draft.isDirty ? 'Unsaved changes' : 'Changes applied to canvas'}</span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {draft.isDirty && <button type="button" onClick={() => { if (window.confirm('Discard this document draft?')) { draft.discard(); setEditError(''); } }} className="min-h-[44px] rounded-lg px-3 text-xs text-slate-300 hover:bg-white/10">Discard draft</button>}
              {draft.hasConflict && <button type="button" disabled={locked || !draft.isDirty} onClick={() => { draft.discard(); setEditError(''); }} className="min-h-[44px] rounded-lg px-3 text-xs text-slate-100 hover:bg-white/10 disabled:opacity-40">Use latest</button>}
              <button type="button" disabled={locked || !draft.isDirty} onClick={() => commitDraft(draft.hasConflict)} className="min-h-[44px] rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">{draft.hasConflict ? 'Replace with draft' : 'Save changes'}</button>
            </div>
          </div>
        </div>
        </ShapeFocusLayer>
      ) : (
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Sticky Table of Contents Sidebar */}
        {showTOC && (
          <div
            className="w-44 shrink-0 border-r border-white/10 bg-black/30 p-3 overflow-y-auto custom-card-scrollbar select-none"
            onPointerDown={isSelected ? smartStopPropagation : undefined}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              <Bookmark className="h-3 w-3 text-indigo-400" />
              <span>Outline</span>
            </div>

            <nav className="space-y-1">
              {safeSections.map((sec, idx) => (
                <button
                  key={sec.id || idx}
                  onClick={() => scrollToSection(sec.id)}
                  className={`w-full min-h-[44px] text-left rounded-lg px-2 py-1.5 text-[11px] leading-tight transition-all flex items-center justify-between group ${
                    activeSection === sec.id
                      ? 'bg-indigo-500/15 text-indigo-200 font-medium border border-indigo-500/25'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{sec.title}</span>
                  <ChevronRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-500" />
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Scrollable Document Body */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto p-6 select-text custom-card-scrollbar"
          onPointerDown={isSelected ? smartStopPropagation : undefined}
        >
          {/* Header Banner */}
          <div className="border-b border-white/10 pb-5 mb-6">
            <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1.5 leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-slate-300 leading-relaxed font-light mb-3">{subtitle}</p>
            )}

            {/* Document Metadata Pills */}
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-400">
              {author && (
                <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-300">
                  <User className="h-2.5 w-2.5 text-indigo-400" />
                  {author}
                </span>
              )}
              {date && (
                <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-400">
                  <Calendar className="h-2.5 w-2.5 text-indigo-400" />
                  {date}
                </span>
              )}
              <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 border border-white/10 text-slate-400 tabular-nums">
                <Clock className="h-2.5 w-2.5 text-slate-400" />
                <span className="tabular-nums">{readTimeMin}</span> min read
              </span>
            </div>
          </div>

          {/* Rendered Sections */}
          <div className="space-y-8">
            {safeSections.map((sec, idx) => (
              <section
                key={sec.id || idx}
                id={`${shape.id}-doc-sec-${idx}`}
                data-doc-section={sec.id}
                className="scroll-mt-4 group border-b border-white/5 pb-6 last:border-none"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/10 border border-white/10 text-[10px] font-mono font-bold text-slate-200 tabular-nums">
                    {idx + 1}
                  </span>
                  <h2 className="text-base font-bold text-white tracking-tight">{sec.title}</h2>
                  {sec.badge && (
                    <span className="rounded-md bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                      {sec.badge}
                    </span>
                  )}
                </div>

                <div
                  className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed text-xs"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownWithMath(sec.content) }}
                />
              </section>
            ))}
            {safeSections.length === 0 && (
              <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-slate-400">This document has no sections yet. Select Edit document to add one.</p>
            )}
          </div>
        </div>
      </div>
      )}
      {exportFeedback && !isEditing && <p role="alert" className="absolute bottom-2 left-2 right-2 z-20 rounded-lg border border-rose-300/20 bg-slate-950/95 px-3 py-2 text-xs text-rose-100">{exportFeedback}</p>}
    </HTMLContainer>
  );
}

export class DocShapeUtil extends BaseBoxShapeUtil<TLDocShape> {
  static override type = 'document' as const;
  static override props = docShapeProps;
  static override migrations = docShapeMigrations;

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override canScroll() {
    return true;
  }

  override onResize(shape: TLDocShape, info: TLResizeInfo<TLDocShape>) {
    return {
      props: {
        w: Math.max(480, Math.round(shape.props.w * info.scaleX)),
        h: Math.max(340, Math.round(shape.props.h * info.scaleY)),
      },
    };
  }

  override getDefaultProps(): TLDocShape['props'] {
    return {
      w: 680,
      h: 520,
      title: 'VisionOS Technical Specification',
      subtitle:
        'A comprehensive design document and architecture specification for multi-modal spatial computing.',
      author: 'VisionOS Kernel & Swarm',
      date: 'September 2026',
      sections: [
        {
          id: 'sec_1',
          title: 'Executive Summary',
          badge: 'Overview',
          content:
            'VisionOS merges 2D spatial canvas computing with an autonomous Hermes-grade multi-agent swarm. By combining a Kiwi.js linear constraint solver with low-latency token streaming, VisionOS delivers an AI workspace operating at 60 FPS.',
        },
        {
          id: 'sec_2',
          title: 'Mathematical Foundations',
          badge: 'Cassowary Solver',
          content:
            'Layout bounds are solved via Cassowary simplex tableau equations:\n\n$$\\min \\sum_{i} w_i \\cdot (s_i^+ + s_i^-) \\quad \\text{subject to} \\quad A \\cdot x = b$$\n\nEvery card maintains non-overlapping bounding margins with dynamic edge connectors.',
        },
        {
          id: 'sec_3',
          title: 'Implementation Architecture',
          badge: 'System Pipeline',
          content:
            'The system is partitioned into three decoupled layers:\n- **Kernel Layer:** Next.js App Router and Web Worker protocol streamer.\n- **Substrate Layer:** `tldraw` v3 custom shape utilities.\n- **Swarm Layer:** Hierarchical DAG macro-planner streaming parallel specialist workers.',
        },
      ],
    };
  }

  override component(shape: TLDocShape) {
    return (
      <DocComponent
        shape={shape}
        editor={this.editor}
        onUpdate={(updates) => {
          this.editor.updateShape({
            id: shape.id,
            type: 'document',
            props: updates,
          });
        }}
      />
    );
  }

  override indicator(shape: TLDocShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}
