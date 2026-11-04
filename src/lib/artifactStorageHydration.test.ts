import { describe, expect, it } from 'bun:test';
import { createArtifactStorageSnapshotReconciler } from './artifactStorageHydration';

describe('artifact storage hydration reconciliation', () => {
  it('keeps recovered app data while board props remain at the older snapshot', () => {
    const boardAtMount = { count: '3', fixture: 'test' };
    const reconciler = createArtifactStorageSnapshotReconciler(boardAtMount);

    expect(reconciler.adoptRecovery({ count: '4', fixture: 'test' })).toEqual({
      count: '4', fixture: 'test',
    });
    expect(reconciler.observeBoardSnapshot(boardAtMount)).toEqual({
      count: '4', fixture: 'test',
    });
    // Once the board catches up, it becomes the observed baseline.
    expect(reconciler.observeBoardSnapshot({ count: '4', fixture: 'test' })).toEqual({
      count: '4', fixture: 'test',
    });
    expect(reconciler.observeBoardSnapshot({ count: '5', fixture: 'test' })).toEqual({
      count: '5', fixture: 'test',
    });
  });

  it('accepts a genuinely newer board change while recovery is pending', () => {
    const reconciler = createArtifactStorageSnapshotReconciler({ count: '3' });
    reconciler.adoptRecovery({ count: '4' });

    expect(reconciler.observeBoardSnapshot({ count: '5' })).toEqual({ count: '5' });
    // The stale recovery is fenced off after the independent board update.
    expect(reconciler.observeBoardSnapshot({ count: '5' })).toEqual({ count: '5' });
  });

  it('resets the fence when a source or workspace starts a new hydration', () => {
    const reconciler = createArtifactStorageSnapshotReconciler({ count: '3' });
    reconciler.adoptRecovery({ count: '4' });

    expect(reconciler.reset({ count: '8' })).toEqual({ count: '8' });
    expect(reconciler.observeBoardSnapshot({ count: '8' })).toEqual({ count: '8' });
  });
});
