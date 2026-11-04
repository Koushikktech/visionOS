import { describe, expect, it } from 'bun:test';
import {
  ARTIFACT_STORAGE_LIMITS,
  readStorageMessage,
  storageRejectionMessage,
  validateStorageMessage,
  validateStorageSnapshot,
} from './artifactStorage';

describe('artifact storage message validation', () => {
  const source = {};
  const validMessage = {
    type: 'VISIONOS_STORAGE_SYNC',
    shapeId: 'shape:app',
    frameToken: 'frame:new',
    storage: { theme: 'dark', count: '4' },
  };

  it('accepts only messages from the owning iframe and matching shape', () => {
    expect(validateStorageMessage(validMessage, {}, source, 'shape:app')).toEqual({
      status: 'ignored',
    });
    expect(validateStorageMessage(validMessage, source, source, 'shape:other')).toEqual({
      status: 'ignored',
    });
    expect(validateStorageMessage(validMessage, source, source, 'shape:app')).toEqual({
      status: 'accepted',
      storage: { theme: 'dark', count: '4' },
    });
    expect(validateStorageMessage(validMessage, source, source, 'shape:app', 'frame:old'))
      .toEqual({ status: 'ignored' });
    expect(validateStorageMessage(validMessage, source, source, 'shape:app', 'frame:new'))
      .toEqual({ status: 'accepted', storage: { theme: 'dark', count: '4' } });
    expect(readStorageMessage(validMessage, source, source, 'shape:app')).toEqual({
      theme: 'dark',
      count: '4',
    });
  });

  it('rejects invalid values, long keys, too many entries, and oversized snapshots with reasons', () => {
    const invalidValue = validateStorageSnapshot({ count: 4 });
    expect(invalidValue.status === 'rejected' ? invalidValue.reason : null).toBe(
      'invalid'
    );
    expect(
      validateStorageSnapshot({ ['k'.repeat(ARTIFACT_STORAGE_LIMITS.maxKeyLength + 1)]: 'v' })
    ).toEqual({ status: 'rejected', reason: 'invalid' });

    const tooMany: Record<string, string> = {};
    for (let i = 0; i <= ARTIFACT_STORAGE_LIMITS.maxEntries; i++) tooMany[`key${i}`] = 'x';
    expect(validateStorageSnapshot(tooMany)).toEqual({
      status: 'rejected',
      reason: 'too-many-keys',
    });

    expect(
      validateStorageSnapshot({ large: 'x'.repeat(ARTIFACT_STORAGE_LIMITS.maxValueLength + 1) })
    ).toEqual({ status: 'rejected', reason: 'too-large' });
    expect(storageRejectionMessage('too-large')).toContain('1 MB');
    expect(storageRejectionMessage('too-many-keys')).toContain('500 keys');
  });

  it('retains special property names as ordinary keys without changing the prototype', () => {
    const storage = Object.create(null) as Record<string, string>;
    storage.__proto__ = 'data';
    Object.defineProperty(storage, 'constructor', {
      value: 'also data',
      enumerable: true,
      writable: true,
    });
    const result = validateStorageSnapshot(storage);
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(Object.getPrototypeOf(result.storage)).toBeNull();
      expect(result.storage.__proto__).toBe('data');
      expect(result.storage.constructor).toBe('also data');
    }
  });
});
