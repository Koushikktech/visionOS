import { validateStorageSnapshot } from './artifactStorage';

/** Must match the single board persistence key used by Canvas.tsx. */
export const ARTIFACT_STORAGE_WORKSPACE_KEY = 'visionos-board-store';

const DATABASE_NAME = 'visionos-artifact-storage-v1';
const DATABASE_VERSION = 2;
const WORKSPACES_STORE = 'workspaces';
const STORAGE_STORE = 'artifactStorage';
const EPOCH_EVENT = 'visionos-artifact-storage-epoch';
const MAX_SAFE_COUNTER = Number.MAX_SAFE_INTEGER;
const MAX_EPOCH_PRUNE_OPERATIONS = 200;

export type DurableArtifactStorage = {
  epoch: number;
  generation: number | null;
  storage: Record<string, string> | null;
  undoStorage: Record<string, string> | null;
  sourceMatches: boolean;
  corrupted: boolean;
};

export type ActivatedArtifactStorage = DurableArtifactStorage & {
  status: 'active' | 'cancelled';
  generation: number | null;
};

type StoredWorkspace = { key: string; epoch: number; revision: number };
type StoredArtifactStorage = {
  key: string;
  workspaceKey: string;
  shapeId: string;
  epoch: number;
  generation: number;
  sourceFingerprint: string;
  storage: Record<string, string>;
  undoStorage: Record<string, string> | null;
  savedAt: number;
  deleted?: boolean;
};

type RestoreGate = {
  paused: boolean;
  resume: Promise<void>;
  resumeWrites: (() => void) | null;
  active: Set<Promise<unknown>>;
};

/** Serialize per-shape transactions and let a restore drain and pause them. */
export function createArtifactStorageOperationGate() {
  const gates = new Map<string, RestoreGate>();
  const operationTails = new Map<string, Promise<void>>();
  const getGate = (workspaceKey: string) => {
    let gate = gates.get(workspaceKey);
    if (!gate) {
      gate = { paused: false, resume: Promise.resolve(), resumeWrites: null, active: new Set() };
      gates.set(workspaceKey, gate);
    }
    return gate;
  };
  return {
    run<T>(
      workspaceKey: string,
      shapeId: string,
      operation: () => Promise<T>,
      isCurrent: () => boolean = () => true
    ): Promise<T | undefined> {
      const gate = getGate(workspaceKey);
      const operationKey = `${workspaceKey}\u0000${shapeId}`;
      const previous = operationTails.get(operationKey) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(async () => {
        while (gate.paused) await gate.resume;
        if (!isCurrent()) return undefined;
        const active = operation();
        gate.active.add(active);
        try {
          return await active;
        } finally {
          gate.active.delete(active);
        }
      });
      const tail = result.then(() => undefined, () => undefined);
      operationTails.set(operationKey, tail);
      void tail.then(() => {
        if (operationTails.get(operationKey) === tail) operationTails.delete(operationKey);
      });
      return result;
    },
    beginRestore(workspaceKey: string) {
      const gate = getGate(workspaceKey);
      if (gate.paused) throw new Error('A workspace restore is already updating app storage.');
      gate.paused = true;
      gate.resume = new Promise<void>((resolve) => { gate.resumeWrites = resolve; });
      const drained = Promise.allSettled(Array.from(gate.active)).then(() => undefined);
      let released = false;
      return {
        waitForIdle: () => drained,
        release: () => {
          if (released) return;
          released = true;
          gate.paused = false;
          gate.resumeWrites?.();
          gate.resumeWrites = null;
        },
      };
    },
  };
}

const operationGate = createArtifactStorageOperationGate();
const workspaceFlushers = new Map<string, Set<() => void>>();

/** Register synchronous app-to-tldraw flushes so recovery snapshots include debounced mutations. */
export function registerArtifactStorageWorkspaceFlusher(workspaceKey: string, flush: () => void) {
  let flushers = workspaceFlushers.get(workspaceKey);
  if (!flushers) {
    flushers = new Set();
    workspaceFlushers.set(workspaceKey, flushers);
  }
  flushers.add(flush);
  return () => {
    flushers?.delete(flush);
    if (flushers?.size === 0) workspaceFlushers.delete(workspaceKey);
  };
}

export function flushArtifactStorageWorkspaceUpdates(workspaceKey: string) {
  for (const flush of Array.from(workspaceFlushers.get(workspaceKey) ?? [])) flush();
}

