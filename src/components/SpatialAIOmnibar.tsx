'use client';

import { GenerationGlow } from './GenerationGlow';
import { AIOrb } from './AIOrb';


import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  Square,
  Check,
  Copy,
  Plus,
  KeyRound,
  SquarePen,
  Wand2,
  Mic,
  MicOff,
  Maximize2,
  Minimize2,
  Brain,
  Command,
  FileText,
  Cpu,
  Layers,
  Flame,
} from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { VoiceBeam, useMicrophone } from 'voice-glow';
import type { useSpatialAI } from '../hooks/useSpatialAI';
import type { useSpatialWorker } from '../hooks/useSpatialWorker';
import { useVisibleViewport } from '../hooks/useVisibleViewport';
import ProviderSetup from './ProviderSetup';

export interface SpatialAIOmnibarProps {
  active?: boolean;
  ai: ReturnType<typeof useSpatialAI>;
  spatial?: ReturnType<typeof useSpatialWorker>;
  initialDraft?: string;
  draftId?: string;
  onDraftConsumed?: () => void;
}

export type ComposerSubmission =
  | { kind: 'idle' }
  | { kind: 'provider-setup'; draft: string }
  | { kind: 'send'; prompt: string };

export function resolveComposerSubmission(
  draft: string,
  hasActiveKey: boolean,
  isGenerating: boolean
): ComposerSubmission {
  const prompt = draft.trim();
  if (!prompt || isGenerating) return { kind: 'idle' };
  return hasActiveKey
    ? { kind: 'send', prompt }
    : { kind: 'provider-setup', draft };
}

function CalmAIIcon({ size = 20 }: { size?: number }) {
  return (
    <AIOrb
      aria-hidden="true"
      style={{ width: size, height: size, color: 'var(--studio-action, #9cb8ff)' }}
      strokeWidth={1.6}
    />
  );
}

/** Keeps AnimatePresence inside the DOM portal and gives it a valid React child. */
export function createSpatialAIPanelPortal(
  isOpen: boolean,
  panel: React.ReactElement,
  target: Element | null
) {
  if (!target) return null;
  return createPortal(
    <AnimatePresence>{isOpen ? panel : null}</AnimatePresence>,
    target
  );
}

export async function copyTextToClipboard(
  text: string,
  clipboard?: Pick<Clipboard, 'writeText'> | null,
  doc?: Document | null
): Promise<boolean> {
  let clipboardApi: Pick<Clipboard, 'writeText'> | null = null;
  try {
    clipboardApi = clipboard === undefined
      ? (typeof navigator !== 'undefined' ? navigator.clipboard : null)
      : clipboard;
    if (clipboardApi?.writeText) {
      await clipboardApi.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy path when browser permission is denied.
  }

  let documentRef: Document | null = null;
  let textArea: HTMLTextAreaElement | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let previousSelection: {
    start: number | null;
    end: number | null;
    direction: 'forward' | 'backward' | 'none' | null;
  } | null = null;
  try {
    documentRef = doc === undefined
      ? (typeof document !== 'undefined' ? document : null)
      : doc;
    if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;

    try {
      const activeElement = documentRef.activeElement as HTMLElement | null;
      if (activeElement && typeof activeElement.focus === 'function') {
        previouslyFocused = activeElement;
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
          const textControl = activeElement as HTMLInputElement | HTMLTextAreaElement;
          previousSelection = {
            start: textControl.selectionStart,
            end: textControl.selectionEnd,
            direction: textControl.selectionDirection,
          };
        }
      }
    } catch {
      // Copying still works if the current focus or selection cannot be read.
    }

    textArea = documentRef.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    documentRef.body.appendChild(textArea);
    textArea.select();
    return documentRef.execCommand('copy');
  } catch {
    return false;
  } finally {
    try {
      textArea?.remove();
    } catch {
      // Cleanup failure must not turn an unsuccessful copy into a rejected promise.
    }
    if (previouslyFocused && previouslyFocused.isConnected) {
      try {
        previouslyFocused.focus({ preventScroll: true });
      } catch {
        try {
          previouslyFocused.focus();
        } catch {
          // Focus restoration is best effort when the original target is no longer focusable.
        }
      }
      if (previousSelection && previousSelection.start !== null && previousSelection.end !== null) {
        try {
          (previouslyFocused as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
            previousSelection.start,
            previousSelection.end,
            previousSelection.direction ?? 'none'
          );
        } catch {
          // Some input types do not support selection ranges.
        }
      }
    }
  }
}

