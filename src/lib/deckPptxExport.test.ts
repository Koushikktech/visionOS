import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

function extractZipEntry(archive: Uint8Array, name: string): string {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Missing ZIP central directory');
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const entryName = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    if (entryName === name) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Invalid ZIP local header');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!bytes) throw new Error(`Unsupported ZIP compression method ${method}`);
      return decoder.decode(bytes);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing OOXML part ${name}`);
}

function readTextBoxBounds(slideXml: string) {
  return (slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).flatMap((shape) => {
    const text = [...shape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join('\n');
    if (!text) return [];
    const offset = shape.match(/<a:off x="(\d+)" y="(\d+)"\s*\/>/);
    const extent = shape.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
    if (!offset || !extent) throw new Error(`Text shape is missing OOXML geometry: ${text.slice(0, 80)}`);
    return [{
      text,
      x: Number(offset[1]),
      y: Number(offset[2]),
      w: Number(extent[1]),
      h: Number(extent[2]),
    }];
  });
}

describe('editable PPTX export', () => {
  test('writes mixed fields for every layout into distinct editable OOXML regions', async () => {
    // Some older tests temporarily replace browser globals in the shared Bun
    // process. Generate in a clean child process so JSZip's legacy scheduler
    // sees normal Node globals; the parent still inspects the actual OOXML.
    const tempDir = mkdtempSync(join(tmpdir(), 'visionos-pptx-test-'));
    const pptxPath = join(tempDir, 'deck.pptx');
    const layouts = ['split', 'stats', 'timeline', 'takeaway', 'columns', 'hero', 'default'];
    const maximumDensitySlide = {
      id: 'maximum-density', title: 'Maximum density', subtitle: 'Persisted field limits', layout: 'stats',
      content: 'Dense-slide narrative.',
      stats: Array.from({ length: 500 }, (_, index) => ({ label: `STAT_FIELD_${String(index).padStart(3, '0')}`, value: `${index}%`, change: 'retained' })),
      columns: Array.from({ length: 500 }, (_, index) => ({ title: `COLUMN_FIELD_${String(index).padStart(3, '0')}`, text: `Column detail ${index}`, icon: '•' })),
      timelineSteps: Array.from({ length: 500 }, (_, index) => ({ step: `${index}`, title: `TIMELINE_FIELD_${String(index).padStart(3, '0')}`, desc: `Timeline detail ${index}` })),
    };
    const deck = {
      title: 'Launch plan', subtitle: 'Quarterly review', theme: 'ocean', currentSlideIndex: 0,
      slides: [...layouts.map((layout, index) => ({
        id: `launch-slide-${index}`, title: `Launch milestones ${layout}`, subtitle: 'Spring release', layout,
        content: `Narrative body survives ${layout}.`, bullets: [`First action survives ${layout}.`, `Second action survives ${layout}.`],
        stats: [{ label: `Adoption ${layout}`, value: '42%', change: 'up 8 points' }],
        columns: [{ title: `Research ${layout}`, text: 'Interview customers.', icon: 'Compass' }],
        timelineSteps: [{ step: '1', title: `Prepare ${layout}`, desc: 'Complete readiness.' }],
        speakerNotes: index === 0 ? 'Presenter notes survive in notes XML.' : undefined,
      })), maximumDensitySlide],
    };
    try {
      const moduleUrl = new URL('./deckPptxExport.ts', import.meta.url).href;
      const script = `
        const { createDeckPptxBytes } = await import(${JSON.stringify(moduleUrl)});
        const bytes = await createDeckPptxBytes(${JSON.stringify(deck)});
        await Bun.write(${JSON.stringify(pptxPath)}, bytes);
      `;
      const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000 });
      if (child.error) throw child.error;
      if (child.status !== 0) throw new Error(child.stderr || child.stdout || 'PPTX child process failed');
      const bytes = new Uint8Array(readFileSync(pptxPath));
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
      const contentTypes = extractZipEntry(bytes, '[Content_Types].xml');
      const slideXml = extractZipEntry(bytes, 'ppt/slides/slide1.xml');
      const notesXml = extractZipEntry(bytes, 'ppt/notesSlides/notesSlide1.xml');
      expect(contentTypes).toContain('presentationml.slide+xml');
      expect(slideXml).toContain('Launch milestones split');
      expect(slideXml).toContain('Spring release');
      expect(slideXml).toContain('Narrative body survives split.');
      expect(slideXml).toContain('First action survives split.');
      expect(slideXml).toContain('Adoption split');
      expect(slideXml).toContain('up 8 points');
      expect(slideXml).toContain('Compass');
      expect(slideXml).toContain('Interview customers.');
      expect(slideXml).toContain('Prepare split');
      expect(slideXml).toContain('Complete readiness.');
      expect(slideXml).toContain('082F49');
      expect(notesXml).toContain('Presenter notes survive in notes XML.');
      layouts.forEach((layout, index) => {
        const xml = extractZipEntry(bytes, `ppt/slides/slide${index + 1}.xml`);
        expect(xml).toContain(`Narrative body survives ${layout}.`);
        expect(xml).toContain(`Adoption ${layout}`);
        expect(xml).toContain(`Research ${layout}`);
        expect(xml).toContain(`Prepare ${layout}`);
        const boxes = readTextBoxBounds(xml);
        expect(boxes.length).toBeGreaterThanOrEqual(8);
        boxes.forEach((box) => {
          expect(box.w).toBeGreaterThan(0);
          expect(box.h).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(13.333 * 914400 + 2);
          expect(box.y + box.h).toBeLessThanOrEqual(7.5 * 914400 + 2);
        });
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const first = boxes[a];
            const second = boxes[b];
            const overlaps = first.x < second.x + second.w && first.x + first.w > second.x && first.y < second.y + second.h && first.y + first.h > second.y;
            expect(overlaps).toBe(false);
          }
        }
      });

      const denseXml = extractZipEntry(bytes, `ppt/slides/slide${layouts.length + 1}.xml`);
      expect(denseXml).toContain('STAT_FIELD_000');
      expect(denseXml).toContain('STAT_FIELD_499');
      expect(denseXml).toContain('COLUMN_FIELD_000');
      expect(denseXml).toContain('COLUMN_FIELD_499');
      expect(denseXml).toContain('TIMELINE_FIELD_000');
      expect(denseXml).toContain('TIMELINE_FIELD_499');
      const denseBoxes = readTextBoxBounds(denseXml);
      expect(denseBoxes.length).toBeGreaterThan(1_500);
      denseBoxes.forEach((box) => {
        expect(box.w).toBeGreaterThan(0);
        expect(box.h).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(13.333 * 914400 + 2);
        expect(box.y + box.h).toBeLessThanOrEqual(7.5 * 914400 + 2);
      });
      const sectionGap = 0.18;
      const sectionW = (13.333 - 1.3 - sectionGap) / 2;
      const sectionH = ((7.5 - 1.82 - 0.42) - sectionGap) / 2;
      const cellGroups = [
        { token: 'STAT_FIELD_', x: 0.65, y: 1.82, w: sectionW, h: sectionH, columns: 4, count: 500, preferredGap: 0.12 },
        { token: 'COLUMN_FIELD_', x: 0.65, y: 1.82 + sectionH + sectionGap, w: sectionW, h: sectionH, columns: 3, count: 500, preferredGap: 0.14 },
        { token: 'TIMELINE_FIELD_', x: 0.65 + sectionW + sectionGap, y: 1.82 + sectionH + sectionGap, w: sectionW, h: sectionH, columns: 3, count: 500, preferredGap: 0.12 },
      ];
      for (const group of cellGroups) {
        const rows = Math.ceil(group.count / group.columns);
        const gap = Math.min(group.preferredGap, group.h / Math.max(3, rows * 3));
        const cellW = (group.w - gap * (group.columns - 1)) / group.columns;
        const cellH = (group.h - gap * (rows - 1)) / rows;
        for (let index = 0; index < group.count; index += 1) {
          const marker = `${group.token}${String(index).padStart(3, '0')}`;
          const box = denseBoxes.find((candidate) => candidate.text.includes(marker));
          expect(box).toBeDefined();
          if (!box) continue;
          const cellX = group.x + (index % group.columns) * (cellW + gap);
          const cellY = group.y + Math.floor(index / group.columns) * (cellH + gap);
          const emu = 914400;
          const bounds = { x: Math.round(cellX * emu), y: Math.round(cellY * emu), right: Math.round((cellX + cellW) * emu), bottom: Math.round((cellY + cellH) * emu) };
          if (box.x < bounds.x - 2 || box.y < bounds.y - 2 || box.x + box.w > bounds.right + 2 || box.y + box.h > bounds.bottom + 2) {
            throw new Error(`${marker} text bounds ${JSON.stringify(box)} exceed cell ${JSON.stringify(bounds)}`);
          }
          expect(box.x).toBeGreaterThanOrEqual(Math.round(cellX * emu) - 2);
          expect(box.y).toBeGreaterThanOrEqual(Math.round(cellY * emu) - 2);
          expect(box.x + box.w).toBeLessThanOrEqual(Math.round((cellX + cellW) * emu) + 2);
          expect(box.y + box.h).toBeLessThanOrEqual(Math.round((cellY + cellH) * emu) + 2);
        }
      }
      for (let a = 0; a < denseBoxes.length; a += 1) {
        for (let b = a + 1; b < denseBoxes.length; b += 1) {
          const first = denseBoxes[a];
          const second = denseBoxes[b];
          const overlaps = first.x < second.x + second.w && first.x + first.w > second.x && first.y < second.y + second.h && first.y + first.h > second.y;
          expect(overlaps).toBe(false);
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
