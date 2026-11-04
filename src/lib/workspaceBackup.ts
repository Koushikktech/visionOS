import { createTLStore, defaultShapeUtils, getSnapshot as getTldrawSnapshot, loadSnapshot as loadTldrawSnapshot } from '@tldraw/tldraw';
import type { TLEditorSnapshot } from '@tldraw/tldraw';
import { customShapeUtils } from '../shapes';
import {
  advanceArtifactStorageWorkspaceEpoch,
  announceArtifactStorageWorkspaceEpoch,
  ARTIFACT_STORAGE_WORKSPACE_KEY,
  beginArtifactStorageWorkspaceRestore,
  flushArtifactStorageWorkspaceUpdates,
  rollbackArtifactStorageWorkspaceEpoch,
} from './artifactStoragePersistence';

export const MAX_WORKSPACE_BACKUP_BYTES = 25_000_000;
export const MAX_BACKUP_RECORDS = 50_000;
export const MAX_BACKUP_NESTED_ITEMS = 500;
export const MAX_BACKUP_COORDINATE = 10_000_000;
export const MAX_BACKUP_SHAPE_DIMENSION = 100_000;
const MAX_PORTABLE_ASSET_BYTES = 10_000_000;
const RECOVERY_DB_NAME = 'visionos-workspace-recovery-v1';
const RECOVERY_STORE_NAME = 'snapshots';
const RECOVERY_KEY = 'before-last-restore';

export interface BackupAssetExclusion {
  id: string;
  reason: 'external' | 'unavailable' | 'unsupported' | 'size-limit';
}

export interface WorkspaceBackupV2 {
  format: 'visionos-backup';
  version: 2;
  createdAt: string;
  snapshot: TLEditorSnapshot;
  portability: {
    embeddedAssetCount: number;
    excludedAssets: BackupAssetExclusion[];
    exclusions: string[];
  };
}

export interface PreparedWorkspaceBackup {
  snapshot: TLEditorSnapshot;
  portability: WorkspaceBackupV2['portability'];
  migratedFrom: string | null;
}

