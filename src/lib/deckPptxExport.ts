import type { DeckDraft, DeckSlideContent } from './contentEditing';

const PAGE = { width: 13.333, height: 7.5 };

const PALETTES: Record<string, {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  surface: string;
  border: string;
}> = {
  midnight: { background: '0A1020', foreground: 'F8FAFC', muted: 'CBD5E1', accent: 'A5B4FC', surface: '1A2540', border: '394663' },
  paper: { background: 'F4EFE4', foreground: '202938', muted: '475569', accent: '9A5B2F', surface: 'E8DDCB', border: 'C8BBA7' },
  ocean: { background: '082F49', foreground: 'F0F9FF', muted: 'BAE6FD', accent: '38BDF8', surface: '104563', border: '2D6B88' },
  plum: { background: '24133A', foreground: 'FAF5FF', muted: 'E9D5FF', accent: 'D8B4FE', surface: '3B2455', border: '65477F' },
};

type Palette = (typeof PALETTES)[keyof typeof PALETTES];

function addText(slide: any, text: string, box: { x: number; y: number; w: number; h: number }, options: Record<string, unknown> = {}) {
  if (!text) return;
  slide.addText(text, {
    ...box,
    fontFace: 'Aptos',
    fontSize: 16,
    color: 'F8FAFC',
    margin: 0.06,
    breakLine: false,
    valign: 'mid',
    fit: 'shrink',
    paraSpaceAfterPt: 4,
    wrap: true,
    ...options,
  });
}

function addPanel(slide: any, palette: Palette, x: number, y: number, w: number, h: number) {
  slide.addShape('roundRect', {
    x, y, w, h,
    rectRadius: 0.12,
    fill: { color: palette.surface },
    line: { color: palette.border, width: 1 },
  });
}

function gridGap(availableHeight: number, rows: number, preferredGap: number) {
  // Persisted decks may contain more items than the editor currently creates.
  // Keep total row spacing bounded so dense imported content always has
  // positive-height cells within its allocated section.
  return Math.min(preferredGap, availableHeight / Math.max(3, rows * 3));
}

function addTextPanel(slide: any, palette: Palette, label: string, text: string, box: { x: number; y: number; w: number; h: number }, options: Record<string, unknown> = {}) {
  if (!text) return;
  addPanel(slide, palette, box.x, box.y, box.w, box.h);
  if (label) addText(slide, label.toUpperCase(), { x: box.x + 0.16, y: box.y + 0.09, w: box.w - 0.32, h: 0.22 }, { fontSize: 8, bold: true, color: palette.accent, charSpacing: 0.8 });
  addText(slide, text, { x: box.x + 0.16, y: box.y + (label ? 0.36 : 0.12), w: box.w - 0.32, h: box.h - (label ? 0.46 : 0.24) }, { fontSize: 13, color: palette.muted, valign: 'top', ...options });
}

function compactSlideBody(slide: any, palette: Palette, content: DeckSlideContent, x: number, y: number, w: number, h: number) {
  const blocks: string[] = [];
  if (content.content) blocks.push(content.content);
  if (content.bullets?.length) blocks.push(content.bullets.map((item) => `•  ${item}`).join('\n'));
  if (!blocks.length) return;
  addTextPanel(slide, palette, content.content ? 'Content' : 'Key points', blocks.join('\n\n'), { x, y, w, h }, { fontSize: 13, breakLine: false, valign: 'top', margin: 0.04 });
}

function renderStats(slide: any, palette: Palette, stats: NonNullable<DeckSlideContent['stats']>, x: number, y: number, w: number, h: number) {
  if (!stats.length) return;
  const columns = Math.min(4, stats.length);
  const rows = Math.ceil(stats.length / columns);
  const gap = gridGap(h, rows, 0.12);
  const cellW = (w - gap * (columns - 1)) / columns;
  const cellH = (h - gap * (rows - 1)) / rows;
  stats.forEach((stat, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cx = x + column * (cellW + gap);
    const cy = y + row * (cellH + gap);
    addPanel(slide, palette, cx, cy, cellW, cellH);
    const lines = [stat.label, stat.value, stat.change].filter(Boolean).join('\n');
    const insetX = Math.min(0.12, cellW * 0.08);
    const insetY = Math.min(0.08, cellH * 0.08);
    addText(slide, lines, { x: cx + insetX, y: cy + insetY, w: Math.max(0.001, cellW - insetX * 2), h: Math.max(0.001, cellH - insetY * 2) }, {
      fontSize: cellH < 0.65 ? 8 : 11,
      color: palette.foreground,
      valign: 'mid',
      margin: 0.01,
    });
  });
}