function runStorageOperation<T>(
  workspaceKey: string,
  shapeId: string,
  operation: () => Promise<T>,
  isCurrent?: () => boolean
): Promise<T | undefined> {
  return operationGate.run(workspaceKey, shapeId, operation, isCurrent);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Durable browser app storage is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACES_STORE)) {
        db.createObjectStore(WORKSPACES_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORAGE_STORE)) {
        const store = db.createObjectStore(STORAGE_STORE, { keyPath: 'key' });
        store.createIndex('workspaceKey', 'workspaceKey', { unique: false });
      }
      // Add the workspace-wide generation counter without discarding v1 data.
      // Old storage rows are ignored safely and reseeded from the primary board
      // snapshot when their owning app next mounts.
      if ((event as IDBVersionChangeEvent).oldVersion < 2 && db.objectStoreNames.contains(WORKSPACES_STORE)) {
        const store = request.transaction!.objectStore(WORKSPACES_STORE);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const value = cursor.value as Partial<StoredWorkspace>;
          if (typeof value.key === 'string' && validCounter(value.epoch)) {
            cursor.update({ key: value.key, epoch: value.epoch, revision: 0 } satisfies StoredWorkspace);
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error('Could not open browser app storage.'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Browser app storage is blocked by another tab.'));
    };
  });
}

/** Install transaction handlers immediately; Safari may commit after the final request event. */
function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser app storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser app storage transaction was aborted.'));
  });
}

function storageKey(workspaceKey: string, epoch: number, shapeId: string) {
  return `${workspaceKey}\u0000${epoch}\u0000${shapeId}`;
}

function cloneStorage(storage: Record<string, string> | null): Record<string, string> | null {
  if (!storage) return null;
  const clone = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(storage)) clone[key] = value;
  return clone;
}

function validateStorage(value: unknown, label: string): Record<string, string> {
  const result = validateStorageSnapshot(value);
  if (result.status !== 'accepted') {
    throw new Error(`${label} is invalid or exceeds the app storage limits.`);
  }
  return result.storage;
}

function validCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validWorkspace(value: unknown, key: string): value is StoredWorkspace {
  if (!value || typeof value !== 'object') return false;
  const workspace = value as Partial<StoredWorkspace>;
  return workspace.key === key && validCounter(workspace.epoch) && validCounter(workspace.revision);
}

function validStoredEntry(
  value: unknown,
  workspaceKey: string,
  shapeId: string,
  epoch: number
): value is StoredArtifactStorage {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredArtifactStorage>;
  if (
    entry.key !== storageKey(workspaceKey, epoch, shapeId) ||
    entry.workspaceKey !== workspaceKey ||
    entry.shapeId !== shapeId ||
    entry.epoch !== epoch ||
    !validCounter(entry.generation) || entry.generation === 0 ||
    typeof entry.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sourceFingerprint) ||
    typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt) ||
    (entry.deleted !== undefined && typeof entry.deleted !== 'boolean')
  ) return false;
  if (validateStorageSnapshot(entry.storage).status !== 'accepted') return false;
  if (entry.undoStorage !== null && validateStorageSnapshot(entry.undoStorage).status !== 'accepted') return false;
  return true;
}

function checkedWorkspace(value: unknown, workspaceKey: string): StoredWorkspace {
  if (value === undefined) return { key: workspaceKey, epoch: 0, revision: 0 };
  if (!validWorkspace(value, workspaceKey)) {
    throw new Error('Browser app storage metadata is damaged. Workspace data remains available in the board.');
  }
  return value;
}

function errorWithQuotaContext(error: unknown): Error {
  if ((error as DOMException | null)?.name === 'QuotaExceededError') {
    return new Error('Browser storage is full. App data could not be confirmed on this device.');
  }
  return error instanceof Error ? error : new Error('Browser app storage could not be confirmed.');
}

const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let epochChannel: BroadcastChannel | null = null;

function getEpochChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!epochChannel) {
    try {
      epochChannel = new BroadcastChannel(EPOCH_EVENT);
      epochChannel.onmessage = (message: MessageEvent<unknown>) => {
        const value = message.data;
        if (!value || typeof value !== 'object') return;
        const detail = value as Record<string, unknown>;
        if (typeof detail.workspaceKey !== 'string' || !validCounter(detail.epoch) || typeof detail.sourceTab !== 'string') return;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(EPOCH_EVENT, {
            detail: { workspaceKey: detail.workspaceKey, epoch: detail.epoch, foreignTab: detail.sourceTab !== TAB_ID },
          }));
        }
      };
    } catch {
      epochChannel = null;
    }
  }
  return epochChannel;
}

