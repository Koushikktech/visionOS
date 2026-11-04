import { describe, expect, it } from 'bun:test';
import type { Editor, TLPageId, TLShapeId } from '@tldraw/tldraw';
import { docSectionsValidator, slideItemsValidator } from './shapeContentSchema';
import { insertStudioExample, STUDIO_EXAMPLE_LABELS } from './studioExamples';

type SamplePage = { id: string; name: string; meta: Record<string, unknown> };
type SampleShape = {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

class ExampleEditorStub {
  options = { maxPages: 40 };
  pages: SamplePage[] = [];
  shapes: SampleShape[] = [];
  bindings: Array<Record<string, unknown>> = [];
  currentPageId: string | null = null;
  batchCount = 0;
  runOptions: unknown[] = [];
  zoomCount = 0;
  markCount = 0;
  bailCount = 0;
  failShapeCreation = false;

  getPage(id: TLPageId) {
    return this.pages.find((page) => page.id === id);
  }

  getPages() {
    return this.pages;
  }

  getIsReadonly() {
    return false;
  }

  markHistoryStoppingPoint() {
    this.markCount += 1;
    return `mark-${this.markCount}`;
  }

  bailToMark() {
    this.bailCount += 1;
  }

  createPage(page: Partial<SamplePage>) {
    if (!page.id || !page.name) throw new Error('Page needs an id and name.');
    if (this.getPage(page.id as TLPageId)) throw new Error('Page id already exists.');
    this.pages.push({ id: page.id, name: page.name, meta: page.meta || {} });
  }

  setCurrentPage(pageId: TLPageId) {
    this.currentPageId = pageId;
  }

  createShape(shape: SampleShape) {
    if (this.failShapeCreation) throw new Error('Fixture shape could not be saved.');
    this.shapes.push(shape);
  }

  createBinding(binding: Record<string, unknown>) {
    this.bindings.push(binding);
  }

  run(operation: () => void, options?: unknown) {
    this.batchCount += 1;
    this.runOptions.push(options);
    operation();
  }

  zoomToFit() {
    this.zoomCount += 1;
  }
}

function makeEditor() {
  const stub = new ExampleEditorStub();
  return { stub, editor: stub as unknown as Editor };
}

describe('insertStudioExample', () => {
  it('adds Field Notes as one undoable page transaction with real document, deck, sketch, and inert timer records', () => {
    const { stub, editor } = makeEditor();
    insertStudioExample(editor, 'field-notes', 'open-field-notes-1');

    expect(stub.pages).toHaveLength(1);
    expect(stub.pages[0]?.name).toBe(STUDIO_EXAMPLE_LABELS['field-notes']);
    expect(stub.currentPageId).toBe(stub.pages[0]?.id);
    expect(stub.batchCount).toBe(1);
    expect(stub.markCount).toBe(1);
    expect(stub.zoomCount).toBe(1);
    expect(stub.shapes.map((shape) => shape.type)).toEqual(['draw', 'geo', 'geo', 'geo', 'artifact', 'document', 'slide_deck']);

    const brief = stub.shapes.find((shape) => shape.type === 'document');
    const deck = stub.shapes.find((shape) => shape.type === 'slide_deck');
    const timer = stub.shapes.find((shape) => shape.type === 'artifact');
    expect(docSectionsValidator.validate(brief?.props.sections)).toHaveLength(2);
    expect(slideItemsValidator.validate(deck?.props.slides)).toHaveLength(3);
    expect(timer?.props.networkEnabled).toBe(false);
    expect(timer?.props.runtimePaused).toBe(false);
    const timerCode = String(timer?.props.code);
    expect(timerCode).toContain("addEventListener('click'");
    expect(timerCode).toContain('clearInterval');
    expect(timerCode).not.toMatch(/https?:\/\/|<script[^>]+src=|@import\s|\bfetch\s*\(/i);
  });

  it('opens the same intent page on retry without duplicating or replacing edited sample shapes', () => {
    const { stub, editor } = makeEditor();
    insertStudioExample(editor, 'connections', 'open-connections-2');
    const pageId = stub.pages[0]?.id;
    const shapeSnapshot = [...stub.shapes];
    stub.shapes[0]!.props.richText = 'User-edited note';

    insertStudioExample(editor, 'connections', 'open-connections-2');

    expect(stub.pages).toHaveLength(1);
    expect(stub.currentPageId).toBe(pageId);
    expect(stub.shapes).toHaveLength(shapeSnapshot.length);
    expect(stub.shapes[0]?.props.richText).toBe('User-edited note');
    expect(stub.batchCount).toBe(1);
    expect(stub.bindings).toHaveLength(4);
    expect(stub.zoomCount).toBe(1);
  });

  it('uses a different page and stable shape identities for independent intents without touching existing content', () => {
    const { stub, editor } = makeEditor();
    const existingPage = { id: 'page:existing' as TLPageId, name: 'My canvas', meta: {} };
    stub.pages.push(existingPage);
    const existingShape: SampleShape = {
      id: 'shape:user-work' as TLShapeId,
      type: 'geo',
      x: 1,
      y: 2,
      props: { w: 100, h: 100 },
    };
    stub.shapes.push(existingShape);

    insertStudioExample(editor, 'brief-slides', 'open-brief-3');
    const sampleIds = stub.shapes.slice(1).map((shape) => shape.id);
    insertStudioExample(editor, 'brief-slides', 'open-brief-4');

    expect(stub.pages).toHaveLength(3);
    expect(stub.pages[0]).toEqual(existingPage);
    expect(stub.shapes[0]).toBe(existingShape);
    expect(new Set(sampleIds).size).toBe(sampleIds.length);
    expect(stub.shapes).toHaveLength(5);
    expect(stub.batchCount).toBe(2);
  });

  it('rejects empty or conflicting intent IDs without changing the page', () => {
    const { stub, editor } = makeEditor();
    expect(() => insertStudioExample(editor, 'field-notes', '  ')).toThrow('intent is required');
    insertStudioExample(editor, 'field-notes', 'shared-intent');
    expect(() => insertStudioExample(editor, 'connections', 'shared-intent')).toThrow('another example');
    expect(stub.pages).toHaveLength(1);
    expect(stub.batchCount).toBe(1);
  });

  it('checks the editor page limit before creating any example records', () => {
    const { stub, editor } = makeEditor();
    stub.options.maxPages = 1;
    stub.pages.push({ id: 'page:only-page', name: 'Only page', meta: {} });

    expect(() => insertStudioExample(editor, 'connections', 'open-connections-cap')).toThrow('1-page limit');
    expect(stub.pages).toHaveLength(1);
    expect(stub.shapes).toHaveLength(0);
    expect(stub.batchCount).toBe(0);
    expect(stub.markCount).toBe(0);
  });

  it('rolls a failed insertion back to its history mark and reports the original error', () => {
    const { stub, editor } = makeEditor();
    stub.failShapeCreation = true;

    expect(() => insertStudioExample(editor, 'field-notes', 'open-field-notes-fail')).toThrow('Fixture shape could not be saved');
    expect(stub.markCount).toBe(1);
    expect(stub.bailCount).toBe(1);
    expect(stub.zoomCount).toBe(0);
  });

  it('recreates the same page and shape IDs for the same intent in a fresh editor', () => {
    const first = makeEditor();
    const second = makeEditor();
    insertStudioExample(first.editor, 'brief-slides', 'stable-intent');
    insertStudioExample(second.editor, 'brief-slides', 'stable-intent');

    expect(second.stub.pages[0]?.id).toBe(first.stub.pages[0]?.id);
    expect(second.stub.shapes.map((shape) => shape.id)).toEqual(first.stub.shapes.map((shape) => shape.id));
  });
});
