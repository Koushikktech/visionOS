import { artifactSourceFingerprint } from './artifactStoragePersistence';
import {
  ARTIFACT_NETWORK_LIMITS,
  normalizeArtifactNetworkOrigin,
} from './artifactNetworkPolicy';

const STORAGE_KEY = 'visionos_artifact_network_grants_v1';
const CHANNEL_NAME = 'visionos-artifact-network-permissions-v1';
export const ARTIFACT_NETWORK_PERMISSION_LIMITS = {
  maxApps: 32,
  maxSerializedBytes: 1_000_000,
} as const;
export const ARTIFACT_NETWORK_REVIEW_REQUEST_EVENT = 'visionos:request-artifact-network-review';

function isValidReviewShapeId(shapeId: unknown): shapeId is string {
  return typeof shapeId === 'string' && shapeId.length > 0 && shapeId.length <= 512 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(shapeId);
}

/** Request review of one app's existing permissions; this never grants access. */
export function requestArtifactNetworkReview(shapeId: string): void {
  if (!isValidReviewShapeId(shapeId) || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ARTIFACT_NETWORK_REVIEW_REQUEST_EVENT, { detail: { shapeId } }));
}

export function subscribeToArtifactNetworkReview(shapeId: string, handler: () => void): () => void {
  if (!isValidReviewShapeId(shapeId) || typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ shapeId?: unknown }>).detail;
    if (detail?.shapeId === shapeId) handler();
  };
  window.addEventListener(ARTIFACT_NETWORK_REVIEW_REQUEST_EVENT, listener);
  return () => window.removeEventListener(ARTIFACT_NETWORK_REVIEW_REQUEST_EVENT, listener);
}

export type ArtifactNetworkGrantIdentity = {
  workspaceKey: string;
  epoch: number;
  shapeId: string;
  /** Lowercase SHA-256 hex of the exact source; raw source is never persisted. */
  sourceFingerprint: string;
};

export type ArtifactNetworkGrantIdentityInput = {
  workspaceKey: string;
  epoch: number;
  shapeId: string;
  source: string;
};

export type ArtifactNetworkGrantAppIdentity = Pick<
  ArtifactNetworkGrantIdentity,
  'workspaceKey' | 'epoch' | 'shapeId'
>;

export type ArtifactNetworkPermissionRead =
  | { status: 'available'; origins: string[]; peerConnections: boolean }
  | { status: 'unavailable' }
  | { status: 'invalid' };

export type ArtifactNetworkPermissionWrite =
  | { status: 'saved' }
  | { status: 'already-saved' }
  | { status: 'removed' }
  | { status: 'not-found' }
  | { status: 'limit' }
  | { status: 'unavailable' }
  | { status: 'invalid' };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StoredAppGrant = ArtifactNetworkGrantIdentity & { origins: string[]; peerConnections: boolean };
type StoredGrantStore = { version: 1; apps: StoredAppGrant[] };
export type ArtifactNetworkPermissionInvalidation =
  | { workspaceKey: string; epoch: number; shapeId: string; sourceFingerprint: string; origin: string }
  | { workspaceKey: string; epoch: number; shapeId: string; sourceFingerprint: string; feature: 'peer-to-peer' }
  | { workspaceKey: string; epoch: number; shapeId: string; scope: 'app' };

export type ArtifactNetworkSessionPermissions = {
  origins: string[];
  peerConnections: boolean;
};

const sessionGrants = new Map<string, StoredAppGrant>();
const invalidationListeners = new Set<(invalidation: ArtifactNetworkPermissionInvalidation) => void>();
let permissionChannel: BroadcastChannel | null = null;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isValidIdentity(identity: ArtifactNetworkGrantIdentity): boolean {
  return isValidAppIdentity(identity) &&
    typeof identity.sourceFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(identity.sourceFingerprint);
}

function isValidAppIdentity(identity: ArtifactNetworkGrantAppIdentity): boolean {
  return Boolean(
    identity &&
    typeof identity.workspaceKey === 'string' &&
    identity.workspaceKey.length > 0 &&
    identity.workspaceKey.length <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(identity.workspaceKey) &&
    Number.isSafeInteger(identity.epoch) &&
    identity.epoch >= 0 &&
    typeof identity.shapeId === 'string' &&
    identity.shapeId.length > 0 &&
    identity.shapeId.length <= 512 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(identity.shapeId)
  );
}