export function announceArtifactStorageWorkspaceEpoch(workspaceKey: string, epoch: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EPOCH_EVENT, { detail: { workspaceKey, epoch, foreignTab: false } }));
  }
  getEpochChannel()?.postMessage({ workspaceKey, epoch, sourceTab: TAB_ID });
  void pruneOldArtifactStorageEpochs(workspaceKey, epoch).catch(() => {});
}

export function getArtifactStorageEpochEventName() {
  return EPOCH_EVENT;
}

/** SHA-256 binds recovery to the exact app source; unavailable crypto fails closed for sidecar recovery. */
export async function artifactSourceFingerprint(source: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure source correlation is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readDurableArtifactStorage(
  workspaceKey: string,
  shapeId: string,
  sourceFingerprint: string
): Promise<DurableArtifactStorage> {
  const result = await runStorageOperation(workspaceKey, shapeId, async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([WORKSPACES_STORE, STORAGE_STORE], 'readonly');
      const committed = transactionCompletion(transaction);
      let outcome: DurableArtifactStorage | undefined;
      let validationError: unknown;
      const workspaceRequest = transaction.objectStore(WORKSPACES_STORE).get(workspaceKey);
      workspaceRequest.onerror = () => transaction.abort();
      workspaceRequest.onsuccess = () => {
        let workspace: StoredWorkspace;
        try {
          workspace = checkedWorkspace(workspaceRequest.result, workspaceKey);
        } catch (error) {
          validationError = error;
          transaction.abort();
          return;
        }
        const recordRequest = transaction.objectStore(STORAGE_STORE).get(
          storageKey(workspaceKey, workspace.epoch, shapeId)
        );
        recordRequest.onerror = () => transaction.abort();
        recordRequest.onsuccess = () => {
          const entry = recordRequest.result;
          const valid = entry !== undefined && validStoredEntry(entry, workspaceKey, shapeId, workspace.epoch);
          const sourceMatches = !!valid && entry.sourceFingerprint === sourceFingerprint && !entry.deleted;
          outcome = {
            epoch: workspace.epoch,
            generation: sourceMatches ? entry.generation : null,
            storage: sourceMatches ? cloneStorage(validateStorage(entry.storage, 'Stored app data')) : null,
            undoStorage: sourceMatches ? cloneStorage(entry.undoStorage) : null,
            sourceMatches,
            corrupted: entry !== undefined && !valid,
          };
        };
      };
      try {
        await committed;
      } catch (error) {
        if (validationError) throw validationError;
        throw error;
      }
      if (!outcome) throw new Error('Browser app storage returned no record.');
      return outcome;
    } finally {
      db.close();
    }
  });
  if (!result) throw new Error('App storage read was canceled by a workspace update.');
  return result;
}

/**
 * Create a fresh write generation for a mounted app. Old component instances,
 * deleted shapes, clear operations, and source switches can no longer publish
 * late writes into this generation.
 */
