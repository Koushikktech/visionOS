'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Editor, TLShapeId } from '@tldraw/tldraw';
import type {
  ChatMessage,
  AgentPresenceState,
  MultiAgentPresenceState,
  AISpatialChatRequest,
  SpatialActionFrame,
  SolvedActionPayload,
  SpatialNodeItem,
} from '../types/spatial';
import type { useSpatialWorker } from './useSpatialWorker';
import {
  captureSelectionOrViewportAsImage,
  getSpatialGroundedContext,
  calculateMakeRealPlacement,
  type GroundedSpatialContext,
} from '../lib/spatialVision';
import {
  isCanvasActionIntent,
  isExplicitCanvasMutationCommand,
} from '../lib/ai/prompt';
import { validateAction, assertCompleteHtml, shapeId } from '../lib/ai/actions';
import { compactViewportNeighbor, serializeCanvas } from '../lib/spatialContext';
import { assertCanvasWritable, assertSpatialActionsWritable } from '../lib/canvasWriteGuard';
import {
  readLocalStorage,
  writeLocalStorage,
} from '../lib/browserStorage';
import {
  type KeyPersistenceStatus,
  type KeyProvider,
  persistProviderKeys,
  readProviderKeys,
  readProviderSetupPreferences,
  filterProviderKeys,
} from '../lib/ai/keyStorage';

function persistPreferenceAliases(names: string[], value: string): void {
  for (const name of names) writeLocalStorage(name, value);
}

function cleanHeaderValue(val?: string | null): string {
  if (!val) return '';
  return val.replace(/[^\x20-\x7E]/g, '').trim();
}

function parseKeysList(input: string): string[] {
  if (!input) return [];
  const trimmed = input.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((k) => cleanHeaderValue(String(k)))
          .filter((k) => k.length >= 8);
      }
    } catch {}
  }
  return trimmed
    .split(/[\n,;]+/)
    .map((k) => cleanHeaderValue(k))
    .filter((k) => k.length >= 8);
}

function formatConversationalActionSummary(
  frames: SpatialActionFrame[]
): string {
  const summaries = frames.map((f) => {
    switch (f.op) {
      case 'spawn_artifact':
        return `Created interactive app **${f.title || 'Live Application'}** with persistent storage.`;
      case 'mutate_artifact':
        return `Updated **${f.title || 'App'}** with your requested modifications while preserving saved data.`;
      case 'create_rich_card':
        return `Created note **${f.title || 'Note'}** with formatted markdown.`;
      case 'mutate_rich_card':
        return `Updated note **${f.title || 'Note'}** with refreshed content.`;
      case 'create_code_card':
        return `Generated code module **${f.title || 'Snippet'}** (${f.language || 'text'}).`;
      case 'mutate_code_card':
        return `Updated code module **${f.title || 'Snippet'}**.`;
      case 'create_document':
        return `Drafted document **${f.title || 'Document'}** with structured sections.`;
      case 'mutate_document':
        return `Updated document **${f.title || 'Document'}** with new sections.`;
      case 'create_card':
        return `Created card **${f.title || 'Card'}**.`;
      case 'embed_media':
        return `Embedded media object **${f.title || 'Media'}** into canvas space.`;
      case 'draw_vector':
        return `Added geometric vector shapes to the canvas.`;
      case 'align':
        return `Aligned selected elements cleanly across the canvas layout.`;
      case 'connect':
        return `Connected related shapes with dynamic magnetic connectors.`;
      case 'restyle_shape':
        return `Refined canvas typography, depth elevation, and styling.`;
      case 'repel_colliding':
        return `Resolved overlapping shape collisions using spatial physics.`;
      case 'dock_into':
        return `Docked element into container layout.`;
      default:
        return `Applied ${String(f.op).replace(/_/g, ' ')}.`;
    }
  });
  return summaries.join('\n\n');
}

function formatPrettyActionSummary(f: SpatialActionFrame): string {
  const cleanTarget = (t?: string) => {
    if (!t) return '';
    if (t.includes('app_') || t.includes('artifact')) return 'Live App';
    if (t.includes('card_') || t.includes('rich_card')) return 'Note Card';
    if (t.includes('doc_')) return 'Document';
    if (t.includes('deck_') || t.includes('slide')) return 'Slide Deck';
    if (t.startsWith('shape:')) return 'Element';
    return t.replace(/^[a-z]+:[a-z_]+_?/i, '');
  };

  switch (f.op) {
    case 'focus_viewport':
      return f.title ? `Focus: ${f.title}` : 'Focused Viewport';
    case 'spawn_artifact':
      return `Created App: ${f.title || 'Live Application'}`;
    case 'mutate_artifact':
      return `Updated App: ${f.title || 'Live Application'}`;
    case 'create_rich_card':
      return `Created Note: ${f.title || 'Note'}`;
    case 'mutate_rich_card':
      return `Updated Note: ${f.title || 'Note'}`;
    case 'create_code_card':
      return `Created Code: ${f.title || 'Module'}`;
    case 'mutate_code_card':
      return `Updated Code: ${f.title || 'Module'}`;
    case 'create_document':
      return `Created Doc: ${f.title || 'Document'}`;
    case 'mutate_document':
      return `Updated Doc: ${f.title || 'Document'}`;
    case 'create_card':
      return `Created Card: ${f.title || 'Card'}`;
    case 'align':
      return `Aligned Elements (${f.direction || 'Auto'})`;
    case 'connect':
      return 'Connected Elements';
    case 'restyle_shape':
      return `Restyled: ${f.title || cleanTarget(f.target) || 'Element'}`;
    case 'repel_colliding':
      return 'Resolved Shape Overlaps';
    default: {
      const label = f.title || cleanTarget(f.target) || cleanTarget(f.id);
      return label ? `${f.op.replace(/_/g, ' ')}: ${label}` : f.op.replace(/_/g, ' ');
    }
  }
}