export interface WorkspaceSnapshotTarget {
  getSnapshot(): TLEditorSnapshot;
  loadSnapshot(
    snapshot: TLEditorSnapshot,
    options?: { forceOverwriteSessionState?: boolean }
  ): void;
  runAtomically?(operation: () => void): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertBoundedString(value: unknown, label: string, max = 1_000_000): asserts value is string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${label} must be a string shorter than ${max.toLocaleString()} characters.`);
  }
}

function assertNestedArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_NESTED_ITEMS) {
    throw new Error(`${label} must be an array with at most ${MAX_BACKUP_NESTED_ITEMS} items.`);
  }
}

function assertNestedIds(items: unknown[], label: string) {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!isObject(item)) throw new Error(`${label} ${index + 1} is malformed.`);
    const id = item.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 1_024) {
      throw new Error(`${label} ${index + 1} has an invalid ID.`);
    }
    if (ids.has(id)) throw new Error(`${label} contains a duplicate ID: ${id}.`);
    ids.add(id);
  }
}

function migrateLegacyCustomContent(snapshot: unknown): TLEditorSnapshot {
  if (!isObject(snapshot) || !isObject(snapshot.document) || !isObject(snapshot.document.store)) {
    throw new Error('Backup is missing its workspace document.');
  }
  const store = snapshot.document.store;
  for (const value of Object.values(store)) {
    if (!isObject(value) || value.typeName !== 'shape' || !isObject(value.props)) continue;
    if (value.type === 'document' && Array.isArray(value.props.sections)) {
      value.props.sections = value.props.sections.map((section, index) => {
        if (!isObject(section)) return section;
        for (const field of ['id', 'title', 'content'] as const) {
          const fieldValue = section[field];
          if (fieldValue !== undefined && typeof fieldValue !== 'string') return section;
        }
        return {
          ...section,
          id: section.id ?? `section-${index + 1}`,
          title: section.title ?? `Section ${index + 1}`,
          content: section.content ?? '',
        };
      });
    }
    if (value.type === 'document' && value.props.sections === undefined) {
      value.props.sections = [];
    }
    if (value.type === 'slide_deck' && Array.isArray(value.props.slides)) {
      value.props.slides = value.props.slides.map((slide, index) => {
        if (!isObject(slide)) return slide;
        for (const field of ['id', 'title'] as const) {
          const fieldValue = slide[field];
          if (fieldValue !== undefined && typeof fieldValue !== 'string') return slide;
        }
        return {
          ...slide,
          id: slide.id ?? `slide-${index + 1}`,
          title: slide.title ?? `Slide ${index + 1}`,
        };
      });
    }
  }
  return snapshot as unknown as TLEditorSnapshot;
}

function normalizeImportedArtifactSafety(snapshot: TLEditorSnapshot): TLEditorSnapshot {
  const store = snapshot.document?.store;
  if (!isObject(store)) throw new Error('Backup is missing its workspace document.');
  for (const value of Object.values(store)) {
    if (!isObject(value) || value.typeName !== 'shape' || value.type !== 'artifact') continue;
    if (!isObject(value.props)) throw new Error('An app in this backup has invalid properties.');
    value.props.runtimePaused = true;
    value.props.networkEnabled = false;
  }
  return snapshot;
}

function addMissingSessionPageId(snapshot: unknown): void {
  if (!isObject(snapshot) || !isObject(snapshot.document) || !isObject(snapshot.document.store) || !isObject(snapshot.session)) return;
  if (snapshot.session.currentPageId !== undefined) return;
  const page = Object.values(snapshot.document.store).find((record) => isObject(record) && record.typeName === 'page' && typeof record.id === 'string');
  if (!page || !isObject(page) || typeof page.id !== 'string') {
    throw new Error('Backup session has no current page and the document contains no page to select.');
  }
  // tldraw's public session validator permits this field to be absent, but
  // loading that session creates a required instance.currentPageId record.
  // Use the first document page as a deterministic legacy default.
  snapshot.session.currentPageId = page.id;
}

function validateNestedContent(record: Record<string, unknown>) {
  if (record.typeName !== 'shape' || !isObject(record.props)) return;
  const props = record.props;
  if (record.type === 'document') {
    assertNestedArray(props.sections, 'Document sections');
    assertNestedIds(props.sections, 'Document section');
    for (const [index, section] of props.sections.entries()) {
      if (!isObject(section)) throw new Error(`Document section ${index + 1} is malformed.`);
      assertBoundedString(section.title, `Document section ${index + 1} title`, 20_000);
      assertBoundedString(section.content, `Document section ${index + 1} content`);
      if (section.badge !== undefined) assertBoundedString(section.badge, 'Document section badge', 500);
    }
  } else if (record.type === 'slide_deck') {
    if (props.slides === undefined) return;
    assertNestedArray(props.slides, 'Deck slides');
    assertNestedIds(props.slides, 'Slide');
    for (const [slideIndex, slide] of props.slides.entries()) {
      if (!isObject(slide)) throw new Error(`Slide ${slideIndex + 1} is malformed.`);
      assertBoundedString(slide.title, `Slide ${slideIndex + 1} title`, 20_000);
      for (const [key, label] of [
        ['bullets', 'slide bullets'],
        ['stats', 'slide stats'],
        ['columns', 'slide columns'],
        ['timelineSteps', 'slide timeline steps'],
      ] as const) {
        const list = slide[key];
        if (list === undefined) continue;
        assertNestedArray(list, label);
        for (const item of list) {
          if (typeof item === 'string') {
            assertBoundedString(item, label, 20_000);
            continue;
          }
          if (!isObject(item)) throw new Error(`${label} contain a malformed item.`);
          for (const [field, value] of Object.entries(item)) {
            if (value !== undefined) assertBoundedString(value, `${label} ${field}`, 20_000);
          }
        }
      }
      for (const key of ['subtitle', 'content', 'speakerNotes'] as const) {
        if (slide[key] !== undefined) assertBoundedString(slide[key], `Slide ${key}`);
      }
    }
  }
}

function validateSnapshotBounds(snapshot: unknown): asserts snapshot is TLEditorSnapshot {
  if (!isObject(snapshot) || !isObject(snapshot.document) || !isObject(snapshot.document.store)) {
    throw new Error('Backup is missing its workspace document.');
  }
  const entries = Object.entries(snapshot.document.store);
  if (entries.length > MAX_BACKUP_RECORDS) {
    throw new Error(`Workspace has more than ${MAX_BACKUP_RECORDS.toLocaleString()} records.`);
  }
  const recordIds = new Set<string>();
  const pageIds = new Set<string>();
  const shapeIds = new Set<string>();
  for (const [key, record] of entries) {
    if (!isObject(record) || typeof record.typeName !== 'string' || typeof record.id !== 'string') {
      throw new Error('Workspace contains a malformed record.');
    }
    if (key !== record.id || !record.id.startsWith(`${record.typeName}:`) ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,40}:[A-Za-z0-9._~-]{1,160}$/.test(record.id)) {
      throw new Error(`Workspace contains an invalid record ID: ${record.id}.`);
    }
    if (recordIds.has(record.id)) throw new Error(`Workspace contains a duplicate record ID: ${record.id}.`);
    recordIds.add(record.id);
    if (record.typeName === 'page') pageIds.add(record.id);
    if (record.typeName === 'shape') {
      shapeIds.add(record.id);
      for (const keyName of ['x', 'y', 'rotation'] as const) {
        const value = record[keyName];
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_BACKUP_COORDINATE) {
          throw new Error(`Shape ${record.id} has an invalid ${keyName} coordinate.`);
        }
      }
      if (isObject(record.props)) {
        for (const dimension of ['w', 'h'] as const) {
          const value = record.props[dimension];
          if (value === undefined) continue;
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_BACKUP_SHAPE_DIMENSION) {
            throw new Error(`Shape ${record.id} has an invalid ${dimension} dimension.`);
          }
        }
      }
      validateNestedContent(record);
    }
  }
  validateSessionBounds(snapshot.session, pageIds, shapeIds);
}

function validateSessionBounds(value: unknown, pageIds: Set<string>, shapeIds: Set<string>) {
  if (value === undefined) return;
  if (!isObject(value) || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0 || value.version > 0) {
    throw new Error('Backup contains an unsupported editor session state.');
  }
  for (const flag of ['isFocusMode', 'exportBackground', 'isDebugMode', 'isToolLocked', 'isGridMode'] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') {
      throw new Error('Backup contains an invalid editor session state.');
    }
  }
  if (value.currentPageId !== undefined && (typeof value.currentPageId !== 'string' || !pageIds.has(value.currentPageId))) {
    throw new Error('Backup references a page that is not present.');
  }
  if (value.pageStates !== undefined) {
    if (!Array.isArray(value.pageStates) || value.pageStates.length > MAX_BACKUP_NESTED_ITEMS) {
      throw new Error('Backup contains too many page states.');
    }
    const statePageIds = new Set<string>();
    for (const state of value.pageStates) {
      if (!isObject(state) || typeof state.pageId !== 'string' || !pageIds.has(state.pageId)) throw new Error('Backup contains a malformed page state.');
      if (statePageIds.has(state.pageId)) throw new Error('Backup contains duplicate page states.');
      statePageIds.add(state.pageId);
      if (state.camera !== undefined) {
        if (!isObject(state.camera)) throw new Error('Backup contains a malformed camera state.');
        for (const axis of ['x', 'y', 'z'] as const) {
          const coordinate = state.camera[axis];
          const max = axis === 'z' ? 100 : MAX_BACKUP_COORDINATE;
          if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > max || (axis === 'z' && coordinate <= 0)) {
            throw new Error('Backup contains an invalid camera state.');
          }
        }
      }
      if (state.selectedShapeIds !== undefined) {
        if (!Array.isArray(state.selectedShapeIds) || state.selectedShapeIds.length > MAX_BACKUP_NESTED_ITEMS ||
          state.selectedShapeIds.some((id) => typeof id !== 'string' || !shapeIds.has(id))) {
          throw new Error('Backup contains invalid selected shape IDs.');
        }
      }
      if (state.focusedGroupId !== undefined && state.focusedGroupId !== null &&
        (typeof state.focusedGroupId !== 'string' || !shapeIds.has(state.focusedGroupId))) {
        throw new Error('Backup contains an invalid focused shape ID.');
      }
    }
  }
}

function validateThroughTldrawSchema(snapshot: TLEditorSnapshot): TLEditorSnapshot {
  const isolatedStore = createTLStore({ shapeUtils: [...defaultShapeUtils, ...customShapeUtils] });
  try {
    // Exercise the same full document + session loader used by the live Editor.
    // Loading only the document misses instance-state errors that otherwise
    // could occur after the live document has already been replaced.
    loadTldrawSnapshot(isolatedStore, snapshot);
    const canonical = getTldrawSnapshot(isolatedStore);
    validateSnapshotBounds(canonical);
    return canonical;
  } catch (error) {
    if (error instanceof Error && /schema|migrat|future|version/i.test(error.message)) {
      throw new Error(`Backup schema is incompatible: ${error.message}`);
    }
    throw new Error(`Backup failed workspace validation: ${error instanceof Error ? error.message : 'unknown schema error'}`);
  } finally {
    isolatedStore.dispose();
  }
}

export function prepareWorkspaceBackup(payload: unknown): PreparedWorkspaceBackup {
  if (!isObject(payload)) throw new Error('Choose a VisionOS workspace backup.');
  let snapshot: unknown;
  let migratedFrom: string | null = null;
  if (payload.format === 'visionos-backup' && payload.version === 2) {
    assertBoundedString(payload.createdAt, 'Backup creation time', 40);
    if (!Number.isFinite(Date.parse(payload.createdAt))) throw new Error('Backup creation time is invalid.');
    snapshot = payload.snapshot;
  } else if (
    (payload.format === 'visionos-backup-v1' || payload.format === 'canvasos-backup-v1') &&
    isObject(payload.snapshot)
  ) {
    migratedFrom = payload.format;
    snapshot = migrateLegacyCustomContent(payload.snapshot);
  } else if (payload.format === 'visionos-backup' && typeof payload.version === 'number') {
    throw new Error(`Backup version ${payload.version} is not supported by this version of VisionOS.`);
  } else {
    throw new Error('Choose a VisionOS workspace backup.');
  }
  validateSnapshotBounds(snapshot);
  addMissingSessionPageId(snapshot);
  validateSnapshotBounds(snapshot);
  const safe = normalizeImportedArtifactSafety(snapshot as TLEditorSnapshot);
  const validated = validateThroughTldrawSchema(safe);
  return {
    snapshot: validated,
    portability: validatePortability(payload.portability),
    migratedFrom,
  };
}

export function prepareDurableRecoverySnapshot(snapshot: unknown): PreparedWorkspaceBackup {
  return prepareWorkspaceBackup({
    format: 'visionos-backup',
    version: 2,
    createdAt: new Date().toISOString(),
    snapshot,
  });
}

function validatePortability(value: unknown): WorkspaceBackupV2['portability'] {
  if (value === undefined) {
    return { embeddedAssetCount: 0, excludedAssets: [], exclusions: ['This backup predates asset portability reporting.'] };
  }
  if (!isObject(value) || !Number.isInteger(value.embeddedAssetCount) || (value.embeddedAssetCount as number) < 0) {
    throw new Error('Backup contains invalid asset portability information.');
  }
  if (!Array.isArray(value.excludedAssets) || value.excludedAssets.length > MAX_BACKUP_RECORDS) {
    throw new Error('Backup contains invalid asset portability information.');
  }
  const excludedAssets: BackupAssetExclusion[] = value.excludedAssets.map((entry) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id.length > 256 ||
      !['external', 'unavailable', 'unsupported', 'size-limit'].includes(String(entry.reason))) {
      throw new Error('Backup contains invalid asset portability information.');
    }
    return { id: entry.id, reason: entry.reason as BackupAssetExclusion['reason'] };
  });
  const exclusions = value.exclusions;
  if (!Array.isArray(exclusions) || exclusions.length > 100 || exclusions.some((item) => typeof item !== 'string' || item.length > 1000)) {
    throw new Error('Backup contains invalid asset portability information.');
  }
  return { embeddedAssetCount: value.embeddedAssetCount as number, excludedAssets, exclusions: exclusions as string[] };
}

function snapshotsEqual(left: unknown, right: unknown): boolean {
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
      const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined).sort();
      const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined).sort();
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

export async function restoreWorkspaceWithRecovery(
  target: WorkspaceSnapshotTarget,
  nextSnapshot: TLEditorSnapshot,
  writeRecovery: (snapshot: TLEditorSnapshot) => Promise<void> = saveDurableRecoveryCopy,
  advanceStorageEpoch: typeof advanceArtifactStorageWorkspaceEpoch = advanceArtifactStorageWorkspaceEpoch,
  rollbackStorageEpoch: typeof rollbackArtifactStorageWorkspaceEpoch = rollbackArtifactStorageWorkspaceEpoch
): Promise<void> {
  const persistStableLiveSnapshot = async (initial?: TLEditorSnapshot) => {
    let candidate = initial ?? target.getSnapshot();
    let changedDuringWrite = false;
    // A continuously changing workspace is left live and restore is canceled.
    // Every completed write is followed by a fresh comparison before loading.
    for (let attempt = 0; attempt < 5; attempt++) {
      await writeRecovery(candidate);
      flushArtifactStorageWorkspaceUpdates(ARTIFACT_STORAGE_WORKSPACE_KEY);
      const current = target.getSnapshot();
      if (snapshotsEqual(candidate, current)) return { snapshot: candidate, changedDuringWrite };
      changedDuringWrite = true;
      candidate = current;
    }
    throw new Error(
      'Workspace kept changing while its recovery copy was being saved. Restore was canceled and current work was kept.'
    );
  };

  // App runtime mutations are debounced. Move all current iframe changes into
  // the live tldraw store before the recovery copy captures its source snapshot.
  flushArtifactStorageWorkspaceUpdates(ARTIFACT_STORAGE_WORKSPACE_KEY);
  const initialRecovery = await persistStableLiveSnapshot();
  let previous = initialRecovery.snapshot;
  if (initialRecovery.changedDuringWrite) {
    throw new Error('Workspace changed while its recovery copy was being saved. Restore was canceled and current work was kept.');
  }
  const restoreGate = beginArtifactStorageWorkspaceRestore(ARTIFACT_STORAGE_WORKSPACE_KEY);
  let liveLoadStarted = false;
  let storageEpoch: { previousEpoch: number; epoch: number } | null = null;
  try {
    await restoreGate.waitForIdle();
    flushArtifactStorageWorkspaceUpdates(ARTIFACT_STORAGE_WORKSPACE_KEY);
    const afterDrain = target.getSnapshot();
    if (!snapshotsEqual(previous, afterDrain)) {
      const refreshedRecovery = await persistStableLiveSnapshot(afterDrain);
      previous = refreshedRecovery.snapshot;
      throw new Error('Workspace changed while the recovery copy was being saved. Restore was canceled and current work was kept.');
    }

    // Switch the app-storage namespace while the old live document is still
    // intact. If edits arrive during this IndexedDB await, restore is canceled
    // and the old namespace pointer is rolled back before releasing the gate.
    storageEpoch = await advanceStorageEpoch(ARTIFACT_STORAGE_WORKSPACE_KEY);
    flushArtifactStorageWorkspaceUpdates(ARTIFACT_STORAGE_WORKSPACE_KEY);
    const immediatelyBeforeLoad = target.getSnapshot();
    if (!snapshotsEqual(previous, immediatelyBeforeLoad)) {
      await rollbackStorageEpoch(
        ARTIFACT_STORAGE_WORKSPACE_KEY,
        storageEpoch.epoch,
        storageEpoch.previousEpoch
      );
      storageEpoch = null;
      const refreshedRecovery = await persistStableLiveSnapshot(immediatelyBeforeLoad);
      previous = refreshedRecovery.snapshot;
      throw new Error('Workspace changed while the recovery copy was being saved. Restore was canceled and current work was kept.');
    }

    // No await is allowed between this last comparison and the synchronous
    // tldraw load or its completion. Imported shapes now read from the new
    // sidecar namespace; old pending writes remain fenced by their old epoch.
    // Keep a failed partial load and its rollback in one store transaction so
    // persistence listeners observe only the net document change.
    liveLoadStarted = true;
    target.runAtomically?.(() => {
      try {
        target.loadSnapshot(nextSnapshot);
      } catch (loadError) {
        try {
          target.loadSnapshot(previous, { forceOverwriteSessionState: true });
          liveLoadStarted = false;
        } catch {
          // The outer rollback path retries and reports both failures.
        }
        throw loadError;
      }
    });
    if (!target.runAtomically) target.loadSnapshot(nextSnapshot);
    announceArtifactStorageWorkspaceEpoch(ARTIFACT_STORAGE_WORKSPACE_KEY, storageEpoch.epoch);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (liveLoadStarted) {
      try {
        const rollback = () =>
          target.loadSnapshot(previous, { forceOverwriteSessionState: true });
        if (target.runAtomically) target.runAtomically(rollback);
        else rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (storageEpoch) {
      try {
        await rollbackStorageEpoch(
          ARTIFACT_STORAGE_WORKSPACE_KEY,
          storageEpoch.epoch,
          storageEpoch.previousEpoch
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (!liveLoadStarted && !storageEpoch) {
      try {
        const current = target.getSnapshot();
        if (!snapshotsEqual(previous, current)) {
          const refreshedRecovery = await persistStableLiveSnapshot(current);
          previous = refreshedRecovery.snapshot;
        }
      } catch {
        // Keep the live workspace intact; an inability to refresh the recovery
        // copy must not trigger a replacement or obscure the original failure.
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        'Restore failed and the live workspace or app-storage namespace could not be rolled back. The durable recovery copy remains available.'
      );
    }
    throw error;
  } finally {
    restoreGate.release();
  }
}

class BoundedJsonWriter {
  private readonly chunks: string[] = [];
  private length = 0;
  private readonly seen = new Set<object>();

  constructor(private readonly maxCharacters: number) {}

  private append(value: string) {
    this.length += value.length;
    if (this.length > this.maxCharacters) throw new Error('Workspace backup exceeds the 25 MB limit.');
    this.chunks.push(value);
  }

  write(value: unknown, depth = 0): string {
    this.writeValue(value, depth);
    return this.chunks.join('');
  }

  private writeValue(value: unknown, depth: number) {
    if (depth > 100) throw new Error('Workspace backup contains data nested too deeply.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
      if (typeof value === 'string' && value.length > this.maxCharacters) {
        throw new Error('Workspace backup contains a string larger than the 25 MB limit.');
      }
      this.append(JSON.stringify(value));
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Workspace backup contains a nonfinite number.');
      this.append(JSON.stringify(value));
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_BACKUP_RECORDS) throw new Error('Workspace backup contains an oversized array.');
      this.withContainer(value, () => {
        this.append('[');
        value.forEach((item, index) => {
          if (index) this.append(',');
          this.writeValue(item === undefined || typeof item === 'function' || typeof item === 'symbol' ? null : item, depth + 1);
        });
        this.append(']');
      });
      return;
    }
    if (isObject(value)) {
      const keys = Object.keys(value).filter((key) => value[key] !== undefined && typeof value[key] !== 'function' && typeof value[key] !== 'symbol');
      if (keys.length > MAX_BACKUP_RECORDS) throw new Error('Workspace backup contains an oversized object.');
      this.withContainer(value, () => {
        this.append('{');
        keys.forEach((key, index) => {
          if (index) this.append(',');
          this.append(JSON.stringify(key));
          this.append(':');
          this.writeValue(value[key], depth + 1);
        });
        this.append('}');
      });
      return;
    }
    throw new Error('Workspace backup contains a value that cannot be serialized.');
  }

  private withContainer(value: object, callback: () => void) {
    if (this.seen.has(value)) throw new Error('Workspace backup contains a circular reference.');
    this.seen.add(value);
    try {
      callback();
    } finally {
      this.seen.delete(value);
    }
  }
}

export function stringifyBoundedJson(value: unknown): string {
  const text = new BoundedJsonWriter(MAX_WORKSPACE_BACKUP_BYTES).write(value);
  if (new Blob([text]).size > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new Error('Workspace backup exceeds the 25 MB limit.');
  }
  return text;
}

export function parseWorkspaceBackupText(text: string): unknown {
  if (new Blob([text]).size > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new Error('Backup exceeds the 25 MB limit.');
  }
  assertNoDuplicateJsonKeys(text);
  return JSON.parse(text) as unknown;
}

function assertNoDuplicateJsonKeys(text: string) {
  let offset = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[offset] ?? '')) offset++;
  };
  const parseStringToken = () => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') return text.slice(start, offset);
      if (char === '\\') offset++;
    }
    throw new Error('Backup contains invalid JSON.');
  };
  const parseValue = (depth: number): void => {
    if (depth > 100) throw new Error('Backup data is nested too deeply.');
    skipWhitespace();
    const token = text[offset];
    if (token === '{') {
      offset++;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[offset] === '}') { offset++; return; }
      while (offset < text.length) {
        skipWhitespace();
        if (text[offset] !== '"') throw new Error('Backup contains invalid JSON.');
        const key = JSON.parse(parseStringToken()) as string;
        if (keys.has(key)) throw new Error(`Backup contains a duplicate JSON key: ${key}.`);
        keys.add(key);
        skipWhitespace();
        if (text[offset++] !== ':') throw new Error('Backup contains invalid JSON.');
        parseValue(depth + 1);
        skipWhitespace();
        if (text[offset] === '}') { offset++; return; }
        if (text[offset++] !== ',') throw new Error('Backup contains invalid JSON.');
      }
      throw new Error('Backup contains invalid JSON.');
    }
    if (token === '[') {
      offset++;
      skipWhitespace();
      if (text[offset] === ']') { offset++; return; }
      while (offset < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[offset] === ']') { offset++; return; }
        if (text[offset++] !== ',') throw new Error('Backup contains invalid JSON.');
      }
      throw new Error('Backup contains invalid JSON.');
    }
    if (token === '"') {
      parseStringToken();
      return;
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!literal) throw new Error('Backup contains invalid JSON.');
    offset += literal[0].length;
  };
  parseValue(0);
  skipWhitespace();
  if (offset !== text.length) throw new Error('Backup contains invalid JSON.');
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function readPortableAsset(
  src: string,
  origin: string,
  fetchAsset: typeof fetch
): Promise<{ blob: Blob | null; reason: BackupAssetExclusion['reason'] | null }> {
  if (!/^(data:|blob:|https?:\/\/)/i.test(src)) return { blob: null, reason: 'unsupported' };
  if (/^https?:\/\//i.test(src)) {
    try {
      if (new URL(src).origin !== origin) return { blob: null, reason: 'external' };
    } catch {
      return { blob: null, reason: 'unsupported' };
    }
  }
  if (src.startsWith('data:') && src.length > Math.ceil((MAX_PORTABLE_ASSET_BYTES * 4) / 3) + 2048) {
    return { blob: null, reason: 'size-limit' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchAsset(src, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return { blob: null, reason: 'unavailable' };
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PORTABLE_ASSET_BYTES) {
      return { blob: null, reason: 'size-limit' };
    }
    let blob: Blob;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: ArrayBuffer[] = [];
      let byteLength = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          byteLength += value.byteLength;
          if (byteLength > MAX_PORTABLE_ASSET_BYTES) {
            await reader.cancel();
            return { blob: null, reason: 'size-limit' };
          }
          const copy = new Uint8Array(value.byteLength);
          copy.set(value);
          chunks.push(copy.buffer);
        }
      } finally {
        reader.releaseLock();
      }
      blob = new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
    } else {
      blob = await response.blob();
      if (blob.size > MAX_PORTABLE_ASSET_BYTES) return { blob: null, reason: 'size-limit' };
    }
    if (!/^(image|video)\//i.test(blob.type)) return { blob: null, reason: 'unsupported' };
    return { blob, reason: null };
  } catch {
    return { blob: null, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

export async function createWorkspaceBackup(
  liveSnapshot: TLEditorSnapshot,
  options: {
    origin?: string;
    fetchAsset?: typeof fetch;
    resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  } = {}
): Promise<{ blob: Blob; portability: WorkspaceBackupV2['portability'] }> {
  const sourceText = stringifyBoundedJson(liveSnapshot);
  const snapshot = JSON.parse(sourceText) as TLEditorSnapshot;
  const store = snapshot.document?.store as unknown as Record<string, Record<string, unknown>>;
  const origin = options.origin ?? (typeof location === 'undefined' ? '' : location.origin);
  const fetchAsset = options.fetchAsset ?? fetch;
  const excludedAssets: BackupAssetExclusion[] = [];
  const exclusions = [
    'AI chat history, provider keys, and application preferences are not included. App virtual storage is included in the workspace snapshot.',
  ];
  let embeddedAssetCount = 0;
  let embeddedBytes = 0;
  for (const [recordKey, record] of Object.entries(store)) {
    if (record.typeName !== 'asset' || !isObject(record.props) || typeof record.props.src !== 'string') continue;
    if (record.type !== 'image' && record.type !== 'video') continue;
    let src = record.props.src;
    if (src.startsWith('asset:')) {
      if (!options.resolveAssetUrl) {
        excludedAssets.push({ id: recordKey, reason: 'unsupported' });
        continue;
      }
      try {
        // Tldraw stores local asset IDs in snapshots. Resolve them via the editor's
        // configured asset store; never fetch an untrusted URL just to export it.
        const resolved = await options.resolveAssetUrl(src);
        if (!resolved) {
          excludedAssets.push({ id: recordKey, reason: 'unavailable' });
          continue;
        }
        src = resolved;
      } catch {
        excludedAssets.push({ id: recordKey, reason: 'unavailable' });
        continue;
      }
    }
    const result = await readPortableAsset(src, origin, fetchAsset);
    if (!result.blob) {
      excludedAssets.push({ id: recordKey, reason: result.reason ?? 'unavailable' });
      continue;
    }
    if (embeddedBytes + result.blob.size > MAX_PORTABLE_ASSET_BYTES) {
      excludedAssets.push({ id: recordKey, reason: 'size-limit' });
      continue;
    }
    record.props.src = await toDataUrl(result.blob);
    embeddedBytes += result.blob.size;
    embeddedAssetCount++;
  }
  if (excludedAssets.length) {
    exclusions.push('Some linked assets were not embedded; see portability.excludedAssets for asset IDs and reasons.');
  }
  const portability = { embeddedAssetCount, excludedAssets, exclusions };
  const payload: WorkspaceBackupV2 = {
    format: 'visionos-backup',
    version: 2,
    createdAt: new Date().toISOString(),
    snapshot,
    portability,
  };
  const text = stringifyBoundedJson(payload);
  const blob = new Blob([text], { type: 'application/json' });
  if (blob.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('Workspace backup exceeds the 25 MB limit.');
  return { blob, portability };
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Durable browser recovery storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECOVERY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
        request.result.createObjectStore(RECOVERY_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open durable recovery storage.'));
    request.onblocked = () => reject(new Error('Durable recovery storage is blocked by another tab.'));
  });
}

export async function saveDurableRecoveryCopy(snapshot: TLEditorSnapshot): Promise<void> {
  const db = await openRecoveryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(RECOVERY_STORE_NAME, 'readwrite');
      transaction.objectStore(RECOVERY_STORE_NAME).put({
        key: RECOVERY_KEY,
        savedAt: new Date().toISOString(),
        snapshot,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Could not save the recovery copy.'));
      transaction.onabort = () => reject(new Error('Could not save the recovery copy.'));
    });
  } finally {
    db.close();
  }
}

export async function readDurableRecoveryCopy(): Promise<unknown | null> {
  const db = await openRecoveryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(RECOVERY_STORE_NAME, 'readonly');
      const request = transaction.objectStore(RECOVERY_STORE_NAME).get(RECOVERY_KEY);
      request.onsuccess = () => resolve(isObject(request.result) ? request.result.snapshot ?? null : null);
      request.onerror = () => reject(new Error('Could not read the durable recovery copy.'));
    });
  } finally {
    db.close();
  }
}

export async function hasDurableRecoveryCopy(): Promise<boolean> {
  const snapshot = await readDurableRecoveryCopy();
  return snapshot !== null;
}