export async function activateDurableArtifactStorage(
  workspaceKey: string,
  shapeId: string,
  sourceFingerprint: string,
  initialStorage: Record<string, string>,
  isCurrent: () => boolean = () => true
): Promise<ActivatedArtifactStorage | null> {
  const initial = validateStorage(initialStorage, 'App data');
  const result = await runStorageOperation(workspaceKey, shapeId, async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([WORKSPACES_STORE, STORAGE_STORE], 'readwrite');
      const committed = transactionCompletion(transaction);
      const workspaces = transaction.objectStore(WORKSPACES_STORE);
      const records = transaction.objectStore(STORAGE_STORE);
      let outcome: ActivatedArtifactStorage | null = null;
      let validationError: unknown;
      const workspaceRequest = workspaces.get(workspaceKey);
      workspaceRequest.onerror = () => transaction.abort();
      workspaceRequest.onsuccess = () => {
        if (!isCurrent()) {
          outcome = { status: 'cancelled', epoch: 0, generation: null, storage: null, undoStorage: null, sourceMatches: false, corrupted: false };
          return;
        }
        let workspace: StoredWorkspace;
        try {
          workspace = checkedWorkspace(workspaceRequest.result, workspaceKey);
        } catch (error) {
          validationError = error;
          transaction.abort();
          return;
        }
        const recordRequest = records.get(storageKey(workspaceKey, workspace.epoch, shapeId));
        recordRequest.onerror = () => transaction.abort();
        recordRequest.onsuccess = () => {
          if (!isCurrent()) {
            outcome = { status: 'cancelled', epoch: workspace.epoch, generation: null, storage: null, undoStorage: null, sourceMatches: false, corrupted: false };
            return;
          }
          const existingValue = recordRequest.result;
          const existingValid = existingValue !== undefined && validStoredEntry(existingValue, workspaceKey, shapeId, workspace.epoch);
          const sourceMatches = !!existingValid && existingValue.sourceFingerprint === sourceFingerprint && !existingValue.deleted;
          const storage = sourceMatches
            ? validateStorage(existingValue.storage, 'Stored app data')
            : initial;
          const undoStorage = sourceMatches ? cloneStorage(existingValue.undoStorage) : null;
          if (workspace.revision >= MAX_SAFE_COUNTER) {
            validationError = new Error('App storage write generation limit was reached.');
            transaction.abort();
            return;
          }
          const generation = workspace.revision + 1;
          workspaces.put({ ...workspace, revision: generation } satisfies StoredWorkspace);
          records.put({
            key: storageKey(workspaceKey, workspace.epoch, shapeId),
            workspaceKey,
            shapeId,
            epoch: workspace.epoch,
            generation,
            sourceFingerprint,
            storage: cloneStorage(storage)!,
            undoStorage,
            savedAt: Date.now(),
          } satisfies StoredArtifactStorage);
          outcome = {
            status: 'active', epoch: workspace.epoch, generation,
            storage: cloneStorage(storage), undoStorage,
            sourceMatches, corrupted: existingValue !== undefined && !existingValid,
          };
        };
      };
      try {
        await committed;
      } catch (error) {
        if (validationError) throw validationError;
        throw error;
      }
      return outcome;
    } catch (error) {
      throw errorWithQuotaContext(error);
    } finally {
      db.close();
    }
  }, isCurrent);
  return result ?? null;
}

export type ArtifactStorageWriteResult =
  | { status: 'saved'; epoch: number; generation: number }
  | { status: 'stale'; epoch: number; generation: null };

type WriteKind = 'save' | 'clear' | 'undo';

async function writeArtifactStorage(
  kind: WriteKind,
  workspaceKey: string,
  shapeId: string,
  expectedEpoch: number,
  expectedGeneration: number,
  sourceFingerprint: string,
  storage: Record<string, string>,
  isCurrent: () => boolean
): Promise<ArtifactStorageWriteResult> {
  const validated = validateStorage(storage, 'App data');
  const result = await runStorageOperation(workspaceKey, shapeId, async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([WORKSPACES_STORE, STORAGE_STORE], 'readwrite');
      const committed = transactionCompletion(transaction);
      const workspaces = transaction.objectStore(WORKSPACES_STORE);
      const records = transaction.objectStore(STORAGE_STORE);
      let outcome: ArtifactStorageWriteResult = { status: 'stale', epoch: expectedEpoch, generation: null };
      const workspaceRequest = workspaces.get(workspaceKey);
      workspaceRequest.onerror = () => transaction.abort();
      workspaceRequest.onsuccess = () => {
        if (!isCurrent()) return;
        let workspace: StoredWorkspace;
        try {
          workspace = checkedWorkspace(workspaceRequest.result, workspaceKey);
        } catch {
          transaction.abort();
          return;
        }
        if (workspace.epoch !== expectedEpoch) {
          outcome = { status: 'stale', epoch: workspace.epoch, generation: null };
          return;
        }
        const key = storageKey(workspaceKey, expectedEpoch, shapeId);
        const recordRequest = records.get(key);
        recordRequest.onerror = () => transaction.abort();
        recordRequest.onsuccess = () => {
          if (!isCurrent()) return;
          const existing = recordRequest.result;
          if (!validStoredEntry(existing, workspaceKey, shapeId, expectedEpoch) ||
            existing.deleted || existing.generation !== expectedGeneration ||
            existing.sourceFingerprint !== sourceFingerprint) {
            outcome = { status: 'stale', epoch: workspace.epoch, generation: null };
            return;
          }
          if (kind === 'save') {
            records.put({ ...existing, storage: cloneStorage(validated)!, savedAt: Date.now() } satisfies StoredArtifactStorage);
            outcome = { status: 'saved', epoch: workspace.epoch, generation: expectedGeneration };
            return;
          }
          if (workspace.revision >= MAX_SAFE_COUNTER) {
            transaction.abort();
            return;
          }
          const generation = workspace.revision + 1;
          workspaces.put({ ...workspace, revision: generation } satisfies StoredWorkspace);
          records.put({
            ...existing,
            generation,
            storage: kind === 'clear' ? Object.create(null) as Record<string, string> : cloneStorage(validated)!,
            undoStorage: kind === 'clear' ? cloneStorage(validated) : null,
            savedAt: Date.now(),
          } satisfies StoredArtifactStorage);
          outcome = { status: 'saved', epoch: workspace.epoch, generation };
        };
      };
      await committed;
      return outcome;
    } catch (error) {
      throw errorWithQuotaContext(error);
    } finally {
      db.close();
    }
  }, isCurrent);
  if (!result) return { status: 'stale', epoch: expectedEpoch, generation: null };
  return result;
}

