import type { Editor, TLEditorSnapshot, TLStoreSnapshot } from '@tldraw/tldraw';
import type { RecordsDiff, UnknownRecord } from '@tldraw/store';
import { runEditorOperationSafely } from './editorOperation';
import { prepareDurableRecoverySnapshot, restoreWorkspaceWithRecovery } from './workspaceBackup';

/**
 * An application-owned acknowledgement for the primary board. This copy uses
 * public tldraw store records; it does not inspect tldraw's private IndexedDB
 * database or claim that the SDK's native persistence has committed.
 */
const DB_NAME = 'visionos-primary-board-recovery-v1';
const DB_VERSION = 1;
const RECORD_STORE = 'document-records';
const META_STORE = 'metadata';
const META_KEY = 'primarycanvas';
export const MAX_BOARD_RECOVERY_RECORDS = 50_000;
export const MAX_BOARD_RECOVERY_BYTES = 25_000_000;
const MAX_QUEUED_RECOVERY_CHANGES = 100_000;
const MAX_QUEUED_RECOVERY_BATCHES = 2_000;
export const MAX_QUEUED_RECOVERY_BYTES = 16_000_000;

export type BoardRecoveryDocumentRecord = UnknownRecord & { id: string; typeName: string };
type JsonRecord = BoardRecoveryDocumentRecord;
type RecordMap = Map<string, JsonRecord>;

export interface BoardRecoveryMeta {
  key: typeof META_KEY;
  schemaVersion: 1;
  revision: number;
  savedAt: string;
  recordCount: number;
  bytes: number;
  session: TLEditorSnapshot['session'];
  schema: TLEditorSnapshot['document']['schema'];
}

interface StoredRecord {
  id: string;
  record: JsonRecord;
  bytes: number;
}

export interface BoardRecoveryRead {
  meta: BoardRecoveryMeta | null;
  records: Map<string, BoardRecoveryDocumentRecord>;
}

export type BoardRecoveryCommitResult =
  | { status: 'committed'; meta: BoardRecoveryMeta }
  | { status: 'conflict'; current: BoardRecoveryRead };

export interface BoardRecoveryStorage {
  read(): Promise<BoardRecoveryRead>;
  seed(snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult>;
  apply(diff: RecordsDiff<UnknownRecord>): Promise<BoardRecoveryCommitResult>;
  replace(expectedRevision: number, snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult>;
}

export type BoardRecoveryStatus = 'checking' | 'saving' | 'recoveryCopySaved' | 'error' | 'conflict';

export interface BoardRecoveryState {
  status: BoardRecoveryStatus;
  /** Revision of the recovery copy currently presented for review. */
  reviewRevision?: number;
  /** Document-change generation presented with the conflict review. */
  liveRevision?: number;
  /** This is the time of the completed app-owned IndexedDB transaction. */
  savedAt?: string;
  error?: string;
  recoverySnapshot?: TLEditorSnapshot | null;
  recordCount?: number;
  bytes?: number;
  pendingChanges: number;
  /** True only while current document changes have not been committed or explicitly resolved. */
  hasUncommittedChanges: boolean;
}

export interface BoardRecoveryController {
  getState(): BoardRecoveryState;
  subscribe(listener: (state: BoardRecoveryState) => void): () => void;
  keepCurrent(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: TLEditorSnapshot): Promise<void>;
  restoreRecovery(expectedRevision: number, expectedLiveRevision: number, expectedLiveSnapshot: TLEditorSnapshot): Promise<void>;
  dispose(): void;
}

export interface BoardRecoveryControllerOptions {
  /** Test seam for persistence behavior; production uses the app-owned IDB store. */
  storage?: BoardRecoveryStorage;
  /** Test seam; production uses the C8 workspace restore pipeline. */
  restoreWorkspace?: typeof restoreWorkspaceWithRecovery;
  /** Shared Web Lock seam for deterministic cross-tab tests. */
  withRecoveryWriteLock?: <T>(operation: () => Promise<T>, required: boolean, timeoutMs?: number) => Promise<T>;
}

const RECOVERY_LOCK_NAME = 'visionos-primarycanvas-recovery-copy';

async function withRecoveryWriteLock<T>(operation: () => Promise<T>, required: boolean, timeoutMs?: number): Promise<T> {
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!lockManager) {
    if (required) throw new Error('This browser cannot safely lock the recovery copy for restore. Keep this canvas open and download a workspace backup before continuing.');
    return operation();
  }
  const abort = timeoutMs ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let acquired = false;
  if (abort && timeoutMs) {
    timer = setTimeout(() => abort.abort(), timeoutMs);
  }
  try {
    return await lockManager.request(
      RECOVERY_LOCK_NAME,
      abort ? { mode: 'exclusive', signal: abort.signal } : { mode: 'exclusive' },
      () => {
        acquired = true;
        if (timer) clearTimeout(timer);
        timer = null;
        return operation();
      }
    );
  } catch (error) {
    if (!acquired && abort?.signal.aborted) {
      throw new Error('Another tab is using the recovery copy. Wait for it to finish, then try again.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function byteLength(value: unknown): number {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error('A board record could not be serialized for recovery.');
  return new TextEncoder().encode(text).byteLength;
}

function recordMapFromSnapshot(snapshot: TLEditorSnapshot): RecordMap {
  const store = snapshot?.document?.store;
  if (!isObject(store)) throw new Error('The live board document is unavailable for recovery.');
  const entries = Object.entries(store);
  if (entries.length > MAX_BOARD_RECOVERY_RECORDS) {
    throw new Error(`The board has more than ${MAX_BOARD_RECOVERY_RECORDS.toLocaleString()} records and cannot fit in recovery storage.`);
  }
  const result: RecordMap = new Map();
  let totalBytes = 0;
  for (const [key, value] of entries) {
    if (!isObject(value) || typeof value.id !== 'string' || value.id !== key || typeof value.typeName !== 'string') {
      throw new Error('The live board contains a malformed document record. Recovery was paused.');
    }
    const record = value as JsonRecord;
    const bytes = byteLength(record);
    totalBytes += bytes;
    if (totalBytes > MAX_BOARD_RECOVERY_BYTES) {
      throw new Error('The board exceeds the 25 MB recovery-copy limit.');
    }
    result.set(record.id, record);
  }
  return result;
}

function deepEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (Object.is(a, b)) continue;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index++) pending.push([a[index], b[index]]);
      continue;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object).sort();
      const keysB = Object.keys(b as object).sort();
      if (keysA.length !== keysB.length) return false;
      for (let index = 0; index < keysA.length; index++) {
        if (keysA[index] !== keysB[index]) return false;
        pending.push([
          (a as Record<string, unknown>)[keysA[index]],
          (b as Record<string, unknown>)[keysB[index]],
        ]);
      }
      continue;
    }
    return false;
  }
  return true;
}