export function insertDictationAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(value.length, Math.trunc(selectionStart)));
  const end = Math.max(start, Math.min(value.length, Math.trunc(selectionEnd)));
  const insertion = transcript.trim();
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leadingSpace = before && !/\s$/.test(before) && insertion && !/^[,.;!?…:)}\]]/.test(insertion)
    ? ' '
    : '';
  const trailingSpace = after && !/^\s/.test(after) && insertion && !/^[,.;!?…:)}\]]/.test(after)
    ? ' '
    : '';
  return {
    value: `${before}${leadingSpace}${insertion}${trailingSpace}${after}`,
    caret: start + leadingSpace.length + insertion.length,
  };
}

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 3)}...${key.slice(-2)}`;
  return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}

function renderChatMarkdownWithKaTeX(rawText: string): string {
  if (!rawText) return '';

  let processed = rawText;

  // Block math ($$...$$)
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="katex-block my-1.5 overflow-x-auto py-0.5">${katex.renderToString(
        math.trim(),
        {
          displayMode: true,
          throwOnError: false,
        }
      )}</div>`;
    } catch {
      return `<pre class="bg-black/40 p-2 rounded-xl text-red-300 font-mono text-xs border border-white/10">${math}</pre>`;
    }
  });

  // Inline math ($...$)
  processed = processed.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_, math) => {
    try {
      return `<span class="katex-inline">${katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false,
      })}</span>`;
    } catch {
      return `<code class="bg-white/10 px-1 rounded text-red-300 font-mono">${math}</code>`;
    }
  });

  try {
    const rawHtml = marked.parse(processed) as string;
    if (typeof window !== 'undefined') {
      return DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: [
          'annotation',
          'semantics',
          'math',
          'mrow',
          'mi',
          'mo',
          'mn',
          'msup',
          'msub',
          'mfrac',
          'mover',
          'munder',
          'msubsup',
          'mtext',
          'mspace',
          'mtable',
          'mtr',
          'mtd',
        ],
        ADD_ATTR: ['display', 'xmlns'],
      });
    }
    return rawHtml;
  } catch {
    return processed.replace(/\n/g, '<br/>');
  }
}

function CopyMessageButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let succeeded = false;
    try {
      succeeded = await copyTextToClipboard(text);
    } catch {
      succeeded = false;
    }
    setCopyState(succeeded ? 'copied' : 'failed');
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState('idle'), 2200);
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      title={copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? 'Copy failed' : 'Copy message text'}
      aria-label={copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? 'Copy failed. Try again.' : 'Copy message text'}
      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform] shrink-0"
    >
      {copyState === 'copied' ? (
        <Check className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
      ) : copyState === 'failed' ? (
        <X className="h-4 w-4 text-rose-300" strokeWidth={1.5} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={1.5} />
      )}
    </button>
  );
}

function formatDisplayActionBadge(raw: string): string {
  if (!raw) return 'Action Completed';
  let clean = raw.trim();

  // Strip shape:app_... or shape:... UUIDs
  clean = clean.replace(/shape:(?:app_|card_|doc_|deck_|box_|vector_)?[a-f0-9-]+/gi, (match) => {
    if (/app_/i.test(match)) return 'Live App';
    if (/card_/i.test(match)) return 'Note';
    if (/doc_/i.test(match)) return 'Doc';
    if (/deck_/i.test(match)) return 'Slides';
    return 'Element';
  });

  // Strip standalone UUIDs
  clean = clean.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '');

  // Compress repetitive prefixes
  clean = clean.replace(/^focus viewport:?\s*/i, 'Focus: ');
  clean = clean.replace(/^spawn artifact:?\s*/i, 'Created App: ');
  clean = clean.replace(/^mutate artifact:?\s*/i, 'Updated App: ');
  clean = clean.replace(/^create rich card:?\s*/i, 'Created Note: ');
  clean = clean.replace(/^mutate rich card:?\s*/i, 'Updated Note: ');
  clean = clean.replace(/^create code card:?\s*/i, 'Created Code: ');
  clean = clean.replace(/^create document:?\s*/i, 'Created Doc: ');
  clean = clean.replace(/^create slide deck:?\s*/i, 'Created Slides: ');

  // Clean trailing punctuation or spaces
  clean = clean.replace(/[:,\s]+$/, '').trim();
  if (clean.length > 40) {
    clean = clean.slice(0, 37) + '...';
  }
  return clean || 'Canvas Updated';
}