export function saveDurableArtifactStorage(
  workspaceKey: string,
  shapeId: string,
  expectedEpoch: number,
  expectedGeneration: number,
  sourceFingerprint: string,
  storage: Record<string, string>,
  isCurrent?: () => boolean
) {
  return writeArtifactStorage('save', workspaceKey, shapeId, expectedEpoch, expectedGeneration, sourceFingerprint, storage, isCurrent ?? (() => true));
}

export function clearDurableArtifactStorage(
  workspaceKey: string,
  shapeId: string,
  expectedEpoch: number,
  expectedGeneration: number,
  sourceFingerprint: string,
  undoStorage: Record<string, string>,
  isCurrent?: () => boolean
) {
  return writeArtifactStorage('clear', workspaceKey, shapeId, expectedEpoch, expectedGeneration, sourceFingerprint, undoStorage, isCurrent ?? (() => true));
}

export function undoDurableArtifactStorageClear(
  workspaceKey: string,
  shapeId: string,
  expectedEpoch: number,
  expectedGeneration: number,
  sourceFingerprint: string,
  storage: Record<string, string>,
  isCurrent?: () => boolean
) {
  return writeArtifactStorage('undo', workspaceKey, shapeId, expectedEpoch, expectedGeneration, sourceFingerprint, storage, isCurrent ?? (() => true));
}

export async function deleteDurableArtifactStorage(
  workspaceKey: string,
  shapeId: string,
  expectedEpoch: number,
  expectedGeneration: number,
  isCurrent: () => boolean = () => true
): Promise<'deleted' | 'stale'> {
  const result = await runStorageOperation(workspaceKey, shapeId, async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction([WORKSPACES_STORE, STORAGE_STORE], 'readwrite');
      const committed = transactionCompletion(transaction);
      const workspaces = transaction.objectStore(WORKSPACES_STORE);
      const records = transaction.objectStore(STORAGE_STORE);
      let deleted: 'deleted' | 'stale' = 'stale';
      const workspaceRequest = workspaces.get(workspaceKey);
      workspaceRequest.onerror = () => transaction.abort();
      workspaceRequest.onsuccess = () => {
        if (!isCurrent()) return;
        let workspace: StoredWorkspace;
        try {
          workspace = checkedWorkspace(workspaceRequest.result, workspaceKey);
        } catch {
          transaction.abort();
          return;
        }
        if (workspace.epoch !== expectedEpoch) return;
        const recordRequest = records.get(storageKey(workspaceKey, expectedEpoch, shapeId));
        recordRequest.onerror = () => transaction.abort();
        recordRequest.onsuccess = () => {
          const existing = recordRequest.result;
          if (!validStoredEntry(existing, workspaceKey, shapeId, expectedEpoch) || existing.generation !== expectedGeneration) return;
          if (workspace.revision >= MAX_SAFE_COUNTER) {
            transaction.abort();
            return;
          }
          // Advance the workspace-wide revision before removing the entry. A
          // later recreation cannot reuse this generation and accept old writes.
          workspaces.put({ ...workspace, revision: workspace.revision + 1 } satisfies StoredWorkspace);
          records.delete(storageKey(workspaceKey, expectedEpoch, shapeId));
          deleted = 'deleted';
        };
      };
      await committed;
      return deleted;
    } finally {
      db.close();
    }
  }, isCurrent);
  return result ?? 'stale';
}