function documentsEqual(left: TLEditorSnapshot, right: TLEditorSnapshot): boolean {
  if (!deepEqual(left.document.schema, right.document.schema)) return false;
  const a = recordMapFromSnapshot(left);
  const b = recordMapFromSnapshot(right);
  if (a.size !== b.size) return false;
  for (const [id, record] of a) {
    const other = b.get(id);
    if (!other || !deepEqual(record, other)) return false;
  }
  return true;
}

function makeSnapshot(read: BoardRecoveryRead): TLEditorSnapshot {
  if (!read.meta) throw new Error('There is no saved board recovery copy.');
  const store: Record<string, JsonRecord> = {};
  for (const [id, record] of read.records) store[id] = clone(record);
  const session = clone(read.meta.session);
  const pages: Array<{ id: string; index: string }> = [];
  const shapeIds = new Set<string>();
  for (const record of read.records.values()) {
    if (record.typeName === 'page') {
      const page = record as JsonRecord & { index?: unknown };
      pages.push({ id: record.id, index: typeof page.index === 'string' ? page.index : '' });
    }
    else if (record.typeName === 'shape') shapeIds.add(record.id);
  }
  pages.sort((left, right) => left.index.localeCompare(right.index));
  const pageIds = new Set(pages.map((page) => page.id));
  if (pageIds.size === 0) throw new Error('The saved recovery copy has no board pages.');
  if (!session.currentPageId || !pageIds.has(session.currentPageId)) {
    session.currentPageId = pages[0].id as NonNullable<typeof session.currentPageId>;
  }
  const pageStates: NonNullable<TLEditorSnapshot['session']['pageStates']> = [];
  const pageStatesById = new Map<string, NonNullable<TLEditorSnapshot['session']['pageStates']>[number]>();
  for (const pageState of Array.isArray(session.pageStates) ? session.pageStates : []) {
    if (!isObject(pageState) || typeof pageState.pageId !== 'string' || !pageIds.has(pageState.pageId)) continue;
    const camera = isObject(pageState.camera) &&
      Number.isFinite(pageState.camera.x) && Number.isFinite(pageState.camera.y) && Number.isFinite(pageState.camera.z)
      ? { x: pageState.camera.x as number, y: pageState.camera.y as number, z: pageState.camera.z as number }
      : { x: 0, y: 0, z: 1 };
    const selectedShapeIds = Array.isArray(pageState.selectedShapeIds)
      ? pageState.selectedShapeIds.filter((id) => typeof id === 'string' && shapeIds.has(id))
      : [];
    const focusedGroupId = typeof pageState.focusedGroupId === 'string' && shapeIds.has(pageState.focusedGroupId)
      ? pageState.focusedGroupId
      : null;
    pageStatesById.set(pageState.pageId, {
      pageId: pageState.pageId as NonNullable<typeof session.currentPageId>,
      camera,
      selectedShapeIds: selectedShapeIds as NonNullable<TLEditorSnapshot['session']['pageStates']>[number]['selectedShapeIds'],
      focusedGroupId: focusedGroupId as NonNullable<TLEditorSnapshot['session']['pageStates']>[number]['focusedGroupId'],
    });
  }
  for (const page of pages) pageStates.push(pageStatesById.get(page.id) ?? {
    pageId: page.id as NonNullable<typeof session.currentPageId>,
    camera: { x: 0, y: 0, z: 1 },
    selectedShapeIds: [],
    focusedGroupId: null,
  });
  session.pageStates = pageStates;
  return {
    document: { store, schema: clone(read.meta.schema) } as TLStoreSnapshot,
    session,
  };
}

function freshMeta(revision: number, records: RecordMap, snapshot: TLEditorSnapshot): BoardRecoveryMeta {
  let bytes = 0;
  for (const record of records.values()) bytes += byteLength(record);
  if (records.size > MAX_BOARD_RECOVERY_RECORDS) {
    throw new Error(`The board has more than ${MAX_BOARD_RECOVERY_RECORDS.toLocaleString()} records and cannot fit in recovery storage.`);
  }
  if (bytes > MAX_BOARD_RECOVERY_BYTES) throw new Error('The board exceeds the 25 MB recovery-copy limit.');
  return {
    key: META_KEY,
    schemaVersion: 1,
    revision,
    savedAt: new Date().toISOString(),
    recordCount: records.size,
    bytes,
    session: clone(snapshot.session),
    schema: clone(snapshot.document.schema),
  };
}

function validMeta(value: unknown): value is BoardRecoveryMeta {
  return isObject(value) && value.key === META_KEY && value.schemaVersion === 1 &&
    Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 &&
    typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)) &&
    Number.isInteger(value.recordCount) && (value.recordCount as number) >= 0 &&
    Number.isInteger(value.bytes) && (value.bytes as number) >= 0 && isObject(value.session) && isObject(value.schema);
}