function VisionThinkingAccordion({
  thought,
  durationMs,
  isStreaming,
}: {
  thought: string;
  durationMs?: number;
  isStreaming?: boolean;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [userToggled, setUserToggled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => Boolean(isStreaming));

  useEffect(() => {
    if (isStreaming && !userToggled) {
      setIsExpanded(true);
    }
  }, [isStreaming, userToggled]);

  if (!thought) return null;

  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md overflow-hidden text-xs transition-[color,background-color,border-color,opacity,transform]">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsExpanded(!isExpanded);
        }}
        className="w-full min-h-[44px] flex items-center justify-between px-3.5 py-2 bg-white/[0.02] hover:bg-white/[0.05] active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform] text-white/80"
      >
        <div className="flex items-center gap-2 font-medium">
          <CalmAIIcon size={18} />
          <span className="font-semibold text-[11px] text-white/90">
            Reasoning Chain
          </span>
          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-[10px] text-white/50 font-mono tabular-nums">
              ({(durationMs / 1000).toFixed(1)}s)
            </span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-mono text-white/80 border border-white/10">
              Thinking
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-white/50" strokeWidth={2.0} />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/50" strokeWidth={2.0} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="p-3 text-[11px] font-mono leading-relaxed text-white/70 whitespace-pre-wrap max-h-56 overflow-y-auto border-t border-white/10 bg-black/40 custom-card-scrollbar select-text cursor-text"
          >
            {thought}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResponseLoadingIndicator() {
  return (
    <div role="status" className="flex items-center gap-2.5 py-2 px-1 text-white/70">
      <AIOrb active />
      <span className="text-sm font-medium text-slate-300">Generating response…</span>
    </div>
  );
}

