export type StorageReadResult = {
  available: boolean;
  value: string | null;
};

function read(storageName: 'localStorage' | 'sessionStorage', key: string): StorageReadResult {
  try {
    if (typeof window === 'undefined') return { available: false, value: null };
    return { available: true, value: window[storageName].getItem(key) };
  } catch {
    return { available: false, value: null };
  }
}

function write(
  storageName: 'localStorage' | 'sessionStorage',
  key: string,
  value: string
): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window[storageName].setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storageName: 'localStorage' | 'sessionStorage', key: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window[storageName].removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const readLocalStorage = (key: string) => read('localStorage', key);
export const readSessionStorage = (key: string) => read('sessionStorage', key);
export const writeLocalStorage = (key: string, value: string) => write('localStorage', key, value);
export const writeSessionStorage = (key: string, value: string) => write('sessionStorage', key, value);
export const removeLocalStorage = (key: string) => remove('localStorage', key);
export const removeSessionStorage = (key: string) => remove('sessionStorage', key);