function mapRows(value: unknown): RecordMap {
  if (!Array.isArray(value) || value.length > MAX_BOARD_RECOVERY_RECORDS) {
    throw new Error('The saved board recovery copy is corrupted or exceeds its record limit.');
  }
  const records: RecordMap = new Map();
  let totalBytes = 0;
  for (const row of value) {
    if (!isObject(row) || typeof row.id !== 'string' || !isObject(row.record) ||
      row.record.id !== row.id || typeof row.record.typeName !== 'string' || !Number.isInteger(row.bytes) ||
      (row.bytes as number) < 0) {
      throw new Error('The saved board recovery copy contains a malformed record.');
    }
    if (records.has(row.id)) throw new Error('The saved board recovery copy contains duplicate record IDs.');
    const record = row.record as unknown as JsonRecord;
    const actualBytes = byteLength(record);
    if (actualBytes !== row.bytes) throw new Error('The saved board recovery copy failed its record integrity check.');
    totalBytes += actualBytes;
    if (totalBytes > MAX_BOARD_RECOVERY_BYTES) throw new Error('The saved board recovery copy exceeds the 25 MB limit.');
    records.set(row.id, record);
  }
  return records;
}

function publicRead(metaValue: unknown, rowsValue: unknown): BoardRecoveryRead {
  if (metaValue === undefined) {
    if (Array.isArray(rowsValue) && rowsValue.length) {
      throw new Error('The saved board recovery copy is incomplete.');
    }
    return { meta: null, records: new Map() };
  }
  if (!validMeta(metaValue)) throw new Error('The saved board recovery metadata is corrupted or from an unsupported version.');
  const records = mapRows(rowsValue);
  let bytes = 0;
  for (const record of records.values()) bytes += byteLength(record);
  if (records.size !== metaValue.recordCount || bytes !== metaValue.bytes) {
    throw new Error('The saved board recovery copy failed its size and record integrity check.');
  }
  return { meta: metaValue, records };
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser durable recovery storage is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Could not open browser recovery storage.'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Browser recovery storage is blocked by another open tab. Close older VisionOS tabs and reload.'));
    };
  });
}

function storageError(error: unknown): Error {
  const name = typeof DOMException !== 'undefined' && error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return new Error('Browser storage is full. The recovery copy could not be committed.');
  if (error instanceof Error && /25 MB|record|corrupt|unsupported|unavailable|blocked|limit|malformed|integrity/i.test(error.message)) return error;
  return new Error('Could not commit the board recovery copy to browser storage. The last confirmed copy is still available.');
}

async function readInTransaction(db: IDBDatabase, tx: IDBTransaction): Promise<BoardRecoveryRead> {
  const metaPromise = requestPromise(tx.objectStore(META_STORE).get(META_KEY));
  const rowsPromise = requestPromise(tx.objectStore(RECORD_STORE).getAll());
  const [meta, rows] = await Promise.all([metaPromise, rowsPromise]);
  return publicRead(meta, rows);
}

class IndexedDbBoardRecoveryStorage implements BoardRecoveryStorage {
  async read(): Promise<BoardRecoveryRead> {
    const db = await openDatabase();
    try {
      const tx = db.transaction([RECORD_STORE, META_STORE], 'readonly');
      const completed = transactionComplete(tx);
      const read = readInTransaction(db, tx);
      const result = await read;
      await completed;
      return result;
    } catch (error) {
      throw storageError(error);
    } finally {
      db.close();
    }
  }

