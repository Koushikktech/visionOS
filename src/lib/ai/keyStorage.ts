import {
  readLocalStorage,
  readSessionStorage,
  removeLocalStorage,
  removeSessionStorage,
  writeLocalStorage,
  writeSessionStorage,
} from '../browserStorage';

export type KeyProvider = 'gemini' | 'openrouter' | 'openai';
export type KeyPersistenceStatus = 'persistent' | 'session' | 'memory';

// Used only when both browser storage mechanisms are unavailable. This cache is
// deliberately scoped to the current page lifetime and is never serialized.
const inMemoryProviderKeys = new Map<KeyProvider, string[]>();
const unsupportedLegacyOAuthTokens = new Set<string>();
const inMemoryProviderSelection: {
  provider: KeyProvider | null;
  models: Partial<Record<KeyProvider, string>>;
} = { provider: null, models: {} };

export interface ProviderSetupPreferences {
  provider: KeyProvider | null;
  models: Partial<Record<KeyProvider, string>>;
}

function preferenceAliases(name: string): string[] {
  return [`visionos_${name}`, `canvasos_${name}`];
}

function readPreference(name: string): string | null {
  for (const key of preferenceAliases(name)) {
    const local = readLocalStorage(key);
    if (local.value !== null && local.value !== '') return local.value;
    const session = readSessionStorage(key);
    if (session.value !== null && session.value !== '') return session.value;
  }
  return null;
}

export function persistProviderSetupPreferences(
  provider: KeyProvider,
  model: string
): void {
  const cleanModel = model.replace(/[^\x20-\x7E]/g, '').trim();
  inMemoryProviderSelection.provider = provider;
  inMemoryProviderSelection.models[provider] = cleanModel;
  const preferences = [
    ['ai_provider', provider],
    [`${provider}_model`, cleanModel],
  ] as const;
  for (const [name, value] of preferences) {
    for (const key of preferenceAliases(name)) {
      if (!writeLocalStorage(key, value)) writeSessionStorage(key, value);
    }
  }
}

/** Reads provider/model settings through browser, session, then page-memory fallbacks. */
export function readProviderSetupPreferences(): ProviderSetupPreferences {
  const storedProvider = readPreference('ai_provider');
  const provider = storedProvider === 'gemini' || storedProvider === 'openrouter' || storedProvider === 'openai'
    ? storedProvider
    : inMemoryProviderSelection.provider;
  const models: Partial<Record<KeyProvider, string>> = {};
  for (const candidate of ['gemini', 'openrouter', 'openai'] as const) {
    models[candidate] = readPreference(`${candidate}_model`)
      ?? inMemoryProviderSelection.models[candidate];
  }
  return { provider, models };
}

export function providerKeyStorageNames(provider: KeyProvider) {
  return {
    lists: [`visionos_${provider}_api_keys`, `canvasos_${provider}_api_keys`],
    singles: [`visionos_${provider}_api_key`, `canvasos_${provider}_api_key`],
  };
}

const LEGACY_CHATGPT_ACCOUNT_KEYS = ['visionos_chatgpt_account', 'canvasos_chatgpt_account'];
const LEGACY_CHATGPT_OAUTH_TOKEN_KEYS = ['visionos_chatgpt_oauth_token', 'canvasos_chatgpt_oauth_token'];
const LEGACY_CHATGPT_TRANSIENT_KEYS = [
  ...LEGACY_CHATGPT_ACCOUNT_KEYS,
  ...LEGACY_CHATGPT_OAUTH_TOKEN_KEYS,
  'visionos_pkce_code_verifier',
  'visionos_pkce_state',
  'canvasos_pkce_code_verifier',
  'canvasos_pkce_state',
];

interface LegacyOpenAICredentials {
  oauthTokens: Set<string>;
  apiKeyTokens: string[];
}

/**
 * Read only credential shapes the old ChatGPT OAuth client wrote. Account
 * records explicitly marked apiKey are kept as genuine OpenAI keys; OAuth
 * account/access/refresh tokens are rejected from provider key slots.
 */