function sameIdentity(a: ArtifactNetworkGrantIdentity, b: ArtifactNetworkGrantIdentity): boolean {
  return a.workspaceKey === b.workspaceKey &&
    a.epoch === b.epoch &&
    a.shapeId === b.shapeId &&
    a.sourceFingerprint === b.sourceFingerprint;
}

function appScopeKey(identity: ArtifactNetworkGrantAppIdentity): string {
  return JSON.stringify([identity.workspaceKey, identity.epoch, identity.shapeId]);
}

function identityKey(identity: ArtifactNetworkGrantIdentity): string {
  return JSON.stringify([
    identity.workspaceKey,
    identity.epoch,
    identity.shapeId,
    identity.sourceFingerprint,
  ]);
}

function clearSessionForInvalidation(invalidation: ArtifactNetworkPermissionInvalidation) {
  if ('feature' in invalidation) {
    forgetArtifactNetworkSessionPeerConnections(invalidation);
    return;
  }
  if ('origin' in invalidation) {
    forgetArtifactNetworkSessionSite(invalidation, invalidation.origin);
    return;
  }
  clearArtifactNetworkSessionGrantsForApp(invalidation);
}

function deliverInvalidation(invalidation: ArtifactNetworkPermissionInvalidation) {
  clearSessionForInvalidation(invalidation);
  for (const listener of invalidationListeners) listener(invalidation);
}

function ensurePermissionChannel() {
  if (typeof BroadcastChannel === 'undefined' || permissionChannel) return;
  try {
    permissionChannel = new BroadcastChannel(CHANNEL_NAME);
    permissionChannel.onmessage = (event: MessageEvent<unknown>) => {
      if (isValidInvalidation(event.data)) deliverInvalidation(event.data);
    };
  } catch {
    permissionChannel = null;
  }
}

function notifyInvalidation(invalidation: ArtifactNetworkPermissionInvalidation) {
  clearSessionForInvalidation(invalidation);
  try {
    if (typeof window !== 'undefined') {
      ensurePermissionChannel();
      permissionChannel?.postMessage(invalidation);
    } else {
      for (const listener of invalidationListeners) listener(invalidation);
    }
  } catch {
    // Same-tab policy is already updated; cross-tab notification is best effort.
  }
}

function isValidInvalidation(value: unknown): value is ArtifactNetworkPermissionInvalidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.workspaceKey !== 'string' ||
    typeof candidate.epoch !== 'number' ||
    !Number.isSafeInteger(candidate.epoch) ||
    typeof candidate.shapeId !== 'string'
  ) return false;
  if (candidate.scope === 'app') {
    return isValidAppIdentity({
      workspaceKey: candidate.workspaceKey,
      epoch: candidate.epoch,
      shapeId: candidate.shapeId,
    });
  }
  if (candidate.feature === 'peer-to-peer') {
    return typeof candidate.sourceFingerprint === 'string' &&
      /^[0-9a-f]{64}$/.test(candidate.sourceFingerprint) &&
      isValidAppIdentity({
        workspaceKey: candidate.workspaceKey,
        epoch: candidate.epoch,
        shapeId: candidate.shapeId,
      });
  }
  return typeof candidate.sourceFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.sourceFingerprint) &&
    normalizeArtifactNetworkOrigin(candidate.origin) === candidate.origin &&
    isValidAppIdentity({
      workspaceKey: candidate.workspaceKey,
      epoch: candidate.epoch,
      shapeId: candidate.shapeId,
    });
}

function invalidationsFromStoreChange(oldValue: string | null, newValue: string | null) {
  const oldStore = oldValue ? validateSerializedStore(oldValue) : { version: 1 as const, apps: [] };
  const newStore = newValue ? validateSerializedStore(newValue) : { version: 1 as const, apps: [] };
  if (!oldStore || !newStore) return;
  for (const previous of oldStore.apps) {
    const next = newStore.apps.find((entry) => sameIdentity(entry, previous));
    for (const origin of previous.origins) {
      if (!next?.origins.includes(origin)) {
        deliverInvalidation({ ...previous, origin });
      }
    }
    if (previous.peerConnections && !next?.peerConnections) {
      deliverInvalidation({
        workspaceKey: previous.workspaceKey,
        epoch: previous.epoch,
        shapeId: previous.shapeId,
        sourceFingerprint: previous.sourceFingerprint,
        feature: 'peer-to-peer',
      });
    }
  }
}