  async seed(snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult> {
    const db = await openDatabase();
    try {
      const records = recordMapFromSnapshot(snapshot);
      const meta = freshMeta(1, records, snapshot);
      const tx = db.transaction([RECORD_STORE, META_STORE], 'readwrite');
      const recordStore = tx.objectStore(RECORD_STORE);
      const metaStore = tx.objectStore(META_STORE);
      let outcome: BoardRecoveryCommitResult | null = null;
      let failure: Error | null = null;
      metaStore.get(META_KEY).onsuccess = (event) => {
        const existingMeta = (event.target as IDBRequest).result;
        if (existingMeta !== undefined) {
          metaStore.get(META_KEY).onsuccess = (metaEvent) => {
            const rowsRequest = recordStore.getAll();
            rowsRequest.onsuccess = (rowsEvent) => {
              try {
                outcome = { status: 'conflict', current: publicRead((metaEvent.target as IDBRequest).result, (rowsEvent.target as IDBRequest).result) };
              } catch (error) {
                failure = storageError(error);
                tx.abort();
              }
            };
          };
          return;
        }
        recordStore.clear();
        for (const record of records.values()) {
          recordStore.put({ id: record.id, record: clone(record), bytes: byteLength(record) } satisfies StoredRecord);
        }
        metaStore.put(meta);
        outcome = { status: 'committed', meta };
      };
      await transactionComplete(tx);
      if (failure) throw failure;
      if (!outcome) throw new Error('Could not initialize board recovery storage.');
      return outcome;
    } catch (error) {
      throw storageError(error);
    } finally {
      db.close();
    }
  }

  async apply(diff: RecordsDiff<UnknownRecord>): Promise<BoardRecoveryCommitResult> {
    const db = await openDatabase();
    try {
      const changes = normalizeDiff(diff);
      const tx = db.transaction([RECORD_STORE, META_STORE], 'readwrite');
      const recordStore = tx.objectStore(RECORD_STORE);
      const metaStore = tx.objectStore(META_STORE);
      let outcome: BoardRecoveryCommitResult | null = null;
      let failure: Error | null = null;
      const currentRows = new Map<string, StoredRecord | undefined>();
      let remaining = changes.length + 1;
      const process = () => {
        remaining--;
        if (remaining !== 0) return;
        try {
          const currentMetaValue = metaRequest.result;
          if (!validMeta(currentMetaValue)) throw new Error('The saved board recovery metadata is corrupted or missing.');
          const nextById = new Map<string, JsonRecord | undefined>();
          let nextCount = currentMetaValue.recordCount;
          let nextBytes = currentMetaValue.bytes;
          let anyChange = false;
          for (const change of changes) {
            const current = currentRows.get(change.id);
            const currentRecord = current?.record;
            if (deepEqual(currentRecord, change.after)) {
              nextById.set(change.id, change.after);
              continue;
            }
            if (!deepEqual(currentRecord, change.before)) {
              outcome = { status: 'conflict', current: { meta: currentMetaValue, records: new Map() } };
              return;
            }
            anyChange = true;
            const beforeSize = current ? current.bytes : 0;
            const afterSize = change.after ? byteLength(change.after) : 0;
            nextCount += Number(!!change.after) - Number(!!current);
            nextBytes += afterSize - beforeSize;
            nextById.set(change.id, change.after);
          }
          if (!anyChange) {
            outcome = { status: 'committed', meta: currentMetaValue };
            return;
          }
          if (nextCount < 0 || nextCount > MAX_BOARD_RECOVERY_RECORDS) throw new Error('The board exceeds the recovery record limit.');
          if (nextBytes < 0 || nextBytes > MAX_BOARD_RECOVERY_BYTES) throw new Error('The board exceeds the 25 MB recovery-copy limit.');
          for (const [id, record] of nextById) {
            const current = currentRows.get(id);
            if (deepEqual(current?.record, record)) continue;
            if (record === undefined) recordStore.delete(id);
            else recordStore.put({ id, record: clone(record), bytes: byteLength(record) } satisfies StoredRecord);
          }
          const meta: BoardRecoveryMeta = {
            ...currentMetaValue,
            revision: currentMetaValue.revision + 1,
            savedAt: new Date().toISOString(),
            recordCount: nextCount,
            bytes: nextBytes,
          };
          metaStore.put(meta);
          outcome = { status: 'committed', meta };
        } catch (error) {
          failure = storageError(error);
          tx.abort();
        }
      };
      const metaRequest = metaStore.get(META_KEY);
      metaRequest.onsuccess = process;
      for (const change of changes) {
        const request = recordStore.get(change.id);
        request.onsuccess = (event) => {
          currentRows.set(change.id, (event.target as IDBRequest<StoredRecord | undefined>).result);
          process();
        };
      }
      await transactionComplete(tx);
      if (failure) throw failure;
      if (!outcome) throw new Error('Could not commit the board recovery copy.');
      const finalOutcome = outcome as BoardRecoveryCommitResult;
      if (finalOutcome.status === 'conflict' && finalOutcome.current.records.size === 0) {
        return { status: 'conflict', current: await this.read() };
      }
      return finalOutcome;
    } catch (error) {
      throw storageError(error);
    } finally {
      db.close();
    }
  }

  async replace(expectedRevision: number, snapshot: TLEditorSnapshot): Promise<BoardRecoveryCommitResult> {
    const db = await openDatabase();
    try {
      const records = recordMapFromSnapshot(snapshot);
      const tx = db.transaction([RECORD_STORE, META_STORE], 'readwrite');
      const recordStore = tx.objectStore(RECORD_STORE);
      const metaStore = tx.objectStore(META_STORE);
      let outcome: BoardRecoveryCommitResult | null = null;
      let failure: Error | null = null;
      const currentMetaPromise = requestPromise(metaStore.get(META_KEY));
      const currentRowsPromise = requestPromise(recordStore.getAll());
      Promise.all([currentMetaPromise, currentRowsPromise]).then(([metaValue, rowsValue]) => {
        try {
          const current = publicRead(metaValue, rowsValue);
          if (!current.meta || current.meta.revision !== expectedRevision) {
            outcome = { status: 'conflict', current };
            return;
          }
          const meta = freshMeta(current.meta.revision + 1, records, snapshot);
          for (const [id, previous] of current.records) {
            if (!records.has(id)) recordStore.delete(id);
            else {
              const next = records.get(id)!;
              if (!deepEqual(previous, next)) {
                recordStore.put({ id, record: clone(next), bytes: byteLength(next) } satisfies StoredRecord);
              }
            }
          }
          for (const [id, record] of records) {
            if (!current.records.has(id)) {
              recordStore.put({ id, record: clone(record), bytes: byteLength(record) } satisfies StoredRecord);
            }
          }
          metaStore.put(meta);
          outcome = { status: 'committed', meta };
        } catch (error) {
          failure = storageError(error);
          tx.abort();
        }
      }).catch((error) => {
        failure = storageError(error);
        try { tx.abort(); } catch { /* transaction already ended */ }
      });
      await transactionComplete(tx);
      if (failure) throw failure;
      if (!outcome) throw new Error('Could not replace the board recovery copy.');
      return outcome;
    } catch (error) {
      throw storageError(error);
    } finally {
      db.close();
    }
  }
}

interface NormalizedChange { id: string; before: JsonRecord | undefined; after: JsonRecord | undefined; }

function normalizeDiff(diff: RecordsDiff<UnknownRecord>): NormalizedChange[] {
  const changes: NormalizedChange[] = [];
  for (const [id, record] of Object.entries(diff.added)) {
    changes.push({ id, before: undefined, after: record as JsonRecord });
  }
  for (const [id, [before, after]] of Object.entries(diff.updated)) {
    changes.push({ id, before: before as JsonRecord, after: after as JsonRecord });
  }
  for (const [id, record] of Object.entries(diff.removed)) {
    changes.push({ id, before: record as JsonRecord, after: undefined });
  }
  if (changes.length > MAX_QUEUED_RECOVERY_CHANGES) {
    throw new Error('A single board edit exceeded the recovery transaction limit.');
  }
  return changes;
}

function measureDiff(diff: RecordsDiff<UnknownRecord>) {
  const changes = normalizeDiff(diff);
  let bytes = 0;
  for (const change of changes) {
    if (change.before) bytes += byteLength(change.before);
    if (change.after) bytes += byteLength(change.after);
    if (bytes > MAX_QUEUED_RECOVERY_BYTES) break;
  }
  return { count: changes.length, bytes };
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Recovery transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Recovery transaction was aborted.'));
  });
}