export const SpatialAIOmnibar: React.FC<SpatialAIOmnibarProps> = ({
  ai,
  active = true,
  initialDraft,
  draftId,
  onDraftConsumed,
}) => {
  const reduceMotion = useReducedMotion() ?? false;
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showProviderSetup, setShowProviderSetup] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showContextExplanation, setShowContextExplanation] = useState(false);
  const [inputText, setInputText] = useState('');
  const [providerSaveNotice, setProviderSaveNotice] = useState('');
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const lastDraftIdentityRef = useRef<string | null>(null);
  const viewport = useVisibleViewport();
  const viewportPadding = {
    top: Math.max(viewport.width <= 640 ? 10 : 24, viewport.safeAreaInsets.top),
    right: Math.max(viewport.width <= 640 ? 10 : 24, viewport.safeAreaInsets.right),
    bottom: Math.max(viewport.width <= 640 ? 10 : 24, viewport.safeAreaInsets.bottom),
    left: Math.max(viewport.width <= 640 ? 10 : 24, viewport.safeAreaInsets.left),
  };
  const availablePanelWidth = Math.max(
    0,
    viewport.width - viewportPadding.left - viewportPadding.right
  );
  const availablePanelHeight = Math.max(
    0,
    viewport.height - viewportPadding.top - viewportPadding.bottom
  );
  const isCompact = viewport.width <= 640;
  const panelWidth = Math.min(isCompact ? 520 : isExpanded ? 680 : 480, availablePanelWidth);
  const conversationMessages = ai.messages.filter((message) => message.id !== 'welcome');
  const panelHeight = isCompact
    ? Math.min(
        availablePanelHeight,
        isExpanded
          ? availablePanelHeight
          : Math.max(360, Math.min(680, availablePanelHeight * 0.88))
      )
    : Math.min(isExpanded ? 760 : Math.max(460, viewport.height * 0.72), availablePanelHeight);

  // Voice Dictation with Web Speech API & Voice Glow
  const mic = useMicrophone();
  const startMicrophone = mic.start;
  const stopMicrophone = mic.stop;
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const dictationAnchorRef = useRef<{ value: string; start: number; end: number } | null>(null);
  const dictationCaretRef = useRef<number | null>(null);
  const microphoneStartRef = useRef<Promise<MediaStream | null> | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const isMicLive = mic.state === 'live' || isListening;

  const requestMicrophone = useCallback(() => {
    if (!microphoneStartRef.current) {
      const pendingStart = startMicrophone().finally(() => {
        if (microphoneStartRef.current === pendingStart) {
          microphoneStartRef.current = null;
        }
      });
      microphoneStartRef.current = pendingStart;
    }
    return microphoneStartRef.current;
  }, [startMicrophone]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !isOpen) return;
    let lastWidth = -1;
    let resizeFrame = 0;
    const fitDraft = () => {
      input.style.height = '44px';
      input.style.height = `${Math.min(150, Math.max(44, input.scrollHeight))}px`;
    };
    fitDraft();
    const observer = new ResizeObserver(() => {
      // Observe wrapping changes without feeding height changes back into layout.
      if (input.clientWidth === lastWidth) return;
      lastWidth = input.clientWidth;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitDraft);
    });
    observer.observe(input);
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); };
  }, [inputText, isOpen]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = dictationCaretRef.current;
    if (input && caret !== null) input.setSelectionRange(caret, caret);
  }, [inputText]);

  // Click outside to dismiss Action Menu popover
  useEffect(() => {
    if (!showActionMenu) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const isInside =
        actionMenuRef.current &&
        (actionMenuRef.current.contains(target) ||
          (e.composedPath && e.composedPath().includes(actionMenuRef.current)));

      if (!isInside) {
        setShowActionMenu(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, {
      capture: true,
    });
    window.addEventListener('click', handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, {
        capture: true,
      });
      window.removeEventListener('click', handlePointerDown, { capture: true });
    };
  }, [showActionMenu]);

  // Keyboard shortcut: Cmd+K / Ctrl+K / / opens Omnibar
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[role="dialog"][aria-modal="true"]')) return;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches('input, textarea, select, [role="textbox"]'));

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (
        e.key === '/' &&
        !e.isComposing &&
        !isTextEntry
      ) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setShowActionMenu(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, active]);

  useEffect(() => {
    if (isOpen && active) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen, active]);

  // Load each external draft once. Opening or closing the composer never sends
  // it, and edits remain in component state after the parent acknowledges it.
  useEffect(() => {
    if (typeof initialDraft !== 'string') return;
    const identity = draftId ? `id:${draftId}` : `text:${initialDraft}`;
    if (lastDraftIdentityRef.current === identity) return;
    lastDraftIdentityRef.current = identity;
    setInputText(initialDraft);
    setIsOpen(true);
    setShowActionMenu(false);
    onDraftConsumed?.();
  }, [initialDraft, draftId, onDraftConsumed]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [ai.messages, isUserScrolledUp, reduceMotion]);

  const handleScroll = () => {
    if (!chatScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    setIsUserScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    setIsUserScrolledUp(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submission = resolveComposerSubmission(inputText, ai.hasActiveKey, ai.isGenerating);
    if (submission.kind === 'idle') return;
    if (submission.kind === 'provider-setup') {
      setShowProviderSetup(true);
      return;
    }
    ai.sendMessage(submission.prompt);
    setInputText('');
    setProviderSaveNotice('');
    setIsUserScrolledUp(false);
  };

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent;
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !nativeEvent.isComposing &&
      nativeEvent.keyCode !== 229
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleNewChat = () => {
    ai.clearChat();
    setIsUserScrolledUp(false);
    setShowActionMenu(false);
  };

  const handleActionPreset = (presetPrompt: string) => {
    setInputText(presetPrompt);
    setIsOpen(true);
    setShowActionMenu(false);
    setIsUserScrolledUp(false);
  };

  const startVoice = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const previousRecognition = recognitionRef.current;
      recognitionRef.current = null;
      if (previousRecognition) {
        previousRecognition.onstart = null;
        previousRecognition.onresult = null;
        previousRecognition.onerror = null;
        previousRecognition.onend = null;
        try { previousRecognition.abort(); } catch {}
      }

      const input = inputRef.current;
      const value = input?.value ?? inputText;
      const start = input?.selectionStart ?? value.length;
      const end = input?.selectionEnd ?? start;
      dictationAnchorRef.current = { value, start, end };
      dictationCaretRef.current = null;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';

      recognition.onstart = () => {
        if (!isOpenRef.current || recognitionRef.current !== recognition) return;
        setIsListening(true);
        void requestMicrophone()
          .then(() => {
            // getUserMedia cannot be cancelled while permission is pending. If
            // this recognizer was stopped before it resolves, release the late
            // stream unless a replacement recognizer now owns the microphone.
            if (!isOpenRef.current || recognitionRef.current === null) {
              stopMicrophone();
            }
          })
          .catch(() => {});
      };

      recognition.onresult = (event: any) => {
        if (!isOpenRef.current || recognitionRef.current !== recognition) return;
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          const anchor = dictationAnchorRef.current;
          if (!anchor) return;
          const insertion = insertDictationAtSelection(
            anchor.value,
            anchor.start,
            anchor.end,
            transcript
          );
          dictationCaretRef.current = insertion.caret;
          setInputText(insertion.value);
        }
      };

      recognition.onerror = (event: any) => {
        if (recognitionRef.current !== recognition) return;
        console.warn('[visionOS] Speech recognition error:', event.error);
        if (event.error !== 'no-speech') {
          recognitionRef.current = null;
          recognition.onstart = null;
          recognition.onresult = null;
          recognition.onerror = null;
          recognition.onend = null;
          try { recognition.abort(); } catch {}
          setIsListening(false);
          stopMicrophone();
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
          setIsListening(false);
          stopMicrophone();
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('[visionOS] Speech recognition failed to start:', err);
      const failedRecognition = recognitionRef.current;
      recognitionRef.current = null;
      if (failedRecognition) {
        failedRecognition.onstart = null;
        failedRecognition.onresult = null;
        failedRecognition.onerror = null;
        failedRecognition.onend = null;
      }
      setIsListening(false);
      stopMicrophone();
    }
  }, [inputText, requestMicrophone, stopMicrophone]);

  const stopVoice = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {}
    }
    setIsListening(false);
    stopMicrophone();
  }, [stopMicrophone]);

  useEffect(() => {
    if (!isOpen) stopVoice();
  }, [isOpen, stopVoice]);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch {}
    }
    stopMicrophone();
  }, [stopMicrophone]);

  const toggleVoice = useCallback(() => {
    if (isListening || mic.state === 'live') {
      stopVoice();
    } else {
      startVoice();
    }
  }, [isListening, mic.state, startVoice, stopVoice]);

  const handlePromptInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    dictationCaretRef.current = null;
    if (recognitionRef.current) stopVoice();
    setInputText(event.currentTarget.value);
  }, [stopVoice]);

  const handlePromptSelectionChange = useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (!recognitionRef.current) return;
    const caret = dictationCaretRef.current;
    const input = event.currentTarget;
    if (caret !== null && input.selectionStart === caret && input.selectionEnd === caret) return;
    dictationCaretRef.current = null;
    stopVoice();
  }, [stopVoice]);

  const quickStarters = [
    {
      label: 'Make Real: Sketch to App',
      prompt:
        'Make Real: Turn the selected sketch/wireframe into an interactive, responsive live app with persistent storage.',
      icon: Wand2,
    },
    {
      label: 'Microservices Architecture',
      prompt:
        'Build a distributed microservices cloud architecture on canvas with API Gateway, Auth Microservice, Redis Message Queue, and PostgreSQL Database cylinder, connecting them with labeled arrows.',
      icon: Cpu,
    },
    {
      label: 'Whitepaper Document Spec',
      prompt:
        'Create a comprehensive technical document specification for a distributed Byzantine Fault Tolerant consensus engine, including Executive Summary, Mathematical Foundations, and Network Architecture sections.',
      icon: FileText,
    },
    {
      label: 'Physics Simulation Sandbox',
      prompt:
        'Spawn an interactive live physics sandbox with particle gravity simulation and velocity controls with persistent storage.',
      icon: Flame,
    },
    {
      label: '2x2 Strategic SWOT Matrix',
      prompt:
        'Generate a comprehensive 2x2 SWOT Strategic Analysis matrix with color-coded quadrants.',
      icon: Layers,
    },
  ];

  return (
    <>
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. Floating Bottom-Right visionOS Omnibar Trigger Pill (Desktop HUD) */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {active && !isOpen && (
        <div
          data-canvas-chrome="ai-launcher"
          className="fixed bottom-6 right-6 z-[300] pointer-events-auto"
        >
          <motion.button
            type="button"
            onClick={() => setIsOpen(true)}
            whileHover={reduceMotion ? undefined : { scale: 1.02 }}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            aria-label="Ask AI"
            className="studio-ai-launcher flex min-h-[48px] items-center gap-3 rounded-full px-4 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-action,#9cb8ff)]"
          >
            <div className="flex h-6 w-6 items-center justify-center">
              <CalmAIIcon size={20} />
            </div>
            <span className="text-sm">Ask AI</span>
            <kbd className="flex items-center gap-0.5 rounded-full border border-current/15 bg-current/5 px-2 py-0.5 text-xs font-mono tabular-nums opacity-75">
              <Command className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" /> K
            </kbd>
          </motion.button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. visionOS Spatial Intelligence Liquid Glass Panel                 */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {typeof document !== 'undefined' && createSpatialAIPanelPortal(
        active && isOpen,
          <motion.aside
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            aria-label="Ask AI"
            data-visionos-panel="true"
            style={{
              position: 'fixed',
              left: viewport.left,
              top: viewport.top,
              width: viewport.width,
              height: viewport.height,
              boxSizing: 'border-box',
              paddingTop: viewportPadding.top,
              paddingRight: viewportPadding.right,
              paddingBottom: viewportPadding.bottom,
              paddingLeft: viewportPadding.left,
            }}
            className="z-[750] flex flex-col items-end justify-end pointer-events-none"
          >
            <motion.div
              style={{
                width: panelWidth,
                height: panelHeight,
                maxWidth: '100%',
                maxHeight: '100%',
                pointerEvents: 'auto',
              }}
              initial={reduceMotion ? false : {
                opacity: 0,
                y: 8,
                scale: 0.96,
                width: panelWidth,
                height: panelHeight,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                width: panelWidth,
                height: panelHeight,
              }}
              exit={{
                opacity: 0,
                y: 8,
                scale: 0.96,
                transition: { duration: 0.2, ease: [0.2, 0, 0, 1] },
              }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0 }}
              className={`studio-ai-panel studio-ai-panel__surface relative flex min-h-0 w-full max-w-full flex-col overflow-hidden antialiased ${isCompact ? 'rounded-[20px]' : 'rounded-[24px]'}`}
            >
              <GenerationGlow active={ai.isGenerating || ai.isMakingReal} />
              <header className="studio-ai-header flex shrink-0 items-center justify-between gap-3">
                <div className="studio-ai-header__identity flex items-center gap-3 min-w-0">
                  <div className="studio-ai-mark flex h-8 w-8 items-center justify-center shrink-0">
                    {ai.isGenerating ? <AIOrb active /> : <CalmAIIcon size={20} />}
                  </div>
                  <div className="studio-ai-header__copy min-w-0">
                    <h2 className="font-semibold text-sm tracking-wide truncate">
                      Ask AI
                    </h2>
                    <p className="studio-ai-provider-line text-xs text-slate-400 truncate tracking-tight">
                      {ai.provider} · {ai.activeModel}
                    </p>
                  </div>
                </div>

                {/* Circular Top Controls (Touch Targets >= 40x40px, Scale 0.96) */}
                <div className="studio-ai-header__controls flex items-center gap-1">
                  {/* New Chat Button */}
                  <button
                    type="button"
                    onClick={handleNewChat}
                    title="Start New Chat"
                    aria-label="Start new chat"
                    className="studio-ai-header__utility min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform]"
                  >
                    <SquarePen className="h-4 w-4" strokeWidth={1.5} />
                  </button>

                  {/* Shared provider setup */}
                  <button
                    type="button"
                    onClick={() => setShowProviderSetup(true)}
                    title="AI provider settings"
                    aria-label="AI provider settings"
                    className="studio-ai-header__utility min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-transform"
                  >
                    <KeyRound className="h-4 w-4" strokeWidth={1.5} />
                  </button>

                  {/* Expand / Collapse Button */}
                  <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? 'Collapse size' : 'Expand size'}
                    aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
                    aria-pressed={isExpanded}
                    className="studio-ai-header__primary min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform]"
                  >
                    {isExpanded ? (
                      <Minimize2 className="h-4 w-4" strokeWidth={1.5} />
                    ) : (
                      <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>

                  {/* Close / Dismiss Button */}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    title="Close Ask AI"
                    aria-label="Close Ask AI"
                    className="studio-ai-header__primary studio-ai-header__dismiss min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform]"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </header>
              <div className="studio-ai-options">
                <button type="button" className="studio-ai-scope-button" aria-expanded={showContextExplanation} onClick={() => setShowContextExplanation(value => !value)}>
                  <Layers size={15} aria-hidden="true" />
                  {ai.groundedContext.selectedCount > 0 ? `${ai.groundedContext.selectedCount} selected` : 'Canvas context'}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                <label className="studio-ai-response-style">
                  <Brain size={15} aria-hidden="true" />
                  <select aria-label="Response style" value={ai.thinkingMode ? 'reasoned' : 'quick'} onChange={event => ai.setThinkingMode(event.target.value === 'reasoned')}>
                    <option value="quick">Quick response</option>
                    <option value="reasoned">Deep reasoning</option>
                  </select>
                </label>
                {showContextExplanation && <p className="studio-ai-scope-details">Requests can include selected objects, nearby visible canvas content, and a visual snapshot when available.</p>}
              </div>

              {/* ── Scrollable Chat Content ── */}
              {ai.storageWarning && (
                <p role="alert" className="px-4 py-2 text-xs text-amber-200">
                  {ai.storageWarning}
                </p>
              )}
              <div
                ref={chatScrollRef}
                onScroll={handleScroll}
                className="studio-ai-transcript visionos-ai-chat-scroll flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-card-scrollbar select-text"
              >
                {/* Empty State: Quick Prompt Starters */}
                {conversationMessages.length === 0 && (
                  <div className="studio-ai-empty flex flex-col items-center justify-center min-h-[300px] text-center p-4 gap-4">
                    <div className="studio-ai-empty__symbol flex h-12 w-12 items-center justify-center">
                      <AIOrb size={64} />
                    </div>
                    <div>
                      <h3 className="studio-ai-empty__title font-semibold text-sm text-white">
                        What would you like to create?
                      </h3>
                      <p className="studio-ai-empty__description text-xs text-white/50 mt-1 max-w-[280px]">
                        Choose a starter to fill the prompt. Select Send when ready.
                      </p>
                    </div>

                    <div className="w-full space-y-2 mt-2">
                      {quickStarters.slice(0, 2).map((item, idx) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleActionPreset(item.prompt)}
                            className="studio-ai-starter w-full flex items-center gap-2.5 p-3 rounded-[24px] bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.96] border border-white/[0.08] text-left transition-[color,background-color,border-color,opacity,transform] group"
                          >
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/10 text-white shrink-0">
                              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </div>
                            <span className="text-xs font-medium text-white/80 group-hover:text-white truncate">
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Message List */}
                {conversationMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-1`}
                  >
                    {msg.role === 'user' ? (
                      <div className="studio-ai-message studio-ai-message--user max-w-[85%] rounded-2xl rounded-tr-sm bg-white/15 border border-white/10 px-4 py-3 text-xs leading-relaxed text-white shadow-md">
                        {msg.content}
                        {!ai.isGenerating && <button type="button" className="mt-2 block min-h-[44px] text-sm underline underline-offset-4" onClick={() => { setInputText(msg.content); inputRef.current?.focus(); }}>Edit prompt</button>}
                      </div>
                    ) : (
                      <div className="studio-ai-message studio-ai-message--assistant w-full">
                        {/* Assistant Header */}
                        <div className="studio-ai-message__header flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {msg.isStreaming
                              ? <AIOrb active />
                              : <CalmAIIcon size={18} />}
                            <span className="studio-ai-message__label font-semibold">
                              Assistant
                            </span>
                          </div>
                          <CopyMessageButton text={msg.content} />
                        </div>

                        {/* Thought Process Accordion */}
                        {msg.thought && (
                          <VisionThinkingAccordion
                            thought={msg.thought}
                            durationMs={msg.thoughtDurationMs}
                            isStreaming={msg.isStreaming}
                          />
                        )}

                        {/* Show the actual request phase while the first response chunk arrives. */}
                        {msg.isStreaming &&
                          (!msg.content || msg.content.trim().length === 0) &&
                          !msg.thought && <ResponseLoadingIndicator />}

                        {/* Message Markdown Content */}
                        {msg.content && msg.content.trim().length > 0 && (
                          <div
                            className="studio-ai-message__content rich-card-prose prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: renderChatMarkdownWithKaTeX(msg.content),
                            }}
                          />
                        )}

                        {/* Executed Action Badges (Apple Liquid Glass Pills) */}
                        {msg.executedActions &&
                          msg.executedActions.length > 0 && (
                            <div className="studio-ai-message__actions flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-white/[0.08]">
                              {msg.executedActions.map((act, i) => (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const id =
                                      act.rawFrame.target ||
                                      act.rawFrame.id ||
                                      act.rawFrame.nodeIds?.[0];
                                    if (id) ai.focusOnShape(id);
                                  }}
                                  title="Show affected element on canvas"
                                  key={i}
                                  className="studio-ai-message__action inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 active:scale-[0.96] text-[11px] text-white/80 font-medium transition-[color,background-color,border-color,opacity,transform]"
                                >
                                  <span className="text-cyan-400">✦</span>
                                  <span>{formatDisplayActionBadge(act.actionSummary)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                ))}

                <div ref={messagesEndRef} />
              </div>

              <div role="status" aria-live="polite" className="sr-only">
                {ai.isGenerating
                  ? ai.isMakingReal
                    ? 'Generating app'
                    : 'Preparing response'
                  : 'Ready'}
              </div>
              {/* ── Bottom Input & Intelligence Controls ── */}
              <div
                ref={actionMenuRef}
                className="studio-ai-footer relative space-y-2"
              >
                {providerSaveNotice && (
                  <p className="studio-provider-status mx-1" role="status">
                    {providerSaveNotice}
                  </p>
                )}
                {/* ── Action Menu Popover (When + is Pressed) ── */}
                <AnimatePresence>
                  {showActionMenu && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 10, scale: 0.95 }}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
                      id="studio-ai-actions-menu"
                      aria-label="Chat actions and prompt starters"
                      className="studio-ai-menu absolute bottom-20 left-4 z-50 w-72 rounded-[20px] bg-[rgba(24,24,32,0.95)] backdrop-blur-3xl border border-white/10 p-2 shadow-2xl space-y-1"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleNewChat();
                          setShowActionMenu(false);
                        }}
                        className="studio-ai-menu__utility w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-left text-sm font-medium"
                      >
                        <SquarePen className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                        <span>Start a new chat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowProviderSetup(true);
                          setShowActionMenu(false);
                        }}
                        className="studio-ai-menu__utility w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-left text-sm font-medium"
                      >
                        <KeyRound className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                        <span>Provider settings</span>
                      </button>
                      <div className="studio-ai-menu__divider" aria-hidden="true" />
                      {quickStarters.map((item, idx) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleActionPreset(item.prompt)}
                            className="studio-ai-menu__starter w-full flex items-center gap-2.5 min-h-[44px] px-3 py-2.5 rounded-xl text-left text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform]"
                          >
                            <Icon
                              className="h-4 w-4 text-white/60 shrink-0"
                              strokeWidth={1.5}
                            />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>

                <form
                    onSubmit={handleSubmit}
                    className="studio-ai-composer flex items-end w-full"
                  >
                    {/* Action Menu (+) Button (Touch target >= 40x40px, Scale 0.96) */}
                    <button
                      type="button"
                      onClick={() => setShowActionMenu(!showActionMenu)}
                      title="Quick Action Presets"
                      aria-label="Open chat actions and prompt starters"
                      aria-expanded={showActionMenu}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform] shrink-0"
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    </button>

                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={inputText}
                      onChange={handlePromptInputChange}
                      onSelect={handlePromptSelectionChange}
                      onKeyDown={handlePromptKeyDown}
                      placeholder={
                        ai.groundedContext.selectedCount > 0
                          ? 'Ask AI about the selected objects…'
                          : 'Ask AI about this canvas…'
                      }
                      disabled={ai.isGenerating || ai.isMakingReal}
                      className="max-h-40 min-h-[44px] flex-1 resize-y bg-transparent px-2 py-3 text-base leading-6 text-white placeholder-white/55 !outline-none font-sans"
                      aria-label="Ask AI"
                      aria-describedby="studio-ai-send-hint"
                    />

                    {/* Voice Dictation Button with VoiceBeam */}
                    <VoiceBeam stream={mic.stream}>
                      <button
                        type="button"
                        onClick={toggleVoice}
                        aria-label={isMicLive ? 'Stop voice input' : 'Start voice input'}
                        title={
                          isMicLive ? 'Stop microphone' : 'Start voice input'
                        }
                        className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-[color,background-color,border-color,opacity,transform] active:scale-[0.96] shrink-0 ${
                          isMicLive
                            ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                            : 'text-white/60 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {isMicLive ? (
                          <MicOff
                            className="h-4 w-4 text-rose-300"
                            strokeWidth={1.5}
                          />
                        ) : (
                          <Mic className="h-4 w-4" strokeWidth={1.5} />
                        )}
                      </button>
                    </VoiceBeam>

                    {/* Send / Stop Action Button (Touch target >= 40x40px, Scale 0.96) */}
                    {ai.isGenerating ? (
                      <button
                        type="button"
                        onClick={ai.stopGeneration}
                        title="Stop generation"
                        aria-label="Stop generation"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 text-white active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform] shrink-0"
                      >
                        <Square
                          className="h-4 w-4 fill-current"
                          strokeWidth={1.5}
                        />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!inputText.trim()}
                        title="Send prompt"
                        aria-label="Send prompt"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/30 active:scale-[0.96] transition-[color,background-color,border-color,opacity,transform] shadow-md shrink-0"
                      >
                        <Send className="h-4 w-4" strokeWidth={2.0} />
                      </button>
                    )}
                    <span id="studio-ai-send-hint" className="sr-only">
                      Press Enter to send, or Shift and Enter for a new line. Prompts are only sent when you choose Send.
                    </span>
                </form>
              </div>
            </motion.div>
          </motion.aside>,
        document.body
      )}
      <ProviderSetup
        isOpen={active && showProviderSetup}
        onClose={() => setShowProviderSetup(false)}
        onSaved={(detail) => {
          const storage = detail.persistenceStatus === 'persistent'
            ? 'Keys are saved in this browser.'
            : detail.persistenceStatus === 'session'
              ? 'Keys are available in this tab session.'
              : 'Keys are held in memory until this page closes.';
          setProviderSaveNotice(`Provider settings saved. The key was not checked. ${storage}`);
        }}
      />
    </>
  );
};
