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
} from '../types/spatial';
import type { useSpatialWorker } from './useSpatialWorker';
import {
  captureSelectionOrViewportAsImage,
  getSpatialGroundedContext,
  calculateMakeRealPlacement,
  type GroundedSpatialContext,
} from '../lib/spatialVision';
import { isCanvasActionIntent } from '../lib/ai/prompt';
import { validateAction, assertCompleteHtml, shapeId } from '../lib/ai/actions';

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
  const [provider, setProviderState] = useState<'gemini' | 'openrouter'>(
    'gemini'
  );
  const [geminiApiKeys, setGeminiApiKeysState] = useState<string[]>([]);
  const [openRouterApiKeys, setOpenRouterApiKeysState] = useState<string[]>([]);
  const [geminiModel, setGeminiModelState] = useState<string>('gemini-3.8-flash');
  const [openRouterModel, setOpenRouterModelState] =
    useState<string>('openai/gpt-4o');

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
      const savedProvider = localStorage.getItem('canvasos_ai_provider') as
        'gemini' | 'openrouter' | null;
      if (savedProvider === 'gemini' || savedProvider === 'openrouter') {
        setProviderState(savedProvider);
      }

      // Preserve the existing saved-key behavior. Recover keys from the temporary
      // session-only migration introduced by the previous pass when possible.
      for (const name of [
        'canvasos_gemini_api_keys',
        'canvasos_gemini_api_key',
        'canvasos_openrouter_api_keys',
        'canvasos_openrouter_api_key',
      ]) {
        if (!localStorage.getItem(name)) {
          const temporary = sessionStorage.getItem(name);
          if (temporary) localStorage.setItem(name, temporary);
        }
      }
      // Load saved provider keys
      const savedGeminiKeysJson = localStorage.getItem(
        'canvasos_gemini_api_keys'
      );
      if (savedGeminiKeysJson) {
        const parsed = parseKeysList(savedGeminiKeysJson);
        if (parsed.length > 0) setGeminiApiKeysState(parsed);
      } else {
        const legacyGeminiKey = localStorage.getItem('canvasos_gemini_api_key');
        if (legacyGeminiKey) {
          const parsed = parseKeysList(legacyGeminiKey);
          if (parsed.length > 0) setGeminiApiKeysState(parsed);
        }
      }

      // Load OpenRouter keys
      const savedOpenRouterKeysJson = localStorage.getItem(
        'canvasos_openrouter_api_keys'
      );
      if (savedOpenRouterKeysJson) {
        const parsed = parseKeysList(savedOpenRouterKeysJson);
        if (parsed.length > 0) setOpenRouterApiKeysState(parsed);
      } else {
        const legacyOpenRouterKey = localStorage.getItem(
          'canvasos_openrouter_api_key'
        );
        if (legacyOpenRouterKey) {
          const parsed = parseKeysList(legacyOpenRouterKey);
          if (parsed.length > 0) setOpenRouterApiKeysState(parsed);
        }
      }

      const savedGeminiModel = localStorage.getItem('canvasos_gemini_model');
      if (savedGeminiModel) setGeminiModelState(savedGeminiModel);

      const savedOpenRouterModel = localStorage.getItem(
        'canvasos_openrouter_model'
      );
      if (savedOpenRouterModel) setOpenRouterModelState(savedOpenRouterModel);

      const savedThinking = localStorage.getItem('canvasos_thinking_mode');
      if (savedThinking !== null)
        setThinkingModeState(savedThinking === 'true');

      const savedSwarm = localStorage.getItem('canvasos_swarm_mode');
      if (savedSwarm !== null) setSwarmModeState(savedSwarm === 'true');

      const savedTemp = localStorage.getItem('canvasos_temperature');
      if (savedTemp) setTemperatureState(Number(savedTemp));
    }
  }, []);

  const setProvider = useCallback((newProvider: 'gemini' | 'openrouter') => {
    setProviderState(newProvider);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_ai_provider', newProvider);
    }
  }, []);

  const setThinkingMode = useCallback((val: boolean) => {
    setThinkingModeState(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_thinking_mode', String(val));
    }
  }, []);

  const setSwarmMode = useCallback((val: boolean) => {
    setSwarmModeState(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_swarm_mode', String(val));
    }
  }, []);

  const setTemperature = useCallback((val: number) => {
    setTemperatureState(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_temperature', String(val));
    }
  }, []);

  const setGeminiKeys = useCallback((keys: string[]) => {
    const cleaned = keys
      .map((k) => cleanHeaderValue(k))
      .filter((k) => k.length >= 8);
    setGeminiApiKeysState(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_gemini_api_keys', JSON.stringify(cleaned));
      localStorage.setItem('canvasos_gemini_api_key', cleaned[0] || '');
    }
  }, []);

  const addGeminiKey = useCallback((rawKey: string) => {
    const newKeys = parseKeysList(rawKey);
    if (newKeys.length === 0) return;
    setGeminiApiKeysState((prev) => {
      const merged = Array.from(new Set([...prev, ...newKeys]));
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'canvasos_gemini_api_keys',
          JSON.stringify(merged)
        );
        localStorage.setItem('canvasos_gemini_api_key', merged[0] || '');
      }
      return merged;
    });
  }, []);

  const removeGeminiKey = useCallback((keyToRemove: string) => {
    setGeminiApiKeysState((prev) => {
      const filtered = prev.filter((k) => k !== keyToRemove);
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'canvasos_gemini_api_keys',
          JSON.stringify(filtered)
        );
        localStorage.setItem('canvasos_gemini_api_key', filtered[0] || '');
      }
      return filtered;
    });
  }, []);

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
    setOpenRouterApiKeysState(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'canvasos_openrouter_api_keys',
        JSON.stringify(cleaned)
      );
      localStorage.setItem('canvasos_openrouter_api_key', cleaned[0] || '');
    }
  }, []);

  const addOpenRouterKey = useCallback((rawKey: string) => {
    const newKeys = parseKeysList(rawKey);
    if (newKeys.length === 0) return;
    setOpenRouterApiKeysState((prev) => {
      const merged = Array.from(new Set([...prev, ...newKeys]));
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'canvasos_openrouter_api_keys',
          JSON.stringify(merged)
        );
        localStorage.setItem('canvasos_openrouter_api_key', merged[0] || '');
      }
      return merged;
    });
  }, []);

  const removeOpenRouterKey = useCallback((keyToRemove: string) => {
    setOpenRouterApiKeysState((prev) => {
      const filtered = prev.filter((k) => k !== keyToRemove);
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'canvasos_openrouter_api_keys',
          JSON.stringify(filtered)
        );
        localStorage.setItem('canvasos_openrouter_api_key', filtered[0] || '');
      }
      return filtered;
    });
  }, []);

  const saveOpenRouterKey = useCallback(
    (key: string) => {
      addOpenRouterKey(key);
    },
    [addOpenRouterKey]
  );

  const setGeminiModel = useCallback((model: string) => {
    const cleaned = cleanHeaderValue(model);
    setGeminiModelState(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_gemini_model', cleaned);
    }
  }, []);

  const setOpenRouterModel = useCallback((model: string) => {
    const cleaned = cleanHeaderValue(model);
    setOpenRouterModelState(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('canvasos_openrouter_model', cleaned);
    }
  }, []);

  const activeModel = provider === 'openrouter' ? openRouterModel : geminiModel;
  const geminiApiKey = geminiApiKeys[0] || '';
  const openRouterApiKey = openRouterApiKeys[0] || '';
  const activeApiKey =
    provider === 'openrouter' ? openRouterApiKey : geminiApiKey;
  const hasActiveKey =
    provider === 'openrouter'
      ? openRouterApiKeys.length > 0
      : geminiApiKeys.length > 0;

  const busyRef = useRef(false);
  const contextHistoryRef = useRef(new Map<string, string>());
  const [storageWarning, setStorageWarning] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('canvasos_chat_v2') || 'null'
      );
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
      console.warn('[CanvasOS] Could not restore chat.');
    }
    setHistoryLoaded(true);
  }, []);
  useEffect(() => {
    if (!historyLoaded || isGenerating || isMakingReal) return;
    try {
      localStorage.setItem(
        'canvasos_chat_v2',
        JSON.stringify(
          messages.slice(-60).map(({ thought, ...m }) => ({
            ...m,
            executedActions: m.executedActions?.map((a) => ({
              ...a,
              rawFrame: {
                t: 'patch',
                op: a.op,
                id: a.rawFrame.id,
                target: a.rawFrame.target,
                title: a.rawFrame.title,
              },
            })),
          }))
        )
      );
    } catch {
      setStorageWarning(
        'Chat could not be saved. Export this conversation before closing.'
      );
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
    frames: SpatialActionFrame[]
  ) => {
    turn.controller.signal.throwIfAborted();
    if (editor!.getCurrentPageId() !== turn.pageId)
      throw new Error(
        'You switched pages while I was working. Return to the original page and retry.'
      );
    frames.forEach(validateAction);
    checkStale(turn.before, frames);
    if (frames.length)
      await spatial.runSpatialActions(frames, turn.id, turn.controller.signal);
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
      const selected = editor.getSelectedShapes();
      const targets = (
        /\b(all|everything)\b/i.test(prompt)
          ? editor.getCurrentPageShapes()
          : selected
      ).filter((s) => s.type === 'artifact');
      const turn = begin(prompt, true);
      if (!turn) return;

      // Speculative Skeleton Streaming: calculate non-overlapping placement coordinates
      // immediately upon summoning using calculateMakeRealPlacement and invoke spatial.addSkeleton
      // BEFORE awaiting the slow /api/ai/make-real fetch.
      try {
        const selectionBounds =
          editor.getSelectionPageBounds() || editor.getViewportPageBounds();
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
      } catch (e) {
        console.warn('[CanvasOS] Could not pre-calculate skeleton placement:', e);
      }

      const timeout = setTimeout(() => turn.controller.abort(), 180000);
      try {
        const frames: SpatialActionFrame[] = [];
        // Existing apps are grounded by source, since iframe pixels cannot be exported by SVG.
        const capture = targets.length
          ? null
          : await captureSelectionOrViewportAsImage(editor, { padding: 36 });
        const inputs = targets.length ? targets : [null];
        for (let i = 0; i < inputs.length; i++) {
          turn.controller.signal.throwIfAborted();
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
        const executedActions = await commit(turn, frames);
        spatial.clearSkeletons();
        patchMessage(turn.id, {
          content: `${targets.length ? 'Regenerated' : 'Created'} ${frames.length} app${frames.length === 1 ? '' : 's'}.`,
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
    [editor, spatial, provider, activeModel, geminiApiKeys, openRouterApiKeys]
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
        context.viewportNeighbors = context.viewportNeighbors.map((n) => ({
          ...n,
          code: n.code?.slice(0, 180),
          content: n.content?.slice(0, 180),
          text: n.text?.slice(0, 180),
          storage: undefined,
        }));
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
              '[CanvasOS] Visual capture unavailable; using structured context.'
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
        const executedActions = await commit(turn, frames);
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
          content: result,
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
    geminiModel,
    openRouterModel,
    setGeminiModel,
    setOpenRouterModel,
    setGeminiKeys,
    addGeminiKey,
    removeGeminiKey,
    saveGeminiKey,
    setOpenRouterKeys,
    addOpenRouterKey,
    removeOpenRouterKey,
    saveOpenRouterKey,
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
      provider === 'openrouter' ? saveOpenRouterKey(key) : saveGeminiKey(key),
    sendMessage,
    stopGeneration,
    clearChat,
    exportConversationMarkdown,
    focusOnShape,
    groundedContext,
    makeReal,
  };
}