function makeControllerId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random()}`; }
}

interface RecoveryNotice { workspace: string; revision: number; source: string; }
const CHANNEL_NAME = 'visionos-primary-board-recovery-v1';

class BoardRecoveryControllerImpl implements BoardRecoveryController {
  private state: BoardRecoveryState = { status: 'checking', pendingChanges: 0, hasUncommittedChanges: false };
  private listeners = new Set<(state: BoardRecoveryState) => void>();
  private readonly storage: BoardRecoveryStorage;
  private readonly restoreWorkspaceFn: typeof restoreWorkspaceWithRecovery;
  private readonly withRecoveryWriteLockFn: <T>(operation: () => Promise<T>, required: boolean, timeoutMs?: number) => Promise<T>;
  private readonly controllerId = makeControllerId();
  private readonly channel: BroadcastChannel | null;
  private readonly unsubscribeStore: () => void;
  private writeChain: Promise<void> = Promise.resolve();
  private ready = false;
  private acceptingWrites = true;
  private disposed = false;
  private generation = 0;
  private queuedBatches = 0;
  private queuedRecordChanges = 0;
  private queuedBytes = 0;
  private preReady: RecordsDiff<UnknownRecord>[] = [];
  private preReadyRecordChanges = 0;
  private preReadyBytes = 0;
  private revision: number | null = null;
  private committedSnapshot: TLEditorSnapshot | null = null;
  private pausedUncommittedChanges = false;
  private hasUncommittedChanges = false;
  private pendingNoticeRevision = 0;
  private schemaBaseline: TLEditorSnapshot['document']['schema'] | null = null;
  private actionInFlight = false;
  private conflictSinceGeneration = -1;
  private conflictReconciliationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly editor: Editor, options: BoardRecoveryControllerOptions) {
    this.storage = options.storage ?? new IndexedDbBoardRecoveryStorage();
    this.restoreWorkspaceFn = options.restoreWorkspace ?? restoreWorkspaceWithRecovery;
    this.withRecoveryWriteLockFn = options.withRecoveryWriteLock ?? withRecoveryWriteLock;
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    if (this.channel) this.channel.onmessage = (event: MessageEvent<RecoveryNotice>) => this.onNotice(event.data);
    this.unsubscribeStore = editor.store.listen((entry) => this.onStoreChange(entry.changes), { scope: 'document', source: 'all' });
    this.start();
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  getState() { return this.state; }

  subscribe(listener: (state: BoardRecoveryState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(next: BoardRecoveryState) {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }

  private snapshot(): TLEditorSnapshot { return clone(this.editor.getSnapshot()); }

  private async start() {
    let initial: TLEditorSnapshot;
    try {
      initial = this.snapshot();
      this.schemaBaseline = clone(initial.document.schema);
      const existing = await this.storage.read();
      if (!this.acceptingWrites) return;
      if (!existing.meta) {
        const seeded = await this.withRecoveryWriteLockFn(() => this.storage.seed(initial), false);
        if (seeded.status === 'conflict') {
          this.revision = seeded.current.meta?.revision ?? null;
          this.committedSnapshot = seeded.current.meta ? makeSnapshot(seeded.current) : null;
          if (!this.committedSnapshot || !documentsEqual(initial, this.committedSnapshot)) {
            await this.enterConflict(seeded.current);
            this.refreshPendingNotice();
            return;
          }
          this.acceptMeta(seeded.current.meta!);
        } else {
          this.acceptMeta(seeded.meta);
        }
      } else {
        this.revision = existing.meta.revision;
        this.committedSnapshot = makeSnapshot(existing);
        if (!documentsEqual(initial, this.committedSnapshot)) {
          await this.enterConflict(existing);
          return;
        }
        this.acceptMeta(existing.meta);
      }
      this.ready = true;
      const queued = this.preReady;
      this.preReady = [];
      this.preReadyRecordChanges = 0;
      this.preReadyBytes = 0;
      this.emit({
        status: queued.length ? 'saving' : 'recoveryCopySaved',
        savedAt: this.state.savedAt,
        recordCount: this.state.recordCount,
        bytes: this.state.bytes,
        pendingChanges: queued.length,
        hasUncommittedChanges: this.hasUncommittedChanges,
      });
      for (const diff of queued) this.enqueueDiff(diff);
    } catch (error) {
      this.stopWrites();
      this.emit({
        status: 'error', error: readableError(error), savedAt: this.state.savedAt,
        pendingChanges: this.queuedBatches, hasUncommittedChanges: this.hasUncommittedChanges,
      });
    }
  }

  private acceptMeta(meta: BoardRecoveryMeta) {
    this.revision = meta.revision;
    const status = this.state.status === 'error' || this.state.status === 'conflict'
      ? this.state.status
      : this.queuedBatches ? 'saving' : 'recoveryCopySaved';
    this.emit({
      ...this.state,
      status,
      liveRevision: this.generation,
      savedAt: meta.savedAt,
      recordCount: meta.recordCount,
      bytes: meta.bytes,
      pendingChanges: this.queuedBatches,
      hasUncommittedChanges: this.hasUncommittedChanges,
    });
  }

  private onStoreChange(diff: RecordsDiff<UnknownRecord>) {
    if (this.disposed) return;
    this.generation++;
    let measured: ReturnType<typeof measureDiff>;
    try { measured = measureDiff(diff); }
    catch (error) {
      this.hasUncommittedChanges = true;
      this.fail(readableError(error));
      return;
    }
    if (!measured.count) return;
    this.hasUncommittedChanges = true;
    if (!this.acceptingWrites) {
      this.pausedUncommittedChanges = true;
      this.emit({
        ...this.state,
        liveRevision: this.generation,
        pendingChanges: Math.max(1, this.state.pendingChanges),
        hasUncommittedChanges: true,
      });
      if (this.state.status === 'conflict' && this.generation > this.conflictSinceGeneration) {
        this.scheduleConflictReconciliation();
      }
      return;
    }
    if (this.schemaBaseline && !deepEqual(this.editor.store.schema.serialize(), this.schemaBaseline)) {
      this.acceptingWrites = false;
      this.hasUncommittedChanges = true;
      this.storage.read().then((current) => this.enterConflict(current)).catch((error) => this.fail(readableError(error)));
      return;
    }
    if (!this.ready) {
      if (this.preReady.length >= MAX_QUEUED_RECOVERY_BATCHES ||
        this.preReadyRecordChanges + measured.count > MAX_QUEUED_RECOVERY_CHANGES ||
        this.preReadyBytes + measured.bytes > MAX_QUEUED_RECOVERY_BYTES) {
        this.fail('The board changed too quickly during recovery setup. Reload after your work is stable.');
        return;
      }
      this.preReady.push(diff);
      this.preReadyRecordChanges += measured.count;
      this.preReadyBytes += measured.bytes;
      return;
    }
    if (this.state.status === 'conflict' || this.state.status === 'error') return;
    this.enqueueDiff(diff, measured);
  }

  private enqueueDiff(diff: RecordsDiff<UnknownRecord>, premeasured?: ReturnType<typeof measureDiff>) {
    let measured: ReturnType<typeof measureDiff>;
    try { measured = premeasured ?? measureDiff(diff); }
    catch (error) { this.fail(readableError(error)); return; }
    if (!measured.count) return;
    if (this.queuedBatches >= MAX_QUEUED_RECOVERY_BATCHES ||
      this.queuedRecordChanges + measured.count > MAX_QUEUED_RECOVERY_CHANGES ||
      this.queuedBytes + measured.bytes > MAX_QUEUED_RECOVERY_BYTES) {
      this.fail('The recovery queue reached its 16 MB safety limit before browser storage could commit it. Download a workspace backup before continuing.');
      return;
    }
    this.queuedBatches++;
    this.queuedRecordChanges += measured.count;
    this.queuedBytes += measured.bytes;
    this.emit({
      ...this.state,
      status: 'saving',
      liveRevision: this.generation,
      pendingChanges: this.queuedBatches,
      hasUncommittedChanges: true,
      error: undefined,
    });
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disposed) return;
        if (!this.acceptingWrites || this.state.status === 'conflict' || this.state.status === 'error') {
          return;
        }
        const result = await this.withRecoveryWriteLockFn(() => this.storage.apply(diff), false);
        if (result.status === 'conflict') {
          await this.enterConflict(result.current);
          return;
        }
        this.acceptMeta(result.meta);
        this.broadcast(result.meta.revision);
      } catch (error) {
        this.fail(readableError(error));
      } finally {
        this.queuedBatches = Math.max(0, this.queuedBatches - 1);
        this.queuedRecordChanges = Math.max(0, this.queuedRecordChanges - measured.count);
        this.queuedBytes = Math.max(0, this.queuedBytes - measured.bytes);
        if (this.queuedBatches === 0 && this.state.status === 'saving' && !this.pausedUncommittedChanges) {
          this.hasUncommittedChanges = false;
        }
        if (this.state.status === 'saving') {
          if (this.queuedBatches === 0 && this.state.savedAt) {
            this.emit({
              ...this.state,
              status: 'recoveryCopySaved',
              pendingChanges: 0,
              hasUncommittedChanges: this.hasUncommittedChanges,
            });
          } else {
            this.emit({
              ...this.state,
              pendingChanges: this.queuedBatches,
              hasUncommittedChanges: this.hasUncommittedChanges,
            });
          }
        } else {
          this.emit({
            ...this.state,
            pendingChanges: this.queuedBatches,
            hasUncommittedChanges: this.hasUncommittedChanges,
          });
        }
      }
    });
  }

  private stopWrites() { this.acceptingWrites = false; this.ready = false; }

  private cancelConflictReconciliation() {
    if (this.conflictReconciliationTimer !== null) {
      clearTimeout(this.conflictReconciliationTimer);
      this.conflictReconciliationTimer = null;
    }
  }

  private scheduleConflictReconciliation() {
    this.cancelConflictReconciliation();
    if (this.disposed || this.actionInFlight || this.state.status !== 'conflict') return;
    const generation = this.generation;
    const revision = this.state.reviewRevision;
    this.conflictReconciliationTimer = setTimeout(() => {
      this.conflictReconciliationTimer = null;
      void this.reconcileConflictAfterQuiet(generation, revision);
    }, 160);
  }

  /**
   * Native tldraw sync can deliver a peer's document records after the app-owned
   * recovery notice. Only run this full comparison after a conflict has received
   * a later document change; ordinary healthy edits stay incremental.
   */
  private async reconcileConflictAfterQuiet(generation: number, reviewedRevision: number | undefined) {
    const isCurrentConflict = () => !this.disposed && !this.actionInFlight &&
      this.state.status === 'conflict' && this.state.reviewRevision === reviewedRevision &&
      this.generation === generation && generation > this.conflictSinceGeneration;
    if (!isCurrentConflict()) return;
    if (this.queuedBatches > 0) {
      this.scheduleConflictReconciliation();
      return;
    }
    try {
      await this.withRecoveryWriteLockFn(async () => {
        const current = await this.storage.read();
        if (!isCurrentConflict() || this.queuedBatches > 0 || !current.meta ||
          current.meta.revision < (reviewedRevision ?? 0)) return;
        const live = this.editor.getSnapshot();
        const recovery = makeSnapshot(current);
        if (!documentsEqual(live, recovery)) return;

        // No await between this stable document comparison and reopening writes.
        this.revision = current.meta.revision;
        this.committedSnapshot = recovery;
        this.schemaBaseline = clone(recovery.document.schema);
        this.acceptingWrites = true;
        this.ready = true;
        this.hasUncommittedChanges = false;
        this.pausedUncommittedChanges = false;
        this.emit({
          status: 'recoveryCopySaved',
          liveRevision: this.generation,
          savedAt: current.meta.savedAt,
          recordCount: current.meta.recordCount,
          bytes: current.meta.bytes,
          pendingChanges: 0,
          hasUncommittedChanges: false,
        });
      }, false);
    } catch {
      // Keep the conflict visible. A later document change can retry the probe.
    }
  }

  private fail(message: string) {
    this.stopWrites();
    this.cancelConflictReconciliation();
    this.emit({
      ...this.state,
      status: 'error',
      error: message,
      pendingChanges: this.queuedBatches,
      hasUncommittedChanges: this.hasUncommittedChanges,
    });
  }

  private async enterConflict(read: BoardRecoveryRead) {
    this.cancelConflictReconciliation();
    this.stopWrites();
    if (!read.meta) {
      this.fail('The saved board recovery copy is missing or incomplete.');
      return;
    }
    const snapshot = makeSnapshot(read);
    this.hasUncommittedChanges = !documentsEqual(this.editor.getSnapshot(), snapshot);
    this.pausedUncommittedChanges = this.hasUncommittedChanges;
    this.revision = read.meta.revision;
    this.committedSnapshot = snapshot;
    this.conflictSinceGeneration = this.generation;
    this.emit({
      status: 'conflict',
      reviewRevision: read.meta.revision,
      liveRevision: this.generation,
      savedAt: read.meta.savedAt,
      recordCount: read.meta.recordCount,
      bytes: read.meta.bytes,
      recoverySnapshot: snapshot,
      pendingChanges: this.queuedBatches,
      hasUncommittedChanges: this.hasUncommittedChanges,
    });
  }

  private broadcast(revision: number) {
    if (this.disposed) return;
    this.channel?.postMessage({ workspace: META_KEY, revision, source: this.controllerId } satisfies RecoveryNotice);
  }

  private onNotice(notice: RecoveryNotice | null) {
    if (!notice || notice.workspace !== META_KEY || notice.source === this.controllerId || !Number.isSafeInteger(notice.revision)) return;
    if (this.revision !== null && notice.revision <= this.revision) return;
    this.pendingNoticeRevision = Math.max(this.pendingNoticeRevision, notice.revision);
    if (this.actionInFlight) return;
    if (!this.ready && this.state.status !== 'conflict') return;
    this.refreshPendingNotice();
  }

  private refreshPendingNotice() {
    if (this.pendingNoticeRevision <= (this.revision ?? 0)) return;
    const noticeRevision = this.pendingNoticeRevision;
    this.pendingNoticeRevision = 0;
    this.writeChain = this.writeChain.then(async () => {
      if (this.disposed || (!this.ready && this.state.status !== 'conflict')) return;
      try {
        const current = await this.storage.read();
        if (!current.meta) return this.fail('The saved board recovery copy is missing.');
        if (current.meta.revision <= (this.revision ?? 0) || current.meta.revision < noticeRevision) return;
        const live = this.snapshot();
        const recovery = makeSnapshot(current);
        if (this.state.status === 'conflict') {
          await this.enterConflict(current);
        } else if (documentsEqual(live, recovery)) {
          this.committedSnapshot = recovery;
          this.hasUncommittedChanges = false;
          this.pausedUncommittedChanges = false;
          this.acceptMeta(current.meta);
        } else {
          await this.enterConflict(current);
        }
      } catch (error) {
        this.fail(readableError(error));
      }
    });
  }

  private beginReviewedAction(
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot
  ): TLEditorSnapshot {
    if (this.actionInFlight) throw new Error('A recovery choice is already being applied.');
    if (this.state.status !== 'conflict' || !this.state.recoverySnapshot || this.revision === null) {
      throw new Error('There is no recovery-copy conflict open for review.');
    }
    if (this.state.reviewRevision !== expectedRevision || this.revision !== expectedRevision) {
      throw new Error('The recovery copy changed after you reviewed it. Review the latest copy before choosing.');
    }
    if (this.state.liveRevision !== expectedLiveRevision || this.generation !== expectedLiveRevision ||
      !documentsEqual(expectedLiveSnapshot, this.editor.getSnapshot())) {
      throw new Error('The live board changed after you reviewed it. Review the current canvas before choosing.');
    }
    this.cancelConflictReconciliation();
    this.actionInFlight = true;
    return clone(this.state.recoverySnapshot);
  }

  private assertReviewedRevision(expectedRevision: number) {
    if (this.state.reviewRevision !== expectedRevision || this.revision !== expectedRevision) {
      throw new Error('The recovery copy changed after you reviewed it. Review the latest copy before choosing.');
    }
  }

  private assertReviewedLiveRevision(expectedLiveRevision: number, expectedLiveSnapshot: TLEditorSnapshot) {
    if (this.disposed) throw new Error('The board closed before the recovery choice could be applied.');
    if (this.generation !== expectedLiveRevision || !documentsEqual(expectedLiveSnapshot, this.editor.getSnapshot())) {
      throw new Error('The live board changed after you reviewed it. Review the current canvas before choosing.');
    }
  }

  async keepCurrent(
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot
  ): Promise<void> {
    this.beginReviewedAction(expectedRevision, expectedLiveRevision, expectedLiveSnapshot);
    try {
      await this.writeChain;
      this.assertReviewedRevision(expectedRevision);
      this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
      const before = this.snapshot();
      this.acceptingWrites = false;
      const result = await this.withRecoveryWriteLockFn(
        () => {
          if (this.disposed) throw new Error('The board closed before the recovery choice could be applied.');
          return this.storage.replace(expectedRevision, before);
        },
        false,
        10_000
      );
      if (result.status === 'conflict') {
        await this.enterConflict(result.current);
        throw new Error('The recovery copy changed in another tab. Review the updated copy and choose again.');
      }
      this.committedSnapshot = before;
      this.revision = result.meta.revision;
      this.broadcast(result.meta.revision);
      const after = this.snapshot();
      if (!documentsEqual(before, after)) {
        const latest = await this.storage.read();
        await this.enterConflict(latest);
        throw new Error('The live board changed while Keep current was saving. Review the board and choose again.');
      }
      this.acceptingWrites = true;
      this.ready = true;
      this.schemaBaseline = clone(before.document.schema);
      this.hasUncommittedChanges = false;
      this.pausedUncommittedChanges = false;
      this.queuedBatches = 0;
      this.queuedRecordChanges = 0;
      this.queuedBytes = 0;
      this.emit({
        ...this.state,
        status: 'saving',
        reviewRevision: undefined,
        recoverySnapshot: null,
        error: undefined,
        hasUncommittedChanges: false,
      });
      this.acceptMeta(result.meta);
    } catch (error) {
      if (this.state.status !== 'conflict') this.fail(readableError(error));
      throw error instanceof Error ? error : new Error('Could not keep the live board.');
    } finally {
      this.actionInFlight = false;
      this.refreshPendingNotice();
    }
  }

  async restoreRecovery(
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot
  ): Promise<void> {
    const recoverySnapshot = this.beginReviewedAction(expectedRevision, expectedLiveRevision, expectedLiveSnapshot);
    this.acceptingWrites = false;
    try {
      await this.writeChain;
      this.assertReviewedRevision(expectedRevision);
      this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
      const currentBeforeRestore = this.snapshot();
      await this.withRecoveryWriteLockFn(
        () => this.restoreReviewedCopy(expectedRevision, expectedLiveRevision, expectedLiveSnapshot, recoverySnapshot, currentBeforeRestore),
        true,
        10_000
      );
    } finally {
      this.actionInFlight = false;
      this.refreshPendingNotice();
    }
  }

  private async restoreReviewedCopy(
    expectedRevision: number,
    expectedLiveRevision: number,
    expectedLiveSnapshot: TLEditorSnapshot,
    recoverySnapshot: TLEditorSnapshot,
    currentBeforeRestore: TLEditorSnapshot
  ): Promise<void> {
    try {
      this.assertReviewedRevision(expectedRevision);
      this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
      const durable = await this.storage.read();
      this.assertReviewedRevision(expectedRevision);
      this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
      if (!durable.meta || durable.meta.revision !== expectedRevision) {
        await this.enterConflict(durable);
        throw new Error('The recovery copy changed in another tab. Review the updated copy and choose again.');
      }
      const persistedReview = makeSnapshot(durable);
      if (!documentsEqual(recoverySnapshot, persistedReview)) {
        await this.enterConflict(durable);
        throw new Error('The recovery copy changed after review. Review the latest copy before choosing.');
      }
      const prepared = prepareDurableRecoverySnapshot(recoverySnapshot);
      this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
      if (!documentsEqual(currentBeforeRestore, this.snapshot())) {
        await this.enterConflict(durable);
        throw new Error('The live board changed before restore could start. Review it and try again.');
      }
      let generationAtLoad = -1;
      let liveLoadStarted = false;
      await this.restoreWorkspaceFn({
        getSnapshot: () => {
          if (!liveLoadStarted) this.assertReviewedLiveRevision(expectedLiveRevision, expectedLiveSnapshot);
          return this.editor.getSnapshot();
        },
        loadSnapshot: (snapshot, options) => {
          generationAtLoad = this.generation;
          liveLoadStarted = true;
          this.editor.loadSnapshot(snapshot, options);
        },
        runAtomically: (operation) => { runEditorOperationSafely(this.editor, operation); },
      }, prepared.snapshot);
      const actual = this.snapshot();
      if (generationAtLoad >= 0 && this.generation > generationAtLoad + 1) {
        const latest = await this.storage.read();
        await this.enterConflict(latest);
        throw new Error('The board changed while recovery was loading. Review both copies before continuing.');
      }
      this.assertReviewedRevision(expectedRevision);
      const committed = await this.storage.replace(expectedRevision, actual);
      if (committed.status === 'conflict') {
        await this.enterConflict(committed.current);
        throw new Error('The board was restored, but its recovery copy changed in another tab. Review the two copies.');
      }
      this.committedSnapshot = actual;
      this.revision = committed.meta.revision;
      this.schemaBaseline = clone(actual.document.schema);
      this.broadcast(committed.meta.revision);
      this.acceptingWrites = true;
      this.ready = true;
      this.hasUncommittedChanges = false;
      this.pausedUncommittedChanges = false;
      this.emit({
        ...this.state,
        status: 'saving',
        reviewRevision: undefined,
        recoverySnapshot: null,
        error: undefined,
        hasUncommittedChanges: false,
      });
      this.acceptMeta(committed.meta);
    } catch (error) {
      if (this.state.status !== 'conflict') {
        const latest = await this.storage.read().catch(() => null);
        const current = this.snapshot();
        if (latest?.meta && documentsEqual(current, makeSnapshot(latest))) {
          this.acceptingWrites = true;
          this.ready = true;
          this.schemaBaseline = clone(current.document.schema);
          this.hasUncommittedChanges = false;
          this.pausedUncommittedChanges = false;
          this.acceptMeta(latest.meta);
        } else if (latest) {
          await this.enterConflict(latest);
        } else {
          this.fail(readableError(error));
        }
      }
      throw error instanceof Error ? error : new Error('Could not restore the recovery copy.');
    }
  }

  private onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.hasUncommittedChanges) return;
    event.preventDefault();
    event.returnValue = '';
  };

  dispose() {
    this.disposed = true;
    this.cancelConflictReconciliation();
    this.unsubscribeStore();
    this.channel?.close();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.listeners.clear();
  }
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Could not save the board recovery copy to this device.';
}

export function createBoardRecoveryController(
  editor: Editor,
  options: BoardRecoveryControllerOptions = {}
): BoardRecoveryController {
  return new BoardRecoveryControllerImpl(editor, options);
}
