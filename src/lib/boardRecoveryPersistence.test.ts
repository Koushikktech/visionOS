import { describe, expect, it } from 'bun:test';
import {
  createTLStore,
  defaultShapeUtils,
  getSnapshot as getTldrawSnapshot,
  loadSnapshot as loadTldrawSnapshot,
  PageRecordType,
  type Editor,
  type TLEditorSnapshot,
  type TLStoreSnapshot,
} from '@tldraw/tldraw';
import type { RecordsDiff, UnknownRecord } from '@tldraw/store';
import {
  createBoardRecoveryController,
  MAX_QUEUED_RECOVERY_BYTES,
  type BoardRecoveryCommitResult,
  type BoardRecoveryMeta,
  type BoardRecoveryRead,
  type BoardRecoveryStorage,
  type BoardRecoveryControllerOptions,
} from './boardRecoveryPersistence';
import {
  ARTIFACT_STORAGE_WORKSPACE_KEY,
  registerArtifactStorageWorkspaceFlusher,
} from './artifactStoragePersistence';
import { restoreWorkspaceWithRecovery } from './workspaceBackup';

function copy<T>(value: T): T { return structuredClone(value); }

class MemoryBoardRecoveryStorage implements BoardRecoveryStorage {
  private meta: BoardRecoveryMeta | null = null;
  private records = new Map<string, UnknownRecord>();
  lastAppliedIds: string[] = [];
  applyCalls = 0;
  pendingApply: { promise: Promise<void>; release(): void } | null = null;

  async read(): Promise<BoardRecoveryRead> {
    return {
      meta: this.meta ? copy(this.meta) : null,
      records: new Map([...this.records].map(([id, record]) => [id, copy(record)])),
    };
  }