function getLockManager(): LockManager | null {
  try {
    return typeof navigator === 'undefined' ? null : navigator.locks ?? null;
  } catch {
    return null;
  }
}

function withGrantWriteLock<T>(operation: () => T | Promise<T>): Promise<T | { status: 'unavailable' }> {
  const locks = getLockManager();
  if (!locks) return (async () => await operation())();
  try {
    const request = locks.request<unknown>(STORAGE_KEY, { mode: 'exclusive' }, () => operation());
    return request.then((value) => value as T)
      .catch(() => ({ status: 'unavailable' as const }));
  } catch {
    return Promise.resolve({ status: 'unavailable' });
  }
}

function byteLength(value: string): number | null {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return null;
  }
}

function validateStore(value: unknown): StoredGrantStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<StoredGrantStore>;
  if (candidate.version !== 1 || !Array.isArray(candidate.apps) || candidate.apps.length > ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) {
    return null;
  }

  const apps: StoredAppGrant[] = [];
  for (const entry of candidate.apps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const app = entry as Partial<StoredAppGrant>;
    if (
      typeof app.workspaceKey !== 'string' ||
      typeof app.shapeId !== 'string' ||
      typeof app.sourceFingerprint !== 'string' ||
      typeof app.epoch !== 'number' ||
      !Array.isArray(app.origins) ||
      (app.peerConnections !== undefined && typeof app.peerConnections !== 'boolean')
    ) return null;
    const identity = {
      workspaceKey: app.workspaceKey,
      epoch: app.epoch,
      shapeId: app.shapeId,
      sourceFingerprint: app.sourceFingerprint,
    };
    if (!isValidIdentity(identity) || app.origins.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return null;
    const origins: string[] = [];
    for (const value of app.origins) {
      const origin = normalizeArtifactNetworkOrigin(value);
      if (!origin || origin !== value || origins.includes(origin)) return null;
      origins.push(origin);
    }
    if (apps.some((existing) => sameIdentity(existing, identity))) return null;
    apps.push({ ...identity, origins, peerConnections: app.peerConnections === true });
  }
  return { version: 1, apps };
}