export function useSpatialAI(
  editor: Editor | null,
  spatial: ReturnType<typeof useSpatialWorker>
) {
  const [provider, setProviderState] = useState<'gemini' | 'openrouter' | 'openai'>(
    'gemini'
  );
  const [geminiApiKeys, setGeminiApiKeysState] = useState<string[]>([]);
  const [openRouterApiKeys, setOpenRouterApiKeysState] = useState<string[]>([]);
  const [openAiApiKeys, setOpenAiApiKeysState] = useState<string[]>([]);
  const geminiApiKeysRef = useRef<string[]>([]);
  const openRouterApiKeysRef = useRef<string[]>([]);
  const openAiApiKeysRef = useRef<string[]>([]);
  const [keyPersistenceByProvider, setKeyPersistenceByProvider] = useState<
    Record<KeyProvider, KeyPersistenceStatus>
  >({ gemini: 'persistent', openrouter: 'persistent', openai: 'persistent' });
  const [geminiModel, setGeminiModelState] = useState<string>('gemini-3.8-flash');
  const [openRouterModel, setOpenRouterModelState] =
    useState<string>('openai/gpt-4o');
  const [openAiModel, setOpenAiModelState] = useState<string>('gpt-4o');

  // Thinking & Swarm Settings
  const [thinkingMode, setThinkingModeState] = useState<boolean>(true);
  const [swarmMode, setSwarmModeState] = useState<boolean>(false);
  const [temperature, setTemperatureState] = useState<number>(0.35);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Select elements to edit them together, or describe what you would like to build or design in visionOS.',
      timestamp: Date.now(),
    },
  ]);
  const reportReadonlyAction = useCallback((prompt: string) => {
    const timestamp = Date.now();
    setMessages((prev) => [
      ...prev.slice(-58),
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp,
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'This canvas is read-only. I can answer questions, but cannot make canvas changes.',
        timestamp,
      },
    ]);
  }, []);

  const [isGenerating, setIsGenerating] = useState(false);
  const [agentPresence, setAgentPresence] = useState<AgentPresenceState>({
    isActive: false,
    x: 0,
    y: 0,
    statusText: '',
  });

  const [multiPresences, setMultiPresences] = useState<
    MultiAgentPresenceState[]
  >([]);
  const [isMakingReal, setIsMakingReal] = useState<boolean>(false);
  const [groundedContext, setGroundedContext] =
    useState<GroundedSpatialContext>({
      selectedCount: 0,
      selectedShapes: [],
      visibleCount: 0,
      zoom: 1,
      zoomFormatted: '1.0x',
      center: { x: 0, y: 0 },
      viewportBounds: { x: 0, y: 0, w: 0, h: 0 },
      totalShapesCount: 0,
    });

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load preferences on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const readLocal = (name: string) => {
        return readLocalStorage(name).value;
      };

      const setupPreferences = readProviderSetupPreferences();
      const savedProvider = setupPreferences.provider as
        | 'gemini'
        | 'openrouter'
        | 'openai'
        | null;
      if (savedProvider === 'gemini' || savedProvider === 'openrouter' || savedProvider === 'openai') {
        setProviderState(savedProvider);
      }

      const restoredGemini = readProviderKeys('gemini');
      const restoredGeminiKeys = restoredGemini.keys;
      geminiApiKeysRef.current = restoredGeminiKeys;
      setGeminiApiKeysState(restoredGeminiKeys);

      const restoredOpenRouter = readProviderKeys('openrouter');
      const restoredOpenRouterKeys = restoredOpenRouter.keys;
      openRouterApiKeysRef.current = restoredOpenRouterKeys;
      setOpenRouterApiKeysState(restoredOpenRouterKeys);

      const restoredOpenAi = readProviderKeys('openai');
      const restoredOpenAiKeys = restoredOpenAi.keys;
      openAiApiKeysRef.current = restoredOpenAiKeys;
      setOpenAiApiKeysState(restoredOpenAiKeys);

      setKeyPersistenceByProvider({
        gemini: restoredGemini.status,
        openrouter: restoredOpenRouter.status,
        openai: restoredOpenAi.status,
      });

      const savedGeminiModel =
        setupPreferences.models.gemini;
      if (
        savedGeminiModel &&
        savedGeminiModel !== 'gemini' &&
        savedGeminiModel !== 'default'
      ) {
        setGeminiModelState(savedGeminiModel);
      } else {
        setGeminiModelState('gemini-3.8-flash');
      }

      const savedOpenAiModel =
        setupPreferences.models.openai;
      if (savedOpenAiModel) setOpenAiModelState(savedOpenAiModel);

      const savedOpenRouterModel =
        setupPreferences.models.openrouter;
      if (savedOpenRouterModel) setOpenRouterModelState(savedOpenRouterModel);

      const savedThinking =
        readLocal('visionos_thinking_mode') ??
        readLocal('canvasos_thinking_mode');
      if (savedThinking !== null)
        setThinkingModeState(savedThinking === 'true');

      const savedSwarm =
        readLocal('visionos_swarm_mode') ??
        readLocal('canvasos_swarm_mode');
      if (savedSwarm !== null) setSwarmModeState(savedSwarm === 'true');

      const savedTemp =
        readLocal('visionos_temperature') ??
        readLocal('canvasos_temperature');
      if (savedTemp) setTemperatureState(Number(savedTemp));
    }
  }, []);

  // Shared setup hands off credentials locally, including when browser storage is blocked.
  // Refresh state without issuing a request or re-persisting a removed key.
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !['gemini', 'openrouter', 'openai'].includes(detail.provider)) return;
      const provider = detail.provider as KeyProvider;
      const restored = readProviderKeys(provider);
      const keys = Array.isArray(detail.keys)
        ? filterProviderKeys(provider, detail.keys.filter((key: unknown): key is string => typeof key === 'string'))
        : restored.keys;
      if (provider === 'gemini') {
        geminiApiKeysRef.current = keys;
        setGeminiApiKeysState(keys);
        if (typeof detail.model === 'string') setGeminiModelState(detail.model);
      } else if (provider === 'openrouter') {
        openRouterApiKeysRef.current = keys;
        setOpenRouterApiKeysState(keys);
        if (typeof detail.model === 'string') setOpenRouterModelState(detail.model);
      } else {
        openAiApiKeysRef.current = keys;
        setOpenAiApiKeysState(keys);
        if (typeof detail.model === 'string') setOpenAiModelState(detail.model);
      }
      setProviderState(provider);
      setKeyPersistenceByProvider((previous) => ({ ...previous, [provider]: detail.persistenceStatus ?? restored.status }));
    };
    window.addEventListener('visionos:provider-saved', refresh);
    return () => window.removeEventListener('visionos:provider-saved', refresh);
  }, []);

  const setProvider = useCallback((newProvider: 'gemini' | 'openrouter' | 'openai') => {
    setProviderState(newProvider);
    persistPreferenceAliases(
      ['visionos_ai_provider', 'canvasos_ai_provider'],
      newProvider
    );
  }, []);

  const setThinkingMode = useCallback((val: boolean) => {
    setThinkingModeState(val);
    persistPreferenceAliases(
      ['visionos_thinking_mode', 'canvasos_thinking_mode'],
      String(val)
    );
  }, []);

  const setSwarmMode = useCallback((val: boolean) => {
    setSwarmModeState(val);
    persistPreferenceAliases(
      ['visionos_swarm_mode', 'canvasos_swarm_mode'],
      String(val)
    );
  }, []);

  const setTemperature = useCallback((val: number) => {
    setTemperatureState(val);
    persistPreferenceAliases(
      ['visionos_temperature', 'canvasos_temperature'],
      String(val)
    );
  }, []);

  const persistKeysAndSetStatus = useCallback((provider: KeyProvider, keys: string[]) => {
    const persistence = persistProviderKeys(provider, keys);
    const status = persistence.persistent
      ? 'persistent'
      : persistence.session
        ? 'session'
        : 'memory';
    setKeyPersistenceByProvider((previous) => ({
      ...previous,
      [provider]: status,
    }));
  }, []);

  const setGeminiKeys = useCallback((keys: string[]) => {
    const cleaned = keys
      .map((k) => cleanHeaderValue(k))
      .filter((k) => k.length >= 8);
    geminiApiKeysRef.current = cleaned;
    setGeminiApiKeysState(cleaned);
    persistKeysAndSetStatus('gemini', cleaned);
  }, [persistKeysAndSetStatus]);

  const addGeminiKey = useCallback((rawKey: string) => {
    const newKeys = parseKeysList(rawKey);
    if (newKeys.length === 0) return;
    const merged = Array.from(new Set([...geminiApiKeysRef.current, ...newKeys]));
    geminiApiKeysRef.current = merged;
    setGeminiApiKeysState(merged);
    persistKeysAndSetStatus('gemini', merged);
    setProviderState('gemini');
    persistPreferenceAliases(
      ['visionos_ai_provider', 'canvasos_ai_provider'],
      'gemini'
    );
  }, [persistKeysAndSetStatus]);

  const removeGeminiKey = useCallback((keyToRemove: string) => {
    const filtered = geminiApiKeysRef.current.filter((key) => key !== keyToRemove);
    geminiApiKeysRef.current = filtered;
    setGeminiApiKeysState(filtered);
    persistKeysAndSetStatus('gemini', filtered);
  }, [persistKeysAndSetStatus]);

  const saveGeminiKey = useCallback(
    (key: string) => {
      addGeminiKey(key);
    },
    [addGeminiKey]
  );

  const setOpenRouterKeys = useCallback((keys: string[]) => {
    const cleaned = keys
      .map((k) => cleanHeaderValue(k))
      .filter((k) => k.length >= 8);
    openRouterApiKeysRef.current = cleaned;
    setOpenRouterApiKeysState(cleaned);
    persistKeysAndSetStatus('openrouter', cleaned);
  }, [persistKeysAndSetStatus]);

  const addOpenRouterKey = useCallback((rawKey: string) => {
    const newKeys = parseKeysList(rawKey);
    if (newKeys.length === 0) return;
    const merged = Array.from(new Set([...openRouterApiKeysRef.current, ...newKeys]));
    openRouterApiKeysRef.current = merged;
    setOpenRouterApiKeysState(merged);
    persistKeysAndSetStatus('openrouter', merged);
  }, [persistKeysAndSetStatus]);

  const removeOpenRouterKey = useCallback((keyToRemove: string) => {
    const filtered = openRouterApiKeysRef.current.filter((key) => key !== keyToRemove);
    openRouterApiKeysRef.current = filtered;
    setOpenRouterApiKeysState(filtered);
    persistKeysAndSetStatus('openrouter', filtered);
  }, [persistKeysAndSetStatus]);

  const saveOpenRouterKey = useCallback(
    (key: string) => {
      addOpenRouterKey(key);
    },
    [addOpenRouterKey]
  );

  const setGeminiModel = useCallback((model: string) => {
    const cleaned = cleanHeaderValue(model);
    const target =
      !cleaned || cleaned === 'gemini' || cleaned === 'default'
        ? 'gemini-3.8-flash'
        : cleaned;
    setGeminiModelState(target);
    persistPreferenceAliases(['visionos_gemini_model', 'canvasos_gemini_model'], target);
  }, []);

  const setOpenRouterModel = useCallback((model: string) => {
    const cleaned = cleanHeaderValue(model);
    setOpenRouterModelState(cleaned);
    persistPreferenceAliases(
      ['visionos_openrouter_model', 'canvasos_openrouter_model'],
      cleaned
    );
  }, []);

  const setOpenAiKeys = useCallback((keys: string[]) => {
    const cleaned = filterProviderKeys('openai', keys.map(cleanHeaderValue));
    openAiApiKeysRef.current = cleaned;
    setOpenAiApiKeysState(cleaned);
    persistKeysAndSetStatus('openai', cleaned);
  }, [persistKeysAndSetStatus]);

  const addOpenAiKey = useCallback((rawKey: string) => {
    const newKeys = parseKeysList(rawKey);
    if (newKeys.length === 0) return;
    const merged = filterProviderKeys('openai', Array.from(new Set([...openAiApiKeysRef.current, ...newKeys])));
    openAiApiKeysRef.current = merged;
    setOpenAiApiKeysState(merged);
    persistKeysAndSetStatus('openai', merged);
  }, [persistKeysAndSetStatus]);

  const removeOpenAiKey = useCallback((keyToRemove: string) => {
    const filtered = openAiApiKeysRef.current.filter((key) => key !== keyToRemove);
    openAiApiKeysRef.current = filtered;
    setOpenAiApiKeysState(filtered);
    persistKeysAndSetStatus('openai', filtered);
  }, [persistKeysAndSetStatus]);

  const saveOpenAiKey = useCallback(
    (key: string) => {
      addOpenAiKey(key);
    },
    [addOpenAiKey]
  );

  const setOpenAiModel = useCallback((model: string) => {
    const cleaned = cleanHeaderValue(model);
    const target = !cleaned ? 'gpt-4o' : cleaned;
    setOpenAiModelState(target);
    persistPreferenceAliases(['visionos_openai_model', 'canvasos_openai_model'], target);
  }, []);

  const activeModel =
    provider === 'openrouter'
      ? openRouterModel
      : provider === 'openai'
        ? openAiModel
        : geminiModel;
  const keyPersistenceStatus = keyPersistenceByProvider[provider];
  const keyPersistenceAvailable = keyPersistenceStatus === 'persistent';
  const geminiKeyPersistenceStatus = keyPersistenceByProvider.gemini;
  const geminiApiKey = geminiApiKeys[0] || '';
  const openRouterApiKey = openRouterApiKeys[0] || '';
  const openAiApiKey = openAiApiKeys[0] || '';
  const activeApiKey =
    provider === 'openrouter'
      ? openRouterApiKey
      : provider === 'openai'
        ? openAiApiKey
        : geminiApiKey;
  const hasActiveKey =
    provider === 'openrouter'
      ? openRouterApiKeys.length > 0
      : provider === 'openai'
        ? openAiApiKeys.length > 0
        : geminiApiKeys.length > 0;

  const busyRef = useRef(false);
  const contextHistoryRef = useRef(new Map<string, string>());
  const [storageWarning, setStorageWarning] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => {
    try {
      const current = readLocalStorage('visionos_chat_v2');
      const legacy = current.value === null || current.value === ''
        ? readLocalStorage('canvasos_chat_v2')
        : { available: true, value: null };
      if (!current.available || !legacy.available)
        setStorageWarning('Chat could not be restored because browser storage is unavailable.');
      const saved = JSON.parse(current.value ?? legacy.value ?? 'null');
      if (Array.isArray(saved) && saved.length)
        setMessages(
          saved
            .filter(
              (m) =>
                m &&
                ['user', 'assistant'].includes(m.role) &&
                typeof m.content === 'string' &&
                typeof m.id === 'string' &&
                m.content.length <= 120000
            )
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: Number(m.timestamp) || Date.now(),
              isStreaming: false,
              executedActions: Array.isArray(m.executedActions)
                ? m.executedActions
                    .filter(
                      (a: any) =>
                        a &&
                        typeof a.actionSummary === 'string' &&
                        a.rawFrame &&
                        typeof a.rawFrame.op === 'string'
                    )
                    .slice(0, 100)
                : [],
            }))
            .slice(-60)
        );
    } catch {
      console.warn('[VisionOS] Could not restore chat.');
    }
    setHistoryLoaded(true);
  }, []);
  useEffect(() => {
    if (!historyLoaded || isGenerating || isMakingReal) return;
    try {
      const serialized = JSON.stringify(
        messages.slice(-60).map(({ thought, ...m }) => ({
          ...m,
          executedActions: m.executedActions?.slice(0, 100),
        }))
      );
      const currentSaved = writeLocalStorage('visionos_chat_v2', serialized);
      const legacySaved = writeLocalStorage('canvasos_chat_v2', serialized);
      if (!currentSaved || !legacySaved)
        throw new Error('Chat storage unavailable.');
    } catch {
      try {
        const compact = JSON.stringify(
          messages.slice(-60).map(({ thought, ...m }) => ({
            ...m,
            executedActions: m.executedActions?.map((a) => ({
              ...a,
              rawFrame: {
                t: 'patch',
                op: a.op,
                id: a.rawFrame?.id,
                target: a.rawFrame?.target,
                title: a.rawFrame?.title,
              },
            })),
          }))
        );
        const currentSaved = writeLocalStorage('visionos_chat_v2', compact);
        const legacySaved = writeLocalStorage('canvasos_chat_v2', compact);
        if (!currentSaved || !legacySaved)
          throw new Error('Chat storage unavailable.');
      } catch {
        setStorageWarning(
          'Chat could not be saved. Export this conversation before closing.'
        );
      }
    }
  }, [messages, historyLoaded, isGenerating, isMakingReal]);
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => setGroundedContext(getSpatialGroundedContext(editor)),
        80
      );
    };
    setGroundedContext(getSpatialGroundedContext(editor));
    const off = editor.store.listen(update);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [editor]);
  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  const focusOnShape = useCallback(
    (id: string) => {
      if (!editor) return;
      const target = shapeId(id) as TLShapeId;
      if (!editor.getShape(target)) return;
      editor.setSelectedShapes([target]);
      const bounds = editor.getShapePageBounds(target);
      if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 200 } });
    },
    [editor]
  );

  const headers = () => ({ 'Content-Type': 'application/json' });
  const credentials = () => ({
    provider,
    model: activeModel,
    apiKeys: geminiApiKeys,
    openRouterApiKeys,
    openaiApiKeys: openAiApiKeys,
    apiKey: activeApiKey,
    openaiApiKey: openAiApiKey,
    openRouterApiKey,
  });
  const baseline = () =>
    new Map(
      editor!
        .getCurrentPageShapes()
        .map((s) => [
          s.id as string,
          JSON.stringify({ ...s, props: { ...s.props, storage: undefined } }),
        ])
    );
  const checkStale = (
    before: Map<string, string>,
    frames: SpatialActionFrame[]
  ) => {
    const after = baseline();
    for (const f of frames) {
      for (const id of [f.target, f.from, f.to, ...(f.nodeIds || [])].filter(
        Boolean
      ) as string[]) {
        const target = shapeId(id);
        let dependency = target;
        const visited = new Set<string>();
        while (before.has(dependency) && !visited.has(dependency)) {
          visited.add(dependency);
          if (before.get(dependency) !== after.get(dependency))
            throw new Error(
              'A target or its group changed while I was working. Your changes were kept. Retry with the latest canvas.'
            );
          const parent = JSON.parse(before.get(dependency)!).parentId;
          if (typeof parent !== 'string' || !parent.startsWith('shape:')) break;
          dependency = parent;
        }
        if (before.has(target) && before.get(target) !== after.get(target))
          throw new Error(
            'A target was edited or removed while I was working. Your changes were kept. Retry to use the latest canvas.'
          );
      }
    }
  };
  const begin = (prompt: string, making = false) => {
    if (busyRef.current || !editor) return null;
    busyRef.current = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const id = crypto.randomUUID();
    setIsGenerating(true);
    setIsMakingReal(making);
    setMessages((prev) => [
      ...prev.slice(-58),
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      },
      {
        id,
        role: 'assistant',
        content: making ? 'Generating complete app source…' : '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);
    return {
      controller,
      id,
      before: baseline(),
      pageId: editor.getCurrentPageId(),
    };
  };
  const patchMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  const finish = () => {
    busyRef.current = false;
    abortControllerRef.current = null;
    setIsGenerating(false);
    setIsMakingReal(false);
    setAgentPresence((p) => ({ ...p, isActive: false }));
    spatial.clearSkeletons();
  };
  const errorText = (error: unknown) =>
    error instanceof Error && error.name === 'AbortError'
      ? 'Stopped. No pending changes were applied.'
      : `⚠️ ${error instanceof Error ? error.message : String(error)}`;
  const commit = async (
    turn: NonNullable<ReturnType<typeof begin>>,
    frames: SpatialActionFrame[],
    transmittedSources: SpatialNodeItem[] = []
  ) => {
    if (!editor) throw new Error('Canvas engine is not ready.');
    assertSpatialActionsWritable(editor, frames);
    turn.controller.signal.throwIfAborted();
    if (editor.getCurrentPageId() !== turn.pageId)
      throw new Error(
        'You switched pages while I was working. Return to the original page and retry.'
      );
    frames.forEach(validateAction);
    checkStale(turn.before, frames);
    if (frames.length)
      await spatial.runSpatialActions(
        frames,
        turn.id,
        turn.controller.signal,
        transmittedSources
      );
    return frames.map(
      (f) =>
        ({
          op: f.op,
          executionTimeMs: 0,
          actionSummary: formatPrettyActionSummary(f),
          rawFrame: {
            ...f,
            code: undefined,
            content: undefined,
            sections: undefined,
            storage: undefined,
          },
        }) as SolvedActionPayload
    );
  };

  const makeReal = useCallback(
    async (customPrompt?: string) => {
      if (!editor) return;
      const prompt =
        customPrompt?.trim() ||
        (editor.getSelectedShapes().some((s) => s.type === 'artifact')
          ? 'Regenerate this app, preserving its functionality and saved data.'
          : 'Turn this sketch into a responsive, working app.');
      if (editor.getIsReadonly()) {
        reportReadonlyAction(prompt);
        return;
      }
      const selected = editor.getSelectedShapes();
      const targets = (
        /\b(all|everything)\b/i.test(prompt)
          ? editor.getCurrentPageShapes()
          : selected
      ).filter((s) => s.type === 'artifact');
      const turn = begin(prompt, true);
      if (!turn) return;
      const transmittedSources = targets.length
        ? serializeCanvas(editor).filter((node) =>
            targets.some((target) => target.id === node.id)
          )
        : [];

      // Speculative Skeleton Streaming: calculate non-overlapping placement coordinates
      // immediately upon summoning using calculateMakeRealPlacement and invoke spatial.addSkeleton
      // BEFORE awaiting the slow /api/ai/make-real fetch.
      try {
        const selectionBounds =
          editor.getSelectionPageBounds() || editor.getViewportPageBounds();
        assertCanvasWritable(editor);
        if (selectionBounds && !targets.length) {
          const existing = editor.getCurrentPageShapes().flatMap((s) => {
            const b = editor.getShapePageBounds(s.id);
            return b ? [b] : [];
          });
          const solved = calculateMakeRealPlacement(
            selectionBounds,
            selected[0]?.id,
            780,
            540,
            existing
          );
          spatial.addSkeleton({
            id: `summon_${turn.id}`,
            title: 'Synthesizing Live App...',
            x: solved.x,
            y: solved.y,
            w: solved.w,
            h: solved.h,
          });
        } else if (targets.length) {
          for (const t of targets) {
            const b = editor.getShapePageBounds(t.id);
            if (b) {
              spatial.addSkeleton({
                id: `summon_${turn.id}_${t.id}`,
                title: `Updating ${(t.props as any)?.title || 'Live App'}...`,
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
              });
            }
          }
        }
      } catch {
        console.warn('[VisionOS] Could not pre-calculate skeleton placement.');
      }

      const timeout = setTimeout(() => turn.controller.abort(), 180000);
      try {
        const frames: SpatialActionFrame[] = [];
        const modelFallbacks = new Set<string>();
        // Existing apps are grounded by source, since iframe pixels cannot be exported by SVG.
        const capture = targets.length
          ? null
          : await captureSelectionOrViewportAsImage(editor, { padding: 36 });
        const inputs = targets.length ? targets : [null];
        for (let i = 0; i < inputs.length; i++) {
          turn.controller.signal.throwIfAborted();
          assertCanvasWritable(editor);
          const target = inputs[i];
          if (
            target &&
            String((target.props as any).code || '').length > 180000
          )
            throw new Error(
              'This app is too large for a safe full replacement. Reduce its source size before regenerating.'
            );
          patchMessage(turn.id, {
            content: `${target ? 'Regenerating' : 'Creating'} app ${i + 1} of ${inputs.length}… You can keep editing; conflicting changes will be protected.`,
          });
          const response = await fetch('/api/ai/make-real', {
            method: 'POST',
            headers: headers(),
            signal: turn.controller.signal,
            body: JSON.stringify({
              ...credentials(),
              prompt,
              image: capture?.dataUrl,
              mimeType: capture?.mimeType,
              existingCode: target ? (target.props as any).code : undefined,
              selectedShapesContext: capture?.shapeSummaries,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(
              data.error || `Generation failed (${response.status}).`
            );
          if (
            typeof data.requestedModel === 'string' &&
            typeof data.selectedModel === 'string' &&
            data.requestedModel !== data.selectedModel
          )
            modelFallbacks.add(
              `${data.selectedModel} (requested ${data.requestedModel} was unavailable)`
            );
          assertCompleteHtml(data.code);
          if (target)
            frames.push({
              t: 'patch',
              op: 'mutate_artifact',
              target: target.id,
              title: data.title,
              code: data.code,
            });
          else {
            const existing = editor.getCurrentPageShapes().flatMap((s) => {
              const b = editor.getShapePageBounds(s.id);
              return b ? [b] : [];
            });
            const placement = calculateMakeRealPlacement(
              capture!.bounds,
              capture!.shapeIds[0],
              data.width || 780,
              data.height || 540,
              existing
            );
            frames.push({
              t: 'patch',
              op: 'spawn_artifact',
              id: `app_${crypto.randomUUID()}`,
              title: data.title,
              code: data.code,
              w: placement.w,
              h: placement.h,
              bounds: {
                x: placement.x,
                y: placement.y,
                w: placement.w,
                h: placement.h,
              },
            });
          }
        }
        const executedActions = await commit(turn, frames, transmittedSources);
        spatial.clearSkeletons();
        const fallbackNotice = modelFallbacks.size
          ? `\n\nFallback model used: ${[...modelFallbacks].join('; ')}.`
          : '';
        patchMessage(turn.id, {
          content: `${targets.length ? 'Regenerated' : 'Created'} ${frames.length} app${frames.length === 1 ? '' : 's'}.${fallbackNotice}`,
          executedActions,
          isStreaming: false,
        });
      } catch (error) {
        spatial.clearSkeletons();
        patchMessage(turn.id, {
          content: errorText(error),
          isStreaming: false,
        });
      } finally {
        clearTimeout(timeout);
        finish();
      }
    },
    [editor, spatial, provider, activeModel, geminiApiKeys, openRouterApiKeys, reportReadonlyAction]
  );

  const sendMessage = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || !editor || busyRef.current) return;
      if (prompt.length > 16000) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Please keep requests under 16,000 characters.',
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (
        editor.getIsReadonly() &&
        isExplicitCanvasMutationCommand(prompt) &&
        isCanvasActionIntent(prompt, editor.getSelectedShapeIds().length > 0)
      ) {
        reportReadonlyAction(prompt);
        return;
      }
      // Only explicit "make real" sketch conversions route to the vision endpoint;
      // conversational redesigns, remakes, and edits flow through the rich streaming chat pipeline.
      if (/^make real\b/i.test(prompt)) {
        await makeReal(prompt);
        return;
      }
      const turn = begin(prompt);
      if (!turn) return;
      const timeout = setTimeout(() => turn.controller.abort(), 180000);
      try {
        const context = spatial.getCulledContextSync();
        const now = new Map(
          (context.boardIndex || []).map((n) => [n.id, JSON.stringify(n)])
        );
        context.recentChanges = [...now]
          .filter(([id, value]) => contextHistoryRef.current.get(id) !== value)
          .map(([id]) => `changed:${id}`)
          .concat(
            [...contextHistoryRef.current.keys()]
              .filter((id) => !now.has(id))
              .map((id) => `removed:${id}`)
          )
          .slice(0, 60);
        contextHistoryRef.current = now;
        context.selectedNodes = context.selectedNodes.map(
          ({ storage, ...n }) => n
        );
        const fullSourceSize = JSON.stringify(context.selectedNodes).length;
        if (fullSourceSize > 180000)
          throw new Error(
            'The selection is too large for a safe full-content edit. Select fewer elements.'
          );
        // Nearby objects only need previews; board index retains geometry for offscreen references.
        context.viewportNeighbors = context.viewportNeighbors.map(compactViewportNeighbor);
        const recentEntities = messages
          .flatMap((m) => m.executedActions || [])
          .slice(-20)
          .reverse()
          .map((a) => ({
            id: a.rawFrame.target || a.rawFrame.id || '',
            type: a.op,
            title: a.rawFrame.title,
          }))
          .filter((a) => a.id);
        const history = [
          ...messages
            .filter((m) => m.id !== 'welcome' && !m.isStreaming)
            .map(({ role, content }) => ({ role, content })),
          { role: 'user' as const, content: prompt },
        ];
        let budget = 28000;
        const boundedHistory = history
          .reverse()
          .filter((m) => {
            if (budget < m.content.length) return false;
            budget -= m.content.length;
            return true;
          })
          .reverse()
          .slice(-24);
        const grounded = getSpatialGroundedContext(editor);
        let visualSnapshot: AISpatialChatRequest['visualSnapshot'];
        if (
          editor
            .getCurrentPageShapes()
            .some((s) => ['draw', 'geo', 'note', 'text'].includes(s.type))
        ) {
          try {
            const c = await captureSelectionOrViewportAsImage(editor, {
              padding: 24,
              quality: 0.7,
            });
            visualSnapshot = { mimeType: c.mimeType, base64: c.base64 };
          } catch (error) {
            console.warn(
              '[VisionOS] Visual capture unavailable; using structured context.'
            );
          }
        }
        const useSwarm = swarmMode && context.selectedNodes.length === 0;
        const response = await fetch(
          useSwarm ? '/api/ai/swarm' : '/api/ai/chat',
          {
            method: 'POST',
            headers: headers(),
            signal: turn.controller.signal,
            body: JSON.stringify({
              ...credentials(),
              messages: boundedHistory,
              culledContext: context,
              recentEntities,
              thinkingMode,
              temperature,
              interactionMode: 'auto',
              swarmMode,
              visualSnapshot,
              viewportCenter: grounded.center,
              viewportInfo: {
                zoom: grounded.zoom,
                center: grounded.center,
                visibleShapeCount: grounded.visibleCount,
                bounds: grounded.viewportBounds,
              },
            }),
          }
        );
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => null);
          throw new Error(
            data?.error || `Request failed (${response.status}).`
          );
        }
        const requestedModel = response.headers.get('X-Requested-Model') || activeModel;
        const selectedModel = response.headers.get('X-Selected-Model');
        const modelFallbackNotice =
          !useSwarm &&
          selectedModel &&
          requestedModel &&
          selectedModel !== requestedModel
            ? `\n\nFallback model used: ${selectedModel} (requested ${requestedModel} was unavailable).`
            : '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let thought = '';
        const thoughtStartTime = Date.now();
        let completed = false;
        const frames: SpatialActionFrame[] = [];
        const process = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line);
          if (event.t === 'done') completed = true;
          if (event.t === 'error')
            throw new Error(
              event.message || 'The provider could not complete this request.'
            );
          if (event.t === 'thought' && typeof event.chunk === 'string') {
            thought += event.chunk;
            patchMessage(turn.id, {
              thought,
              thoughtDurationMs: Date.now() - thoughtStartTime,
            });
          }
          if (event.t === 'text' && typeof event.chunk === 'string') {
            text += event.chunk;
            patchMessage(turn.id, { content: text });
          }
          if (event.t === 'action' && event.frame) {
            const frame = validateAction(event.frame);
            if (frames.length >= 100)
              throw new Error(
                'Too many actions in one response. Split this request.'
              );
            frames.push(frame);
            setAgentPresence({
              isActive: true,
              x: editor.getViewportScreenCenter().x,
              y: editor.getViewportScreenCenter().y,
              statusText: `Preparing ${frames.length} canvas change${frames.length === 1 ? '' : 's'}`,
            });
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 1000000)
            throw new Error('Provider response is too large.');
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            process(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) process(buffer);
        if (!completed)
          throw new Error(
            'The connection ended before generation completed. No pending changes were applied. Retry.'
          );
        const executedActions = await commit(turn, frames, context.selectedNodes);
        const requestedAction = isCanvasActionIntent(
          prompt,
          context.selectedNodes.length > 0
        );
        let cleanText = text.trim();
        // Remove raw JSON code blocks or tool calls that models may echo in plaintext
        cleanText = cleanText.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '').trim();

        // Always ensure an informative concise summary is provided when actions were executed
        const result = frames.length
          ? (cleanText && cleanText.length > 5 ? cleanText : formatConversationalActionSummary(frames))
          : requestedAction
            ? `${cleanText ? cleanText + '\n\n' : ''}No canvas changes were returned. Select the target and retry with a specific edit.`
            : cleanText ||
              'The model returned an empty response. Please retry.';
        patchMessage(turn.id, {
          content: `${result}${modelFallbackNotice}`,
          isStreaming: false,
          executedActions,
        });
      } catch (error) {
        patchMessage(turn.id, {
          content: errorText(error),
          isStreaming: false,
        });
      } finally {
        clearTimeout(timeout);
        finish();
      }
    },
    [
      editor,
      spatial,
      messages,
      provider,
      activeModel,
      geminiApiKeys,
      openRouterApiKeys,
      thinkingMode,
      temperature,
      swarmMode,
      makeReal,
      reportReadonlyAction,
    ]
  );
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    spatial.clearSkeletons();
  }, [spatial]);
  const clearChat = useCallback(() => {
    if (busyRef.current) return;
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Select something on the canvas or tell me what to create.',
        timestamp: Date.now(),
      },
    ]);
    contextHistoryRef.current.clear();
    spatial.clearSkeletons();
  }, [spatial]);
  const exportConversationMarkdown = useCallback(
    () =>
      messages.map((m) => `### ${m.role}\n\n${m.content}`).join('\n\n---\n\n'),
    [messages]
  );
  return {
    storageWarning,
    keyPersistenceAvailable,
    keyPersistenceStatus,
    geminiKeyPersistenceStatus,
    messages,
    isGenerating,
    isMakingReal,
    agentPresence,
    multiPresences,
    provider,
    setProvider,
    geminiApiKey,
    geminiApiKeys,
    openRouterApiKey,
    openRouterApiKeys,
    openAiApiKey,
    openAiApiKeys,
    geminiModel,
    openRouterModel,
    openAiModel,
    setGeminiModel,
    setOpenRouterModel,
    setOpenAiModel,
    setGeminiKeys,
    addGeminiKey,
    removeGeminiKey,
    saveGeminiKey,
    setOpenRouterKeys,
    addOpenRouterKey,
    removeOpenRouterKey,
    saveOpenRouterKey,
    setOpenAiKeys,
    addOpenAiKey,
    removeOpenAiKey,
    saveOpenAiKey,
    thinkingMode,
    setThinkingMode,
    swarmMode,
    setSwarmMode,
    temperature,
    setTemperature,
    activeModel,
    hasActiveKey,
    apiKey: activeApiKey,
    saveApiKey: (key: string) =>
      provider === 'openrouter'
        ? saveOpenRouterKey(key)
        : provider === 'openai'
          ? saveOpenAiKey(key)
          : saveGeminiKey(key),
    sendMessage,
    stopGeneration,
    clearChat,
    exportConversationMarkdown,
    focusOnShape,
    groundedContext,
    makeReal,
  };
}
