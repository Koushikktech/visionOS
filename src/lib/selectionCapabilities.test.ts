import { describe, expect, it } from 'bun:test';
import {
  resolveSiblingTargets,
  resolveStyleTargets,
  resolveUngroupTargets,
  type SelectionShapeLike,
} from './selectionCapabilities';

type Shape = SelectionShapeLike & { locked?: boolean; styles?: string[] };

const shape = (
  id: string,
  type: string,
  parentId = 'page:one',
  extra: Partial<Shape> = {}
): Shape => ({ id, type, parentId, ...extra });

describe('selection capability resolution', () => {
  it('applies styles only to supported shapes and reports skipped custom or locked shapes', () => {
    const text = shape('shape:text', 'text', 'page:one', { styles: ['color', 'size'] });
    const custom = shape('shape:custom', 'custom_card', 'page:one', { styles: [] });
    const locked = shape('shape:locked', 'geo', 'page:one', { locked: true, styles: ['color'] });
    const all = [text, custom, locked];

    const result = resolveStyleTargets({
      selected: all,
      style: 'color',
      getChildren: () => [],
      isGroup: (candidate) => candidate.type === 'group',
      isLocked: (candidate) => Boolean(candidate.locked),
      supportsStyle: (candidate, style) => candidate.styles?.includes(style) ?? false,
    });

    expect(result.targets).toEqual([text]);
    expect(result.skippedLocked).toBe(1);
    expect(result.skippedUnsupported).toBe(1);
  });

  it('expands groups while respecting inherited locks and deduplicating nested children', () => {
    const group = shape('group:outer', 'group');
    const lockedGroup = shape('group:locked', 'group', group.id, { locked: true });
    const text = shape('shape:text', 'text', group.id, { styles: ['color'] });
    const protectedText = shape('shape:protected', 'text', lockedGroup.id, { styles: ['color'] });
    const children = new Map<string, Shape[]>([
      [group.id, [lockedGroup, text]],
      [lockedGroup.id, [protectedText]],
    ]);

    const result = resolveStyleTargets({
      selected: [group, text],
      style: 'color',
      getChildren: (candidate) => children.get(candidate.id) ?? [],
      isGroup: (candidate) => candidate.type === 'group',
      isLocked: (candidate) => Boolean(candidate.locked),
      supportsStyle: (candidate, style) => candidate.styles?.includes(style) ?? false,
    });

    expect(result.targets).toEqual([text]);
    expect(result.skippedLocked).toBe(1);
    expect(result.skippedUnsupported).toBe(0);
  });

  it('rejects cross-parent layout and filters locked items before grouping', () => {
    const editable = shape('shape:editable', 'geo', 'group:one');
    const locked = shape('shape:locked', 'geo', 'group:two', { locked: true });
    const sameParent = resolveSiblingTargets({
      selected: [editable, locked],
      isLocked: (candidate) => Boolean(candidate.locked),
      isCompatible: () => true,
    });
    const crossParent = resolveSiblingTargets({
      selected: [editable, shape('shape:other', 'geo', 'group:two')],
      isLocked: () => false,
      isCompatible: () => true,
    });

    expect(sameParent.targets).toEqual([editable]);
    expect(sameParent.skippedLocked).toBe(1);
    expect(sameParent.mixedParents).toBe(false);
    expect(crossParent.targets).toEqual([]);
    expect(crossParent.mixedParents).toBe(true);
  });

  it('skips groups with locked descendants before any sibling move or grouping', () => {
    const protectedGroup = shape('group:protected', 'group', 'page:one');
    const editable = shape('shape:editable', 'geo', 'page:one');
    const safeSibling = shape('shape:safe', 'text', 'page:one');
    const result = resolveSiblingTargets({
      selected: [protectedGroup, editable, safeSibling],
      isLocked: () => false,
      hasLockedDescendant: (candidate) => candidate.id === protectedGroup.id,
      isCompatible: () => true,
    });

    expect(result.targets).toEqual([editable, safeSibling]);
    expect(result.skippedLocked).toBe(1);
    expect(result.mixedParents).toBe(false);
  });

  it('never ungroups locked groups or groups containing locked descendants', () => {
    const safeGroup = shape('group:safe', 'group', 'page:one');
    const lockedGroup = shape('group:locked', 'group', 'page:one', { locked: true });
    const protectedGroup = shape('group:protected-child', 'group', 'page:one');
    const result = resolveUngroupTargets({
      selected: [safeGroup, lockedGroup, protectedGroup],
      isLocked: (candidate) => Boolean(candidate.locked),
      hasLockedDescendant: (candidate) => candidate.id === protectedGroup.id,
    });

    expect(result.targets).toEqual([safeGroup]);
    expect(result.skippedLocked).toBe(1);
    expect(result.skippedUnsupported).toBe(1);
  });

  it('rejects ungrouping groups from different parents', () => {
    const result = resolveUngroupTargets({
      selected: [shape('group:a', 'group', 'page:a'), shape('group:b', 'group', 'page:b')],
      isLocked: () => false,
      hasLockedDescendant: () => false,
    });

    expect(result.targets).toEqual([]);
    expect(result.mixedParents).toBe(true);
  });
});