function renderColumns(slide: any, palette: Palette, columns: NonNullable<DeckSlideContent['columns']>, x: number, y: number, w: number, h: number) {
  if (!columns.length) return;
  const columnCount = Math.min(3, columns.length);
  const rows = Math.ceil(columns.length / columnCount);
  const gap = gridGap(h, rows, 0.14);
  const cellW = (w - gap * (columnCount - 1)) / columnCount;
  const cellH = (h - gap * (rows - 1)) / rows;
  columns.forEach((column, index) => {
    const cx = x + (index % columnCount) * (cellW + gap);
    const cy = y + Math.floor(index / columnCount) * (cellH + gap);
    addPanel(slide, palette, cx, cy, cellW, cellH);
    const lines = [column.icon, column.title, column.text].filter(Boolean).join('\n\n');
    const insetX = Math.min(0.16, cellW * 0.08);
    const insetY = Math.min(0.16, cellH * 0.08);
    addText(slide, lines, { x: cx + insetX, y: cy + insetY, w: Math.max(0.001, cellW - insetX * 2), h: Math.max(0.001, cellH - insetY * 2) }, {
      fontSize: cellH < 0.9 ? 8 : 11,
      color: palette.foreground,
      valign: 'top',
      margin: 0.01,
    });
  });
}

function renderTimeline(slide: any, palette: Palette, steps: NonNullable<DeckSlideContent['timelineSteps']>, x: number, y: number, w: number, h: number) {
  if (!steps.length) return;
  const columns = Math.min(3, steps.length);
  const rows = Math.ceil(steps.length / columns);
  const gap = gridGap(h, rows, 0.12);
  const cellW = (w - gap * (columns - 1)) / columns;
  const cellH = (h - gap * (rows - 1)) / rows;
  steps.forEach((step, index) => {
    const cx = x + (index % columns) * (cellW + gap);
    const cy = y + Math.floor(index / columns) * (cellH + gap);
    addPanel(slide, palette, cx, cy, cellW, cellH);
    const lines = [step.step, step.title, step.desc].filter(Boolean).join('\n\n');
    const insetX = Math.min(0.14, cellW * 0.08);
    const insetY = Math.min(0.1, cellH * 0.08);
    addText(slide, lines, { x: cx + insetX, y: cy + insetY, w: Math.max(0.001, cellW - insetX * 2), h: Math.max(0.001, cellH - insetY * 2) }, {
      fontSize: cellH < 0.45 ? 7 : cellH < 0.9 ? 8 : 10,
      color: palette.foreground,
      valign: 'mid',
      margin: 0.01,
    });
  });
}

function bodySectionBoxes(count: number, x: number, y: number, w: number, h: number) {
  const gap = 0.18;
  if (count <= 1) return [{ x, y, w, h }];
  if (count === 2) {
    const cellW = (w - gap) / 2;
    return [{ x, y, w: cellW, h }, { x: x + cellW + gap, y, w: cellW, h }];
  }
  const cellH = (h - gap) / 2;
  if (count === 3) {
    const cellW = (w - gap) / 2;
    return [
      { x, y, w, h: cellH },
      { x, y: y + cellH + gap, w: cellW, h: cellH },
      { x: x + cellW + gap, y: y + cellH + gap, w: cellW, h: cellH },
    ];
  }
  const cellW = (w - gap) / 2;
  return Array.from({ length: count }, (_, index) => ({
    x: x + (index % 2) * (cellW + gap),
    y: y + Math.floor(index / 2) * (cellH + gap),
    w: cellW,
    h: cellH,
  }));
}

