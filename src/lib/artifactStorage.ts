export const ARTIFACT_STORAGE_LIMITS = {
  maxEntries: 500,
  maxKeyLength: 512,
  maxValueLength: 250_000,
  maxSerializedLength: 1_000_000,
} as const;

export type StorageValidation =
  | { status: 'accepted'; storage: Record<string, string> }
  | { status: 'ignored' }
  | {
      status: 'rejected';
      reason: 'invalid' | 'too-many-keys' | 'too-large';
    };

function validateSnapshot(value: unknown): StorageValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'rejected', reason: 'invalid' };
  }

  try {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > ARTIFACT_STORAGE_LIMITS.maxEntries) {
      return { status: 'rejected', reason: 'too-many-keys' };
    }

    const storage: Record<string, string> = Object.create(null);
    for (const [key, item] of entries) {
      if (
        key.length > ARTIFACT_STORAGE_LIMITS.maxKeyLength ||
        typeof item !== 'string'
      ) {
        return { status: 'rejected', reason: 'invalid' };
      }
      if (item.length > ARTIFACT_STORAGE_LIMITS.maxValueLength) {
        return { status: 'rejected', reason: 'too-large' };
      }
      storage[key] = item;
    }

    // Bound the serialized representation too, including JSON escaping overhead.
    const serializedLength = JSON.stringify(storage).length;
    if (serializedLength > ARTIFACT_STORAGE_LIMITS.maxSerializedLength) {
      return { status: 'rejected', reason: 'too-large' };
    }
    return { status: 'accepted', storage };
  } catch {
    return { status: 'rejected', reason: 'invalid' };
  }
}

/** Validate untrusted persisted snapshots before embedding them in a runtime. */
export function validateStorageSnapshot(value: unknown): StorageValidation {
  return validateSnapshot(value);
}

/**
 * Opaque sandbox origins report "null"; bind trust to the iframe window
 * instead. Unrelated messages and messages from any other window are ignored.
 */
export function validateStorageMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  id: string,
  expectedFrameToken?: string
): StorageValidation {
  if (
    !expectedSource ||
    source !== expectedSource ||
    !data ||
    typeof data !== 'object'
  ) {
    return { status: 'ignored' };
  }

  const message = data as Record<string, unknown>;
  if (
    (message.type !== 'VISIONOS_STORAGE_SYNC' &&
      message.type !== 'CANVASOS_STORAGE_SYNC') ||
    message.shapeId !== id ||
    (expectedFrameToken !== undefined && message.frameToken !== expectedFrameToken)
  ) {
    return { status: 'ignored' };
  }

  return validateSnapshot(message.storage);
}

/** Backward-compatible convenience helper used by existing callers/tests. */
export function readStorageMessage(
  data: unknown,
  source: unknown,
  expectedSource: unknown,
  id: string
): Record<string, string> | null {
  const result = validateStorageMessage(data, source, expectedSource, id);
  return result.status === 'accepted' ? result.storage : null;
}

export function storageRejectionMessage(
  reason: 'invalid' | 'too-many-keys' | 'too-large'
): string {
  if (reason === 'too-many-keys') {
    return `App data was not accepted by the workspace. Storage is limited to ${ARTIFACT_STORAGE_LIMITS.maxEntries} keys.`;
  }
  if (reason === 'too-large') {
    return 'App data was not accepted by the workspace. Storage is limited to 1 MB; existing workspace data was kept.';
  }
  return 'App data was not accepted because the storage update was invalid; existing workspace data was kept.';
}
