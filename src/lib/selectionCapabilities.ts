export interface SelectionShapeLike {
  id: string;
  type: string;
  parentId: string;
}

export interface SelectionResolution<T extends SelectionShapeLike> {
  targets: T[];
  skippedLocked: number;
  skippedUnsupported: number;
  mixedParents: boolean;
}

/**
 * Expands selected groups and returns only leaves that support the requested
 * style. The support and lock rules are supplied by the editor's live schema,
 * so custom shapes never receive guessed native-style props.
 */
export function resolveStyleTargets<T extends SelectionShapeLike, S>(options: {
  selected: T[];
  style: S;
  getChildren: (shape: T) => T[];
  isGroup: (shape: T) => boolean;
  isLocked: (shape: T) => boolean;
  supportsStyle: (shape: T, style: S) => boolean;
}): Omit<SelectionResolution<T>, 'mixedParents'> {
  const targets: T[] = [];
  const visited = new Set<string>();
  let skippedLocked = 0;
  let skippedUnsupported = 0;

  const visit = (shape: T) => {
    if (visited.has(shape.id)) return;
    visited.add(shape.id);

    if (options.isLocked(shape)) {
      skippedLocked += 1;
      return;
    }

    if (options.isGroup(shape)) {
      const children = options.getChildren(shape);
      if (!children.length) skippedUnsupported += 1;
      for (const child of children) visit(child);
      return;
    }

    if (options.supportsStyle(shape, options.style)) targets.push(shape);
    else skippedUnsupported += 1;
  };

  for (const shape of options.selected) visit(shape);
  return { targets, skippedLocked, skippedUnsupported };
}

/**
 * Resolves a sibling-only selection for tldraw's layout and grouping APIs.
 * Filtering happens before the parent check, so locked or unsupported items
 * never get moved along with the editable subset.
 */
export function resolveSiblingTargets<T extends SelectionShapeLike>(options: {
  selected: T[];
  isLocked: (shape: T) => boolean;
  /** Groups with locked descendants cannot safely be moved or reparented. */
  hasLockedDescendant?: (shape: T) => boolean;
  isCompatible: (shape: T) => boolean;
}): SelectionResolution<T> {
  const isProtected = (shape: T) =>
    options.isLocked(shape) ||
    (shape.type === 'group' && Boolean(options.hasLockedDescendant?.(shape)));
  const unlocked = options.selected.filter((shape) => !isProtected(shape));
  const skippedLocked = options.selected.length - unlocked.length;
  const targets = unlocked.filter(options.isCompatible);
  const skippedUnsupported = unlocked.length - targets.length;
  const parents = new Set(targets.map((shape) => shape.parentId));
  const mixedParents = parents.size > 1;

  return {
    targets: mixedParents ? [] : targets,
    skippedLocked,
    skippedUnsupported,
    mixedParents,
  };
}

/**
 * Selects safe groups to ungroup. A group with any locked descendant is
 * excluded because ungrouping would reparent those children.
 */
export function resolveUngroupTargets<T extends SelectionShapeLike>(options: {
  selected: T[];
  isLocked: (shape: T) => boolean;
  hasLockedDescendant: (shape: T) => boolean;
}): SelectionResolution<T> {
  const unlocked = options.selected.filter((shape) => !options.isLocked(shape));
  const skippedLocked = options.selected.length - unlocked.length;
  const targets = unlocked.filter(
    (shape) => shape.type === 'group' && !options.hasLockedDescendant(shape)
  );
  const skippedUnsupported = unlocked.length - targets.length;
  const parents = new Set(targets.map((shape) => shape.parentId));
  const mixedParents = parents.size > 1;

  return {
    targets: mixedParents ? [] : targets,
    skippedLocked,
    skippedUnsupported,
    mixedParents,
  };
}
