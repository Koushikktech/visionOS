'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor, TLShapeId } from '@tldraw/tldraw';

export interface ShapeDraftRecord<T> {
  value: T;
  baseRevision: string;
  updatedAt: number;
}

export interface ShapeDraftOptions {
  editor?: Editor;
  shapeId?: TLShapeId | string;
  validateRecovered?: (candidate: unknown) => boolean;
}

export interface ShapeDraft<T> {
  value: T;
  setValue: (next: T | ((current: T) => T)) => void;
  isDirty: boolean;
  hasConflict: boolean;
  recovered: boolean;
  recoveryAvailable: boolean;
  /** Call only after the editor confirms the update was written successfully. */
  save: (value?: T) => void;
  /** Discard the draft and reload the latest value from the shape. */
  discard: () => void;
}

const STORAGE_KEY = 'visionos-shape-drafts-v1';
const TAB_ID_KEY = 'visionos-shape-draft-tab-v1';
const WORKSPACE_KEY = 'visionos-board-store';
const MAX_RECORDS = 32;
const MAX_RECORD_CHARS = 320_000;
const MAX_TOTAL_CHARS = 1_500_000;
const activeDrafts = new Set<string>();

type StoredDraft = ShapeDraftRecord<unknown>;
type DraftStore = { version: 1; drafts: Record<string, StoredDraft> };

function exactRevision(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
  );
}

export function matchesShapeDraftValue(candidate: unknown, reference: unknown): boolean {
  if (reference === undefined) return candidate === undefined;
  if (reference === null || typeof reference !== 'object')
    return typeof candidate === typeof reference && candidate !== undefined;
  if (Array.isArray(reference)) {
    if (!Array.isArray(candidate)) return false;
    const template = reference[0];
    return template === undefined
      ? true
      : candidate.every((item) => matchesShapeDraftValue(item, template));
  }
  if (!isPlainRecord(candidate)) return false;
  const requiredKeys = Object.keys(reference as Record<string, unknown>).filter(
    (key) => (reference as Record<string, unknown>)[key] !== undefined
  );
  const candidateKeys = Object.keys(candidate);
  if (candidateKeys.some((key) => !(key in (reference as object)))) return false;
  return requiredKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(candidate, key) &&
      matchesShapeDraftValue(
        candidate[key],
        (reference as Record<string, unknown>)[key]
      )
  );
}

function getLocalStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function getTabId(): string {
  try {
    const session = window.sessionStorage;
    const current = session.getItem(TAB_ID_KEY);
    if (current) return current;
    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    session.setItem(TAB_ID_KEY, created);
    return created;
  } catch {
    return 'memory-only';
  }
}

function storageRecordKey(key: string, tabId = getTabId()) {
  return `${tabId}|${WORKSPACE_KEY}|${key}`;
}

function readStore(storage = getLocalStorage()): DraftStore {
  if (!storage) return { version: 1, drafts: {} };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') as
      | DraftStore
      | null;
    if (
      parsed?.version === 1 &&
      isPlainRecord(parsed.drafts)
    ) {
      const drafts: Record<string, StoredDraft> = {};
      for (const [key, candidate] of Object.entries(parsed.drafts)) {
        if (
          !key ||
          key.length > 700 ||
          !isPlainRecord(candidate) ||
          !Object.prototype.hasOwnProperty.call(candidate, 'value') ||
          typeof candidate.baseRevision !== 'string' ||
          candidate.baseRevision.length === 0 ||
          candidate.baseRevision.length > MAX_RECORD_CHARS ||
          typeof candidate.updatedAt !== 'number' ||
          !Number.isFinite(candidate.updatedAt) ||
          candidate.updatedAt < 0
        )
          continue;
        try {
          JSON.parse(candidate.baseRevision);
        } catch {
          continue;
        }
        let recordSize = 0;
        try {
          recordSize = JSON.stringify(candidate).length;
        } catch {
          continue;
        }
        if (recordSize > MAX_RECORD_CHARS) continue;
        drafts[key] = candidate as unknown as StoredDraft;
      }
      return { version: 1, drafts };
    }
  } catch {
    // A damaged recovery record must never prevent canvas editing.
  }
  return { version: 1, drafts: {} };
}