function readLegacyOpenAICredentials(): LegacyOpenAICredentials {
  const oauthTokens = new Set(unsupportedLegacyOAuthTokens);
  const apiKeyTokens = new Set<string>();
  const accountValues = new Set<string>();

  for (const key of LEGACY_CHATGPT_ACCOUNT_KEYS) {
    const local = readLocalStorage(key);
    const session = readSessionStorage(key);
    if (local.value) accountValues.add(local.value);
    if (session.value) accountValues.add(session.value);
  }

  for (const raw of accountValues) {
    try {
      const account = JSON.parse(raw) as {
        type?: unknown;
        token?: unknown;
        refreshToken?: unknown;
      };
      if (account.type === 'apiKey' && typeof account.token === 'string') {
        const token = cleanStoredKey(account.token);
        if (token.length >= 8 && !isFakeLegacyToken(token)) apiKeyTokens.add(token);
      }
      if (account.type === 'oauth') {
        if (typeof account.token === 'string') oauthTokens.add(cleanStoredKey(account.token));
        if (typeof account.refreshToken === 'string') oauthTokens.add(cleanStoredKey(account.refreshToken));
      }
    } catch {
      // Malformed legacy account data is removed, but never interpreted as a key.
    }
  }

  for (const key of LEGACY_CHATGPT_OAUTH_TOKEN_KEYS) {
    for (const value of [readLocalStorage(key).value, readSessionStorage(key).value]) {
      const token = cleanStoredKey(value ?? '');
      if (token.length >= 8 && !apiKeyTokens.has(token)) oauthTokens.add(token);
    }
  }

  for (const token of apiKeyTokens) {
    oauthTokens.delete(token);
    unsupportedLegacyOAuthTokens.delete(token);
  }

  for (const token of oauthTokens) {
    if (token) unsupportedLegacyOAuthTokens.add(token);
  }

  return { oauthTokens, apiKeyTokens: [...apiKeyTokens] };
}

function clearLegacyChatGPTStorage(): void {
  for (const key of LEGACY_CHATGPT_TRANSIENT_KEYS) {
    removeLocalStorage(key);
    removeSessionStorage(key);
  }
}

function cleanStoredKey(key: string): string {
  return key.replace(/[^\x20-\x7E]/g, '').trim();
}

/** Filters unsupported legacy OAuth/test credentials without restricting API key formats. */
export function filterProviderKeys(provider: KeyProvider, keys: string[]): string[] {
  const normalized = keys
    .map(cleanStoredKey)
    .filter((key) => key.length >= 8);
  if (provider !== 'openai') return normalized;

  const legacy = readLegacyOpenAICredentials();
  return normalized.filter((key) =>
    !isFakeLegacyToken(key) && !legacy.oauthTokens.has(key)
  );
}

function isFakeLegacyToken(key: string): boolean {
  return key.toLowerCase().startsWith('chatgpt_sub_');
}

function parseKeysList(input: string): string[] {
  if (!input) return [];
  const trimmed = input.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((value): value is string => typeof value === 'string')
          .map(cleanStoredKey)
          .filter((key) => key.length >= 8);
      }
    } catch {}
  }
  return trimmed
    .split(/[\n,;]+/)
    .map(cleanStoredKey)
    .filter((key) => key.length >= 8);
}

export function persistProviderKeys(provider: KeyProvider, keys: string[]) {
  // Snapshot legacy metadata before writing keys so OAuth credentials remain
  // blocked even when a storage API is unavailable or removal is denied.
  const safeKeys = filterProviderKeys(provider, keys);
  const names = providerKeyStorageNames(provider);
  const listValue = JSON.stringify(safeKeys);
  const singleValue = safeKeys[0] || '';
  const values = [
    [names.lists[0], listValue],
    [names.singles[0], singleValue],
    [names.lists[1], listValue],
    [names.singles[1], singleValue],
  ] as const;
  let persistent = true;
  let session = true;
  for (const [name, value] of values) {
    persistent = writeLocalStorage(name, value) && persistent;
    // Keep legacy session aliases in sync so removed keys cannot be restored
    // from an older session value on the next mount.
    session = writeSessionStorage(name, value) && session;
  }
  const status = persistent
    ? 'persistent' as const
    : session
      ? 'session' as const
      : 'memory' as const;
  if (status === 'memory') {
    inMemoryProviderKeys.set(provider, [...safeKeys]);
  } else {
    inMemoryProviderKeys.delete(provider);
  }
  if (provider === 'openai' && persistent && session) clearLegacyChatGPTStorage();
  return {
    persistent,
    session,
    status,
  };
}

