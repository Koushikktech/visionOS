import { describe, expect, it } from 'bun:test';
import type { Editor, TLShape } from '@tldraw/tldraw';
import {
  captureWorkspaceSummary,
  clearWorkspaceSummary,
  MAX_STUDIO_PREVIEW_SHAPES,
  readWorkspaceSummary,
  WORKSPACE_STUDIO_SUMMARY_KEY,
  writeWorkspaceSummary,
  type WorkspaceSummary,
} from './workspaceStudio';

function withWindow<T>(value: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  try {
    return callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function makeEditor(shapes: TLShape[], pageName = 'Field Notes') {
  const pageId = 'page:main';
  return {
    getPages: () => [{ id: pageId, name: pageName }],
    getPageShapeIds: () => new Set(shapes.map((shape) => shape.id)),
    getCurrentPageId: () => pageId,
    getCurrentPageShapes: () => shapes,
    getShapePageBounds: (shape: TLShape) => ({ x: shape.x, y: shape.y, w: 160, h: 100 }),
  } as unknown as Editor;
}

function exampleSummary(hasShapes: boolean): WorkspaceSummary {
  return {
    version: 2,
    capturedAt: '2026-10-28T12:00:00.000Z',
    captureSource: 'editor-hydration',
    activePageId: 'page:main',
    pages: [{ id: 'page:main', name: 'Field Notes', hasShapes }],
    overview: null,
  };
}

describe('Studio workspace summary', () => {
  it('captures no more than 80 inert shape overviews and excludes hidden bodies and code', () => {
    const shapes = Array.from({ length: MAX_STUDIO_PREVIEW_SHAPES + 4 }, (_, index) => ({
      id: `shape:${index}`,
      type: index === 0 ? 'artifact' : 'text',
      x: 400 + index * 12,
      y: 220 + index * 7,
      props: index === 0
        ? { title: 'A quiet timer', code: 'private source body', storage: { secret: 'never cache this' }, color: 'green' }
        : { text: 'hidden body text', color: 'blue' },
    })) as unknown as TLShape[];
    const summary = captureWorkspaceSummary(makeEditor(shapes));
    const serialized = JSON.stringify(summary);

    expect(summary.pages).toEqual([{ id: 'page:main', name: 'Field Notes', hasShapes: true }]);
    expect(summary.overview?.shapes).toHaveLength(MAX_STUDIO_PREVIEW_SHAPES);
    expect(summary.overview?.bounds).toEqual({ x: 400, y: 220, w: 160 + 79 * 12, h: 100 + 79 * 7 });
    expect(summary.overview?.shapes[0]).toMatchObject({ kind: 'app', title: 'A quiet timer', color: 'green' });
    expect(serialized).not.toContain('private source body');
    expect(serialized).not.toContain('never cache this');
    expect(serialized).not.toContain('hidden body text');
    expect(serialized).not.toContain('shape:0');
    expect(summary.captureSource).toBe('editor-hydration');
  });

  it('drops title labels that look like credentials while keeping safe visible titles', () => {
    const shapes = [
      { id: 'shape:1', type: 'artifact', x: 0, y: 0, props: { title: 'API key: sk-1234567890123456', code: 'secret', color: 'grey' } },
      { id: 'shape:2', type: 'document', x: 180, y: 0, props: { title: 'Project outline', sections: [{ content: 'hidden' }] } },
    ] as unknown as TLShape[];
    const summary = captureWorkspaceSummary(makeEditor(shapes));
    expect(summary.overview?.shapes.map((shape) => shape.title)).toEqual([undefined, 'Project outline']);
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(JSON.stringify(summary)).not.toContain('hidden');
  });

  it('reports missing and malformed cache as unavailable rather than empty', () => {
    const storage = memoryStorage();
    withWindow({ localStorage: storage }, () => {
      expect(readWorkspaceSummary()).toEqual({ status: 'unavailable' });
      storage.setItem(WORKSPACE_STUDIO_SUMMARY_KEY, '{bad json');
      expect(readWorkspaceSummary()).toEqual({ status: 'unavailable' });
      storage.setItem(WORKSPACE_STUDIO_SUMMARY_KEY, JSON.stringify({ version: 2, pages: [] }));
      expect(readWorkspaceSummary()).toEqual({ status: 'unavailable' });
      storage.setItem(WORKSPACE_STUDIO_SUMMARY_KEY, JSON.stringify({ ...exampleSummary(true), code: 'must not be retained' }));
      expect(readWorkspaceSummary()).toEqual({ status: 'unavailable' });
    });
  });

  it('returns ready or empty only from a valid captured summary and clears only its own cache key', () => {
    const storage = memoryStorage();
    withWindow({ localStorage: storage }, () => {
      expect(writeWorkspaceSummary(exampleSummary(true))).toBe(true);
      expect(readWorkspaceSummary()).toMatchObject({ status: 'ready', summary: { activePageId: 'page:main' } });
      expect(writeWorkspaceSummary(exampleSummary(false))).toBe(true);
      expect(readWorkspaceSummary()).toMatchObject({ status: 'empty', summary: { pages: [{ hasShapes: false }] } });
      storage.setItem('visionos-board-store', 'board data is unrelated');
      expect(clearWorkspaceSummary()).toBe(true);
      expect(storage.getItem('visionos-board-store')).toBe('board data is unrelated');
      expect(readWorkspaceSummary()).toEqual({ status: 'unavailable' });
    });
  });
});