function renderSlide(slide: any, deck: DeckDraft, content: DeckSlideContent, index: number, palette: Palette) {
  slide.background = { color: palette.background };
  slide.addShape('rect', { x: 0, y: 0, w: PAGE.width, h: 0.1, line: { color: palette.accent, transparency: 100 }, fill: { color: palette.accent } });
  const layout = content.layout || 'split';
  const hero = layout === 'hero';
  const titleText = content.title || `Slide ${index + 1}`;
  const titleBox = { x: hero ? 1.1 : 0.65, y: 0.42, w: hero ? 10.4 : 10.7, h: 0.7 };
  addText(slide, titleText, titleBox, { fontSize: hero ? 34 : 28, bold: true, color: palette.foreground, align: hero ? 'center' : 'left' });
  if (content.subtitle) addText(slide, content.subtitle, { x: hero ? 1.4 : 0.67, y: 1.17, w: hero ? 10.5 : 11.5, h: 0.42 }, { fontSize: 15, color: palette.muted, align: hero ? 'center' : 'left' });
  addText(slide, `${String(index + 1).padStart(2, '0')} / ${deck.slides.length}`, { x: 11.9, y: 0.58, w: 0.8, h: 0.24 }, { fontSize: 8, bold: true, color: palette.accent, align: 'right' });

  const top = content.subtitle ? 1.82 : 1.5;
  const availableH = PAGE.height - top - 0.42;
  const margins = { left: 0.65, right: 0.65 };
  const mainW = PAGE.width - margins.left - margins.right;
  const hasNarrative = Boolean(content.content || content.bullets?.length);
  const sections: Array<{ kind: 'narrative' | 'stats' | 'columns' | 'timeline'; label: string }> = [];
  if (hasNarrative) sections.push({ kind: 'narrative', label: layout === 'takeaway' ? 'Takeaway' : content.content ? 'Content' : 'Key points' });
  if (content.stats?.length) sections.push({ kind: 'stats', label: 'Stats' });
  if (content.columns?.length) sections.push({ kind: 'columns', label: 'Columns' });
  if (content.timelineSteps?.length) sections.push({ kind: 'timeline', label: 'Timeline' });

  const preferredOrder: Record<string, Array<typeof sections[number]['kind']>> = {
    stats: ['stats', 'narrative', 'columns', 'timeline'],
    timeline: ['timeline', 'narrative', 'stats', 'columns'],
    columns: ['columns', 'narrative', 'stats', 'timeline'],
    split: ['narrative', 'stats', 'columns', 'timeline'],
    takeaway: ['narrative', 'stats', 'columns', 'timeline'],
    hero: ['narrative', 'columns', 'stats', 'timeline'],
  };
  const order = preferredOrder[layout] || ['narrative', 'stats', 'columns', 'timeline'];
  sections.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const boxes = bodySectionBoxes(sections.length, margins.left, top, mainW, availableH);
  sections.forEach(({ kind, label }, sectionIndex) => {
    const box = boxes[sectionIndex];
    if (kind === 'narrative') {
      const text = [content.content, ...(content.bullets || []).map((item) => `•  ${item}`)].filter(Boolean).join('\n\n');
      addTextPanel(slide, palette, label, text, box, layout === 'takeaway'
        ? { fontSize: 18, color: palette.foreground, align: 'center', valign: 'mid' }
        : { fontSize: 13, breakLine: false, valign: 'top', margin: 0.04 });
    } else if (kind === 'stats') {
      renderStats(slide, palette, content.stats!, box.x, box.y, box.w, box.h);
    } else if (kind === 'columns') {
      renderColumns(slide, palette, content.columns!, box.x, box.y, box.w, box.h);
    } else {
      renderTimeline(slide, palette, content.timelineSteps!, box.x, box.y, box.w, box.h);
    }
  });

  if (content.speakerNotes) slide.addNotes(content.speakerNotes);
}

/**
 * Generates editable OOXML text boxes and shapes for each native deck slide.
 * PptxGenJS shrinks dense fields to fit their boxes; all source text is still
 * preserved in the exported OOXML. Long fields may therefore need editing in
 * PowerPoint for comfortable reading, and are never silently truncated here.
 */
export async function createDeckPptxBytes(deck: DeckDraft): Promise<Uint8Array> {
  const pptxgen = (await import('pptxgenjs')).default;
  const pptx = new pptxgen();
  const palette = PALETTES[deck.theme] || PALETTES.midnight;
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'visionOS';
  pptx.title = deck.title || 'Presentation';
  pptx.subject = deck.subtitle || '';
  pptx.company = 'visionOS';
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
  for (let index = 0; index < deck.slides.length; index += 1) {
    const slide = pptx.addSlide();
    renderSlide(slide, deck, deck.slides[index], index, palette);
  }
  return await pptx.write({ outputType: 'uint8array', compression: true }) as Uint8Array;
}

export function createPptxBlob(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
