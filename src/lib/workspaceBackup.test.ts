import { describe, expect, it } from 'bun:test';
import { createTLStore, defaultShapeUtils, getSnapshot as getTldrawSnapshot, loadSnapshot as loadTldrawSnapshot, type TLEditorSnapshot } from '@tldraw/tldraw';
import { customShapeUtils } from '../shapes';
import {
  ARTIFACT_STORAGE_WORKSPACE_KEY,
  registerArtifactStorageWorkspaceFlusher,
} from './artifactStoragePersistence';
import {
  createWorkspaceBackup,
  parseWorkspaceBackupText,
  prepareDurableRecoverySnapshot,
  prepareWorkspaceBackup,
  restoreWorkspaceWithRecovery,
  stringifyBoundedJson,
  type WorkspaceSnapshotTarget,
} from './workspaceBackup';

const fakeEpochAdvance = async () => ({ previousEpoch: 0, epoch: 1 });
const fakeEpochRollback = async () => {};

function makeSnapshot(): TLEditorSnapshot {
  const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
  store.loadStoreSnapshot(store.getStoreSnapshot());
  const document = store.getStoreSnapshot();
  const records = document.store as Record<string, unknown>;
  const pageId = Object.values(document.store).find((record) => record.typeName === 'page')!.id;
  const shape = (
    id: string,
    type: string,
    index: string,
    props: Record<string, unknown>
  ) => ({
    id,
    typeName: 'shape',
    x: 20,
    y: 30,
    rotation: 0,
    index,
    parentId: pageId,
    type,
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
  });
  records['shape:doc-test'] = shape('shape:doc-test', 'document', 'a1', {
    w: 680,
    h: 520,
    title: 'Recovery document',
    subtitle: 'Backup test',
    sections: [{ id: 'intro', title: 'Introduction', content: 'Portable section text.' }],
  }) as never;
  records['shape:deck-test'] = shape('shape:deck-test', 'slide_deck', 'a2', {
    w: 800,
    h: 500,
    title: 'Recovery deck',
    slides: [{
      id: 'slide-a',
      title: 'Saved state',
      speakerNotes: 'The note survives backup.',
      stats: [{ label: 'Items', value: '3', change: '+1' }],
      columns: [{ title: 'Stored', text: 'Nested content.' }],
      timelineSteps: [{ step: '1', title: 'Save', desc: 'Write a snapshot.' }],
    }],
  }) as never;
  records['shape:app-test'] = shape('shape:app-test', 'artifact', 'a3', {
    w: 760,
    h: 520,
    title: 'Benign test app',
    code: '<!doctype html><html><body><p>paused fixture</p></body></html>',
    color: 'indigo',
    storage: { 'fixture-state': '{"count":3}' },
    networkEnabled: true,
    runtimePaused: false,
  }) as never;
  const session = getTldrawSnapshot(store).session;
  store.dispose();
  return { document, session };
}

function envelope(snapshot: TLEditorSnapshot) {
  return {
    format: 'visionos-backup',
    version: 2,
    createdAt: '2026-10-22T00:00:00.000Z',
    snapshot,
    portability: { embeddedAssetCount: 0, excludedAssets: [], exclusions: [] },
  };
}

