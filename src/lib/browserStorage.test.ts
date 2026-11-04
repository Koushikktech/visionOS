import { describe, expect, it } from 'bun:test';
import {
  readLocalStorage,
  readSessionStorage,
  removeLocalStorage,
  removeSessionStorage,
  writeLocalStorage,
  writeSessionStorage,
} from './browserStorage';

function withWindow<T>(value: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  });
  try {
    return callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe('safe browser storage access', () => {
  it('reads, writes, and removes local and session values', () => {
    withWindow({ localStorage: memoryStorage(), sessionStorage: memoryStorage() }, () => {
      expect(writeLocalStorage('visionos_test', 'local')).toBe(true);
      expect(writeSessionStorage('visionos_test', 'session')).toBe(true);
      expect(readLocalStorage('visionos_test')).toEqual({ available: true, value: 'local' });
      expect(readSessionStorage('visionos_test')).toEqual({ available: true, value: 'session' });
      expect(removeLocalStorage('visionos_test')).toBe(true);
      expect(removeSessionStorage('visionos_test')).toBe(true);
      expect(readLocalStorage('visionos_test').value).toBeNull();
      expect(readSessionStorage('visionos_test').value).toBeNull();
    });
  });

  it('reports blocked storage without throwing from getters or methods', () => {
    const blocked = {
      getItem() { throw new DOMException('Blocked', 'SecurityError'); },
      setItem() { throw new DOMException('Blocked', 'SecurityError'); },
      removeItem() { throw new DOMException('Blocked', 'SecurityError'); },
    };
    withWindow({ localStorage: blocked, sessionStorage: blocked }, () => {
      expect(readLocalStorage('key')).toEqual({ available: false, value: null });
      expect(readSessionStorage('key')).toEqual({ available: false, value: null });
      expect(writeLocalStorage('key', 'value')).toBe(false);
      expect(writeSessionStorage('key', 'value')).toBe(false);
      expect(removeLocalStorage('key')).toBe(false);
      expect(removeSessionStorage('key')).toBe(false);
    });

    const inaccessibleWindow = {};
    Object.defineProperty(inaccessibleWindow, 'localStorage', {
      get() { throw new DOMException('Blocked', 'SecurityError'); },
    });
    withWindow(inaccessibleWindow, () => {
      expect(readLocalStorage('key')).toEqual({ available: false, value: null });
      expect(writeLocalStorage('key', 'value')).toBe(false);
    });
  });
});