  async seed(snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult> {
    if (this.meta) return { status: 'conflict', current: await this.read() };
    return this.replace(0, snapshot);
  }

  async apply(diff: RecordsDiff<UnknownRecord>): Promise<BoardRecoveryCommitResult> {
    this.applyCalls++;
    if (this.pendingApply) await this.pendingApply.promise;
    if (!this.meta) throw new Error('Recovery storage has not been seeded.');
    const changes = [
      ...Object.entries(diff.added).map(([id, after]) => ({ id, before: undefined, after })),
      ...Object.entries(diff.updated).map(([id, [before, after]]) => ({ id, before, after })),
      ...Object.entries(diff.removed).map(([id, before]) => ({ id, before, after: undefined })),
    ];
    this.lastAppliedIds = changes.map(({ id }) => id);
    for (const { id, before, after } of changes) {
      const current = this.records.get(id);
      if (same(current, after)) continue;
      if (!same(current, before)) return { status: 'conflict', current: await this.read() };
    }
    for (const { id, after } of changes) {
      if (after === undefined) this.records.delete(id);
      else this.records.set(id, copy(after));
    }
    this.meta = this.metadata(this.meta.revision + 1, this.meta.session, this.meta.schema);
    return { status: 'committed', meta: copy(this.meta) };
  }

  async replace(expectedRevision: number, snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult> {
    if (this.meta && this.meta.revision !== expectedRevision) return { status: 'conflict', current: await this.read() };
    if (!this.meta && expectedRevision !== 0) return { status: 'conflict', current: await this.read() };
    this.records = new Map(Object.entries(snapshot.document.store).map(([id, record]) => [id, copy(record)]));
    this.meta = this.metadata((this.meta?.revision ?? 0) + 1, snapshot.session, snapshot.document.schema);
    return { status: 'committed', meta: copy(this.meta) };
  }

  async replaceExternal(snapshot: TLEditorSnapshot) {
    await this.replace(this.meta?.revision ?? 0, snapshot);
  }

  get revision() { return this.meta?.revision ?? 0; }

  delayNextApply() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.pendingApply = { promise, release };
  }

  releaseApply() {
    this.pendingApply?.release();
    this.pendingApply = null;
  }

  private metadata(revision: number, session: TLEditorSnapshot['session'], schema: TLEditorSnapshot['document']['schema']): BoardRecoveryMeta {
    let bytes = 0;
    for (const record of this.records.values()) bytes += new TextEncoder().encode(JSON.stringify(record)).byteLength;
    return {
      key: 'primarycanvas',
      schemaVersion: 1,
      revision,
      savedAt: new Date().toISOString(),
      recordCount: this.records.size,
      bytes,
      session: copy(session),
      schema: copy(schema),
    };
  }
}

class SharedRecoveryLock {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeEditor(initial?: TLEditorSnapshot) {
  const store = createTLStore({ shapeUtils: defaultShapeUtils });
  if (initial) loadTldrawSnapshot(store, copy(initial));
  else store.loadStoreSnapshot(store.getStoreSnapshot());
  const editor = {
    store,
    getSnapshot: () => getTldrawSnapshot(store),
    loadSnapshot: (snapshot: TLEditorSnapshot, options?: { forceOverwriteSessionState?: boolean }) => {
      loadTldrawSnapshot(store, snapshot, options);
    },
    run: (operation: () => void) => (store as unknown as { atomic(fn: () => void): void }).atomic(operation),
  } as unknown as Editor;
  return { editor, store };
}

function pageRecord(editor: Editor) {
  return editor.store.allRecords().find((record) => record.typeName === 'page')!;
}

async function waitForState(
  editor: Editor,
  storage: BoardRecoveryStorage,
  predicate: (status: string) => boolean,
  controller?: ReturnType<typeof createBoardRecoveryController>,
  options: Omit<BoardRecoveryControllerOptions, 'storage'> = {}
) {
  const active = controller ?? createBoardRecoveryController(editor, { storage, ...options });
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate(active.getState().status)) return active;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for recovery state. Last state: ${active.getState().status}`);
}

describe('primary board recovery copy', () => {
  it('commits changed document records, restores cleanly after reload, and pauses on a native mismatch', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const first = makeEditor();
    const controller = await waitForState(first.editor, storage, (status) => status === 'recoveryCopySaved');
    const startRevision = storage.revision;
    const page = pageRecord(first.editor);
    first.editor.store.update(page.id, (record) => ({ ...record, name: 'Saved document page' }));

    await waitForState(first.editor, storage, (status) => status === 'recoveryCopySaved' && storage.revision > startRevision, controller);
    expect(controller.getState().savedAt).toBe((await storage.read()).meta?.savedAt);
    expect(storage.lastAppliedIds).toEqual([page.id]);

    const recovery = await storage.read();
    const recovered = makeEditor({ document: { store: Object.fromEntries(recovery.records), schema: recovery.meta!.schema } as TLStoreSnapshot, session: recovery.meta!.session });
    const reloaded = await waitForState(recovered.editor, storage, (status) => status === 'recoveryCopySaved');
    expect(reloaded.getState().savedAt).toBe(recovery.meta?.savedAt);

    const stale = makeEditor();
    const mismatch = await waitForState(stale.editor, storage, (status) => status === 'conflict');
    expect(mismatch.getState().reviewRevision).toBe(storage.revision);
    expect(mismatch.getState().recoverySnapshot).not.toBeNull();
    await mismatch.keepCurrent(mismatch.getState().reviewRevision!, mismatch.getState().liveRevision!, stale.editor.getSnapshot());
    expect(mismatch.getState().status).toBe('recoveryCopySaved');
    expect((await storage.read()).records.get(page.id)).toMatchObject({ name: 'Page 1' });

    controller.dispose();
    reloaded.dispose();
    mismatch.dispose();
    first.store.dispose();
    recovered.store.dispose();
    stale.store.dispose();
  });

  it('rejects an action bound to a stale reviewed revision and never restores a newer copy implicitly', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const editor = makeEditor();
    const lock = new SharedRecoveryLock();
    const noDelayLock = <T>(operation: () => Promise<T>) => lock.run(operation);
    const controller = await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved', undefined, {
      withRecoveryWriteLock: (operation) => noDelayLock(operation),
    });
    const page = pageRecord(editor.editor);
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'Canvas version' }));
    await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved' && storage.revision > 1, controller);

    const staleSnapshot = editor.editor.getSnapshot();
    const pageId = page.id;
    const records: Record<string, any> = { ...staleSnapshot.document.store, [pageId]: { ...staleSnapshot.document.store[pageId], name: 'Reviewed recovery' } };
    await storage.replaceExternal({ ...staleSnapshot, document: { ...staleSnapshot.document, store: records } });
    editor.editor.store.update(pageId, (record) => ({ ...record, name: 'A different live edit' }));
    await waitForState(editor.editor, storage, (status) => status === 'conflict', controller);
    const reviewedRevision = controller.getState().reviewRevision!;
    const initiallyReviewedLive = editor.editor.getSnapshot();

    editor.editor.store.update(pageId, (record) => ({ ...record, name: 'Changed while review is open' }));
    await expect(controller.restoreRecovery(reviewedRevision, controller.getState().liveRevision!, initiallyReviewedLive))
      .rejects.toThrow('live board changed after you reviewed it');
    const reviewedLiveAfterRefresh = editor.editor.getSnapshot();

    await storage.replaceExternal({ ...staleSnapshot, document: { ...staleSnapshot.document, store: { ...records, [pageId]: { ...records[pageId], name: 'Newer recovery' } } } });
    await expect(controller.restoreRecovery(reviewedRevision, controller.getState().liveRevision!, reviewedLiveAfterRefresh)).rejects.toThrow('recovery copy changed');
    expect(controller.getState().status).toBe('conflict');
    expect(controller.getState().reviewRevision).toBe(reviewedRevision + 1);
    expect(controller.getState().recoverySnapshot?.document.store[pageId]).toMatchObject({ name: 'Newer recovery' });

    controller.dispose();
    editor.store.dispose();
  });

  it('stays Saving through delayed R1 and R2 commits and reports only the final committed revision', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const editor = makeEditor();
    const controller = await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved');
    const page = pageRecord(editor.editor);
    storage.delayNextApply();
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'R1' }));
    await waitForState(editor.editor, storage, (status) => status === 'saving', controller);
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'R2' }));
    expect(controller.getState().status).toBe('saving');
    expect(controller.getState().pendingChanges).toBe(2);
    expect(storage.revision).toBe(1);

    storage.releaseApply();
    await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved' && storage.revision === 3, controller);
    expect(controller.getState().savedAt).toBe((await storage.read()).meta?.savedAt);
    expect((await storage.read()).records.get(page.id)).toMatchObject({ name: 'R2' });

    controller.dispose();
    editor.store.dispose();
  });

  it('drains skipped queue batches after a delayed conflict and keeps paused edits dirty until Keep current commits', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const editor = makeEditor();
    const controller = await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved');
    const page = pageRecord(editor.editor);

    storage.delayNextApply();
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'R1' }));
    await waitForState(editor.editor, storage, (status) => status === 'saving', controller);
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'R2' }));
    expect(controller.getState().pendingChanges).toBe(2);

    const external = await storage.read();
    const externalSnapshot: TLEditorSnapshot = {
      document: { store: Object.fromEntries(external.records) as TLStoreSnapshot['store'], schema: external.meta!.schema },
      session: external.meta!.session,
    };
    (externalSnapshot.document.store[page.id] as typeof page).name = 'Other tab edit';
    await storage.replaceExternal(externalSnapshot);
    storage.releaseApply();

    await waitForState(editor.editor, storage, (status) =>
      status === 'conflict' && controller.getState().pendingChanges === 0, controller);
    expect(controller.getState().hasUncommittedChanges).toBe(true);

    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'Edit while conflict is open' }));
    expect(controller.getState().hasUncommittedChanges).toBe(true);

    const reviewed = controller.getState();
    await controller.keepCurrent(reviewed.reviewRevision!, reviewed.liveRevision!, editor.editor.getSnapshot());
    expect(controller.getState().status).toBe('recoveryCopySaved');
    expect(controller.getState().pendingChanges).toBe(0);
    expect(controller.getState().hasUncommittedChanges).toBe(false);
    expect((await storage.read()).records.get(page.id)).toMatchObject({ name: 'Edit while conflict is open' });

    controller.dispose();
    editor.store.dispose();
  });

  it('reconciles a sidecar-first peer conflict after delayed native document sync converges', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const first = makeEditor();
    const firstController = await waitForState(first.editor, storage, (status) => status === 'recoveryCopySaved');
    const second = makeEditor();
    const secondController = await waitForState(second.editor, storage, (status) => status === 'recoveryCopySaved');
    const firstPage = pageRecord(first.editor);
    const secondPage = pageRecord(second.editor);

    first.editor.store.update(firstPage.id, (record) => ({ ...record, name: 'Peer document change' }));
    await waitForState(first.editor, storage, (status) => status === 'recoveryCopySaved' && storage.revision === 2, firstController);
    await waitForState(second.editor, storage, (status) => status === 'conflict', secondController);

    // Native store synchronization is deliberately later than the app-owned
    // BroadcastChannel notice that exposed the recovery-copy revision.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(secondController.getState().status).toBe('conflict');
    second.editor.store.update(secondPage.id, (record) => ({ ...record, name: 'Peer document change' }));

    await waitForState(second.editor, storage, (status) => status === 'recoveryCopySaved', secondController);
    expect(secondController.getState().hasUncommittedChanges).toBe(false);
    expect(secondController.getState().reviewRevision).toBeUndefined();
    expect(storage.revision).toBe(2);

    firstController.dispose();
    secondController.dispose();
    first.store.dispose();
    second.store.dispose();
  });

  it('warns before unload only for real uncommitted edits after recovery storage setup fails', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    storage.read = async () => { throw new Error('Could not open browser recovery storage.'); };
    const editor = makeEditor();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    let beforeUnload: ((event: BeforeUnloadEvent) => void) | null = null;
    const fakeWindow = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        beforeUnload = listener as (event: BeforeUnloadEvent) => void;
      },
      removeEventListener: () => {},
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    const controller = createBoardRecoveryController(editor.editor, { storage });

    try {
      await waitForState(editor.editor, storage, (status) => status === 'error', controller);
      const invokeBeforeUnload = () => {
        let prevented = 0;
        const event = { preventDefault: () => { prevented++; }, returnValue: '' } as unknown as BeforeUnloadEvent;
        beforeUnload?.(event);
        return prevented;
      };
      expect(controller.getState().hasUncommittedChanges).toBe(false);
      expect(invokeBeforeUnload()).toBe(0);

      const page = pageRecord(editor.editor);
      editor.editor.store.update(page.id, (record) => ({ ...record, name: 'Edit after storage error' }));
      expect(controller.getState().hasUncommittedChanges).toBe(true);
      expect(invokeBeforeUnload()).toBe(1);
    } finally {
      controller.dispose();
      editor.store.dispose();
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('does not report saved on storage failure and stops retrying queued writes', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const editor = makeEditor();
    const controller = await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved');
    const originalSavedAt = controller.getState().savedAt;
    const page = pageRecord(editor.editor);
    const failingStorage = storage as MemoryBoardRecoveryStorage & { failNext?: boolean };
    failingStorage.apply = async () => { failingStorage.applyCalls++; throw new Error('Browser storage test failure.'); };
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'Uncommitted edit' }));
    await waitForState(editor.editor, storage, (status) => status === 'error', controller);
    expect(controller.getState().savedAt).toBe(originalSavedAt);
    expect(controller.getState().error).toContain('Browser storage test failure.');
    const callsAtFailure = storage.applyCalls;
    editor.editor.store.update(page.id, (record) => ({ ...record, name: 'Another uncommitted edit' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(storage.applyCalls).toBe(callsAtFailure);

    controller.dispose();
    editor.store.dispose();
  });

  it('bounds retained deltas while IndexedDB is slow instead of keeping an unbounded edit queue', async () => {
    const storage = new MemoryBoardRecoveryStorage();
    const editor = makeEditor();
    const controller = await waitForState(editor.editor, storage, (status) => status === 'recoveryCopySaved');
    const page = pageRecord(editor.editor);
    storage.delayNextApply();
    editor.editor.store.update(page.id, (record) => ({ ...record, meta: { payload: 'a'.repeat(9_000_000) } }));
    await waitForState(editor.editor, storage, (status) => status === 'saving', controller);
    expect(storage.applyCalls).toBe(1);
    editor.editor.store.update(page.id, (record) => ({ ...record, meta: { payload: 'b'.repeat(9_000_000) } }));
    await waitForState(editor.editor, storage, (status) => status === 'error', controller);
    expect(MAX_QUEUED_RECOVERY_BYTES).toBeLessThan(25_000_000);
    expect(controller.getState().error).toContain('16 MB safety limit');
    storage.releaseApply();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(storage.applyCalls).toBe(1);

    controller.dispose();
    editor.store.dispose();
  });

  it('normalizes a deleted current page during reviewed recovery and CAS-saves the post-load document', async () => {
    const initial = makeEditor();
    const firstPage = pageRecord(initial.editor);
    const secondPage = PageRecordType.create({ name: 'Second page', index: 'a2' as typeof firstPage.index });
    initial.editor.store.put([secondPage]);
    const initialSnapshot = initial.editor.getSnapshot();
    initialSnapshot.session.currentPageId = secondPage.id;
    initialSnapshot.session.pageStates = [{ pageId: secondPage.id, selectedShapeIds: [], focusedGroupId: null }];

    const storage = new MemoryBoardRecoveryStorage();
    await storage.seed(initialSnapshot);
    const live = makeEditor(initialSnapshot);
    const lock = new SharedRecoveryLock();
    const controller = createBoardRecoveryController(live.editor, {
      storage,
      withRecoveryWriteLock: (operation) => lock.run(operation),
      restoreWorkspace: async (target, snapshot) => {
        await restoreWorkspaceWithRecovery(target, snapshot, async () => {}, async () => ({ previousEpoch: 1, epoch: 2 }), async () => {});
      },
    });
    await waitForState(live.editor, storage, (status) => status === 'recoveryCopySaved', controller);

    const recoverySnapshot = copy(initialSnapshot);
    delete (recoverySnapshot.document.store as Record<string, unknown>)[secondPage.id];
    (recoverySnapshot.document.store as Record<string, any>)[firstPage.id] = {
      ...recoverySnapshot.document.store[firstPage.id],
      name: 'Recovery page',
    };
    await storage.replaceExternal(recoverySnapshot);
    live.editor.store.update(firstPage.id, (record) => ({ ...record, name: 'Conflicting live page' }));
    await waitForState(live.editor, storage, (status) => status === 'conflict', controller);
    const reviewedRevision = controller.getState().reviewRevision!;
    expect(controller.getState().recoverySnapshot?.session.currentPageId).toBe(firstPage.id);

    await controller.restoreRecovery(reviewedRevision, controller.getState().liveRevision!, live.editor.getSnapshot());
    expect(controller.getState().status).toBe('recoveryCopySaved');
    expect(live.editor.store.has(secondPage.id)).toBe(false);
    expect(live.editor.getSnapshot().session.currentPageId).toBe(firstPage.id);
    expect((await storage.read()).meta?.revision).toBe(reviewedRevision + 1);

    controller.dispose();
    initial.store.dispose();
    live.store.dispose();
  });

  it('holds the shared cross-tab lock from reviewed read through live load and sidecar CAS', async () => {
    const live = makeEditor();
    const livePage = pageRecord(live.editor);
    live.editor.store.update(livePage.id, (record) => ({ ...record, name: 'Live board' }));
    const liveSnapshot = live.editor.getSnapshot();

    const recovered = makeEditor();
    const recoveredPage = pageRecord(recovered.editor);
    recovered.editor.store.update(recoveredPage.id, (record) => ({ ...record, name: 'Reviewed recovery' }));
    const recoveredSnapshot = recovered.editor.getSnapshot();
    const storage = new MemoryBoardRecoveryStorage();
    await storage.seed(recoveredSnapshot);

    const lock = new SharedRecoveryLock();
    const restoring = deferred();
    const releaseRestore = deferred();
    const firstController = createBoardRecoveryController(live.editor, {
      storage,
      withRecoveryWriteLock: (operation) => lock.run(operation),
      restoreWorkspace: async (target, snapshot) => {
        restoring.resolve();
        await releaseRestore.promise;
        target.runAtomically?.(() => target.loadSnapshot(snapshot));
      },
    });
    await waitForState(live.editor, storage, (status) => status === 'conflict', firstController);
    const revision = firstController.getState().reviewRevision!;

    const writerEditor = makeEditor(recoveredSnapshot);
    const secondController = createBoardRecoveryController(writerEditor.editor, {
      storage,
      withRecoveryWriteLock: (operation) => lock.run(operation),
    });
    await waitForState(writerEditor.editor, storage, (status) => status === 'recoveryCopySaved', secondController);

    const restore = firstController.restoreRecovery(revision, firstController.getState().liveRevision!, live.editor.getSnapshot());
    await restoring.promise;
    const writerPage = pageRecord(writerEditor.editor);
    writerEditor.editor.store.update(writerPage.id, (record) => ({ ...record, name: 'Second tab edit' }));
    await waitForState(writerEditor.editor, storage, (status) => status === 'saving', secondController);
    expect(storage.revision).toBe(revision);
    expect(pageRecord(live.editor).name).toBe('Live board');

    releaseRestore.resolve();
    await restore;
    expect(pageRecord(live.editor).name).toBe('Reviewed recovery');
    await waitForState(writerEditor.editor, storage, (status) => status === 'recoveryCopySaved' && storage.revision === revision + 2, secondController);
    expect((await storage.read()).records.get(writerPage.id)).toMatchObject({ name: 'Second tab edit' });
    await waitForState(live.editor, storage, (status) => status === 'conflict' && firstController.getState().reviewRevision === revision + 2, firstController);

    firstController.dispose();
    secondController.dispose();
    live.store.dispose();
    recovered.store.dispose();
    writerEditor.store.dispose();
  });

  it('cancels C8 restore if a debounced app flush changes the reviewed live board before loading', async () => {
    const live = makeEditor();
    const livePage = pageRecord(live.editor);
    live.editor.store.update(livePage.id, (record) => ({ ...record, name: 'Current board' }));
    const currentSnapshot = live.editor.getSnapshot();
    const desired = makeEditor();
    const desiredPage = pageRecord(desired.editor);
    desired.editor.store.update(desiredPage.id, (record) => ({ ...record, name: 'Recovery target' }));
    const desiredSnapshot = desired.editor.getSnapshot();

    const storage = new MemoryBoardRecoveryStorage();
    await storage.seed(desiredSnapshot);
    const lock = new SharedRecoveryLock();
    const controller = createBoardRecoveryController(live.editor, {
      storage,
      withRecoveryWriteLock: (operation) => lock.run(operation),
      restoreWorkspace: (target, snapshot) => restoreWorkspaceWithRecovery(
        target,
        snapshot,
        async () => {},
        async () => ({ previousEpoch: 4, epoch: 5 }),
        async () => {}
      ),
    });
    await waitForState(live.editor, storage, (status) => status === 'conflict', controller);
    const reviewedRevision = controller.getState().reviewRevision!;
    const reviewedLiveRevision = controller.getState().liveRevision!;
    let flushCount = 0;
    const unregister = registerArtifactStorageWorkspaceFlusher(ARTIFACT_STORAGE_WORKSPACE_KEY, () => {
      if (flushCount++ > 0) return;
      live.editor.store.update(livePage.id, (record) => ({ ...record, name: 'Flushed app edit' }));
    });

    await expect(controller.restoreRecovery(reviewedRevision, reviewedLiveRevision, currentSnapshot))
      .rejects.toThrow('live board changed after you reviewed it');
    expect(pageRecord(live.editor).name).toBe('Flushed app edit');
    expect((await storage.read()).meta?.revision).toBe(reviewedRevision);
    expect(controller.getState().status).toBe('conflict');
    expect(controller.getState().liveRevision).toBeGreaterThan(reviewedLiveRevision);

    unregister();
    controller.dispose();
    live.store.dispose();
    desired.store.dispose();
  });

  it('does not load a reviewed recovery copy if the controller is disposed during async restore preparation', async () => {
    const live = makeEditor();
    const livePage = pageRecord(live.editor);
    live.editor.store.update(livePage.id, (record) => ({ ...record, name: 'Current board' }));
    const currentSnapshot = live.editor.getSnapshot();
    const desired = makeEditor();
    const desiredPage = pageRecord(desired.editor);
    desired.editor.store.update(desiredPage.id, (record) => ({ ...record, name: 'Recovery target' }));
    const desiredSnapshot = desired.editor.getSnapshot();
    const storage = new MemoryBoardRecoveryStorage();
    await storage.seed(desiredSnapshot);
    const preparing = deferred();
    const releasePreparation = deferred();
    let loadCount = 0;
    const controller = createBoardRecoveryController(live.editor, {
      storage,
      withRecoveryWriteLock: async (operation) => operation(),
      restoreWorkspace: async (target, snapshot) => {
        preparing.resolve();
        await releasePreparation.promise;
        // C8's public preload snapshot read is the last synchronous guard before load.
        target.getSnapshot();
        target.runAtomically?.(() => {
          loadCount++;
          target.loadSnapshot(snapshot);
        });
      },
    });
    await waitForState(live.editor, storage, (status) => status === 'conflict', controller);
    const reviewedRevision = controller.getState().reviewRevision!;
    const restore = controller.restoreRecovery(reviewedRevision, controller.getState().liveRevision!, currentSnapshot);
    await preparing.promise;

    controller.dispose();
    releasePreparation.resolve();
    await expect(restore).rejects.toThrow('board closed');
    expect(loadCount).toBe(0);
    expect(pageRecord(live.editor).name).toBe('Current board');
    expect((await storage.read()).meta?.revision).toBe(reviewedRevision);

    live.store.dispose();
    desired.store.dispose();
  });
});