describe('workspace backup safety', () => {
  it('round-trips real document/deck shapes and preserves app data while pausing imported apps', () => {
    const source = makeSnapshot();
    const text = stringifyBoundedJson(envelope(source));
    const prepared = prepareWorkspaceBackup(parseWorkspaceBackupText(text));
    const records = Object.values(prepared.snapshot.document.store) as Array<Record<string, any>>;
    const doc = records.find((record) => record.id === 'shape:doc-test')!;
    const deck = records.find((record) => record.id === 'shape:deck-test')!;
    const app = records.find((record) => record.id === 'shape:app-test')!;
    expect(doc.props.sections[0].content).toBe('Portable section text.');
    expect(deck.props.slides[0].stats[0].value).toBe('3');
    expect(deck.props.slides[0].speakerNotes).toBe('The note survives backup.');
    expect(app.props.storage['fixture-state']).toBe('{"count":3}');
    expect(app.props.runtimePaused).toBe(true);
    expect(app.props.networkEnabled).toBe(false);
  });

  it('migrates supported v1 optional nested fields and rejects malformed hostile values', () => {
    const old = makeSnapshot();
    const store = old.document.store as Record<string, any>;
    store['shape:doc-test'].props.sections[0] = { content: 'Old section' };
    store['shape:deck-test'].props.slides[0] = { speakerNotes: 'Old note' };
    const migrated = prepareWorkspaceBackup({ format: 'visionos-backup-v1', snapshot: old });
    expect(migrated.migratedFrom).toBe('visionos-backup-v1');
    const records = Object.values(migrated.snapshot.document.store) as Array<Record<string, any>>;
    expect(records.find((record) => record.id === 'shape:doc-test')!.props.sections[0]).toMatchObject({
      id: 'section-1', title: 'Section 1', content: 'Old section',
    });
    expect(records.find((record) => record.id === 'shape:deck-test')!.props.slides[0]).toMatchObject({
      id: 'slide-1', title: 'Slide 1', speakerNotes: 'Old note',
    });

    const invalid = makeSnapshot();
    (invalid.document.store as Record<string, any>)['shape:doc-test'].props.sections = [null];
    expect(() => prepareWorkspaceBackup(envelope(invalid))).toThrow(/malformed|invalid/i);

    const invalidDeck = makeSnapshot();
    (invalidDeck.document.store as Record<string, any>)['shape:deck-test'].props.slides[0].title = { text: 'wrong type' };
    expect(() => prepareWorkspaceBackup(envelope(invalidDeck))).toThrow(/title|validation/i);
  });

  it('defaults an omitted current page before exercising tldraw session loading and replaces live records', async () => {
    const next = makeSnapshot();
    next.session = { version: 0, pageStates: [] };
    const prepared = prepareWorkspaceBackup(envelope(next));
    const expectedPageId = Object.values(prepared.snapshot.document.store).find((record) => record.typeName === 'page')!.id;
    expect(prepared.snapshot.session.currentPageId).toBe(expectedPageId);
    expect(prepareDurableRecoverySnapshot(makeSnapshot()).snapshot.document.store).toBeDefined();
    const invalidPage = makeSnapshot();
    invalidPage.session.currentPageId = 'page:missing' as never;
    expect(() => prepareWorkspaceBackup(envelope(invalidPage))).toThrow(/page/i);

    const previous = makeSnapshot();
    const previousRecords = previous.document.store as Record<string, any>;
    const oldShape = { ...previousRecords['shape:doc-test'], id: 'shape:old-only', index: 'a4' };
    previousRecords['shape:old-only'] = oldShape;
    const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
    loadTldrawSnapshot(store, previous);
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => getTldrawSnapshot(store),
      loadSnapshot: (snapshot) => loadTldrawSnapshot(store, snapshot),
    };
    await restoreWorkspaceWithRecovery(target, prepared.snapshot, async () => {}, fakeEpochAdvance, fakeEpochRollback);
    expect(store.get('shape:old-only' as never)).toBeUndefined();
    expect(store.get('shape:doc-test' as never)).toBeDefined();
    expect(store.get('shape:deck-test' as never)).toBeDefined();
    expect(store.get('shape:app-test' as never)).toBeDefined();
    expect(getTldrawSnapshot(store).session.currentPageId).toBe(expectedPageId);
    store.dispose();
  });

  it('rejects duplicate IDs, out-of-range dimensions, nonfinite geometry, and oversized content', () => {
    const duplicate = makeSnapshot();
    const records = duplicate.document.store as Record<string, any>;
    records['shape:doc-copy'] = { ...records['shape:doc-test'], id: 'shape:doc-copy' };
    records['shape:doc-copy'].props.sections = [{ id: 'intro', title: 'One', content: '' }, { id: 'intro', title: 'Two', content: '' }];
    expect(() => prepareWorkspaceBackup(envelope(duplicate))).toThrow(/duplicate/i);

    const extreme = makeSnapshot();
    (extreme.document.store as Record<string, any>)['shape:doc-test'].props.w = 100_001;
    expect(() => prepareWorkspaceBackup(envelope(extreme))).toThrow(/dimension/i);

    const nonfinite = makeSnapshot();
    (nonfinite.document.store as Record<string, any>)['shape:doc-test'].x = Number.NaN;
    expect(() => prepareWorkspaceBackup(envelope(nonfinite))).toThrow(/coordinate/i);

    const oversized = makeSnapshot();
    (oversized.document.store as Record<string, any>)['shape:doc-test'].props.sections = Array.from({ length: 501 }, (_, i) => ({
      id: `section-${i}`, title: 'Section', content: '',
    }));
    expect(() => prepareWorkspaceBackup(envelope(oversized))).toThrow(/at most 500/i);
  });

  it('embeds accessible bounded local image bytes and reports nonportable references', async () => {
    const snapshot = makeSnapshot();
    (snapshot.document.store as Record<string, unknown>)['asset:image-test'] = {
      id: 'asset:image-test',
      typeName: 'asset',
      type: 'image',
      props: { w: 1, h: 1, name: 'pixel.png', isAnimated: false, mimeType: 'image/png', src: 'asset:local-pixel' },
      meta: {},
    } as never;
    (snapshot.document.store as Record<string, unknown>)['asset:remote-test'] = {
      id: 'asset:remote-test',
      typeName: 'asset',
      type: 'image',
      props: { w: 1, h: 1, name: 'remote.png', isAnimated: false, mimeType: 'image/png', src: 'https://cdn.example.test/pixel.png' },
      meta: {},
    } as never;
    const resolvedAssetIds: string[] = [];
    const { blob, portability } = await createWorkspaceBackup(snapshot, {
      origin: 'https://canvas.example.test',
      fetchAsset: (async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))) as typeof fetch,
      resolveAssetUrl: async (assetId) => {
        resolvedAssetIds.push(assetId);
        return 'blob:local-pixel';
      },
    });
    expect(blob.size).toBeLessThan(25_000_000);
    expect(portability.embeddedAssetCount).toBe(1);
    expect(portability.excludedAssets).toEqual([{ id: 'asset:remote-test', reason: 'external' }]);
    expect(resolvedAssetIds).toEqual(['asset:local-pixel']);
    const prepared = prepareWorkspaceBackup(parseWorkspaceBackupText(await blob.text()));
    const assets = Object.values(prepared.snapshot.document.store) as Array<Record<string, any>>;
    expect(assets.find((asset) => asset.id === 'asset:image-test')!.props.src).toBe('data:image/png;base64,AQID');
    expect(assets.find((asset) => asset.id === 'shape:app-test')!.props.storage['fixture-state']).toBe('{"count":3}');
  });

  it('detects duplicate raw JSON keys before parsing, and aborts a restore if live edits race the recovery write', async () => {
    expect(() => parseWorkspaceBackupText('{"format":"visionos-backup","format":"canvasos-backup-v1"}')).toThrow(/duplicate JSON key/i);
    expect(() => parseWorkspaceBackupText('{"snapshot":{"document":{"store":{"shape:test":{},"shape:test":{}}}}}')).toThrow(/duplicate JSON key/i);

    const start = makeSnapshot();
    const edited = makeSnapshot();
    (edited.document.store as Record<string, any>)['shape:doc-test'].props.title = 'Edited while saving';
    let live = start;
    let loads = 0;
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => live,
      loadSnapshot: (next) => { loads++; live = next; },
    };
    const writes: TLEditorSnapshot[] = [];
    await expect(restoreWorkspaceWithRecovery(target, makeSnapshot(), async (copy) => {
      writes.push(copy);
      if (writes.length === 1) live = edited;
    }, fakeEpochAdvance, fakeEpochRollback)).rejects.toThrow(/changed while (?:its|the) recovery copy/i);
    expect(loads).toBe(0);
    expect((live.document.store as Record<string, any>)['shape:doc-test'].props.title).toBe('Edited while saving');
    expect(writes).toHaveLength(2);
  });

  it('rolls back only after live loading starts and rejects untrusted portability metadata', async () => {
    const valid = envelope(makeSnapshot());
    expect(() => prepareWorkspaceBackup({
      ...valid,
      portability: { embeddedAssetCount: 0, excludedAssets: [{ id: 'asset:a', reason: 'unknown' }], exclusions: [] },
    })).toThrow(/portability/i);

    const previous = makeSnapshot();
    let live = previous;
    let loads = 0;
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => live,
      loadSnapshot: (next) => {
        loads++;
        if (loads === 1) throw new Error('simulated failure after live load started');
        live = next;
      },
    };
    await expect(restoreWorkspaceWithRecovery(target, makeSnapshot(), async () => {}, fakeEpochAdvance, fakeEpochRollback))
      .rejects.toThrow(/simulated failure/i);
    expect(loads).toBe(2);
    expect(live).toBe(previous);
  });

  it('emits no imported records to tldraw persistence listeners after a failed loader', async () => {
    const previous = makeSnapshot();
    const imported = makeSnapshot();
    (imported.document.store as Record<string, any>)['shape:import-only'] = {
      ...(imported.document.store as Record<string, any>)['shape:doc-test'],
      id: 'shape:import-only',
      index: 'a9',
      props: { ...(imported.document.store as Record<string, any>)['shape:doc-test'].props, title: 'Imported transient record' },
    };
    (imported.document.store as Record<string, any>)['shape:doc-test'].props.title = 'Imported replacement';

    const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
    loadTldrawSnapshot(store, previous);
    const beforeSnapshot = getTldrawSnapshot(store);
    const persistenceReplica = new Map(Object.entries(beforeSnapshot.document.store));
    const isDocumentRecord = (record: { typeName: string }) =>
      (store.schema.types as Record<string, { scope?: string }>)[record.typeName]?.scope === 'document';
    const stopListening = store.listen(({ changes }) => {
      for (const [id, record] of Object.entries(changes.added)) if (isDocumentRecord(record)) persistenceReplica.set(id, record);
      for (const [id, [, record]] of Object.entries(changes.updated)) if (isDocumentRecord(record)) persistenceReplica.set(id, record);
      for (const [id, record] of Object.entries(changes.removed)) if (isDocumentRecord(record)) persistenceReplica.delete(id);
    });
    let loads = 0;
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => getTldrawSnapshot(store),
      loadSnapshot: (snapshot, options) => {
        loads++;
        loadTldrawSnapshot(store, snapshot, options);
        if (loads === 1) throw new Error('simulated post-import persistence failure');
      },
      runAtomically: (operation) => { (store as any).atomic(operation); },
    };

    await expect(restoreWorkspaceWithRecovery(
      target,
      prepareWorkspaceBackup(envelope(imported)).snapshot,
      async () => {},
      fakeEpochAdvance,
      fakeEpochRollback
    )).rejects.toThrow(/post-import persistence failure/i);

    const afterSnapshot = getTldrawSnapshot(store);
    expect(loads).toBe(2);
    expect(afterSnapshot).toEqual(beforeSnapshot);
    expect(afterSnapshot.document.store['shape:import-only' as never]).toBeUndefined();
    expect(persistenceReplica.get('shape:import-only')).toBeUndefined();
    expect(Object.fromEntries(persistenceReplica)).toEqual(beforeSnapshot.document.store);
    expect((afterSnapshot.document.store as Record<string, any>)['shape:doc-test'].props.title)
      .toBe((beforeSnapshot.document.store as Record<string, any>)['shape:doc-test'].props.title);
    stopListening();
    store.dispose();
  });

  it('keeps edits made during durable app-storage epoch preparation and rolls the namespace back', async () => {
    const previous = makeSnapshot();
    const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
    loadTldrawSnapshot(store, previous);
    let loads = 0;
    let epochRolledBack = false;
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => getTldrawSnapshot(store),
      loadSnapshot: (snapshot, options) => {
        loads++;
        loadTldrawSnapshot(store, snapshot, options);
      },
    };

    await expect(restoreWorkspaceWithRecovery(
      target,
      makeSnapshot(),
      async () => {},
      async () => {
        (store as any).update('shape:doc-test', (record: any) => ({
          ...record,
          props: { ...record.props, title: 'Edited while app storage committed' },
        }));
        return { previousEpoch: 4, epoch: 5 };
      },
      async (_workspaceKey, expectedEpoch, previousEpoch) => {
        epochRolledBack = expectedEpoch === 5 && previousEpoch === 4;
      }
    )).rejects.toThrow(/changed while the recovery copy/i);

    const after = getTldrawSnapshot(store);
    expect(loads).toBe(0);
    expect(epochRolledBack).toBe(true);
    expect((after.document.store as Record<string, any>)['shape:doc-test'].props.title)
      .toBe('Edited while app storage committed');
    store.dispose();
  });

  it('flushes debounced app mutations into the durable recovery copy before restore starts', async () => {
    const previous = makeSnapshot();
    const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
    loadTldrawSnapshot(store, previous);
    let flushCount = 0;
    const unregister = registerArtifactStorageWorkspaceFlusher(ARTIFACT_STORAGE_WORKSPACE_KEY, () => {
      if (flushCount++ !== 0) return;
      (store as any).update('shape:app-test', (record: any) => ({
        ...record,
        props: { ...record.props, storage: { 'pending-key': 'captured before restore' } },
      }));
    });
    let recoveryStorage: unknown;
    const target: WorkspaceSnapshotTarget = {
      getSnapshot: () => getTldrawSnapshot(store),
      loadSnapshot: (snapshot, options) => loadTldrawSnapshot(store, snapshot, options),
    };
    try {
      await restoreWorkspaceWithRecovery(
        target,
        makeSnapshot(),
        async (copy) => {
          recoveryStorage = (copy.document.store as Record<string, any>)['shape:app-test'].props.storage;
        },
        fakeEpochAdvance,
        fakeEpochRollback
      );
      expect(recoveryStorage).toEqual({ 'pending-key': 'captured before restore' });
    } finally {
      unregister();
      store.dispose();
    }
  });
});