export function readShapeDraft<T>(
  key: string,
  storage = getLocalStorage(),
  tabId = getTabId()
): ShapeDraftRecord<T> | null {
  const record = readStore(storage).drafts[storageRecordKey(key, tabId)];
  if (!record || typeof record.baseRevision !== 'string') return null;
  return record as ShapeDraftRecord<T>;
}

/** A current-tab dirty check used to stop automatic AI source replacement. */
export function hasActiveShapeDraft(
  key: string,
  storage = getLocalStorage(),
  tabId = getTabId()
): boolean {
  const id = storageRecordKey(key, tabId);
  if (activeDrafts.has(id)) return true;
  const recovery = readShapeDraft<unknown>(key, storage, tabId);
  return Boolean(
    recovery && exactRevision(recovery.value) !== recovery.baseRevision
  );
}

export function writeShapeDraft<T>(
  key: string,
  record: ShapeDraftRecord<T>,
  storage = getLocalStorage(),
  tabId = getTabId()
): boolean {
  const id = storageRecordKey(key, tabId);
  if (
    typeof record.baseRevision !== 'string' ||
    record.baseRevision.length === 0 ||
    !Number.isFinite(record.updatedAt) ||
    record.updatedAt < 0 ||
    record.value === undefined
  )
    return false;
  try {
    JSON.parse(record.baseRevision);
  } catch {
    return false;
  }
  let serializedRecord: string;
  try {
    serializedRecord = JSON.stringify(record);
  } catch {
    return false;
  }
  if (typeof serializedRecord !== 'string') return false;
  activeDrafts.add(id);
  if (!storage) return false;
  if (serializedRecord.length > MAX_RECORD_CHARS) {
    if (storage) {
      try {
        const store = readStore(storage);
        delete store.drafts[id];
        storage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch {
        // Keep the in-memory dirty marker even if a large recovery cannot be stored.
      }
    }
    return false;
  }

  const store = readStore(storage);
  store.drafts[id] = record as ShapeDraftRecord<unknown>;
  const newestFirst = Object.entries(store.drafts).sort(
    ([, a], [, b]) => b.updatedAt - a.updatedAt
  );
  const retained: Record<string, StoredDraft> = {};
  let totalChars = 0;
  for (const [entryId, entry] of newestFirst) {
    const entryChars = JSON.stringify(entry).length;
    if (
      Object.keys(retained).length >= MAX_RECORDS ||
      totalChars + entryChars > MAX_TOTAL_CHARS
    )
      continue;
    retained[entryId] = entry;
    totalChars += entryChars;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: retained }));
    return Boolean(retained[id]);
  } catch {
    // Retry after dropping oldest entries, since browser storage may be nearly full.
    const entries = Object.entries(retained).sort(
      ([, a], [, b]) => b.updatedAt - a.updatedAt
    );
    while (entries.length > 1) {
      const oldest = entries.pop()!;
      delete retained[oldest[0]];
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts: retained }));
        return Boolean(retained[id]);
      } catch {
        // Continue trimming until this record is the only one left.
      }
    }
    return false;
  }
}

export function clearShapeDraft(
  key: string,
  storage = getLocalStorage(),
  tabId = getTabId()
): void {
  activeDrafts.delete(storageRecordKey(key, tabId));
  if (!storage) return;
  try {
    const store = readStore(storage);
    delete store.drafts[storageRecordKey(key, tabId)];
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Clearing recovery is best effort; a stale draft is still revision checked on restore.
  }
}

