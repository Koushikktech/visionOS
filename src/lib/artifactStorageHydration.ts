/**
 * Reconcile the board snapshot (which may have reached tldraw's throttled
 * persistence later) with an app-storage snapshot recovered from IndexedDB.
 * A recovery stays authoritative only while the board keeps presenting the
 * exact snapshot that was present when recovery began. A different board
 * value is an explicit newer store update and wins.
 */
export function sameArtifactStorage(
  left: Record<string, string>,
  right: Record<string, string>
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

function cloneStorage(storage: Record<string, string>) {
  const clone = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(storage)) clone[key] = value;
  return clone;
}

export function createArtifactStorageSnapshotReconciler(initialBoardStorage: Record<string, string>) {
  let lastBoardStorage = cloneStorage(initialBoardStorage);
  let recoveredStorage: Record<string, string> | null = null;

  return {
    /** Start a new source/workspace hydration boundary from the live board. */
    reset(boardStorage: Record<string, string>) {
      lastBoardStorage = cloneStorage(boardStorage);
      recoveredStorage = null;
      return cloneStorage(boardStorage);
    },

    /** Keep a durable sidecar snapshot ahead of a stale board prop. */
    adoptRecovery(storage: Record<string, string>) {
      recoveredStorage = cloneStorage(storage);
      return cloneStorage(storage);
    },

    /** Return the value to use when tldraw presents another storage prop. */
    observeBoardSnapshot(boardStorage: Record<string, string>) {
      const next = cloneStorage(boardStorage);
      if (recoveredStorage) {
        if (sameArtifactStorage(next, recoveredStorage)) {
          recoveredStorage = null;
        } else if (sameArtifactStorage(next, lastBoardStorage)) {
          return cloneStorage(recoveredStorage);
        } else {
          // The live store has advanced independently while recovery was
          // in flight, so its new snapshot takes precedence.
          recoveredStorage = null;
        }
      }
      lastBoardStorage = next;
      return cloneStorage(next);
    },
  };
}
