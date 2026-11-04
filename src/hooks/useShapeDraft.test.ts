import { describe, expect, it } from 'bun:test';
import {
  clearShapeDraft,
  hasActiveShapeDraft,
  matchesShapeDraftValue,
  readShapeDraft,
  writeShapeDraft,
} from './useShapeDraft';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe('shape draft recovery records', () => {
  it('round-trips a bounded draft within its tab scope and clears only that scope', () => {
    const storage = new MemoryStorage();
    const record = {
      value: { title: 'Local title', content: 'Unsaved text' },
      baseRevision: JSON.stringify({ title: 'Original', content: 'Saved text' }),
      updatedAt: 100,
    };
    expect(writeShapeDraft('rich_card:shape:1', record, storage, 'tab-a')).toBe(true);
    expect(readShapeDraft('rich_card:shape:1', storage, 'tab-a')).toEqual(record);
    expect(readShapeDraft('rich_card:shape:1', storage, 'tab-b')).toBeNull();
    expect(hasActiveShapeDraft('rich_card:shape:1', storage, 'tab-a')).toBe(true);
    expect(hasActiveShapeDraft('rich_card:shape:1', storage, 'tab-b')).toBe(false);

    clearShapeDraft('rich_card:shape:1', storage, 'tab-b');
    expect(readShapeDraft('rich_card:shape:1', storage, 'tab-a')).toEqual(record);
    clearShapeDraft('rich_card:shape:1', storage, 'tab-a');
    expect(readShapeDraft('rich_card:shape:1', storage, 'tab-a')).toBeNull();
  });

  it('ignores corrupted roots and invalid records without breaking later writes', () => {
    const storage = new MemoryStorage();
    storage.setItem('visionos-shape-drafts-v1', 'null');
    expect(readShapeDraft('code_card:shape:1', storage, 'tab')).toBeNull();

    storage.setItem(
      'visionos-shape-drafts-v1',
      JSON.stringify({
        version: 1,
        drafts: {
          'tab|visionos-board-store|broken': {
            value: { title: null },
            baseRevision: '{not-json',
            updatedAt: null,
          },
          'tab|visionos-board-store|bad-clock': {
            value: { title: 'x' },
            baseRevision: JSON.stringify({ title: 'old' }),
            updatedAt: Number.POSITIVE_INFINITY,
          },
        },
      })
    );
    expect(readShapeDraft('broken', storage, 'tab')).toBeNull();
    expect(() =>
      writeShapeDraft(
        'code_card:shape:1',
        { value: { title: 'Draft', code: 'x' }, baseRevision: '{bad', updatedAt: 1 },
        storage,
        'tab'
      )
    ).not.toThrow();
    expect(
      writeShapeDraft(
        'code_card:shape:1',
        {
          value: { title: 'Draft', language: 'ts', code: 'x' },
          baseRevision: JSON.stringify({ title: 'Saved', language: 'ts', code: '' }),
          updatedAt: 1,
        },
        storage,
        'tab'
      )
    ).toBe(true);
    expect(readShapeDraft('code_card:shape:1', storage, 'tab')?.value).toEqual({
      title: 'Draft',
      language: 'ts',
      code: 'x',
    });
  });

  it('validates recovered data against the persisted shape schema', () => {
    const saved = { title: 'Saved', language: 'typescript', code: '' };
    expect(
      matchesShapeDraftValue(
        { title: 'Draft', language: 'typescript', code: 'const x = 1;' },
        saved
      )
    ).toBe(true);
    expect(matchesShapeDraftValue({ title: null, language: 'ts', code: 'x' }, saved)).toBe(false);
    expect(matchesShapeDraftValue({ title: 'Draft', language: 'ts', code: 'x', extra: true }, saved)).toBe(false);
    expect(matchesShapeDraftValue([{ id: 1 }], [{ id: 'string' }])).toBe(false);
  });
});