export function useShapeDraft<T>(
  key: string,
  persistedValue: T,
  options: ShapeDraftOptions = {}
): ShapeDraft<T> {
  const persistedRevision = exactRevision(persistedValue);
  const persistedRef = useRef(persistedValue);
  const draftRef = useRef<T>(persistedValue);
  const baseRevisionRef = useRef(persistedRevision);
  const recoveredRef = useRef(false);
  const [value, setValueState] = useState<T>(() => {
    const recovery = readShapeDraft<T>(key);
    if (!recovery) return persistedValue;
    if (
      !matchesShapeDraftValue(recovery.value, persistedValue) ||
      options.validateRecovered?.(recovery.value) === false
    ) {
      clearShapeDraft(key);
      return persistedValue;
    }
    if (exactRevision(recovery.value) !== recovery.baseRevision)
      activeDrafts.add(storageRecordKey(key));
    draftRef.current = recovery.value;
    baseRevisionRef.current = recovery.baseRevision;
    recoveredRef.current = true;
    return recovery.value;
  });
  const [baseRevision, setBaseRevision] = useState(baseRevisionRef.current);
  const [recovered, setRecovered] = useState(recoveredRef.current);
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const valueRevision = exactRevision(value);
  const isDirty = valueRevision !== baseRevision;
  const hasConflict =
    isDirty &&
    persistedRevision !== baseRevision &&
    persistedRevision !== valueRevision;

  useEffect(() => {
    persistedRef.current = persistedValue;
    if (exactRevision(draftRef.current) === baseRevisionRef.current) {
      const nextRevision = exactRevision(persistedValue);
      baseRevisionRef.current = nextRevision;
      draftRef.current = persistedValue;
      setBaseRevision(nextRevision);
      setValueState(persistedValue);
      clearShapeDraft(key);
      setRecovered(false);
      recoveredRef.current = false;
      setRecoveryAvailable(true);
    }
  }, [key, persistedRevision]);

  useEffect(() => {
    const editor = options.editor;
    const shapeId = options.shapeId;
    if (!editor || !shapeId) return;
    const unsubscribe = editor.store.listen(() => {
      // A page switch retains the shape record. A real deletion clears recovery so an
      // imported/recreated shape with a coincidentally reused ID cannot revive it.
      if (!editor.getShape(shapeId as TLShapeId)) clearShapeDraft(key);
    });
    return unsubscribe;
  }, [key, options.editor, options.shapeId]);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved =
        typeof next === 'function'
          ? (next as (current: T) => T)(draftRef.current)
          : next;
      draftRef.current = resolved;
      setValueState(resolved);
      const dirty = exactRevision(resolved) !== baseRevisionRef.current;
      if (dirty) {
        activeDrafts.add(storageRecordKey(key));
        setRecoveryAvailable(
          writeShapeDraft(key, {
            value: resolved,
            baseRevision: baseRevisionRef.current,
            updatedAt: Date.now(),
          })
        );
      } else {
        clearShapeDraft(key);
        setRecoveryAvailable(true);
      }
    },
    [key]
  );

  const save = useCallback(
    (next?: T) => {
      const saved = next === undefined ? draftRef.current : next;
      const revision = exactRevision(saved);
      draftRef.current = saved;
      baseRevisionRef.current = revision;
      setValueState(saved);
      setBaseRevision(revision);
      clearShapeDraft(key);
      setRecovered(false);
      recoveredRef.current = false;
      setRecoveryAvailable(true);
    },
    [key]
  );

  const discard = useCallback(() => {
    const latest = persistedRef.current;
    const revision = exactRevision(latest);
    draftRef.current = latest;
    baseRevisionRef.current = revision;
    setValueState(latest);
    setBaseRevision(revision);
    clearShapeDraft(key);
    setRecovered(false);
    recoveredRef.current = false;
    setRecoveryAvailable(true);
  }, [key]);

  return {
    value,
    setValue,
    isDirty,
    hasConflict,
    recovered,
    recoveryAvailable,
    save,
    discard,
  };
}