function validateSerializedStore(serialized: string): StoredGrantStore | null {
  try {
    const size = byteLength(serialized);
    if (size === null || size > ARTIFACT_NETWORK_PERMISSION_LIMITS.maxSerializedBytes) return null;
    return validateStore(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

function readStore(storage: StorageLike):
  | { status: 'available'; store: StoredGrantStore }
  | { status: 'unavailable' }
  | { status: 'invalid' } {
  let serialized: string | null;
  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (serialized === null) return { status: 'available', store: { version: 1, apps: [] } };
  const store = validateSerializedStore(serialized);
  return store ? { status: 'available', store } : { status: 'invalid' };
}

function persistStore(storage: StorageLike, store: StoredGrantStore): boolean {
  try {
    const serialized = JSON.stringify(store);
    const size = byteLength(serialized);
    if (size === null || size > ARTIFACT_NETWORK_PERMISSION_LIMITS.maxSerializedBytes) return false;
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Hash exact app source using the same SHA-256 routine as app-storage recovery. */
export async function createArtifactNetworkGrantIdentity(
  input: ArtifactNetworkGrantIdentityInput
): Promise<ArtifactNetworkGrantIdentity | null> {
  if (
    !input ||
    typeof input.source !== 'string' ||
    typeof input.workspaceKey !== 'string' ||
    typeof input.epoch !== 'number' ||
    typeof input.shapeId !== 'string'
  ) return null;
  try {
    const identity = {
      workspaceKey: input.workspaceKey,
      epoch: input.epoch,
      shapeId: input.shapeId,
      sourceFingerprint: await artifactSourceFingerprint(input.source),
    };
    return isValidIdentity(identity) ? identity : null;
  } catch {
    return null;
  }
}

/** Read remembered exact-site grants. Unavailable or invalid storage grants nothing. */
export function readArtifactNetworkGrants(
  identity: ArtifactNetworkGrantIdentity,
  storage?: StorageLike | null
): ArtifactNetworkPermissionRead {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  const result = readStore(resolved);
  if (result.status !== 'available') return { status: result.status };
  const app = result.store.apps.find((entry) => sameIdentity(entry, identity));
  return {
    status: 'available',
    origins: app ? [...app.origins] : [],
    peerConnections: app?.peerConnections === true,
  };
}

/** Persist a remembered grant only in host localStorage, never board/backup data. */
export async function rememberArtifactNetworkGrant(
  identity: ArtifactNetworkGrantIdentity,
  originValue: unknown,
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const origin = normalizeArtifactNetworkOrigin(originValue);
  if (!origin) return { status: 'invalid' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const store = result.store;
    let app = store.apps.find((entry) => sameIdentity(entry, identity));
    if (!app) {
      if (store.apps.length >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
      app = { ...identity, origins: [], peerConnections: false };
      store.apps.push(app);
    }
    if (app.origins.includes(origin)) return { status: 'already-saved' };
    if (app.origins.length >= ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
    app.origins.push(origin);
    if (!persistStore(resolved, store)) return { status: 'unavailable' };
    return { status: 'saved' };
  });
}

/** Persist a reviewed set of sites atomically under one cross-tab lock. */
export async function rememberArtifactNetworkGrants(
  identity: ArtifactNetworkGrantIdentity,
  originValues: readonly unknown[],
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (!isValidIdentity(identity) || !Array.isArray(originValues)) return { status: 'invalid' };
  const origins = originValues.map(normalizeArtifactNetworkOrigin);
  if (origins.some((origin) => !origin)) return { status: 'invalid' };
  const normalized = [...new Set(origins as string[])];
  if (normalized.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const store = result.store;
    let app = store.apps.find((entry) => sameIdentity(entry, identity));
    if (!app) {
      if (store.apps.length >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
      app = { ...identity, origins: [], peerConnections: false };
      store.apps.push(app);
    }
    const nextOrigins = [...new Set([...app.origins, ...normalized])];
    if (nextOrigins.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
    if (nextOrigins.length === app.origins.length) return { status: 'already-saved' };
    app.origins = nextOrigins;
    if (!persistStore(resolved, store)) return { status: 'unavailable' };
    return { status: 'saved' };
  });
}

/** Save a reviewed site set and optional peer feature in one locked write. */
export async function rememberArtifactNetworkChoices(
  identity: ArtifactNetworkGrantIdentity,
  choices: { origins: readonly unknown[]; peerConnections: boolean },
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (
    !isValidIdentity(identity) ||
    !choices ||
    !Array.isArray(choices.origins) ||
    typeof choices.peerConnections !== 'boolean'
  ) return { status: 'invalid' };
  const normalizedValues = choices.origins.map(normalizeArtifactNetworkOrigin);
  if (normalizedValues.some((origin) => !origin)) return { status: 'invalid' };
  const origins = [...new Set(normalizedValues as string[])];
  if (origins.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const store = result.store;
    let app = store.apps.find((entry) => sameIdentity(entry, identity));
    if (!app) {
      if (!origins.length && !choices.peerConnections) return { status: 'already-saved' };
      if (store.apps.length >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
      app = { ...identity, origins: [], peerConnections: false };
      store.apps.push(app);
    }
    const nextOrigins = [...new Set([...app.origins, ...origins])];
    if (nextOrigins.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
    const changed = nextOrigins.length !== app.origins.length ||
      (choices.peerConnections && !app.peerConnections);
    if (!changed) return { status: 'already-saved' };
    app.origins = nextOrigins;
    if (choices.peerConnections) app.peerConnections = true;
    if (!persistStore(resolved, store)) return { status: 'unavailable' };
    return { status: 'saved' };
  });
}

/** Persist the separate, source-bound peer-to-peer feature choice. */
export async function setArtifactNetworkPeerConnections(
  identity: ArtifactNetworkGrantIdentity,
  allowed: boolean,
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (!isValidIdentity(identity) || typeof allowed !== 'boolean') return { status: 'invalid' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const store = result.store;
    let app = store.apps.find((entry) => sameIdentity(entry, identity));
    if (allowed) {
      if (app?.peerConnections) return { status: 'already-saved' };
      if (!app) {
        if (store.apps.length >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
        app = { ...identity, origins: [], peerConnections: false };
        store.apps.push(app);
      }
      app.peerConnections = true;
    } else {
      if (!app?.peerConnections) return { status: 'not-found' };
      app.peerConnections = false;
      if (app.origins.length === 0) store.apps.splice(store.apps.indexOf(app), 1);
    }
    if (store.apps.length === 0) {
      try {
        resolved.removeItem(STORAGE_KEY);
      } catch {
        return { status: 'unavailable' };
      }
    } else if (!persistStore(resolved, store)) {
      return { status: 'unavailable' };
    }
    if (!allowed) notifyInvalidation({ ...identity, feature: 'peer-to-peer' });
    return { status: 'saved' };
  });
}

/** Remove one remembered site grant, or leave unrelated app grants intact. */
export async function forgetArtifactNetworkGrant(
  identity: ArtifactNetworkGrantIdentity,
  originValue: unknown,
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const origin = normalizeArtifactNetworkOrigin(originValue);
  if (!origin) return { status: 'invalid' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const appIndex = result.store.apps.findIndex((entry) => sameIdentity(entry, identity));
    if (appIndex < 0) return { status: 'not-found' };
    const app = result.store.apps[appIndex];
    const originIndex = app.origins.indexOf(origin);
    if (originIndex < 0) return { status: 'not-found' };
    app.origins.splice(originIndex, 1);
    if (app.origins.length === 0) result.store.apps.splice(appIndex, 1);
    if (result.store.apps.length === 0) {
      try {
        resolved.removeItem(STORAGE_KEY);
      } catch {
        return { status: 'unavailable' };
      }
    } else if (!persistStore(resolved, result.store)) {
      return { status: 'unavailable' };
    }
    notifyInvalidation({ ...identity, origin });
    return { status: 'removed' };
  });
}

/**
 * Clear every remembered source version for one app identity. Call this after
 * a committed source edit when an undo to older source must not revive grants.
 */
export async function clearArtifactNetworkGrantsForApp(
  identity: ArtifactNetworkGrantAppIdentity,
  storage?: StorageLike | null
): Promise<ArtifactNetworkPermissionWrite> {
  if (!isValidAppIdentity(identity)) return { status: 'invalid' };
  const resolved = resolveStorage(storage);
  if (!resolved) return { status: 'unavailable' };
  return withGrantWriteLock(() => {
    const result = readStore(resolved);
    if (result.status !== 'available') return { status: result.status };
    const retained = result.store.apps.filter((entry) =>
      entry.workspaceKey !== identity.workspaceKey ||
      entry.epoch !== identity.epoch ||
      entry.shapeId !== identity.shapeId
    );
    const sessionKey = appScopeKey(identity);
    for (const [key, entry] of sessionGrants) {
      if (appScopeKey(entry) === sessionKey) sessionGrants.delete(key);
    }
    if (retained.length === result.store.apps.length) {
      notifyInvalidation({ ...identity, scope: 'app' });
      return { status: 'not-found' };
    }
    if (retained.length === 0) {
      try {
        resolved.removeItem(STORAGE_KEY);
      } catch {
        return { status: 'unavailable' };
      }
    } else if (!persistStore(resolved, { version: 1, apps: retained })) {
      return { status: 'unavailable' };
    }
    notifyInvalidation({ ...identity, scope: 'app' });
    return { status: 'removed' };
  });
}

/** Session grants are host-memory only and are not shared across tabs or saved. */
export function readArtifactNetworkSessionGrants(identity: ArtifactNetworkGrantIdentity): string[] {
  if (!isValidIdentity(identity)) return [];
  return [...(sessionGrants.get(identityKey(identity))?.origins ?? [])];
}

export function readArtifactNetworkSessionPermissions(
  identity: ArtifactNetworkGrantIdentity
): ArtifactNetworkSessionPermissions {
  if (!isValidIdentity(identity)) return { origins: [], peerConnections: false };
  const app = sessionGrants.get(identityKey(identity));
  return { origins: [...(app?.origins ?? [])], peerConnections: app?.peerConnections === true };
}

export function grantArtifactNetworkSessionSite(
  identity: ArtifactNetworkGrantIdentity,
  originValue: unknown
): ArtifactNetworkPermissionWrite {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const origin = normalizeArtifactNetworkOrigin(originValue);
  if (!origin) return { status: 'invalid' };
  const key = identityKey(identity);
  let app = sessionGrants.get(key);
  if (!app) {
    if (sessionGrants.size >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
    app = { ...identity, origins: [], peerConnections: false };
    sessionGrants.set(key, app);
  }
  if (app.origins.includes(origin)) return { status: 'already-saved' };
  if (app.origins.length >= ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
  app.origins.push(origin);
  return { status: 'saved' };
}

export function grantArtifactNetworkSessionSites(
  identity: ArtifactNetworkGrantIdentity,
  originValues: readonly unknown[]
): ArtifactNetworkPermissionWrite {
  if (!isValidIdentity(identity) || !Array.isArray(originValues)) return { status: 'invalid' };
  const origins = originValues.map(normalizeArtifactNetworkOrigin);
  if (origins.some((origin) => !origin)) return { status: 'invalid' };
  const normalized = [...new Set(origins as string[])];
  if (normalized.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
  const key = identityKey(identity);
  let app = sessionGrants.get(key);
  if (!app && normalized.length === 0) return { status: 'already-saved' };
  if (!app && sessionGrants.size >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
  const nextOrigins = [...new Set([...(app?.origins ?? []), ...normalized])];
  if (nextOrigins.length > ARTIFACT_NETWORK_LIMITS.maxSitesPerApp) return { status: 'limit' };
  if (app && nextOrigins.length === app.origins.length) return { status: 'already-saved' };
  if (!app) {
    app = { ...identity, origins: [], peerConnections: false };
    sessionGrants.set(key, app);
  }
  app.origins = nextOrigins;
  return { status: 'saved' };
}

export function grantArtifactNetworkSessionPeerConnections(
  identity: ArtifactNetworkGrantIdentity
): ArtifactNetworkPermissionWrite {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const key = identityKey(identity);
  let app = sessionGrants.get(key);
  if (app?.peerConnections) return { status: 'already-saved' };
  if (!app && sessionGrants.size >= ARTIFACT_NETWORK_PERMISSION_LIMITS.maxApps) return { status: 'limit' };
  if (!app) {
    app = { ...identity, origins: [], peerConnections: false };
    sessionGrants.set(key, app);
  }
  app.peerConnections = true;
  return { status: 'saved' };
}

export function forgetArtifactNetworkSessionPeerConnections(
  identity: ArtifactNetworkGrantIdentity
): ArtifactNetworkPermissionWrite {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const key = identityKey(identity);
  const app = sessionGrants.get(key);
  if (!app?.peerConnections) return { status: 'not-found' };
  app.peerConnections = false;
  if (app.origins.length === 0 && !app.peerConnections) sessionGrants.delete(key);
  return { status: 'removed' };
}

export function forgetArtifactNetworkSessionSite(
  identity: ArtifactNetworkGrantIdentity,
  originValue: unknown
): ArtifactNetworkPermissionWrite {
  if (!isValidIdentity(identity)) return { status: 'invalid' };
  const origin = normalizeArtifactNetworkOrigin(originValue);
  if (!origin) return { status: 'invalid' };
  const key = identityKey(identity);
  const app = sessionGrants.get(key);
  const index = app?.origins.indexOf(origin) ?? -1;
  if (!app || index < 0) return { status: 'not-found' };
  app.origins.splice(index, 1);
  if (app.origins.length === 0 && !app.peerConnections) sessionGrants.delete(key);
  return { status: 'removed' };
}

export function clearArtifactNetworkSessionGrantsForApp(identity: ArtifactNetworkGrantAppIdentity) {
  if (!isValidAppIdentity(identity)) return;
  const scope = appScopeKey(identity);
  for (const [key, app] of sessionGrants) {
    if (appScopeKey(app) === scope) sessionGrants.delete(key);
  }
}

/** Subscribe to revocations only; grants made in another tab are never auto-applied. */
export function subscribeArtifactNetworkPermissionInvalidations(
  listener: (invalidation: ArtifactNetworkPermissionInvalidation) => void
): () => void {
  invalidationListeners.add(listener);
  if (typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) invalidationsFromStoreChange(event.oldValue, event.newValue);
    };
    window.addEventListener('storage', onStorage);
    ensurePermissionChannel();
    return () => {
      invalidationListeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }
  return () => invalidationListeners.delete(listener);
}
