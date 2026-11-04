'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import {
  persistProviderKeys,
  persistProviderSetupPreferences,
  readProviderKeys,
  readProviderSetupPreferences,
  filterProviderKeys,
  type KeyPersistenceStatus,
  type KeyProvider,
} from '../lib/ai/keyStorage';
import DialogShell from './DialogShell';

export const PROVIDER_SAVED_EVENT = 'visionos:provider-saved';

export interface ProviderSavedDetail {
  provider: KeyProvider;
  model: string;
  keys: string[];
  persistenceStatus: KeyPersistenceStatus;
}

export interface ProviderSetupProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (detail: ProviderSavedDetail) => void;
}

const PROVIDERS: { id: KeyProvider; name: string }[] = [
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'openai', name: 'OpenAI' },
];

const MODEL_DEFAULTS: Record<KeyProvider, string> = {
  gemini: 'gemini-3.8-flash',
  openrouter: 'openai/gpt-4o',
  openai: 'gpt-4o',
};

function readProviderPreference(): KeyProvider {
  return readProviderSetupPreferences().provider ?? 'gemini';
}

function readProviderModel(provider: KeyProvider): string {
  return readProviderSetupPreferences().models[provider] || MODEL_DEFAULTS[provider];
}

function maskKey(key: string): string {
  return key.length <= 10
    ? `${key.slice(0, 3)}••••${key.slice(-2)}`
    : `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

function storageDisclosure(status: KeyPersistenceStatus): string {
  if (status === 'persistent') return 'Keys are stored in this browser when saving succeeds. Any storage fallback is reported after saving.';
  if (status === 'session') {
    return 'Persistent browser storage is unavailable. Keys stay in this tab session and may remain available after a reload; closing the tab ends the session.';
  }
  return 'Browser and session storage are unavailable. Keys stay in memory while this page is open and are lost when you reload or close it.';
}

function notifyProviderSaved(detail: ProviderSavedDetail) {
  if (typeof window === 'undefined') return;
  // The event is local to this page and lets the canvas refresh its own AI hook.
  // Never log this event: it intentionally contains the current key list for memory fallback.
  window.dispatchEvent(new CustomEvent<ProviderSavedDetail>(PROVIDER_SAVED_EVENT, { detail }));
}

export function ProviderSetup({ isOpen, onClose, onSaved }: ProviderSetupProps) {
  const [provider, setProvider] = useState<KeyProvider>(readProviderPreference);
  const [model, setModel] = useState(() => readProviderModel(readProviderPreference()));
  const [keys, setKeys] = useState<string[]>([]);
  const [persistenceStatus, setPersistenceStatus] = useState<KeyPersistenceStatus>('persistent');
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const providerName = useMemo(
    () => PROVIDERS.find((item) => item.id === provider)?.name ?? provider,
    [provider]
  );

  useEffect(() => {
    if (!isOpen) return;
    const nextProvider = readProviderPreference();
    const stored = readProviderKeys(nextProvider);
    setProvider(nextProvider);
    setModel(readProviderModel(nextProvider));
    setKeys(stored.keys);
    setPersistenceStatus(stored.status);
    setKeyDraft('');
    setShowKey(false);
    setFeedback(null);
  }, [isOpen]);

  const emitState = (nextKeys: string[], status: KeyPersistenceStatus, nextProvider = provider, nextModel = model) => {
    const detail: ProviderSavedDetail = {
      provider: nextProvider,
      model: nextModel,
      keys: [...nextKeys],
      persistenceStatus: status,
    };
    notifyProviderSaved(detail);
    return detail;
  };

  const handleProviderChange = (nextProvider: KeyProvider) => {
    setProvider(nextProvider);
    setModel(readProviderModel(nextProvider));
    const stored = readProviderKeys(nextProvider);
    setKeys(stored.keys);
    setPersistenceStatus(stored.status);
    setKeyDraft('');
    setFeedback(null);
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedKey = keyDraft.replace(/[^\x20-\x7E]/g, '').trim();
    if (cleanedKey && cleanedKey.length < 8) {
      setFeedback({ text: 'Enter a key with at least 8 characters, or clear the field to save model settings only.', tone: 'error' });
      return;
    }
    const nextKeys = filterProviderKeys(provider, cleanedKey
      ? Array.from(new Set([...keys, cleanedKey]))
      : [...keys]);
    if (cleanedKey && !nextKeys.includes(cleanedKey)) {
      setFeedback({ text: 'That credential is not supported. Enter an API key to connect this provider.', tone: 'error' });
      return;
    }
    if (nextKeys.length === 0) {
      setFeedback({ text: 'Enter an API key to connect this provider.', tone: 'error' });
      return;
    }

    const persistence = cleanedKey
      ? persistProviderKeys(provider, nextKeys)
      : { ...persistProviderKeys(provider, nextKeys) };
    const status = persistence.status;
    const savedModel = model.trim() || MODEL_DEFAULTS[provider];
    persistProviderSetupPreferences(provider, savedModel);
    setKeys(nextKeys);
    setPersistenceStatus(status);
    setKeyDraft('');

    const detail = emitState(nextKeys, status, provider, savedModel);
    onSaved?.(detail);
    setFeedback({
      text: cleanedKey ? `Key saved for ${providerName}. It was not checked.` : 'Provider settings saved.',
      tone: 'success',
    });
    onClose();
  };

  const handleRemoveKey = (keyToRemove: string) => {
    const nextKeys = filterProviderKeys(provider, keys.filter((key) => key !== keyToRemove));
    const persistence = persistProviderKeys(provider, nextKeys);
    setKeys(nextKeys);
    setPersistenceStatus(persistence.status);
    emitState(nextKeys, persistence.status);
    setFeedback({ text: nextKeys.length ? 'Key removed.' : 'All saved keys for this provider were removed.', tone: 'success' });
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Connect an AI provider"
      description="Connect with an API key. Requests are sent after you submit a prompt."
      className="studio-provider-dialog"
      footer={(
        <>
          <button type="button" className="studio-provider-button" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="studio-provider-form"
            className="studio-provider-button studio-provider-button--primary"
            disabled={!keyDraft.trim() && keys.length === 0}
          >
            <KeyRound size={16} aria-hidden="true" />
            {keyDraft.trim() ? 'Save key' : 'Save settings'}
          </button>
        </>
      )}
    >
      <form id="studio-provider-form" className="studio-provider-setup" onSubmit={handleSave}>
        <label className="studio-provider-field">
          <span className="studio-provider-label">Provider</span>
          <select
            className="studio-provider-select"
            value={provider}
            onChange={(event) => handleProviderChange(event.currentTarget.value as KeyProvider)}
          >
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <details className="studio-provider-model-settings"><summary>Model settings</summary>
        <label className="studio-provider-field">
          <span className="studio-provider-label">Model identifier</span>
          <input
            className="studio-provider-input"
            type="text"
            value={model}
            onChange={(event) => setModel(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="studio-provider-model-hint"
          />
          <span id="studio-provider-model-hint" className="studio-provider-hint">
            Used for requests. Model availability depends on the provider and your account; saving does not check it.
          </span>
        </label>

        </details>

        <label className="studio-provider-field">
          <span className="studio-provider-label">{providerName} API key</span>
          <span className="studio-provider-secret-row">
            <input
              className="studio-provider-input"
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.currentTarget.value)}
              autoComplete="new-password"
              spellCheck={false}
              placeholder="Paste an API key"
              aria-label={`${providerName} API key`}
              aria-describedby="studio-provider-storage-hint studio-provider-storage-status"
            />
            <button
              type="button"
              className="studio-provider-button"
              onClick={() => setShowKey((visible) => !visible)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              aria-pressed={showKey}
            >
              {showKey ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              {showKey ? 'Hide' : 'Show'}
            </button>
          </span>
          <span id="studio-provider-storage-hint" className="studio-provider-hint">
            Saving does not verify the key. No credit or subscription status is inferred.
          </span>
        </label>

        <p id="studio-provider-storage-status" className="studio-provider-hint" role="status" aria-live="polite">
          {storageDisclosure(persistenceStatus)}
        </p>

        {keys.length > 0 && (
          <section className="studio-provider-field" aria-label={`Saved ${providerName} keys`}>
            <h3 className="studio-provider-label">Saved keys</h3>
            <ul className="studio-provider-key-list">
              {keys.map((key) => (
                <li className="studio-provider-key-row" key={key}>
                  <span className="studio-provider-key-mask">{maskKey(key)}</span>
                  <button
                    type="button"
                    className="studio-provider-icon-button"
                    onClick={() => handleRemoveKey(key)}
                    aria-label={`Remove key ending in ${key.slice(-4)}`}
                  >
                    <Trash2 size={17} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="studio-provider-privacy">
          AI requests send your prompt and relevant canvas content through this site&apos;s server to your chosen provider.
        </p>
        {feedback && (
          <p className="studio-provider-status" role={feedback.tone === 'error' ? 'alert' : 'status'} data-tone={feedback.tone}>
            {feedback.text}
          </p>
        )}
      </form>
    </DialogShell>
  );
}

export default ProviderSetup;
