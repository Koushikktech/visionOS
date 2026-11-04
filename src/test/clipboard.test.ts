import { describe, expect, it } from 'bun:test';
import { copyTextToClipboard } from '../components/SpatialAIOmnibar';

describe('Spatial AI copy feedback result', () => {
  it('reports success only after the Clipboard API resolves', async () => {
    let copied = '';
    const clipboard = {
      writeText: async (text: string) => { copied = text; },
    };

    await expect(copyTextToClipboard('canvas note', clipboard, null)).resolves.toBe(true);
    expect(copied).toBe('canvas note');
  });

  it('uses the selection-copy fallback after clipboard permission is denied', async () => {
    let attached = false;
    let removed = false;
    let copied = false;
    let focusRestored = false;
    let restoredSelection: [number, number, 'forward' | 'backward' | 'none'] | null = null;
    const previouslyFocused = {
      tagName: 'INPUT',
      isConnected: true,
      selectionStart: 2,
      selectionEnd: 5,
      selectionDirection: 'backward',
      focus: () => { focusRestored = true; },
      setSelectionRange: (start: number, end: number, direction: 'forward' | 'backward' | 'none') => {
        restoredSelection = [start, end, direction];
      },
    } as unknown as HTMLInputElement;
    const textArea = {
      value: '',
      style: {} as CSSStyleDeclaration,
      setAttribute: () => {},
      select: () => {},
      remove: () => { removed = true; },
    } as unknown as HTMLTextAreaElement;
    const doc = {
      activeElement: previouslyFocused,
      body: { appendChild: () => { attached = true; } },
      createElement: () => textArea,
      execCommand: (command: string) => {
        copied = command === 'copy';
        return copied;
      },
    } as unknown as Document;

    const succeeded = await copyTextToClipboard(
      'draft response',
      { writeText: async () => { throw new Error('Permission denied'); } },
      doc
    );

    expect(succeeded).toBe(true);
    expect(attached).toBe(true);
    expect(copied).toBe(true);
    expect(removed).toBe(true);
    expect(focusRestored).toBe(true);
    expect(restoredSelection).toEqual([2, 5, 'backward']);
  });

  it('reports fallback failure and still cleans up when a DOM selection operation throws', async () => {
    let removed = false;
    const textArea = {
      value: '',
      style: {} as CSSStyleDeclaration,
      setAttribute: () => {},
      select: () => { throw new Error('Selection is unavailable'); },
      remove: () => { removed = true; throw new Error('Cleanup failed'); },
    } as unknown as HTMLTextAreaElement;
    const doc = {
      body: { appendChild: () => {} },
      createElement: () => textArea,
      execCommand: () => true,
    } as unknown as Document;

    await expect(copyTextToClipboard('private text', null, doc)).resolves.toBe(false);
    expect(removed).toBe(true);
  });

  it('does not report success when neither clipboard path succeeds', async () => {
    const succeeded = await copyTextToClipboard('private text', null, null);
    expect(succeeded).toBe(false);
  });
});