export function beginArtifactStorageWorkspaceRestore(workspaceKey: string) {
  return operationGate.beginRestore(workspaceKey);
}

/** Advance the pointer while the old live document remains intact; announce only after live-load succeeds. */
export async function advanceArtifactStorageWorkspaceEpoch(workspaceKey: string): Promise<{
  previousEpoch: number;
  epoch: number;
}> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(WORKSPACES_STORE, 'readwrite');
    const committed = transactionCompletion(transaction);
    const store = transaction.objectStore(WORKSPACES_STORE);
    let result = { previousEpoch: 0, epoch: 1 };
    let validationError: unknown;
    const request = store.get(workspaceKey);
    request.onerror = () => transaction.abort();
    request.onsuccess = () => {
      let existing: StoredWorkspace;
      try {
        existing = checkedWorkspace(request.result, workspaceKey);
      } catch (error) {
        validationError = error;
        transaction.abort();
        return;
      }
      if (existing.epoch >= MAX_SAFE_COUNTER) {
        transaction.abort();
        return;
      }
      result = { previousEpoch: existing.epoch, epoch: existing.epoch + 1 };
      store.put({ ...existing, epoch: result.epoch } satisfies StoredWorkspace);
    };
    try {
      await committed;
    } catch (error) {
      if (validationError) throw validationError;
      throw error;
    }
    return result;
  } finally {
    db.close();
  }
}

/** Restore the prior pointer if the tldraw load fails; previous epoch records remain intact for this rollback. */
export async function rollbackArtifactStorageWorkspaceEpoch(
  workspaceKey: string,
  expectedEpoch: number,
  previousEpoch: number
): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(WORKSPACES_STORE, 'readwrite');
    const committed = transactionCompletion(transaction);
    const store = transaction.objectStore(WORKSPACES_STORE);
    let rolledBack = false;
    let validationError: unknown;
    const request = store.get(workspaceKey);
    request.onerror = () => transaction.abort();
    request.onsuccess = () => {
      let current: StoredWorkspace;
      try {
        current = checkedWorkspace(request.result, workspaceKey);
      } catch (error) {
        validationError = error;
        transaction.abort();
        return;
      }
      if (current.epoch !== expectedEpoch) return;
      store.put({ ...current, epoch: previousEpoch } satisfies StoredWorkspace);
      rolledBack = true;
    };
    try {
      await committed;
    } catch (error) {
      if (validationError) throw validationError;
      throw error;
    }
    if (!rolledBack) throw new Error('App storage changed during restore rollback.');
    announceArtifactStorageWorkspaceEpoch(workspaceKey, previousEpoch);
  } finally {
    db.close();
  }
}

async function pruneOldArtifactStorageEpochs(workspaceKey: string, currentEpoch: number) {
  const db = await openDatabase();
  try {
    while (true) {
      const transaction = db.transaction([WORKSPACES_STORE, STORAGE_STORE], 'readwrite');
      const committed = transactionCompletion(transaction);
      const workspaceStore = transaction.objectStore(WORKSPACES_STORE);
      const recordStore = transaction.objectStore(STORAGE_STORE);
      let pruned = 0;
      const workspaceRequest = workspaceStore.get(workspaceKey);
      workspaceRequest.onerror = () => transaction.abort();
      workspaceRequest.onsuccess = () => {
        let current: StoredWorkspace;
        try {
          current = checkedWorkspace(workspaceRequest.result, workspaceKey);
        } catch {
          transaction.abort();
          return;
        }
        if (current.epoch !== currentEpoch) return;
        const cursorRequest = recordStore.index('workspaceKey').openCursor(workspaceKey);
        cursorRequest.onerror = () => transaction.abort();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || pruned >= MAX_EPOCH_PRUNE_OPERATIONS) return;
          const value = cursor.value as Partial<StoredArtifactStorage>;
          if (value.epoch !== currentEpoch) {
            cursor.delete();
            pruned++;
          }
          cursor.continue();
        };
      };
      await committed;
      // Cap the amount of work in each transaction, but keep pruning in small
      // committed batches until no orphaned epochs remain.
      if (pruned < MAX_EPOCH_PRUNE_OPERATIONS) return;
    }
  } finally {
    db.close();
  }
}

export function isDurableStorageQuotaError(error: unknown) {
  return (error as DOMException | null)?.name === 'QuotaExceededError' ||
    (error instanceof Error && /storage is full|quota/i.test(error.message));
}