export function readProviderKeys(provider: KeyProvider): {
  keys: string[];
  status: KeyPersistenceStatus;
} {
  const legacy = provider === 'openai' ? readLegacyOpenAICredentials() : null;
  const names = providerKeyStorageNames(provider);
  let localAvailable = true;
  let sessionAvailable = true;
  const readMigrated = (name: string): string | null => {
    const local = readLocalStorage(name);
    if (!local.available) localAvailable = false;
    if (local.value !== null) return local.value;
    const session = readSessionStorage(name);
    if (!session.available) sessionAvailable = false;
    if (session.value === null) return null;
    if (!writeLocalStorage(name, session.value)) localAvailable = false;
    return session.value;
  };
  const firstAvailable = (keys: string[]) => {
    for (const key of keys) {
      const value = readMigrated(key);
      if (value !== null) return value;
    }
    return null;
  };
  const savedKeys = firstAvailable(names.lists);
  const legacyKey = savedKeys === null ? firstAvailable(names.singles) : null;
  if (savedKeys === null && legacyKey === null && inMemoryProviderKeys.has(provider)) {
    const memoryKeys = filterProviderKeys(provider, inMemoryProviderKeys.get(provider) ?? []);
    if (memoryKeys.length !== (inMemoryProviderKeys.get(provider) ?? []).length) {
      const persistence = persistProviderKeys(provider, memoryKeys);
      return { keys: memoryKeys, status: persistence.status };
    }
    return { keys: memoryKeys, status: 'memory' };
  }
  const status: KeyPersistenceStatus = localAvailable
    ? 'persistent'
    : sessionAvailable
      ? 'session'
      : 'memory';
  const parsedKeys = parseKeysList(savedKeys ?? legacyKey ?? '');
  if (provider === 'openai' && legacy) {
    const aliasScan = scanOpenAIAliases(names);
    const allAliasKeys = aliasScan.listValues.flatMap(parseKeysList);
    const allSingleKeys = aliasScan.singleValues.flatMap(parseKeysList);
    const containsUnsupported = [...allAliasKeys, ...allSingleKeys].some((key) =>
      isFakeLegacyToken(key) || legacy.oauthTokens.has(key)
    );
    const recoverLegacyApiKey =
      !aliasScan.hasAnyValue && legacy.apiKeyTokens.length > 0;

    if (containsUnsupported || recoverLegacyApiKey) {
      // Merge list aliases only during the one-time cleanup so a genuine key
      // alongside a legacy credential survives in either browser store.
      const hasEmptyPrimaryTombstone = aliasScan.primaryListValue !== null
        && /^\s*\[\s*\]\s*$/.test(aliasScan.primaryListValue);
      const storedCandidates = hasEmptyPrimaryTombstone
        ? []
        : aliasScan.listValues.length > 0
          ? allAliasKeys
          : allSingleKeys;
      const filteredKeys = Array.from(new Set(filterProviderKeys(
        provider,
        [...(recoverLegacyApiKey ? legacy.apiKeyTokens : []), ...storedCandidates]
      )));
      const persistence = persistProviderKeys(provider, filteredKeys);
      return { keys: filteredKeys, status: persistence.status };
    }

    // It is safe to remove stale account/PKCE metadata only after every key
    // alias could be read and none of those aliases contains its OAuth token.
    if (aliasScan.allReadsAvailable) clearLegacyChatGPTStorage();
  }

  const filteredKeys = filterProviderKeys(provider, parsedKeys);
  if (filteredKeys.length !== parsedKeys.length) {
    const persistence = persistProviderKeys(provider, filteredKeys);
    return { keys: filteredKeys, status: persistence.status };
  }
  return { keys: filteredKeys, status };
}

function scanOpenAIAliases(names: ReturnType<typeof providerKeyStorageNames>): {
  listValues: string[];
  singleValues: string[];
  primaryListValue: string | null;
  hasAnyValue: boolean;
  allReadsAvailable: boolean;
} {
  const listValues: string[] = [];
  const singleValues: string[] = [];
  let allReadsAvailable = true;
  let primaryListValue: string | null = null;
  const readAliases = (aliases: string[], values: string[], isList: boolean) => {
    for (const [index, key] of aliases.entries()) {
      const local = readLocalStorage(key);
      const session = readSessionStorage(key);
      allReadsAvailable = allReadsAvailable && local.available && session.available;
      if (isList && index === 0) primaryListValue = local.value ?? session.value;
      if (local.value !== null) values.push(local.value);
      if (session.value !== null) values.push(session.value);
    }
  };
  readAliases(names.lists, listValues, true);
  readAliases(names.singles, singleValues, false);
  return {
    listValues,
    singleValues,
    primaryListValue,
    hasAnyValue: [...listValues, ...singleValues].length > 0,
    allReadsAvailable,
  };
}
