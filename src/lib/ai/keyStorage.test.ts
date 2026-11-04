import { describe, expect, it } from 'bun:test';
import {
  persistProviderSetupPreferences,
  persistProviderKeys,
  readProviderKeys,
  readProviderSetupPreferences,
} from './keyStorage';

function withWindow<T>(value: unknown, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  try {
    return callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

function memoryStorage(setItemOverride?: (key: string, value: string) => void): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => {
      if (setItemOverride) setItemOverride(key, String(value));
      values.set(key, String(value));
    },
  };
}

describe('provider key aliases', () => {
  it('writes and clears every provider alias in local and session storage', () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    withWindow({ localStorage, sessionStorage }, () => {
      expect(persistProviderKeys('gemini', ['gemini-user-key-123']).status).toBe('persistent');
      expect(localStorage.getItem('visionos_gemini_api_keys')).toBe('["gemini-user-key-123"]');
      expect(localStorage.getItem('canvasos_gemini_api_key')).toBe('gemini-user-key-123');
      expect(sessionStorage.getItem('visionos_gemini_api_keys')).toBe('["gemini-user-key-123"]');

      persistProviderKeys('gemini', []);
      expect(localStorage.getItem('visionos_gemini_api_keys')).toBe('[]');
      expect(localStorage.getItem('canvasos_gemini_api_key')).toBe('');
      expect(sessionStorage.getItem('visionos_gemini_api_keys')).toBe('[]');
      expect(sessionStorage.getItem('canvasos_gemini_api_keys')).toBe('[]');
      expect(readProviderKeys('gemini')).toEqual({ keys: [], status: 'persistent' });

      persistProviderKeys('openrouter', ['openrouter-user-key-456']);
      expect(localStorage.getItem('visionos_openrouter_api_keys')).toBe('["openrouter-user-key-456"]');
      expect(sessionStorage.getItem('canvasos_openrouter_api_key')).toBe('openrouter-user-key-456');
    });
  });

  it('loads session aliases when local storage is blocked and reports session status', () => {
    const blockedLocal = {
      getItem() { throw new DOMException('Blocked', 'SecurityError'); },
      setItem() { throw new DOMException('Blocked', 'SecurityError'); },
    } as unknown as Storage;
    const sessionStorage = memoryStorage();
    sessionStorage.setItem('visionos_gemini_api_keys', '["gemini-session-key-123"]');

    withWindow({ localStorage: blockedLocal, sessionStorage }, () => {
      expect(readProviderKeys('gemini')).toEqual({
        keys: ['gemini-session-key-123'],
        status: 'session',
      });
      expect(persistProviderKeys('gemini', ['gemini-session-key-789']).status).toBe('session');
      expect(sessionStorage.getItem('canvasos_gemini_api_keys')).toBe('["gemini-session-key-789"]');
    });
  });

  it('reports memory-only state when neither browser store can save keys', () => {
    const blocked = {
      getItem() { throw new DOMException('Blocked', 'SecurityError'); },
      setItem() { throw new DOMException('Blocked', 'SecurityError'); },
    } as unknown as Storage;
    withWindow({ localStorage: blocked, sessionStorage: blocked }, () => {
      expect(persistProviderKeys('openrouter', ['openrouter-user-key-456']).status).toBe('memory');
      expect(readProviderKeys('openrouter')).toEqual({
        keys: ['openrouter-user-key-456'],
        status: 'memory',
      });
      persistProviderKeys('openrouter', []);
      expect(readProviderKeys('openrouter')).toEqual({ keys: [], status: 'memory' });
    });
  });

  it('keeps provider and model preferences available for the current page when storage is blocked', () => {
    const blocked = {
      getItem() { throw new DOMException('Blocked', 'SecurityError'); },
      setItem() { throw new DOMException('Blocked', 'SecurityError'); },
    } as unknown as Storage;
    withWindow({ localStorage: blocked, sessionStorage: blocked }, () => {
      persistProviderSetupPreferences('openrouter', 'anthropic/claude-example');
      expect(readProviderSetupPreferences()).toEqual({
        provider: 'openrouter',
        models: {
          gemini: undefined,
          openrouter: 'anthropic/claude-example',
          openai: undefined,
        },
      });
    });
  });

  it('removes legacy OAuth and test tokens from every alias while retaining mixed API keys', () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const oauthToken = 'legacy-oauth-access-token-123';
    const fakeToken = 'CHATGPT_SUB_fake_123';
    const firstApiKey = 'sk-proj-genuine-key-111';
    const secondApiKey = 'genuine-openai-key-222';
    const listAliases = ['visionos_openai_api_keys', 'canvasos_openai_api_keys'];
    const singleAliases = ['visionos_openai_api_key', 'canvasos_openai_api_key'];
    const aliases = [localStorage, sessionStorage];

    localStorage.setItem('visionos_chatgpt_account', JSON.stringify({
      type: 'oauth', token: oauthToken, refreshToken: 'legacy-refresh-token-123',
    }));
    localStorage.setItem('visionos_chatgpt_oauth_token', oauthToken);
    localStorage.setItem('visionos_pkce_code_verifier', 'legacy-verifier');
    localStorage.setItem('visionos_pkce_state', 'legacy-state');

    // The old aliases can disagree after interrupted writes. Cleanup keeps all
    // genuine keys found in either list and writes the sanitized list everywhere.
    localStorage.setItem(listAliases[0], JSON.stringify([fakeToken, firstApiKey]));
    localStorage.setItem(listAliases[1], JSON.stringify([oauthToken, secondApiKey]));
    sessionStorage.setItem(listAliases[0], JSON.stringify([oauthToken, firstApiKey]));
    sessionStorage.setItem(listAliases[1], JSON.stringify([fakeToken, secondApiKey]));
    for (const storage of aliases) {
      storage.setItem(singleAliases[0], oauthToken);
      storage.setItem(singleAliases[1], fakeToken);
    }

    withWindow({ localStorage, sessionStorage }, () => {
      expect(readProviderKeys('openai')).toEqual({
        keys: [firstApiKey, secondApiKey],
        status: 'persistent',
      });
      for (const storage of aliases) {
        for (const alias of listAliases) {
          expect(storage.getItem(alias)).toBe(JSON.stringify([firstApiKey, secondApiKey]));
        }
        expect(storage.getItem(singleAliases[0])).toBe(firstApiKey);
        expect(storage.getItem(singleAliases[1])).toBe(firstApiKey);
      }
      expect(localStorage.getItem('visionos_chatgpt_account')).toBe(null);
      expect(localStorage.getItem('visionos_chatgpt_oauth_token')).toBe(null);
      expect(localStorage.getItem('visionos_pkce_code_verifier')).toBe(null);
      expect(localStorage.getItem('visionos_pkce_state')).toBe(null);
    });
  });

  it('recovers an API-key account only when key slots have no explicit deletion tombstone', () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const apiKey = 'sk-proj-account-api-key-123';
    localStorage.setItem('visionos_chatgpt_account', JSON.stringify({ type: 'apiKey', token: apiKey }));

    withWindow({ localStorage, sessionStorage }, () => {
      expect(readProviderKeys('openai').keys).toEqual([apiKey]);
      expect(localStorage.getItem('visionos_chatgpt_account')).toBe(null);
      expect(readProviderKeys('openai').keys).toEqual([apiKey]);
    });

    const tombstoneLocal = memoryStorage();
    const tombstoneSession = memoryStorage();
    tombstoneLocal.setItem('visionos_openai_api_keys', '[]');
    tombstoneSession.setItem('visionos_openai_api_keys', '[]');
    const removedOAuth = 'legacy-oauth-deleted-key-123';
    tombstoneLocal.setItem('visionos_chatgpt_account', JSON.stringify({ type: 'oauth', token: removedOAuth }));
    tombstoneLocal.setItem('canvasos_openai_api_keys', JSON.stringify([removedOAuth, apiKey, 'chatgpt_sub_removed_123']));
    tombstoneSession.setItem('canvasos_openai_api_keys', JSON.stringify([removedOAuth, apiKey, 'chatgpt_sub_removed_123']));
    withWindow({ localStorage: tombstoneLocal, sessionStorage: tombstoneSession }, () => {
      expect(readProviderKeys('openai').keys).toEqual([]);
      expect(tombstoneLocal.getItem('canvasos_openai_api_keys')).toBe('[]');
      expect(tombstoneSession.getItem('canvasos_openai_api_keys')).toBe('[]');
      expect(tombstoneLocal.getItem('visionos_chatgpt_account')).toBe(null);
    });
  });

  it('keeps legacy OAuth metadata until every writable alias is sanitized', () => {
    let failOpenAiWrites = false;
    const localStorage = memoryStorage((key) => {
      if (failOpenAiWrites && key.includes('openai_api')) {
        throw new DOMException('Blocked', 'SecurityError');
      }
    });
    const sessionStorage = memoryStorage();
    const oauthToken = 'legacy-oauth-access-token-456';
    const apiKey = 'sk-proj-preserved-key-456';
    localStorage.setItem('visionos_chatgpt_account', JSON.stringify({ type: 'oauth', token: oauthToken }));
    localStorage.setItem('visionos_openai_api_keys', JSON.stringify([oauthToken, apiKey]));
    sessionStorage.setItem('visionos_openai_api_keys', JSON.stringify([oauthToken, apiKey]));

    withWindow({ localStorage, sessionStorage }, () => {
      failOpenAiWrites = true;
      expect(readProviderKeys('openai')).toEqual({ keys: [apiKey], status: 'session' });
      expect(localStorage.getItem('visionos_chatgpt_account')).not.toBe(null);
      expect(localStorage.getItem('visionos_openai_api_keys')).toBe(JSON.stringify([oauthToken, apiKey]));
      expect(sessionStorage.getItem('visionos_openai_api_keys')).toBe(JSON.stringify([apiKey]));

      // Simulate a later load after local storage becomes writable. The durable
      // account token is still available to filter stale aliases before cleanup.
      failOpenAiWrites = false;
      expect(readProviderKeys('openai').keys).toEqual([apiKey]);
      expect(localStorage.getItem('visionos_openai_api_keys')).toBe(JSON.stringify([apiKey]));
      expect(localStorage.getItem('visionos_chatgpt_account')).toBe(null);
      expect(sessionStorage.getItem('visionos_openai_api_keys')).toBe(JSON.stringify([apiKey]));
      expect(readProviderKeys('openai').keys).toEqual([apiKey]);
    });
  });
});
